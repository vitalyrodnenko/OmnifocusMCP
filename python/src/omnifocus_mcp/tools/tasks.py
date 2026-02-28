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
    completionDate: task.completionDate ? task.completionDate.toISOString() : null,
    tags: tags,
    estimatedMinutes: task.estimatedMinutes,
    hasChildren: task.hasChildren,
    taskStatus: (() => {{
      const s = String(task.taskStatus);
      if (s.includes("Available")) return "available";
      if (s.includes("Blocked")) return "blocked";
      if (s.includes("Next")) return "next";
      if (s.includes("DueSoon")) return "due_soon";
      if (s.includes("Overdue")) return "overdue";
      if (s.includes("Completed")) return "completed";
      if (s.includes("Dropped")) return "dropped";
      return "unknown";
    }})()
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def list_tasks(
    project: str | None = None,
    tag: str | None = None,
    tags: list[str] | None = None,
    tagFilterMode: Literal["any", "all"] = "any",
    flagged: bool | None = None,
    status: Literal[
        "available", "due_soon", "overdue", "completed", "all"
    ] = "available",
    dueBefore: str | None = None,
    dueAfter: str | None = None,
    deferBefore: str | None = None,
    deferAfter: str | None = None,
    completedBefore: str | None = None,
    completedAfter: str | None = None,
    plannedBefore: str | None = None,
    plannedAfter: str | None = None,
    maxEstimatedMinutes: int | None = None,
    sortBy: Literal[
        "dueDate",
        "deferDate",
        "name",
        "completionDate",
        "estimatedMinutes",
        "project",
        "flagged",
    ]
    | None = None,
    sortOrder: Literal["asc", "desc"] = "asc",
    limit: int = 100,
) -> str:
    """list tasks with optional project, tag filters, flagged, status, and date filters.

    returns tasks with id, name, note, flagged state, due/defer dates,
    completion state, project name, tag names, and estimated minutes.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")
    if project is not None and project.strip() == "":
        raise ValueError("project must not be empty when provided.")
    if tag is not None and tag.strip() == "":
        raise ValueError("tag must not be empty when provided.")
    if tags is not None:
        for tag_name in tags:
            if tag_name.strip() == "":
                raise ValueError("tags entries must not be empty when provided.")
    if tagFilterMode not in ("any", "all"):
        raise ValueError("tagFilterMode must be one of: any, all.")
    if sortBy is not None and sortBy not in (
        "dueDate",
        "deferDate",
        "name",
        "completionDate",
        "estimatedMinutes",
        "project",
        "flagged",
    ):
        raise ValueError(
            "sortBy must be one of: dueDate, deferDate, name, completionDate, estimatedMinutes, project, flagged."
        )
    if sortOrder not in ("asc", "desc"):
        raise ValueError("sortOrder must be one of: asc, desc.")
    if maxEstimatedMinutes is not None and maxEstimatedMinutes < 0:
        raise ValueError("maxEstimatedMinutes must be greater than or equal to 0.")
    if status not in ("available", "due_soon", "overdue", "completed", "all"):
        raise ValueError(
            "status must be one of: available, due_soon, overdue, completed, all."
        )

    effective_sort_by = sortBy
    effective_sort_order = sortOrder
    if (
        completedBefore is not None or completedAfter is not None
    ) and effective_sort_by is None:
        effective_sort_by = "completionDate"
        effective_sort_order = "desc"

    project_filter = "null" if project is None else escape_for_jxa(project)
    merged_tag_names: list[str] = []
    seen_tag_names: set[str] = set()
    if tag is not None:
        normalized_tag = tag.strip()
        if normalized_tag not in seen_tag_names:
            merged_tag_names.append(normalized_tag)
            seen_tag_names.add(normalized_tag)
    if tags is not None:
        for tag_name in tags:
            normalized_tag = tag_name.strip()
            if normalized_tag not in seen_tag_names:
                merged_tag_names.append(normalized_tag)
                seen_tag_names.add(normalized_tag)
    tag_names_filter = (
        "null" if len(merged_tag_names) == 0 else json.dumps(merged_tag_names)
    )
    tag_filter_mode_filter = escape_for_jxa(tagFilterMode)
    flagged_filter = "null" if flagged is None else ("true" if flagged else "false")
    effective_status = status
    if (
        completedBefore is not None or completedAfter is not None
    ) and status != "completed":
        effective_status = "all"
    status_filter = escape_for_jxa(effective_status)
    due_before_filter = "null" if dueBefore is None else escape_for_jxa(dueBefore)
    due_after_filter = "null" if dueAfter is None else escape_for_jxa(dueAfter)
    defer_before_filter = "null" if deferBefore is None else escape_for_jxa(deferBefore)
    defer_after_filter = "null" if deferAfter is None else escape_for_jxa(deferAfter)
    completed_before_filter = (
        "null" if completedBefore is None else escape_for_jxa(completedBefore)
    )
    completed_after_filter = (
        "null" if completedAfter is None else escape_for_jxa(completedAfter)
    )
    planned_before_filter = (
        "null" if plannedBefore is None else escape_for_jxa(plannedBefore)
    )
    planned_after_filter = (
        "null" if plannedAfter is None else escape_for_jxa(plannedAfter)
    )
    max_estimated_minutes_filter = (
        "null" if maxEstimatedMinutes is None else str(maxEstimatedMinutes)
    )
    sort_by_filter = (
        "null" if effective_sort_by is None else escape_for_jxa(effective_sort_by)
    )
    sort_order_filter = escape_for_jxa(effective_sort_order)

    script = f"""
