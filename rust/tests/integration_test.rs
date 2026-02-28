#![cfg(feature = "integration")]

use std::time::{SystemTime, UNIX_EPOCH};

use omnifocus_mcp::{
    error::{OmniFocusError, Result},
    jxa::{run_omnijs, RealJxaRunner},
    tools::{
        folders::list_folders,
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{complete_project, create_project, get_project, list_projects},
        tags::list_tags,
        tasks::{
            complete_task, create_task, delete_task, get_inbox, get_task, list_tasks, search_tasks,
            update_task,
        },
    },
};
use serde_json::Value;

const TEST_PREFIX: &str = "[TEST-MCP]";

#[derive(Default)]
struct CleanupRegistry {
    task_ids: Vec<String>,
    project_ids: Vec<String>,
}

impl CleanupRegistry {
    fn test_name(&self, suffix: &str) -> String {
        let millis = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_millis(),
            Err(_) => 0,
        };
        format!("{TEST_PREFIX} {suffix} {millis}")
    }

    async fn cleanup(&mut self, runner: &RealJxaRunner) {
        for task_id in self.task_ids.clone().into_iter().rev() {
            let _ = delete_task(runner, &task_id).await;
        }
        self.task_ids.clear();

        for project_id in self.project_ids.clone().into_iter().rev() {
            let _ = complete_project(runner, &project_id).await;
        }
        self.project_ids.clear();
    }
}

fn require_object<'a>(value: &'a Value, label: &str) -> Result<&'a serde_json::Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| OmniFocusError::Validation(format!("{label} did not return an object.")))
}

fn require_array<'a>(value: &'a Value, label: &str) -> Result<&'a Vec<Value>> {
    value
        .as_array()
        .ok_or_else(|| OmniFocusError::Validation(format!("{label} did not return an array.")))
}

fn require_string_key<'a>(value: &'a Value, key: &str, label: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
        .ok_or_else(|| OmniFocusError::Validation(format!("{label} missing non-empty {key}.")))
}

fn assert_keys(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
    label: &str,
) -> Result<()> {
    let missing: Vec<&str> = keys
        .iter()
        .copied()
        .filter(|key| !object.contains_key(*key))
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(OmniFocusError::Validation(format!(
            "{label} missing keys: {}",
            missing.join(", ")
        )))
    }
}

async fn clean_prefix_artifacts(runner: &RealJxaRunner) {
    let prefix_json = match serde_json::to_string(TEST_PREFIX) {
        Ok(value) => value,
        Err(_) => return,
    };
    let script = format!(
        r#"const prefix = {prefix_json};
const matchingTasks = document.flattenedTasks.filter(task => (task.name || "").startsWith(prefix));
matchingTasks.forEach(task => {{
  try {{
    task.drop(false);
  }} catch (_) {{
  }}
}});

const matchingProjects = document.flattenedProjects.filter(project => (project.name || "").startsWith(prefix));
matchingProjects.forEach(project => {{
  try {{
    project.markComplete();
  }} catch (_) {{
  }}
}});

return true;"#
    );
    let _ = run_omnijs(&script).await;
    let _ = runner;
}

#[tokio::test]
async fn test_jxa_bridge_connectivity() -> Result<()> {
    let value = run_omnijs("return document.flattenedTasks.length;").await?;
    if !value.is_number() {
        return Err(OmniFocusError::Validation(
            "jxa bridge did not return a numeric task count.".to_string(),
        ));
    }
    Ok(())
}

