use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::{escape_for_jxa, JxaRunner},
    types::ProjectCountsResult,
};

#[allow(clippy::too_many_arguments)]
pub async fn list_projects<R: JxaRunner>(
    runner: &R,
    folder: Option<&str>,
    status: &str,
    completed_before: Option<&str>,
    completed_after: Option<&str>,
    stalled_only: bool,
    sort_by: Option<&str>,
    sort_order: &str,
    limit: i32,
) -> Result<Value> {
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }
    if let Some(folder_name) = folder {
        if folder_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "folder must not be empty when provided.".to_string(),
            ));
        }
    }
    if !matches!(status, "active" | "on_hold" | "completed" | "dropped") {
        return Err(OmniFocusError::Validation(
            "status must be one of: active, on_hold, completed, dropped.".to_string(),
        ));
    }
    if let Some(sort_field) = sort_by {
        if !matches!(
            sort_field,
            "name" | "dueDate" | "completionDate" | "taskCount"
        ) {
            return Err(OmniFocusError::Validation(
                "sortBy must be one of: name, dueDate, completionDate, taskCount.".to_string(),
            ));
        }
    }
    if !matches!(sort_order, "asc" | "desc") {
        return Err(OmniFocusError::Validation(
            "sortOrder must be one of: asc, desc.".to_string(),
        ));
    }

    let mut effective_status = status;
    if completed_before.is_some() || completed_after.is_some() {
        effective_status = "completed";
    }
    if stalled_only {
        effective_status = "active";
    }

    let mut effective_sort_by = sort_by;
    let mut effective_sort_order = sort_order;
    if (completed_before.is_some() || completed_after.is_some()) && effective_sort_by.is_none() {
        effective_sort_by = Some("completionDate");
        effective_sort_order = "desc";
    }

    let folder_filter = folder
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let status_filter = escape_for_jxa(effective_status);
    let completed_before_filter = completed_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_after_filter = completed_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let stalled_only_filter = if stalled_only { "true" } else { "false" };
    let sort_by_filter = effective_sort_by
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let sort_order_filter = escape_for_jxa(effective_sort_order);
    let script = format!(
        r#"const folderFilter = {folder_filter};
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
}});"#
    );
    let script = format!(
        r#"{script}

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

return sortedProjects.slice(0, {limit});"#,
    );

    runner.run_omnijs(&script).await
}

pub async fn search_projects<R: JxaRunner>(runner: &R, query: &str, limit: i32) -> Result<Value> {
    if query.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "query must not be empty.".to_string(),
        ));
    }
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }

    let query_value = escape_for_jxa(query.trim());
    let script = format!(
        r#"const queryValue = {query_value};
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
  }});"#
    );

    runner.run_omnijs(&script).await
}

pub async fn get_project_counts_typed<R: JxaRunner>(
    runner: &R,
    folder: Option<&str>,
) -> Result<ProjectCountsResult> {
    if let Some(folder_name) = folder {
        if folder_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "folder must not be empty when provided.".to_string(),
            ));
        }
    }

    let folder_filter = folder
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const folderFilter = {folder_filter};

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

return counts;"#
    );

    let value = runner.run_omnijs(&script).await?;
    Ok(serde_json::from_value(value)?)
}

