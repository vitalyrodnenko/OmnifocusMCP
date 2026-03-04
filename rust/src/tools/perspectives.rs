use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::JxaRunner,
};

pub async fn list_perspectives<R: JxaRunner>(runner: &R, limit: i32) -> Result<Value> {
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }

    let script = format!(
        r#"const getPerspectiveId = (perspective) => {{
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

if (typeof Perspective !== "undefined" && Perspective.Custom && Perspective.Custom.all) {{
  Perspective.Custom.all.forEach(perspective => {{
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

return unique.slice(0, {limit});"#
    );

    runner.run_omnijs(&script).await
}