#[tokio::test]
async fn test_read_tools_return_valid_json() -> Result<()> {
    let runner = RealJxaRunner::new();
    clean_prefix_artifacts(&runner).await;
    let mut cleanup = CleanupRegistry::default();

    let created_task = create_task(
        &runner,
        &cleanup.test_name("Read tool task"),
        None,
        Some("integration read tool seed"),
        None,
        None,
        Some(true),
        None,
        None,
    )
    .await?;
    let created_task_id = require_string_key(&created_task, "id", "create_task result")?.to_string();
    cleanup.task_ids.push(created_task_id.clone());

    let inbox = get_inbox(&runner, 20).await?;
    if let Some(first) = inbox.first() {
        if first.id.trim().is_empty() || first.name.trim().is_empty() {
            cleanup.cleanup(&runner).await;
            return Err(OmniFocusError::Validation(
                "get_inbox returned invalid id or name.".to_string(),
            ));
        }
    }

    let tasks = list_tasks(&runner, None, None, None, "all", 20).await?;
    if let Some(first) = tasks.first() {
        if first.id.trim().is_empty() || first.name.trim().is_empty() {
            cleanup.cleanup(&runner).await;
            return Err(OmniFocusError::Validation(
                "list_tasks returned invalid id or name.".to_string(),
            ));
        }
    }

    let task = get_task(&runner, &created_task_id).await?;
    let task_obj = require_object(&task, "get_task result")?;
    assert_keys(
        task_obj,
        &[
            "id",
            "name",
            "note",
            "flagged",
            "dueDate",
            "deferDate",
            "completed",
            "completionDate",
            "projectName",
            "tags",
            "estimatedMinutes",
            "children",
            "parentName",
            "sequential",
            "repetitionRule",
        ],
        "get_task result",
    )?;

    let search_results = search_tasks(&runner, "Read tool", 20).await?;
    if let Some(first) = search_results.first() {
        if first.id.trim().is_empty() || first.name.trim().is_empty() {
            cleanup.cleanup(&runner).await;
            return Err(OmniFocusError::Validation(
                "search_tasks returned invalid id or name.".to_string(),
            ));
        }
    }

    let projects = list_projects(&runner, None, "active", 20).await?;
    let projects_array = require_array(&projects, "list_projects result")?;
    if let Some(first) = projects_array.first() {
        let project_obj = require_object(first, "list_projects item")?;
        assert_keys(
            project_obj,
            &[
                "id",
                "name",
                "status",
                "folderName",
                "taskCount",
                "remainingTaskCount",
                "deferDate",
                "dueDate",
                "note",
                "sequential",
                "reviewInterval",
            ],
            "list_projects item",
        )?;
    }

    let created_project = create_project(&runner, &cleanup.test_name("Read tool project"), None, None, None, None, None).await?;
    let created_project_id =
        require_string_key(&created_project, "id", "create_project result")?.to_string();
    cleanup.project_ids.push(created_project_id.clone());

    let project = get_project(&runner, &created_project_id).await?;
    let project_obj = require_object(&project, "get_project result")?;
    assert_keys(
        project_obj,
        &[
            "id",
            "name",
            "status",
            "folderName",
            "taskCount",
            "remainingTaskCount",
            "deferDate",
            "dueDate",
            "note",
            "sequential",
            "reviewInterval",
            "rootTasks",
        ],
        "get_project result",
    )?;

    let tags = list_tags(&runner, 20).await?;
    let tags_array = require_array(&tags, "list_tags result")?;
    if let Some(first) = tags_array.first() {
        let tag_obj = require_object(first, "list_tags item")?;
        assert_keys(
            tag_obj,
            &["id", "name", "parent", "availableTaskCount", "status"],
            "list_tags item",
        )?;
    }

    let folders = list_folders(&runner, 20).await?;
    let folders_array = require_array(&folders, "list_folders result")?;
    if let Some(first) = folders_array.first() {
        let folder_obj = require_object(first, "list_folders item")?;
        assert_keys(
            folder_obj,
            &["id", "name", "parentName", "projectCount"],
            "list_folders item",
        )?;
    }

    let forecast = get_forecast(&runner, 20).await?;
    let forecast_obj = require_object(&forecast, "get_forecast result")?;
    assert_keys(
        forecast_obj,
        &["overdue", "dueToday", "flagged"],
        "get_forecast result",
    )?;

    let perspectives = list_perspectives(&runner, 20).await?;
    let perspectives_array = require_array(&perspectives, "list_perspectives result")?;
    if let Some(first) = perspectives_array.first() {
        let perspective_obj = require_object(first, "list_perspectives item")?;
        assert_keys(perspective_obj, &["id", "name"], "list_perspectives item")?;
    }

    cleanup.cleanup(&runner).await;
    Ok(())
}