pub async fn get_project<R: JxaRunner>(runner: &R, project_id_or_name: &str) -> Result<Value> {
    if project_id_or_name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "project_id_or_name must not be empty.".to_string(),
        ));
    }

    let project_filter = escape_for_jxa(project_id_or_name.trim());
    let script = format!(
        r#"const projectFilter = {project_filter};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn create_project<R: JxaRunner>(
    runner: &R,
    name: &str,
    folder: Option<&str>,
    note: Option<&str>,
    due_date: Option<&str>,
    defer_date: Option<&str>,
    sequential: Option<bool>,
) -> Result<Value> {
    if name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "name must not be empty.".to_string(),
        ));
    }
    if let Some(folder_name) = folder {
        if folder_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "folder must not be empty when provided.".to_string(),
            ));
        }
    }

    let project_name = escape_for_jxa(name.trim());
    let folder_name = folder
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let note_value = note
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let due_date_value = due_date
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_date_value = defer_date
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let sequential_value = sequential
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());

    let script = format!(
        r#"const projectName = {project_name};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn complete_project<R: JxaRunner>(runner: &R, project_id_or_name: &str) -> Result<Value> {
    if project_id_or_name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "project_id_or_name must not be empty.".to_string(),
        ));
    }

    let project_filter = escape_for_jxa(project_id_or_name.trim());
    let script = format!(
        r#"const projectFilter = {project_filter};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn uncomplete_project<R: JxaRunner>(
    runner: &R,
    project_id_or_name: &str,
) -> Result<Value> {
    if project_id_or_name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "project_id_or_name must not be empty.".to_string(),
        ));
    }

    let project_filter = escape_for_jxa(project_id_or_name.trim());
    let script = format!(
        r#"const projectFilter = {project_filter};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn delete_project<R: JxaRunner>(runner: &R, project_id_or_name: &str) -> Result<Value> {
    if project_id_or_name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "project_id_or_name must not be empty.".to_string(),
        ));
    }

    let project_filter = escape_for_jxa(project_id_or_name.trim());
    let script = format!(
        r#"const projectFilter = {project_filter};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn move_project<R: JxaRunner>(
    runner: &R,
    project_id_or_name: &str,
    folder: Option<&str>,
) -> Result<Value> {
    if project_id_or_name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "project_id_or_name must not be empty.".to_string(),
        ));
    }
    if let Some(folder_name) = folder {
        if folder_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "folder must not be empty when provided.".to_string(),
            ));
        }
    }

    let project_filter = escape_for_jxa(project_id_or_name.trim());
    let folder_name = folder
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const projectFilter = {project_filter};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn set_project_status<R: JxaRunner>(
    runner: &R,
    project_id_or_name: &str,
    status: &str,
) -> Result<Value> {
    if project_id_or_name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "project_id_or_name must not be empty.".to_string(),
        ));
    }
    if !matches!(status, "active" | "on_hold" | "dropped") {
        return Err(OmniFocusError::Validation(
            "status must be one of: active, on_hold, dropped.".to_string(),
        ));
    }

    let project_filter = escape_for_jxa(project_id_or_name.trim());
    let status_value = escape_for_jxa(status);
    let script = format!(
        r#"const projectFilter = {project_filter};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_project<R: JxaRunner>(
    runner: &R,
    project_id_or_name: &str,
    name: Option<&str>,
    note: Option<&str>,
    due_date: Option<&str>,
    defer_date: Option<&str>,
    flagged: Option<bool>,
    tags: Option<Vec<String>>,
    sequential: Option<bool>,
    completed_by_children: Option<bool>,
    review_interval: Option<&str>,
) -> Result<Value> {
    if project_id_or_name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "project_id_or_name must not be empty.".to_string(),
        ));
    }
    if let Some(value) = name {
        if value.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "name must not be empty when provided.".to_string(),
            ));
        }
    }
    if let Some(values) = &tags {
        if values.iter().any(|value| value.trim().is_empty()) {
            return Err(OmniFocusError::Validation(
                "tags must not contain empty values.".to_string(),
            ));
        }
    }
    if let Some(value) = review_interval {
        if value.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "reviewInterval must not be empty when provided.".to_string(),
            ));
        }
    }

    let mut updates = serde_json::Map::new();
    if let Some(value) = name {
        updates.insert("name".to_string(), Value::String(value.trim().to_string()));
    }
    if let Some(value) = note {
        updates.insert("note".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = due_date {
        updates.insert("dueDate".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = defer_date {
        updates.insert("deferDate".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = flagged {
        updates.insert("flagged".to_string(), Value::Bool(value));
    }
    if let Some(values) = tags {
        updates.insert(
            "tags".to_string(),
            Value::Array(
                values
                    .into_iter()
                    .map(|value| Value::String(value.trim().to_string()))
                    .collect(),
            ),
        );
    }
    if let Some(value) = sequential {
        updates.insert("sequential".to_string(), Value::Bool(value));
    }
    if let Some(value) = completed_by_children {
        updates.insert("completedByChildren".to_string(), Value::Bool(value));
    }
    if let Some(value) = review_interval {
        updates.insert(
            "reviewInterval".to_string(),
            Value::String(value.trim().to_string()),
        );
    }

    let project_filter = escape_for_jxa(project_id_or_name.trim());
    let updates_value = serde_json::to_string(&updates)?;
    let script = format!(
        r#"const projectFilter = {project_filter};
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
  const match = String(value).trim().match(/^(\d+)\s+([a-zA-Z_]+)$/);
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
}};"#
    );
    runner.run_omnijs(&script).await
}