const projectFilter = {project_filter};
const tagNames = {tag_names_filter};
const tagFilterMode = {tag_filter_mode_filter};
const flaggedFilter = {flagged_filter};
const statusFilter = {status_filter};
const dueBeforeRaw = {due_before_filter};
const dueAfterRaw = {due_after_filter};
const deferBeforeRaw = {defer_before_filter};
const deferAfterRaw = {defer_after_filter};
const completedBeforeRaw = {completed_before_filter};
const completedAfterRaw = {completed_after_filter};
const plannedBeforeRaw = {planned_before_filter};
const plannedAfterRaw = {planned_after_filter};
const maxEstimatedMinutes = {max_estimated_minutes_filter};
const sortBy = {sort_by_filter};
const sortOrder = {sort_order_filter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {{
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {{
    throw new Error(`${{fieldName}} must be a valid ISO 8601 date string.`);
  }}
  return parsed;
}};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");
const plannedBefore = parseOptionalDate(plannedBeforeRaw, "plannedBefore");
const plannedAfter = parseOptionalDate(plannedAfterRaw, "plannedAfter");
const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;
const supportsPlannedDate = (() => {{
  try {{
    const sampleTask = document.flattenedTasks[0];
    if (!sampleTask) return true;
    void sampleTask.plannedDate;
    return true;
  }} catch (e) {{
    return false;
  }}
}})();
const getPlannedDate = (task) => {{
  if (!supportsPlannedDate) return null;
  try {{
    const value = task.plannedDate;
    return value === undefined ? null : value;
  }} catch (e) {{
    return null;
  }}
}};

const filteredTasks = document.flattenedTasks
  .filter(task => {{
    if (projectFilter !== null) {{
      const projectName = task.containingProject ? task.containingProject.name : null;
      if (projectName !== projectFilter) return false;
    }}

    if (tagNames !== null && tagNames.length > 0) {{
      let tagMatches = false;
      if (tagFilterMode === "all") {{
        tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
      }} else {{
        tagMatches = task.tags.some(t => tagNames.includes(t.name));
      }}
      if (!tagMatches) return false;
    }}

    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;

    let statusMatches = false;
    if (statusFilter === "all") {{
      statusMatches = true;
    }} else if (statusFilter === "completed") {{
      statusMatches = task.completed;
    }} else if (task.completed) {{
      statusMatches = includeCompletedForDateFilter;
    }} else {{
      const dueDate = task.dueDate;
      if (statusFilter === "available") {{
        statusMatches = true;
      }} else if (statusFilter === "overdue") {{
        statusMatches = dueDate !== null && dueDate < now;
      }} else if (statusFilter === "due_soon") {{
        statusMatches = dueDate !== null && dueDate >= now && dueDate <= soon;
      }}
    }}
    if (!statusMatches) return false;

    if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) return false;
    if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) return false;
    if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) return false;
    if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) return false;
    if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) return false;
    if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return false;
    if (supportsPlannedDate) {{
      const plannedDate = getPlannedDate(task);
      if (plannedBefore !== null && !(plannedDate !== null && plannedDate < plannedBefore)) return false;
      if (plannedAfter !== null && !(plannedDate !== null && plannedDate > plannedAfter)) return false;
    }}
    if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;

    return true;
  }});

const compareValues = (aValue, bValue, isString = false) => {{
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  let left = aValue;
  let right = bValue;
  if (isString) {{
    left = String(aValue).toLowerCase();
    right = String(bValue).toLowerCase();
  }}
  if (left < right) return sortOrder === "asc" ? -1 : 1;
  if (left > right) return sortOrder === "asc" ? 1 : -1;
  return 0;
}};

const sortedTasks = sortBy === null ? filteredTasks : filteredTasks.slice().sort((a, b) => {{
  let aValue = null;
  let bValue = null;
  let isString = false;
  if (sortBy === "dueDate") {{
    aValue = a.dueDate;
    bValue = b.dueDate;
  }} else if (sortBy === "deferDate") {{
    aValue = a.deferDate;
    bValue = b.deferDate;
  }} else if (sortBy === "name") {{
    aValue = a.name;
    bValue = b.name;
    isString = true;
  }} else if (sortBy === "completionDate") {{
    aValue = a.completionDate;
    bValue = b.completionDate;
  }} else if (sortBy === "estimatedMinutes") {{
    aValue = a.estimatedMinutes;
    bValue = b.estimatedMinutes;
  }} else if (sortBy === "project") {{
    aValue = a.containingProject ? a.containingProject.name : null;
    bValue = b.containingProject ? b.containingProject.name : null;
    isString = true;
  }} else if (sortBy === "flagged") {{
    aValue = a.flagged;
    bValue = b.flagged;
  }}
  return compareValues(aValue, bValue, isString);
}});

const tasks = sortedTasks.slice(0, {limit});