#[tokio::test]
async fn test_task_lifecycle() -> Result<()> {
    let runner = RealJxaRunner::new();
    clean_prefix_artifacts(&runner).await;
    let mut cleanup = CleanupRegistry::default();

    let created = create_task(
        &runner,
        &cleanup.test_name("Lifecycle task"),
        None,
        None,
        Some("2030-01-01T10:00:00Z"),
        None,
        Some(true),
        None,
        None,
    )
    .await?;
    let task_id = require_string_key(&created, "id", "create_task result")?.to_string();
    cleanup.task_ids.push(task_id.clone());

    let fetched = get_task(&runner, &task_id).await?;
    let fetched_id = require_string_key(&fetched, "id", "get_task result")?;
    if fetched_id != task_id {
        cleanup.cleanup(&runner).await;
        return Err(OmniFocusError::Validation(
            "get_task returned a different task id.".to_string(),
        ));
    }

    let updated_name = cleanup.test_name("Lifecycle updated");
    let updated = update_task(
        &runner,
        &task_id,
        Some(&updated_name),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await?;
    let updated_result_name = require_string_key(&updated, "name", "update_task result")?;
    if updated_result_name != updated_name {
        cleanup.cleanup(&runner).await;
        return Err(OmniFocusError::Validation(
            "update_task did not apply the expected name.".to_string(),
        ));
    }

    let completed = complete_task(&runner, &task_id).await?;
    if completed.get("completed").and_then(Value::as_bool) != Some(true) {
        cleanup.cleanup(&runner).await;
        return Err(OmniFocusError::Validation(
            "complete_task did not return completed=true.".to_string(),
        ));
    }

    let deleted = delete_task(&runner, &task_id).await?;
    if deleted.get("deleted").and_then(Value::as_bool) != Some(true) {
        cleanup.cleanup(&runner).await;
        return Err(OmniFocusError::Validation(
            "delete_task did not return deleted=true.".to_string(),
        ));
    }
    cleanup.task_ids.retain(|id| id != &task_id);

    cleanup.cleanup(&runner).await;
    Ok(())
}

#[tokio::test]
async fn test_search_finds_created_task() -> Result<()> {
    let runner = RealJxaRunner::new();
    clean_prefix_artifacts(&runner).await;
    let mut cleanup = CleanupRegistry::default();

    let token = cleanup.test_name("search token");
    let created = create_task(
        &runner,
        &format!("{TEST_PREFIX} Search {token}"),
        None,
        Some(&format!("search token {token}")),
        None,
        None,
        None,
        None,
        None,
    )
    .await?;
    let task_id = require_string_key(&created, "id", "create_task result")?.to_string();
    cleanup.task_ids.push(task_id.clone());

    let results = search_tasks(&runner, &token, 50).await?;
    let found = results.iter().any(|item| item.id == task_id);
    cleanup.cleanup(&runner).await;

    if !found {
        return Err(OmniFocusError::Validation(
            "search_tasks did not return the created task.".to_string(),
        ));
    }
    Ok(())
}

#[tokio::test]
async fn test_project_lifecycle() -> Result<()> {
    let runner = RealJxaRunner::new();
    clean_prefix_artifacts(&runner).await;
    let mut cleanup = CleanupRegistry::default();

    let project_name = cleanup.test_name("Lifecycle project");
    let created = create_project(&runner, &project_name, None, None, None, None, None).await?;
    let project_id = require_string_key(&created, "id", "create_project result")?.to_string();
    cleanup.project_ids.push(project_id.clone());

    let fetched = get_project(&runner, &project_id).await?;
    let fetched_id = require_string_key(&fetched, "id", "get_project result")?;
    if fetched_id != project_id {
        cleanup.cleanup(&runner).await;
        return Err(OmniFocusError::Validation(
            "get_project returned a different project id.".to_string(),
        ));
    }

    let completed = complete_project(&runner, &project_id).await?;
    if completed.get("completed").and_then(Value::as_bool) != Some(true) {
        cleanup.cleanup(&runner).await;
        return Err(OmniFocusError::Validation(
            "complete_project did not return completed=true.".to_string(),
        ));
    }
    cleanup.project_ids.retain(|id| id != &project_id);

    cleanup.cleanup(&runner).await;
    Ok(())
}
#![cfg(feature = "integration")]

use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};

