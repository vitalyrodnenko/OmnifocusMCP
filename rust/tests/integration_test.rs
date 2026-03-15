#![cfg(feature = "integration")]

use std::{
    collections::HashSet,
    process::Command,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use omnifocus_mcp::{
    jxa::{run_omnijs, RealJxaRunner},
    tools::{
        folders::{create_folder, delete_folder, delete_folders_batch, list_folders},
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{
            complete_project, create_project, delete_project, delete_projects_batch, get_project,
            list_projects,
        },
        tags::{create_tag, delete_tag, delete_tags_batch, list_tags},
        tasks::{
            add_notification, complete_task, create_task, delete_task, get_inbox, get_task,
            list_notifications, list_tasks, remove_notification, search_tasks, update_task,
        },
    },
};
use serde_json::Value;
use tokio::sync::Mutex;

static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Default)]
struct CleanupRegistry {
    task_ids: Vec<String>,
    project_ids: Vec<String>,
}

impl CleanupRegistry {
    fn register_task(&mut self, id: String) {
        self.task_ids.push(id);
    }

    fn register_project(&mut self, id: String) {
        self.project_ids.push(id);
    }

    fn unregister_task(&mut self, id: &str) {
        self.task_ids.retain(|candidate| candidate != id);
    }

    fn unregister_project(&mut self, id: &str) {
        self.project_ids.retain(|candidate| candidate != id);
    }
}

impl Drop for CleanupRegistry {
    fn drop(&mut self) {
        if self.task_ids.is_empty() && self.project_ids.is_empty() {
            return;
        }

        let task_ids_json =
            serde_json::to_string(&self.task_ids).unwrap_or_else(|_| "[]".to_string());
        let project_ids_json =
            serde_json::to_string(&self.project_ids).unwrap_or_else(|_| "[]".to_string());
        let inner_script = format!(
            r#"(function() {{
  try {{
    if (typeof document === "object" && document) {{
      if (typeof document.flattenedTasks === "undefined" && typeof flattenedTasks !== "undefined") {{
        document.flattenedTasks = flattenedTasks;
      }}
      if (typeof document.flattenedProjects === "undefined" && typeof flattenedProjects !== "undefined") {{
        document.flattenedProjects = flattenedProjects;
      }}
    }}

    const taskIds = {task_ids_json};
    taskIds.forEach(taskId => {{
      const task = document.flattenedTasks.find(item => item.id.primaryKey === taskId);
      if (!task) return;
      try {{
        if (!task.completed) task.markComplete();
      }} catch (_) {{}}
      try {{
        deleteObject(task);
      }} catch (_) {{}}
    }});

    const projectIds = {project_ids_json};
    projectIds.forEach(projectId => {{
      const project = document.flattenedProjects.find(item => item.id.primaryKey === projectId);
      if (!project) return;
      try {{
        if (typeof Project !== "undefined" && Project.Status && Project.Status.Dropped) {{
          project.status = Project.Status.Dropped;
        }} else {{
          project.markComplete();
        }}
      }} catch (_) {{}}
    }});

    return "ok";
  }} catch (_) {{
    return "error";
  }}
}})()"#
        );

        let escaped_inner =
            serde_json::to_string(&inner_script).unwrap_or_else(|_| "\"\"".to_string());
        let outer_script = format!(
            "const app = Application('OmniFocus'); const result = app.evaluateJavascript({escaped_inner}); result;"
        );
        let _ = Command::new("osascript")
            .arg("-l")
            .arg("JavaScript")
            .arg("-e")
            .arg(outer_script)
            .output();
    }
}

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
        assert!(object.contains_key(*key));
    }
}

#[tokio::test]
async fn test_jxa_bridge_connectivity() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let result = run_omnijs("return document.flattenedTasks.length;").await?;
    let count = result
        .as_i64()
        .ok_or_else(|| "bridge response was not an integer".to_string())?;
    assert!(count >= 0);
    Ok(())
}

