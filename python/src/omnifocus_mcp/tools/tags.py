import json
from typing import Literal

from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs
from omnifocus_mcp.registration import typed_tool
from omnifocus_mcp.app import mcp


@typed_tool(mcp)
async def list_tags(
    statusFilter: Literal["active", "on_hold", "dropped", "all"] = "all",
    sortBy: Literal["name", "availableTaskCount", "totalTaskCount"] | None = None,
    sortOrder: Literal["asc", "desc"] = "asc",
    limit: int = 100,
) -> str:
    """list tags with hierarchy, task availability counts, and status.

    returns tag id, name, parent tag name, available task count, and status.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")
    if statusFilter not in ("active", "on_hold", "dropped", "all"):
        raise ValueError("statusFilter must be one of: active, on_hold, dropped, all.")
    if sortBy is not None and sortBy not in (
        "name",
        "availableTaskCount",
        "totalTaskCount",
    ):
        raise ValueError(
            "sortBy must be one of: name, availableTaskCount, totalTaskCount."
        )
    if sortOrder not in ("asc", "desc"):
        raise ValueError("sortOrder must be one of: asc, desc.")

    status_filter = escape_for_jxa(statusFilter)
    sort_by_filter = "null" if sortBy is None else escape_for_jxa(sortBy)
    sort_order_filter = escape_for_jxa(sortOrder)

    script = f"""
const statusFilter = {status_filter};
const sortBy = {sort_by_filter};
const sortOrder = {sort_order_filter};

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
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{{}}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) return "on_hold";
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

return sortedTags.slice(0, {limit});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def search_tags(query: str, limit: int = 100) -> str:
    """search tags by query text using omnifocus matching.

    returns lightweight tag summaries with id, name, and parent.
    """
    if query.strip() == "":
        raise ValueError("query must not be empty.")
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    query_value = escape_for_jxa(query.strip())
    script = f"""
const queryValue = {query_value};
const normalizeTagStatus = (tag) => {{
  const rawStatus = String(tag.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{{}}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) return "on_hold";
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
  }});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def create_tag(name: str, parent: str | None = None) -> str:
    """create a tag with optional parent tag nesting.

    returns created id, name, and parent.
    """
    if name.strip() == "":
        raise ValueError("name must not be empty.")
    if parent is not None and parent.strip() == "":
        raise ValueError("parent must not be empty when provided.")

    tag_name = escape_for_jxa(name.strip())
    parent_name = "null" if parent is None else escape_for_jxa(parent.strip())

    script = f"""
const tagName = {tag_name};
const parentName = {parent_name};

const tag = (() => {{
  if (parentName === null) return new Tag(tagName);
  const parentTag = document.flattenedTags.byName(parentName);
  if (!parentTag) {{
    throw new Error(`Tag not found: ${{parentName}}`);
  }}
  return new Tag(tagName, parentTag.ending);
}})();

return {{
  id: tag.id.primaryKey
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def update_tag(
    tag_name_or_id: str,
    name: str | None = None,
    status: str | None = None,
) -> str:
    """update a tag by id or name.

    modifies only provided fields: name and/or status.
    """
    if tag_name_or_id.strip() == "":
        raise ValueError("tag_name_or_id must not be empty.")
    if name is not None and name.strip() == "":
        raise ValueError("name must not be empty when provided.")
    if status is not None and status not in ("active", "on_hold", "dropped"):
        raise ValueError("status must be one of: active, on_hold, dropped.")
    if name is None and status is None:
        raise ValueError("at least one field must be provided: name or status.")

    tag_filter = escape_for_jxa(tag_name_or_id.strip())
    new_name = "null" if name is None else escape_for_jxa(name.strip())
    status_value = "null" if status is None else escape_for_jxa(status)

    script = f"""
const tagFilter = {tag_filter};
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
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{{}}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) return "on_hold";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
}};

return {{
  id: tag.id.primaryKey,
  name: tag.name,
  status: normalizeTagStatus(tag)
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def delete_tag(tag_name_or_id: str) -> str:
    """delete a tag by id or name.

    tasks using this tag will lose the tag assignment.
    """
    if tag_name_or_id.strip() == "":
        raise ValueError("tag_name_or_id must not be empty.")

    tag_filter = escape_for_jxa(tag_name_or_id.strip())
    script = f"""
const tagFilter = {tag_filter};

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
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def delete_tags_batch(tag_ids_or_names: list[str]) -> str:
    """delete multiple tags by id or exact name in one omnijs call.

    destructive operation. this removes tags from the database and unassigns
    them from linked tasks. use update_tag for non-destructive edits. before
    calling this tool, always show the user the target tag list and ask for
    explicit confirmation.
    """
    if len(tag_ids_or_names) == 0:
        raise ValueError("tag_ids_or_names must contain at least one tag id or name.")

    normalized_tag_ids_or_names: list[str] = []
    seen_tag_ids_or_names: set[str] = set()
    for tag_id_or_name in tag_ids_or_names:
        if not isinstance(tag_id_or_name, str):
            raise ValueError("each tag id or name must be a string.")
        normalized_tag_id_or_name = tag_id_or_name.strip()
        if normalized_tag_id_or_name == "":
            raise ValueError("each tag id or name must be a non-empty string.")
        if normalized_tag_id_or_name in seen_tag_ids_or_names:
            raise ValueError(
                f"tag_ids_or_names must not contain duplicates: {normalized_tag_id_or_name}"
            )
        seen_tag_ids_or_names.add(normalized_tag_id_or_name)
        normalized_tag_ids_or_names.append(normalized_tag_id_or_name)

    tag_ids_or_names_value = json.dumps(normalized_tag_ids_or_names)
    script = f"""
const tagIdsOrNames = {tag_ids_or_names_value};
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
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
