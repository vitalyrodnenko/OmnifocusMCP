use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::{escape_for_jxa, JxaRunner},
};

pub async fn list_tags<R: JxaRunner>(
    runner: &R,
    status_filter: &str,
    sort_by: Option<&str>,
    sort_order: &str,
    limit: i32,
) -> Result<Value> {
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }
    if !matches!(status_filter, "active" | "on_hold" | "dropped" | "all") {
        return Err(OmniFocusError::Validation(
            "statusFilter must be one of: active, on_hold, dropped, all.".to_string(),
        ));
    }
    if let Some(sort_field) = sort_by {
        if !matches!(sort_field, "name" | "availableTaskCount" | "totalTaskCount") {
            return Err(OmniFocusError::Validation(
                "sortBy must be one of: name, availableTaskCount, totalTaskCount.".to_string(),
            ));
        }
    }
    if !matches!(sort_order, "asc" | "desc") {
        return Err(OmniFocusError::Validation(
            "sortOrder must be one of: asc, desc.".to_string(),
        ));
    }

    let status_filter_value = escape_for_jxa(status_filter);
    let sort_by_value = sort_by
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let sort_order_value = escape_for_jxa(sort_order);
    let script = format!(
        r#"const statusFilter = {status_filter_value};
const sortBy = {sort_by_value};
const sortOrder = {sort_order_value};

const tagCounts = new Map();
document.flattenedTasks.forEach(task => {{
  task.tags.forEach(tag => {{
    const tagId = tag.id.primaryKey;
    const current = tagCounts.get(tagId) || {{ availableTaskCount: 0, totalTaskCount: 0 }};
    current.totalTaskCount += 1;
    if (!task.completed) current.availableTaskCount += 1;
    tagCounts.set(tagId, current);
  }});
}});

const normalizeTagStatus = (tag) => {{
  const rawStatus = String(tag.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\[object_/g, "")
    .replace(/[\[\]{{}}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\s)on\s*hold(\s|$)/.test(flattened)) return "on_hold";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
}};

const compareValues = (left, right) => {{
  if (left < right) return sortOrder === "asc" ? -1 : 1;
  if (left > right) return sortOrder === "asc" ? 1 : -1;
  return 0;
}};

const filteredTags = document.flattenedTags.filter(tag => {{
  return statusFilter === "all" || normalizeTagStatus(tag) === statusFilter;
}});

const mappedTags = filteredTags.map(tag => {{
  const counts = tagCounts.get(tag.id.primaryKey) || {{ availableTaskCount: 0, totalTaskCount: 0 }};
  return {{
  id: tag.id.primaryKey,
  name: tag.name,
  parent: tag.parent ? tag.parent.name : null,
  availableTaskCount: counts.availableTaskCount,
  totalTaskCount: counts.totalTaskCount,
  status: normalizeTagStatus(tag)
  }};
}});

const sortedTags = sortBy === null ? mappedTags : mappedTags.slice().sort((a, b) => {{
  if (sortBy === "name") {{
    return compareValues(String(a.name).toLowerCase(), String(b.name).toLowerCase());
  }}
  return compareValues(a[sortBy], b[sortBy]);
}});

return sortedTags.slice(0, {limit});"#
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
  const rawStatus = String(tag.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\[object_/g, "")
    .replace(/[\[\]{{}}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\s)on\s*hold(\s|$)/.test(flattened)) return "on_hold";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
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
  const rawStatus = String(tag.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\[object_/g, "")
    .replace(/[\[\]{{}}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\s)on\s*hold(\s|$)/.test(flattened)) return "on_hold";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
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

pub async fn delete_tags_batch<R: JxaRunner>(
    runner: &R,
    tag_ids_or_names: Vec<String>,
) -> Result<Value> {
    if tag_ids_or_names.is_empty() {
        return Err(OmniFocusError::Validation(
            "tag_ids_or_names must contain at least one tag id or name.".to_string(),
        ));
    }

    let mut normalized_tag_ids_or_names: Vec<String> = Vec::with_capacity(tag_ids_or_names.len());
    let mut seen_tag_ids_or_names: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    for tag_id_or_name in tag_ids_or_names {
        let normalized_tag_id_or_name = tag_id_or_name.trim();
        if normalized_tag_id_or_name.is_empty() {
            return Err(OmniFocusError::Validation(
                "each tag id or name must be a non-empty string.".to_string(),
            ));
        }
        if seen_tag_ids_or_names.contains(normalized_tag_id_or_name) {
            return Err(OmniFocusError::Validation(format!(
                "tag_ids_or_names must not contain duplicates: {normalized_tag_id_or_name}"
            )));
        }
        seen_tag_ids_or_names.insert(normalized_tag_id_or_name.to_string());
        normalized_tag_ids_or_names.push(normalized_tag_id_or_name.to_string());
    }

    let tag_ids_or_names_value = serde_json::to_string(&normalized_tag_ids_or_names)?;
    let script = format!(
        r#"const tagIdsOrNames = {tag_ids_or_names_value};
const requests = tagIdsOrNames.map((idOrName, index) => ({{ idOrName, index }}));
const tags = document.flattenedTags
  .map(item => {{
    try {{
      return {{
        id: item.id.primaryKey,
        name: item.name,
        parentId: item.parent ? item.parent.id.primaryKey : null
      }};
    }} catch (e) {{
      return null;
    }}
  }})
  .filter(item => item !== null);
const tagsById = new Map(tags.map(tag => [tag.id, tag]));

const resolveTag = (idOrName) => {{
  const byId = tagsById.get(idOrName);
  if (byId) return byId;
  return tags.find(tag => tag.name === idOrName);
}};

const depthCache = new Map();
const getDepth = (tagId, stack = new Set()) => {{
  if (depthCache.has(tagId)) return depthCache.get(tagId);
  if (stack.has(tagId)) return 0;
  stack.add(tagId);
  const tag = tagsById.get(tagId);
  let depth = 0;
  if (tag && tag.parentId && tagsById.has(tag.parentId)) {{
    depth = getDepth(tag.parentId, stack) + 1;
  }}
  stack.delete(tagId);
  depthCache.set(tagId, depth);
  return depth;
}};

const existsTagById = (tagId) => {{
  return document.flattenedTags.some(tag => {{
    try {{
      return tag.id.primaryKey === tagId;
    }} catch (e) {{
      return false;
    }}
  }});
}};

const getLiveTagById = (tagId) => {{
  return document.flattenedTags.find(tag => {{
    try {{
      return tag.id.primaryKey === tagId;
    }} catch (e) {{
      return false;
    }}
  }});
}};

const results = new Array(requests.length);
const unresolved = [];
const resolved = [];

requests.forEach(request => {{
  const tag = resolveTag(request.idOrName);
  if (!tag) {{
    unresolved.push(request);
    return;
  }}
  resolved.push({{
    ...request,
    tag,
    depth: getDepth(tag.id)
  }});
}});

resolved
  .sort((left, right) => right.depth - left.depth || left.index - right.index)
  .forEach(request => {{
    const resolvedId = request.tag.id;
    const resolvedName = request.tag.name;
    const liveTag = getLiveTagById(resolvedId);
    if (!liveTag) {{
      results[request.index] = {{
        id_or_name: request.idOrName,
        id: resolvedId,
        name: resolvedName,
        deleted: true,
        error: null
      }};
      return;
    }}
    try {{
      deleteObject(liveTag);
      results[request.index] = {{
        id_or_name: request.idOrName,
        id: resolvedId,
        name: resolvedName,
        deleted: true,
        error: null
      }};
    }} catch (e) {{
      if (!existsTagById(resolvedId)) {{
        results[request.index] = {{
          id_or_name: request.idOrName,
          id: resolvedId,
          name: resolvedName,
          deleted: true,
          error: null
        }};
        return;
      }}
      const errorMessage = e && e.message ? String(e.message) : String(e);
      results[request.index] = {{
        id_or_name: request.idOrName,
        id: resolvedId,
        name: resolvedName,
        deleted: false,
        error: errorMessage
      }};
    }}
  }});

unresolved.forEach(request => {{
  results[request.index] = {{
    id_or_name: request.idOrName,
    id: null,
    name: null,
    deleted: false,
    error: "not found"
  }};
}});

const deletedCount = results.filter(result => result.deleted).length;
const failedCount = results.length - deletedCount;

return {{
  summary: {{
    requested: results.length,
    deleted: deletedCount,
    failed: failedCount
  }},
  partial_success: deletedCount > 0 && failedCount > 0,
  results: results
}};"#
    );
    runner.run_omnijs(&script).await
}
