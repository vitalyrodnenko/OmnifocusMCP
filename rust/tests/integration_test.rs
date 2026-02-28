#![cfg(feature = "integration")]

use std::{
    collections::HashSet,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use omnifocus_mcp::{
    jxa::{run_omnijs, JxaRunner, RealJxaRunner},
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
use tokio::sync::Mutex;

static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn test_lock() -> &'static Mutex<()> {
    TEST_LOCK.get_or_init(|| Mutex::new(()))
}

fn unique_name(label: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("[TEST-MCP] {label} {millis}")
}

fn require_object<'a>(value: &'a Value, context: &str) -> &'a serde_json::Map<String, Value> {
    value
        .as_object()
        .unwrap_or_else(|| panic!("{context} should be an object"))
}

fn require_array<'a>(value: &'a Value, context: &str) -> &'a Vec<Value> {
    value
        .as_array()
        .unwrap_or_else(|| panic!("{context} should be an array"))
}

fn require_str_field(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| panic!("missing or invalid string field: {field}"))
}

fn assert_has_keys(value: &Value, required: &[&str]) {
    let object = require_object(value, "json payload");
    for key in required {
        assert!(
            object.contains_key(*key),
            "expected key `{key}` to be present"
        );
    }
}

async fn cleanup_test_data(runner: &RealJxaRunner) -> Result<(), Box<dyn std::error::Error>> {
    let script = r#"const taskPrefix = "[TEST-MCP]";
const testTasks = document.flattenedTasks.filter(task => {
  return task.name && task.name.startsWith(taskPrefix);
});
testTasks.forEach(task => {
  try {
    task.drop(false);
  } catch (_) {}
});

const testProjects = document.flattenedProjects.filter(project => {
  return project.name && project.name.startsWith(taskPrefix);
});
testProjects.forEach(project => {
  try {
    project.markComplete();
  } catch (_) {}
});

return {
  deletedTaskCount: testTasks.length,
  completedProjectCount: testProjects.length
};"#;

    let _ = runner.run_omnijs(script).await?;
    Ok(())
}

#[tokio::test]
async fn test_jxa_bridge_connectivity() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await?;

    let result = run_omnijs("return document.flattenedTasks.length;").await?;
    let count = result
        .as_i64()
        .ok_or_else(|| "bridge response was not an integer".to_string())?;
    assert!(count >= 0);

    cleanup_test_data(&runner).await?;
    Ok(())
}

#[tokio::test]
async fn test_read_tools_return_valid_json() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await?;

    let created_task = create_task(
        &runner,
        &unique_name("Read tool task"),
        None,
        Some("read tools validation payload"),
        None,
        None,
        Some(true),
        None,
        None,
    )
    .await?;
    let created_task_id = require_str_field(&created_task, "id");

    let inbox = get_inbox(&runner, 20).await?;
    if let Some(first) = inbox.first() {
        assert!(!first.id.is_empty());
        assert!(!first.name.is_empty());
    }

    let listed = list_tasks(&runner, None, None, None, "all", 20).await?;
    if let Some(first) = listed.first() {
        assert!(!first.id.is_empty());
        assert!(!first.name.is_empty());
    }

    let task = get_task(&runner, &created_task_id).await?;
    assert_has_keys(
        &task,
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
    );

    let search = search_tasks(&runner, "read tools validation", 20).await?;
    if let Some(first) = search.first() {
        assert!(!first.id.is_empty());
        assert!(!first.name.is_empty());
    }

    let projects = list_projects(&runner, None, "active", 20).await?;
    let projects_array = require_array(&projects, "list_projects result");
    if let Some(first) = projects_array.first() {
        assert_has_keys(
            first,
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
        );
    }

    let project_value = if let Some(first) = projects_array.first() {
        first.clone()
    } else {
        create_project(
            &runner,
            &unique_name("Read tool project"),
            None,
            None,
            None,
            None,
            None,
        )
        .await?
    };
    let project_id = require_str_field(&project_value, "id");

    let project = get_project(&runner, &project_id).await?;
    assert_has_keys(
        &project,
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
    );

    let tags = list_tags(&runner, 20).await?;
    let tags_array = require_array(&tags, "list_tags result");
    if let Some(first) = tags_array.first() {
        assert_has_keys(
            first,
            &["id", "name", "parent", "availableTaskCount", "status"],
        );
    }

    let folders = list_folders(&runner, 20).await?;
    let folders_array = require_array(&folders, "list_folders result");
    if let Some(first) = folders_array.first() {
        assert_has_keys(first, &["id", "name", "parentName", "projectCount"]);
    }

    let forecast = get_forecast(&runner, 20).await?;
    assert_has_keys(&forecast, &["overdue", "dueToday", "flagged"]);

    let perspectives = list_perspectives(&runner, 20).await?;
    let perspectives_array = require_array(&perspectives, "list_perspectives result");
    if let Some(first) = perspectives_array.first() {
        assert_has_keys(first, &["id", "name"]);
    }

    let _ = delete_task(&runner, &created_task_id).await;
    let _ = complete_project(&runner, &project_id).await;
    cleanup_test_data(&runner).await?;
    Ok(())
}