use omnifocus_mcp::{
    jxa::{JxaRunner, RealJxaRunner},
    tools::{
        folders::list_folders,
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{complete_project, create_project, get_project, list_projects},
        tags::list_tags,
        tasks::{
            complete_task, create_task, delete_task, get_inbox, get_task, list_tasks, search_tasks,
            update_task,
        },
    },
};
use serde_json::Value;

#[derive(Default)]
struct CleanupRegistry {
    task_ids: Vec<String>,
    project_ids: Vec<String>,
}

fn unique_name(suffix: &str) -> String {
    let millis = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis(),
        Err(_) => 0,
    };
    format!("[TEST-MCP] {suffix} {millis}")
}

fn boxed_err(message: &str) -> Box<dyn Error> {
    std::io::Error::other(message).into()
}

async fn cleanup(registry: &mut CleanupRegistry, runner: &RealJxaRunner) {
    while let Some(task_id) = registry.task_ids.pop() {
        let _ = delete_task(runner, &task_id).await;
    }
    while let Some(project_id) = registry.project_ids.pop() {
        let _ = complete_project(runner, &project_id).await;
    }
}

fn get_non_empty_string<'a>(
    value: &'a Value,
    key: &str,
    label: &str,
) -> Result<&'a str, Box<dyn Error>> {
    match value.get(key).and_then(Value::as_str) {
        Some(text) if !text.trim().is_empty() => Ok(text),
        _ => Err(boxed_err(&format!("{label} missing non-empty `{key}`"))),
    }
}

#[tokio::test]
async fn test_jxa_bridge_connectivity() -> Result<(), Box<dyn Error>> {
    let runner = RealJxaRunner::new();
    let result = runner
        .run_omnijs("return document.flattenedTasks.length;")
        .await?;
    if !result.is_number() {
        return Err(boxed_err("run_omnijs did not return a number"));
    }
    Ok(())
}

#[tokio::test]
async fn test_read_tools_return_valid_json() -> Result<(), Box<dyn Error>> {
    let runner = RealJxaRunner::new();
    let mut registry = CleanupRegistry::default();

    let result = async {
        let created = create_task(
            &runner,
            &unique_name("read tool task"),
            None,
            None,
            None,
            None,
            Some(true),
            None,
            None,
        )
        .await?;
        let created_id = get_non_empty_string(&created, "id", "create_task")?.to_string();
        registry.task_ids.push(created_id.clone());

        let inbox = get_inbox(&runner, 20).await?;
        if let Some(first) = inbox.first() {
            if first.id.trim().is_empty() || first.name.trim().is_empty() {
                return Err(boxed_err("get_inbox returned invalid task"));
            }
        }

        let tasks = list_tasks(&runner, None, None, None, "all", 20).await?;
        if let Some(first) = tasks.first() {
            if first.id.trim().is_empty() || first.name.trim().is_empty() {
                return Err(boxed_err("list_tasks returned invalid task"));
            }
        }

        let task = get_task(&runner, &created_id).await?;
        let _ = get_non_empty_string(&task, "id", "get_task result")?;
        let _ = get_non_empty_string(&task, "name", "get_task result")?;

        let _ = search_tasks(&runner, "read tool", 20).await?;

        let projects = list_projects(&runner, None, "active", 20).await?;
        let project_id = if let Some(first) = projects.as_array().and_then(|items| items.first()) {
            get_non_empty_string(first, "id", "list_projects item")?.to_string()
        } else {
            let created_project =
                create_project(&runner, &unique_name("read tool project"), None, None, None, None, None)
                    .await?;
            let id =
                get_non_empty_string(&created_project, "id", "create_project result")?.to_string();
            registry.project_ids.push(id.clone());
            id
        };

        let project = get_project(&runner, &project_id).await?;
        let _ = get_non_empty_string(&project, "id", "get_project result")?;
        let _ = get_non_empty_string(&project, "name", "get_project result")?;

        let _ = list_tags(&runner, 20).await?;
        let _ = list_folders(&runner, 20).await?;
        let forecast = get_forecast(&runner, 20).await?;
        if forecast.get("overdue").is_none()
            || forecast.get("dueToday").is_none()
            || forecast.get("flagged").is_none()
        {
            return Err(boxed_err("get_forecast result missing expected keys"));
        }
        let _ = list_perspectives(&runner, 20).await?;

        Ok::<(), Box<dyn Error>>(())
    }
    .await;

    cleanup(&mut registry, &runner).await;
    result
}

