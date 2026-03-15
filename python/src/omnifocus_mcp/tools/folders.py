import json

from omnifocus_mcp.app import mcp
from omnifocus_mcp.jxa import escape_for_jxa, run_omnijs
from omnifocus_mcp.registration import typed_tool


@typed_tool(mcp)
async def list_folders(limit: int = 100) -> str:
    """list folders with hierarchy context and project counts.

    returns id, name, parentName, and projectCount.
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
    """create a folder with optional parent folder.

    returns created id and name.
    """
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
    """get full details for one folder by id or name.

    returns direct child projects and direct subfolders.
    """
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
    """update a folder by id or name.

    modifies only provided fields: name and/or status.
    """
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
    """delete a folder by id or name. warning: this permanently removes the folder. do not use delete+recreate for folder edits or renames; use update_folder instead. contained projects may be moved to top level by omnifocus, so confirm with the user before proceeding."""
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
const projectCount = folder.projects.length;
const subfolderCount = folder.folders.length;
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


@typed_tool(mcp)
async def delete_folders_batch(folder_ids_or_names: list[str]) -> str:
    """delete multiple folders by id or exact name in one omnijs call.

    destructive operation. this permanently removes folders and may move
    contained projects based on omnifocus behavior. use update_folder for
    non-destructive edits. before calling this tool, always show the user the
    target folder list and ask for explicit confirmation.
    """
    if len(folder_ids_or_names) == 0:
        raise ValueError(
            "folder_ids_or_names must contain at least one folder id or name."
        )

    normalized_folder_ids_or_names: list[str] = []
    seen_folder_ids_or_names: set[str] = set()
    for folder_id_or_name in folder_ids_or_names:
        if not isinstance(folder_id_or_name, str):
            raise ValueError("each folder id or name must be a string.")
        normalized_folder_id_or_name = folder_id_or_name.strip()
        if normalized_folder_id_or_name == "":
            raise ValueError("each folder id or name must be a non-empty string.")
        if normalized_folder_id_or_name in seen_folder_ids_or_names:
            raise ValueError(
                "folder_ids_or_names must not contain duplicates: "
                f"{normalized_folder_id_or_name}"
            )
        seen_folder_ids_or_names.add(normalized_folder_id_or_name)
        normalized_folder_ids_or_names.append(normalized_folder_id_or_name)

    folder_ids_or_names_value = json.dumps(normalized_folder_ids_or_names)
    script = f"""
const folderIdsOrNames = {folder_ids_or_names_value};
const requests = folderIdsOrNames.map((idOrName, index) => ({{ idOrName, index }}));
const folders = document.flattenedFolders
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
const foldersById = new Map(folders.map(folder => [folder.id, folder]));

const resolveFolder = (idOrName) => {{
  const byId = foldersById.get(idOrName);
  if (byId) return byId;
  return folders.find(folder => folder.name === idOrName);
}};

const depthCache = new Map();
const getDepth = (folderId, stack = new Set()) => {{
  if (depthCache.has(folderId)) return depthCache.get(folderId);
  if (stack.has(folderId)) return 0;
  stack.add(folderId);
  const folder = foldersById.get(folderId);
  let depth = 0;
  if (folder && folder.parentId && foldersById.has(folder.parentId)) {{
    depth = getDepth(folder.parentId, stack) + 1;
  }}
  stack.delete(folderId);
  depthCache.set(folderId, depth);
  return depth;
}};

const existsFolderById = (folderId) => {{
  return document.flattenedFolders.some(folder => {{
    try {{
      return folder.id.primaryKey === folderId;
    }} catch (e) {{
      return false;
    }}
  }});
}};

const getLiveFolderById = (folderId) => {{
  return document.flattenedFolders.find(folder => {{
    try {{
      return folder.id.primaryKey === folderId;
    }} catch (e) {{
      return false;
    }}
  }});
}};

const results = new Array(requests.length);
const unresolved = [];
const resolved = [];

requests.forEach(request => {{
  const folder = resolveFolder(request.idOrName);
  if (!folder) {{
    unresolved.push(request);
    return;
  }}
  resolved.push({{
    ...request,
    folder,
    depth: getDepth(folder.id)
  }});
}});

resolved
  .sort((left, right) => right.depth - left.depth || left.index - right.index)
  .forEach(request => {{
    const resolvedId = request.folder.id;
    const resolvedName = request.folder.name;
    const liveFolder = getLiveFolderById(resolvedId);
    if (!liveFolder) {{
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
      deleteObject(liveFolder);
      results[request.index] = {{
        id_or_name: request.idOrName,
        id: resolvedId,
        name: resolvedName,
        deleted: true,
        error: null
      }};
    }} catch (e) {{
      if (!existsFolderById(resolvedId)) {{
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
