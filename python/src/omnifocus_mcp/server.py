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
