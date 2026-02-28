#!/usr/bin/env node

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

type TaskStatus = "available" | "due_soon" | "overdue" | "completed" | "all";

async function fetchInboxData(limit: number): Promise<unknown> {
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
  return runOmniJs(script);
}

async function fetchTasksData(params: {
  project?: string;
  flagged?: boolean;
  status: TaskStatus;
  limit: number;
}): Promise<unknown> {
  const projectFilter = params.project === undefined ? "null" : escapeForJxa(params.project);
  const flaggedFilter = params.flagged === undefined ? "null" : params.flagged ? "true" : "false";
  const statusFilter = escapeForJxa(params.status);
  const script = `
const projectFilter = ${projectFilter};
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
  .slice(0, ${params.limit});

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
  return runOmniJs(script);
}

async function fetchProjectsData(limit: number): Promise<unknown> {
  const statusFilter = escapeForJxa("active");
  const script = `
const statusFilter = ${statusFilter};

const projects = document.flattenedProjects
  .filter(project => {
    const status = project.status === Project.Status.Active ? "active"
      : project.status === Project.Status.OnHold ? "on_hold"
      : project.status === Project.Status.Done ? "completed"
      : "dropped";
    return status === statusFilter;
  })
  .slice(0, ${limit});

return projects.map(project => {
  const allTasks = project.flattenedTasks;
  const remainingTaskCount = allTasks.filter(task => !task.completed).length;
  return {
    id: project.id.primaryKey,
    name: project.name,
    status: project.status === Project.Status.Active ? "active"
      : project.status === Project.Status.OnHold ? "on_hold"
      : project.status === Project.Status.Done ? "completed"
      : "dropped",
    folderName: project.folder ? project.folder.name : null,
    taskCount: allTasks.length,
    remainingTaskCount: remainingTaskCount,
    deferDate: project.deferDate ? project.deferDate.toISOString() : null,
    dueDate: project.dueDate ? project.dueDate.toISOString() : null,
    note: project.note,
    sequential: project.sequential,
    reviewInterval: project.reviewInterval ? String(project.reviewInterval) : null
  };
});
`.trim();
  return runOmniJs(script);
}

async function fetchProjectData(projectIdOrName: string): Promise<unknown> {
  const projectFilter = escapeForJxa(projectIdOrName);
  const script = `
const projectFilter = ${projectFilter};
const project = document.flattenedProjects.find(item => {
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
});
if (!project) {
  throw new Error(\`Project not found: \${projectFilter}\`);
}

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
    estimatedMinutes: task.estimatedMinutes,
    hasChildren: task.hasChildren
  };
});

const allTasks = project.flattenedTasks;
const remainingTaskCount = allTasks.filter(task => !task.completed).length;

return {
  id: project.id.primaryKey,
  name: project.name,
  status: project.status === Project.Status.Active ? "active"
    : project.status === Project.Status.OnHold ? "on_hold"
    : project.status === Project.Status.Done ? "completed"
    : "dropped",
  folderName: project.folder ? project.folder.name : null,
  note: project.note,
  dueDate: project.dueDate ? project.dueDate.toISOString() : null,
  deferDate: project.deferDate ? project.deferDate.toISOString() : null,
  sequential: project.sequential,
  reviewInterval: project.reviewInterval ? String(project.reviewInterval) : null,
  taskCount: allTasks.length,
  remainingTaskCount: remainingTaskCount,
  rootTasks: rootTasks
};
`.trim();
  return runOmniJs(script);
}

async function fetchForecastData(limit: number): Promise<unknown> {
  const script = `
const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const openTasks = document.flattenedTasks.filter(task => !task.completed);

const toTaskPayload = task => ({
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes
});

const overdue = openTasks
  .filter(task => task.dueDate !== null && task.dueDate < startOfToday)
  .slice(0, ${limit})
  .map(toTaskPayload);

const dueToday = openTasks
  .filter(task => task.dueDate !== null && task.dueDate >= startOfToday && task.dueDate < endOfToday)
  .slice(0, ${limit})
  .map(toTaskPayload);

const flagged = openTasks
  .filter(task => task.flagged)
  .slice(0, ${limit})
  .map(toTaskPayload);

return {
  overdue: overdue,
  dueToday: dueToday,
  flagged: flagged
};
`.trim();
  return runOmniJs(script);
}

function jsonResourceResult(uri: string, value: unknown): { contents: [{ uri: string; mimeType: string; text: string }] } {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value),
      },
    ],
  };
}

async function getInboxData(limit: number): Promise<unknown> {
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
  return runOmniJs(script);
}

async function listTasksData(
  project: string | undefined,
  tag: string | undefined,
  flagged: boolean | undefined,
  status: "available" | "due_soon" | "overdue" | "completed" | "all",
  limit: number
): Promise<unknown> {
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
  return runOmniJs(script);
}

async function listProjectsData(
  folder: string | undefined,
  status: "active" | "on_hold" | "completed" | "dropped",
  limit: number
): Promise<unknown> {
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
  return runOmniJs(script);
}

async function getProjectData(projectIdOrName: string): Promise<unknown> {
  const projectFilter = escapeForJxa(projectIdOrName.trim());
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
  return runOmniJs(script);
}

async function getForecastData(limit: number): Promise<unknown> {
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
  return runOmniJs(script);
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

server.registerResource(
  "omnifocus_inbox",
  "omnifocus://inbox",
  {
    description: "current inbox tasks as json",
    mimeType: "application/json",
  },
  async () => {
    const data = await getInboxData(100);
    return jsonResourceResult("omnifocus://inbox", data);
  }
);

server.registerResource(
  "omnifocus_today",
  "omnifocus://today",
  {
    description: "today forecast sections as json",
    mimeType: "application/json",
  },
  async () => {
    const data = await getForecastData(100);
    return jsonResourceResult("omnifocus://today", data);
  }
);

server.registerResource(
  "omnifocus_projects",
  "omnifocus://projects",
  {
    description: "active project summaries as json",
    mimeType: "application/json",
  },
  async () => {
    const data = await listProjectsData(undefined, "active", 100);
    return jsonResourceResult("omnifocus://projects", data);
  }
);

server.registerPrompt(
  "daily_review",
  {
    description: "daily planning prompt with due-soon, overdue, and flagged tasks",
  },
  async () => {
    const dueSoon = await listTasksData(undefined, undefined, undefined, "due_soon", 25);
    const overdue = await listTasksData(undefined, undefined, undefined, "overdue", 25);
    const flagged = await listTasksData(undefined, undefined, true, "all", 25);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a focused daily review using the task data below.

1) identify the highest-risk overdue items.
2) review due-soon tasks and sequence today's execution.
3) evaluate flagged work and confirm urgency.
4) produce exactly three top priorities for today with short rationale.
5) call out anything that should be deferred, delegated, or dropped.

overdue_tasks_json:
${JSON.stringify(overdue)}

due_soon_tasks_json:
${JSON.stringify(dueSoon)}

flagged_tasks_json:
${JSON.stringify(flagged)}
`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "weekly_review",
  {
    description: "weekly review prompt with active projects and next-action coverage",
  },
  async () => {
    const activeProjects = await listProjectsData(undefined, "active", 500);
    const availableTasks = await listTasksData(undefined, undefined, undefined, "available", 1000);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a gtd-style weekly review using the data below.

1) review all active projects and classify each as:
   - on track
   - at risk
   - stalled (no clear next action)
2) identify stalled projects by checking whether each project has at least one available next action.
3) propose the next concrete action for every stalled project.
4) highlight projects that need defer/due date updates or scope adjustments.
5) produce a concise weekly plan:
   - top 5 project priorities
   - key risks/blockers
   - cleanup actions (drop, defer, delegate, or someday/maybe)

active_projects_json:
${JSON.stringify(activeProjects)}

available_tasks_json:
${JSON.stringify(availableTasks)}
`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "inbox_processing",
  {
    description: "inbox processing prompt that drives one-by-one clarification decisions",
  },
  async () => {
    const inboxItems = await getInboxData(200);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a gtd inbox processing session using the inbox data below.

for each inbox item, guide a decision in this order:
1) clarify desired outcome and next action.
2) decide if it should be deleted, deferred, delegated, or kept.
3) if kept, assign the best target project (or keep in inbox if truly unassigned).
4) propose relevant tags and whether it should be flagged.
5) suggest due/defer dates only when there is a real deadline or start date.
6) suggest estimated minutes when the task is actionable.

