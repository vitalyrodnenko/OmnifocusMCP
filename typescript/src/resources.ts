import { runOmniJs } from "./jxa.js";
import { normalizeError, type Server } from "./types.js";

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

async function listProjectsData(limit: number): Promise<unknown> {
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

export function registerResources(server: Server): void {
  server.registerResource(
    "inbox_resource",
    "omnifocus://inbox",
    { description: "resource for current inbox tasks as json.", mimeType: "application/json" },
    async (uri: URL) => {
      try {
        const data = await getInboxData(100);
        return {
          contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(data) }],
        };
      } catch (error: unknown) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: normalizeError(error) }),
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
    async (uri: URL) => {
      try {
        const data = await getForecastData(100);
        return {
          contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(data) }],
        };
      } catch (error: unknown) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: normalizeError(error) }),
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
    async (uri: URL) => {
      try {
        const data = await listProjectsData(100);
        return {
          contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(data) }],
        };
      } catch (error: unknown) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: normalizeError(error) }),
            },
          ],
        };
      }
    }
  );
}
