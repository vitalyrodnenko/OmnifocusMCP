use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::{escape_for_jxa, JxaRunner},
    types::{TaskCountsResult, TaskResult},
};

fn parse_task_list(value: Value) -> Result<Vec<TaskResult>> {
    Ok(serde_json::from_value(value)?)
}

#[allow(clippy::too_many_arguments)]
pub async fn get_task_counts<R: JxaRunner>(
    runner: &R,
    project: Option<&str>,
    tag: Option<&str>,
    tags: Option<Vec<String>>,
    tag_filter_mode: &str,
    flagged: Option<bool>,
    due_before: Option<&str>,
    due_after: Option<&str>,
    defer_before: Option<&str>,
    defer_after: Option<&str>,
    completed_before: Option<&str>,
    completed_after: Option<&str>,
    max_estimated_minutes: Option<i32>,
) -> Result<TaskCountsResult> {
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
    if let Some(tag_names) = &tags {
        for tag_name in tag_names {
            if tag_name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "tags entries must not be empty when provided.".to_string(),
                ));
            }
        }
    }
    if !matches!(tag_filter_mode, "any" | "all") {
        return Err(OmniFocusError::Validation(
            "tagFilterMode must be one of: any, all.".to_string(),
        ));
    }
    if let Some(max_minutes) = max_estimated_minutes {
        if max_minutes < 0 {
            return Err(OmniFocusError::Validation(
                "maxEstimatedMinutes must be greater than or equal to 0.".to_string(),
            ));
        }
    }

    let project_filter = project
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let mut merged_tag_names: Vec<String> = Vec::new();
    if let Some(tag_name) = tag {
        let normalized_tag = tag_name.trim().to_string();
        if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
            merged_tag_names.push(normalized_tag);
        }
    }
    if let Some(tag_names) = tags {
        for tag_name in tag_names {
            let normalized_tag = tag_name.trim().to_string();
            if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
                merged_tag_names.push(normalized_tag);
            }
        }
    }
    let tag_names_filter = if merged_tag_names.is_empty() {
        "null".to_string()
    } else {
        serde_json::to_string(&merged_tag_names)?
    };
    let tag_filter_mode_filter = escape_for_jxa(tag_filter_mode);
    let flagged_filter = flagged
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());
    let due_before_filter = due_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let due_after_filter = due_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_before_filter = defer_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_after_filter = defer_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_before_filter = completed_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_after_filter = completed_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let max_estimated_minutes_filter = max_estimated_minutes
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());

    let script = format!(
        r#"const projectFilter = {project_filter};
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
return counts;"#
    );

    let value = runner.run_omnijs(&script).await?;
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
}});"#
    );

    let value = runner.run_omnijs(&script).await?;
    parse_task_list(value)
}

#[allow(clippy::too_many_arguments)]
pub async fn get_task_counts_legacy1<R: JxaRunner>(
    runner: &R,
    project: Option<&str>,
    tag: Option<&str>,
    tags: Option<Vec<String>>,
    tag_filter_mode: &str,
    flagged: Option<bool>,
    due_before: Option<&str>,
    due_after: Option<&str>,
    defer_before: Option<&str>,
    defer_after: Option<&str>,
    completed_before: Option<&str>,
    completed_after: Option<&str>,
    max_estimated_minutes: Option<i32>,
) -> Result<TaskCountsResult> {
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
    if let Some(tag_names) = &tags {
        for tag_name in tag_names {
            if tag_name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "tags entries must not be empty when provided.".to_string(),
                ));
            }
        }
    }
    if !matches!(tag_filter_mode, "any" | "all") {
        return Err(OmniFocusError::Validation(
            "tagFilterMode must be one of: any, all.".to_string(),
        ));
    }
    if let Some(max_minutes) = max_estimated_minutes {
        if max_minutes < 0 {
            return Err(OmniFocusError::Validation(
                "maxEstimatedMinutes must be greater than or equal to 0.".to_string(),
            ));
        }
    }

    let project_filter = project
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let mut merged_tag_names: Vec<String> = Vec::new();
    if let Some(tag_name) = tag {
        let normalized_tag = tag_name.trim().to_string();
        if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
            merged_tag_names.push(normalized_tag);
        }
    }
    if let Some(tag_names) = tags {
        for tag_name in tag_names {
            let normalized_tag = tag_name.trim().to_string();
            if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
                merged_tag_names.push(normalized_tag);
            }
        }
    }
    let tag_names_filter = if merged_tag_names.is_empty() {
        "null".to_string()
    } else {
        serde_json::to_string(&merged_tag_names)?
    };
    let tag_filter_mode_filter = escape_for_jxa(tag_filter_mode);
    let flagged_filter = flagged
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());
    let due_before_filter = due_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let due_after_filter = due_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_before_filter = defer_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_after_filter = defer_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_before_filter = completed_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_after_filter = completed_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let max_estimated_minutes_filter = max_estimated_minutes
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const projectFilter = {project_filter};
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
const filteredTasks = document.flattenedTasks.filter(task => {{
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
  if (!task.completed && (task.deferDate === null || task.deferDate <= now)) counts.available += 1;
  if (task.completed) counts.completed += 1;
  if (!task.completed && task.dueDate !== null && task.dueDate < now) counts.overdue += 1;
  if (!task.completed && task.dueDate !== null && task.dueDate >= now && task.dueDate <= soon) counts.dueSoon += 1;
  if (task.flagged) counts.flagged += 1;
  if (!task.completed && task.deferDate !== null && task.deferDate > now) counts.deferred += 1;
}});
return counts;"#
    );

    let value = runner.run_omnijs(&script).await?;
    Ok(serde_json::from_value(value)?)
}