respond with:
- a prioritized processing queue
- concrete update recommendations per item
- a short batch action plan for the first 5 items

inbox_items_json:
${JSON.stringify(inboxItems)}
`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "project_planning",
  {
    description: "project planning prompt that turns a project into actionable next steps",
    argsSchema: {
      project: z.string().min(1),
    },
  },
  async ({ project }) => {
    const projectName = project.trim();
    const projectDetails = await getProjectData(projectName);
    const availableTasks = await listTasksData(projectName, undefined, undefined, "available", 500);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `plan this project into clear executable work.

project name:
${projectName}

planning goals:
1) summarize the project outcome in one concise sentence.
2) evaluate current task coverage and identify missing steps.
3) convert vague items into concrete next actions (verb-first, observable).
4) sequence work logically (dependencies first, then parallelizable actions).
5) estimate effort (minutes/hours) for each next action and flag high-risk items.
6) recommend what to do now, next, later, and what to defer/drop.

output format:
- project summary
- work breakdown with columns:
  action, estimate, priority, dependency, suggested tags, due/defer recommendation, rationale
- first 3 actions to execute immediately
- risk/blocker list with mitigation ideas

project_details_json:
${JSON.stringify(projectDetails)}

project_available_tasks_json:
${JSON.stringify(availableTasks)}
`,
          },
        },
      ],
    };
  }
);

server.tool(
  "create_task",
  "create a new task in inbox or a named project. accepts required name and optional project, note, dates, flagged state, tags, and estimated minutes. returns the created task id and name.",
  {
    name: z.string().min(1),
    project: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    flagged: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  },
  async ({ name, project, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
    try {
      const taskName = escapeForJxa(name.trim());
      const projectName = project === undefined ? "null" : escapeForJxa(project.trim());
      const noteValue = note === undefined ? "null" : escapeForJxa(note);
      const dueDateValue = dueDate === undefined ? "null" : escapeForJxa(dueDate);
      const deferDateValue = deferDate === undefined ? "null" : escapeForJxa(deferDate);
      const flaggedValue = flagged === undefined ? "null" : flagged ? "true" : "false";
      const tagsValue = tags === undefined ? "null" : JSON.stringify(tags);
      const estimatedMinutesValue =
        estimatedMinutes === undefined ? "null" : String(estimatedMinutes);
      const script = `
const taskName = ${taskName};
const projectName = ${projectName};
const noteValue = ${noteValue};
const dueDateValue = ${dueDateValue};
const deferDateValue = ${deferDateValue};
const flaggedValue = ${flaggedValue};
const tagNames = ${tagsValue};
const estimatedMinutesValue = ${estimatedMinutesValue};

const parent = (() => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
})();

const task = new Task(taskName, parent);

if (noteValue !== null) task.note = noteValue;
if (dueDateValue !== null) task.dueDate = new Date(dueDateValue);
if (deferDateValue !== null) task.deferDate = new Date(deferDateValue);
if (flaggedValue !== null) task.flagged = flaggedValue;
if (estimatedMinutesValue !== null) task.estimatedMinutes = estimatedMinutesValue;

if (tagNames !== null) {
  tagNames.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}

