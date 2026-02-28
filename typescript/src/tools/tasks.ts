import { z } from "zod";

import { escapeForJxa, runOmniJs } from "../jxa.js";
import { errorResult, normalizeError, textResult, type Server, type TaskStatus } from "../types.js";

export function register(server: Server): void {
  server.tool(
    "get_inbox",
    "get inbox tasks from omnifocus. returns unprocessed tasks that have not been assigned to a project.",
    { limit: z.number().int().min(1).default(100) },
    async ({ limit }) => {
      try {
        return textResult(await getInboxData(limit));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "list_tasks",
    "list tasks with optional filters for project, tag/tags, flagged state, status, and date ranges.",
    {
      project: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)).optional(),
      tagFilterMode: z.enum(["any", "all"]).default("any"),
      flagged: z.boolean().optional(),
      status: z.enum(["available", "due_soon", "overdue", "completed", "all"]).default("available"),
      dueBefore: z.string().optional(),
      dueAfter: z.string().optional(),
      deferBefore: z.string().optional(),
      deferAfter: z.string().optional(),
      completedBefore: z.string().optional(),
      completedAfter: z.string().optional(),
      plannedBefore: z.string().optional(),
      plannedAfter: z.string().optional(),
      maxEstimatedMinutes: z.number().int().min(0).optional(),
      sortBy: z
        .enum([
          "dueDate",
          "deferDate",
          "name",
          "completionDate",
          "estimatedMinutes",
          "project",
          "flagged",
        ])
        .optional(),
      sortOrder: z.enum(["asc", "desc"]).default("asc"),
      limit: z.number().int().min(1).default(100),
    },
    async ({
      project,
      tag,
      tags,
      tagFilterMode,
      flagged,
      status,
      dueBefore,
      dueAfter,
      deferBefore,
      deferAfter,
      completedBefore,
      completedAfter,
      plannedBefore,
      plannedAfter,
      maxEstimatedMinutes,
      sortBy,
      sortOrder,
      limit,
    }) => {
      try {
        return textResult(
          await listTasksData(
            project,
            tag,
            tags,
            tagFilterMode ?? "any",
            flagged,
            status,
            dueBefore,
            dueAfter,
            deferBefore,
            deferAfter,
            completedBefore,
            completedAfter,
            plannedBefore,
            plannedAfter,
            maxEstimatedMinutes,
            sortBy,
            sortOrder,
            limit
          )
        );
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "get_task_counts",
    "get aggregate task counts for any filter combination without listing individual tasks. much faster than list_tasks for answering 'how many' questions.",
    {
      project: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)).optional(),
      tagFilterMode: z.enum(["any", "all"]).default("any"),
      flagged: z.boolean().optional(),
      dueBefore: z.string().optional(),
      dueAfter: z.string().optional(),
      deferBefore: z.string().optional(),
      deferAfter: z.string().optional(),
      completedBefore: z.string().optional(),
      completedAfter: z.string().optional(),
      maxEstimatedMinutes: z.number().int().min(0).optional(),
    },
    async ({
      project,
      tag,
      tags,
      tagFilterMode,
      flagged,
      dueBefore,
      dueAfter,
      deferBefore,
      deferAfter,
      completedBefore,
      completedAfter,
      maxEstimatedMinutes,
    }) => {
      try {
        return textResult(
          await getTaskCountsData(
            project,
            tag,
            tags,
            tagFilterMode ?? "any",
            flagged,
            dueBefore,
            dueAfter,
            deferBefore,
            deferAfter,
            completedBefore,
            completedAfter,
            maxEstimatedMinutes
          )
        );
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool("get_task", "get a single task by id.", { task_id: z.string().min(1) }, async ({ task_id }) => {
    try {
      const taskId = escapeForJxa(task_id);
      const script = `
const taskId = ${taskId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) throw new Error(\`Task not found: \${taskId}\`);
return {
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  effectiveDueDate: task.effectiveDueDate ? task.effectiveDueDate.toISOString() : null,
  effectiveDeferDate: task.effectiveDeferDate ? task.effectiveDeferDate.toISOString() : null,
  effectiveFlagged: task.effectiveFlagged,
  completed: task.completed,
  completionDate: task.completionDate ? task.completionDate.toISOString() : null,
  modified: task.modified ? task.modified.toISOString() : null,
  plannedDate: (() => {
    try {
      const value = task.plannedDate;
      return value ? value.toISOString() : null;
    } catch (e) {
      return null;
    }
  })(),
  effectivePlannedDate: (() => {
    try {
      const value = task.effectivePlannedDate;
      return value ? value.toISOString() : null;
    } catch (e) {
      return null;
    }
  })(),
  taskStatus: (() => {
    const s = String(task.taskStatus);
    if (s.includes("Available")) return "available";
    if (s.includes("Blocked")) return "blocked";
    if (s.includes("Next")) return "next";
    if (s.includes("DueSoon")) return "due_soon";
    if (s.includes("Overdue")) return "overdue";
    if (s.includes("Completed")) return "completed";
    if (s.includes("Dropped")) return "dropped";
    return "unknown";
  })(),
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes,
  children: task.children.map(child => ({ id: child.id.primaryKey, name: child.name })),
  parentName: task.parentTask ? task.parentTask.name : null,
  sequential: task.sequential,
  repetitionRule: task.repetitionRule ? task.repetitionRule.ruleString : null
};
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  });

  server.tool(
    "list_subtasks",
    "list direct subtasks for a task id.",
    { task_id: z.string().min(1), limit: z.number().int().min(1).default(100) },
    async ({ task_id, limit }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const script = `
const taskId = ${taskId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const subtasks = task.children.slice(0, ${limit});
return subtasks.map(subtask => {
  const tags = subtask.tags.map(taskTag => taskTag.name);
  return {
    id: subtask.id.primaryKey,
    name: subtask.name,
    note: subtask.note,
    flagged: subtask.flagged,
    dueDate: subtask.dueDate ? subtask.dueDate.toISOString() : null,
    deferDate: subtask.deferDate ? subtask.deferDate.toISOString() : null,
    completed: subtask.completed,
    tags: tags,
    estimatedMinutes: subtask.estimatedMinutes,
    hasChildren: subtask.hasChildren,
    taskStatus: (() => {
      const s = String(subtask.taskStatus);
      if (s.includes("Available")) return "available";
      if (s.includes("Blocked")) return "blocked";
      if (s.includes("Next")) return "next";
      if (s.includes("DueSoon")) return "due_soon";
      if (s.includes("Overdue")) return "overdue";
      if (s.includes("Completed")) return "completed";
      if (s.includes("Dropped")) return "dropped";
      return "unknown";
    })()
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
    "list_notifications",
    "list active notifications for a task by id.",
    { task_id: z.string().min(1) },
    async ({ task_id }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const script = `
const taskId = ${taskId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}
return task.notifications.map(n => ({
  id: n.id.primaryKey,
  kind: n.initialFireDate ? "absolute" : "relative",
  absoluteFireDate: n.initialFireDate ? n.initialFireDate.toISOString() : null,
  relativeFireOffset: n.initialFireDate ? null : n.relativeFireOffset,
  nextFireDate: n.nextFireDate ? n.nextFireDate.toISOString() : null,
  isSnoozed: n.isSnoozed
}));
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "add_notification",
    "add a notification to a task by id. provide exactly one of absoluteDate or relativeOffset.",
    {
      task_id: z.string().min(1),
      absoluteDate: z.string().optional(),
      relativeOffset: z.number().optional(),
    },
    async ({ task_id, absoluteDate, relativeOffset }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        const hasAbsolute = absoluteDate !== undefined;
        const hasRelative = relativeOffset !== undefined;
        if (hasAbsolute === hasRelative) {
          throw new Error("exactly one of absoluteDate or relativeOffset must be provided.");
        }
        if (absoluteDate !== undefined && absoluteDate.trim() === "") {
          throw new Error("absoluteDate must not be empty when provided.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const absoluteDateRaw =
          absoluteDate === undefined ? "null" : escapeForJxa(absoluteDate.trim());
        const relativeOffsetValue =
          relativeOffset === undefined ? "null" : String(relativeOffset);
        const script = `
const taskId = ${taskId};
const absoluteDateRaw = ${absoluteDateRaw};
const relativeOffset = ${relativeOffsetValue};
const absoluteDate = (() => {
  if (absoluteDateRaw === null) return null;
  const parsed = new Date(absoluteDateRaw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("absoluteDate must be a valid ISO 8601 date string.");
  }
  return parsed;
})();
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}
const created = (() => {
  if (absoluteDate !== null) {
    return task.addNotification(absoluteDate);
  }
  const effectiveDueDate = task.effectiveDueDate;
  if (effectiveDueDate === null) {
    throw new Error("relativeOffset requires a task with an effective due date.");
  }
  return task.addNotification(relativeOffset);
})();
const notification = created || task.notifications[task.notifications.length - 1];
if (!notification) {
  throw new Error(\`Failed to create notification for task: \${taskId}\`);
}
return {
  id: notification.id.primaryKey,
  kind: notification.initialFireDate ? "absolute" : "relative",
  absoluteFireDate: notification.initialFireDate ? notification.initialFireDate.toISOString() : null,
  relativeFireOffset: notification.initialFireDate ? null : notification.relativeFireOffset,
  nextFireDate: notification.nextFireDate ? notification.nextFireDate.toISOString() : null,
  isSnoozed: notification.isSnoozed
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "remove_notification",
    "remove one notification from a task by id.",
    { task_id: z.string().min(1), notification_id: z.string().min(1) },
    async ({ task_id, notification_id }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        const normalizedNotificationId = notification_id.trim();
        if (normalizedNotificationId === "") {
          throw new Error("notification_id must not be empty.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const notificationId = escapeForJxa(normalizedNotificationId);
        const script = `
const taskId = ${taskId};
const notificationId = ${notificationId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}
const notification = task.notifications.find(item => item.id.primaryKey === notificationId);
if (!notification) {
  throw new Error(\`Notification not found: \${notificationId}\`);
}
task.removeNotification(notification);
return {
  taskId: task.id.primaryKey,
  notificationId: notification.id.primaryKey,
  removed: true
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "duplicate_task",
    "duplicate a task with all its properties. if the task has subtasks, they are cloned too by default.",
    { task_id: z.string().min(1), includeChildren: z.boolean().default(true) },
    async ({ task_id, includeChildren }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const includeChildrenValue = includeChildren ? "true" : "false";
        const script = `
const taskId = ${taskId};
const includeChildren = ${includeChildrenValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}
const insertionLocation = task.containingProject ? task.containingProject.ending : inbox.ending;
const clonedTask = (() => {
  if (includeChildren) {
    const duplicates = duplicateTasks([task], insertionLocation);
    return duplicates && duplicates.length > 0 ? duplicates[0] : null;
  }
  const manualClone = new Task(task.name, insertionLocation);
  manualClone.note = task.note;
  manualClone.flagged = task.flagged;
  manualClone.dueDate = task.dueDate;
  manualClone.deferDate = task.deferDate;
  manualClone.estimatedMinutes = task.estimatedMinutes;
  task.tags.forEach(tag => {
    manualClone.addTag(tag);
  });
  return manualClone;
})();
if (!clonedTask) {
  throw new Error(\`Failed to duplicate task: \${taskId}\`);
}
return {
  id: clonedTask.id.primaryKey,
  name: clonedTask.name,
  note: clonedTask.note,
  flagged: clonedTask.flagged,
  dueDate: clonedTask.dueDate ? clonedTask.dueDate.toISOString() : null,
  deferDate: clonedTask.deferDate ? clonedTask.deferDate.toISOString() : null,
  completed: clonedTask.completed,
  completionDate: clonedTask.completionDate ? clonedTask.completionDate.toISOString() : null,
  projectName: clonedTask.containingProject ? clonedTask.containingProject.name : null,
  tags: clonedTask.tags.map(tag => tag.name),
  estimatedMinutes: clonedTask.estimatedMinutes,
  hasChildren: clonedTask.hasChildren,
  taskStatus: (() => {
    const s = String(clonedTask.taskStatus);
    if (s.includes("Available")) return "available";
    if (s.includes("Blocked")) return "blocked";
    if (s.includes("Next")) return "next";
    if (s.includes("DueSoon")) return "due_soon";
    if (s.includes("Overdue")) return "overdue";
    if (s.includes("Completed")) return "completed";
    if (s.includes("Dropped")) return "dropped";
    return "unknown";
  })()
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
    "search tasks by case-insensitive query across name and note.",
    {
      query: z.string().min(1),
      project: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)).optional(),
      tagFilterMode: z.enum(["any", "all"]).default("any"),
      flagged: z.boolean().optional(),
      status: z.enum(["available", "due_soon", "overdue", "completed", "all"]).default("available"),
      dueBefore: z.string().optional(),
      dueAfter: z.string().optional(),
      deferBefore: z.string().optional(),
      deferAfter: z.string().optional(),
      completedBefore: z.string().optional(),
      completedAfter: z.string().optional(),
      plannedBefore: z.string().optional(),
      plannedAfter: z.string().optional(),
      maxEstimatedMinutes: z.number().int().min(0).optional(),
      sortBy: z
        .enum([
          "dueDate",
          "deferDate",
          "name",
          "completionDate",
          "estimatedMinutes",
          "project",
          "flagged",
        ])
        .optional(),
      sortOrder: z.enum(["asc", "desc"]).default("asc"),
      limit: z.number().int().min(1).default(100),
    },
    async ({
      query,
      project,
      tag,
      tags,
      tagFilterMode,
      flagged,
      status,
      dueBefore,
      dueAfter,
      deferBefore,
      deferAfter,
      completedBefore,
      completedAfter,
      plannedBefore,
      plannedAfter,
      maxEstimatedMinutes,
      sortBy,
      sortOrder,
      limit,
    }) => {
      try {
        return textResult(
          await searchTasksData(
            query,
            project,
            tag,
            tags,
            tagFilterMode ?? "any",
            flagged,
            status ?? "available",
            dueBefore,
            dueAfter,
            deferBefore,
            deferAfter,
            completedBefore,
            completedAfter,
            plannedBefore,
            plannedAfter,
            maxEstimatedMinutes,
            sortBy,
            sortOrder,
            limit
          )
        );
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "create_task",
    "create a new task in inbox or a named project and return the created task summary.",
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
  if (!targetProject) throw new Error(\`Project not found: \${projectName}\`);
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
return { id: task.id.primaryKey, name: task.name };
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "create_subtask",
    "create a new subtask under an existing parent task by id.",
    {
      name: z.string().min(1),
      parent_task_id: z.string().min(1),
      note: z.string().optional(),
      dueDate: z.string().optional(),
      deferDate: z.string().optional(),
      flagged: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      estimatedMinutes: z.number().int().optional(),
    },
    async ({ name, parent_task_id, note, dueDate, deferDate, flagged, tags, estimatedMinutes }) => {
      try {
        const normalizedName = name.trim();
        if (normalizedName === "") {
          throw new Error("name must not be empty.");
        }
        const normalizedParentTaskId = parent_task_id.trim();
        if (normalizedParentTaskId === "") {
          throw new Error("parent_task_id must not be empty.");
        }
        const taskName = escapeForJxa(normalizedName);
        const parentTaskId = escapeForJxa(normalizedParentTaskId);
        const noteValue = note === undefined ? "null" : escapeForJxa(note);
        const dueDateValue = dueDate === undefined ? "null" : escapeForJxa(dueDate);
        const deferDateValue = deferDate === undefined ? "null" : escapeForJxa(deferDate);
        const flaggedValue = flagged === undefined ? "null" : flagged ? "true" : "false";
        const tagsValue = tags === undefined ? "null" : JSON.stringify(tags);
        const estimatedMinutesValue =
          estimatedMinutes === undefined ? "null" : String(estimatedMinutes);
        const script = `
const taskName = ${taskName};
const parentTaskId = ${parentTaskId};
const noteValue = ${noteValue};
const dueDateValue = ${dueDateValue};
const deferDateValue = ${deferDateValue};
const flaggedValue = ${flaggedValue};
const tagNames = ${tagsValue};
const estimatedMinutesValue = ${estimatedMinutesValue};

const parentTask = document.flattenedTasks.find(item => item.id.primaryKey === parentTaskId);
if (!parentTask) {
  throw new Error(\`Parent task not found: \${parentTaskId}\`);
}

const task = new Task(taskName, parentTask.ending);

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
  name: task.name,
  parentTaskId: parentTask.id.primaryKey,
  parentTaskName: parentTask.name
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "duplicate_task",
    "duplicate a task with all its properties. if the task has subtasks, they are cloned too by default.",
    {
      task_id: z.string().min(1),
      includeChildren: z.boolean().default(true),
    },
    async ({ task_id, includeChildren }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const includeChildrenValue = includeChildren ? "true" : "false";
        const script = `
const taskId = ${taskId};
const includeChildren = ${includeChildrenValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

const insertionLocation = task.containingProject ? task.containingProject.ending : inbox.ending;
let duplicatedTask = null;

if (includeChildren) {
  const duplicatedTasks = duplicateTasks([task], insertionLocation);
  if (duplicatedTasks && duplicatedTasks.length > 0) {
    duplicatedTask = duplicatedTasks[0];
  }
} else {
  duplicatedTask = new Task(task.name, insertionLocation);
  duplicatedTask.note = task.note;
  duplicatedTask.flagged = task.flagged;
  if (task.dueDate !== null) duplicatedTask.dueDate = new Date(task.dueDate);
  if (task.deferDate !== null) duplicatedTask.deferDate = new Date(task.deferDate);
  if (task.estimatedMinutes !== null) duplicatedTask.estimatedMinutes = task.estimatedMinutes;
  task.tags.forEach(tag => duplicatedTask.addTag(tag));
}

if (!duplicatedTask) {
  throw new Error(\`Failed to duplicate task: \${taskId}\`);
}

return {
  id: duplicatedTask.id.primaryKey,
  name: duplicatedTask.name,
  note: duplicatedTask.note,
  flagged: duplicatedTask.flagged,
  dueDate: duplicatedTask.dueDate ? duplicatedTask.dueDate.toISOString() : null,
  deferDate: duplicatedTask.deferDate ? duplicatedTask.deferDate.toISOString() : null,
  completed: duplicatedTask.completed,
  projectName: duplicatedTask.containingProject ? duplicatedTask.containingProject.name : null,
  tags: duplicatedTask.tags.map(tag => tag.name),
  estimatedMinutes: duplicatedTask.estimatedMinutes
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
    "create multiple tasks in one call and return created task summaries.",
    { tasks: z.array(z.object({ name: z.string().min(1), project: z.string().optional() })).min(1) },
    async ({ tasks }) => {
      try {
        const tasksValue = escapeForJxa(JSON.stringify(tasks));
        const script = `
const tasks = JSON.parse(${tasksValue});
return tasks.map(item => {
  const parent = item.project ? document.flattenedProjects.byName(item.project) : null;
  if (item.project && !parent) throw new Error(\`Project not found: \${item.project}\`);
  const task = new Task(item.name, parent ? parent.ending : inbox.ending);
  return { id: task.id.primaryKey, name: task.name };
});
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool("complete_task", "mark a task complete by id.", { task_id: z.string().min(1) }, async ({ task_id }) => {
    try {
      const taskId = escapeForJxa(task_id);
      const script = `
const taskId = ${taskId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) throw new Error(\`Task not found: \${taskId}\`);
task.markComplete();
return { id: task.id.primaryKey, name: task.name, completed: task.completed };
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  });

  server.tool(
    "uncomplete_task",
    "mark a completed task incomplete by id.",
    { task_id: z.string().min(1) },
    async ({ task_id }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const script = `
const taskId = ${taskId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}
if (!task.completed) {
  throw new Error(\`Task is not completed: \${taskId}\`);
}

task.markIncomplete();

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
    "set_task_repetition",
    "set or clear a task repetition rule by task id.",
    {
      task_id: z.string().min(1),
      rule_string: z.string().nullable().default(null),
      schedule_type: z.enum(["regularly", "from_completion", "none"]).default("regularly"),
    },
    async ({ task_id, rule_string, schedule_type }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        if (rule_string !== null && rule_string.trim() === "") {
          throw new Error("rule_string must not be empty when provided.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const ruleString = rule_string === null ? "null" : escapeForJxa(rule_string.trim());
        const scheduleType = escapeForJxa(schedule_type);
        const script = `
const taskId = ${taskId};
const ruleString = ${ruleString};
const scheduleTypeInput = ${scheduleType};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}

if (ruleString === null) {
  task.repetitionRule = null;
} else {
  const scheduleType = (() => {
    if (scheduleTypeInput === "regularly") return Task.RepetitionScheduleType.Regularly;
    if (scheduleTypeInput === "from_completion") return Task.RepetitionScheduleType.FromCompletion;
    if (scheduleTypeInput === "none") return Task.RepetitionScheduleType.None;
    throw new Error(\`Invalid schedule_type: \${scheduleTypeInput}\`);
  })();
  task.repetitionRule = new Task.RepetitionRule(ruleString, null, scheduleType, null, false);
}

return {
  id: task.id.primaryKey,
  name: task.name,
  repetitionRule: task.repetitionRule ? task.repetitionRule.ruleString : null
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
    "update one task with partial fields and return the updated task payload.",
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
    async ({ task_id, ...rawUpdates }) => {
      try {
        const taskId = escapeForJxa(task_id);
        const updates = Object.fromEntries(
          Object.entries(rawUpdates).filter(([, value]) => value !== undefined)
        );
        const script = `
const taskId = ${taskId};
const updates = ${JSON.stringify(updates)};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) throw new Error(\`Task not found: \${taskId}\`);
if (updates.name !== undefined) task.name = updates.name;
if (updates.note !== undefined) task.note = updates.note;
if (updates.dueDate !== undefined) task.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
if (updates.deferDate !== undefined) task.deferDate = updates.deferDate ? new Date(updates.deferDate) : null;
if (updates.flagged !== undefined) task.flagged = updates.flagged;
if (updates.estimatedMinutes !== undefined) task.estimatedMinutes = updates.estimatedMinutes;
if (updates.tags !== undefined) {
  task.tags.slice().forEach(tag => task.removeTag(tag));
  updates.tags.forEach(tagName => {
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  });
}
return {
  id: task.id.primaryKey,
  name: task.name,
  flagged: task.flagged,
  projectName: task.containingProject ? task.containingProject.name : null
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool("delete_task", "delete a task by id and return deletion status.", { task_id: z.string().min(1) }, async ({ task_id }) => {
    try {
      const taskId = escapeForJxa(task_id);
      const script = `
const taskId = ${taskId};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) throw new Error(\`Task not found: \${taskId}\`);
const taskName = task.name;
deleteObject(task);
return { id: taskId, name: taskName, deleted: true };
`.trim();
      return textResult(await runOmniJs(script));
    } catch (error: unknown) {
      return errorResult(normalizeError(error));
    }
  });

  server.tool(
    "delete_tasks_batch",
    "delete multiple tasks by id in a single omnijs call. IMPORTANT: before calling this tool, always show the user the list of tasks to be deleted and ask for explicit confirmation. do not proceed without user approval.",
    { task_ids: z.array(z.string().min(1)).min(1) },
    async ({ task_ids }) => {
      try {
        if (task_ids.length === 0) {
          throw new Error("task_ids must contain at least one task id.");
        }
        const normalizedTaskIds = task_ids.map((taskId) => {
          const normalizedTaskId = taskId.trim();
          if (normalizedTaskId === "") {
            throw new Error("each task id must be a non-empty string.");
          }
          return normalizedTaskId;
        });
        const taskIdsValue = `[${normalizedTaskIds.map((taskId) => JSON.stringify(taskId)).join(", ")}]`;
        const script = `
const taskIds = ${taskIdsValue};
const taskById = new Map();
for (const task of document.flattenedTasks) {
  try {
    taskById.set(task.id.primaryKey, task);
  } catch (e) {
  }
}
const results = taskIds.map(taskId => {
  const task = taskById.get(taskId);
  if (!task) {
    return {
      id: taskId,
      deleted: false,
      error: "not found"
    };
  }

  const taskName = task.name;
  deleteObject(task);
  return {
    id: taskId,
    name: taskName,
    deleted: true
  };
});

const deletedCount = results.filter(result => result.deleted).length;
const notFoundCount = results.length - deletedCount;

return {
  deleted_count: deletedCount,
  not_found_count: notFoundCount,
  results: results
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
    "move a task to a different project or to inbox.",
    { task_id: z.string().min(1), project: z.string().min(1).optional() },
    async ({ task_id, project }) => {
      try {
        const taskId = escapeForJxa(task_id);
        const projectName = project === undefined ? "null" : escapeForJxa(project.trim());
        const script = `
const taskId = ${taskId};
const projectName = ${projectName};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) throw new Error(\`Task not found: \${taskId}\`);
if (projectName === null || projectName === "") {
  moveTasks([task], inbox.ending);
} else {
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) throw new Error(\`Project not found: \${projectName}\`);
  moveTasks([task], targetProject.ending);
}
return { id: task.id.primaryKey, name: task.name, projectName: task.containingProject ? task.containingProject.name : null };
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "duplicate_task",
    "duplicate a task with all its properties. if the task has subtasks, they are cloned too by default.",
    {
      task_id: z.string().min(1),
      includeChildren: z.boolean().default(true),
    },
    async ({ task_id, includeChildren }) => {
      try {
        const normalizedTaskId = task_id.trim();
        if (normalizedTaskId === "") {
          throw new Error("task_id must not be empty.");
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const includeChildrenValue = includeChildren ? "true" : "false";
        const script = `
const taskId = ${taskId};
const includeChildren = ${includeChildrenValue};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}
const insertionLocation = (() => {
  if (task.containingTask) return task.containingTask.ending;
  if (task.containingProject) return task.containingProject.ending;
  return inbox.ending;
})();
const taskStatusValue = (taskItem) => {
  const s = String(taskItem.taskStatus);
  if (s.includes("Available")) return "available";
  if (s.includes("Blocked")) return "blocked";
  if (s.includes("Next")) return "next";
  if (s.includes("DueSoon")) return "due_soon";
  if (s.includes("Overdue")) return "overdue";
  if (s.includes("Completed")) return "completed";
  if (s.includes("Dropped")) return "dropped";
  return "unknown";
};
const plannedDateValue = (taskItem) => {
  try {
    return taskItem.plannedDate ? taskItem.plannedDate.toISOString() : null;
  } catch (e) {
    return null;
  }
};
let duplicatedTask;
if (includeChildren) {
  const duplicated = duplicateTasks([task], insertionLocation);
  if (!duplicated || duplicated.length === 0) {
    throw new Error("Failed to duplicate task.");
  }
  duplicatedTask = duplicated[0];
} else {
  duplicatedTask = new Task(task.name, insertionLocation);
  duplicatedTask.note = task.note;
  duplicatedTask.flagged = task.flagged;
  duplicatedTask.dueDate = task.dueDate;
  duplicatedTask.deferDate = task.deferDate;
  duplicatedTask.estimatedMinutes = task.estimatedMinutes;
  task.tags.forEach(tag => duplicatedTask.addTag(tag));
  try {
    duplicatedTask.plannedDate = task.plannedDate;
  } catch (e) {
  }
}
return {
  id: duplicatedTask.id.primaryKey,
  name: duplicatedTask.name,
  note: duplicatedTask.note,
  flagged: duplicatedTask.flagged,
  dueDate: duplicatedTask.dueDate ? duplicatedTask.dueDate.toISOString() : null,
  deferDate: duplicatedTask.deferDate ? duplicatedTask.deferDate.toISOString() : null,
  completed: duplicatedTask.completed,
  completionDate: duplicatedTask.completionDate ? duplicatedTask.completionDate.toISOString() : null,
  plannedDate: plannedDateValue(duplicatedTask),
  projectName: duplicatedTask.containingProject ? duplicatedTask.containingProject.name : null,
  inInbox: duplicatedTask.inInbox,
  tags: duplicatedTask.tags.map(tag => tag.name),
  estimatedMinutes: duplicatedTask.estimatedMinutes,
  hasChildren: duplicatedTask.hasChildren,
  taskStatus: taskStatusValue(duplicatedTask)
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "append_to_note",
    "append text to a task or project note by object id.",
    {
      object_type: z.enum(["task", "project"]),
      object_id: z.string().min(1),
      text: z.string().min(1),
    },
    async ({ object_type, object_id, text }) => {
      try {
        if (object_type !== "task" && object_type !== "project") {
          throw new Error("object_type must be one of: task, project.");
        }
        const normalizedObjectId = object_id.trim();
        if (normalizedObjectId === "") {
          throw new Error("object_id must not be empty.");
        }
        if (text.trim() === "") {
          throw new Error("text must not be empty.");
        }

        const objectType = escapeForJxa(object_type);
        const objectId = escapeForJxa(normalizedObjectId);
        const textValue = escapeForJxa(text);
        const script = `
const objectType = ${objectType};
const objectId = ${objectId};
const textValue = ${textValue};

let obj;
if (objectType === "task") {
  obj = document.flattenedTasks.find(item => item.id.primaryKey === objectId);
} else if (objectType === "project") {
  obj = document.flattenedProjects.find(item => item.id.primaryKey === objectId);
} else {
  throw new Error(\`Invalid object_type: \${objectType}\`);
}

if (!obj) {
  throw new Error(\`\${objectType} not found: \${objectId}\`);
}

obj.appendStringToNote(textValue);

return {
  id: obj.id.primaryKey,
  name: obj.name,
  type: objectType,
  noteLength: obj.note.length
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

}

export async function getInboxData(limit: number): Promise<unknown> {
  const script = `
const tasks = inbox
  .filter(task => !task.completed)
  .slice(0, ${limit});
return tasks.map(task => ({
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completionDate: task.completionDate ? task.completionDate.toISOString() : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes,
  hasChildren: task.hasChildren,
  taskStatus: (() => {
    const s = String(task.taskStatus);
    if (s.includes("Available")) return "available";
    if (s.includes("Blocked")) return "blocked";
    if (s.includes("Next")) return "next";
    if (s.includes("DueSoon")) return "due_soon";
    if (s.includes("Overdue")) return "overdue";
    if (s.includes("Completed")) return "completed";
    if (s.includes("Dropped")) return "dropped";
    return "unknown";
  })()
}));
`.trim();
return runOmniJs(script);
}

async function getTaskCountsDataLegacy1(
  project: string | undefined,
  tag: string | undefined,
  tags: string[] | undefined,
  tagFilterMode: "any" | "all" = "any",
  flagged: boolean | undefined,
  dueBefore: string | undefined,
  dueAfter: string | undefined,
  deferBefore: string | undefined,
  deferAfter: string | undefined,
  completedBefore: string | undefined,
  completedAfter: string | undefined,
  maxEstimatedMinutes: number | undefined
): Promise<unknown> {
  const projectFilter = project === undefined ? "null" : escapeForJxa(project.trim());
  const mergedTagNames: string[] = [];
  if (tag !== undefined) {
    const normalizedTag = tag.trim();
    if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
      mergedTagNames.push(normalizedTag);
    }
  }
  if (tags !== undefined) {
    for (const tagName of tags) {
      const normalizedTag = tagName.trim();
      if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
        mergedTagNames.push(normalizedTag);
      }
    }
  }
  const tagNamesFilter = mergedTagNames.length === 0 ? "null" : JSON.stringify(mergedTagNames);
  const tagFilterModeFilter = escapeForJxa(tagFilterMode);
  const flaggedFilter = flagged === undefined ? "null" : flagged ? "true" : "false";
  const dueBeforeFilter = dueBefore === undefined ? "null" : escapeForJxa(dueBefore);
  const dueAfterFilter = dueAfter === undefined ? "null" : escapeForJxa(dueAfter);
  const deferBeforeFilter = deferBefore === undefined ? "null" : escapeForJxa(deferBefore);
  const deferAfterFilter = deferAfter === undefined ? "null" : escapeForJxa(deferAfter);
  const completedBeforeFilter = completedBefore === undefined ? "null" : escapeForJxa(completedBefore);
  const completedAfterFilter = completedAfter === undefined ? "null" : escapeForJxa(completedAfter);
  const maxEstimatedMinutesFilter = maxEstimatedMinutes === undefined ? "null" : String(maxEstimatedMinutes);
  const script = `
const projectFilter = ${projectFilter};
const tagNames = ${tagNamesFilter};
const tagFilterMode = ${tagFilterModeFilter};
const flaggedFilter = ${flaggedFilter};
const dueBeforeRaw = ${dueBeforeFilter};
const dueAfterRaw = ${dueAfterFilter};
const deferBeforeRaw = ${deferBeforeFilter};
const deferAfterRaw = ${deferAfterFilter};
const completedBeforeRaw = ${completedBeforeFilter};
const completedAfterRaw = ${completedAfterFilter};
const maxEstimatedMinutes = ${maxEstimatedMinutesFilter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(\`\${fieldName} must be a valid ISO 8601 date string.\`);
  }
  return parsed;
};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");
const filteredTasks = document.flattenedTasks.filter(task => {
  if (projectFilter !== null) {
    const projectName = task.containingProject ? task.containingProject.name : null;
    if (projectName !== projectFilter) return false;
  }
  if (tagNames !== null && tagNames.length > 0) {
    let tagMatches = false;
    if (tagFilterMode === "all") {
      tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
    } else {
      tagMatches = task.tags.some(t => tagNames.includes(t.name));
    }
    if (!tagMatches) return false;
  }
  if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;
  if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) return false;
  if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) return false;
  if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) return false;
  if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) return false;
  if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) return false;
  if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return false;
  if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;
  return true;
});
const counts = {
  total: 0,
  available: 0,
  completed: 0,
  overdue: 0,
  dueSoon: 0,
  flagged: 0,
  deferred: 0
};
filteredTasks.forEach(task => {
  counts.total += 1;
  if (!task.completed && (task.deferDate === null || task.deferDate <= now)) counts.available += 1;
  if (task.completed) counts.completed += 1;
  if (!task.completed && task.dueDate !== null && task.dueDate < now) counts.overdue += 1;
  if (!task.completed && task.dueDate !== null && task.dueDate >= now && task.dueDate <= soon) counts.dueSoon += 1;
  if (task.flagged) counts.flagged += 1;
  if (!task.completed && task.deferDate !== null && task.deferDate > now) counts.deferred += 1;
});
return counts;
`.trim();
  return runOmniJs(script);
}

export async function listTasksData(
  project: string | undefined,
  tag: string | undefined,
  tags: string[] | undefined,
  tagFilterMode: "any" | "all" = "any",
  flagged: boolean | undefined,
  status: TaskStatus,
  dueBefore: string | undefined,
  dueAfter: string | undefined,
  deferBefore: string | undefined,
  deferAfter: string | undefined,
  completedBefore: string | undefined,
  completedAfter: string | undefined,
  plannedBefore: string | undefined,
  plannedAfter: string | undefined,
  maxEstimatedMinutes: number | undefined,
  sortBy:
    | "dueDate"
    | "deferDate"
    | "name"
    | "completionDate"
    | "estimatedMinutes"
    | "project"
    | "flagged"
    | undefined,
  sortOrder: "asc" | "desc",
  limit: number
): Promise<unknown> {
  let effectiveSortBy = sortBy;
  let effectiveSortOrder = sortOrder;
  if ((completedBefore !== undefined || completedAfter !== undefined) && effectiveSortBy === undefined) {
    effectiveSortBy = "completionDate";
    effectiveSortOrder = "desc";
  }
  const projectFilter = project === undefined ? "null" : escapeForJxa(project.trim());
  const mergedTagNames: string[] = [];
  if (tag !== undefined) {
    const normalizedTag = tag.trim();
    if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
      mergedTagNames.push(normalizedTag);
    }
  }
  if (tags !== undefined) {
    for (const tagName of tags) {
      const normalizedTag = tagName.trim();
      if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
        mergedTagNames.push(normalizedTag);
      }
    }
  }
  const tagNamesFilter = mergedTagNames.length === 0 ? "null" : JSON.stringify(mergedTagNames);
  const tagFilterModeFilter = escapeForJxa(tagFilterMode);
  const flaggedFilter = flagged === undefined ? "null" : flagged ? "true" : "false";
  const effectiveStatus =
    (completedBefore !== undefined || completedAfter !== undefined) && status !== "completed"
      ? "all"
      : status;
  const statusFilter = escapeForJxa(effectiveStatus);
  const dueBeforeFilter = dueBefore === undefined ? "null" : escapeForJxa(dueBefore);
  const dueAfterFilter = dueAfter === undefined ? "null" : escapeForJxa(dueAfter);
  const deferBeforeFilter = deferBefore === undefined ? "null" : escapeForJxa(deferBefore);
  const deferAfterFilter = deferAfter === undefined ? "null" : escapeForJxa(deferAfter);
  const completedBeforeFilter = completedBefore === undefined ? "null" : escapeForJxa(completedBefore);
  const completedAfterFilter = completedAfter === undefined ? "null" : escapeForJxa(completedAfter);
  const plannedBeforeFilter = plannedBefore === undefined ? "null" : escapeForJxa(plannedBefore);
  const plannedAfterFilter = plannedAfter === undefined ? "null" : escapeForJxa(plannedAfter);
  const maxEstimatedMinutesFilter = maxEstimatedMinutes === undefined ? "null" : String(maxEstimatedMinutes);
  const sortByFilter = effectiveSortBy === undefined ? "null" : escapeForJxa(effectiveSortBy);
  const sortOrderFilter = escapeForJxa(effectiveSortOrder);
  const script = `
const projectFilter = ${projectFilter};
const tagNames = ${tagNamesFilter};
const tagFilterMode = ${tagFilterModeFilter};
const flaggedFilter = ${flaggedFilter};
const statusFilter = ${statusFilter};
const dueBeforeRaw = ${dueBeforeFilter};
const dueAfterRaw = ${dueAfterFilter};
const deferBeforeRaw = ${deferBeforeFilter};
const deferAfterRaw = ${deferAfterFilter};
const completedBeforeRaw = ${completedBeforeFilter};
const completedAfterRaw = ${completedAfterFilter};
const plannedBeforeRaw = ${plannedBeforeFilter};
const plannedAfterRaw = ${plannedAfterFilter};
const maxEstimatedMinutes = ${maxEstimatedMinutesFilter};
const sortBy = ${sortByFilter};
const sortOrder = ${sortOrderFilter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(\`\${fieldName} must be a valid ISO 8601 date string.\`);
  }
  return parsed;
};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");
const plannedBefore = parseOptionalDate(plannedBeforeRaw, "plannedBefore");
const plannedAfter = parseOptionalDate(plannedAfterRaw, "plannedAfter");
const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;
const supportsPlannedDate = (() => {
  try {
    const sampleTask = document.flattenedTasks[0];
    if (!sampleTask) return true;
    void sampleTask.plannedDate;
    return true;
  } catch (e) {
    return false;
  }
})();
const getPlannedDate = (task) => {
  if (!supportsPlannedDate) return null;
  try {
    const value = task.plannedDate;
    return value === undefined ? null : value;
  } catch (e) {
    return null;
  }
};
const filteredTasks = document.flattenedTasks
  .filter(task => {
    if (projectFilter !== null) {
      const projectName = task.containingProject ? task.containingProject.name : null;
      if (projectName !== projectFilter) return false;
    }
    if (tagNames !== null && tagNames.length > 0) {
      let tagMatches = false;
      if (tagFilterMode === "all") {
        tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
      } else {
        tagMatches = task.tags.some(t => tagNames.includes(t.name));
      }
      if (!tagMatches) return false;
    }
    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;
    let statusMatches = false;
    if (statusFilter === "all") {
      statusMatches = true;
    } else if (statusFilter === "completed") {
      statusMatches = task.completed;
    } else if (task.completed) {
      statusMatches = includeCompletedForDateFilter;
    } else {
      const dueDate = task.dueDate;
      if (statusFilter === "available") {
        statusMatches = true;
      } else if (statusFilter === "overdue") {
        statusMatches = dueDate !== null && dueDate < now;
      } else if (statusFilter === "due_soon") {
        statusMatches = dueDate !== null && dueDate >= now && dueDate <= soon;
      }
    }
    if (!statusMatches) return false;
    if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) return false;
    if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) return false;
    if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) return false;
    if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) return false;
    if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) return false;
    if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return false;
    if (supportsPlannedDate) {
      const plannedDate = getPlannedDate(task);
      if (plannedBefore !== null && !(plannedDate !== null && plannedDate < plannedBefore)) return false;
      if (plannedAfter !== null && !(plannedDate !== null && plannedDate > plannedAfter)) return false;
    }
    if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;
    return true;
  });
const compareValues = (aValue, bValue, isString = false) => {
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  let left = aValue;
  let right = bValue;
  if (isString) {
    left = String(aValue).toLowerCase();
    right = String(bValue).toLowerCase();
  }
  if (left < right) return sortOrder === "asc" ? -1 : 1;
  if (left > right) return sortOrder === "asc" ? 1 : -1;
  return 0;
};
const sortedTasks = sortBy === null ? filteredTasks : filteredTasks.slice().sort((a, b) => {
  let aValue = null;
  let bValue = null;
  let isString = false;
  if (sortBy === "dueDate") {
    aValue = a.dueDate;
    bValue = b.dueDate;
  } else if (sortBy === "deferDate") {
    aValue = a.deferDate;
    bValue = b.deferDate;
  } else if (sortBy === "name") {
    aValue = a.name;
    bValue = b.name;
    isString = true;
  } else if (sortBy === "completionDate") {
    aValue = a.completionDate;
    bValue = b.completionDate;
  } else if (sortBy === "estimatedMinutes") {
    aValue = a.estimatedMinutes;
    bValue = b.estimatedMinutes;
  } else if (sortBy === "project") {
    aValue = a.containingProject ? a.containingProject.name : null;
    bValue = b.containingProject ? b.containingProject.name : null;
    isString = true;
  } else if (sortBy === "flagged") {
    aValue = a.flagged;
    bValue = b.flagged;
  }
  return compareValues(aValue, bValue, isString);
});
const tasks = sortedTasks.slice(0, ${limit});
return tasks.map(task => ({
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  completionDate: task.completionDate ? task.completionDate.toISOString() : null,
  plannedDate: (() => {
    const value = getPlannedDate(task);
    return value ? value.toISOString() : null;
  })(),
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(taskTag => taskTag.name),
  estimatedMinutes: task.estimatedMinutes,
  hasChildren: task.hasChildren,
  taskStatus: (() => {
    const s = String(task.taskStatus);
    if (s.includes("Available")) return "available";
    if (s.includes("Blocked")) return "blocked";
    if (s.includes("Next")) return "next";
    if (s.includes("DueSoon")) return "due_soon";
    if (s.includes("Overdue")) return "overdue";
    if (s.includes("Completed")) return "completed";
    if (s.includes("Dropped")) return "dropped";
    return "unknown";
  })()
}));
`.trim();
return runOmniJs(script);
}

export async function getTaskCountsData(
  project: string | undefined,
  tag: string | undefined,
  tags: string[] | undefined,
  tagFilterMode: "any" | "all" = "any",
  flagged: boolean | undefined,
  dueBefore: string | undefined,
  dueAfter: string | undefined,
  deferBefore: string | undefined,
  deferAfter: string | undefined,
  completedBefore: string | undefined,
  completedAfter: string | undefined,
  maxEstimatedMinutes: number | undefined
): Promise<unknown> {
  const projectFilter = project === undefined ? "null" : escapeForJxa(project.trim());
  const mergedTagNames: string[] = [];
  if (tag !== undefined) {
    const normalizedTag = tag.trim();
    if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
      mergedTagNames.push(normalizedTag);
    }
  }
  if (tags !== undefined) {
    for (const tagName of tags) {
      const normalizedTag = tagName.trim();
      if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
        mergedTagNames.push(normalizedTag);
      }
    }
  }
  const tagNamesFilter = mergedTagNames.length === 0 ? "null" : JSON.stringify(mergedTagNames);
  const tagFilterModeFilter = escapeForJxa(tagFilterMode);
  const flaggedFilter = flagged === undefined ? "null" : flagged ? "true" : "false";
  const dueBeforeFilter = dueBefore === undefined ? "null" : escapeForJxa(dueBefore);
  const dueAfterFilter = dueAfter === undefined ? "null" : escapeForJxa(dueAfter);
  const deferBeforeFilter = deferBefore === undefined ? "null" : escapeForJxa(deferBefore);
  const deferAfterFilter = deferAfter === undefined ? "null" : escapeForJxa(deferAfter);
  const completedBeforeFilter = completedBefore === undefined ? "null" : escapeForJxa(completedBefore);
  const completedAfterFilter = completedAfter === undefined ? "null" : escapeForJxa(completedAfter);
  const maxEstimatedMinutesFilter = maxEstimatedMinutes === undefined ? "null" : String(maxEstimatedMinutes);
  const script = `
const projectFilter = ${projectFilter};
const tagNames = ${tagNamesFilter};
const tagFilterMode = ${tagFilterModeFilter};
const flaggedFilter = ${flaggedFilter};
const dueBeforeRaw = ${dueBeforeFilter};
const dueAfterRaw = ${dueAfterFilter};
const deferBeforeRaw = ${deferBeforeFilter};
const deferAfterRaw = ${deferAfterFilter};
const completedBeforeRaw = ${completedBeforeFilter};
const completedAfterRaw = ${completedAfterFilter};
const maxEstimatedMinutes = ${maxEstimatedMinutesFilter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(\`\${fieldName} must be a valid ISO 8601 date string.\`);
  }
  return parsed;
};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");

const counts = {
  total: 0,
  available: 0,
  completed: 0,
  overdue: 0,
  dueSoon: 0,
  flagged: 0,
  deferred: 0
};

for (const task of document.flattenedTasks) {
  if (projectFilter !== null) {
    const projectName = task.containingProject ? task.containingProject.name : null;
    if (projectName !== projectFilter) continue;
  }

  if (tagNames !== null && tagNames.length > 0) {
    let tagMatches = false;
    if (tagFilterMode === "all") {
      tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
    } else {
      tagMatches = task.tags.some(t => tagNames.includes(t.name));
    }
    if (!tagMatches) continue;
  }

  if (flaggedFilter !== null && task.flagged !== flaggedFilter) continue;
  if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) continue;
  if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) continue;
  if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) continue;
  if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) continue;
  if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) continue;
  if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) continue;
  if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) continue;

  counts.total += 1;
  if (task.flagged) counts.flagged += 1;

  if (task.completed) {
    counts.completed += 1;
    continue;
  }

  const isAvailable = task.deferDate === null || task.deferDate <= now;
  if (isAvailable) counts.available += 1;

  if (task.deferDate !== null && task.deferDate > now) counts.deferred += 1;
  if (task.dueDate !== null && task.dueDate < now) counts.overdue += 1;
  if (task.dueDate !== null && task.dueDate >= now && task.dueDate <= soon) counts.dueSoon += 1;
}

return counts;
`.trim();
  return runOmniJs(script);
}

export async function searchTasksData(
  query: string,
  project: string | undefined,
  tag: string | undefined,
  tags: string[] | undefined,
  tagFilterMode: "any" | "all" = "any",
  flagged: boolean | undefined,
  status: TaskStatus,
  dueBefore: string | undefined,
  dueAfter: string | undefined,
  deferBefore: string | undefined,
  deferAfter: string | undefined,
  completedBefore: string | undefined,
  completedAfter: string | undefined,
  plannedBefore: string | undefined,
  plannedAfter: string | undefined,
  maxEstimatedMinutes: number | undefined,
  sortBy:
    | "dueDate"
    | "deferDate"
    | "name"
    | "completionDate"
    | "estimatedMinutes"
    | "project"
    | "flagged"
    | undefined,
  sortOrder: "asc" | "desc",
  limit: number
): Promise<unknown> {
  let effectiveSortBy = sortBy;
  let effectiveSortOrder = sortOrder;
  if ((completedBefore !== undefined || completedAfter !== undefined) && effectiveSortBy === undefined) {
    effectiveSortBy = "completionDate";
    effectiveSortOrder = "desc";
  }
  const projectFilter = project === undefined ? "null" : escapeForJxa(project.trim());
  const mergedTagNames: string[] = [];
  if (tag !== undefined) {
    const normalizedTag = tag.trim();
    if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
      mergedTagNames.push(normalizedTag);
    }
  }
  if (tags !== undefined) {
    for (const tagName of tags) {
      const normalizedTag = tagName.trim();
      if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
        mergedTagNames.push(normalizedTag);
      }
    }
  }
  const tagNamesFilter = mergedTagNames.length === 0 ? "null" : JSON.stringify(mergedTagNames);
  const tagFilterModeFilter = escapeForJxa(tagFilterMode);
  const flaggedFilter = flagged === undefined ? "null" : flagged ? "true" : "false";
  const effectiveStatus =
    (completedBefore !== undefined || completedAfter !== undefined) && status !== "completed"
      ? "all"
      : status;
  const statusFilter = escapeForJxa(effectiveStatus);
  const dueBeforeFilter = dueBefore === undefined ? "null" : escapeForJxa(dueBefore);
  const dueAfterFilter = dueAfter === undefined ? "null" : escapeForJxa(dueAfter);
  const deferBeforeFilter = deferBefore === undefined ? "null" : escapeForJxa(deferBefore);
  const deferAfterFilter = deferAfter === undefined ? "null" : escapeForJxa(deferAfter);
  const completedBeforeFilter = completedBefore === undefined ? "null" : escapeForJxa(completedBefore);
  const completedAfterFilter = completedAfter === undefined ? "null" : escapeForJxa(completedAfter);
  const plannedBeforeFilter = plannedBefore === undefined ? "null" : escapeForJxa(plannedBefore);
  const plannedAfterFilter = plannedAfter === undefined ? "null" : escapeForJxa(plannedAfter);
  const maxEstimatedMinutesFilter = maxEstimatedMinutes === undefined ? "null" : String(maxEstimatedMinutes);
  const sortByFilter = effectiveSortBy === undefined ? "null" : escapeForJxa(effectiveSortBy);
  const sortOrderFilter = escapeForJxa(effectiveSortOrder);
  const queryFilter = escapeForJxa(query.trim());
  const script = `
const queryFilter = ${queryFilter}.toLowerCase();
const projectFilter = ${projectFilter};
const tagNames = ${tagNamesFilter};
const tagFilterMode = ${tagFilterModeFilter};
const flaggedFilter = ${flaggedFilter};
const statusFilter = ${statusFilter};
const dueBeforeRaw = ${dueBeforeFilter};
const dueAfterRaw = ${dueAfterFilter};
const deferBeforeRaw = ${deferBeforeFilter};
const deferAfterRaw = ${deferAfterFilter};
const completedBeforeRaw = ${completedBeforeFilter};
const completedAfterRaw = ${completedAfterFilter};
const plannedBeforeRaw = ${plannedBeforeFilter};
const plannedAfterRaw = ${plannedAfterFilter};
const maxEstimatedMinutes = ${maxEstimatedMinutesFilter};
const sortBy = ${sortByFilter};
const sortOrder = ${sortOrderFilter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(\`\${fieldName} must be a valid ISO 8601 date string.\`);
  }
  return parsed;
};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");
const plannedBefore = parseOptionalDate(plannedBeforeRaw, "plannedBefore");
const plannedAfter = parseOptionalDate(plannedAfterRaw, "plannedAfter");
const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;
const supportsPlannedDate = (() => {
  try {
    const sampleTask = document.flattenedTasks[0];
    if (!sampleTask) return true;
    void sampleTask.plannedDate;
    return true;
  } catch (e) {
    return false;
  }
})();
const getPlannedDate = (task) => {
  if (!supportsPlannedDate) return null;
  try {
    const value = task.plannedDate;
    return value === undefined ? null : value;
  } catch (e) {
    return null;
  }
};
const filteredTasks = document.flattenedTasks
  .filter(task => {
    const name = (task.name || "").toLowerCase();
    const note = (task.note || "").toLowerCase();
    if (!(name.includes(queryFilter) || note.includes(queryFilter))) return false;
    if (projectFilter !== null) {
      const projectName = task.containingProject ? task.containingProject.name : null;
      if (projectName !== projectFilter) return false;
    }
    if (tagNames !== null && tagNames.length > 0) {
      let tagMatches = false;
      if (tagFilterMode === "all") {
        tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
      } else {
        tagMatches = task.tags.some(t => tagNames.includes(t.name));
      }
      if (!tagMatches) return false;
    }
    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;
    let statusMatches = false;
    if (statusFilter === "all") {
      statusMatches = true;
    } else if (statusFilter === "completed") {
      statusMatches = task.completed;
    } else if (task.completed) {
      statusMatches = includeCompletedForDateFilter;
    } else {
      const dueDate = task.dueDate;
      if (statusFilter === "available") {
        statusMatches = true;
      } else if (statusFilter === "overdue") {
        statusMatches = dueDate !== null && dueDate < now;
      } else if (statusFilter === "due_soon") {
        statusMatches = dueDate !== null && dueDate >= now && dueDate <= soon;
      }
    }
    if (!statusMatches) return false;
    if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) return false;
    if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) return false;
    if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) return false;
    if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) return false;
    if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) return false;
    if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return false;
    if (supportsPlannedDate) {
      const plannedDate = getPlannedDate(task);
      if (plannedBefore !== null && !(plannedDate !== null && plannedDate < plannedBefore)) return false;
      if (plannedAfter !== null && !(plannedDate !== null && plannedDate > plannedAfter)) return false;
    }
    if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;
    return true;
  });
const compareValues = (aValue, bValue, isString = false) => {
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  let left = aValue;
  let right = bValue;
  if (isString) {
    left = String(aValue).toLowerCase();
    right = String(bValue).toLowerCase();
  }
  if (left < right) return sortOrder === "asc" ? -1 : 1;
  if (left > right) return sortOrder === "asc" ? 1 : -1;
  return 0;
};
const sortedTasks = sortBy === null ? filteredTasks : filteredTasks.slice().sort((a, b) => {
  let aValue = null;
  let bValue = null;
  let isString = false;
  if (sortBy === "dueDate") {
    aValue = a.dueDate;
    bValue = b.dueDate;
  } else if (sortBy === "deferDate") {
    aValue = a.deferDate;
    bValue = b.deferDate;
  } else if (sortBy === "name") {
    aValue = a.name;
    bValue = b.name;
    isString = true;
  } else if (sortBy === "completionDate") {
    aValue = a.completionDate;
    bValue = b.completionDate;
  } else if (sortBy === "estimatedMinutes") {
    aValue = a.estimatedMinutes;
    bValue = b.estimatedMinutes;
  } else if (sortBy === "project") {
    aValue = a.containingProject ? a.containingProject.name : null;
    bValue = b.containingProject ? b.containingProject.name : null;
    isString = true;
  } else if (sortBy === "flagged") {
    aValue = a.flagged;
    bValue = b.flagged;
  }
  return compareValues(aValue, bValue, isString);
});
const tasks = sortedTasks.slice(0, ${limit});
return tasks.map(task => ({
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  completionDate: task.completionDate ? task.completionDate.toISOString() : null,
  plannedDate: (() => {
    const value = getPlannedDate(task);
    return value ? value.toISOString() : null;
  })(),
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(taskTag => taskTag.name),
  estimatedMinutes: task.estimatedMinutes,
  hasChildren: task.hasChildren,
  taskStatus: (() => {
    const s = String(task.taskStatus);
    if (s.includes("Available")) return "available";
    if (s.includes("Blocked")) return "blocked";
    if (s.includes("Next")) return "next";
    if (s.includes("DueSoon")) return "due_soon";
    if (s.includes("Overdue")) return "overdue";
    if (s.includes("Completed")) return "completed";
    if (s.includes("Dropped")) return "dropped";
    return "unknown";
  })()
}));
`.trim();
return runOmniJs(script);
}

async function getTaskCountsDataLegacy3(
  project: string | undefined,
  tag: string | undefined,
  tags: string[] | undefined,
  tagFilterMode: "any" | "all" = "any",
  flagged: boolean | undefined,
  dueBefore: string | undefined,
  dueAfter: string | undefined,
  deferBefore: string | undefined,
  deferAfter: string | undefined,
  completedBefore: string | undefined,
  completedAfter: string | undefined,
  maxEstimatedMinutes: number | undefined
): Promise<unknown> {
  const projectFilter = project === undefined ? "null" : escapeForJxa(project.trim());
  const mergedTagNames: string[] = [];
  if (tag !== undefined) {
    const normalizedTag = tag.trim();
    if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
      mergedTagNames.push(normalizedTag);
    }
  }
  if (tags !== undefined) {
    for (const tagName of tags) {
      const normalizedTag = tagName.trim();
      if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
        mergedTagNames.push(normalizedTag);
      }
    }
  }
  const tagNamesFilter = mergedTagNames.length === 0 ? "null" : JSON.stringify(mergedTagNames);
  const tagFilterModeFilter = escapeForJxa(tagFilterMode);
  const flaggedFilter = flagged === undefined ? "null" : flagged ? "true" : "false";
  const dueBeforeFilter = dueBefore === undefined ? "null" : escapeForJxa(dueBefore);
  const dueAfterFilter = dueAfter === undefined ? "null" : escapeForJxa(dueAfter);
  const deferBeforeFilter = deferBefore === undefined ? "null" : escapeForJxa(deferBefore);
  const deferAfterFilter = deferAfter === undefined ? "null" : escapeForJxa(deferAfter);
  const completedBeforeFilter = completedBefore === undefined ? "null" : escapeForJxa(completedBefore);
  const completedAfterFilter = completedAfter === undefined ? "null" : escapeForJxa(completedAfter);
  const maxEstimatedMinutesFilter = maxEstimatedMinutes === undefined ? "null" : String(maxEstimatedMinutes);
  const script = `
const projectFilter = ${projectFilter};
const tagNames = ${tagNamesFilter};
const tagFilterMode = ${tagFilterModeFilter};
const flaggedFilter = ${flaggedFilter};
const dueBeforeRaw = ${dueBeforeFilter};
const dueAfterRaw = ${dueAfterFilter};
const deferBeforeRaw = ${deferBeforeFilter};
const deferAfterRaw = ${deferAfterFilter};
const completedBeforeRaw = ${completedBeforeFilter};
const completedAfterRaw = ${completedAfterFilter};
const maxEstimatedMinutes = ${maxEstimatedMinutesFilter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(\`\${fieldName} must be a valid ISO 8601 date string.\`);
  }
  return parsed;
};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");
const filteredTasks = document.flattenedTasks
  .filter(task => {
    if (projectFilter !== null) {
      const projectName = task.containingProject ? task.containingProject.name : null;
      if (projectName !== projectFilter) return false;
    }
    if (tagNames !== null && tagNames.length > 0) {
      let tagMatches = false;
      if (tagFilterMode === "all") {
        tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
      } else {
        tagMatches = task.tags.some(t => tagNames.includes(t.name));
      }
      if (!tagMatches) return false;
    }
    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;
    if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) return false;
    if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) return false;
    if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) return false;
    if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) return false;
    if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) return false;
    if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return false;
    if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;
    return true;
  });
const counts = {
  total: 0,
  available: 0,
  completed: 0,
  overdue: 0,
  dueSoon: 0,
  flagged: 0,
  deferred: 0
};
filteredTasks.forEach(task => {
  counts.total += 1;
  if (task.completed) counts.completed += 1;
  if (task.flagged) counts.flagged += 1;
  if (!task.completed) {
    const dueDate = task.dueDate;
    const deferDate = task.deferDate;
    const isDeferred = deferDate !== null && deferDate > now;
    if (!isDeferred) counts.available += 1;
    if (isDeferred) counts.deferred += 1;
    if (dueDate !== null && dueDate < now) counts.overdue += 1;
    if (dueDate !== null && dueDate >= now && dueDate <= soon) counts.dueSoon += 1;
  }
});
return counts;
`.trim();
  return runOmniJs(script);
}

async function getTaskCountsDataLegacy4(
  project: string | undefined,
  tag: string | undefined,
  tags: string[] | undefined,
  tagFilterMode: "any" | "all" = "any",
  flagged: boolean | undefined,
  dueBefore: string | undefined,
  dueAfter: string | undefined,
  deferBefore: string | undefined,
  deferAfter: string | undefined,
  completedBefore: string | undefined,
  completedAfter: string | undefined,
  maxEstimatedMinutes: number | undefined
): Promise<unknown> {
  const projectFilter = project === undefined ? "null" : escapeForJxa(project.trim());
  const mergedTagNames: string[] = [];
  if (tag !== undefined) {
    const normalizedTag = tag.trim();
    if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
      mergedTagNames.push(normalizedTag);
    }
  }
  if (tags !== undefined) {
    for (const tagName of tags) {
      const normalizedTag = tagName.trim();
      if (normalizedTag.length > 0 && !mergedTagNames.includes(normalizedTag)) {
        mergedTagNames.push(normalizedTag);
      }
    }
  }
  const tagNamesFilter = mergedTagNames.length === 0 ? "null" : JSON.stringify(mergedTagNames);
  const tagFilterModeFilter = escapeForJxa(tagFilterMode);
  const flaggedFilter = flagged === undefined ? "null" : flagged ? "true" : "false";
  const dueBeforeFilter = dueBefore === undefined ? "null" : escapeForJxa(dueBefore);
  const dueAfterFilter = dueAfter === undefined ? "null" : escapeForJxa(dueAfter);
  const deferBeforeFilter = deferBefore === undefined ? "null" : escapeForJxa(deferBefore);
  const deferAfterFilter = deferAfter === undefined ? "null" : escapeForJxa(deferAfter);
  const completedBeforeFilter = completedBefore === undefined ? "null" : escapeForJxa(completedBefore);
  const completedAfterFilter = completedAfter === undefined ? "null" : escapeForJxa(completedAfter);
  const maxEstimatedMinutesFilter = maxEstimatedMinutes === undefined ? "null" : String(maxEstimatedMinutes);
  const script = `
const projectFilter = ${projectFilter};
const tagNames = ${tagNamesFilter};
const tagFilterMode = ${tagFilterModeFilter};
const flaggedFilter = ${flaggedFilter};
const dueBeforeRaw = ${dueBeforeFilter};
const dueAfterRaw = ${dueAfterFilter};
const deferBeforeRaw = ${deferBeforeFilter};
const deferAfterRaw = ${deferAfterFilter};
const completedBeforeRaw = ${completedBeforeFilter};
const completedAfterRaw = ${completedAfterFilter};
const maxEstimatedMinutes = ${maxEstimatedMinutesFilter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(\`\${fieldName} must be a valid ISO 8601 date string.\`);
  }
  return parsed;
};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");
const counts = {
  total: 0,
  available: 0,
  completed: 0,
  overdue: 0,
  dueSoon: 0,
  flagged: 0,
  deferred: 0
};
document.flattenedTasks.forEach(task => {
  if (projectFilter !== null) {
    const projectName = task.containingProject ? task.containingProject.name : null;
    if (projectName !== projectFilter) return;
  }
  if (tagNames !== null && tagNames.length > 0) {
    let tagMatches = false;
    if (tagFilterMode === "all") {
      tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
    } else {
      tagMatches = task.tags.some(t => tagNames.includes(t.name));
    }
    if (!tagMatches) return;
  }
  if (flaggedFilter !== null && task.flagged !== flaggedFilter) return;
  if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) return;
  if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) return;
  if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) return;
  if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) return;
  if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) return;
  if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return;
  if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return;
  counts.total += 1;
  if (task.completed) counts.completed += 1;
  if (task.flagged) counts.flagged += 1;
  if (!task.completed) {
    const dueDate = task.dueDate;
    const deferDate = task.deferDate;
    const isDeferred = deferDate !== null && deferDate > now;
    if (!isDeferred) counts.available += 1;
    if (isDeferred) counts.deferred += 1;
    if (dueDate !== null && dueDate < now) counts.overdue += 1;
    if (dueDate !== null && dueDate >= now && dueDate <= soon) counts.dueSoon += 1;
  }
});
return counts;
`.trim();
  return runOmniJs(script);
}
