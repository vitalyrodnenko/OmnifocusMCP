use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::{escape_for_jxa, JxaRunner},
    types::TaskResult,
};

fn parse_task_list(value: Value) -> Result<Vec<TaskResult>> {
    Ok(serde_json::from_value(value)?)
}

pub async fn get_inbox<R: JxaRunner>(runner: &R, limit: i32) -> Result<Vec<TaskResult>> {
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }

    let script = format!(
        r#"const tasks = inbox
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
}});"#
    );

    let value = runner.run_omnijs(&script).await?;
    parse_task_list(value)
}

pub async fn list_tasks<R: JxaRunner>(
    runner: &R,
    project: Option<&str>,
    tag: Option<&str>,
    flagged: Option<bool>,
    status: &str,
    limit: i32,
) -> Result<Vec<TaskResult>> {
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }
    if let Some(project_name) = project {
        if project_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "project must not be empty when provided.".to_string(),
            ));
        }
    }
    if let Some(tag_name) = tag {
        if tag_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "tag must not be empty when provided.".to_string(),
            ));
        }
    }
    if !matches!(
        status,
        "available" | "due_soon" | "overdue" | "completed" | "all"
    ) {
        return Err(OmniFocusError::Validation(
            "status must be one of: available, due_soon, overdue, completed, all.".to_string(),
        ));
    }

    let project_filter = project
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let tag_filter = tag
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let flagged_filter = flagged
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());
    let status_filter = escape_for_jxa(status);

    let script = format!(
        r#"const projectFilter = {project_filter};
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
}});"#
    );

    let value = runner.run_omnijs(&script).await?;
    parse_task_list(value)
}

pub async fn get_task<R: JxaRunner>(runner: &R, task_id: &str) -> Result<Value> {
    if task_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "task_id must not be empty.".to_string(),
        ));
    }

    let task_id_filter = escape_for_jxa(task_id.trim());
    let script = format!(
        r#"const taskId = {task_id_filter};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn search_tasks<R: JxaRunner>(
    runner: &R,
    query: &str,
    limit: i32,
) -> Result<Vec<TaskResult>> {
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

    let query_filter = escape_for_jxa(query.trim());
    let script = format!(
        r#"const query = {query_filter}.toLowerCase();

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
}});"#
    );

    let value = runner.run_omnijs(&script).await?;
    parse_task_list(value)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskInput {
    pub name: String,
    pub project: Option<String>,
    pub note: Option<String>,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    #[serde(rename = "deferDate")]
    pub defer_date: Option<String>,
    pub flagged: Option<bool>,
    pub tags: Option<Vec<String>>,
    #[serde(rename = "estimatedMinutes")]
    pub estimated_minutes: Option<i32>,
}

#[allow(clippy::too_many_arguments)]
pub async fn create_task<R: JxaRunner>(
    runner: &R,
    name: &str,
    project: Option<&str>,
    note: Option<&str>,
    due_date: Option<&str>,
    defer_date: Option<&str>,
    flagged: Option<bool>,
    tags: Option<Vec<String>>,
    estimated_minutes: Option<i32>,
) -> Result<Value> {
    if name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "name must not be empty.".to_string(),
        ));
    }
    if let Some(project_name) = project {
        if project_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "project must not be empty when provided.".to_string(),
            ));
        }
    }

    let task_name = escape_for_jxa(name.trim());
    let project_name = project
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
    let flagged_value = flagged
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());
    let tags_value = if let Some(values) = tags {
        serde_json::to_string(&values)?
    } else {
        "null".to_string()
    };
    let estimated_minutes_value = estimated_minutes
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());

    let script = format!(
        r#"const taskName = {task_name};
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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn create_tasks_batch<R: JxaRunner>(
    runner: &R,
    tasks: Vec<CreateTaskInput>,
) -> Result<Value> {
    if tasks.is_empty() {
        return Err(OmniFocusError::Validation(
            "tasks must contain at least one task definition.".to_string(),
        ));
    }
    for task in &tasks {
        if task.name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "each task must include a non-empty name.".to_string(),
            ));
        }
        if let Some(project) = &task.project {
            if project.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "project must not be empty when provided.".to_string(),
                ));
            }
        }
    }

    let normalized: Vec<CreateTaskInput> = tasks
        .into_iter()
        .map(|task| CreateTaskInput {
            name: task.name.trim().to_string(),
            project: task.project.map(|project| project.trim().to_string()),
            note: task.note,
            due_date: task.due_date,
            defer_date: task.defer_date,
            flagged: task.flagged,
            tags: task.tags,
            estimated_minutes: task.estimated_minutes,
        })
        .collect();

    let tasks_value = serde_json::to_string(&normalized)?;
    let script = format!(
        r#"const taskInputs = {tasks_value};

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

return created;"#
    );

    runner.run_omnijs(&script).await
}