return {
  id: task.id.primaryKey,
  name: task.name
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_tasks_batch",
  "create multiple tasks in a single omnijs call for efficiency. accepts an array of task definitions using create_task fields and returns an array of created task summaries with id and name.",
  {
    tasks: z.array(
      z.object({
        name: z.string().min(1),
        project: z.string().optional(),
        note: z.string().optional(),
        dueDate: z.string().optional(),
        deferDate: z.string().optional(),
        flagged: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        estimatedMinutes: z.number().int().optional(),
      })
    ).min(1),
  },
  async ({ tasks }) => {
    try {
      const normalizedTasks = tasks.map((task) => ({
        name: task.name.trim(),
        project: task.project === undefined ? null : task.project.trim(),
        note: task.note === undefined ? null : task.note,
        dueDate: task.dueDate === undefined ? null : task.dueDate,
        deferDate: task.deferDate === undefined ? null : task.deferDate,
        flagged: task.flagged === undefined ? null : task.flagged,
        tags: task.tags === undefined ? null : task.tags,
        estimatedMinutes: task.estimatedMinutes === undefined ? null : task.estimatedMinutes,
      }));
      const tasksValue = JSON.stringify(normalizedTasks);
      const script = `
const taskInputs = ${tasksValue};

const resolveParent = (projectName) => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
};

const created = taskInputs.map(input => {
  const parent = resolveParent(input.project);
  const task = new Task(input.name, parent);

  if (input.note !== null && input.note !== undefined) task.note = input.note;
  if (input.dueDate !== null && input.dueDate !== undefined) task.dueDate = new Date(input.dueDate);
  if (input.deferDate !== null && input.deferDate !== undefined) task.deferDate = new Date(input.deferDate);
  if (input.flagged !== null && input.flagged !== undefined) task.flagged = input.flagged;
  if (input.estimatedMinutes !== null && input.estimatedMinutes !== undefined) {
    task.estimatedMinutes = input.estimatedMinutes;
  }

  if (input.tags !== null && input.tags !== undefined) {
    input.tags.forEach(tagName => {
      const tag = document.flattenedTags.byName(tagName);
      if (tag) task.addTag(tag);
    });
  }

  return {
    id: task.id.primaryKey,
    name: task.name
  };
});

return created;
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "complete_task",
  "complete a task by id and return completion confirmation. marks the task complete and returns the completed task id and name.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const taskIdValue = escapeForJxa(task_id.trim());
      const script = `
const taskId = ${taskIdValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

task.markComplete();

return {
  id: task.id.primaryKey,
  name: task.name,
  completed: task.completed
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "update_task",
  "update a task by id, modifying only provided fields. accepts optional updates for name, note, dates, flagged state, tags, and estimated minutes. returns the updated task fields.",
  {
    task_id: z.string().min(1),
    name: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    flagged: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  },
  async ({ task_id, name, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
    try {
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name.trim();
      if (note !== undefined) updates.note = note;
      if (dueDate !== undefined) updates.dueDate = dueDate;
      if (deferDate !== undefined) updates.deferDate = deferDate;
      if (flagged !== undefined) updates.flagged = flagged;
      if (tags !== undefined) updates.tags = tags;
      if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;
      const taskIdValue = escapeForJxa(task_id.trim());
      const updatesValue = JSON.stringify(updates);
      const script = `
const taskId = ${taskIdValue};
const updates = ${updatesValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);

if (has("name")) task.name = updates.name;
if (has("note")) task.note = updates.note;
if (has("dueDate")) task.dueDate = new Date(updates.dueDate);
if (has("deferDate")) task.deferDate = new Date(updates.deferDate);
if (has("flagged")) task.flagged = updates.flagged;
if (has("estimatedMinutes")) task.estimatedMinutes = updates.estimatedMinutes;

if (has("tags")) {
  const existingTags = task.tags.slice();
  existingTags.forEach(tag => {
    task.removeTag(tag);
  });
  updates.tags.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}

return {
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "delete_task",
  "delete a task by id and return a confirmation payload. if the task has children, the response includes a warning message.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const taskIdValue = escapeForJxa(task_id.trim());
      const script = `
const taskId = ${taskIdValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const taskName = task.name;
const childCount = task.children.length;
const warning = childCount > 0
  ? \`Deleted task had \${childCount} child task(s).\`
  : null;

task.drop(false);

return {
  id: taskId,
  name: taskName,
  deleted: true,
  warning: warning
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "move_task",
  "move a task to a named project or back to inbox. accepts a task id and optional project name. when project is omitted, the task is moved to inbox.",
  {
    task_id: z.string().min(1),
    project: z.string().min(1).optional(),
  },
  async ({ task_id, project }) => {
    try {
      const taskIdValue = escapeForJxa(task_id.trim());
      const projectValue = project === undefined ? "null" : escapeForJxa(project.trim());
      const script = `
const taskId = ${taskIdValue};
const projectName = ${projectValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const destination = (() => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
})();

task.move(destination);

return {
  id: task.id.primaryKey,
  name: task.name,
  projectName: task.containingProject ? task.containingProject.name : null,
  inInbox: task.inInbox
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_project",
  "create a new project with optional folder and metadata. accepts required name and optional folder, note, dates, and sequential setting. returns the created project id.",
  {
    name: z.string().min(1),
    folder: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    sequential: z.boolean().optional(),
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
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "complete_project",
  "complete a project by id or name and return confirmation.",
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

project.markComplete();

return {
  id: project.id.primaryKey,
  name: project.name,
  completed: true
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_tag",
  "create a tag with optional parent tag nesting and return its id.",
  {
    name: z.string().min(1),
    parent: z.string().min(1).optional(),
  },
  async ({ name, parent }) => {
    try {
      const tagName = escapeForJxa(name.trim());
      const parentName = parent === undefined ? "null" : escapeForJxa(parent.trim());
      const script = `
const tagName = ${tagName};
const parentName = ${parentName};

const tag = (() => {
  if (parentName === null) return new Tag(tagName);
  const parentTag = document.flattenedTags.byName(parentName);
  if (!parentTag) {
    throw new Error(\`Tag not found: \${parentName}\`);
  }
  return new Tag(tagName, parentTag.ending);
})();

return {
  id: tag.id.primaryKey
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_task",
  "create a new task in inbox or a named project. accepts required name and optional project, note, dates, flagged state, tags, and estimated minutes. returns the created task id and name.",
  {
    name: z.string().min(1),
    project: z.string().optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    flagged: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  },
  async ({ name, project, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
    try {
      const trimmedName = name.trim();
      if (trimmedName === "") {
        throw new Error("name must not be empty.");
      }
      if (project !== undefined && project.trim() === "") {
        throw new Error("project must not be empty when provided.");
      }

      const taskName = escapeForJxa(trimmedName);
      const projectName = project === undefined ? "null" : escapeForJxa(project.trim());
      const noteValue = note === undefined ? "null" : escapeForJxa(note);
      const dueDateValue = dueDate === undefined ? "null" : escapeForJxa(dueDate);
      const deferDateValue = deferDate === undefined ? "null" : escapeForJxa(deferDate);
      const flaggedValue = flagged === undefined ? "null" : flagged ? "true" : "false";
      const tagsValue = tags === undefined ? "null" : JSON.stringify(tags);
      const estimatedMinutesValue =
        estimatedMinutes === undefined ? "null" : String(estimatedMinutes);

      const script = `
const taskName = ${taskName};
const projectName = ${projectName};
const noteValue = ${noteValue};
const dueDateValue = ${dueDateValue};
const deferDateValue = ${deferDateValue};
const flaggedValue = ${flaggedValue};
const tagNames = ${tagsValue};
const estimatedMinutesValue = ${estimatedMinutesValue};

const parent = (() => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
})();

const task = new Task(taskName, parent);

if (noteValue !== null) task.note = noteValue;
if (dueDateValue !== null) task.dueDate = new Date(dueDateValue);
if (deferDateValue !== null) task.deferDate = new Date(deferDateValue);
if (flaggedValue !== null) task.flagged = flaggedValue;
if (estimatedMinutesValue !== null) task.estimatedMinutes = estimatedMinutesValue;

if (tagNames !== null) {
  tagNames.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}

return {
  id: task.id.primaryKey,
  name: task.name
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_tasks_batch",
  "create multiple tasks in a single omnijs call for efficiency. accepts an array of task definitions using create_task fields and returns an array of created task summaries with id and name.",
  {
    tasks: z.array(
      z.object({
        name: z.string().min(1),
        project: z.string().optional(),
        note: z.string().optional(),
        dueDate: z.string().optional(),
        deferDate: z.string().optional(),
        flagged: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        estimatedMinutes: z.number().int().optional(),
      })
    ),
  },
  async ({ tasks }) => {
    try {
      if (tasks.length === 0) {
        throw new Error("tasks must contain at least one task definition.");
      }

      const normalizedTasks = tasks.map((task) => {
        const trimmedName = task.name.trim();
        if (trimmedName === "") {
          throw new Error("each task must include a non-empty name.");
        }
        if (task.project !== undefined && task.project.trim() === "") {
          throw new Error("task project must be a string when provided.");
        }
        return {
          name: trimmedName,
          project: task.project === undefined ? null : task.project.trim(),
          note: task.note ?? null,
          dueDate: task.dueDate ?? null,
          deferDate: task.deferDate ?? null,
          flagged: task.flagged ?? null,
          tags: task.tags ?? null,
          estimatedMinutes: task.estimatedMinutes ?? null,
        };
      });

      const script = `
const taskInputs = ${JSON.stringify(normalizedTasks)};

const resolveParent = (projectName) => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
};

const created = taskInputs.map(input => {
  const parent = resolveParent(input.project);
  const task = new Task(input.name, parent);

  if (input.note !== null && input.note !== undefined) task.note = input.note;
  if (input.dueDate !== null && input.dueDate !== undefined) task.dueDate = new Date(input.dueDate);
  if (input.deferDate !== null && input.deferDate !== undefined) task.deferDate = new Date(input.deferDate);
  if (input.flagged !== null && input.flagged !== undefined) task.flagged = input.flagged;
  if (input.estimatedMinutes !== null && input.estimatedMinutes !== undefined) {
    task.estimatedMinutes = input.estimatedMinutes;
  }

  if (input.tags !== null && input.tags !== undefined) {
    input.tags.forEach(tagName => {
      const tag = document.flattenedTags.byName(tagName);
      if (tag) task.addTag(tag);
    });
  }

  return {
    id: task.id.primaryKey,
    name: task.name
  };
});

return created;
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "complete_task",
  "complete a task by id and return completion confirmation. marks the task complete and returns the completed task id and name.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const trimmedTaskId = task_id.trim();
      if (trimmedTaskId === "") {
        throw new Error("task_id must not be empty.");
      }
      const taskIdValue = escapeForJxa(trimmedTaskId);
      const script = `
const taskId = ${taskIdValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

task.markComplete();

return {
  id: task.id.primaryKey,
  name: task.name,
  completed: task.completed
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "update_task",
  "update a task by id, modifying only provided fields. accepts optional updates for name, note, dates, flagged state, tags, and estimated minutes. returns the updated task fields.",
  {
    task_id: z.string().min(1),
    name: z.string().optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    flagged: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  },
  async ({ task_id, name, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
    try {
      const trimmedTaskId = task_id.trim();
      if (trimmedTaskId === "") {
        throw new Error("task_id must not be empty.");
      }
      if (name !== undefined && name.trim() === "") {
        throw new Error("name must not be empty when provided.");
      }

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name.trim();
      if (note !== undefined) updates.note = note;
      if (dueDate !== undefined) updates.dueDate = dueDate;
      if (deferDate !== undefined) updates.deferDate = deferDate;
      if (flagged !== undefined) updates.flagged = flagged;
      if (tags !== undefined) updates.tags = tags;
      if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;

      const script = `
const taskId = ${escapeForJxa(trimmedTaskId)};
const updates = ${JSON.stringify(updates)};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);

if (has("name")) task.name = updates.name;
if (has("note")) task.note = updates.note;
if (has("dueDate")) task.dueDate = new Date(updates.dueDate);
if (has("deferDate")) task.deferDate = new Date(updates.deferDate);
if (has("flagged")) task.flagged = updates.flagged;
if (has("estimatedMinutes")) task.estimatedMinutes = updates.estimatedMinutes;

if (has("tags")) {
  const existingTags = task.tags.slice();
  existingTags.forEach(tag => {
    task.removeTag(tag);
  });
  updates.tags.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}

return {
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "delete_task",
  "delete a task by id and return a confirmation payload. if the task has children, the response includes a warning message.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const trimmedTaskId = task_id.trim();
      if (trimmedTaskId === "") {
        throw new Error("task_id must not be empty.");
      }

      const script = `
const taskId = ${escapeForJxa(trimmedTaskId)};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const taskName = task.name;
const childCount = task.children.length;
const warning = childCount > 0
  ? \`Deleted task had \${childCount} child task(s).\`
  : null;

task.drop(false);

return {
  id: taskId,
  name: taskName,
  deleted: true,
  warning: warning
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "move_task",
  "move a task to a named project or back to inbox. accepts a task id and optional project name.",
  {
    task_id: z.string().min(1),
    project: z.string().optional(),
  },
  async ({ task_id, project }) => {
    try {
      const trimmedTaskId = task_id.trim();
      if (trimmedTaskId === "") {
        throw new Error("task_id must not be empty.");
      }
      if (project !== undefined && project.trim() === "") {
        throw new Error("project must not be empty when provided.");
      }
      const projectValue = project === undefined ? "null" : escapeForJxa(project.trim());
      const script = `
const taskId = ${escapeForJxa(trimmedTaskId)};
const projectName = ${projectValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const destination = (() => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
})();

task.move(destination);

return {
  id: task.id.primaryKey,
  name: task.name,
  projectName: task.containingProject ? task.containingProject.name : null,
  inInbox: task.inInbox
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_project",
  "create a new project with optional folder and metadata. accepts required name and optional folder, note, dates, and sequential setting. returns the created project id.",
  {
    name: z.string().min(1),
    folder: z.string().optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    sequential: z.boolean().optional(),
  },
  async ({ name, folder, note, dueDate, deferDate, sequential }) => {
    try {
      const trimmedName = name.trim();
      if (trimmedName === "") {
        throw new Error("name must not be empty.");
      }
      if (folder !== undefined && folder.trim() === "") {
        throw new Error("folder must not be empty when provided.");
      }

      const projectName = escapeForJxa(trimmedName);
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
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "complete_project",
  "complete a project by id or name and return confirmation.",
  {
    project_id_or_name: z.string().min(1),
  },
  async ({ project_id_or_name }) => {
    try {
      const projectFilter = project_id_or_name.trim();
      if (projectFilter === "") {
        throw new Error("project_id_or_name must not be empty.");
      }
      const script = `
const projectFilter = ${escapeForJxa(projectFilter)};
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
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_tag",
  "create a tag with optional parent tag nesting and return its id.",
  {
    name: z.string().min(1),
    parent: z.string().optional(),
  },
  async ({ name, parent }) => {
    try {
      const trimmedName = name.trim();
      if (trimmedName === "") {
        throw new Error("name must not be empty.");
      }
      if (parent !== undefined && parent.trim() === "") {
        throw new Error("parent must not be empty when provided.");
      }
      const parentName = parent === undefined ? "null" : escapeForJxa(parent.trim());

      const script = `
const tagName = ${escapeForJxa(trimmedName)};
const parentName = ${parentName};

const tag = (() => {
  if (parentName === null) return new Tag(tagName);
  const parentTag = document.flattenedTags.byName(parentName);
  if (!parentTag) {
    throw new Error(\`Tag not found: \${parentName}\`);
  }
  return new Tag(tagName, parentTag.ending);
})();

return {
  id: tag.id.primaryKey
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_task",
  "create a new task in inbox or a named project. accepts required name and optional project, note, dates, flagged state, tags, and estimated minutes. returns the created task id and name.",
  {
    name: z.string().min(1),
    project: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    flagged: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  },
  async ({ name, project, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
    try {
      const taskName = escapeForJxa(name.trim());
      const projectName = project === undefined ? "null" : escapeForJxa(project.trim());
      const noteValue = note === undefined ? "null" : escapeForJxa(note);
      const dueDateValue = dueDate === undefined ? "null" : escapeForJxa(dueDate);
      const deferDateValue = deferDate === undefined ? "null" : escapeForJxa(deferDate);
      const flaggedValue = flagged === undefined ? "null" : flagged ? "true" : "false";
      const tagsValue = tags === undefined ? "null" : JSON.stringify(tags);
      const estimatedMinutesValue = estimatedMinutes === undefined ? "null" : String(estimatedMinutes);

      const script = `
const taskName = ${taskName};
const projectName = ${projectName};
const noteValue = ${noteValue};
const dueDateValue = ${dueDateValue};
const deferDateValue = ${deferDateValue};
const flaggedValue = ${flaggedValue};
const tagNames = ${tagsValue};
const estimatedMinutesValue = ${estimatedMinutesValue};

const parent = (() => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
})();

const task = new Task(taskName, parent);

if (noteValue !== null) task.note = noteValue;
if (dueDateValue !== null) task.dueDate = new Date(dueDateValue);
if (deferDateValue !== null) task.deferDate = new Date(deferDateValue);
if (flaggedValue !== null) task.flagged = flaggedValue;
if (estimatedMinutesValue !== null) task.estimatedMinutes = estimatedMinutesValue;

if (tagNames !== null) {
  tagNames.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}

return {
  id: task.id.primaryKey,
  name: task.name
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

const createTaskBatchItemSchema = z.object({
  name: z.string().min(1),
  project: z.string().optional(),
  note: z.string().optional(),
  dueDate: z.string().optional(),
  deferDate: z.string().optional(),
  flagged: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().optional(),
});

server.tool(
  "create_tasks_batch",
  "create multiple tasks in a single omnijs call for efficiency. accepts an array of task definitions using create_task fields and returns an array of created task summaries with id and name.",
  {
    tasks: z.array(createTaskBatchItemSchema).min(1),
  },
  async ({ tasks }) => {
    try {
      const normalizedTasks = tasks.map((task) => ({
        name: task.name.trim(),
        project: task.project === undefined ? null : task.project.trim(),
        note: task.note ?? null,
        dueDate: task.dueDate ?? null,
        deferDate: task.deferDate ?? null,
        flagged: task.flagged ?? null,
        tags: task.tags ?? null,
        estimatedMinutes: task.estimatedMinutes ?? null,
      }));
      const tasksValue = JSON.stringify(normalizedTasks);

      const script = `
const taskInputs = ${tasksValue};

const resolveParent = (projectName) => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
};

const created = taskInputs.map(input => {
  const parent = resolveParent(input.project);
  const task = new Task(input.name, parent);

  if (input.note !== null && input.note !== undefined) task.note = input.note;
  if (input.dueDate !== null && input.dueDate !== undefined) task.dueDate = new Date(input.dueDate);
  if (input.deferDate !== null && input.deferDate !== undefined) task.deferDate = new Date(input.deferDate);
  if (input.flagged !== null && input.flagged !== undefined) task.flagged = input.flagged;
  if (input.estimatedMinutes !== null && input.estimatedMinutes !== undefined) {
    task.estimatedMinutes = input.estimatedMinutes;
  }

  if (input.tags !== null && input.tags !== undefined) {
    input.tags.forEach(tagName => {
      const tag = document.flattenedTags.byName(tagName);
      if (tag) task.addTag(tag);
    });
  }

  return {
    id: task.id.primaryKey,
    name: task.name
  };
});

return created;
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "complete_task",
  "complete a task by id and return completion confirmation.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const taskIdValue = escapeForJxa(task_id.trim());
      const script = `
const taskId = ${taskIdValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

task.markComplete();

return {
  id: task.id.primaryKey,
  name: task.name,
  completed: task.completed
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "update_task",
  "update a task by id, modifying only provided fields. accepts optional updates for name, note, dates, flagged state, tags, and estimated minutes.",
  {
    task_id: z.string().min(1),
    name: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    flagged: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  },
  async ({ task_id, name, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
    try {
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name.trim();
      if (note !== undefined) updates.note = note;
      if (dueDate !== undefined) updates.dueDate = dueDate;
      if (deferDate !== undefined) updates.deferDate = deferDate;
      if (flagged !== undefined) updates.flagged = flagged;
      if (tags !== undefined) updates.tags = tags;
      if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;

      const taskIdValue = escapeForJxa(task_id.trim());
      const updatesValue = JSON.stringify(updates);
      const script = `
const taskId = ${taskIdValue};
const updates = ${updatesValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);

if (has("name")) task.name = updates.name;
if (has("note")) task.note = updates.note;
if (has("dueDate")) task.dueDate = new Date(updates.dueDate);
if (has("deferDate")) task.deferDate = new Date(updates.deferDate);
if (has("flagged")) task.flagged = updates.flagged;
if (has("estimatedMinutes")) task.estimatedMinutes = updates.estimatedMinutes;

if (has("tags")) {
  const existingTags = task.tags.slice();
  existingTags.forEach(tag => {
    task.removeTag(tag);
  });
  updates.tags.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}

return {
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "delete_task",
  "delete a task by id and return a confirmation payload. if the task has children, the response includes a warning message.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const taskIdValue = escapeForJxa(task_id.trim());
      const script = `
const taskId = ${taskIdValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const taskName = task.name;
const childCount = task.children.length;
const warning = childCount > 0
  ? \`Deleted task had \${childCount} child task(s).\`
  : null;

task.drop(false);

return {
  id: taskId,
  name: taskName,
  deleted: true,
  warning: warning
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "move_task",
  "move a task to a named project or back to inbox.",
  {
    task_id: z.string().min(1),
    project: z.string().min(1).optional(),
  },
  async ({ task_id, project }) => {
    try {
      const taskIdValue = escapeForJxa(task_id.trim());
      const projectValue = project === undefined ? "null" : escapeForJxa(project.trim());
      const script = `
const taskId = ${taskIdValue};
const projectName = ${projectValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const destination = (() => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
})();

task.move(destination);

return {
  id: task.id.primaryKey,
  name: task.name,
  projectName: task.containingProject ? task.containingProject.name : null,
  inInbox: task.inInbox
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_project",
  "create a new project with optional folder and metadata.",
  {
    name: z.string().min(1),
    folder: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    sequential: z.boolean().optional(),
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
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "complete_project",
  "complete a project by id or name and return confirmation.",
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

project.markComplete();

return {
  id: project.id.primaryKey,
  name: project.name,
  completed: true
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_tag",
  "create a tag with optional parent tag nesting and return its id.",
  {
    name: z.string().min(1),
    parent: z.string().min(1).optional(),
  },
  async ({ name, parent }) => {
    try {
      const tagName = escapeForJxa(name.trim());
      const parentName = parent === undefined ? "null" : escapeForJxa(parent.trim());
      const script = `
const tagName = ${tagName};
const parentName = ${parentName};

const tag = (() => {
  if (parentName === null) return new Tag(tagName);
  const parentTag = document.flattenedTags.byName(parentName);
  if (!parentTag) {
    throw new Error(\`Tag not found: \${parentName}\`);
  }
  return new Tag(tagName, parentTag.ending);
})();

return {
  id: tag.id.primaryKey
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_task",
  "create a new task in inbox or a named project. accepts required name and optional project, note, dates, flagged state, tags, and estimated minutes. returns the created task id and name.",
  {
    name: z.string().min(1),
    project: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    flagged: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  },
  async ({ name, project, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
    try {
      const taskName = escapeForJxa(name.trim());
      const projectName = project === undefined ? "null" : escapeForJxa(project.trim());
      const noteValue = note === undefined ? "null" : escapeForJxa(note);
      const dueDateValue = dueDate === undefined ? "null" : escapeForJxa(dueDate);
      const deferDateValue = deferDate === undefined ? "null" : escapeForJxa(deferDate);
      const flaggedValue = flagged === undefined ? "null" : flagged ? "true" : "false";
      const tagNames = tags === undefined ? "null" : JSON.stringify(tags);
      const estimatedMinutesValue = estimatedMinutes === undefined ? "null" : String(estimatedMinutes);
      const script = `
const taskName = ${taskName};
const projectName = ${projectName};
const noteValue = ${noteValue};
const dueDateValue = ${dueDateValue};
const deferDateValue = ${deferDateValue};
const flaggedValue = ${flaggedValue};
const tagNames = ${tagNames};
const estimatedMinutesValue = ${estimatedMinutesValue};

const parent = (() => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
})();

const task = new Task(taskName, parent);

if (noteValue !== null) task.note = noteValue;
if (dueDateValue !== null) task.dueDate = new Date(dueDateValue);
if (deferDateValue !== null) task.deferDate = new Date(deferDateValue);
if (flaggedValue !== null) task.flagged = flaggedValue;
if (estimatedMinutesValue !== null) task.estimatedMinutes = estimatedMinutesValue;

if (tagNames !== null) {
  tagNames.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}

return {
  id: task.id.primaryKey,
  name: task.name
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

const batchTaskSchema = z.object({
  name: z.string().min(1),
  project: z.string().optional(),
  note: z.string().optional(),
  dueDate: z.string().optional(),
  deferDate: z.string().optional(),
  flagged: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().optional(),
});

server.tool(
  "create_tasks_batch",
  "create multiple tasks in a single omnijs call for efficiency. accepts an array of task definitions using create_task fields and returns an array of created task summaries with id and name.",
  {
    tasks: z.array(batchTaskSchema).min(1),
  },
  async ({ tasks }) => {
    try {
      const normalizedTasks = tasks.map(task => {
        return {
          name: task.name.trim(),
          project: task.project === undefined ? null : task.project.trim(),
          note: task.note ?? null,
          dueDate: task.dueDate ?? null,
          deferDate: task.deferDate ?? null,
          flagged: task.flagged ?? null,
          tags: task.tags ?? null,
          estimatedMinutes: task.estimatedMinutes ?? null,
        };
      });

      const script = `
const taskInputs = ${JSON.stringify(normalizedTasks)};

const resolveParent = (projectName) => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
};

const created = taskInputs.map(input => {
  const parent = resolveParent(input.project);
  const task = new Task(input.name, parent);

  if (input.note !== null && input.note !== undefined) task.note = input.note;
  if (input.dueDate !== null && input.dueDate !== undefined) task.dueDate = new Date(input.dueDate);
  if (input.deferDate !== null && input.deferDate !== undefined) task.deferDate = new Date(input.deferDate);
  if (input.flagged !== null && input.flagged !== undefined) task.flagged = input.flagged;
  if (input.estimatedMinutes !== null && input.estimatedMinutes !== undefined) {
    task.estimatedMinutes = input.estimatedMinutes;
  }

  if (input.tags !== null && input.tags !== undefined) {
    input.tags.forEach(tagName => {
      const tag = document.flattenedTags.byName(tagName);
      if (tag) task.addTag(tag);
    });
  }

  return {
    id: task.id.primaryKey,
    name: task.name
  };
});

return created;
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "complete_task",
  "complete a task by id and return completion confirmation. marks the task complete and returns the completed task id and name.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const taskId = escapeForJxa(task_id.trim());
      const script = `
const taskId = ${taskId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

task.markComplete();

return {
  id: task.id.primaryKey,
  name: task.name,
  completed: task.completed
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "update_task",
  "update a task by id, modifying only provided fields. accepts optional updates for name, note, dates, flagged state, tags, and estimated minutes. returns the updated task fields.",
  {
    task_id: z.string().min(1),
    name: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    flagged: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  },
  async ({ task_id, name, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
    try {
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name.trim();
      if (note !== undefined) updates.note = note;
      if (dueDate !== undefined) updates.dueDate = dueDate;
      if (deferDate !== undefined) updates.deferDate = deferDate;
      if (flagged !== undefined) updates.flagged = flagged;
      if (tags !== undefined) updates.tags = tags;
      if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;

      const taskId = escapeForJxa(task_id.trim());
      const script = `
const taskId = ${taskId};
const updates = ${JSON.stringify(updates)};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);

if (has("name")) task.name = updates.name;
if (has("note")) task.note = updates.note;
if (has("dueDate")) task.dueDate = new Date(updates.dueDate);
if (has("deferDate")) task.deferDate = new Date(updates.deferDate);
if (has("flagged")) task.flagged = updates.flagged;
if (has("estimatedMinutes")) task.estimatedMinutes = updates.estimatedMinutes;

if (has("tags")) {
  const existingTags = task.tags.slice();
  existingTags.forEach(tag => {
    task.removeTag(tag);
  });
  updates.tags.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}

return {
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "delete_task",
  "delete a task by id and return a confirmation payload. if the task has children, the response includes a warning message.",
  {
    task_id: z.string().min(1),
  },
  async ({ task_id }) => {
    try {
      const taskId = escapeForJxa(task_id.trim());
      const script = `
const taskId = ${taskId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const taskName = task.name;
const childCount = task.children.length;
const warning = childCount > 0
  ? \`Deleted task had \${childCount} child task(s).\`
  : null;

task.drop(false);

return {
  id: taskId,
  name: taskName,
  deleted: true,
  warning: warning
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "move_task",
  "move a task to a named project or back to inbox. accepts a task id and optional project name. when project is omitted, the task is moved to inbox.",
  {
    task_id: z.string().min(1),
    project: z.string().min(1).optional(),
  },
  async ({ task_id, project }) => {
    try {
      const taskId = escapeForJxa(task_id.trim());
      const projectName = project === undefined ? "null" : escapeForJxa(project.trim());
      const script = `
const taskId = ${taskId};
const projectName = ${projectName};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const destination = (() => {
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {
    throw new Error(\`Project not found: \${projectName}\`);
  }
  return targetProject.ending;
})();

task.move(destination);

return {
  id: task.id.primaryKey,
  name: task.name,
  projectName: task.containingProject ? task.containingProject.name : null,
  inInbox: task.inInbox
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_project",
  "create a new project with optional folder and metadata. accepts required name and optional folder, note, dates, and sequential setting. returns the created project id.",
  {
    name: z.string().min(1),
    folder: z.string().min(1).optional(),
    note: z.string().optional(),
    dueDate: z.string().optional(),
    deferDate: z.string().optional(),
    sequential: z.boolean().optional(),
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
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "complete_project",
  "complete a project by id or name and return confirmation.",
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

project.markComplete();

return {
  id: project.id.primaryKey,
  name: project.name,
  completed: true
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.tool(
  "create_tag",
  "create a tag with optional parent tag nesting and return its id.",
  {
    name: z.string().min(1),
    parent: z.string().min(1).optional(),
  },
  async ({ name, parent }) => {
    try {
      const tagName = escapeForJxa(name.trim());
      const parentName = parent === undefined ? "null" : escapeForJxa(parent.trim());
      const script = `
const tagName = ${tagName};
const parentName = ${parentName};

const tag = (() => {
  if (parentName === null) return new Tag(tagName);
  const parentTag = document.flattenedTags.byName(parentName);
  if (!parentTag) {
    throw new Error(\`Tag not found: \${parentName}\`);
  }
  return new Tag(tagName, parentTag.ending);
})();

return {
  id: tag.id.primaryKey
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  }
);

server.registerResource(
  "omnifocus-inbox",
  "omnifocus://inbox",
  {
    description: "current inbox tasks as json",
    mimeType: "application/json",
  },
  async (uri) => {
    const script = `
const tasks = inbox
  .filter(task => !task.completed)
  .slice(0, 100);

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
    const data = await runOmniJs(script);
    return {
      contents: [
        {
          uri: uri.toString(),
          text: JSON.stringify(data),
        },
      ],
    };
  }
);

server.registerResource(
  "omnifocus-today",
  "omnifocus://today",
  {
    description: "forecast sections for overdue, due today, and flagged tasks",
    mimeType: "application/json",
  },
  async (uri) => {
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
  .slice(0, 100)
  .map(toTaskSummary);

const dueToday = openTasks
  .filter(task => task.dueDate !== null && task.dueDate >= startOfToday && task.dueDate < endOfToday)
  .slice(0, 100)
  .map(toTaskSummary);

const flagged = openTasks
  .filter(task => task.flagged)
  .slice(0, 100)
  .map(toTaskSummary);

return {
  overdue: overdue,
  dueToday: dueToday,
  flagged: flagged
};
`.trim();
    const data = await runOmniJs(script);
    return {
      contents: [
        {
          uri: uri.toString(),
          text: JSON.stringify(data),
        },
      ],
    };
  }
);

server.registerResource(
  "omnifocus-projects",
  "omnifocus://projects",
  {
    description: "all active projects summary as json",
    mimeType: "application/json",
  },
  async (uri) => {
    const script = `
const statusFilter = "active";

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
  .filter(project => normalizeProjectStatus(project) === statusFilter)
  .slice(0, 100);

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
    const data = await runOmniJs(script);
    return {
      contents: [
        {
          uri: uri.toString(),
          text: JSON.stringify(data),
        },
      ],
    };
  }
);

server.registerPrompt(
  "daily_review",
  {
    description: "daily planning prompt with due-soon, overdue, and flagged tasks",
  },
  async () => {
    const dueSoon = await runOmniJs(`
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
return document.flattenedTasks
  .filter(task => !task.completed && task.dueDate !== null && task.dueDate >= now && task.dueDate <= soon)
  .slice(0, 25)
  .map(task => ({ id: task.id.primaryKey, name: task.name }));
`.trim());
    const overdue = await runOmniJs(`
const now = new Date();
return document.flattenedTasks
  .filter(task => !task.completed && task.dueDate !== null && task.dueDate < now)
  .slice(0, 25)
  .map(task => ({ id: task.id.primaryKey, name: task.name }));
`.trim());
    const flagged = await runOmniJs(`
return document.flattenedTasks
  .filter(task => !task.completed && task.flagged)
  .slice(0, 25)
  .map(task => ({ id: task.id.primaryKey, name: task.name }));
`.trim());
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a focused daily review using the task data below.

1) identify the highest-risk overdue items.
2) review due-soon tasks and sequence today's execution.
3) evaluate flagged work and confirm urgency.
4) produce exactly three top priorities for today with short rationale.
5) call out anything that should be deferred, delegated, or dropped.

overdue_tasks_json:
${JSON.stringify(overdue)}

due_soon_tasks_json:
${JSON.stringify(dueSoon)}

flagged_tasks_json:
${JSON.stringify(flagged)}`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "weekly_review",
  {
    description: "weekly review prompt with active projects and next-action coverage",
  },
  async () => {
    const projects = await runOmniJs(`
const normalizeProjectStatus = (project) => {
  const rawStatus = String(project.status || "").toLowerCase();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) return "on_hold";
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
};
return document.flattenedProjects
  .filter(project => normalizeProjectStatus(project) === "active")
  .slice(0, 500)
  .map(project => ({ id: project.id.primaryKey, name: project.name }));
`.trim());
    const availableTasks = await runOmniJs(`
return document.flattenedTasks
  .filter(task => !task.completed)
  .slice(0, 1000)
  .map(task => ({ id: task.id.primaryKey, name: task.name, projectName: task.containingProject ? task.containingProject.name : null }));
`.trim());
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a gtd-style weekly review using the data below.

1) review all active projects and classify each as:
   - on track
   - at risk
   - stalled (no clear next action)
2) identify stalled projects by checking whether each project has at least one available next action.
3) propose the next concrete action for every stalled project.
4) highlight projects that need defer/due date updates or scope adjustments.
5) produce a concise weekly plan:
   - top 5 project priorities
   - key risks/blockers
   - cleanup actions (drop, defer, delegate, or someday/maybe)

active_projects_json:
${JSON.stringify(projects)}

available_tasks_json:
${JSON.stringify(availableTasks)}`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "inbox_processing",
  {
    description: "inbox processing prompt that drives one-by-one clarification decisions",
  },
  async () => {
    const inboxItems = await runOmniJs(`
return inbox
  .filter(task => !task.completed)
  .slice(0, 200)
  .map(task => ({ id: task.id.primaryKey, name: task.name, note: task.note }));
`.trim());
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a gtd inbox processing session using the inbox data below.

for each inbox item, guide a decision in this order:
1) clarify desired outcome and next action.
2) decide if it should be deleted, deferred, delegated, or kept.
3) if kept, assign the best target project (or keep in inbox if truly unassigned).
4) propose relevant tags and whether it should be flagged.
5) suggest due/defer dates only when there is a real deadline or start date.
6) suggest estimated minutes when the task is actionable.

respond with:
- a prioritized processing queue
- concrete update recommendations per item
- a short batch action plan for the first 5 items

inbox_items_json:
${JSON.stringify(inboxItems)}`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "project_planning",
  {
    description: "project planning prompt that turns a project into actionable next steps",
    argsSchema: {
      project: z.string().min(1),
    },
  },
  async ({ project }) => {
    const projectName = project.trim();
    const projectFilter = escapeForJxa(projectName);
    const projectDetails = await runOmniJs(`
const projectFilter = ${projectFilter};
const project = document.flattenedProjects.find(item => item.id.primaryKey === projectFilter || item.name === projectFilter);
if (!project) throw new Error(\`Project not found: \${projectFilter}\`);
return { id: project.id.primaryKey, name: project.name, note: project.note };
`.trim());
    const availableTasks = await runOmniJs(`
const projectFilter = ${projectFilter};
return document.flattenedTasks
  .filter(task => !task.completed && task.containingProject && task.containingProject.name === projectFilter)
  .slice(0, 500)
  .map(task => ({ id: task.id.primaryKey, name: task.name, estimatedMinutes: task.estimatedMinutes }));
`.trim());
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `plan this project into clear executable work.

project name:
${projectName}

planning goals:
1) summarize the project outcome in one concise sentence.
2) evaluate current task coverage and identify missing steps.
3) convert vague items into concrete next actions (verb-first, observable).
4) sequence work logically (dependencies first, then parallelizable actions).
5) estimate effort (minutes/hours) for each next action and flag high-risk items.
6) recommend what to do now, next, later, and what to defer/drop.

output format:
- project summary
- work breakdown with columns:
  action, estimate, priority, dependency, suggested tags, due/defer recommendation, rationale
- first 3 actions to execute immediately
- risk/blocker list with mitigation ideas

project_details_json:
${JSON.stringify(projectDetails)}

project_available_tasks_json:
${JSON.stringify(availableTasks)}`,
          },
        },
      ],
    };
  }
);

server.registerResource(
  "omnifocus_inbox",
  "omnifocus://inbox",
  {
    title: "omnifocus inbox",
    description: "current inbox tasks as json.",
    mimeType: "application/json",
  },
  async () => {
    try {
      const script = `
const tasks = inbox
  .filter(task => !task.completed)
  .slice(0, 100);

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
      const data = await runOmniJs(script);
      return {
        contents: [
          {
            uri: "omnifocus://inbox",
            mimeType: "application/json",
            text: JSON.stringify(data),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        contents: [
          {
            uri: "omnifocus://inbox",
            mimeType: "application/json",
            text: JSON.stringify({ error: normalizeError(error) }),
          },
        ],
      };
    }
  }
);

server.registerResource(
  "omnifocus_today",
  "omnifocus://today",
  {
    title: "omnifocus today",
    description: "forecast sections for overdue, due today, and flagged tasks.",
    mimeType: "application/json",
  },
  async () => {
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
  .slice(0, 100)
  .map(toTaskSummary);

const dueToday = openTasks
  .filter(task => task.dueDate !== null && task.dueDate >= startOfToday && task.dueDate < endOfToday)
  .slice(0, 100)
  .map(toTaskSummary);

const flagged = openTasks
  .filter(task => task.flagged)
  .slice(0, 100)
  .map(toTaskSummary);

return {
  overdue: overdue,
  dueToday: dueToday,
  flagged: flagged
};
`.trim();
      const data = await runOmniJs(script);
      return {
        contents: [
          {
            uri: "omnifocus://today",
            mimeType: "application/json",
            text: JSON.stringify(data),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        contents: [
          {
            uri: "omnifocus://today",
            mimeType: "application/json",
            text: JSON.stringify({ error: normalizeError(error) }),
          },
        ],
      };
    }
  }
);

server.registerResource(
  "omnifocus_projects",
  "omnifocus://projects",
  {
    title: "omnifocus projects",
    description: "active project summaries as json.",
    mimeType: "application/json",
  },
  async () => {
    try {
      const script = `
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
  .filter(project => normalizeProjectStatus(project) === "active")
  .slice(0, 100);

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
      const data = await runOmniJs(script);
      return {
        contents: [
          {
            uri: "omnifocus://projects",
            mimeType: "application/json",
            text: JSON.stringify(data),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        contents: [
          {
            uri: "omnifocus://projects",
            mimeType: "application/json",
            text: JSON.stringify({ error: normalizeError(error) }),
          },
        ],
      };
    }
  }
);

server.registerPrompt(
  "daily_review",
  {
    description: "daily planning prompt with due-soon, overdue, and flagged tasks.",
  },
  async () => {
    const dueSoonScript = `
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const tasks = document.flattenedTasks
  .filter(task => {
    if (task.completed) return false;
    const dueDate = task.dueDate;
    return dueDate !== null && dueDate >= now && dueDate <= soon;
  })
  .slice(0, 25);

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
    const overdueScript = `
const now = new Date();
const tasks = document.flattenedTasks
  .filter(task => {
    if (task.completed) return false;
    const dueDate = task.dueDate;
    return dueDate !== null && dueDate < now;
  })
  .slice(0, 25);

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
    const flaggedScript = `
const tasks = document.flattenedTasks
  .filter(task => task.flagged)
  .slice(0, 25);

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
    const dueSoon = await runOmniJs(dueSoonScript);
    const overdue = await runOmniJs(overdueScript);
    const flagged = await runOmniJs(flaggedScript);

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a focused daily review using the task data below.

1) identify the highest-risk overdue items.
2) review due-soon tasks and sequence today's execution.
3) evaluate flagged work and confirm urgency.
4) produce exactly three top priorities for today with short rationale.
5) call out anything that should be deferred, delegated, or dropped.

overdue_tasks_json:
${JSON.stringify(overdue)}

due_soon_tasks_json:
${JSON.stringify(dueSoon)}

flagged_tasks_json:
${JSON.stringify(flagged)}
`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "weekly_review",
  {
    description: "weekly review prompt with active projects and next-action coverage.",
  },
  async () => {
    const activeProjectsScript = `
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
  .filter(project => normalizeProjectStatus(project) === "active")
  .slice(0, 500);

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
    const availableTasksScript = `
const tasks = document.flattenedTasks
  .filter(task => !task.completed)
  .slice(0, 1000);

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
    const activeProjects = await runOmniJs(activeProjectsScript);
    const availableTasks = await runOmniJs(availableTasksScript);

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a gtd-style weekly review using the data below.

1) review all active projects and classify each as:
   - on track
   - at risk
   - stalled (no clear next action)
2) identify stalled projects by checking whether each project has at least one available next action.
3) propose the next concrete action for every stalled project.
4) highlight projects that need defer/due date updates or scope adjustments.
5) produce a concise weekly plan:
   - top 5 project priorities
   - key risks/blockers
   - cleanup actions (drop, defer, delegate, or someday/maybe)

active_projects_json:
${JSON.stringify(activeProjects)}

available_tasks_json:
${JSON.stringify(availableTasks)}
`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "inbox_processing",
  {
    description: "inbox processing prompt that drives one-by-one clarification decisions.",
  },
  async () => {
    const inboxScript = `
const tasks = inbox
  .filter(task => !task.completed)
  .slice(0, 200);

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
    const inboxItems = await runOmniJs(inboxScript);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `run a gtd inbox processing session using the inbox data below.

for each inbox item, guide a decision in this order:
1) clarify desired outcome and next action.
2) decide if it should be deleted, deferred, delegated, or kept.
3) if kept, assign the best target project (or keep in inbox if truly unassigned).
4) propose relevant tags and whether it should be flagged.
5) suggest due/defer dates only when there is a real deadline or start date.
6) suggest estimated minutes when the task is actionable.

respond with:
- a prioritized processing queue
- concrete update recommendations per item
- a short batch action plan for the first 5 items

inbox_items_json:
${JSON.stringify(inboxItems)}
`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "project_planning",
  {
    description: "project planning prompt that turns a project into actionable next steps.",
    argsSchema: {
      project: z.string().min(1),
    },
  },
  async ({ project }) => {
    const projectName = project.trim();
    if (projectName === "") {
      throw new Error("project must not be empty.");
    }

    const projectDetailsScript = `
const projectFilter = ${escapeForJxa(projectName)};
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
    const projectAvailableTasksScript = `
const projectFilter = ${escapeForJxa(projectName)};
const tasks = document.flattenedTasks
  .filter(task => {
    if (task.completed) return false;
    const projectName = task.containingProject ? task.containingProject.name : null;
    return projectName === projectFilter;
  })
  .slice(0, 500);

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
    const projectDetails = await runOmniJs(projectDetailsScript);
    const availableTasks = await runOmniJs(projectAvailableTasksScript);

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `plan this project into clear executable work.

project name:
${projectName}

planning goals:
1) summarize the project outcome in one concise sentence.
2) evaluate current task coverage and identify missing steps.
3) convert vague items into concrete next actions (verb-first, observable).
4) sequence work logically (dependencies first, then parallelizable actions).
5) estimate effort (minutes/hours) for each next action and flag high-risk items.
6) recommend what to do now, next, later, and what to defer/drop.

output format:
- project summary
- work breakdown with columns:
  action, estimate, priority, dependency, suggested tags, due/defer recommendation, rationale
- first 3 actions to execute immediately
- risk/blocker list with mitigation ideas

project_details_json:
${JSON.stringify(projectDetails)}

project_available_tasks_json:
${JSON.stringify(availableTasks)}
`,
          },
        },
      ],
    };
  }
);

server.registerResource(
  "inbox_resource",
  "omnifocus://inbox",
  { description: "resource for current inbox tasks as json.", mimeType: "application/json" },
  async (uri) => {
  try {
    const data = await fetchInboxData(100);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(data),
        },
      ],
    };
  } catch (error: unknown) {
    const message = normalizeError(error);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify({ error: message }),
        },
      ],
    };
  }
  }
);

server.registerResource(
  "today_resource",
  "omnifocus://today",
  { description: "resource for forecast sections as json.", mimeType: "application/json" },
  async (uri) => {
  try {
    const data = await fetchForecastData(100);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(data),
        },
      ],
    };
  } catch (error: unknown) {
    const message = normalizeError(error);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify({ error: message }),
        },
      ],
    };
  }
  }
);

server.registerResource(
  "projects_resource",
  "omnifocus://projects",
  { description: "resource for active project summaries as json.", mimeType: "application/json" },
  async (uri) => {
  try {
    const data = await fetchProjectsData(100);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(data),
        },
      ],
    };
  } catch (error: unknown) {
    const message = normalizeError(error);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify({ error: message }),
        },
      ],
    };
  }
  }
);

server.registerPrompt(
  "daily_review",
  { description: "daily planning prompt with due-soon, overdue, and flagged tasks." },
  async () => {
    const dueSoon = await fetchTasksData({ status: "due_soon", limit: 25 });
    const overdue = await fetchTasksData({ status: "overdue", limit: 25 });
    const flagged = await fetchTasksData({ flagged: true, status: "all", limit: 25 });

    const text = `run a focused daily review using the task data below.

1) identify the highest-risk overdue items.
2) review due-soon tasks and sequence today's execution.
3) evaluate flagged work and confirm urgency.
4) produce exactly three top priorities for today with short rationale.
5) call out anything that should be deferred, delegated, or dropped.

overdue_tasks_json:
${JSON.stringify(overdue)}

due_soon_tasks_json:
${JSON.stringify(dueSoon)}

flagged_tasks_json:
${JSON.stringify(flagged)}
`;

    return {
      messages: [{ role: "user", content: { type: "text", text: text } }],
    };
  }
);

server.registerPrompt(
  "weekly_review",
  { description: "weekly review prompt with active projects and next-action coverage." },
  async () => {
    const activeProjects = await fetchProjectsData(500);
    const availableTasks = await fetchTasksData({ status: "available", limit: 1000 });

    const text = `run a gtd-style weekly review using the data below.

1) review all active projects and classify each as:
   - on track
   - at risk
   - stalled (no clear next action)
2) identify stalled projects by checking whether each project has at least one available next action.
3) propose the next concrete action for every stalled project.
4) highlight projects that need defer/due date updates or scope adjustments.
5) produce a concise weekly plan:
   - top 5 project priorities
   - key risks/blockers
   - cleanup actions (drop, defer, delegate, or someday/maybe)

active_projects_json:
${JSON.stringify(activeProjects)}

available_tasks_json:
${JSON.stringify(availableTasks)}
`;

    return {
      messages: [{ role: "user", content: { type: "text", text: text } }],
    };
  }
);

server.registerPrompt(
  "inbox_processing",
  { description: "inbox processing prompt that drives one-by-one clarification decisions." },
  async () => {
    const inboxItems = await fetchInboxData(200);
    const text = `run a gtd inbox processing session using the inbox data below.

for each inbox item, guide a decision in this order:
1) clarify desired outcome and next action.
2) decide if it should be deleted, deferred, delegated, or kept.
3) if kept, assign the best target project (or keep in inbox if truly unassigned).
4) propose relevant tags and whether it should be flagged.
5) suggest due/defer dates only when there is a real deadline or start date.
6) suggest estimated minutes when the task is actionable.

respond with:
- a prioritized processing queue
- concrete update recommendations per item
- a short batch action plan for the first 5 items

inbox_items_json:
${JSON.stringify(inboxItems)}
`;

    return {
      messages: [{ role: "user", content: { type: "text", text: text } }],
    };
  }
);

server.registerPrompt(
  "project_planning",
  {
    description: "project planning prompt that turns a project into actionable next steps.",
    argsSchema: { project: z.string().min(1) },
  },
  async ({ project }) => {
    const projectName = project.trim();
    if (projectName === "") {
      throw new Error("project must not be empty.");
    }

    const projectDetails = await fetchProjectData(projectName);
    const availableTasks = await fetchTasksData({
      project: projectName,
      status: "available",
      limit: 500,
    });

    const text = `plan this project into clear executable work.

project name:
${projectName}

planning goals:
1) summarize the project outcome in one concise sentence.
2) evaluate current task coverage and identify missing steps.
3) convert vague items into concrete next actions (verb-first, observable).
4) sequence work logically (dependencies first, then parallelizable actions).
5) estimate effort (minutes/hours) for each next action and flag high-risk items.
6) recommend what to do now, next, later, and what to defer/drop.

output format:
- project summary
- work breakdown with columns:
  action, estimate, priority, dependency, suggested tags, due/defer recommendation, rationale
- first 3 actions to execute immediately
- risk/blocker list with mitigation ideas

project_details_json:
${JSON.stringify(projectDetails)}

project_available_tasks_json:
${JSON.stringify(availableTasks)}
`;

    return {
      messages: [{ role: "user", content: { type: "text", text: text } }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
