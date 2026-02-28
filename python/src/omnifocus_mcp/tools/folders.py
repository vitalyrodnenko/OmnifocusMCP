import json

from omnifocus_mcp.jxa import run_omnijs
from omnifocus_mcp.registration import typed_tool
from omnifocus_mcp.app import mcp


@typed_tool(mcp)
async def list_folders(limit: int = 100) -> str:
    """list folder hierarchy and project counts.

    returns folder id, name, parent folder name, and contained project count.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const folderProjectCounts = new Map();
document.flattenedProjects.forEach(project => {{
  const folder = project.folder;
  if (!folder) return;
  const folderId = folder.id.primaryKey;
  const current = folderProjectCounts.get(folderId) || 0;
  folderProjectCounts.set(folderId, current + 1);
}});

const folders = document.flattenedFolders.slice(0, {limit});
return folders.map(folder => {{
  return {{
    id: folder.id.primaryKey,
    name: folder.name,
    parentName: folder.parent ? folder.parent.name : null,
    projectCount: folderProjectCounts.get(folder.id.primaryKey) || 0
  }};
}});
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
