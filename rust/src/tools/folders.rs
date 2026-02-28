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

    if folder_filter.is_empty() {
        return Err(OmniFocusError::Validation(
            "folder_name_or_id must not be empty.".to_string(),
        ));
    }
    if let Some(value) = new_name_value {
        if value.is_empty() {
            return Err(OmniFocusError::Validation(
                "name must not be empty when provided.".to_string(),
            ));
        }
    }
    if let Some(value) = status {
        if !matches!(value, "active" | "dropped") {
            return Err(OmniFocusError::Validation(
                "status must be one of: active, dropped.".to_string(),
            ));
        }
    }
    if new_name_value.is_none() && status.is_none() {
        return Err(OmniFocusError::Validation(
            "at least one field must be provided: name or status.".to_string(),
        ));
    }

    let escaped_folder_filter = escape_for_jxa(folder_filter);
    let escaped_name = new_name_value
        .map(escape_for_jxa)
        .unwrap_or_else(|| "null".to_string());
    let escaped_status = status
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
}};"#
    );
    runner.run_omnijs(&script).await
}