#[tokio::test]
async fn test_task_lifecycle() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await?;

    let created = create_task(
        &runner,
        &unique_name("Lifecycle task"),
        None,
        Some("task lifecycle integration test"),
        None,
        None,
        Some(true),
        None,
        None,
    )
    .await?;
    let task_id = require_str_field(&created, "id");

    let fetched = get_task(&runner, &task_id).await?;
    assert_eq!(require_str_field(&fetched, "id"), task_id);

    let updated_name = unique_name("Lifecycle updated");
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
    assert_eq!(require_str_field(&updated, "id"), task_id);
    assert_eq!(require_str_field(&updated, "name"), updated_name);

    let completed = complete_task(&runner, &task_id).await?;
    assert_eq!(require_str_field(&completed, "id"), task_id);
    assert_eq!(
        completed.get("completed").and_then(Value::as_bool),
        Some(true)
    );

    let deleted = delete_task(&runner, &task_id).await?;
    assert_eq!(require_str_field(&deleted, "id"), task_id);
    assert_eq!(deleted.get("deleted").and_then(Value::as_bool), Some(true));

    cleanup_test_data(&runner).await?;
    Ok(())
}

#[tokio::test]
async fn test_search_finds_created_task() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await?;

    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "token".to_string());
    let created = create_task(
        &runner,
        &format!("[TEST-MCP] Search {token}"),
        None,
        Some(&format!("search token {token}")),
        None,
        None,
        None,
        None,
        None,
    )
    .await?;
    let task_id = require_str_field(&created, "id");

    let results = search_tasks(&runner, &token, 50).await?;
    let result_ids: HashSet<&str> = results.iter().map(|task| task.id.as_str()).collect();
    assert!(result_ids.contains(task_id.as_str()));

    let _ = delete_task(&runner, &task_id).await;
    cleanup_test_data(&runner).await?;
    Ok(())
}

#[tokio::test]
async fn test_project_lifecycle() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    cleanup_test_data(&runner).await?;

    let project_name = unique_name("Lifecycle project");
    let created = create_project(&runner, &project_name, None, None, None, None, None).await?;
    let project_id = require_str_field(&created, "id");

    let fetched = get_project(&runner, &project_id).await?;
    assert_eq!(require_str_field(&fetched, "id"), project_id);
    assert_eq!(require_str_field(&fetched, "name"), project_name);

    let completed = complete_project(&runner, &project_id).await?;
    assert_eq!(require_str_field(&completed, "id"), project_id);
    assert_eq!(
        completed.get("completed").and_then(Value::as_bool),
        Some(true)
    );

    cleanup_test_data(&runner).await?;
    Ok(())
}
