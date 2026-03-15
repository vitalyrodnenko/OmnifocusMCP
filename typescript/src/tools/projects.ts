import { z } from "zod";

import { escapeForJxa, runOmniJs } from "../jxa.js";
import { errorResult, normalizeError, textResult, type Server } from "../types.js";

export function register(server: Server): void {
  server.tool(
    "list_projects",
    "list projects with optional folder and status filters. status semantics: completed means finished work, dropped means intentionally abandoned/cancelled, on_hold means paused, active means current.",
    {
      folder: z.string().min(1).optional().describe("optional folder name filter"),
      status: z
        .enum(["active", "on_hold", "completed", "dropped"])
        .default("active")
        .describe("project status filter"),
      completedBefore: z.string().optional().describe("optional completion-date upper bound in iso 8601"),
      completedAfter: z.string().optional().describe("optional completion-date lower bound in iso 8601"),
      stalledOnly: z.boolean().default(false).describe("when true, include only stalled active projects"),
      sortBy: z
        .enum(["name", "dueDate", "completionDate", "taskCount"])
        .optional()
        .describe("optional sort field"),
      sortOrder: z.enum(["asc", "desc"]).default("asc").describe("sort direction"),
      limit: z.number().int().min(1).default(100).describe("max number of projects to return"),
    },
    async ({
      folder,
      status,
      completedBefore,
      completedAfter,
      stalledOnly,
      sortBy,
      sortOrder,
      limit,
    }) => {
      try {
        let effectiveStatus = status;
        if (completedBefore !== undefined || completedAfter !== undefined) {
          effectiveStatus = "completed";
        }
        if (stalledOnly) {
          effectiveStatus = "active";
        }

        let effectiveSortBy = sortBy;
        let effectiveSortOrder = sortOrder;
        if ((completedBefore !== undefined || completedAfter !== undefined) && effectiveSortBy === undefined) {
          effectiveSortBy = "completionDate";
          effectiveSortOrder = "desc";
        }

        const folderFilter = folder === undefined ? "null" : escapeForJxa(folder);
        const statusFilter = escapeForJxa(effectiveStatus);
        const completedBeforeFilter = completedBefore === undefined ? "null" : escapeForJxa(completedBefore);
        const completedAfterFilter = completedAfter === undefined ? "null" : escapeForJxa(completedAfter);
        const stalledOnlyFilter = stalledOnly ? "true" : "false";
        const sortByFilter = effectiveSortBy === undefined ? "null" : escapeForJxa(effectiveSortBy);
        const sortOrderFilter = escapeForJxa(effectiveSortOrder);
        const script = `
const folderFilter = ${folderFilter};
const statusFilter = ${statusFilter};
const completedBeforeRaw = ${completedBeforeFilter};
const completedAfterRaw = ${completedAfterFilter};
const stalledOnly = ${stalledOnlyFilter};
const sortBy = ${sortByFilter};
const sortOrder = ${sortOrderFilter};

const parseOptionalDate = (rawValue, fieldName) => {
  if (rawValue === null) return null;
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(\`\${fieldName} must be a valid ISO 8601 date string.\`);
  }
  return parsed;
};

const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");

const projectCounts = new Map();
document.flattenedTasks.forEach(task => {
  const project = task.containingProject;
  if (!project) return;
  const projectId = project.id.primaryKey;
  const current = projectCounts.get(projectId) || { taskCount: 0, remainingTaskCount: 0 };
  current.taskCount += 1;
  if (!task.completed) current.remainingTaskCount += 1;
  projectCounts.set(projectId, current);
});

const normalizeProjectStatus = (project) => {
  const rawStatus = String(project.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) {
    return "on_hold";
  }
  if (flattened.includes("completed")) return "completed";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
};

const projects = document.flattenedProjects
  .filter(project => {
    const nextTask = project.nextTask;
    const isStalled = normalizeProjectStatus(project) === "active"
      && project.flattenedTasks.some(t => !t.completed)
      && nextTask === null;
    if (folderFilter !== null) {
      const folderName = project.folder ? project.folder.name : null;
      if (folderName !== folderFilter) return false;
    }
    if (normalizeProjectStatus(project) !== statusFilter) return false;
    if (completedBefore !== null && !(project.completionDate !== null && project.completionDate < completedBefore)) return false;
    if (completedAfter !== null && !(project.completionDate !== null && project.completionDate > completedAfter)) return false;
    if (stalledOnly && !isStalled) return false;
    return true;
  });

const mappedProjects = projects.map(project => {
  const projectId = project.id.primaryKey;
  const counts = projectCounts.get(projectId) || { taskCount: 0, remainingTaskCount: 0 };
  const nextTask = project.nextTask;
  const isStalled = normalizeProjectStatus(project) === "active"
    && project.flattenedTasks.some(t => !t.completed)
    && nextTask === null;
  const reviewInterval = project.reviewInterval;
  return {
    id: projectId,
    name: project.name,
    status: normalizeProjectStatus(project),
    folderName: project.folder ? project.folder.name : null,
    taskCount: counts.taskCount,
    remainingTaskCount: counts.remainingTaskCount,
    deferDate: project.deferDate ? project.deferDate.toISOString() : null,
    dueDate: project.dueDate ? project.dueDate.toISOString() : null,
    completionDate: project.completionDate ? project.completionDate.toISOString() : null,
    note: project.note,
    sequential: project.sequential,
    isStalled: isStalled,
    nextTaskId: nextTask ? nextTask.id.primaryKey : null,
    nextTaskName: nextTask ? nextTask.name : null,
    reviewInterval: reviewInterval === null || reviewInterval === undefined ? null : String(reviewInterval)
  };
});

const compareValues = (left, right) => {
  if (left < right) return sortOrder === "asc" ? -1 : 1;
  if (left > right) return sortOrder === "asc" ? 1 : -1;
  return 0;
};

const sortedProjects = sortBy === null ? mappedProjects : mappedProjects.slice().sort((a, b) => {
  let aValue = null;
  let bValue = null;
  if (sortBy === "name") {
    aValue = a.name;
    bValue = b.name;
  } else if (sortBy === "dueDate") {
    aValue = a.dueDate;
    bValue = b.dueDate;
  } else if (sortBy === "completionDate") {
    aValue = a.completionDate;
    bValue = b.completionDate;
  } else if (sortBy === "taskCount") {
    aValue = a.taskCount;
    bValue = b.taskCount;
  }

  if (aValue === null) return 1;
  if (bValue === null) return -1;

  if (sortBy === "name") {
    return compareValues(String(aValue).toLowerCase(), String(bValue).toLowerCase());
  }
  return compareValues(aValue, bValue);
});

return sortedProjects.slice(0, ${limit});
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "get_project_counts",
    "get aggregate project counts by status without listing individual projects.",
    {
      folder: z.string().min(1).optional().describe("optional folder name filter"),
    },
    async ({ folder }) => {
      try {
        if (folder !== undefined && folder.trim() === "") {
          throw new Error("folder must not be empty when provided.");
        }
        const folderFilter = folder === undefined ? "null" : escapeForJxa(folder.trim());
        const script = `
const folderFilter = ${folderFilter};

const normalizeProjectStatus = (project) => {
  const rawStatus = String(project.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) {
    return "on_hold";
  }
  if (flattened.includes("completed")) return "completed";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
};

const counts = {
  total: 0,
  active: 0,
  onHold: 0,
  completed: 0,
  dropped: 0,
  stalled: 0
};

document.flattenedProjects.forEach(project => {
  if (folderFilter !== null) {
    const folderName = project.folder ? project.folder.name : null;
    if (folderName !== folderFilter) return;
  }

  const status = normalizeProjectStatus(project);
  const isStalled = status === "active"
    && project.flattenedTasks.some(t => !t.completed)
    && project.nextTask === null;

  counts.total += 1;
  if (status === "active") counts.active += 1;
  if (status === "on_hold") counts.onHold += 1;
  if (status === "completed") counts.completed += 1;
  if (status === "dropped") counts.dropped += 1;
  if (isStalled) counts.stalled += 1;
});

return counts;
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "search_projects",
    "search projects by query using omnifocus project matching.",
    {
      query: z.string().min(1).describe("search query"),
      limit: z.number().int().min(1).default(100).describe("max number of projects to return"),
    },
    async ({ query, limit }) => {
      try {
        const normalizedQuery = query.trim();
        if (normalizedQuery === "") {
          throw new Error("query must not be empty.");
        }
        const queryValue = escapeForJxa(normalizedQuery);
        const script = `
const queryValue = ${queryValue};
const normalizeProjectStatus = (project) => {
  const rawStatus = String(project.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) {
    return "on_hold";
  }
  if (flattened.includes("completed")) return "completed";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
};

return projectsMatching(queryValue)
  .slice(0, ${limit})
  .map(project => {
    return {
      id: project.id.primaryKey,
      name: project.name,
      status: normalizeProjectStatus(project),
      folderName: project.folder ? project.folder.name : null
    };
  });
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "get_project",
    "get full details for one project by id or name.",
    { project_id_or_name: z.string().min(1).describe("project id primaryKey or exact name") },
    async ({ project_id_or_name }) => {
      try {
        const normalizedProjectFilter = project_id_or_name.trim();
        if (normalizedProjectFilter === "") {
          throw new Error("project_id_or_name must not be empty.");
        }
        const projectFilter = escapeForJxa(normalizedProjectFilter);
        const script = `
const projectFilter = ${projectFilter};
const project = document.flattenedProjects.find(item => {
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
});
if (!project) {
  throw new Error(\`Project not found: \${projectFilter}\`);
}

const normalizeProjectStatus = (item) => {
  const rawStatus = String(item.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) {
    return "on_hold";
  }
  if (flattened.includes("completed")) return "completed";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
};

const allProjectTasks = document.flattenedTasks.filter(task => {
  return task.containingProject && task.containingProject.id.primaryKey === project.id.primaryKey;
});
const nextTask = project.nextTask;
const isStalled = normalizeProjectStatus(project) === "active"
  && allProjectTasks.some(task => !task.completed)
  && nextTask === null;

const rootTasks = project.tasks.map(task => {
  return {
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    completed: task.completed,
    tags: task.tags.map(tag => tag.name),
    estimatedMinutes: task.estimatedMinutes
  };
});

const reviewInterval = project.reviewInterval;
return {
  id: project.id.primaryKey,
  name: project.name,
  status: normalizeProjectStatus(project),
  folderName: project.folder ? project.folder.name : null,
  taskCount: allProjectTasks.length,
  remainingTaskCount: allProjectTasks.filter(task => !task.completed).length,
  completedTaskCount: allProjectTasks.filter(task => task.completed).length,
  availableTaskCount: allProjectTasks.filter(task => !task.completed && (task.deferDate === null || task.deferDate <= new Date())).length,
  deferDate: project.deferDate ? project.deferDate.toISOString() : null,
  dueDate: project.dueDate ? project.dueDate.toISOString() : null,
  completionDate: project.completionDate ? project.completionDate.toISOString() : null,
  modified: project.modified ? project.modified.toISOString() : null,
  note: project.note,
  sequential: project.sequential,
  isStalled: isStalled,
  nextTaskId: nextTask ? nextTask.id.primaryKey : null,
  nextTaskName: nextTask ? nextTask.name : null,
  reviewInterval: reviewInterval === null || reviewInterval === undefined ? null : String(reviewInterval),
  rootTasks: rootTasks
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "create_project",
    "create a new project with optional folder, note, dates, and sequential mode.",
    {
      name: z.string().min(1).describe("project name"),
      folder: z.string().min(1).optional().describe("optional parent folder"),
      note: z.string().optional().describe("optional project note"),
      dueDate: z.string().optional().describe("optional due date in iso 8601"),
      deferDate: z.string().optional().describe("optional defer date in iso 8601"),
      sequential: z.boolean().optional().describe("optional sequential setting"),
    },
    async ({ name, folder, note, dueDate, deferDate, sequential }) => {
      try {
        const projectName = escapeForJxa(name.trim());
        const folderName = folder === undefined ? "null" : escapeForJxa(folder.trim());
        const noteValue = note === undefined ? "null" : escapeForJxa(note);
        const dueDateValue = dueDate === undefined ? "null" : escapeForJxa(dueDate);
        const deferDateValue = deferDate === undefined ? "null" : escapeForJxa(deferDate);
        const sequentialValue = sequential === undefined ? "null" : sequential ? "true" : "false";
        const script = `
const projectName = ${projectName};
const folderName = ${folderName};
const noteValue = ${noteValue};
const dueDateValue = ${dueDateValue};
const deferDateValue = ${deferDateValue};
const sequentialValue = ${sequentialValue};

const project = (() => {
  if (folderName === null) return new Project(projectName);
  const targetFolder = document.flattenedFolders.byName(folderName);
  if (!targetFolder) {
    throw new Error(\`Folder not found: \${folderName}\`);
  }
  return new Project(projectName, targetFolder.ending);
})();

if (noteValue !== null) project.note = noteValue;
if (dueDateValue !== null) project.dueDate = new Date(dueDateValue);
if (deferDateValue !== null) project.deferDate = new Date(deferDateValue);
if (sequentialValue !== null) project.sequential = sequentialValue;

return {
  id: project.id.primaryKey
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "complete_project",
    "complete a project by id or name. use this for finished/closed projects (done/completed), not set_project_status(\"dropped\").",
    { project_id_or_name: z.string().min(1).describe("project id primaryKey or exact name") },
    async ({ project_id_or_name }) => {
      try {
        const projectFilter = escapeForJxa(project_id_or_name.trim());
        const script = `
const projectFilter = ${projectFilter};
const project = document.flattenedProjects.find(item => {
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
});
if (!project) {
  throw new Error(\`Project not found: \${projectFilter}\`);
}

project.markComplete();

return {
  id: project.id.primaryKey,
  name: project.name,
  completed: true
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "uncomplete_project",
    "reopen a completed project by id or name and return active status (undo complete_project).",
    { project_id_or_name: z.string().min(1).describe("project id primaryKey or exact name") },
    async ({ project_id_or_name }) => {
      try {
        const projectFilter = escapeForJxa(project_id_or_name.trim());
        const script = `
const projectFilter = ${projectFilter};
const project = document.flattenedProjects.find(item => {
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
});
if (!project) {
  throw new Error(\`Project not found: \${projectFilter}\`);
}
if (!project.completed) {
  throw new Error(\`Project is not completed: \${projectFilter}\`);
}

project.markIncomplete();

return {
  id: project.id.primaryKey,
  name: project.name,
  status: "active"
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "delete_project",
    "delete a project by id or name. IMPORTANT: this permanently removes the project and all its tasks from the database. never use delete+recreate to apply project changes; use update_project/move_project/set_project_status instead. before calling, show the user the project name and task count, and ask for explicit confirmation.",
    {
      project_id_or_name: z.string().min(1).describe("project id primaryKey or exact name"),
    },
    async ({ project_id_or_name }) => {
      try {
        const normalizedProjectFilter = project_id_or_name.trim();
        if (normalizedProjectFilter === "") {
          throw new Error("project_id_or_name must not be empty.");
        }
        const projectFilter = escapeForJxa(normalizedProjectFilter);
        const script = `
const projectFilter = ${projectFilter};
const project = document.flattenedProjects.find(item => {
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
});
if (!project) {
  throw new Error(\`Project not found: \${projectFilter}\`);
}

const projectId = project.id.primaryKey;
const projectName = project.name;
const taskCount = document.flattenedTasks.filter(task => {
  return task.containingProject && task.containingProject.id.primaryKey === projectId;
}).length;

deleteObject(project);

return {
  id: projectId,
  name: projectName,
  deleted: true,
  taskCount: taskCount
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "delete_projects_batch",
    "delete multiple projects by id or exact name in a single omnijs call. destructive operation: this permanently removes projects and their tasks. use update_project, move_project, or set_project_status for non-destructive changes. before calling this tool, always show the user the target project list and ask for explicit confirmation.",
    {
      project_ids_or_names: z.array(z.string()).min(1).describe("project ids or exact names to delete"),
    },
    async ({ project_ids_or_names }) => {
      try {
        if (project_ids_or_names.length === 0) {
          throw new Error("project_ids_or_names must contain at least one project id or name.");
        }
        const normalizedProjectIdsOrNames = project_ids_or_names.map((projectIdOrName) => {
          const normalizedProjectIdOrName = projectIdOrName.trim();
          if (normalizedProjectIdOrName === "") {
            throw new Error("each project id or name must be a non-empty string.");
          }
          return normalizedProjectIdOrName;
        });
        const seenProjectIdsOrNames = new Set<string>();
        for (const normalizedProjectIdOrName of normalizedProjectIdsOrNames) {
          if (seenProjectIdsOrNames.has(normalizedProjectIdOrName)) {
            throw new Error(
              `project_ids_or_names must not contain duplicates: ${normalizedProjectIdOrName}`
            );
          }
          seenProjectIdsOrNames.add(normalizedProjectIdOrName);
        }

        const projectIdsOrNamesValue = JSON.stringify(normalizedProjectIdsOrNames);
        const script = `
const projectIdsOrNames = ${projectIdsOrNamesValue};
const projects = document.flattenedProjects
  .map(item => {
    try {
      return {
        id: item.id.primaryKey,
        name: item.name,
        ref: item
      };
    } catch (e) {
      return null;
    }
  })
  .filter(item => item !== null);
const results = projectIdsOrNames.map(idOrName => {
  const project = projects.find(item => {
    return item.id === idOrName || item.name === idOrName;
  });
  if (project === undefined) {
    return {
      id_or_name: idOrName,
      id: null,
      name: null,
      deleted: false,
      error: "not found"
    };
  }

  const resolvedId = project.id;
  const resolvedName = project.name;
  try {
    deleteObject(project.ref);
    return {
      id_or_name: idOrName,
      id: resolvedId,
      name: resolvedName,
      deleted: true,
      error: null
    };
  } catch (e) {
    const errorMessage = e && e.message ? String(e.message) : String(e);
    return {
      id_or_name: idOrName,
      id: resolvedId,
      name: resolvedName,
      deleted: false,
      error: errorMessage
    };
  }
});

const deletedCount = results.filter(result => result.deleted).length;
const failedCount = results.length - deletedCount;

return {
  summary: {
    requested: results.length,
    deleted: deletedCount,
    failed: failedCount
  },
  partial_success: deletedCount > 0 && failedCount > 0,
  results: results
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "move_project",
    "move a project by id or name to a folder or top level.",
    {
      project_id_or_name: z.string().min(1).describe("project id primaryKey or exact name"),
      folder: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe("folder name to move into, or null for top level"),
    },
    async ({ project_id_or_name, folder }) => {
      try {
        const normalizedProjectFilter = project_id_or_name.trim();
        if (normalizedProjectFilter === "") {
          throw new Error("project_id_or_name must not be empty.");
        }
        if (folder !== undefined && folder !== null && folder.trim() === "") {
          throw new Error("folder must not be empty when provided.");
        }
        const projectFilter = escapeForJxa(normalizedProjectFilter);
        const folderName = folder === undefined || folder === null ? "null" : escapeForJxa(folder.trim());
        const script = `
const projectFilter = ${projectFilter};
const folderName = ${folderName};
const project = document.flattenedProjects.find(item => {
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
});
if (!project) {
  throw new Error(\`Project not found: \${projectFilter}\`);
}

const destination = (() => {
  if (folderName === null) return library.ending;
  const targetFolder = document.flattenedFolders.byName(folderName);
  if (!targetFolder) {
    throw new Error(\`Folder not found: \${folderName}\`);
  }
  return targetFolder.ending;
})();

moveSections([project], destination);

return {
  id: project.id.primaryKey,
  name: project.name,
  folderName: folderName
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "set_project_status",
    "set a project's organizational status by id or name. allowed values: active, on_hold, dropped. dropped means intentionally abandoned/cancelled (not completed); for finished/closed projects use complete_project. when presenting planned/finished changes to users, prefer business-meaning labels (project name, folder, current->target status) and include raw ids only as secondary references.",
    {
      project_id_or_name: z.string().min(1).describe("project id primaryKey or exact name"),
      status: z
        .enum(["active", "on_hold", "dropped"])
        .describe("target status: active | on_hold | dropped; use complete_project for done/completed"),
    },
    async ({ project_id_or_name, status }) => {
      try {
        if (!["active", "on_hold", "dropped"].includes(status)) {
          throw new Error("status must be one of: active, on_hold, dropped.");
        }
        const projectFilter = escapeForJxa(project_id_or_name.trim());
        const statusValue = escapeForJxa(status);
        const script = `
const projectFilter = ${projectFilter};
const statusValue = ${statusValue};
const project = document.flattenedProjects.find(item => {
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
});
if (!project) {
  throw new Error(\`Project not found: \${projectFilter}\`);
}
let targetStatus;
if (statusValue === "active") {
  targetStatus = Project.Status.Active;
} else if (statusValue === "on_hold") {
  targetStatus = Project.Status.OnHold;
} else if (statusValue === "dropped") {
  targetStatus = Project.Status.Dropped;
} else {
  throw new Error(\`Invalid status: \${statusValue}\`);
}
project.status = targetStatus;
return {
  id: project.id.primaryKey,
  name: project.name,
  status: statusValue
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "update_project",
    "update a project by id or name, modifying only provided fields.",
    {
      project_id_or_name: z.string().min(1).describe("project id primaryKey or exact name"),
      name: z.string().min(1).optional().describe("optional new project name"),
      note: z.string().optional().describe("optional project note"),
      dueDate: z.string().optional().describe("optional due date in iso 8601"),
      deferDate: z.string().optional().describe("optional defer date in iso 8601"),
      flagged: z.boolean().optional().describe("optional flagged setting"),
      tags: z.array(z.string().min(1)).optional().describe("optional full replacement tag list"),
      sequential: z.boolean().optional().describe("optional sequential setting"),
      completedByChildren: z.boolean().optional().describe("optional completed-by-children setting"),
      reviewInterval: z.string().min(1).optional().describe("optional review interval like '2 weeks'"),
    },
    async ({ project_id_or_name, ...rawUpdates }) => {
      try {
        const normalizedProjectFilter = project_id_or_name.trim();
        if (normalizedProjectFilter === "") {
          throw new Error("project_id_or_name must not be empty.");
        }
        if (rawUpdates.tags !== undefined && rawUpdates.tags.some((tag) => tag.trim() === "")) {
          throw new Error("tags must not contain empty values.");
        }
        if (rawUpdates.reviewInterval !== undefined && rawUpdates.reviewInterval.trim() === "") {
          throw new Error("reviewInterval must not be empty when provided.");
        }
        const updates = Object.fromEntries(
          Object.entries(rawUpdates).map(([key, value]) => {
            if (typeof value === "string") {
              return [key, value.trim()];
            }
            if (key === "tags" && Array.isArray(value)) {
              return [key, value.map((tag) => tag.trim())];
            }
            return [key, value];
          }).filter(([, value]) => value !== undefined)
        );
        const projectFilter = escapeForJxa(normalizedProjectFilter);
        const script = `
const projectFilter = ${projectFilter};
const updates = ${JSON.stringify(updates)};
const project = document.flattenedProjects.find(item => {
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
});
if (!project) {
  throw new Error(\`Project not found: \${projectFilter}\`);
}

const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);
const normalizeProjectStatus = (item) => {
  const rawStatus = String(item.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) {
    return "on_hold";
  }
  if (flattened.includes("completed")) return "completed";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
};
const parseReviewInterval = (value) => {
  const match = String(value).trim().match(/^(\\d+)\\s+([a-zA-Z_]+)$/);
  if (!match) {
    throw new Error(\`Invalid reviewInterval format: \${value}. Expected 'N unit'.\`);
  }
  const steps = Number(match[1]);
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(\`Invalid reviewInterval steps: \${match[1]}\`);
  }
  let unit = match[2].toLowerCase();
  if (unit.endsWith("s")) unit = unit.slice(0, -1);
  const allowed = new Set(["minute", "hour", "day", "week", "month", "year"]);
  if (!allowed.has(unit)) {
    throw new Error(\`Invalid reviewInterval unit: \${match[2]}\`);
  }
  return { steps, unit };
};

if (has("name")) project.name = updates.name;
if (has("note")) project.note = updates.note;
if (has("dueDate")) project.dueDate = new Date(updates.dueDate);
if (has("deferDate")) project.deferDate = new Date(updates.deferDate);
if (has("flagged")) project.flagged = updates.flagged;
if (has("sequential")) project.sequential = updates.sequential;
if (has("completedByChildren")) project.completedByChildren = updates.completedByChildren;
if (has("reviewInterval")) {
  project.reviewInterval = parseReviewInterval(updates.reviewInterval);
}
if (has("tags")) {
  const existingTags = project.tags.slice();
  existingTags.forEach(tag => {
    project.removeTag(tag);
  });
  updates.tags.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) project.addTag(tag);
  });
}

const allProjectTasks = document.flattenedTasks.filter(task => {
  return task.containingProject && task.containingProject.id.primaryKey === project.id.primaryKey;
});
const reviewIntervalValue = project.reviewInterval;
return {
  id: project.id.primaryKey,
  name: project.name,
  status: normalizeProjectStatus(project),
  folderName: project.folder ? project.folder.name : null,
  taskCount: allProjectTasks.length,
  remainingTaskCount: allProjectTasks.filter(task => !task.completed).length,
  deferDate: project.deferDate ? project.deferDate.toISOString() : null,
  dueDate: project.dueDate ? project.dueDate.toISOString() : null,
  note: project.note,
  flagged: project.flagged,
  sequential: project.sequential,
  completedByChildren: project.completedByChildren,
  tags: project.tags.map(tag => tag.name),
  reviewInterval: reviewIntervalValue === null || reviewIntervalValue === undefined ? null : String(reviewIntervalValue)
};
`.trim();
        const result = await runOmniJs(script);
        return textResult(result);
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

}