pub async fn complete_task<R: JxaRunner>(runner: &R, task_id: &str) -> Result<Value> {
    if task_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "task_id must not be empty.".to_string(),
        ));
    }
    let task_id_value = escape_for_jxa(task_id.trim());
    let script = format!(
        r#"const taskId = {task_id_value};
const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
if (!task) {{
  throw new Error(`Task not found: ${{taskId}}`);
}}

task.markComplete();

return {{
  id: task.id.primaryKey,
  name: task.name,
  completed: task.completed
}};"#
    );
    runner.run_omnijs(&script).await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_task<R: JxaRunner>(
    runner: &R,
    task_id: &str,
    name: Option<&str>,
    note: Option<&str>,
    due_date: Option<&str>,
    defer_date: Option<&str>,
    flagged: Option<bool>,
    tags: Option<Vec<String>>,
    estimated_minutes: Option<i32>,
) -> Result<Value> {
    if task_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "task_id must not be empty.".to_string(),
        ));
    }
    if let Some(value) = name {
        if value.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "name must not be empty when provided.".to_string(),
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
    if let Some(value) = tags {
        updates.insert(
            "tags".to_string(),
            Value::Array(value.into_iter().map(Value::String).collect()),
        );
    }
    if let Some(value) = estimated_minutes {
        updates.insert("estimatedMinutes".to_string(), Value::from(value));
    }

    let task_id_value = escape_for_jxa(task_id.trim());
    let updates_value = serde_json::to_string(&updates)?;

    let script = format!(
        r#"const taskId = {task_id_value};
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
}};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn delete_task<R: JxaRunner>(runner: &R, task_id: &str) -> Result<Value> {
    if task_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "task_id must not be empty.".to_string(),
        ));
    }
    let task_id_value = escape_for_jxa(task_id.trim());
    let script = format!(
        r#"const taskId = {task_id_value};
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
}};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn delete_tasks_batch<R: JxaRunner>(runner: &R, task_ids: Vec<String>) -> Result<Value> {
    if task_ids.is_empty() {
        return Err(OmniFocusError::Validation(
            "task_ids must contain at least one task id.".to_string(),
        ));
    }

    let mut normalized_task_ids: Vec<String> = Vec::with_capacity(task_ids.len());
    for task_id in task_ids {
        let normalized_task_id = task_id.trim();
        if normalized_task_id.is_empty() {
            return Err(OmniFocusError::Validation(
                "each task id must be a non-empty string.".to_string(),
            ));
        }
        normalized_task_ids.push(normalized_task_id.to_string());
    }

    let task_ids_value = serde_json::to_string(&normalized_task_ids)?;
    let script = format!(
        r#"const taskIds = {task_ids_value};
const results = taskIds.map(taskId => {{
  const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
  if (!task) {{
    return {{
      id: taskId,
      deleted: false,
      error: "not found"
    }};
  }}

  const taskName = task.name;
  task.drop(false);
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
}};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn move_task<R: JxaRunner>(
    runner: &R,
    task_id: &str,
    project: Option<&str>,
) -> Result<Value> {
    if task_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "task_id must not be empty.".to_string(),
        ));
    }
    if let Some(project_name) = project {
        if project_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "project must not be empty when provided.".to_string(),
            ));
        }
    }

    let task_id_value = escape_for_jxa(task_id.trim());
    let project_value = project
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const taskId = {task_id_value};
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
}};"#
    );
    runner.run_omnijs(&script).await
}