#[allow(clippy::too_many_arguments)]
pub async fn get_task_counts_legacy3<R: JxaRunner>(
    runner: &R,
    project: Option<&str>,
    tag: Option<&str>,
    tags: Option<Vec<String>>,
    tag_filter_mode: &str,
    flagged: Option<bool>,
    due_before: Option<&str>,
    due_after: Option<&str>,
    defer_before: Option<&str>,
    defer_after: Option<&str>,
    completed_before: Option<&str>,
    completed_after: Option<&str>,
    max_estimated_minutes: Option<i32>,
) -> Result<TaskCountsResult> {
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
    if let Some(tag_names) = &tags {
        for tag_name in tag_names {
            if tag_name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "tags entries must not be empty when provided.".to_string(),
                ));
            }
        }
    }
    if !matches!(tag_filter_mode, "any" | "all") {
        return Err(OmniFocusError::Validation(
            "tagFilterMode must be one of: any, all.".to_string(),
        ));
    }
    if let Some(max_minutes) = max_estimated_minutes {
        if max_minutes < 0 {
            return Err(OmniFocusError::Validation(
                "maxEstimatedMinutes must be greater than or equal to 0.".to_string(),
            ));
        }
    }

    let project_filter = project
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let mut merged_tag_names: Vec<String> = Vec::new();
    if let Some(tag_name) = tag {
        let normalized_tag = tag_name.trim().to_string();
        if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
            merged_tag_names.push(normalized_tag);
        }
    }
    if let Some(tag_names) = tags {
        for tag_name in tag_names {
            let normalized_tag = tag_name.trim().to_string();
            if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
                merged_tag_names.push(normalized_tag);
            }
        }
    }
    let tag_names_filter = if merged_tag_names.is_empty() {
        "null".to_string()
    } else {
        serde_json::to_string(&merged_tag_names)?
    };
    let tag_filter_mode_filter = escape_for_jxa(tag_filter_mode);
    let flagged_filter = flagged
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());
    let due_before_filter = due_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let due_after_filter = due_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_before_filter = defer_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_after_filter = defer_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_before_filter = completed_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_after_filter = completed_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let max_estimated_minutes_filter = max_estimated_minutes
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const projectFilter = {project_filter};
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
const filteredTasks = document.flattenedTasks.filter(task => {{
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
  if (!task.completed && (task.deferDate === null || task.deferDate <= now)) counts.available += 1;
  if (task.completed) counts.completed += 1;
  if (!task.completed && task.dueDate !== null && task.dueDate < now) counts.overdue += 1;
  if (!task.completed && task.dueDate !== null && task.dueDate >= now && task.dueDate <= soon) counts.dueSoon += 1;
  if (task.flagged) counts.flagged += 1;
  if (!task.completed && task.deferDate !== null && task.deferDate > now) counts.deferred += 1;
}});
return counts;"#
    );

    let value = runner.run_omnijs(&script).await?;
    Ok(serde_json::from_value(value)?)
}

