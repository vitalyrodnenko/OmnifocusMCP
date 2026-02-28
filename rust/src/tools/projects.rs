use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::{escape_for_jxa, JxaRunner},
};

pub async fn list_projects<R: JxaRunner>(
    runner: &R,
    folder: Option<&str>,
    status: &str,
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

    let folder_filter = folder
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let status_filter = escape_for_jxa(status);
    let script = format!(
        r#"const folderFilter = {folder_filter};
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
}});"#
    );

    runner.run_omnijs(&script).await
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
    if let Some(project_name) = name {
        if project_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "name must not be empty when provided.".to_string(),
            ));
        }
    }
    if let Some(tag_names) = &tags {
        if tag_names.iter().any(|tag| tag.trim().is_empty()) {
            return Err(OmniFocusError::Validation(
                "tags must not contain empty values.".to_string(),
            ));
        }
    }
    if let Some(interval) = review_interval {
        if interval.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "reviewInterval must not be empty when provided.".to_string(),
            ));
        }
    }

    let mut updates = serde_json::Map::new();
    if let Some(project_name) = name {
        updates.insert(
            "name".to_string(),
            Value::String(project_name.trim().to_string()),
        );
    }
    if let Some(project_note) = note {
        updates.insert("note".to_string(), Value::String(project_note.to_string()));
    }
    if let Some(due_date_value) = due_date {
        updates.insert(
            "dueDate".to_string(),
            Value::String(due_date_value.to_string()),
        );
    }
    if let Some(defer_date_value) = defer_date {
        updates.insert(
            "deferDate".to_string(),
            Value::String(defer_date_value.to_string()),
        );
    }
    if let Some(flagged_value) = flagged {
        updates.insert("flagged".to_string(), Value::Bool(flagged_value));
    }
    if let Some(tag_names) = tags {
        updates.insert(
            "tags".to_string(),
            Value::Array(
                tag_names
                    .into_iter()
                    .map(|tag| Value::String(tag.trim().to_string()))
                    .collect(),
            ),
        );
    }
    if let Some(sequential_value) = sequential {
        updates.insert("sequential".to_string(), Value::Bool(sequential_value));
    }
    if let Some(completed_by_children_value) = completed_by_children {
        updates.insert(
            "completedByChildren".to_string(),
            Value::Bool(completed_by_children_value),
        );
    }
    if let Some(review_interval_value) = review_interval {
        updates.insert(
            "reviewInterval".to_string(),
            Value::String(review_interval_value.trim().to_string()),
        );
    }

    let updates_value = Value::Object(updates).to_string();
    let project_filter = escape_for_jxa(project_id_or_name.trim());
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
