import json

from omnifocus_mcp.app import mcp
from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs
from omnifocus_mcp.registration import typed_tool


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


@typed_tool(mcp)
async def create_folder(name: str, parent: str | None = None) -> str:
    """create a folder with optional parent folder and return id/name."""
    if name.strip() == "":
        raise ValueError("name must not be empty.")
    if parent is not None and parent.strip() == "":
        raise ValueError("parent must not be empty when provided.")

    folder_name = escape_for_jxa(name.strip())
    parent_name = "null" if parent is None else escape_for_jxa(parent.strip())
    script = f"""
const folderName = {folder_name};
const parentName = {parent_name};

const folder = (() => {{
  if (parentName === null) return new Folder(folderName);
  const parentFolder = document.flattenedFolders.byName(parentName);
  if (!parentFolder) {{
    throw new Error(`Folder not found: ${{parentName}}`);
  }}
  return new Folder(folderName, parentFolder.ending);
}})();

return {{
  id: folder.id.primaryKey,
  name: folder.name
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def get_folder(folder_name_or_id: str) -> str:
    """get a folder by id or name with direct child projects and subfolders."""
    if folder_name_or_id.strip() == "":
        raise ValueError("folder_name_or_id must not be empty.")

    folder_filter = escape_for_jxa(folder_name_or_id.strip())
    script = f"""
const folderFilter = {folder_filter};

const folder = document.flattenedFolders.find(item => {{
  return item.id.primaryKey === folderFilter || item.name === folderFilter;
}});
if (!folder) {{
  throw new Error(`Folder not found: ${{folderFilter}}`);
}}

const normalizeFolderStatus = (item) => {{
  const rawStatus = String(item.status || "").toLowerCase();
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

const normalizeProjectStatus = (item) => {{
  const rawStatus = String(item.status || "").toLowerCase();
  if (rawStatus.includes("on hold") || rawStatus.includes("on_hold") || rawStatus.includes("onhold")) {{
    return "on_hold";
  }}
  if (rawStatus.includes("completed")) return "completed";
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

return {{
  id: folder.id.primaryKey,
  name: folder.name,
  status: normalizeFolderStatus(folder),
  parentName: folder.parent ? folder.parent.name : null,
  projects: folder.projects.map(project => {{
    return {{
      id: project.id.primaryKey,
      name: project.name,
      status: normalizeProjectStatus(project)
    }};
  }}),
  subfolders: folder.folders.map(subfolder => {{
    return {{
      id: subfolder.id.primaryKey,
      name: subfolder.name
    }};
  }})
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
