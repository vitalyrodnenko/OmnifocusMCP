import json
from typing import Any, Callable, Literal, TypeVar, cast

from mcp.server.fastmcp import FastMCP  # type: ignore[import-not-found]

from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs


F = TypeVar("F", bound=Callable[..., Any])


def _typed_tool(server: Any) -> Callable[[F], F]:
    return cast(Callable[[F], F], server.tool())


mcp = FastMCP("omnifocus-mcp")


@_typed_tool(mcp)
async def ping() -> dict[str, str]:
    return {"status": "ok", "message": "pong"}


@_typed_tool(mcp)
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


@_typed_tool(mcp)
async def list_tasks(
    project: str | None = None,
    tag: str | None = None,
    flagged: bool | None = None,
    status: Literal["available", "due_soon", "overdue", "completed", "all"] = "available",
    limit: int = 100,
) -> str:
    """list tasks with optional project, tag, flagged, and status filters.

    returns tasks with id, name, note, flagged state, due/defer dates,
    completion state, project name, tag names, and estimated minutes.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")
    if status not in ("available", "due_soon", "overdue", "completed", "all"):
        raise ValueError("status must be one of: available, due_soon, overdue, completed, all.")

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


@_typed_tool(mcp)
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


@_typed_tool(mcp)
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


@_typed_tool(mcp)
async def list_projects(
    folder: str | None = None,
    status: Literal["active", "on_hold", "completed", "dropped"] = "active",
    limit: int = 100,
) -> str:
    """list projects with optional folder and status filters.

    returns projects with id, name, status, folder name, task counts, defer/due
    dates, note, sequential state, and review interval.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")
    if status not in ("active", "on_hold", "completed", "dropped"):
        raise ValueError("status must be one of: active, on_hold, completed, dropped.")

    folder_filter = "null" if folder is None else escape_for_jxa(folder)
    status_filter = escape_for_jxa(status)

    script = f"""
const folderFilter = {folder_filter};
const statusFilter = {status_filter};

const projectCounts = new Map();
document.flattenedTasks.forEach(task => {{
  const project = task.containingProject;
  if (!project) return;
  const projectId = project.id.primaryKey;
  const current = projectCounts.get(projectId) || {{ taskCount: 0, remainingTaskCount: 0 }};
  current.taskCount += 1;
  if (!task.completed) current.remainingTaskCount += 1;
  projectCounts.set(projectId, current);
}});

const normalizeProjectStatus = (project) => {{
  const rawStatus = String(project.status || "").toLowerCase();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {{
    return "on_hold";
  }}
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

const projects = document.flattenedProjects
  .filter(project => {{
    if (folderFilter !== null) {{
      const folderName = project.folder ? project.folder.name : null;
      if (folderName !== folderFilter) return false;
    }}
    return normalizeProjectStatus(project) === statusFilter;
  }})
  .slice(0, {limit});

return projects.map(project => {{
  const projectId = project.id.primaryKey;
  const counts = projectCounts.get(projectId) || {{ taskCount: 0, remainingTaskCount: 0 }};
  const reviewInterval = project.reviewInterval;
  return {{
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
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@_typed_tool(mcp)
async def get_project(project_id_or_name: str) -> str:
    """get full details for a single project by id or name.

    returns project metadata plus root-level tasks for planning and review.
    """
    if project_id_or_name.strip() == "":
        raise ValueError("project_id_or_name must not be empty.")

    project_filter = escape_for_jxa(project_id_or_name.strip())
    script = f"""
const projectFilter = {project_filter};
const project = document.flattenedProjects.find(item => {{
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
}});
if (!project) {{
  throw new Error(`Project not found: ${{projectFilter}}`);
}}