#[tokio::test]
async fn test_read_tools_return_valid_json() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    let mut cleanup = CleanupRegistry::default();

    let created_task = create_task(
        &runner,
        &unique_name("Read tool task"),
        None,
        Some("read tools validation payload"),
        None,
        None,
        None,
        Some(true),
        None,
        None,
    )
    .await?;
    let created_task_id = require_str_field(&created_task, "id");
    cleanup.register_task(created_task_id.clone());

    let inbox = get_inbox(&runner, 20).await?;
    if let Some(first) = inbox.first() {
        assert!(!first.id.is_empty());
        assert!(!first.name.is_empty());
    }

    let listed = list_tasks(
        &runner, None, None, None, "any", None, "all", None, None, None, None, None, None, None,
        None, None, None, "asc", 20,
    )
    .await?;
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

    let search = search_tasks(
        &runner,
        "read tools validation",
        None,
        None,
        None,
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "asc",
        20,
    )
    .await?;
    if let Some(first) = search.first() {
        assert!(!first.id.is_empty());
        assert!(!first.name.is_empty());
    }

    let projects =
        list_projects(&runner, None, "active", None, None, false, None, "asc", 20).await?;
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
    cleanup.register_project(project_id.clone());

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

    let tags = list_tags(&runner, "all", None, "asc", 20).await?;
    let tags_array = require_array(&tags, "list_tags result");
    if let Some(first) = tags_array.first() {
        assert_has_keys(
            first,
            &[
                "id",
                "name",
                "parent",
                "availableTaskCount",
                "totalTaskCount",
                "status",
            ],
        );
    }

    let folders = list_folders(&runner, 20).await?;
    let folders_array = require_array(&folders, "list_folders result");
    if let Some(first) = folders_array.first() {
        assert_has_keys(first, &["id", "name", "parentName", "projectCount"]);
    }

    let forecast = get_forecast(&runner, 20).await?;
    assert_has_keys(
        &forecast,
        &[
            "overdue",
            "dueToday",
            "flagged",
            "deferred",
            "dueThisWeek",
            "counts",
        ],
    );

    let perspectives = list_perspectives(&runner, 20).await?;
    let perspectives_array = require_array(&perspectives, "list_perspectives result");
    if let Some(first) = perspectives_array.first() {
        assert_has_keys(first, &["id", "name"]);
    }

    let _ = delete_task(&runner, &created_task_id).await;
    cleanup.unregister_task(&created_task_id);
    let _ = complete_project(&runner, &project_id).await;
    cleanup.unregister_project(&project_id);
    Ok(())
}

#[tokio::test]
async fn test_task_lifecycle() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    let mut cleanup = CleanupRegistry::default();

    let created = create_task(
        &runner,
        &unique_name("Lifecycle task"),
        None,
        Some("task lifecycle integration test"),
        None,
        None,
        None,
        Some(true),
        None,
        None,
    )
    .await?;
    let task_id = require_str_field(&created, "id");
    cleanup.register_task(task_id.clone());

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
    cleanup.unregister_task(&task_id);
    Ok(())
}

#[tokio::test]
async fn test_search_finds_created_task() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    let mut cleanup = CleanupRegistry::default();

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
        None,
    )
    .await?;
    let task_id = require_str_field(&created, "id");
    cleanup.register_task(task_id.clone());

    let results = search_tasks(
        &runner,
        &token,
        None,
        None,
        None,
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "asc",
        50,
    )
    .await?;
    let result_ids: HashSet<&str> = results.iter().map(|task| task.id.as_str()).collect();
    assert!(result_ids.contains(task_id.as_str()));

    let _ = delete_task(&runner, &task_id).await;
    cleanup.unregister_task(&task_id);
    Ok(())
}

#[tokio::test]
async fn test_project_lifecycle() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    let mut cleanup = CleanupRegistry::default();

    let project_name = unique_name("Lifecycle project");
    let created = create_project(&runner, &project_name, None, None, None, None, None).await?;
    let project_id = require_str_field(&created, "id");
    cleanup.register_project(project_id.clone());

    let fetched = get_project(&runner, &project_id).await?;
    assert_eq!(require_str_field(&fetched, "id"), project_id);
    assert_eq!(require_str_field(&fetched, "name"), project_name);

    let completed = complete_project(&runner, &project_id).await?;
    assert_eq!(require_str_field(&completed, "id"), project_id);
    assert_eq!(
        completed.get("completed").and_then(Value::as_bool),
        Some(true)
    );
    cleanup.unregister_project(&project_id);
    Ok(())
}

