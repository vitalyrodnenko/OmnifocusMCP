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
}
