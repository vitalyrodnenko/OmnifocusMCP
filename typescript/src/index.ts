import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { escapeForJxa, runOmniJs } from "./jxa.js";

const server = new McpServer({
  name: "omnifocus-mcp",
  version: "0.1.0",
});

function textResult(value: unknown): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function errorResult(message: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "Unknown OmniFocus error.";
}

server.tool(
  "get_inbox",
  "get inbox tasks from omnifocus. returns unprocessed inbox tasks with id, name, note, flagged state, due/defer dates, tag names, and estimated minutes.",
  {
    limit: z.number().int().min(1).default(100),
  },
  async ({ limit }) => {
    try {
      const script = `
const tasks = inbox
  .filter(task => !task.completed)
  .slice(0, ${limit});

return tasks.map(task => {
  const tags = task.tags.map(tag => tag.name);
  return {
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    tags: tags,
    estimatedMinutes: task.estimatedMinutes
  };
});
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "list_tasks",
  "list tasks with optional project, tag, flagged, and status filters. returns tasks with id, name, note, flagged state, due/defer dates, completion state, project name, tag names, and estimated minutes.",
  {
    project: z.string().min(1).optional(),
    tag: z.string().min(1).optional(),
    flagged: z.boolean().optional(),
    status: z.enum(["available", "due_soon", "overdue", "completed", "all"]).default("available"),
    limit: z.number().int().min(1).default(100),
  },
  async ({ project, tag, flagged, status, limit }) => {
    try {
      const projectFilter = project === undefined ? "null" : escapeForJxa(project);
      const tagFilter = tag === undefined ? "null" : escapeForJxa(tag);
      const flaggedFilter = flagged === undefined ? "null" : flagged ? "true" : "false";
      const statusFilter = escapeForJxa(status);
      const script = `
const projectFilter = ${projectFilter};
const tagFilter = ${tagFilter};
const flaggedFilter = ${flaggedFilter};
const statusFilter = ${statusFilter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

const tasks = document.flattenedTasks
  .filter(task => {
    if (projectFilter !== null) {
      const projectName = task.containingProject ? task.containingProject.name : null;
      if (projectName !== projectFilter) return false;
    }

    if (tagFilter !== null) {
      const hasTag = task.tags.some(taskTag => taskTag.name === tagFilter);
      if (!hasTag) return false;
    }

    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;

    if (statusFilter === "all") return true;
    if (statusFilter === "completed") return task.completed;
    if (task.completed) return false;

    const dueDate = task.dueDate;
    if (statusFilter === "available") return true;
    if (statusFilter === "overdue") return dueDate !== null && dueDate < now;
    if (statusFilter === "due_soon") {
      return dueDate !== null && dueDate >= now && dueDate <= soon;
    }
    return false;
  })
  .slice(0, ${limit});

return tasks.map(task => {
  const tags = task.tags.map(taskTag => taskTag.name);
  return {
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    completed: task.completed,
    projectName: task.containingProject ? task.containingProject.name : null,
    tags: tags,
    estimatedMinutes: task.estimatedMinutes
  };
});
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "get_task",
  "get full details for a single task by id. returns list_tasks fields plus children, parent name, sequential state, repetition rule, and completion date.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const taskIdFilter = escapeForJxa(task_id);
      const script = `
const taskId = ${taskIdFilter};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const children = task.children.map(child => {
  return {
    id: child.id.primaryKey,
    name: child.name,
    completed: child.completed
  };
});

const repetitionRule = task.repetitionRule ? String(task.repetitionRule) : null;

return {
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  completionDate: task.completionDate ? task.completionDate.toISOString() : null,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes,
  children: children,
  parentName: task.parent ? task.parent.name : null,
  sequential: task.sequential,
  repetitionRule: repetitionRule
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "search_tasks",
  "search task names and notes with case-insensitive matching. returns matching tasks with the standard list_tasks fields.",
  {
    query: z.string().min(1),
    limit: z.number().int().min(1).default(100),
  },
  async ({ query, limit }) => {
    try {
      const queryFilter = escapeForJxa(query.trim());
      const script = `
const query = ${queryFilter}.toLowerCase();

const tasks = document.flattenedTasks
  .filter(task => {
    const name = (task.name || "").toLowerCase();
    const note = (task.note || "").toLowerCase();
    return name.includes(query) || note.includes(query);
  })
  .slice(0, ${limit});

return tasks.map(task => {
  const tags = task.tags.map(taskTag => taskTag.name);
  return {
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    completed: task.completed,
    projectName: task.containingProject ? task.containingProject.name : null,
    tags: tags,
    estimatedMinutes: task.estimatedMinutes
  };
});
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "list_projects",
  "list projects with optional folder and status filters. returns projects with id, name, status, folder name, task counts, defer/due dates, note, sequential state, and review interval.",
  {
    folder: z.string().min(1).optional(),
    status: z.enum(["active", "on_hold", "completed", "dropped"]).default("active"),
    limit: z.number().int().min(1).default(100),
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
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "get_project",
  "get full details for a single project by id or name. returns project metadata plus root-level tasks for planning and review.",
  {
    project_id_or_name: z.string().min(1),
  },
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
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "list_tags",
  "list tags with hierarchy, task availability counts, and status. returns tag id, name, parent tag name, available task count, and status.",
  {
    limit: z.number().int().min(1).default(100),
  },
  async ({ limit }) => {
    try {
      const script = `
const tagCounts = new Map();
document.flattenedTasks.forEach(task => {
  if (task.completed) return;
  task.tags.forEach(tag => {
    const tagId = tag.id.primaryKey;
    const current = tagCounts.get(tagId) || 0;
    tagCounts.set(tagId, current + 1);
  });
});

const normalizeTagStatus = (tag) => {
  const rawStatus = String(tag.status || "").toLowerCase().trim();
  if (rawStatus === "") return "active";
  return rawStatus.replace(/\\s+/g, "_");
};

const tags = document.flattenedTags.slice(0, ${limit});
return tags.map(tag => {
  return {
    id: tag.id.primaryKey,
    name: tag.name,
    parent: tag.parent ? tag.parent.name : null,
    availableTaskCount: tagCounts.get(tag.id.primaryKey) || 0,
    status: normalizeTagStatus(tag)
  };
});
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "list_folders",
  "list folder hierarchy and project counts. returns folder id, name, parent folder name, and contained project count.",
  {
    limit: z.number().int().min(1).default(100),
  },
  async ({ limit }) => {
    try {
      const script = `
const folderProjectCounts = new Map();
document.flattenedProjects.forEach(project => {
  const folder = project.folder;
  if (!folder) return;
  const folderId = folder.id.primaryKey;
  const current = folderProjectCounts.get(folderId) || 0;
  folderProjectCounts.set(folderId, current + 1);
});

const folders = document.flattenedFolders.slice(0, ${limit});
return folders.map(folder => {
  return {
    id: folder.id.primaryKey,
    name: folder.name,
    parentName: folder.parent ? folder.parent.name : null,
    projectCount: folderProjectCounts.get(folder.id.primaryKey) || 0
  };
});
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "get_forecast",
  "get forecast sections for overdue, due today, and flagged tasks. returns an object with grouped sections: overdue, dueToday, and flagged.",
  {
    limit: z.number().int().min(1).default(100),
  },
  async ({ limit }) => {
    try {
      const script = `
const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endOfToday = new Date(startOfToday.getTime() + (24 * 60 * 60 * 1000));

const toTaskSummary = (task) => {
  return {
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    completed: task.completed,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    projectName: task.containingProject ? task.containingProject.name : null,
    tags: task.tags.map(tag => tag.name),
    estimatedMinutes: task.estimatedMinutes
  };
};

const openTasks = document.flattenedTasks.filter(task => !task.completed);

const overdue = openTasks
  .filter(task => task.dueDate !== null && task.dueDate < startOfToday)
  .slice(0, ${limit})
  .map(toTaskSummary);

const dueToday = openTasks
  .filter(task => task.dueDate !== null && task.dueDate >= startOfToday && task.dueDate < endOfToday)
  .slice(0, ${limit})
  .map(toTaskSummary);

const flagged = openTasks
  .filter(task => task.flagged)
  .slice(0, ${limit})
  .map(toTaskSummary);

return {
  overdue: overdue,
  dueToday: dueToday,
  flagged: flagged
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "list_perspectives",
  "list available perspectives including built-in and custom ones. returns perspective objects with id and name.",
  {
    limit: z.number().int().min(1).default(100),
  },
  async ({ limit }) => {
    try {
      const script = `
const getPerspectiveId = (perspective) => {
  if (perspective.id && perspective.id.primaryKey) return perspective.id.primaryKey;
  if (perspective.identifier) return String(perspective.identifier);
  if (perspective.name) return String(perspective.name);
  return "unknown";
};

const normalizePerspective = (perspective) => {
  return {
    id: getPerspectiveId(perspective),
    name: perspective.name || ""
  };
};

const collected = [];

if (typeof Perspective !== "undefined" && Perspective.BuiltIn && Perspective.BuiltIn.all) {
  Perspective.BuiltIn.all.forEach(perspective => {
    collected.push(normalizePerspective(perspective));
  });
}

if (document.perspectives) {
  document.perspectives.forEach(perspective => {
    collected.push(normalizePerspective(perspective));
  });
}

const unique = [];
const seen = new Set();
collected.forEach(perspective => {
  if (seen.has(perspective.id)) return;
  seen.add(perspective.id);
  unique.push(perspective);
});

return unique.slice(0, ${limit});
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
