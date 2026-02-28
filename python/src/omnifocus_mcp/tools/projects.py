import json
from typing import Literal

from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs
from omnifocus_mcp.registration import typed_tool
from omnifocus_mcp.app import mcp


@typed_tool(mcp)
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
    if folder is not None and folder.strip() == "":
        raise ValueError("folder must not be empty when provided.")
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


@typed_tool(mcp)
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


@typed_tool(mcp)
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
    sequential_value = (
        "null" if sequential is None else ("true" if sequential else "false")
    )

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


@typed_tool(mcp)
async def complete_project(project_id_or_name: str) -> str:
    """complete a project by id or name and return confirmation."""
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

project.markComplete();

return {{
  id: project.id.primaryKey,
  name: project.name,
  completed: true
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
