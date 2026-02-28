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