#[tokio::test]
async fn test_task_lifecycle() -> Result<(), Box<dyn Error>> {
    let runner = RealJxaRunner::new();
    let mut registry = CleanupRegistry::default();

    let result = async {
        let created = create_task(
            &runner,
            &unique_name("lifecycle task"),
            None,
            None,
            None,
            None,
            Some(true),
            None,
            None,
        )
        .await?;
        let created_id = get_non_empty_string(&created, "id", "create_task result")?.to_string();
        registry.task_ids.push(created_id.clone());

        let fetched = get_task(&runner, &created_id).await?;
        if get_non_empty_string(&fetched, "id", "get_task result")? != created_id {
            return Err(boxed_err("get_task returned mismatched task id"));
        }

        let updated_name = unique_name("lifecycle updated");
        let updated = update_task(
            &runner,
            &created_id,
            Some(&updated_name),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await?;
        if get_non_empty_string(&updated, "name", "update_task result")? != updated_name {
            return Err(boxed_err("update_task did not update name"));
        }

        let completed = complete_task(&runner, &created_id).await?;
        if completed.get("completed").and_then(Value::as_bool) != Some(true) {
            return Err(boxed_err("complete_task did not set completed=true"));
        }

        let deleted = delete_task(&runner, &created_id).await?;
        if deleted.get("deleted").and_then(Value::as_bool) != Some(true) {
            return Err(boxed_err("delete_task did not set deleted=true"));
        }
        registry.task_ids.retain(|id| id != &created_id);

        Ok::<(), Box<dyn Error>>(())
    }
    .await;

    cleanup(&mut registry, &runner).await;
    result
}

#[tokio::test]
async fn test_search_finds_created_task() -> Result<(), Box<dyn Error>> {
    let runner = RealJxaRunner::new();
    let mut registry = CleanupRegistry::default();
    let token = unique_name("search token");

    let result = async {
        let created = create_task(
            &runner,
            &format!("[TEST-MCP] Search {token}"),
            None,
            Some(&format!("search note {token}")),
            None,
            None,
            None,
            None,
            None,
        )
        .await?;
        let created_id = get_non_empty_string(&created, "id", "create_task result")?.to_string();
        registry.task_ids.push(created_id.clone());

        let results = search_tasks(&runner, &token, 50).await?;
        let found = results.iter().any(|item| item.id == created_id);
        if !found {
            return Err(boxed_err("search_tasks did not return created task"));
        }

        Ok::<(), Box<dyn Error>>(())
    }
    .await;

    cleanup(&mut registry, &runner).await;
    result
}

#[tokio::test]
async fn test_project_lifecycle() -> Result<(), Box<dyn Error>> {
    let runner = RealJxaRunner::new();
    let mut registry = CleanupRegistry::default();

    let result = async {
        let project_name = unique_name("lifecycle project");
        let created = create_project(&runner, &project_name, None, None, None, None, None).await?;
        let project_id = get_non_empty_string(&created, "id", "create_project result")?.to_string();
        registry.project_ids.push(project_id.clone());

        let fetched = get_project(&runner, &project_id).await?;
        if get_non_empty_string(&fetched, "id", "get_project result")? != project_id {
            return Err(boxed_err("get_project returned mismatched project id"));
        }

        let completed = complete_project(&runner, &project_id).await?;
        if completed.get("completed").and_then(Value::as_bool) != Some(true) {
            return Err(boxed_err("complete_project did not set completed=true"));
        }
        registry.project_ids.retain(|id| id != &project_id);

        Ok::<(), Box<dyn Error>>(())
    }
    .await;

    cleanup(&mut registry, &runner).await;
    result
}
#![cfg(feature = "integration")]

use std::time::{SystemTime, UNIX_EPOCH};

use omnifocus_mcp::{
    jxa::{JxaRunner, RealJxaRunner},
    tools::{
        folders::list_folders,
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{complete_project, create_project, get_project, list_projects},
        tags::list_tags,
        tasks::{
            complete_task, create_task, delete_task, get_inbox, get_task, list_tasks, search_tasks,
            update_task,
        },
    },
};
use serde_json::Value;

const TEST_PREFIX: &str = "[TEST-MCP]";

fn unique_name(label: &str) -> String {
    let millis = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis(),
        Err(_) => 0,
    };
    format!("{TEST_PREFIX} {label} {millis}")
}

