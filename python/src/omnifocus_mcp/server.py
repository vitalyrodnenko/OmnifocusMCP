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
