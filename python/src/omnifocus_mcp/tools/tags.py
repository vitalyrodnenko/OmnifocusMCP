import json

from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs
from omnifocus_mcp.registration import typed_tool
from omnifocus_mcp.app import mcp


@typed_tool(mcp)
async def list_tags(limit: int = 100) -> str:
    """list tags with hierarchy, task availability counts, and status.

    returns tag id, name, parent tag name, available task count, and status.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const tagCounts = new Map();
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
  return rawStatus.replace(/\\s+/g, "_");
}};

const tags = document.flattenedTags.slice(0, {limit});
return tags.map(tag => {{
  return {{
    id: tag.id.primaryKey,
    name: tag.name,
    parent: tag.parent ? tag.parent.name : null,
    availableTaskCount: tagCounts.get(tag.id.primaryKey) || 0,
    status: normalizeTagStatus(tag)
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def create_tag(name: str, parent: str | None = None) -> str:
    """create a tag with optional parent tag nesting and return its id."""
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
    """update a tag by id or name."""
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
  const rawStatus = String(tag.status || "").toLowerCase().trim();
  if (rawStatus === "") return "active";
  return rawStatus.replace(/\\s+/g, "_");
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