#[tokio::test]
async fn test_new_feature_parity_matrix() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = test_lock().lock().await;
    let runner = RealJxaRunner::new();
    let mut cleanup = CleanupRegistry::default();
    let mut extra_tag_ids: Vec<String> = Vec::new();
    let mut extra_folder_ids: Vec<String> = Vec::new();
    let mut extra_project_ids: Vec<String> = Vec::new();
    let mut notification_task_id: Option<String> = None;
    let mut notification_id: Option<String> = None;
    let result: Result<(), Box<dyn std::error::Error>> = async {
        let parity_project_name = unique_name("Parity matrix project");
        let parity_project =
            create_project(&runner, &parity_project_name, None, None, None, None, None).await?;
        let parity_project_id = require_str_field(&parity_project, "id");
        cleanup.register_project(parity_project_id);

        let due_date_iso = "2030-01-01T09:00:00Z".to_string();
        let created_task = create_task(
            &runner,
            &unique_name("Parity matrix task"),
            Some(&parity_project_name),
            Some("parity matrix sort notification"),
            Some(&due_date_iso),
            None,
            None,
            None,
            None,
            None,
        )
        .await?;
        let task_id = require_str_field(&created_task, "id");
        cleanup.register_task(task_id.clone());
        notification_task_id = Some(task_id.clone());

        let listed = list_tasks(
            &runner,
            Some(&parity_project_name),
            None,
            None,
            "any",
            None,
            "all",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("added"),
            "desc",
            50,
        )
        .await?;
        assert!(listed.iter().any(|item| item.id == task_id));

        let searched = search_tasks(
            &runner,
            "parity matrix sort notification",
            None,
            None,
            None,
            "any",
            None,
            "all",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("planned"),
            "asc",
            50,
        )
        .await?;
        assert!(searched.iter().any(|item| item.id == task_id));

        let created_notification =
            add_notification(&runner, &task_id, Some(&due_date_iso), None).await?;
        let created_notification_id = require_str_field(&created_notification, "id");
        notification_id = Some(created_notification_id.clone());

        let notifications = list_notifications(&runner, &task_id).await?;
        let notification_items =
            require_array(&notifications, "list_notifications parity matrix result");
        assert!(notification_items.iter().any(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .map(|id| id == created_notification_id)
                .unwrap_or(false)
        }));

        let removed = remove_notification(&runner, &task_id, &created_notification_id).await?;
        assert_eq!(removed.get("removed").and_then(Value::as_bool), Some(true));
        notification_id = None;

        let tag_one = create_tag(&runner, &unique_name("Parity batch tag one"), None).await?;
        let tag_two = create_tag(&runner, &unique_name("Parity batch tag two"), None).await?;
        let tag_one_id = require_str_field(&tag_one, "id");
        let tag_two_id = require_str_field(&tag_two, "id");
        extra_tag_ids.push(tag_one_id.clone());
        extra_tag_ids.push(tag_two_id.clone());
        let deleted_tags =
            delete_tags_batch(&runner, vec![tag_one_id.clone(), tag_two_id.clone()]).await?;
        assert_eq!(
            deleted_tags
                .get("summary")
                .and_then(Value::as_object)
                .and_then(|summary| summary.get("deleted"))
                .and_then(Value::as_i64),
            Some(2)
        );
        extra_tag_ids.clear();

        let folder_one =
            create_folder(&runner, &unique_name("Parity batch folder one"), None).await?;
        let folder_two =
            create_folder(&runner, &unique_name("Parity batch folder two"), None).await?;
        let folder_one_id = require_str_field(&folder_one, "id");
        let folder_two_id = require_str_field(&folder_two, "id");
        extra_folder_ids.push(folder_one_id.clone());
        extra_folder_ids.push(folder_two_id.clone());
        let deleted_folders =
            delete_folders_batch(&runner, vec![folder_one_id.clone(), folder_two_id.clone()])
                .await?;
        assert_eq!(
            deleted_folders
                .get("summary")
                .and_then(Value::as_object)
                .and_then(|summary| summary.get("deleted"))
                .and_then(Value::as_i64),
            Some(2)
        );
        extra_folder_ids.clear();

        let project_one = create_project(
            &runner,
            &unique_name("Parity batch project one"),
            None,
            None,
            None,
            None,
            None,
        )
        .await?;
        let project_two = create_project(
            &runner,
            &unique_name("Parity batch project two"),
            None,
            None,
            None,
            None,
            None,
        )
        .await?;
        let project_one_id = require_str_field(&project_one, "id");
        let project_two_id = require_str_field(&project_two, "id");
        extra_project_ids.push(project_one_id.clone());
        extra_project_ids.push(project_two_id.clone());
        let deleted_projects = delete_projects_batch(
            &runner,
            vec![project_one_id.clone(), project_two_id.clone()],
        )
        .await?;
        assert_eq!(
            deleted_projects
                .get("summary")
                .and_then(Value::as_object)
                .and_then(|summary| summary.get("deleted"))
                .and_then(Value::as_i64),
            Some(2)
        );
        extra_project_ids.clear();

        Ok(())
    }
    .await;

    if let (Some(task_id), Some(current_notification_id)) =
        (notification_task_id.as_ref(), notification_id.as_ref())
    {
        let _ = remove_notification(&runner, task_id, current_notification_id).await;
    }
    for id in &extra_tag_ids {
        let _ = delete_tag(&runner, id).await;
    }
    for id in &extra_folder_ids {
        let _ = delete_folder(&runner, id).await;
    }
    for id in &extra_project_ids {
        let _ = delete_project(&runner, id).await;
    }

    result
}