fn require_object<'a>(value: &'a Value, label: &str) -> &'a serde_json::Map<String, Value> {
    value
        .as_object()
        .unwrap_or_else(|| panic!("{label} did not return an object"))
}

fn require_array<'a>(value: &'a Value, label: &str) -> &'a Vec<Value> {
    value
        .as_array()
        .unwrap_or_else(|| panic!("{label} did not return an array"))
}

fn require_string_field<'a>(value: &'a Value, key: &str, label: &str) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
        .unwrap_or_else(|| panic!("{label} missing non-empty {key}"))
}

async fn cleanup_test_data(runner: &RealJxaRunner) {
    let escaped_prefix = serde_json::to_string(TEST_PREFIX).expect("prefix should serialize");
    let script = format!(
        r#"const prefix = {escaped_prefix};
document.flattenedTasks
  .filter(task => (task.name || "").startsWith(prefix))
  .forEach(task => {{
    try {{
      task.drop(false);
    }} catch (_) {{
    }}
  }});
document.flattenedProjects
  .filter(project => (project.name || "").startsWith(prefix))
  .forEach(project => {{
    try {{
      project.markComplete();
    }} catch (_) {{
    }}
  }});
document.flattenedTags
  .filter(tag => (tag.name || "").startsWith(prefix))
  .forEach(tag => {{
    try {{
      tag.drop(false);
    }} catch (_) {{
    }}
  }});
return true;"#
    );
    let _ = runner.run_omnijs(&script).await;
}

#[tokio::test]
async fn test_jxa_bridge_connectivity() {
    let runner = RealJxaRunner::new();
    let value = runner
        .run_omnijs("return document.flattenedTasks.length;")
        .await
        .expect("bridge probe should succeed");
    assert!(value.is_number(), "bridge probe should return a number");
}

#[tokio::test]
async fn test_read_tools_return_valid_json() {
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await;

    let inbox = get_inbox(&runner, 20)
        .await
        .expect("get_inbox should succeed");
    if let Some(first) = inbox.first() {
        assert!(
            !first.id.trim().is_empty(),
            "inbox task id should be non-empty"
        );
        assert!(
            !first.name.trim().is_empty(),
            "inbox task name should be non-empty"
        );
    }

    let tasks = list_tasks(&runner, None, None, None, "all", 50)
        .await
        .expect("list_tasks should succeed");
    let sample_task_id = if let Some(first) = tasks.first() {
        first.id.clone()
    } else {
        let created = create_task(
            &runner,
            &unique_name("read fallback task"),
            None,
            Some("integration read fallback"),
            None,
            None,
            Some(false),
            None,
            None,
        )
        .await
        .expect("create_task fallback should succeed");
        require_string_field(&created, "id", "create_task fallback result").to_string()
    };

    let task_value = get_task(&runner, &sample_task_id)
        .await
        .expect("get_task should succeed");
    let task_obj = require_object(&task_value, "get_task result");
    assert!(task_obj.contains_key("id"), "get_task should include id");
    assert!(
        task_obj.contains_key("name"),
        "get_task should include name"
    );
    assert!(
        task_obj.contains_key("completed"),
        "get_task should include completed"
    );
    assert!(
        task_obj.contains_key("tags"),
        "get_task should include tags"
    );

    let _ = search_tasks(&runner, "a", 20)
        .await
        .expect("search_tasks should succeed");

    let projects_value = list_projects(&runner, None, "active", 50)
        .await
        .expect("list_projects should succeed");
    let projects = require_array(&projects_value, "list_projects result");
    let sample_project_key = if let Some(first) = projects.first() {
        require_string_field(first, "id", "list_projects item").to_string()
    } else {
        let created = create_project(
            &runner,
            &unique_name("read fallback project"),
            None,
            Some("integration read fallback"),
            None,
            None,
            Some(false),
        )
        .await
        .expect("create_project fallback should succeed");
        require_string_field(&created, "id", "create_project fallback result").to_string()
    };
    let project_value = get_project(&runner, &sample_project_key)
        .await
        .expect("get_project should succeed");
    let project_obj = require_object(&project_value, "get_project result");
    assert!(
        project_obj.contains_key("id"),
        "get_project should include id"
    );
    assert!(
        project_obj.contains_key("name"),
        "get_project should include name"
    );
    assert!(
        project_obj.contains_key("status"),
        "get_project should include status"
    );

    let tags_value = list_tags(&runner, 50)
        .await
        .expect("list_tags should succeed");
    let _ = require_array(&tags_value, "list_tags result");

    let folders_value = list_folders(&runner, 50)
        .await
        .expect("list_folders should succeed");
    let _ = require_array(&folders_value, "list_folders result");

    let forecast_value = get_forecast(&runner, 50)
        .await
        .expect("get_forecast should succeed");
    let forecast_obj = require_object(&forecast_value, "get_forecast result");
    assert!(
        forecast_obj.contains_key("overdue"),
        "forecast should include overdue"
    );
    assert!(
        forecast_obj.contains_key("dueToday"),
        "forecast should include dueToday"
    );
    assert!(
        forecast_obj.contains_key("flagged"),
        "forecast should include flagged"
    );

    let perspectives_value = list_perspectives(&runner, 50)
        .await
        .expect("list_perspectives should succeed");
    let _ = require_array(&perspectives_value, "list_perspectives result");

    cleanup_test_data(&runner).await;
}

