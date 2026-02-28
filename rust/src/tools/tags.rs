use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::{escape_for_jxa, JxaRunner},
};

pub async fn list_tags<R: JxaRunner>(runner: &R, limit: i32) -> Result<Value> {
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }
    let script = format!(
        r#"const tagCounts = new Map();
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
  return rawStatus.replace(/\s+/g, "_");
}};
const tags = document.flattenedTags.slice(0, {limit});
return tags.map(tag => ({{
  id: tag.id.primaryKey,
  name: tag.name,
  parent: tag.parent ? tag.parent.name : null,
  availableTaskCount: tagCounts.get(tag.id.primaryKey) || 0,
  status: normalizeTagStatus(tag)
}}));"#
    );
    runner.run_omnijs(&script).await
}

pub async fn search_tags<R: JxaRunner>(runner: &R, query: &str, limit: i32) -> Result<Value> {
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
const normalizeTagStatus = (tag) => {{
  const rawStatus = String(tag.status || "").toLowerCase().trim();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {{
    return "on_hold";
  }}
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

return tagsMatching(queryValue)
  .slice(0, {limit})
  .map(tag => {{
    return {{
      id: tag.id.primaryKey,
      name: tag.name,
      status: normalizeTagStatus(tag),
      parent: tag.parent ? tag.parent.name : null
    }};
  }});"#
    );
    runner.run_omnijs(&script).await
}

pub async fn search_tags<R: JxaRunner>(runner: &R, query: &str, limit: i32) -> Result<Value> {
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
const normalizeTagStatus = (tag) => {{
  const rawStatus = String(tag.status || "").toLowerCase().trim();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {{
    return "on_hold";
  }}
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

return tagsMatching(queryValue)
  .slice(0, {limit})
  .map(tag => {{
    return {{
      id: tag.id.primaryKey,
      name: tag.name,
      status: normalizeTagStatus(tag),
      parent: tag.parent ? tag.parent.name : null
    }};
  }});"#
    );

    runner.run_omnijs(&script).await
}

pub async fn create_tag<R: JxaRunner>(
    runner: &R,
    name: &str,
    parent: Option<&str>,
) -> Result<Value> {
    if name.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "name must not be empty.".to_string(),
        ));
    }
    if let Some(parent_name) = parent {
        if parent_name.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "parent must not be empty when provided.".to_string(),
            ));
        }
    }
    let tag_name = escape_for_jxa(name.trim());
    let parent_name = parent
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const tagName = {tag_name};
const parentName = {parent_name};
const tag = (() => {{
  if (parentName === null) return new Tag(tagName);
  const parentTag = document.flattenedTags.byName(parentName);
  if (!parentTag) {{
    throw new Error(`Tag not found: ${{parentName}}`);
  }}
  return new Tag(tagName, parentTag.ending);
}})();
return {{ id: tag.id.primaryKey }};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn update_tag<R: JxaRunner>(
    runner: &R,
    tag_name_or_id: &str,
    name: Option<&str>,
    status: Option<&str>,
) -> Result<Value> {
    if tag_name_or_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "tag_name_or_id must not be empty.".to_string(),
        ));
    }
    if let Some(value) = name {
        if value.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "name must not be empty when provided.".to_string(),
            ));
        }
    }
    if let Some(value) = status {
        if !matches!(value, "active" | "on_hold" | "dropped") {
            return Err(OmniFocusError::Validation(
                "status must be one of: active, on_hold, dropped.".to_string(),
            ));
        }
    }
    if name.is_none() && status.is_none() {
        return Err(OmniFocusError::Validation(
            "at least one field must be provided: name or status.".to_string(),
        ));
    }
    let tag_filter = escape_for_jxa(tag_name_or_id.trim());
    let new_name = name
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let status_value = status
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const tagFilter = {tag_filter};
const newName = {new_name};
const statusValue = {status_value};
const tag = document.flattenedTags.find(
  t => t.id.primaryKey === tagFilter || t.name === tagFilter
);
if (!tag) {{
  throw new Error(`Tag not found: ${{tagFilter}}`);
}}
if (newName !== null) {{
  tag.name = newName;
}}
if (statusValue !== null) {{
  let targetStatus;
  if (statusValue === "active") {{
    targetStatus = Tag.Status.Active;
  }} else if (statusValue === "on_hold") {{
    targetStatus = Tag.Status.OnHold;
  }} else if (statusValue === "dropped") {{
    targetStatus = Tag.Status.Dropped;
  }} else {{
    throw new Error(`Invalid status: ${{statusValue}}`);
  }}
  tag.status = targetStatus;
}}
const normalizeTagStatus = (tag) => {{
  const rawStatus = String(tag.status || "").toLowerCase().trim();
  if (rawStatus === "") return "active";
  return rawStatus.replace(/\s+/g, "_");
}};
return {{ id: tag.id.primaryKey, name: tag.name, status: normalizeTagStatus(tag) }};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn delete_tag<R: JxaRunner>(runner: &R, tag_name_or_id: &str) -> Result<Value> {
    if tag_name_or_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "tag_name_or_id must not be empty.".to_string(),
        ));
    }
    let tag_filter = escape_for_jxa(tag_name_or_id.trim());
    let script = format!(
        r#"const tagFilter = {tag_filter};

const tag = document.flattenedTags.find(
  t => t.id.primaryKey === tagFilter || t.name === tagFilter
);
if (!tag) {{
  throw new Error(`Tag not found: ${{tagFilter}}`);
}}

const tagId = tag.id.primaryKey;
const tagName = tag.name;
const taskCount = tag.tasks.length;

deleteObject(tag);

return {{
  id: tagId,
  name: tagName,
  deleted: true,
  taskCount: taskCount
}};"#
    );
    runner.run_omnijs(&script).await
}
