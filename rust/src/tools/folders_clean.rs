use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::{escape_for_jxa, JxaRunner},
};

pub async fn list_folders<R: JxaRunner>(runner: &R, limit: i32) -> Result<Value> {
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }

    let script = format!(
        r#"const folderProjectCounts = new Map();
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
}});"#
    );
    runner.run_omnijs(&script).await
}

pub async fn create_folder<R: JxaRunner>(
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

    let folder_name = escape_for_jxa(name.trim());
    let parent_name = parent
        .map(|value| escape_for_jxa(value.trim()))
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const folderName = {folder_name};
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
}};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn get_folder<R: JxaRunner>(runner: &R, folder_name_or_id: &str) -> Result<Value> {
    if folder_name_or_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "folder_name_or_id must not be empty.".to_string(),
        ));
    }

    let folder_filter = escape_for_jxa(folder_name_or_id.trim());
    let script = format!(
        r#"const folderFilter = {folder_filter};

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
}};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn update_folder<R: JxaRunner>(
    runner: &R,
    folder_name_or_id: &str,
    name: Option<&str>,
    status: Option<&str>,
) -> Result<Value> {
    let folder_filter = folder_name_or_id.trim();
    let new_name_value = name.map(str::trim);
    let status_value = status;

    if folder_filter.is_empty() {
        return Err(OmniFocusError::Validation(
            "folder_name_or_id must not be empty.".to_string(),
        ));
    }
    if name.is_some() && new_name_value == Some("") {
        return Err(OmniFocusError::Validation(
            "name must not be empty when provided.".to_string(),
        ));
    }
    if let Some(value) = status_value {
        if !matches!(value, "active" | "dropped") {
            return Err(OmniFocusError::Validation(
                "status must be one of: active, dropped.".to_string(),
            ));
        }
    }
    if new_name_value.is_none() && status_value.is_none() {
        return Err(OmniFocusError::Validation(
            "at least one field must be provided: name or status.".to_string(),
        ));
    }

    let escaped_folder_filter = escape_for_jxa(folder_filter);
    let escaped_name = new_name_value
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let escaped_status = status_value
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let script = format!(
        r#"const folderFilter = {escaped_folder_filter};
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
}};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn delete_folder<R: JxaRunner>(runner: &R, folder_name_or_id: &str) -> Result<Value> {
    let folder_filter = folder_name_or_id.trim();
    if folder_filter.is_empty() {
        return Err(OmniFocusError::Validation(
            "folder_name_or_id must not be empty.".to_string(),
        ));
    }

    let escaped_folder_filter = escape_for_jxa(folder_filter);
    let script = format!(
        r#"const folderFilter = {escaped_folder_filter};

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
}};"#
    );
    runner.run_omnijs(&script).await
}

pub async fn delete_folders_batch<R: JxaRunner>(
    runner: &R,
    folder_ids_or_names: Vec<String>,
) -> Result<Value> {
    if folder_ids_or_names.is_empty() {
        return Err(OmniFocusError::Validation(
            "folder_ids_or_names must contain at least one folder id or name.".to_string(),
        ));
    }

    let mut normalized_folder_ids_or_names: Vec<String> =
        Vec::with_capacity(folder_ids_or_names.len());
    let mut seen_folder_ids_or_names: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    for folder_id_or_name in folder_ids_or_names {
        let normalized_folder_id_or_name = folder_id_or_name.trim();
        if normalized_folder_id_or_name.is_empty() {
            return Err(OmniFocusError::Validation(
                "each folder id or name must be a non-empty string.".to_string(),
            ));
        }
        if seen_folder_ids_or_names.contains(normalized_folder_id_or_name) {
            return Err(OmniFocusError::Validation(format!(
                "folder_ids_or_names must not contain duplicates: {normalized_folder_id_or_name}"
            )));
        }
        seen_folder_ids_or_names.insert(normalized_folder_id_or_name.to_string());
        normalized_folder_ids_or_names.push(normalized_folder_id_or_name.to_string());
    }

    let folder_ids_or_names_value = serde_json::to_string(&normalized_folder_ids_or_names)?;
    let script = format!(
        r#"const folderIdsOrNames = {folder_ids_or_names_value};
const folders = document.flattenedFolders.slice();
const results = folderIdsOrNames.map(idOrName => {{
  const folder = folders.find(item => item.id.primaryKey === idOrName || item.name === idOrName);
  if (!folder) {{
    return {{
      id_or_name: idOrName,
      id: null,
      name: null,
      deleted: false,
      error: "not found"
    }};
  }}

  const resolvedId = folder.id.primaryKey;
  const resolvedName = folder.name;
  try {{
    deleteObject(folder);
    return {{
      id_or_name: idOrName,
      id: resolvedId,
      name: resolvedName,
      deleted: true,
      error: null
    }};
  }} catch (e) {{
    const errorMessage = e && e.message ? String(e.message) : String(e);
    return {{
      id_or_name: idOrName,
      id: resolvedId,
      name: resolvedName,
      deleted: false,
      error: errorMessage
    }};
  }}
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

pub async fn delete_folders_batch<R: JxaRunner>(
    runner: &R,
    folder_ids_or_names: Vec<String>,
) -> Result<Value> {
    if folder_ids_or_names.is_empty() {
        return Err(OmniFocusError::Validation(
            "folder_ids_or_names must contain at least one folder identifier.".to_string(),
        ));
    }

    let mut normalized_identifiers: Vec<String> = Vec::with_capacity(folder_ids_or_names.len());
    for folder_id_or_name in folder_ids_or_names {
        let normalized_identifier = folder_id_or_name.trim();
        if normalized_identifier.is_empty() {
            return Err(OmniFocusError::Validation(
                "each folder identifier must be a non-empty string.".to_string(),
            ));
        }
        normalized_identifiers.push(normalized_identifier.to_string());
    }

    let identifiers_value = serde_json::to_string(&normalized_identifiers)?;
    let script = format!(
        r#"const folderIdentifiers = {identifiers_value};
const folderById = new Map();
const folderByName = new Map();
for (const folder of document.flattenedFolders) {{
  try {{
    folderById.set(folder.id.primaryKey, folder);
    if (!folderByName.has(folder.name)) folderByName.set(folder.name, folder);
  }} catch (e) {{
  }}
}}
const results = folderIdentifiers.map(identifier => {{
  const folder = folderById.get(identifier) || folderByName.get(identifier);
  if (!folder) {{
    return {{
      id_or_name: identifier,
      id: null,
      name: null,
      deleted: false,
      error: "Folder not found."
    }};
  }}
  const folderId = folder.id.primaryKey;
  const folderName = folder.name;
  deleteObject(folder);
  return {{
    id_or_name: identifier,
    id: folderId,
    name: folderName,
    deleted: true,
    error: null
  }};
}});
const deletedCount = results.filter(result => result.deleted).length;
const failedCount = results.length - deletedCount;
return {{
  summary: {{
    requested: folderIdentifiers.length,
    deleted: deletedCount,
    failed: failedCount
  }},
  partial_success: deletedCount > 0 && failedCount > 0,
  results: results
}};"#
    );
    runner.run_omnijs(&script).await
}
