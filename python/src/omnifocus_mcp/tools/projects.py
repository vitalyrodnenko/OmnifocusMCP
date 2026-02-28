import json
from typing import Literal

from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs
from omnifocus_mcp.registration import typed_tool
from omnifocus_mcp.app import mcp


@typed_tool(mcp)
async def list_projects(
    folder: str | None = None,
    status: Literal["active", "on_hold", "completed", "dropped"] = "active",
    completedBefore: str | None = None,
    completedAfter: str | None = None,
    stalledOnly: bool = False,
    sortBy: Literal["name", "dueDate", "completionDate", "taskCount"] | None = None,
    sortOrder: Literal["asc", "desc"] = "asc",
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
    if sortBy is not None and sortBy not in (
        "name",
        "dueDate",
        "completionDate",
        "taskCount",
    ):
        raise ValueError(
            "sortBy must be one of: name, dueDate, completionDate, taskCount."
        )
    if sortOrder not in ("asc", "desc"):
        raise ValueError("sortOrder must be one of: asc, desc.")

    effective_status = status
    if completedBefore is not None or completedAfter is not None:
        effective_status = "completed"
    if stalledOnly:
        effective_status = "active"

    effective_sort_by = sortBy
    effective_sort_order = sortOrder
    if (
        completedBefore is not None or completedAfter is not None
    ) and effective_sort_by is None:
        effective_sort_by = "completionDate"
        effective_sort_order = "desc"

    folder_filter = "null" if folder is None else escape_for_jxa(folder)
    status_filter = escape_for_jxa(effective_status)
    completed_before_filter = (
        "null" if completedBefore is None else escape_for_jxa(completedBefore)
    )
    completed_after_filter = (
        "null" if completedAfter is None else escape_for_jxa(completedAfter)
    )
    stalled_only_filter = "true" if stalledOnly else "false"
    sort_by_filter = (
        "null" if effective_sort_by is None else escape_for_jxa(effective_sort_by)
    )
    sort_order_filter = escape_for_jxa(effective_sort_order)

    script = f"""
const folderFilter = {folder_filter};
const statusFilter = {status_filter};
const completedBeforeRaw = {completed_before_filter};
const completedAfterRaw = {completed_after_filter};
const stalledOnly = {stalled_only_filter};
const sortBy = {sort_by_filter};
const sortOrder = {sort_order_filter};

const parseOptionalDate = (rawValue, fieldName) => {{
  if (rawValue === null) return null;
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {{
    throw new Error(`${{fieldName}} must be a valid ISO 8601 date string.`);
  }}
  return parsed;
}};

const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");

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
    const nextTask = project.nextTask;
    const isStalled = normalizeProjectStatus(project) === "active"
      && project.flattenedTasks.some(t => !t.completed)
      && nextTask === null;
    if (folderFilter !== null) {{
      const folderName = project.folder ? project.folder.name : null;
      if (folderName !== folderFilter) return false;
    }}
    if (normalizeProjectStatus(project) !== statusFilter) return false;
    if (completedBefore !== null && !(project.completionDate !== null && project.completionDate < completedBefore)) return false;
    if (completedAfter !== null && !(project.completionDate !== null && project.completionDate > completedAfter)) return false;
    if (stalledOnly && !isStalled) return false;
    return true;
  }});

const mappedProjects = projects.map(project => {{
  const projectId = project.id.primaryKey;
  const counts = projectCounts.get(projectId) || {{ taskCount: 0, remainingTaskCount: 0 }};
  const nextTask = project.nextTask;
  const isStalled = normalizeProjectStatus(project) === "active"
    && project.flattenedTasks.some(t => !t.completed)
    && nextTask === null;
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
    completionDate: project.completionDate ? project.completionDate.toISOString() : null,
    note: project.note,
    sequential: project.sequential,
    isStalled: isStalled,
    nextTaskId: nextTask ? nextTask.id.primaryKey : null,
    nextTaskName: nextTask ? nextTask.name : null,
    reviewInterval: reviewInterval === null || reviewInterval === undefined ? null : String(reviewInterval)
  }};
}});

const compareValues = (left, right) => {{
  if (left < right) return sortOrder === "asc" ? -1 : 1;
  if (left > right) return sortOrder === "asc" ? 1 : -1;
  return 0;
}};

const sortedProjects = sortBy === null ? mappedProjects : mappedProjects.slice().sort((a, b) => {{
  let aValue = null;
  let bValue = null;
  if (sortBy === "name") {{
    aValue = a.name;
    bValue = b.name;
  }} else if (sortBy === "dueDate") {{
    aValue = a.dueDate;
    bValue = b.dueDate;
  }} else if (sortBy === "completionDate") {{
    aValue = a.completionDate;
    bValue = b.completionDate;
  }} else if (sortBy === "taskCount") {{
    aValue = a.taskCount;
    bValue = b.taskCount;
  }}

  if (aValue === null) return 1;
  if (bValue === null) return -1;

  if (sortBy === "name") {{
    return compareValues(String(aValue).toLowerCase(), String(bValue).toLowerCase());
  }}
  return compareValues(aValue, bValue);
}});

return sortedProjects.slice(0, {limit});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def get_project_counts(folder: str | None = None) -> str:
    """get aggregate project counts by status without listing individual projects."""
    if folder is not None and folder.strip() == "":
        raise ValueError("folder must not be empty when provided.")

    folder_filter = "null" if folder is None else escape_for_jxa(folder.strip())
    script = f"""
const folderFilter = {folder_filter};

const normalizeProjectStatus = (project) => {{
  const rawStatus = String(project.status || "").toLowerCase();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {{
    return "on_hold";
  }}
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

const counts = {{
  total: 0,
  active: 0,
  onHold: 0,
  completed: 0,
  dropped: 0,
  stalled: 0
}};

document.flattenedProjects.forEach(project => {{
  if (folderFilter !== null) {{
    const folderName = project.folder ? project.folder.name : null;
    if (folderName !== folderFilter) return;
  }}

  const status = normalizeProjectStatus(project);
  const isStalled = status === "active"
    && project.flattenedTasks.some(t => !t.completed)
    && project.nextTask === null;

  counts.total += 1;
  if (status === "active") counts.active += 1;
  if (status === "on_hold") counts.onHold += 1;
  if (status === "completed") counts.completed += 1;
  if (status === "dropped") counts.dropped += 1;
  if (isStalled) counts.stalled += 1;
}});

return counts;
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def search_projects(query: str, limit: int = 100) -> str:
    """search projects using omnifocus matching and return project summaries."""
    if query.strip() == "":
        raise ValueError("query must not be empty.")
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    query_value = escape_for_jxa(query.strip())
    script = f"""
const queryValue = {query_value};
const normalizeProjectStatus = (project) => {{
  const rawStatus = String(project.status || "").toLowerCase();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {{
    return "on_hold";
  }}
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

return projectsMatching(queryValue)
  .slice(0, {limit})
  .map(project => {{
    return {{
      id: project.id.primaryKey,
      name: project.name,
      status: normalizeProjectStatus(project),
      folderName: project.folder ? project.folder.name : null
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
const nextTask = project.nextTask;
const isStalled = normalizeProjectStatus(project) === "active"
  && allProjectTasks.some(task => !task.completed)
  && nextTask === null;

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
  completedTaskCount: allProjectTasks.filter(task => task.completed).length,
  availableTaskCount: allProjectTasks.filter(task => !task.completed && (task.deferDate === null || task.deferDate <= new Date())).length,
  deferDate: project.deferDate ? project.deferDate.toISOString() : null,
  dueDate: project.dueDate ? project.dueDate.toISOString() : null,
  completionDate: project.completionDate ? project.completionDate.toISOString() : null,
  note: project.note,
  sequential: project.sequential,
  isStalled: isStalled,
  nextTaskId: nextTask ? nextTask.id.primaryKey : null,
  nextTaskName: nextTask ? nextTask.name : null,
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


@typed_tool(mcp)
async def uncomplete_project(project_id_or_name: str) -> str:
    """reopen a completed project by id or name and return active status."""
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
if (!project.completed) {{
  throw new Error(`Project is not completed: ${{projectFilter}}`);
}}

project.markIncomplete();

return {{
  id: project.id.primaryKey,
  name: project.name,
  status: "active"
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def delete_project(project_id_or_name: str) -> str:
    """delete a project by id or name. IMPORTANT: this permanently removes the project and all its tasks from the database. before calling, show the user the project name and task count, and ask for explicit confirmation."""
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

const projectId = project.id.primaryKey;
const projectName = project.name;
const taskCount = document.flattenedTasks.filter(task => {{
  return task.containingProject && task.containingProject.id.primaryKey === projectId;
}}).length;

deleteObject(project);

return {{
  id: projectId,
  name: projectName,
  deleted: true,
  taskCount: taskCount
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def move_project(project_id_or_name: str, folder: str | None = None) -> str:
    """move a project by id or name to a folder or top level."""
    if project_id_or_name.strip() == "":
        raise ValueError("project_id_or_name must not be empty.")
    if folder is not None and folder.strip() == "":
        raise ValueError("folder must not be empty when provided.")

    project_filter = escape_for_jxa(project_id_or_name.strip())
    folder_name = "null" if folder is None else escape_for_jxa(folder.strip())
    script = f"""
const projectFilter = {project_filter};
const folderName = {folder_name};
const project = document.flattenedProjects.find(item => {{
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
}});
if (!project) {{
  throw new Error(`Project not found: ${{projectFilter}}`);
}}

const destination = (() => {{
  if (folderName === null) return library.ending;
  const targetFolder = document.flattenedFolders.byName(folderName);
  if (!targetFolder) {{
    throw new Error(`Folder not found: ${{folderName}}`);
  }}
  return targetFolder.ending;
}})();

moveSections([project], destination);

return {{
  id: project.id.primaryKey,
  name: project.name,
  folderName: folderName
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def set_project_status(
    project_id_or_name: str,
    status: Literal["active", "on_hold", "dropped"],
) -> str:
    """set a project's organizational status by id or name."""
    if project_id_or_name.strip() == "":
        raise ValueError("project_id_or_name must not be empty.")
    if status not in ("active", "on_hold", "dropped"):
        raise ValueError("status must be one of: active, on_hold, dropped.")

    project_filter = escape_for_jxa(project_id_or_name.strip())
    status_value = escape_for_jxa(status)
    script = f"""
const projectFilter = {project_filter};
const statusValue = {status_value};
const project = document.flattenedProjects.find(item => {{
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
}});
if (!project) {{
  throw new Error(`Project not found: ${{projectFilter}}`);
}}

let targetStatus;
if (statusValue === "active") {{
  targetStatus = Project.Status.Active;
}} else if (statusValue === "on_hold") {{
  targetStatus = Project.Status.OnHold;
}} else if (statusValue === "dropped") {{
  targetStatus = Project.Status.Dropped;
}} else {{
  throw new Error(`Invalid status: ${{statusValue}}`);
}}

project.status = targetStatus;

return {{
  id: project.id.primaryKey,
  name: project.name,
  status: statusValue
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def update_project(
    project_id_or_name: str,
    name: str | None = None,
    note: str | None = None,
    dueDate: str | None = None,
    deferDate: str | None = None,
    flagged: bool | None = None,
    tags: list[str] | None = None,
    sequential: bool | None = None,
    completedByChildren: bool | None = None,
    reviewInterval: str | None = None,
) -> str:
    """update a project by id or name, modifying only provided fields.

    accepts optional updates for metadata, tags, sequencing mode, completion
    mode, and review interval. returns an updated project summary payload.
    """
    if project_id_or_name.strip() == "":
        raise ValueError("project_id_or_name must not be empty.")
    if name is not None and name.strip() == "":
        raise ValueError("name must not be empty when provided.")
    if tags is not None and any(tag.strip() == "" for tag in tags):
        raise ValueError("tags must not contain empty values.")
    if reviewInterval is not None and reviewInterval.strip() == "":
        raise ValueError("reviewInterval must not be empty when provided.")

    updates: dict[str, object] = {}
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
        updates["tags"] = [tag.strip() for tag in tags]
    if sequential is not None:
        updates["sequential"] = sequential
    if completedByChildren is not None:
        updates["completedByChildren"] = completedByChildren
    if reviewInterval is not None:
        updates["reviewInterval"] = reviewInterval.strip()

    project_filter = escape_for_jxa(project_id_or_name.strip())
    updates_value = json.dumps(updates)
    script = f"""
const projectFilter = {project_filter};
const updates = {updates_value};
const project = document.flattenedProjects.find(item => {{
  return item.id.primaryKey === projectFilter || item.name === projectFilter;
}});
if (!project) {{
  throw new Error(`Project not found: ${{projectFilter}}`);
}}

const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);
const normalizeProjectStatus = (item) => {{
  const rawStatus = String(item.status || "").toLowerCase();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {{
    return "on_hold";
  }}
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};
const parseReviewInterval = (value) => {{
  const match = String(value).trim().match(/^(\\d+)\\s+([a-zA-Z_]+)$/);
  if (!match) {{
    throw new Error(`Invalid reviewInterval format: ${{value}}. Expected 'N unit'.`);
  }}
  const steps = Number(match[1]);
  if (!Number.isInteger(steps) || steps < 1) {{
    throw new Error(`Invalid reviewInterval steps: ${{match[1]}}`);
  }}
  let unit = match[2].toLowerCase();
  if (unit.endsWith("s")) unit = unit.slice(0, -1);
  const allowed = new Set(["minute", "hour", "day", "week", "month", "year"]);
  if (!allowed.has(unit)) {{
    throw new Error(`Invalid reviewInterval unit: ${{match[2]}}`);
  }}
  return {{ steps, unit }};
}};

if (has("name")) project.name = updates.name;
if (has("note")) project.note = updates.note;
if (has("dueDate")) project.dueDate = new Date(updates.dueDate);
if (has("deferDate")) project.deferDate = new Date(updates.deferDate);
if (has("flagged")) project.flagged = updates.flagged;
if (has("sequential")) project.sequential = updates.sequential;
if (has("completedByChildren")) project.completedByChildren = updates.completedByChildren;
if (has("reviewInterval")) {{
  project.reviewInterval = parseReviewInterval(updates.reviewInterval);
}}
if (has("tags")) {{
  const existingTags = project.tags.slice();
  existingTags.forEach(tag => {{
    project.removeTag(tag);
  }});
  updates.tags.forEach(tagName => {{
    const tag = document.flattenedTags.byName(tagName);
    if (tag) project.addTag(tag);
  }});
}}

const allProjectTasks = document.flattenedTasks.filter(task => {{
  return task.containingProject && task.containingProject.id.primaryKey === project.id.primaryKey;
}});
const reviewIntervalValue = project.reviewInterval;
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
  flagged: project.flagged,
  sequential: project.sequential,
  completedByChildren: project.completedByChildren,
  tags: project.tags.map(tag => tag.name),
  reviewInterval: reviewIntervalValue === null || reviewIntervalValue === undefined ? null : String(reviewIntervalValue)
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