const normalizeProjectStatus = (item) => {{
  const rawStatus = String(item.status || "").toLowerCase();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {{
    return "on_hold";
  }}
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

const allProjectTasks = document.flattenedTasks.filter(task => {{
  return task.containingProject && task.containingProject.id.primaryKey === project.id.primaryKey;
}});

const rootTasks = project.tasks.map(task => {{
  return {{
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    completed: task.completed,
    tags: task.tags.map(tag => tag.name),
    estimatedMinutes: task.estimatedMinutes
  }};
}});

const reviewInterval = project.reviewInterval;
return {{
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
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@_typed_tool(mcp)
async def list_tags(limit: int = 100) -> str:
    """list tags with hierarchy, task availability counts, and status.

    returns tag id, name, parent tag name, available task count, and status.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const tagCounts = new Map();
document.flattenedTasks.forEach(task => {{
  if (task.completed) return;
  task.tags.forEach(tag => {{
    const tagId = tag.id.primaryKey;
    const current = tagCounts.get(tagId) || 0;
    tagCounts.set(tagId, current + 1);
  }});
}});

const normalizeTagStatus = (tag) => {{
  const rawStatus = String(tag.status || "").toLowerCase().trim();
  if (rawStatus === "") return "active";
  return rawStatus.replace(/\\s+/g, "_");
}};

const tags = document.flattenedTags.slice(0, {limit});
return tags.map(tag => {{
  return {{
    id: tag.id.primaryKey,
    name: tag.name,
    parent: tag.parent ? tag.parent.name : null,
    availableTaskCount: tagCounts.get(tag.id.primaryKey) || 0,
    status: normalizeTagStatus(tag)
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@_typed_tool(mcp)
async def list_folders(limit: int = 100) -> str:
    """list folder hierarchy and project counts.

    returns folder id, name, parent folder name, and contained project count.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const folderProjectCounts = new Map();
document.flattenedProjects.forEach(project => {{
  const folder = project.folder;
  if (!folder) return;
  const folderId = folder.id.primaryKey;
  const current = folderProjectCounts.get(folderId) || 0;
  folderProjectCounts.set(folderId, current + 1);
}});

const folders = document.flattenedFolders.slice(0, {limit});
return folders.map(folder => {{
  return {{
    id: folder.id.primaryKey,
    name: folder.name,
    parentName: folder.parent ? folder.parent.name : null,
    projectCount: folderProjectCounts.get(folder.id.primaryKey) || 0
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@_typed_tool(mcp)
async def get_forecast(limit: int = 100) -> str:
    """get forecast sections for overdue, due today, and flagged tasks.

    returns an object with grouped sections: overdue, dueToday, and flagged.
    each section contains task summaries with id, name, note, due date,
    defer date, project name, tag names, and flagged/completed states.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endOfToday = new Date(startOfToday.getTime() + (24 * 60 * 60 * 1000));

const toTaskSummary = (task) => {{
  return {{
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
  }};
}};

const openTasks = document.flattenedTasks.filter(task => !task.completed);

const overdue = openTasks
  .filter(task => task.dueDate !== null && task.dueDate < startOfToday)
  .slice(0, {limit})
  .map(toTaskSummary);

const dueToday = openTasks
  .filter(task => task.dueDate !== null && task.dueDate >= startOfToday && task.dueDate < endOfToday)
  .slice(0, {limit})
  .map(toTaskSummary);

const flagged = openTasks
  .filter(task => task.flagged)
  .slice(0, {limit})
  .map(toTaskSummary);

return {{
  overdue: overdue,
  dueToday: dueToday,
  flagged: flagged
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@_typed_tool(mcp)
async def list_perspectives(limit: int = 100) -> str:
    """list available perspectives including built-in and custom ones.

    returns perspective objects with id and name. duplicate perspectives from
    multiple sources are removed by id.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const getPerspectiveId = (perspective) => {{
  if (perspective.id && perspective.id.primaryKey) return perspective.id.primaryKey;
  if (perspective.identifier) return String(perspective.identifier);
  if (perspective.name) return String(perspective.name);
  return "unknown";
}};

const normalizePerspective = (perspective) => {{
  return {{
    id: getPerspectiveId(perspective),
    name: perspective.name || ""
  }};
}};

const collected = [];

if (typeof Perspective !== "undefined" && Perspective.BuiltIn && Perspective.BuiltIn.all) {{
  Perspective.BuiltIn.all.forEach(perspective => {{
    collected.push(normalizePerspective(perspective));
  }});
}}

if (document.perspectives) {{
  document.perspectives.forEach(perspective => {{
    collected.push(normalizePerspective(perspective));
  }});
}}

const unique = [];
const seen = new Set();
collected.forEach(perspective => {{
  if (seen.has(perspective.id)) return;
  seen.add(perspective.id);
  unique.push(perspective);
}});

return unique.slice(0, {limit});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@_typed_tool(mcp)
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

    task_name = escape_for_jxa(name.strip())
    project_name = "null" if project is None else escape_for_jxa(project.strip())
    note_value = "null" if note is None else escape_for_jxa(note)
    due_date_value = "null" if dueDate is None else escape_for_jxa(dueDate)
    defer_date_value = "null" if deferDate is None else escape_for_jxa(deferDate)
    flagged_value = "null" if flagged is None else ("true" if flagged else "false")
    tags_value = "null" if tags is None else json.dumps(tags)
    estimated_minutes_value = "null" if estimatedMinutes is None else str(estimatedMinutes)

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


@_typed_tool(mcp)
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
        if estimated_minutes_value is not None and not isinstance(estimated_minutes_value, int):
            raise ValueError("task estimatedMinutes must be an integer when provided.")

        tags_value = task.get("tags")
        if tags_value is not None:
            if not isinstance(tags_value, list) or not all(isinstance(tag, str) for tag in tags_value):
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


@_typed_tool(mcp)
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


@_typed_tool(mcp)
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


@_typed_tool(mcp)
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

task.drop();

return {{
  id: taskId,
  name: taskName,
  deleted: true,
  warning: warning
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@_typed_tool(mcp)
async def move_task(task_id: str, project: str | None = None) -> str:
    """move a task to a named project or back to inbox.

    accepts a task id and optional project name. when project is omitted, the
    task is moved to inbox.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")

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

task.move(destination);

return {{
  id: task.id.primaryKey,
  name: task.name,
  projectName: task.containingProject ? task.containingProject.name : null,
  inInbox: task.inInbox
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@_typed_tool(mcp)
async def create_project(
    name: str,
    folder: str | None = None,
    note: str | None = None,
    dueDate: str | None = None,
    deferDate: str | None = None,
    sequential: bool | None = None,
) -> str:
    """create a new project with optional folder and metadata.

    accepts required name and optional folder, note, dates, and sequential
    setting. returns the created project id.
    """
    if name.strip() == "":
        raise ValueError("name must not be empty.")
    if folder is not None and folder.strip() == "":
        raise ValueError("folder must not be empty when provided.")

    project_name = escape_for_jxa(name.strip())
    folder_name = "null" if folder is None else escape_for_jxa(folder.strip())
    note_value = "null" if note is None else escape_for_jxa(note)
    due_date_value = "null" if dueDate is None else escape_for_jxa(dueDate)
    defer_date_value = "null" if deferDate is None else escape_for_jxa(deferDate)
    sequential_value = "null" if sequential is None else ("true" if sequential else "false")

    script = f"""
const projectName = {project_name};
const folderName = {folder_name};
const noteValue = {note_value};
const dueDateValue = {due_date_value};
const deferDateValue = {defer_date_value};
const sequentialValue = {sequential_value};

const project = (() => {{
  if (folderName === null) return new Project(projectName);
  const targetFolder = document.flattenedFolders.byName(folderName);
  if (!targetFolder) {{
    throw new Error(`Folder not found: ${{folderName}}`);
  }}
  return new Project(projectName, targetFolder.ending);
}})();

if (noteValue !== null) project.note = noteValue;
if (dueDateValue !== null) project.dueDate = new Date(dueDateValue);
if (deferDateValue !== null) project.deferDate = new Date(deferDateValue);
if (sequentialValue !== null) project.sequential = sequentialValue;

return {{
  id: project.id.primaryKey
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
