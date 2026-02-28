import json

from omnifocus_mcp.app import mcp
from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs
from omnifocus_mcp.registration import typed_tool


@typed_tool(mcp)
async def list_folders(limit: int = 100) -> str:
    """list folder hierarchy and project counts."""
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

const normalizeStatus = (value) => {{
  const raw = String(value || "").split(".").pop() || "";
  return raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}};

return {{
  id: folder.id.primaryKey,
  name: folder.name,
  status: normalizeStatus(folder.status),
  parentName: folder.parent ? folder.parent.name : null,
  projects: folder.projects.map(project => {{
    return {{
      id: project.id.primaryKey,
      name: project.name,
      status: normalizeStatus(project.status)
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


@typed_tool(mcp)
async def update_folder(
    folder_name_or_id: str,
    name: str | None = None,
    status: str | None = None,
) -> str:
    """update a folder by id or name."""
    folder_filter = folder_name_or_id.strip()
    new_name_value = None if name is None else name.strip()
    status_value = status

    if folder_filter == "":
        raise ValueError("folder_name_or_id must not be empty.")
    if name is not None and new_name_value == "":
        raise ValueError("name must not be empty when provided.")
    if status_value is not None and status_value not in {"active", "dropped"}:
        raise ValueError("status must be one of: active, dropped.")
    if new_name_value is None and status_value is None:
        raise ValueError("at least one field must be provided: name or status.")

    escaped_folder_filter = escape_for_jxa(folder_filter)
    escaped_name = "null" if new_name_value is None else escape_for_jxa(new_name_value)
    escaped_status = "null" if status_value is None else escape_for_jxa(status_value)
    script = f"""
const folderFilter = {escaped_folder_filter};
const newName = {escaped_name};
const statusValue = {escaped_status};

const folder = document.flattenedFolders.find(item => {{
  return item.id.primaryKey === folderFilter || item.name === folderFilter;
}});
if (!folder) {{
  throw new Error(`Folder not found: ${{folderFilter}}`);
}}

if (newName !== null) {{
  folder.name = newName;
}}

if (statusValue !== null) {{
  let targetStatus;
  if (statusValue === "active") {{
    targetStatus = Folder.Status.Active;
  }} else if (statusValue === "dropped") {{
    targetStatus = Folder.Status.Dropped;
  }} else {{
    throw new Error(`Invalid status: ${{statusValue}}`);
  }}
  folder.status = targetStatus;
}}

const normalizeFolderStatus = (item) => {{
  const rawStatus = String(item.status || "").toLowerCase();
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
}};

return {{
  id: folder.id.primaryKey,
  name: folder.name,
  status: normalizeFolderStatus(folder)
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)


@typed_tool(mcp)
async def delete_folder(folder_name_or_id: str) -> str:
    """delete a folder by id or name. warning: deleting a folder may move contained projects and subfolders to top level in omnifocus."""
    folder_filter = folder_name_or_id.strip()
    if folder_filter == "":
        raise ValueError("folder_name_or_id must not be empty.")

    escaped_folder_filter = escape_for_jxa(folder_filter)
    script = f"""
const folderFilter = {escaped_folder_filter};

const folder = document.flattenedFolders.find(item => {{
  return item.id.primaryKey === folderFilter || item.name === folderFilter;
}});
if (!folder) {{
  throw new Error(`Folder not found: ${{folderFilter}}`);
}}

const folderId = folder.id.primaryKey;
const folderName = folder.name;
const projectCount = document.flattenedProjects.filter(project => {{
  return project.folder && project.folder.id.primaryKey === folderId;
}}).length;
const subfolderCount = document.flattenedFolders.filter(item => {{
  return item.parent && item.parent.id.primaryKey === folderId;
}}).length;
deleteObject(folder);

return {{
  id: folderId,
  name: folderName,
  deleted: true,
  projectCount: projectCount,
  subfolderCount: subfolderCount
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