#[allow(clippy::too_many_arguments)]
pub async fn list_tasks<R: JxaRunner>(
    runner: &R,
    project: Option<&str>,
    tag: Option<&str>,
    tags: Option<Vec<String>>,
    tag_filter_mode: &str,
    flagged: Option<bool>,
    status: &str,
    due_before: Option<&str>,
    due_after: Option<&str>,
    defer_before: Option<&str>,
    defer_after: Option<&str>,
    completed_before: Option<&str>,
    completed_after: Option<&str>,
    max_estimated_minutes: Option<i32>,
    sort_by: Option<&str>,
    sort_order: &str,
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
    if let Some(tag_names) = &tags {
        for tag_name in tag_names {
            if tag_name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "tags entries must not be empty when provided.".to_string(),
                ));
            }
        }
    }
    if !matches!(tag_filter_mode, "any" | "all") {
        return Err(OmniFocusError::Validation(
            "tagFilterMode must be one of: any, all.".to_string(),
        ));
    }
    if let Some(max_minutes) = max_estimated_minutes {
        if max_minutes < 0 {
            return Err(OmniFocusError::Validation(
                "maxEstimatedMinutes must be greater than or equal to 0.".to_string(),
            ));
        }
    }
    if let Some(sort_field) = sort_by {
        if !matches!(
            sort_field,
            "dueDate"
                | "deferDate"
                | "name"
                | "completionDate"
                | "estimatedMinutes"
                | "project"
                | "flagged"
        ) {
            return Err(OmniFocusError::Validation(
                "sortBy must be one of: dueDate, deferDate, name, completionDate, estimatedMinutes, project, flagged.".to_string(),
            ));
        }
    }
    if !matches!(sort_order, "asc" | "desc") {
        return Err(OmniFocusError::Validation(
            "sortOrder must be one of: asc, desc.".to_string(),
        ));
    }
    if !matches!(
        status,
        "available" | "due_soon" | "overdue" | "completed" | "all"
    ) {
        return Err(OmniFocusError::Validation(
            "status must be one of: available, due_soon, overdue, completed, all.".to_string(),
        ));
    }

    let mut effective_sort_by = sort_by;
    let mut effective_sort_order = sort_order;
    if (completed_before.is_some() || completed_after.is_some()) && effective_sort_by.is_none() {
        effective_sort_by = Some("completionDate");
        effective_sort_order = "desc";
    }
    let project_filter = project
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let mut merged_tag_names: Vec<String> = Vec::new();
    if let Some(tag_name) = tag {
        let normalized_tag = tag_name.trim().to_string();
        if !merged_tag_names.contains(&normalized_tag) {
            merged_tag_names.push(normalized_tag);
        }
    }
    if let Some(tag_names) = tags {
        for tag_name in tag_names {
            let normalized_tag = tag_name.trim().to_string();
            if !merged_tag_names.contains(&normalized_tag) {
                merged_tag_names.push(normalized_tag);
            }
        }
    }
    let tag_names_filter = if merged_tag_names.is_empty() {
        "null".to_string()
    } else {
        serde_json::to_string(&merged_tag_names)?
    };
    let tag_filter_mode_filter = escape_for_jxa(tag_filter_mode);
    let flagged_filter = flagged
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());
    let effective_status =
        if (completed_before.is_some() || completed_after.is_some()) && status != "completed" {
            "all"
        } else {
            status
        };
    let status_filter = escape_for_jxa(effective_status);
    let due_before_filter = due_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let due_after_filter = due_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_before_filter = defer_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_after_filter = defer_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_before_filter = completed_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_after_filter = completed_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let max_estimated_minutes_filter = max_estimated_minutes
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let sort_by_filter = effective_sort_by
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let sort_order_filter = escape_for_jxa(effective_sort_order);

    let script = format!(
        r#"const projectFilter = {project_filter};
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
const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;

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
}});"#
    );

    let value = runner.run_omnijs(&script).await?;
    parse_task_list(value)
}