return tasks.map(task => {{
  const tags = task.tags.map(taskTag => taskTag.name);
  const plannedDate = getPlannedDate(task);
  return {{
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    completed: task.completed,
    completionDate: task.completionDate ? task.completionDate.toISOString() : null,
    plannedDate: plannedDate ? plannedDate.toISOString() : null,
    projectName: task.containingProject ? task.containingProject.name : null,
    tags: tags,
    estimatedMinutes: task.estimatedMinutes,
    hasChildren: task.hasChildren,
    taskStatus: (() => {{
      const s = String(task.taskStatus);
      if (s.includes("Available")) return "available";
      if (s.includes("Blocked")) return "blocked";
      if (s.includes("Next")) return "next";
      if (s.includes("DueSoon")) return "due_soon";
      if (s.includes("Overdue")) return "overdue";
      if (s.includes("Completed")) return "completed";
      if (s.includes("Dropped")) return "dropped";
      return "unknown";
    }})()
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


async def _get_task_counts_legacy(
    project: str | None = None,
    tag: str | None = None,
    tags: list[str] | None = None,
    tagFilterMode: Literal["any", "all"] = "any",
    flagged: bool | None = None,
    dueBefore: str | None = None,
    dueAfter: str | None = None,
    deferBefore: str | None = None,
    deferAfter: str | None = None,
    completedBefore: str | None = None,
    completedAfter: str | None = None,
    maxEstimatedMinutes: int | None = None,
) -> str:
    """get aggregate task counts for any filter combination without listing tasks."""
    if project is not None and project.strip() == "":
        raise ValueError("project must not be empty when provided.")
    if tag is not None and tag.strip() == "":
        raise ValueError("tag must not be empty when provided.")
    if tags is not None:
        for tag_name in tags:
            if tag_name.strip() == "":
                raise ValueError("tags entries must not be empty when provided.")
    if tagFilterMode not in ("any", "all"):
        raise ValueError("tagFilterMode must be one of: any, all.")
    if maxEstimatedMinutes is not None and maxEstimatedMinutes < 0:
        raise ValueError("maxEstimatedMinutes must be greater than or equal to 0.")

    project_filter = "null" if project is None else escape_for_jxa(project)
    merged_tag_names: list[str] = []
    seen_tag_names: set[str] = set()
    if tag is not None:
        normalized_tag = tag.strip()
        if normalized_tag not in seen_tag_names:
            merged_tag_names.append(normalized_tag)
            seen_tag_names.add(normalized_tag)
    if tags is not None:
        for tag_name in tags:
            normalized_tag = tag_name.strip()
            if normalized_tag not in seen_tag_names:
                merged_tag_names.append(normalized_tag)
                seen_tag_names.add(normalized_tag)
    tag_names_filter = (
        "null" if len(merged_tag_names) == 0 else json.dumps(merged_tag_names)
    )
    tag_filter_mode_filter = escape_for_jxa(tagFilterMode)
    flagged_filter = "null" if flagged is None else ("true" if flagged else "false")
    due_before_filter = "null" if dueBefore is None else escape_for_jxa(dueBefore)
    due_after_filter = "null" if dueAfter is None else escape_for_jxa(dueAfter)
    defer_before_filter = "null" if deferBefore is None else escape_for_jxa(deferBefore)
    defer_after_filter = "null" if deferAfter is None else escape_for_jxa(deferAfter)
    completed_before_filter = (
        "null" if completedBefore is None else escape_for_jxa(completedBefore)
    )
    completed_after_filter = (
        "null" if completedAfter is None else escape_for_jxa(completedAfter)
    )
    max_estimated_minutes_filter = (
        "null" if maxEstimatedMinutes is None else str(maxEstimatedMinutes)
    )
    script = f"""
const projectFilter = {project_filter};
const tagNames = {tag_names_filter};
const tagFilterMode = {tag_filter_mode_filter};
const flaggedFilter = {flagged_filter};
const dueBeforeRaw = {due_before_filter};
const dueAfterRaw = {due_after_filter};
const deferBeforeRaw = {defer_before_filter};
const deferAfterRaw = {defer_after_filter};
const completedBeforeRaw = {completed_before_filter};
const completedAfterRaw = {completed_after_filter};
const maxEstimatedMinutes = {max_estimated_minutes_filter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {{
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {{
    throw new Error(`${{fieldName}} must be a valid ISO 8601 date string.`);
  }}
  return parsed;
}};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");

const filteredTasks = document.flattenedTasks
  .filter(task => {{
    if (projectFilter !== null) {{
      const projectName = task.containingProject ? task.containingProject.name : null;
      if (projectName !== projectFilter) return false;
    }}
    if (tagNames !== null && tagNames.length > 0) {{
      let tagMatches = false;
      if (tagFilterMode === "all") {{
        tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
      }} else {{
        tagMatches = task.tags.some(t => tagNames.includes(t.name));
      }}
      if (!tagMatches) return false;
    }}
    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;
    if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) return false;
    if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) return false;
    if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) return false;
    if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) return false;
    if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) return false;
    if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return false;
    if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;
    return true;
  }});

const counts = {{
  total: 0,
  available: 0,
  completed: 0,
  overdue: 0,
  dueSoon: 0,
  flagged: 0,
  deferred: 0
}};

filteredTasks.forEach(task => {{
  counts.total += 1;
  if (task.completed) counts.completed += 1;
  if (task.flagged) counts.flagged += 1;
  if (!task.completed) {{
    const dueDate = task.dueDate;
    const deferDate = task.deferDate;
    const isDeferred = deferDate !== null && deferDate > now;
    if (!isDeferred) counts.available += 1;
    if (isDeferred) counts.deferred += 1;
    if (dueDate !== null && dueDate < now) counts.overdue += 1;
    if (dueDate !== null && dueDate >= now && dueDate <= soon) counts.dueSoon += 1;
  }}
}});

return counts;
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


async def _get_task_counts_legacy_2(
    project: str | None = None,
    tag: str | None = None,
    tags: list[str] | None = None,
    tagFilterMode: Literal["any", "all"] = "any",
    flagged: bool | None = None,
    dueBefore: str | None = None,
    dueAfter: str | None = None,
    deferBefore: str | None = None,
    deferAfter: str | None = None,
    completedBefore: str | None = None,
    completedAfter: str | None = None,
    plannedBefore: str | None = None,
    plannedAfter: str | None = None,
    maxEstimatedMinutes: int | None = None,
) -> str:
    """get aggregate task counts for any filter combination without listing individual tasks.

    much faster than list_tasks for answering "how many" questions.
    """
    if project is not None and project.strip() == "":
        raise ValueError("project must not be empty when provided.")
    if tag is not None and tag.strip() == "":
        raise ValueError("tag must not be empty when provided.")
    if tags is not None:
        for tag_name in tags:
            if tag_name.strip() == "":
                raise ValueError("tags entries must not be empty when provided.")
    if tagFilterMode not in ("any", "all"):
        raise ValueError("tagFilterMode must be one of: any, all.")
    if maxEstimatedMinutes is not None and maxEstimatedMinutes < 0:
        raise ValueError("maxEstimatedMinutes must be greater than or equal to 0.")

    project_filter = "null" if project is None else escape_for_jxa(project)
    merged_tag_names: list[str] = []
    seen_tag_names: set[str] = set()
    if tag is not None:
        normalized_tag = tag.strip()
        if normalized_tag not in seen_tag_names:
            merged_tag_names.append(normalized_tag)
            seen_tag_names.add(normalized_tag)
    if tags is not None:
        for tag_name in tags:
            normalized_tag = tag_name.strip()
            if normalized_tag not in seen_tag_names:
                merged_tag_names.append(normalized_tag)
                seen_tag_names.add(normalized_tag)
    tag_names_filter = (
        "null" if len(merged_tag_names) == 0 else json.dumps(merged_tag_names)
    )
    tag_filter_mode_filter = escape_for_jxa(tagFilterMode)
    flagged_filter = "null" if flagged is None else ("true" if flagged else "false")
    due_before_filter = "null" if dueBefore is None else escape_for_jxa(dueBefore)
    due_after_filter = "null" if dueAfter is None else escape_for_jxa(dueAfter)
    defer_before_filter = "null" if deferBefore is None else escape_for_jxa(deferBefore)
    defer_after_filter = "null" if deferAfter is None else escape_for_jxa(deferAfter)
    completed_before_filter = (
        "null" if completedBefore is None else escape_for_jxa(completedBefore)
    )
    completed_after_filter = (
        "null" if completedAfter is None else escape_for_jxa(completedAfter)
    )
    planned_before_filter = (
        "null" if plannedBefore is None else escape_for_jxa(plannedBefore)
    )
    planned_after_filter = (
        "null" if plannedAfter is None else escape_for_jxa(plannedAfter)
    )
    max_estimated_minutes_filter = (
        "null" if maxEstimatedMinutes is None else str(maxEstimatedMinutes)
    )

    script = f"""
const projectFilter = {project_filter};
const tagNames = {tag_names_filter};
const tagFilterMode = {tag_filter_mode_filter};
const flaggedFilter = {flagged_filter};
const dueBeforeRaw = {due_before_filter};
const dueAfterRaw = {due_after_filter};
const deferBeforeRaw = {defer_before_filter};
const deferAfterRaw = {defer_after_filter};
const completedBeforeRaw = {completed_before_filter};
const completedAfterRaw = {completed_after_filter};
const plannedBeforeRaw = {planned_before_filter};
const plannedAfterRaw = {planned_after_filter};
const maxEstimatedMinutes = {max_estimated_minutes_filter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {{
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {{
    throw new Error(`${{fieldName}} must be a valid ISO 8601 date string.`);
  }}
  return parsed;
}};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");

const counts = {{
  total: 0,
  available: 0,
  completed: 0,
  overdue: 0,
  dueSoon: 0,
  flagged: 0,
  deferred: 0
}};

for (const task of document.flattenedTasks) {{
  if (projectFilter !== null) {{
    const projectName = task.containingProject ? task.containingProject.name : null;
    if (projectName !== projectFilter) continue;
  }}

  if (tagNames !== null && tagNames.length > 0) {{
    let tagMatches = false;
    if (tagFilterMode === "all") {{
      tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
    }} else {{
      tagMatches = task.tags.some(t => tagNames.includes(t.name));
    }}
    if (!tagMatches) continue;
  }}

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

  if (task.completed) {{
    counts.completed += 1;
    continue;
  }}

  const isAvailable = task.deferDate === null || task.deferDate <= now;
  if (isAvailable) counts.available += 1;

  if (task.deferDate !== null && task.deferDate > now) counts.deferred += 1;
  if (task.dueDate !== null && task.dueDate < now) counts.overdue += 1;
  if (task.dueDate !== null && task.dueDate >= now && task.dueDate <= soon) counts.dueSoon += 1;
}}

return counts;
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def get_task_counts(
    project: str | None = None,
    tag: str | None = None,
    tags: list[str] | None = None,
    tagFilterMode: Literal["any", "all"] = "any",
    flagged: bool | None = None,
    dueBefore: str | None = None,
    dueAfter: str | None = None,
    deferBefore: str | None = None,
    deferAfter: str | None = None,
    completedBefore: str | None = None,
    completedAfter: str | None = None,
    maxEstimatedMinutes: int | None = None,
) -> str:
    """get aggregate task counts for any filter combination without listing individual tasks. much faster than list_tasks for answering 'how many' questions."""
    if project is not None and project.strip() == "":
        raise ValueError("project must not be empty when provided.")
    if tag is not None and tag.strip() == "":
        raise ValueError("tag must not be empty when provided.")
    if tags is not None and any(tag_name.strip() == "" for tag_name in tags):
        raise ValueError("tags entries must not be empty when provided.")
    if tagFilterMode not in ("any", "all"):
        raise ValueError("tagFilterMode must be one of: any, all.")
    if maxEstimatedMinutes is not None and maxEstimatedMinutes < 0:
        raise ValueError("maxEstimatedMinutes must be greater than or equal to 0.")

    project_filter = "null" if project is None else escape_for_jxa(project.strip())
    merged_tag_names: list[str] = []
    if tag is not None:
        normalized_tag = tag.strip()
        if normalized_tag and normalized_tag not in merged_tag_names:
            merged_tag_names.append(normalized_tag)
    if tags is not None:
        for tag_name in tags:
            normalized_tag = tag_name.strip()
            if normalized_tag and normalized_tag not in merged_tag_names:
                merged_tag_names.append(normalized_tag)
    tag_names_filter = (
        "null" if len(merged_tag_names) == 0 else json.dumps(merged_tag_names)
    )
    tag_filter_mode_filter = escape_for_jxa(tagFilterMode)
    flagged_filter = "null" if flagged is None else ("true" if flagged else "false")
    due_before_filter = "null" if dueBefore is None else escape_for_jxa(dueBefore)
    due_after_filter = "null" if dueAfter is None else escape_for_jxa(dueAfter)
    defer_before_filter = "null" if deferBefore is None else escape_for_jxa(deferBefore)
    defer_after_filter = "null" if deferAfter is None else escape_for_jxa(deferAfter)
    completed_before_filter = (
        "null" if completedBefore is None else escape_for_jxa(completedBefore)
    )
    completed_after_filter = (
        "null" if completedAfter is None else escape_for_jxa(completedAfter)
    )
    max_estimated_minutes_filter = (
        "null" if maxEstimatedMinutes is None else str(maxEstimatedMinutes)
    )
    script = f"""
const projectFilter = {project_filter};
const tagNames = {tag_names_filter};
const tagFilterMode = {tag_filter_mode_filter};
const flaggedFilter = {flagged_filter};
const dueBeforeRaw = {due_before_filter};
const dueAfterRaw = {due_after_filter};
const deferBeforeRaw = {defer_before_filter};
const deferAfterRaw = {defer_after_filter};
const completedBeforeRaw = {completed_before_filter};
const completedAfterRaw = {completed_after_filter};
const maxEstimatedMinutes = {max_estimated_minutes_filter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {{
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {{
    throw new Error(`${{fieldName}} must be a valid ISO 8601 date string.`);
  }}
  return parsed;
}};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");
const counts = {{
  total: 0,
  available: 0,
  completed: 0,
  overdue: 0,
  dueSoon: 0,
  flagged: 0,
  deferred: 0
}};

for (const task of document.flattenedTasks) {{
  if (projectFilter !== null) {{
    const projectName = task.containingProject ? task.containingProject.name : null;
    if (projectName !== projectFilter) continue;
  }}

  if (tagNames !== null && tagNames.length > 0) {{
    let tagMatches = false;
    if (tagFilterMode === "all") {{
      tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
    }} else {{
      tagMatches = task.tags.some(t => tagNames.includes(t.name));
    }}
    if (!tagMatches) continue;
  }}

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

  if (task.completed) {{
    counts.completed += 1;
    continue;
  }}

  const isAvailable = task.deferDate === null || task.deferDate <= now;
  if (isAvailable) counts.available += 1;

  if (task.deferDate !== null && task.deferDate > now) counts.deferred += 1;
  if (task.dueDate !== null && task.dueDate < now) counts.overdue += 1;
  if (task.dueDate !== null && task.dueDate >= now && task.dueDate <= soon) counts.dueSoon += 1;
}}
return counts;
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

const repetitionRule = task.repetitionRule ? task.repetitionRule.ruleString : null;
const plannedDate = (() => {{
  try {{
    const value = task.plannedDate;
    return value === undefined ? null : value;
  }} catch (e) {{
    return null;
  }}
}})();
const effectivePlannedDate = (() => {{
  try {{
    const value = task.effectivePlannedDate;
    return value === undefined ? null : value;
  }} catch (e) {{
    return null;
  }}
}})();

return {{
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
  plannedDate: plannedDate ? plannedDate.toISOString() : null,
  effectivePlannedDate: effectivePlannedDate ? effectivePlannedDate.toISOString() : null,
  taskStatus: (() => {{
    const s = String(task.taskStatus);
    if (s.includes("Available")) return "available";
    if (s.includes("Blocked")) return "blocked";
    if (s.includes("Next")) return "next";
    if (s.includes("DueSoon")) return "due_soon";
    if (s.includes("Overdue")) return "overdue";
    if (s.includes("Completed")) return "completed";
    if (s.includes("Dropped")) return "dropped";
    return "unknown";
  }})(),
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
async def search_tasks(
    query: str,
    project: str | None = None,
    tag: str | None = None,
    tags: list[str] | None = None,
    tagFilterMode: Literal["any", "all"] = "any",
    flagged: bool | None = None,
    status: Literal[
        "available", "due_soon", "overdue", "completed", "all"
    ] = "available",
    dueBefore: str | None = None,
    dueAfter: str | None = None,
    deferBefore: str | None = None,
    deferAfter: str | None = None,
    completedBefore: str | None = None,
    completedAfter: str | None = None,
    plannedBefore: str | None = None,
    plannedAfter: str | None = None,
    maxEstimatedMinutes: int | None = None,
    sortBy: Literal[
        "dueDate",
        "deferDate",
        "name",
        "completionDate",
        "estimatedMinutes",
        "project",
        "flagged",
    ]
    | None = None,
    sortOrder: Literal["asc", "desc"] = "asc",
    limit: int = 100,
) -> str:
    """search task names and notes with case-insensitive matching.

    returns matching tasks with the standard list_tasks fields.
    """
    if query.strip() == "":
        raise ValueError("query must not be empty.")
    if project is not None and project.strip() == "":
        raise ValueError("project must not be empty when provided.")
    if tag is not None and tag.strip() == "":
        raise ValueError("tag must not be empty when provided.")
    if tags is not None and any(tag_name.strip() == "" for tag_name in tags):
        raise ValueError("tags entries must not be empty when provided.")
    if tagFilterMode not in ("any", "all"):
        raise ValueError("tagFilterMode must be one of: any, all.")
    if status not in ("available", "due_soon", "overdue", "completed", "all"):
        raise ValueError(
            "status must be one of: available, due_soon, overdue, completed, all."
        )
    if sortBy is not None and sortBy not in (
        "dueDate",
        "deferDate",
        "name",
        "completionDate",
        "estimatedMinutes",
        "project",
        "flagged",
    ):
        raise ValueError(
            "sortBy must be one of: dueDate, deferDate, name, completionDate, estimatedMinutes, project, flagged."
        )
    if sortOrder not in ("asc", "desc"):
        raise ValueError("sortOrder must be one of: asc, desc.")
    if maxEstimatedMinutes is not None and maxEstimatedMinutes < 0:
        raise ValueError("maxEstimatedMinutes must be greater than or equal to 0.")
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    effective_sort_by = sortBy
    effective_sort_order = sortOrder
    if (
        completedBefore is not None or completedAfter is not None
    ) and effective_sort_by is None:
        effective_sort_by = "completionDate"
        effective_sort_order = "desc"

    project_filter = "null" if project is None else escape_for_jxa(project.strip())
    merged_tag_names: list[str] = []
    if tag is not None:
        normalized_tag = tag.strip()
        if normalized_tag and normalized_tag not in merged_tag_names:
            merged_tag_names.append(normalized_tag)
    if tags is not None:
        for tag_name in tags:
            normalized_tag = tag_name.strip()
            if normalized_tag and normalized_tag not in merged_tag_names:
                merged_tag_names.append(normalized_tag)
    tag_names_filter = (
        "null" if len(merged_tag_names) == 0 else json.dumps(merged_tag_names)
    )
    tag_filter_mode_filter = escape_for_jxa(tagFilterMode)
    flagged_filter = "null" if flagged is None else ("true" if flagged else "false")
    effective_status = status
    if (
        completedBefore is not None or completedAfter is not None
    ) and status != "completed":
        effective_status = "all"
    status_filter = escape_for_jxa(effective_status)
    due_before_filter = "null" if dueBefore is None else escape_for_jxa(dueBefore)
    due_after_filter = "null" if dueAfter is None else escape_for_jxa(dueAfter)
    defer_before_filter = "null" if deferBefore is None else escape_for_jxa(deferBefore)
    defer_after_filter = "null" if deferAfter is None else escape_for_jxa(deferAfter)
    completed_before_filter = (
        "null" if completedBefore is None else escape_for_jxa(completedBefore)
    )
    completed_after_filter = (
        "null" if completedAfter is None else escape_for_jxa(completedAfter)
    )
    planned_before_filter = (
        "null" if plannedBefore is None else escape_for_jxa(plannedBefore)
    )
    planned_after_filter = (
        "null" if plannedAfter is None else escape_for_jxa(plannedAfter)
    )
    max_estimated_minutes_filter = (
        "null" if maxEstimatedMinutes is None else str(maxEstimatedMinutes)
    )
    sort_by_filter = (
        "null" if effective_sort_by is None else escape_for_jxa(effective_sort_by)
    )
    sort_order_filter = escape_for_jxa(effective_sort_order)
    query_filter = escape_for_jxa(query.strip())
    script = f"""
const queryFilter = {query_filter}.toLowerCase();
const projectFilter = {project_filter};
const tagNames = {tag_names_filter};
const tagFilterMode = {tag_filter_mode_filter};
const flaggedFilter = {flagged_filter};
const statusFilter = {status_filter};
const dueBeforeRaw = {due_before_filter};
const dueAfterRaw = {due_after_filter};
const deferBeforeRaw = {defer_before_filter};
const deferAfterRaw = {defer_after_filter};
const completedBeforeRaw = {completed_before_filter};
const completedAfterRaw = {completed_after_filter};
const plannedBeforeRaw = {planned_before_filter};
const plannedAfterRaw = {planned_after_filter};
const maxEstimatedMinutes = {max_estimated_minutes_filter};
const sortBy = {sort_by_filter};
const sortOrder = {sort_order_filter};
const now = new Date();
const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
const parseOptionalDate = (value, fieldName) => {{
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {{
    throw new Error(`${{fieldName}} must be a valid ISO 8601 date string.`);
  }}
  return parsed;
}};
const dueBefore = parseOptionalDate(dueBeforeRaw, "dueBefore");
const dueAfter = parseOptionalDate(dueAfterRaw, "dueAfter");
const deferBefore = parseOptionalDate(deferBeforeRaw, "deferBefore");
const deferAfter = parseOptionalDate(deferAfterRaw, "deferAfter");
const completedBefore = parseOptionalDate(completedBeforeRaw, "completedBefore");
const completedAfter = parseOptionalDate(completedAfterRaw, "completedAfter");
const plannedBefore = parseOptionalDate(plannedBeforeRaw, "plannedBefore");
const plannedAfter = parseOptionalDate(plannedAfterRaw, "plannedAfter");
const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;
const supportsPlannedDate = (() => {{
  try {{
    const sampleTask = document.flattenedTasks[0];
    if (!sampleTask) return true;
    void sampleTask.plannedDate;
    return true;
  }} catch (e) {{
    return false;
  }}
}})();
const getPlannedDate = (task) => {{
  if (!supportsPlannedDate) return null;
  try {{
    const value = task.plannedDate;
    return value === undefined ? null : value;
  }} catch (e) {{
    return null;
  }}
}};

const filteredTasks = document.flattenedTasks
  .filter(task => {{
    const name = (task.name || "").toLowerCase();
    const note = (task.note || "").toLowerCase();
    if (!(name.includes(queryFilter) || note.includes(queryFilter))) return false;

    if (projectFilter !== null) {{
      const projectName = task.containingProject ? task.containingProject.name : null;
      if (projectName !== projectFilter) return false;
    }}

    if (tagNames !== null && tagNames.length > 0) {{
      let tagMatches = false;
      if (tagFilterMode === "all") {{
        tagMatches = tagNames.every(tn => task.tags.some(t => t.name === tn));
      }} else {{
        tagMatches = task.tags.some(t => tagNames.includes(t.name));
      }}
      if (!tagMatches) return false;
    }}

    if (flaggedFilter !== null && task.flagged !== flaggedFilter) return false;

    let statusMatches = false;
    if (statusFilter === "all") {{
      statusMatches = true;
    }} else if (statusFilter === "completed") {{
      statusMatches = task.completed;
    }} else if (task.completed) {{
      statusMatches = includeCompletedForDateFilter;
    }} else {{
      const dueDate = task.dueDate;
      if (statusFilter === "available") {{
        statusMatches = true;
      }} else if (statusFilter === "overdue") {{
        statusMatches = dueDate !== null && dueDate < now;
      }} else if (statusFilter === "due_soon") {{
        statusMatches = dueDate !== null && dueDate >= now && dueDate <= soon;
      }}
    }}
    if (!statusMatches) return false;

    if (dueBefore !== null && !(task.dueDate !== null && task.dueDate < dueBefore)) return false;
    if (dueAfter !== null && !(task.dueDate !== null && task.dueDate > dueAfter)) return false;
    if (deferBefore !== null && !(task.deferDate !== null && task.deferDate < deferBefore)) return false;
    if (deferAfter !== null && !(task.deferDate !== null && task.deferDate > deferAfter)) return false;
    if (completedBefore !== null && !(task.completionDate !== null && task.completionDate < completedBefore)) return false;
    if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return false;
    if (supportsPlannedDate) {{
      const plannedDate = getPlannedDate(task);
      if (plannedBefore !== null && !(plannedDate !== null && plannedDate < plannedBefore)) return false;
      if (plannedAfter !== null && !(plannedDate !== null && plannedDate > plannedAfter)) return false;
    }}
    if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;

    return true;
  }});

const compareValues = (aValue, bValue, isString = false) => {{
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  let left = aValue;
  let right = bValue;
  if (isString) {{
    left = String(aValue).toLowerCase();
    right = String(bValue).toLowerCase();
  }}
  if (left < right) return sortOrder === "asc" ? -1 : 1;
  if (left > right) return sortOrder === "asc" ? 1 : -1;
  return 0;
}};

const sortedTasks = sortBy === null ? filteredTasks : filteredTasks.slice().sort((a, b) => {{
  let aValue = null;
  let bValue = null;
  let isString = false;
  if (sortBy === "dueDate") {{
    aValue = a.dueDate;
    bValue = b.dueDate;
  }} else if (sortBy === "deferDate") {{
    aValue = a.deferDate;
    bValue = b.deferDate;
  }} else if (sortBy === "name") {{
    aValue = a.name;
    bValue = b.name;
    isString = true;
  }} else if (sortBy === "completionDate") {{
    aValue = a.completionDate;
    bValue = b.completionDate;
  }} else if (sortBy === "estimatedMinutes") {{
    aValue = a.estimatedMinutes;
    bValue = b.estimatedMinutes;
  }} else if (sortBy === "project") {{
    aValue = a.containingProject ? a.containingProject.name : null;
    bValue = b.containingProject ? b.containingProject.name : null;
    isString = true;
  }} else if (sortBy === "flagged") {{
    aValue = a.flagged;
    bValue = b.flagged;
  }}
  return compareValues(aValue, bValue, isString);
}});

const tasks = sortedTasks.slice(0, {limit});

return tasks.map(task => {{
  const tags = task.tags.map(taskTag => taskTag.name);
  const plannedDate = getPlannedDate(task);
  return {{
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    completed: task.completed,
    completionDate: task.completionDate ? task.completionDate.toISOString() : null,
    plannedDate: plannedDate ? plannedDate.toISOString() : null,
    projectName: task.containingProject ? task.containingProject.name : null,
    tags: tags,
    estimatedMinutes: task.estimatedMinutes,
    hasChildren: task.hasChildren,
    taskStatus: (() => {{
      const s = String(task.taskStatus);
      if (s.includes("Available")) return "available";
      if (s.includes("Blocked")) return "blocked";
      if (s.includes("Next")) return "next";
      if (s.includes("DueSoon")) return "due_soon";
      if (s.includes("Overdue")) return "overdue";
      if (s.includes("Completed")) return "completed";
      if (s.includes("Dropped")) return "dropped";
      return "unknown";
    }})()
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def list_subtasks(task_id: str, limit: int = 100) -> str:
    """list direct subtasks for a parent task id.

    returns task summary fields for direct children, limited to the provided
    count.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    task_id_filter = escape_for_jxa(task_id.strip())
    script = f"""
const taskId = {task_id_filter};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}

const subtasks = task.children.slice(0, {limit});
return subtasks.map(subtask => {{
  const tags = subtask.tags.map(taskTag => taskTag.name);
  return {{
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
    taskStatus: (() => {{
      const s = String(subtask.taskStatus);
      if (s.includes("Available")) return "available";
      if (s.includes("Blocked")) return "blocked";
      if (s.includes("Next")) return "next";
      if (s.includes("DueSoon")) return "due_soon";
      if (s.includes("Overdue")) return "overdue";
      if (s.includes("Completed")) return "completed";
      if (s.includes("Dropped")) return "dropped";
      return "unknown";
    }})()
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def list_notifications(task_id: str) -> str:
    """list active notifications for a task by id.

    returns notification id, kind, absolute or relative fire configuration, next
    fire date, and snooze state.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")

    task_id_filter = escape_for_jxa(task_id.strip())
    script = f"""
const taskId = {task_id_filter};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}
return task.notifications.map(n => ({{
  id: n.id.primaryKey,
  kind: n.initialFireDate ? "absolute" : "relative",
  absoluteFireDate: n.initialFireDate ? n.initialFireDate.toISOString() : null,
  relativeFireOffset: n.initialFireDate ? null : n.relativeFireOffset,
  nextFireDate: n.nextFireDate ? n.nextFireDate.toISOString() : null,
  isSnoozed: n.isSnoozed
}}));
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def add_notification(
    task_id: str, absoluteDate: str | None = None, relativeOffset: float | None = None
) -> str:
    """add a task notification using an absolute date or due-relative offset."""
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")
    if absoluteDate is None and relativeOffset is None:
        raise ValueError(
            "exactly one of absoluteDate or relativeOffset must be provided."
        )
    if absoluteDate is not None and relativeOffset is not None:
        raise ValueError(
            "exactly one of absoluteDate or relativeOffset must be provided."
        )
    if absoluteDate is not None and absoluteDate.strip() == "":
        raise ValueError("absoluteDate must not be empty when provided.")

    task_id_filter = escape_for_jxa(task_id.strip())
    absolute_date_value = (
        "null" if absoluteDate is None else escape_for_jxa(absoluteDate.strip())
    )
    relative_offset_value = "null" if relativeOffset is None else str(relativeOffset)
    script = f"""
const taskId = {task_id_filter};
const absoluteDate = {absolute_date_value};
const relativeOffset = {relative_offset_value};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}
let notification = null;
if (absoluteDate !== null) {{
  const parsedAbsoluteDate = new Date(absoluteDate);
  if (Number.isNaN(parsedAbsoluteDate.getTime())) {{
    throw new Error("absoluteDate must be a valid ISO 8601 date string.");
  }}
  notification = task.addNotification(parsedAbsoluteDate);
}} else {{
  if (task.effectiveDueDate === null) {{
    throw new Error("relativeOffset requires a task with an effective due date.");
  }}
  notification = task.addNotification(relativeOffset);
}}
if (!notification) {{
  throw new Error("Failed to create notification.");
}}
return {{
  id: notification.id.primaryKey,
  kind: notification.initialFireDate ? "absolute" : "relative",
  absoluteFireDate: notification.initialFireDate ? notification.initialFireDate.toISOString() : null,
  relativeFireOffset: notification.initialFireDate ? null : notification.relativeFireOffset,
  nextFireDate: notification.nextFireDate ? notification.nextFireDate.toISOString() : null,
  isSnoozed: notification.isSnoozed
}};
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
async def create_subtask(
    name: str,
    parent_task_id: str,
    note: str | None = None,
    dueDate: str | None = None,
    deferDate: str | None = None,
    flagged: bool | None = None,
    tags: list[str] | None = None,
    estimatedMinutes: int | None = None,
) -> str:
    """create a new subtask under an existing parent task.

    accepts required name and parent task id plus create_task optional fields.
    returns created task id/name and parent task id/name.
    """
    if name.strip() == "":
        raise ValueError("name must not be empty.")
    if parent_task_id.strip() == "":
        raise ValueError("parent_task_id must not be empty.")

    task_name = escape_for_jxa(name.strip())
    parent_task_id_value = escape_for_jxa(parent_task_id.strip())
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
const parentTaskId = {parent_task_id_value};
const noteValue = {note_value};
const dueDateValue = {due_date_value};
const deferDateValue = {defer_date_value};
const flaggedValue = {flagged_value};
const tagNames = {tags_value};
const estimatedMinutesValue = {estimated_minutes_value};

const parentTask = document.flattenedTasks.find(item => item.id.primaryKey === parentTaskId);
if (!parentTask) {{
  throw new Error(`Parent task not found: ${{parentTaskId}}`);
}}

const task = new Task(taskName, parentTask.ending);

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
  name: task.name,
  parentTaskId: parentTask.id.primaryKey,
  parentTaskName: parentTask.name
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
async def uncomplete_task(task_id: str) -> str:
    """mark a completed task incomplete by id.

    reopens a completed task and returns the task id, name, and current
    completed state.
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
if (!task.completed) {{
  throw new Error(`Task is not completed: ${{taskId}}`);
}}

task.markIncomplete();

return {{
  id: task.id.primaryKey,
  name: task.name,
  completed: task.completed
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def set_task_repetition(
    task_id: str,
    rule_string: str | None = None,
    schedule_type: Literal["regularly", "from_completion", "none"] = "regularly",
) -> str:
    """set or clear a task repetition rule by task id.

    accepts a task id, an ics rrule string or null to clear, and repetition
    schedule type. returns task id, name, and current repetition rule string.
    """
    if task_id.strip() == "":
        raise ValueError("task_id must not be empty.")
    if schedule_type not in ("regularly", "from_completion", "none"):
        raise ValueError(
            "schedule_type must be one of: regularly, from_completion, none."
        )
    if rule_string is not None and rule_string.strip() == "":
        raise ValueError("rule_string must not be empty when provided.")

    task_id_value = escape_for_jxa(task_id.strip())
    rule_string_value = (
        "null" if rule_string is None else escape_for_jxa(rule_string.strip())
    )
    schedule_type_value = escape_for_jxa(schedule_type)

    script = f"""
const taskId = {task_id_value};
const ruleString = {rule_string_value};
const scheduleTypeInput = {schedule_type_value};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}

if (ruleString === null) {{
  task.repetitionRule = null;
}} else {{
  const scheduleType = (() => {{
    if (scheduleTypeInput === "regularly") return Task.RepetitionScheduleType.Regularly;
    if (scheduleTypeInput === "from_completion") return Task.RepetitionScheduleType.FromCompletion;
    if (scheduleTypeInput === "none") return Task.RepetitionScheduleType.None;
    throw new Error(`Invalid schedule_type: ${{scheduleTypeInput}}`);
  }})();
  task.repetitionRule = new Task.RepetitionRule(ruleString, null, scheduleType, null, false);
}}

return {{
  id: task.id.primaryKey,
  name: task.name,
  repetitionRule: task.repetitionRule ? task.repetitionRule.ruleString : null
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

deleteObject(task);

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
async def delete_tasks_batch(task_ids: list[str]) -> str:
    """delete multiple tasks by id in a single omnijs call.

    IMPORTANT: before calling this tool, always show the user the list of tasks
    to be deleted and ask for explicit confirmation. do not proceed without user
    approval.
    """
    if len(task_ids) == 0:
        raise ValueError("task_ids must contain at least one task id.")

    normalized_task_ids: list[str] = []
    for task_id in task_ids:
        if not isinstance(task_id, str):
            raise ValueError("each task id must be a string.")
        normalized_task_id = task_id.strip()
        if normalized_task_id == "":
            raise ValueError("each task id must be a non-empty string.")
        normalized_task_ids.append(normalized_task_id)

    task_ids_value = json.dumps(normalized_task_ids)
    script = f"""
const taskIds = {task_ids_value};
const taskById = new Map();
for (const task of document.flattenedTasks) {{
  try {{
    taskById.set(task.id.primaryKey, task);
  }} catch (e) {{
  }}
}}
const results = taskIds.map(taskId => {{
  const task = taskById.get(taskId);
  if (!task) {{
    return {{
      id: taskId,
      deleted: false,
      error: "not found"
    }};
  }}

  const taskName = task.name;
  deleteObject(task);
  return {{
    id: taskId,
    name: taskName,
    deleted: true
  }};
}});

const deletedCount = results.filter(result => result.deleted).length;
const notFoundCount = results.length - deletedCount;

return {{
  deleted_count: deletedCount,
  not_found_count: notFoundCount,
  results: results
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


@typed_tool(mcp)
async def append_to_note(
    object_type: Literal["task", "project"],
    object_id: str,
    text: str,
) -> str:
    """append text to a task or project note by object id."""
    if object_type not in {"task", "project"}:
        raise ValueError("object_type must be one of: task, project.")
    if object_id.strip() == "":
        raise ValueError("object_id must not be empty.")
    if text.strip() == "":
        raise ValueError("text must not be empty.")

    object_type_value = escape_for_jxa(object_type)
    object_id_value = escape_for_jxa(object_id.strip())
    text_value = escape_for_jxa(text)
    script = f"""
const objectType = {object_type_value};
const objectId = {object_id_value};
const textValue = {text_value};

let obj;
if (objectType === "task") {{
  obj = document.flattenedTasks.find(item => item.id.primaryKey === objectId);
  if (!obj) {{
    throw new Error(`Task not found: ${{objectId}}`);
  }}
}} else if (objectType === "project") {{
  obj = document.flattenedProjects.find(item => item.id.primaryKey === objectId);
  if (!obj) {{
    throw new Error(`Project not found: ${{objectId}}`);
  }}
}} else {{
  throw new Error(`Invalid object_type: ${{objectType}}`);
}}

obj.appendStringToNote(textValue);

return {{
  id: obj.id.primaryKey,
  name: obj.name,
  type: objectType,
  noteLength: obj.note.length
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
