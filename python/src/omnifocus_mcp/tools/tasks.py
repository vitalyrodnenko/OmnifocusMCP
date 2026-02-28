import json
from typing import Any, Literal

from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs
from omnifocus_mcp.registration import typed_tool
from omnifocus_mcp.app import mcp


@typed_tool(mcp)
async def get_inbox(limit: int = 100) -> str:
    """get inbox tasks from omnifocus.

    returns unprocessed inbox tasks with id, name, note, flagged state, due/defer
    dates, tag names, and estimated minutes. limit controls max returned tasks.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const tasks = inbox
  .filter(task => !task.completed)
  .slice(0, {limit});

return tasks.map(task => {{
  const tags = task.tags.map(tag => tag.name);
  return {{
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    tags: tags,
    estimatedMinutes: task.estimatedMinutes
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def list_tasks(
    project: str | None = None,
    tag: str | None = None,
    flagged: bool | None = None,
    status: Literal[
        "available", "due_soon", "overdue", "completed", "all"
    ] = "available",
    limit: int = 100,
) -> str:
    """list tasks with optional project, tag, flagged, and status filters.

    returns tasks with id, name, note, flagged state, due/defer dates,
    completion state, project name, tag names, and estimated minutes.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")
    if project is not None and project.strip() == "":
        raise ValueError("project must not be empty when provided.")
    if tag is not None and tag.strip() == "":
        raise ValueError("tag must not be empty when provided.")
    if status not in ("available", "due_soon", "overdue", "completed", "all"):
        raise ValueError(
            "status must be one of: available, due_soon, overdue, completed, all."
        )

    project_filter = "null" if project is None else escape_for_jxa(project)
    tag_filter = "null" if tag is None else escape_for_jxa(tag)
    flagged_filter = "null" if flagged is None else ("true" if flagged else "false")
    status_filter = escape_for_jxa(status)

    script = f"""
const projectFilter = {project_filter};
const tagFilter = {tag_filter};
const flaggedFilter = {flagged_filter};
const statusFilter = {status_filter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

const tasks = document.flattenedTasks
  .filter(task => {{
    if (projectFilter !== null) {{
      const projectName = task.containingProject ? task.containingProject.name : null;
      if (projectName !== projectFilter) return false;
    }}

    if (tagFilter !== null) {{
      const hasTag = task.tags.some(taskTag => taskTag.name === tagFilter);
      if (!hasTag) return false;
    }}

    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;

    if (statusFilter === "all") return true;
    if (statusFilter === "completed") return task.completed;
    if (task.completed) return false;

    const dueDate = task.dueDate;
    if (statusFilter === "available") return true;
    if (statusFilter === "overdue") return dueDate !== null && dueDate < now;
    if (statusFilter === "due_soon") {{
      return dueDate !== null && dueDate >= now && dueDate <= soon;
    }}
    return false;
  }})
  .slice(0, {limit});

return tasks.map(task => {{
  const tags = task.tags.map(taskTag => taskTag.name);
  return {{
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
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def get_task(task_id: str) -> str:
    """get full details for a single task by id.

    returns list_tasks fields plus children, parent name, sequential state,
    repetition rule, and completion date.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")

    task_id_filter = escape_for_jxa(task_id)
    script = f"""
const taskId = {task_id_filter};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}

const children = task.children.map(child => {{
  return {{
    id: child.id.primaryKey,
    name: child.name,
    completed: child.completed
  }};
}});

const repetitionRule = task.repetitionRule ? String(task.repetitionRule) : null;

return {{
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
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def search_tasks(query: str, limit: int = 100) -> str:
    """search task names and notes with case-insensitive matching.

    returns matching tasks with the standard list_tasks fields.
    """
    if query.strip() == "":
        raise ValueError("query must not be empty.")
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    query_filter = escape_for_jxa(query.strip())
    script = f"""
const query = {query_filter}.toLowerCase();

const tasks = document.flattenedTasks
  .filter(task => {{
    const name = (task.name || "").toLowerCase();
    const note = (task.note || "").toLowerCase();
    return name.includes(query) || note.includes(query);
  }})
  .slice(0, {limit});

