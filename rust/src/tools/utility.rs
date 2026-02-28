use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::{escape_for_jxa, JxaRunner},
};

pub async fn append_to_note<R: JxaRunner>(
    runner: &R,
    object_type: &str,
    object_id: &str,
    text: &str,
) -> Result<Value> {
    if !matches!(object_type, "task" | "project") {
        return Err(OmniFocusError::Validation(
            "object_type must be one of: task, project.".to_string(),
        ));
    }
    if object_id.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "object_id must not be empty.".to_string(),
        ));
    }
    if text.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "text must not be empty.".to_string(),
        ));
    }

    let object_type_value = escape_for_jxa(object_type);
    let object_id_value = escape_for_jxa(object_id.trim());
    let text_value = escape_for_jxa(text);
    let script = format!(
        r#"const objectType = {object_type_value};
const objectId = {object_id_value};
const textToAppend = {text_value};

let obj;
if (objectType === "task") {{
  obj = document.flattenedTasks.find(item => item.id.primaryKey === objectId);
  if (!obj) {{
    throw new Error(`Task not found: ${{objectId}}`);
  }}
}} else if (objectType === "project") {{
  obj = document.flattenedProjects.find(item => item.id.primaryKey === objectId);
  if (!obj) {{
    throw new Error(`Project not found: ${{objectId}}`);
  }}
}} else {{
  throw new Error(`Invalid object_type: ${{objectType}}`);
}}

obj.appendStringToNote(textToAppend);

return {{
  id: obj.id.primaryKey,
  name: obj.name,
  type: objectType,
  noteLength: obj.note.length
}};"#
    );
    runner.run_omnijs(&script).await
}
