//! `tags` tool parameters: some MCP clients send a JSON array, others a single string
//! containing a JSON array (e.g. `"[\"Quick\",\"Home\"]"`).

use std::borrow::Cow;
use std::fmt;

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::de::{Deserialize, Deserializer, Error as DeError, SeqAccess, Visitor};
use serde::ser::{Serialize, Serializer};

/// Tag list from wire: native JSON array or a string that parses as a JSON array of strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlexibleTagList(pub Vec<String>);

impl FlexibleTagList {
    pub fn into_vec(self) -> Vec<String> {
        self.0
    }
}

impl Serialize for FlexibleTagList {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for FlexibleTagList {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct FlexibleTagListVisitor;

        impl<'de> Visitor<'de> for FlexibleTagListVisitor {
            type Value = FlexibleTagList;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str(
                    "a JSON array of tag name strings, or a string containing a JSON array of strings",
                )
            }

            fn visit_str<E: DeError>(self, v: &str) -> Result<Self::Value, E> {
                let v = v.trim();
                if v.is_empty() {
                    return Ok(FlexibleTagList(vec![]));
                }
                serde_json::from_str::<Vec<String>>(v).map(FlexibleTagList).map_err(|e| {
                    DeError::custom(format!(
                        "tags string must be a JSON array of strings (e.g. [\"Home\",\"Quick\"]): {e}"
                    ))
                })
            }

            fn visit_string<E: DeError>(self, v: String) -> Result<Self::Value, E> {
                self.visit_str(&v)
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let mut out = Vec::new();
                while let Some(s) = seq.next_element::<String>()? {
                    out.push(s);
                }
                Ok(FlexibleTagList(out))
            }
        }

        deserializer.deserialize_any(FlexibleTagListVisitor)
    }
}

#[derive(JsonSchema)]
#[serde(untagged)]
#[allow(dead_code)]
enum FlexibleTagListSchemaRepr {
    Array(#[schemars(description = "Tag names (preferred).")] Vec<String>),
    JsonString(
        #[schemars(
            description = "JSON array of tag names as one string, for clients that encode all tool arguments as strings (e.g. [\"Home\",\"Quick\"])."
        )]
        String,
    ),
}

impl JsonSchema for FlexibleTagList {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("FlexibleTagList")
    }

    fn json_schema(gen: &mut SchemaGenerator) -> Schema {
        FlexibleTagListSchemaRepr::json_schema(gen)
    }

    fn inline_schema() -> bool {
        true
    }
}

/// Maps `Option<FlexibleTagList>` to `Option<Vec<String>>` for tool internals.
pub fn tags_as_opt_vec(tags: Option<FlexibleTagList>) -> Option<Vec<String>> {
    tags.map(|t| t.0)
}