return tasks.map(task => {{
  const tags = task.tags.map(taskTag => taskTag.name);
  return {{
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
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def create_task(
    name: str,
    project: str | None = None,
    note: str | None = None,
    dueDate: str | None = None,
    deferDate: str | None = None,
    flagged: bool | None = None,
    tags: list[str] | None = None,
    estimatedMinutes: int | None = None,
) -> str:
    """create a new task in inbox or a named project.

    accepts required name and optional project, note, dates, flagged state,
    tags, and estimated minutes. returns the created task id and name.
    """
    if name.strip() == "":
        raise ValueError("name must not be empty.")
    if project is not None and project.strip() == "":
        raise ValueError("project must not be empty when provided.")

    task_name = escape_for_jxa(name.strip())
    project_name = "null" if project is None else escape_for_jxa(project.strip())
    note_value = "null" if note is None else escape_for_jxa(note)
    due_date_value = "null" if dueDate is None else escape_for_jxa(dueDate)
    defer_date_value = "null" if deferDate is None else escape_for_jxa(deferDate)
    flagged_value = "null" if flagged is None else ("true" if flagged else "false")
    tags_value = "null" if tags is None else json.dumps(tags)
    estimated_minutes_value = (
        "null" if estimatedMinutes is None else str(estimatedMinutes)
    )

    script = f"""
const taskName = {task_name};
const projectName = {project_name};
const noteValue = {note_value};
const dueDateValue = {due_date_value};
const deferDateValue = {defer_date_value};
const flaggedValue = {flagged_value};
const tagNames = {tags_value};
const estimatedMinutesValue = {estimated_minutes_value};

const parent = (() => {{
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {{
    throw new Error(`Project not found: ${{projectName}}`);
  }}
  return targetProject.ending;
}})();

const task = new Task(taskName, parent);

if (noteValue !== null) task.note = noteValue;
if (dueDateValue !== null) task.dueDate = new Date(dueDateValue);
if (deferDateValue !== null) task.deferDate = new Date(deferDateValue);
if (flaggedValue !== null) task.flagged = flaggedValue;
if (estimatedMinutesValue !== null) task.estimatedMinutes = estimatedMinutesValue;

if (tagNames !== null) {{
  tagNames.forEach(tagName => {{
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  }});
}}

return {{
  id: task.id.primaryKey,
  name: task.name
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def create_tasks_batch(
    tasks: list[dict[str, Any]],
) -> str:
    """create multiple tasks in a single omnijs call for efficiency.

    accepts an array of task definitions using create_task fields and returns
    an array of created task summaries with id and name.
    """
    if len(tasks) == 0:
        raise ValueError("tasks must contain at least one task definition.")

    normalized_tasks: list[dict[str, Any]] = []
    for task in tasks:
        name_value = task.get("name")
        if not isinstance(name_value, str) or name_value.strip() == "":
            raise ValueError("each task must include a non-empty name.")

        project_value = task.get("project")
        if project_value is not None and not isinstance(project_value, str):
            raise ValueError("task project must be a string when provided.")

        note_value = task.get("note")
        if note_value is not None and not isinstance(note_value, str):
            raise ValueError("task note must be a string when provided.")

        due_date_value = task.get("dueDate")
        if due_date_value is not None and not isinstance(due_date_value, str):
            raise ValueError("task dueDate must be an ISO 8601 string when provided.")

        defer_date_value = task.get("deferDate")
        if defer_date_value is not None and not isinstance(defer_date_value, str):
            raise ValueError("task deferDate must be an ISO 8601 string when provided.")

        flagged_value = task.get("flagged")
        if flagged_value is not None and not isinstance(flagged_value, bool):
            raise ValueError("task flagged must be a boolean when provided.")

        estimated_minutes_value = task.get("estimatedMinutes")
        if estimated_minutes_value is not None and not isinstance(
            estimated_minutes_value, int
        ):
            raise ValueError("task estimatedMinutes must be an integer when provided.")

        tags_value = task.get("tags")
        if tags_value is not None:
            if not isinstance(tags_value, list) or not all(
                isinstance(tag, str) for tag in tags_value
            ):
                raise ValueError("task tags must be an array of strings when provided.")

        normalized_tasks.append(
            {
                "name": name_value.strip(),
                "project": None if project_value is None else project_value.strip(),
                "note": note_value,
                "dueDate": due_date_value,
                "deferDate": defer_date_value,
                "flagged": flagged_value,
                "tags": tags_value,
                "estimatedMinutes": estimated_minutes_value,
            }
        )

    tasks_value = json.dumps(normalized_tasks)

    script = f"""
const taskInputs = {tasks_value};

const resolveParent = (projectName) => {{
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {{
    throw new Error(`Project not found: ${{projectName}}`);
  }}
  return targetProject.ending;
}};

const created = taskInputs.map(input => {{
  const parent = resolveParent(input.project);
  const task = new Task(input.name, parent);

  if (input.note !== null && input.note !== undefined) task.note = input.note;
  if (input.dueDate !== null && input.dueDate !== undefined) task.dueDate = new Date(input.dueDate);
  if (input.deferDate !== null && input.deferDate !== undefined) task.deferDate = new Date(input.deferDate);
  if (input.flagged !== null && input.flagged !== undefined) task.flagged = input.flagged;
  if (input.estimatedMinutes !== null && input.estimatedMinutes !== undefined) {{
    task.estimatedMinutes = input.estimatedMinutes;
  }}

  if (input.tags !== null && input.tags !== undefined) {{
    input.tags.forEach(tagName => {{
      const tag = document.flattenedTags.byName(tagName);
      if (tag) task.addTag(tag);
    }});
  }}

  return {{
    id: task.id.primaryKey,
    name: task.name
  }};
}});

return created;
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def complete_task(task_id: str) -> str:
    """complete a task by id and return completion confirmation.

    marks the task complete (including repeating-task rollover behavior in
    omnifocus) and returns the completed task id and name.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")

    task_id_value = escape_for_jxa(task_id.strip())

    script = f"""
const taskId = {task_id_value};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}

task.markComplete();

return {{
  id: task.id.primaryKey,
  name: task.name,
  completed: task.completed
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def update_task(
    task_id: str,
    name: str | None = None,
    note: str | None = None,
    dueDate: str | None = None,
    deferDate: str | None = None,
    flagged: bool | None = None,
    tags: list[str] | None = None,
    estimatedMinutes: int | None = None,
) -> str:
    """update a task by id, modifying only provided fields.

    accepts optional updates for name, note, dates, flagged state, tags, and
    estimated minutes. returns the updated task fields.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")
    if name is not None and name.strip() == "":
        raise ValueError("name must not be empty when provided.")

    updates: dict[str, Any] = {}
    if name is not None:
        updates["name"] = name.strip()
    if note is not None:
        updates["note"] = note
    if dueDate is not None:
        updates["dueDate"] = dueDate
    if deferDate is not None:
        updates["deferDate"] = deferDate
    if flagged is not None:
        updates["flagged"] = flagged
    if tags is not None:
        updates["tags"] = tags
    if estimatedMinutes is not None:
        updates["estimatedMinutes"] = estimatedMinutes

    task_id_value = escape_for_jxa(task_id.strip())
    updates_value = json.dumps(updates)

    script = f"""
const taskId = {task_id_value};
const updates = {updates_value};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}

const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);

if (has("name")) task.name = updates.name;
if (has("note")) task.note = updates.note;
if (has("dueDate")) task.dueDate = new Date(updates.dueDate);
if (has("deferDate")) task.deferDate = new Date(updates.deferDate);
if (has("flagged")) task.flagged = updates.flagged;
if (has("estimatedMinutes")) task.estimatedMinutes = updates.estimatedMinutes;

if (has("tags")) {{
  const existingTags = task.tags.slice();
  existingTags.forEach(tag => {{
    task.removeTag(tag);
  }});
  updates.tags.forEach(tagName => {{
    const tag = document.flattenedTags.byName(tagName);
    if (tag) task.addTag(tag);
  }});
}}

return {{
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
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def delete_task(task_id: str) -> str:
    """delete a task by id and return a confirmation payload.

    if the task has children, the response includes a warning message.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")

    task_id_value = escape_for_jxa(task_id.strip())

    script = f"""
const taskId = {task_id_value};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}

const taskName = task.name;
const childCount = task.children.length;
const warning = childCount > 0
  ? `Deleted task had ${{childCount}} child task(s).`
  : null;

task.drop(false);

return {{
  id: taskId,
  name: taskName,
  deleted: true,
  warning: warning
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def move_task(task_id: str, project: str | None = None) -> str:
    """move a task to a named project or back to inbox.

    accepts a task id and optional project name. when project is omitted, the
    task is moved to inbox.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")
    if project is not None and project.strip() == "":
        raise ValueError("project must not be empty when provided.")

    task_id_value = escape_for_jxa(task_id.strip())
    project_value = "null" if project is None else escape_for_jxa(project.strip())

    script = f"""
const taskId = {task_id_value};
const projectName = {project_value};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}

const destination = (() => {{
  if (projectName === null || projectName === "") return inbox.ending;
  const targetProject = document.flattenedProjects.byName(projectName);
  if (!targetProject) {{
    throw new Error(`Project not found: ${{projectName}}`);
  }}
  return targetProject.ending;
}})();

moveTasks([task], destination);

return {{
  id: task.id.primaryKey,
  name: task.name,
  projectName: task.containingProject ? task.containingProject.name : null,
  inInbox: task.inInbox
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