#[allow(clippy::too_many_arguments)]
pub async fn get_task_counts_duplicate<R: JxaRunner>(
    runner: &R,
    project: Option<&str>,
    tag: Option<&str>,
    tags: Option<Vec<String>>,
    tag_filter_mode: &str,
    flagged: Option<bool>,
    due_before: Option<&str>,
    due_after: Option<&str>,
    defer_before: Option<&str>,
    defer_after: Option<&str>,
    completed_before: Option<&str>,
    completed_after: Option<&str>,
    max_estimated_minutes: Option<i32>,
) -> Result<TaskCountsResult> {
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
    if let Some(tag_names) = &tags {
        for tag_name in tag_names {
            if tag_name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "tags entries must not be empty when provided.".to_string(),
                ));
            }
        }
    }
    if !matches!(tag_filter_mode, "any" | "all") {
        return Err(OmniFocusError::Validation(
            "tagFilterMode must be one of: any, all.".to_string(),
        ));
    }
    if let Some(max_minutes) = max_estimated_minutes {
        if max_minutes < 0 {
            return Err(OmniFocusError::Validation(
                "maxEstimatedMinutes must be greater than or equal to 0.".to_string(),
            ));
        }
    }

    let project_filter = project
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let mut merged_tag_names: Vec<String> = Vec::new();
    if let Some(tag_name) = tag {
        let normalized_tag = tag_name.trim().to_string();
        if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
            merged_tag_names.push(normalized_tag);
        }
    }
    if let Some(tag_names) = tags {
        for tag_name in tag_names {
            let normalized_tag = tag_name.trim().to_string();
            if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
                merged_tag_names.push(normalized_tag);
            }
        }
    }
    let tag_names_filter = if merged_tag_names.is_empty() {
        "null".to_string()
    } else {
        serde_json::to_string(&merged_tag_names)?
    };
    let tag_filter_mode_filter = escape_for_jxa(tag_filter_mode);
    let flagged_filter = flagged
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());
    let due_before_filter = due_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let due_after_filter = due_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_before_filter = defer_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_after_filter = defer_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_before_filter = completed_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_after_filter = completed_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let max_estimated_minutes_filter = max_estimated_minutes
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const projectFilter = {project_filter};
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
const filteredTasks = document.flattenedTasks.filter(task => {{
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
  if (!task.completed && (task.deferDate === null || task.deferDate <= now)) counts.available += 1;
  if (task.completed) counts.completed += 1;
  if (!task.completed && task.dueDate !== null && task.dueDate < now) counts.overdue += 1;
  if (!task.completed && task.dueDate !== null && task.dueDate >= now && task.dueDate <= soon) counts.dueSoon += 1;
  if (task.flagged) counts.flagged += 1;
  if (!task.completed && task.deferDate !== null && task.deferDate > now) counts.deferred += 1;
}});
return counts;"#
    );

    let value = runner.run_omnijs(&script).await?;
    Ok(serde_json::from_value(value)?)
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

const repetitionRule = task.repetitionRule ? task.repetitionRule.ruleString : null;

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
}};"#
    );

    runner.run_omnijs(&script).await
}

pub async fn list_subtasks<R: JxaRunner>(
    runner: &R,
    task_id: &str,
    limit: i32,
) -> Result<Vec<TaskResult>> {
    if task_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "task_id must not be empty.".to_string(),
        ));
    }
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }

    let task_id_filter = escape_for_jxa(task_id.trim());
    let script = format!(
        r#"const taskId = {task_id_filter};
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
}});"#
    );

    let value = runner.run_omnijs(&script).await?;
    parse_task_list(value)
}