#[tokio::test]
async fn test_task_lifecycle() {
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await;

    let created = create_task(
        &runner,
        &unique_name("lifecycle task"),
        None,
        Some("integration lifecycle"),
        None,
        None,
        Some(false),
        None,
        Some(10),
    )
    .await
    .expect("create_task should succeed");
    let task_id = require_string_field(&created, "id", "create_task result").to_string();

    let fetched = get_task(&runner, &task_id)
        .await
        .expect("get_task should succeed");
    assert_eq!(
        fetched["id"], task_id,
        "get_task should return created task"
    );

    let updated = update_task(
        &runner,
        &task_id,
        Some(&unique_name("lifecycle task updated")),
        Some("integration lifecycle updated"),
        None,
        None,
        Some(true),
        None,
        Some(20),
    )
    .await
    .expect("update_task should succeed");
    assert_eq!(updated["id"], task_id, "update_task should return same id");

    let completed = complete_task(&runner, &task_id)
        .await
        .expect("complete_task should succeed");
    assert_eq!(
        completed["id"], task_id,
        "complete_task should return completed task id"
    );

    let deleted = delete_task(&runner, &task_id)
        .await
        .expect("delete_task should succeed");
    assert_eq!(
        deleted["id"], task_id,
        "delete_task should return deleted id"
    );

    cleanup_test_data(&runner).await;
}

#[tokio::test]
async fn test_search_finds_created_task() {
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await;

    let name = unique_name("search target");
    let created = create_task(
        &runner,
        &name,
        None,
        Some("integration search target"),
        None,
        None,
        Some(false),
        None,
        None,
    )
    .await
    .expect("create_task should succeed");
    let task_id = require_string_field(&created, "id", "create_task result").to_string();

    let query = name
        .split_whitespace()
        .next()
        .expect("name should include a token");
    let found = search_tasks(&runner, query, 100)
        .await
        .expect("search_tasks should succeed");
    assert!(
        found.iter().any(|task| task.id == task_id),
        "search should include created task"
    );

    let _ = delete_task(&runner, &task_id).await;
    cleanup_test_data(&runner).await;
}

#[tokio::test]
async fn test_project_lifecycle() {
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await;

    let project_name = unique_name("project lifecycle");
    let created = create_project(
        &runner,
        &project_name,
        None,
        Some("integration project lifecycle"),
        None,
        None,
        Some(true),
    )
    .await
    .expect("create_project should succeed");
    let project_id = require_string_field(&created, "id", "create_project result").to_string();

    let fetched = get_project(&runner, &project_id)
        .await
        .expect("get_project should succeed");
    assert_eq!(
        fetched["id"], project_id,
        "get_project should return created project"
    );

    let completed = complete_project(&runner, &project_id)
        .await
        .expect("complete_project should succeed");
    assert_eq!(
        completed["id"], project_id,
        "complete_project should return completed project id"
    );

    cleanup_test_data(&runner).await;
}
