import json

from omnifocus_mcp.jxa import run_omnijs
from omnifocus_mcp.registration import typed_tool
from omnifocus_mcp.app import mcp


@typed_tool(mcp)
async def list_perspectives(limit: int = 100) -> str:
    """list available perspectives including built-in and custom ones.

    returns perspective objects with id and name. duplicate perspectives from
    multiple sources are removed by id.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const getPerspectiveId = (perspective) => {{
  if (perspective.id && perspective.id.primaryKey) return perspective.id.primaryKey;
  if (perspective.identifier) return String(perspective.identifier);
  if (perspective.name) return String(perspective.name);
  return "unknown";
}};

const normalizePerspective = (perspective) => {{
  return {{
    id: getPerspectiveId(perspective),
    name: perspective.name || ""
  }};
}};

const collected = [];

if (typeof Perspective !== "undefined" && Perspective.BuiltIn && Perspective.BuiltIn.all) {{
  Perspective.BuiltIn.all.forEach(perspective => {{
    collected.push(normalizePerspective(perspective));
  }});
}}

if (document.perspectives) {{
  document.perspectives.forEach(perspective => {{
    collected.push(normalizePerspective(perspective));
  }});
}}

const unique = [];
const seen = new Set();
collected.forEach(perspective => {{
  if (seen.has(perspective.id)) return;
  seen.add(perspective.id);
  unique.push(perspective);
}});

return unique.slice(0, {limit});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
