import { z } from "zod";

import { escapeForJxa, runOmniJs } from "../jxa.js";
import { errorResult, normalizeError, textResult, type Server } from "../types.js";

export function register(server: Server): void {
  server.tool(
    "list_projects",
    "list projects with optional folder and status filters.",
    {
      folder: z.string().min(1).optional().describe("optional folder name filter"),
      status: z
        .enum(["active", "on_hold", "completed", "dropped"])
        .default("active")
        .describe("project status filter"),
      limit: z.number().int().min(1).default(100).describe("max number of projects to return"),
    },
    async ({ folder, status, limit }) => {
      try {
        const folderFilter = folder === undefined ? "null" : escapeForJxa(folder);
        const statusFilter = escapeForJxa(status);
        const script = `
const folderFilter = ${folderFilter};
const statusFilter = ${statusFilter};

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
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {
    return "on_hold";
  }
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
};

const projects = document.flattenedProjects
  .filter(project => {
    if (folderFilter !== null) {
      const folderName = project.folder ? project.folder.name : null;
      if (folderName !== folderFilter) return false;
    }
    return normalizeProjectStatus(project) === statusFilter;
  })
  .slice(0, ${limit});

return projects.map(project => {
  const projectId = project.id.primaryKey;
  const counts = projectCounts.get(projectId) || { taskCount: 0, remainingTaskCount: 0 };
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
    note: project.note,
    sequential: project.sequential,
    reviewInterval: reviewInterval === null || reviewInterval === undefined ? null : String(reviewInterval)
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
        const projectFilter = escapeForJxa(project_id_or_name.trim());
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
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {
    return "on_hold";
  }
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
};

const allProjectTasks = document.flattenedTasks.filter(task => {
  return task.containingProject && task.containingProject.id.primaryKey === project.id.primaryKey;
});

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
  deferDate: project.deferDate ? project.deferDate.toISOString() : null,
  dueDate: project.dueDate ? project.dueDate.toISOString() : null,
  note: project.note,
  sequential: project.sequential,
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
    "complete a project by id or name.",
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
    "reopen a completed project by id or name and return active status.",
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
    "set_project_status",
    "set a project's organizational status by id or name.",
    {
      project_id_or_name: z.string().min(1).describe("project id primaryKey or exact name"),
      status: z
        .enum(["active", "on_hold", "dropped"])
        .describe("target project status: active, on_hold, or dropped"),
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
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {
    return "on_hold";
  }
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
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
