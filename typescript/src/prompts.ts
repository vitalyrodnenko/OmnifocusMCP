import { z } from "zod";

import { escapeForJxa, runOmniJs } from "./jxa.js";
import { type Server, type TaskStatus } from "./types.js";

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

async function listTasksData(params: {
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

async function listProjectsData(limit: number): Promise<unknown> {
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

async function getProjectData(projectIdOrName: string): Promise<unknown> {
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

export function registerPrompts(server: Server): void {
  server.registerPrompt(
    "daily_review",
    { description: "daily planning prompt with due-soon, overdue, and flagged tasks." },
    async () => {
      const dueSoon = await listTasksData({ status: "due_soon", limit: 25 });
      const overdue = await listTasksData({ status: "overdue", limit: 25 });
      const flagged = await listTasksData({ flagged: true, status: "all", limit: 25 });
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
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );

  server.registerPrompt(
    "weekly_review",
    { description: "weekly review prompt with active projects and next-action coverage." },
    async () => {
      const activeProjects = await listProjectsData(500);
      const availableTasks = await listTasksData({ status: "available", limit: 1000 });
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
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );

  server.registerPrompt(
    "inbox_processing",
    { description: "inbox processing prompt that drives one-by-one clarification decisions." },
    async () => {
      const inboxItems = await getInboxData(200);
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
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );

  server.registerPrompt(
    "project_planning",
    {
      description: "project planning prompt that turns a project into actionable next steps.",
      argsSchema: { project: z.string().min(1) },
    },
    async ({ project }: { project: string }) => {
      const projectName = project.trim();
      if (projectName === "") {
        throw new Error("project must not be empty.");
      }
      const projectDetails = await getProjectData(projectName);
      const availableTasks = await listTasksData({
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
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );
}