#[allow(clippy::too_many_arguments)]
pub async fn search_tasks<R: JxaRunner>(
    runner: &R,
    query: &str,
    project: Option<&str>,
    tag: Option<&str>,
    tags: Option<Vec<String>>,
    tag_filter_mode: &str,
    flagged: Option<bool>,
    status: &str,
    due_before: Option<&str>,
    due_after: Option<&str>,
    defer_before: Option<&str>,
    defer_after: Option<&str>,
    completed_before: Option<&str>,
    completed_after: Option<&str>,
    max_estimated_minutes: Option<i32>,
    sort_by: Option<&str>,
    sort_order: &str,
    limit: i32,
) -> Result<Vec<TaskResult>> {
    if query.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "query must not be empty.".to_string(),
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
    if let Some(tag_names) = &tags {
        for tag_name in tag_names {
            if tag_name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "tags entries must not be empty when provided.".to_string(),
                ));
            }
        }
    }
    if !matches!(tag_filter_mode, "any" | "all") {
        return Err(OmniFocusError::Validation(
            "tagFilterMode must be one of: any, all.".to_string(),
        ));
    }
    if !matches!(
        status,
        "available" | "due_soon" | "overdue" | "completed" | "all"
    ) {
        return Err(OmniFocusError::Validation(
            "status must be one of: available, due_soon, overdue, completed, all.".to_string(),
        ));
    }
    if let Some(sort_field) = sort_by {
        if !matches!(
            sort_field,
            "dueDate"
                | "deferDate"
                | "name"
                | "completionDate"
                | "estimatedMinutes"
                | "project"
                | "flagged"
        ) {
            return Err(OmniFocusError::Validation(
                "sortBy must be one of: dueDate, deferDate, name, completionDate, estimatedMinutes, project, flagged.".to_string(),
            ));
        }
    }
    if !matches!(sort_order, "asc" | "desc") {
        return Err(OmniFocusError::Validation(
            "sortOrder must be one of: asc, desc.".to_string(),
        ));
    }
    if let Some(max_minutes) = max_estimated_minutes {
        if max_minutes < 0 {
            return Err(OmniFocusError::Validation(
                "maxEstimatedMinutes must be greater than or equal to 0.".to_string(),
            ));
        }
    }
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }

    let mut effective_sort_by = sort_by;
    let mut effective_sort_order = sort_order;
    if (completed_before.is_some() || completed_after.is_some()) && effective_sort_by.is_none() {
        effective_sort_by = Some("completionDate");
        effective_sort_order = "desc";
    }
    let project_filter = project
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let mut merged_tag_names: Vec<String> = Vec::new();
    if let Some(tag_name) = tag {
        let normalized_tag = tag_name.trim().to_string();
        if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
            merged_tag_names.push(normalized_tag);
        }
    }
    if let Some(tag_names) = tags {
        for tag_name in tag_names {
            let normalized_tag = tag_name.trim().to_string();
            if !normalized_tag.is_empty() && !merged_tag_names.contains(&normalized_tag) {
                merged_tag_names.push(normalized_tag);
            }
        }
    }
    let tag_names_filter = if merged_tag_names.is_empty() {
        "null".to_string()
    } else {
        serde_json::to_string(&merged_tag_names)?
    };
    let tag_filter_mode_filter = escape_for_jxa(tag_filter_mode);
    let flagged_filter = flagged
        .map(|value| {
            if value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        })
        .unwrap_or_else(|| "null".to_string());
    let effective_status =
        if (completed_before.is_some() || completed_after.is_some()) && status != "completed" {
            "all"
        } else {
            status
        };
    let status_filter = escape_for_jxa(effective_status);
    let due_before_filter = due_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let due_after_filter = due_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_before_filter = defer_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let defer_after_filter = defer_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_before_filter = completed_before
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let completed_after_filter = completed_after
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let max_estimated_minutes_filter = max_estimated_minutes
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let sort_by_filter = effective_sort_by
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let sort_order_filter = escape_for_jxa(effective_sort_order);
    let query_filter = escape_for_jxa(query.trim());
    let script = format!(
        r#"const queryFilter = {query_filter}.toLowerCase();
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
const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;

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

#[allow(clippy::too_many_arguments)]
pub async fn create_subtask<R: JxaRunner>(
    runner: &R,
    name: &str,
    parent_task_id: &str,
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
    if parent_task_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "parent_task_id must not be empty.".to_string(),
        ));
    }

    let task_name = escape_for_jxa(name.trim());
    let parent_task_id_value = escape_for_jxa(parent_task_id.trim());
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

pub async fn set_task_repetition<R: JxaRunner>(
    runner: &R,
    task_id: &str,
    rule_string: Option<&str>,
    schedule_type: &str,
) -> Result<Value> {
    if task_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "task_id must not be empty.".to_string(),
        ));
    }
    if let Some(value) = rule_string {
        if value.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "rule_string must not be empty when provided.".to_string(),
            ));
        }
    }
    if !matches!(schedule_type, "regularly" | "from_completion" | "none") {
        return Err(OmniFocusError::Validation(
            "schedule_type must be one of: regularly, from_completion, none.".to_string(),
        ));
    }

    let task_id_value = escape_for_jxa(task_id.trim());
    let rule_string_value = rule_string
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let schedule_type_value = escape_for_jxa(schedule_type);
    let script = format!(
        r#"const taskId = {task_id_value};
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

deleteObject(task);

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

pub async fn uncomplete_task<R: JxaRunner>(runner: &R, task_id: &str) -> Result<Value> {
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
if (!task.completed) {{
  throw new Error(`Task is not completed: ${{taskId}}`);
}}

task.markIncomplete();

return {{
  id: task.id.primaryKey,
  name: task.name,
  completed: task.completed
}};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn append_to_note<R: JxaRunner>(
    runner: &R,
    object_type: &str,
    object_id: &str,
    text: &str,
) -> Result<Value> {
    if !matches!(object_type, "task" | "project") {
        return Err(OmniFocusError::Validation(
            "object_type must be one of: task, project.".to_string(),
        ));
    }
    if object_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "object_id must not be empty.".to_string(),
        ));
    }
    if text.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "text must not be empty.".to_string(),
        ));
    }

    let object_type_value = escape_for_jxa(object_type);
    let object_id_value = escape_for_jxa(object_id.trim());
    let text_value = escape_for_jxa(text);
    let script = format!(
        r#"const objectType = {object_type_value};
const objectId = {object_id_value};
const textToAppend = {text_value};

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

obj.appendStringToNote(textToAppend);

return {{
  id: obj.id.primaryKey,
  name: obj.name,
  type: objectType,
  noteLength: obj.note.length
}};"#
    );
    runner.run_omnijs(&script).await
}
