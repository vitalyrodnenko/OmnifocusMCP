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
    "list tasks with optional filters for project, tag, flagged state, and status.",
    {
      project: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
      flagged: z.boolean().optional(),
      status: z.enum(["available", "due_soon", "overdue", "completed", "all"]).default("available"),
      limit: z.number().int().min(1).default(100),
    },
    async ({ project, tag, flagged, status, limit }) => {
      try {
        return textResult(await listTasksData(project, tag, flagged, status, limit));
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
  completed: task.completed,
  completionDate: task.completionDate ? task.completionDate.toISOString() : null,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes,
  children: task.children.map(child => ({ id: child.id.primaryKey, name: child.name })),
  parentName: task.parentTask ? task.parentTask.name : null,
  sequential: task.sequential,
  repetitionRule: task.repetitionRule ? String(task.repetitionRule) : null
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
    hasChildren: subtask.hasChildren
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
    "search_tasks",
    "search tasks by case-insensitive query across name and note.",
    { query: z.string().min(1), limit: z.number().int().min(1).default(100) },
    async ({ query, limit }) => {
      try {
        const queryFilter = escapeForJxa(query.toLowerCase());
        const script = `
const queryFilter = ${queryFilter};
const tasks = document.flattenedTasks
  .filter(task => {
    const name = (task.name || "").toLowerCase();
    const note = (task.note || "").toLowerCase();
    return name.includes(queryFilter) || note.includes(queryFilter);
  })
  .slice(0, ${limit});
return tasks.map(task => ({
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
}));
`.trim();
        return textResult(await runOmniJs(script));
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
    "set or clear a task repetition rule by id.",
    {
      task_id: z.string().min(1),
      rule_string: z.string().min(1).nullable(),
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
        if (rule_string !== null && schedule_type === "none") {
          throw new Error(
            "schedule_type must be regularly or from_completion when rule_string is provided."
          );
        }
        const taskId = escapeForJxa(normalizedTaskId);
        const ruleString = rule_string === null ? "null" : escapeForJxa(rule_string.trim());
        const scheduleType = escapeForJxa(schedule_type);
        const script = `
const taskId = ${taskId};
const ruleString = ${ruleString};
const scheduleType = ${scheduleType};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {
  throw new Error(\`Task not found: \${taskId}\`);
}
if (ruleString === null) {
  task.repetitionRule = null;
} else {
  const repetitionScheduleType = (() => {
    if (scheduleType === "regularly") return Task.RepetitionScheduleType.Regularly;
    if (scheduleType === "from_completion") return Task.RepetitionScheduleType.FromCompletion;
    throw new Error(\`Invalid schedule_type: \${scheduleType}\`);
  })();
  task.repetitionRule = new Task.RepetitionRule(ruleString, null, repetitionScheduleType, null, false);
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
    "set_task_repetition",
    "set or clear a task repetition rule by task id.",
    {
      task_id: z.string().min(1),
      rule_string: z.string().nullable().default(null),
      schedule_type: z.enum(["regularly", "from_completion", "none"]).default("regularly"),
    },
    async ({ task_id, rule_string, schedule_type }) => {
      try {
        if (rule_string !== null && rule_string.trim() === "") {
          throw new Error("rule_string must not be empty when provided.");
        }
        const taskId = escapeForJxa(task_id.trim());
        const ruleString = rule_string === null ? "null" : escapeForJxa(rule_string);
        const scheduleTypeInput = escapeForJxa(schedule_type);
        const script = `
const taskId = ${taskId};
const ruleString = ${ruleString};
const scheduleTypeInput = ${scheduleTypeInput};
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
    if (scheduleTypeInput === "none") return null;
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
task.drop(false);
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
const results = taskIds.map(taskId => {
  const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
  if (!task) {
    return {
      id: taskId,
      deleted: false,
      error: "not found"
    };
  }

  const taskName = task.name;
  task.drop(false);
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
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes
}));
`.trim();
  return runOmniJs(script);
}

export async function listTasksData(
  project: string | undefined,
  tag: string | undefined,
  flagged: boolean | undefined,
  status: TaskStatus,
  limit: number
): Promise<unknown> {
  const projectFilter = project === undefined ? "null" : escapeForJxa(project.trim());
  const tagFilter = tag === undefined ? "null" : escapeForJxa(tag.trim());
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
      const taskTags = task.tags.map(taskTag => taskTag.name);
      if (!taskTags.includes(tagFilter)) return false;
    }
    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;
    if (statusFilter === "all") return true;
    if (statusFilter === "completed") return task.completed;
    if (task.completed) return false;
    if (statusFilter === "available") return true;
    const dueDate = task.dueDate;
    if (statusFilter === "overdue") return dueDate !== null && dueDate < now;
    if (statusFilter === "due_soon") return dueDate !== null && dueDate >= now && dueDate <= soon;
    return false;
  })
  .slice(0, ${limit});
return tasks.map(task => ({
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  completed: task.completed,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(taskTag => taskTag.name),
  estimatedMinutes: task.estimatedMinutes
}));
`.trim();
  return runOmniJs(script);
}
