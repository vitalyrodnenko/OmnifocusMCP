use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

use omnifocus_mcp::{
    error::OmniFocusError,
    jxa::JxaRunner,
    tools::{
        folders::{get_folder, list_folders},
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{get_project, get_project_counts, list_projects, search_projects},
        tags::{list_tags, search_tags},
        tasks::{
            add_notification, duplicate_task, get_inbox, get_task, get_task_counts,
            list_notifications, list_subtasks, list_tasks as list_tasks_with_duration,
            list_tasks_with_planned, remove_notification, search_tasks, search_tasks_with_planned,
        },
    },
};
use serde_json::{json, Value};

#[derive(Clone)]
struct MockRunner {
    payload: Value,
}

impl JxaRunner for MockRunner {
    fn run_omnijs<'a>(
        &'a self,
        _script: &'a str,
    ) -> Pin<Box<dyn Future<Output = omnifocus_mcp::error::Result<Value>> + Send + 'a>> {
        Box::pin(async move { Ok(self.payload.clone()) })
    }
}

#[derive(Clone)]
struct CapturingRunner {
    payload: Value,
    last_script: Arc<Mutex<String>>,
}

impl JxaRunner for CapturingRunner {
    fn run_omnijs<'a>(
        &'a self,
        script: &'a str,
    ) -> Pin<Box<dyn Future<Output = omnifocus_mcp::error::Result<Value>> + Send + 'a>> {
        if let Ok(mut slot) = self.last_script.lock() {
            *slot = script.to_string();
        }
        Box::pin(async move { Ok(self.payload.clone()) })
    }
}

#[derive(Clone)]
struct ErrorRunner {
    message: String,
}

#[allow(clippy::too_many_arguments)]
async fn list_tasks<R: JxaRunner>(
    runner: &R,
    project: Option<&str>,
    tag: Option<&str>,
    tags: Option<Vec<String>>,
    tag_filter_mode: &str,
    flagged: Option<bool>,
    status: &str,
    due_before: Option<&str>,
    due_after: Option<&str>,
    defer_before: Option<&str>,
    defer_after: Option<&str>,
    completed_before: Option<&str>,
    completed_after: Option<&str>,
    limit: i32,
) -> Result<Vec<omnifocus_mcp::types::TaskResult>, OmniFocusError> {
    list_tasks_with_duration(
        runner,
        project,
        tag,
        tags,
        tag_filter_mode,
        flagged,
        status,
        due_before,
        due_after,
        defer_before,
        defer_after,
        completed_before,
        completed_after,
        None,
        None,
        None,
        None,
        "asc",
        limit,
    )
    .await
}

impl JxaRunner for ErrorRunner {
    fn run_omnijs<'a>(
        &'a self,
        _script: &'a str,
    ) -> Pin<Box<dyn Future<Output = omnifocus_mcp::error::Result<Value>> + Send + 'a>> {
        let message = self.message.clone();
        Box::pin(async move { Err(OmniFocusError::OmniFocus(message)) })
    }
}

fn task_value(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "note": null,
        "flagged": false,
        "completed": false,
        "projectName": null,
        "dueDate": null,
        "deferDate": null,
        "completionDate": null,
        "tags": [],
        "estimatedMinutes": null,
        "inInbox": true,
        "hasChildren": false,
        "taskStatus": "available",
        "sequential": false
    })
}

#[tokio::test]
async fn read_task_tools_happy_path() {
    let inbox_runner = MockRunner {
        payload: json!([task_value("t1", "inbox task")]),
    };
    let inbox = get_inbox(&inbox_runner, 100)
        .await
        .expect("inbox should parse");
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].id, "t1");
    assert!([
        "available",
        "blocked",
        "next",
        "due_soon",
        "overdue",
        "completed",
        "dropped",
    ]
    .contains(&inbox[0].task_status.as_str()));

    let list_runner = MockRunner {
        payload: json!([task_value("t2", "listed task")]),
    };
    let listed = list_tasks(
        &list_runner,
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
        100,
    )
    .await
    .expect("tasks should parse");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "listed task");
    assert!([
        "available",
        "blocked",
        "next",
        "due_soon",
        "overdue",
        "completed",
        "dropped",
    ]
    .contains(&listed[0].task_status.as_str()));

    let get_runner = MockRunner {
        payload: json!({
            "id": "t3",
            "name": "single task",
            "effectiveDueDate": null,
            "effectiveDeferDate": null,
            "effectiveFlagged": false,
            "modified": null,
            "plannedDate": null,
            "effectivePlannedDate": null
        }),
    };
    let single = get_task(&get_runner, "t3").await.expect("task should load");
    assert_eq!(single["id"], "t3");
    assert_eq!(single["effectiveDueDate"], Value::Null);
    assert_eq!(single["effectiveDeferDate"], Value::Null);
    assert_eq!(single["effectiveFlagged"], Value::Bool(false));
    assert_eq!(single["modified"], Value::Null);
    assert_eq!(single["plannedDate"], Value::Null);
    assert_eq!(single["effectivePlannedDate"], Value::Null);

    let subtasks_runner = MockRunner {
        payload: json!([task_value("st1", "child task")]),
    };
    let subtasks = list_subtasks(&subtasks_runner, "t3", 100)
        .await
        .expect("subtasks should parse");
    assert_eq!(subtasks.len(), 1);
    assert_eq!(subtasks[0].id, "st1");
    assert!([
        "available",
        "blocked",
        "next",
        "due_soon",
        "overdue",
        "completed",
        "dropped",
    ]
    .contains(&subtasks[0].task_status.as_str()));

    let search_runner = MockRunner {
        payload: json!([task_value("t4", "searched task")]),
    };
    let searched = search_tasks(
        &search_runner,
        "searched",
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
        100,
    )
    .await
    .expect("search should parse");
    assert_eq!(searched.len(), 1);
    assert_eq!(searched[0].name, "searched task");
    assert!([
        "available",
        "blocked",
        "next",
        "due_soon",
        "overdue",
        "completed",
        "dropped",
    ]
    .contains(&searched[0].task_status.as_str()));
}

#[tokio::test]
async fn read_non_task_tools_happy_path() {
    let projects_runner = MockRunner {
        payload: json!([{"id": "p1", "name": "project one"}]),
    };
    let projects = list_projects(
        &projects_runner,
        None,
        "active",
        None,
        None,
        false,
        None,
        "asc",
        100,
    )
    .await
    .expect("projects should load");
    assert!(projects.is_array());

    let project_runner = MockRunner {
        payload: json!({"id": "p1", "name": "project one", "modified": null}),
    };
    let project = get_project(&project_runner, "p1")
        .await
        .expect("project should load");
    assert_eq!(project["id"], "p1");
    assert_eq!(project["modified"], Value::Null);

    let search_projects_runner = MockRunner {
        payload: json!([{"id": "p8", "name": "personal admin", "status": "active", "folderName": "personal"}]),
    };
    let searched_projects = search_projects(&search_projects_runner, "admin", 100)
        .await
        .expect("project search should load");
    assert!(searched_projects.is_array());

    let tags_runner = MockRunner {
        payload: json!([{"id": "g1", "name": "home", "totalTaskCount": 2}]),
    };
    let tags = list_tags(&tags_runner, "all", None, "asc", 100)
        .await
        .expect("tags should load");
    assert!(tags.is_array());

    let search_tags_runner = MockRunner {
        payload: json!([{"id": "g7", "name": "errands", "status": "active", "parent": "personal"}]),
    };
    let searched_tags = search_tags(&search_tags_runner, "err", 100)
        .await
        .expect("tag search should load");
    assert!(searched_tags.is_array());

    let folders_runner = MockRunner {
        payload: json!([{"id": "f1", "name": "work"}]),
    };
    let folders = list_folders(&folders_runner, 100)
        .await
        .expect("folders should load");
    assert!(folders.is_array());

    let folder_runner = MockRunner {
        payload: json!({"id": "f1", "name": "work", "projects": [], "subfolders": []}),
    };
    let folder = get_folder(&folder_runner, "f1")
        .await
        .expect("folder should load");
    assert_eq!(folder["id"], "f1");

    let forecast_runner = MockRunner {
        payload: json!({
            "overdue": [],
            "dueToday": [],
            "flagged": [],
            "deferred": [],
            "dueThisWeek": [],
            "counts": {
                "overdueCount": 0,
                "dueTodayCount": 0,
                "flaggedCount": 0,
                "deferredCount": 0,
                "dueThisWeekCount": 0
            }
        }),
    };
    let forecast = get_forecast(&forecast_runner, 100)
        .await
        .expect("forecast should load");
    assert!(forecast["overdue"].is_array());
    assert!(forecast["deferred"].is_array());
    assert!(forecast["dueThisWeek"].is_array());
    assert!(forecast["counts"].is_object());

    let perspectives_runner = MockRunner {
        payload: json!([{"id": "persp1", "name": "inbox"}]),
    };
    let perspectives = list_perspectives(&perspectives_runner, 100)
        .await
        .expect("perspectives should load");
    assert!(perspectives.is_array());
}

#[tokio::test]
async fn empty_results_return_empty_vec() {
    let empty_runner = MockRunner { payload: json!([]) };

    let inbox = get_inbox(&empty_runner, 100)
        .await
        .expect("inbox should parse");
    assert!(inbox.is_empty());

    let listed = list_tasks(
        &empty_runner,
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
        100,
    )
    .await
    .expect("list tasks should parse");
    assert!(listed.is_empty());

    let searched = search_tasks(
        &empty_runner,
        "x",
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
        100,
    )
    .await
    .expect("search should parse");
    assert!(searched.is_empty());

    let tags = list_tags(&empty_runner, "all", None, "asc", 100)
        .await
        .expect("tags should parse");
    assert_eq!(tags, json!([]));
}

#[tokio::test]
async fn malformed_json_from_jxa_produces_json_parse_error() {
    let malformed_runner = MockRunner {
        payload: json!({"unexpected": "shape"}),
    };

    let inbox_err = get_inbox(&malformed_runner, 100)
        .await
        .expect_err("invalid inbox payload should fail");
    assert!(matches!(inbox_err, OmniFocusError::JsonParse(_)));

    let list_err = list_tasks(
        &malformed_runner,
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
        100,
    )
    .await
    .expect_err("invalid list payload should fail");
    assert!(matches!(list_err, OmniFocusError::JsonParse(_)));
}

#[tokio::test]
async fn validation_errors_for_read_tools() {
    let runner = MockRunner { payload: json!([]) };

    assert!(matches!(
        get_inbox(&runner, 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_tasks(
            &runner,
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
            0,
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_tasks(
            &runner,
            None,
            None,
            None,
            "invalid",
            None,
            "available",
            None,
            None,
            None,
            None,
            None,
            None,
            10,
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        get_task(&runner, "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_subtasks(&runner, "   ", 100).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_subtasks(&runner, "task-id", 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_notifications(&runner, "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        add_notification(&runner, "   ", Some("2026-03-03T10:30:00Z"), None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        add_notification(&runner, "t3", None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        add_notification(&runner, "t3", Some("2026-03-03T10:30:00Z"), Some(-60.0)).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        add_notification(&runner, "t3", Some("   "), None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        remove_notification(&runner, "   ", "n1").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        remove_notification(&runner, "t3", "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        duplicate_task(&runner, "   ", true).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        search_tasks(
            &runner,
            "   ",
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
            100,
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        search_tasks(
            &runner,
            "x",
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
            Some(-1),
            None,
            "asc",
            10,
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        search_tasks(
            &runner,
            "x",
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
            0,
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_projects(&runner, None, "active", None, None, false, None, "asc", 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_projects(
            &runner,
            None,
            "active",
            None,
            None,
            false,
            Some("invalid"),
            "asc",
            10
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        get_project_counts(&runner, Some("   ")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        get_project(&runner, "").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        search_projects(&runner, "   ", 100).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        search_projects(&runner, "admin", 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        search_tags(&runner, "   ", 100).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        search_tags(&runner, "err", 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_tags(&runner, "all", None, "asc", 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_tags(&runner, "invalid", None, "asc", 10).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_tags(&runner, "invalid", None, "asc", 10).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_tags(&runner, "all", Some("invalid"), "asc", 10).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_folders(&runner, 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        get_folder(&runner, "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        get_forecast(&runner, 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_perspectives(&runner, 0).await,
        Err(OmniFocusError::Validation(_))
    ));
}

#[tokio::test]
async fn get_inbox_script_includes_completion_and_children_fields() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-inbox", "inbox task")]),
        last_script: last_script.clone(),
    };

    let inbox = get_inbox(&runner, 5).await.expect("inbox should parse");
    assert_eq!(inbox.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const tasks = inbox"));
    assert!(script.contains(".slice(0, 5);"));
    assert!(script.contains(
        "completionDate: task.completionDate ? task.completionDate.toISOString() : null,"
    ));
    assert!(script.contains("hasChildren: task.hasChildren"));
    assert!(script.contains("taskStatus: (() => {"));
    assert!(script.contains("if (s.includes(\"Available\")) return \"available\";"));
    assert!(script.contains("taskStatus: (() => {"));
}

#[tokio::test]
async fn get_forecast_script_includes_deferred_due_this_week_counts_and_enriched_fields_variant() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!({
            "overdue": [{"id": "t-over", "name": "Overdue", "completionDate": null, "hasChildren": false, "taskStatus": "overdue"}],
            "dueToday": [{"id": "t-today", "name": "Today", "completionDate": null, "hasChildren": true, "taskStatus": "due_soon"}],
            "flagged": [{"id": "t-flag", "name": "Flagged", "completionDate": null, "hasChildren": false, "taskStatus": "available"}],
            "deferred": [{"id": "t-def", "name": "Deferred", "completionDate": null, "hasChildren": false, "taskStatus": "blocked"}],
            "dueThisWeek": [{"id": "t-week", "name": "This week", "completionDate": null, "hasChildren": false, "taskStatus": "next"}],
            "counts": {
                "overdueCount": 2,
                "dueTodayCount": 3,
                "flaggedCount": 1,
                "deferredCount": 4,
                "dueThisWeekCount": 5
            }
        }),
        last_script: last_script.clone(),
    };

    let forecast = get_forecast(&runner, 6)
        .await
        .expect("forecast should parse");
    assert!(forecast["dueThisWeek"].is_array());
    assert_eq!(forecast["counts"]["deferredCount"], 4);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(
        script.contains("const endOfWeek = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));")
    );
    assert!(script.contains("const dueThisWeek = [];"));
    assert!(script.contains("counts.dueThisWeekCount += 1;"));
    assert!(script.contains("counts.deferredCount += 1;"));
    assert!(script.contains(
        "completionDate: task.completionDate ? task.completionDate.toISOString() : null,"
    ));
    assert!(script.contains("hasChildren: task.hasChildren"));
    assert!(script.contains("taskStatus: (() => {"));
    assert!(script.contains("if (s.includes(\"Dropped\")) return \"dropped\";"));
    assert!(script.contains("if (s.includes(\"Dropped\")) return \"dropped\";"));
}

#[tokio::test]
async fn get_task_and_list_subtasks_scripts_include_task_status_mapper() {
    let get_task_script = Arc::new(Mutex::new(String::new()));
    let get_task_runner = CapturingRunner {
        payload: json!({
            "id": "t3",
            "name": "task 3",
            "note": null,
            "flagged": false,
            "dueDate": null,
            "deferDate": null,
            "effectiveDueDate": null,
            "effectiveDeferDate": null,
            "effectiveFlagged": false,
            "completed": false,
            "completionDate": null,
            "modified": null,
            "plannedDate": null,
            "effectivePlannedDate": null,
            "taskStatus": "available",
            "projectName": null,
            "tags": [],
            "estimatedMinutes": null,
            "children": [],
            "parentName": null,
            "sequential": false,
            "repetitionRule": null
        }),
        last_script: get_task_script.clone(),
    };
    let _ = get_task(&get_task_runner, "t3")
        .await
        .expect("get_task should parse");
    let get_task_script_text = get_task_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(get_task_script_text.contains(
        "effectiveDueDate: task.effectiveDueDate ? task.effectiveDueDate.toISOString() : null,"
    ));
    assert!(get_task_script_text.contains(
        "effectiveDeferDate: task.effectiveDeferDate ? task.effectiveDeferDate.toISOString() : null,"
    ));
    assert!(get_task_script_text.contains("effectiveFlagged: task.effectiveFlagged,"));
    assert!(get_task_script_text
        .contains("modified: task.modified ? task.modified.toISOString() : null,"));
    assert!(get_task_script_text
        .contains("plannedDate: plannedDate ? plannedDate.toISOString() : null,"));
    assert!(get_task_script_text.contains(
        "effectivePlannedDate: effectivePlannedDate ? effectivePlannedDate.toISOString() : null,"
    ));
    assert!(get_task_script_text.contains("taskStatus: (() => {"));
    assert!(get_task_script_text.contains("String(task.taskStatus)"));

    let list_subtasks_script = Arc::new(Mutex::new(String::new()));
    let list_subtasks_runner = CapturingRunner {
        payload: json!([task_value("st-1", "child")]),
        last_script: list_subtasks_script.clone(),
    };
    let _ = list_subtasks(&list_subtasks_runner, "t3", 2)
        .await
        .expect("list_subtasks should parse");
    let list_subtasks_script_text = list_subtasks_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(list_subtasks_script_text.contains("taskStatus: (() => {"));
    assert!(list_subtasks_script_text.contains("String(subtask.taskStatus)"));
}

#[tokio::test]
async fn list_notifications_script_maps_notification_fields() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([{
            "id": "n1",
            "kind": "absolute",
            "absoluteFireDate": "2026-03-02T09:00:00Z",
            "relativeFireOffset": null,
            "nextFireDate": "2026-03-02T09:00:00Z",
            "isSnoozed": false
        }]),
        last_script: last_script.clone(),
    };

    let notifications = list_notifications(&runner, "t3")
        .await
        .expect("list_notifications should parse");
    assert!(notifications.is_array());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const taskId = "t3";"#));
    assert!(script.contains("return task.notifications.map(n => ({"));
    assert!(script.contains(r#"kind: n.initialFireDate ? "absolute" : "relative","#));
    assert!(script.contains("relativeFireOffset: n.initialFireDate ? null : n.relativeFireOffset,"));
    assert!(script.contains("isSnoozed: n.isSnoozed"));
}

#[tokio::test]
async fn add_notification_script_handles_absolute_and_relative_modes() {
    let absolute_script = Arc::new(Mutex::new(String::new()));
    let absolute_runner = CapturingRunner {
        payload: json!({
            "id": "n2",
            "kind": "absolute",
            "absoluteFireDate": "2026-03-03T10:30:00Z",
            "relativeFireOffset": null,
            "nextFireDate": "2026-03-03T10:30:00Z",
            "isSnoozed": false
        }),
        last_script: absolute_script.clone(),
    };
    let absolute_notification =
        add_notification(&absolute_runner, "t3", Some("2026-03-03T10:30:00Z"), None)
            .await
            .expect("absolute add_notification should parse");
    assert!(absolute_notification.is_object());
    let absolute_script_text = absolute_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(absolute_script_text.contains(r#"const taskId = "t3";"#));
    assert!(absolute_script_text.contains(r#"const absoluteDate = "2026-03-03T10:30:00Z";"#));
    assert!(absolute_script_text.contains("const relativeOffset = null;"));
    assert!(absolute_script_text.contains("const parsedAbsoluteDate = new Date(absoluteDate);"));
    assert!(
        absolute_script_text.contains("notification = task.addNotification(parsedAbsoluteDate);")
    );
    assert!(absolute_script_text.contains("if (task.effectiveDueDate === null) {"));

    let relative_script = Arc::new(Mutex::new(String::new()));
    let relative_runner = CapturingRunner {
        payload: json!({
            "id": "n3",
            "kind": "relative",
            "absoluteFireDate": null,
            "relativeFireOffset": -3600,
            "nextFireDate": "2026-03-03T09:00:00Z",
            "isSnoozed": false
        }),
        last_script: relative_script.clone(),
    };
    let relative_notification = add_notification(&relative_runner, "t3", None, Some(-3600.0))
        .await
        .expect("relative add_notification should parse");
    assert!(relative_notification.is_object());
    let relative_script_text = relative_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(relative_script_text.contains("const absoluteDate = null;"));
    assert!(relative_script_text.contains("const relativeOffset = -3600;"));
    assert!(relative_script_text.contains("notification = task.addNotification(relativeOffset);"));
    assert!(relative_script_text.contains(
        "relativeFireOffset: notification.initialFireDate ? null : notification.relativeFireOffset,"
    ));
}

#[tokio::test]
async fn remove_notification_script_removes_notification_by_id() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!({
            "taskId": "t3",
            "notificationId": "n1",
            "removed": true
        }),
        last_script: last_script.clone(),
    };

    let result = remove_notification(&runner, "t3", "n1")
        .await
        .expect("remove_notification should parse");
    assert!(result.is_object());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const taskId = "t3";"#));
    assert!(script.contains(r#"const notificationId = "n1";"#));
    assert!(script.contains(
        "const notification = task.notifications.find(item => item.id.primaryKey === notificationId);"
    ));
    assert!(script.contains("task.removeNotification(notification);"));
    assert!(script.contains("removed: true"));
}

#[tokio::test]
async fn duplicate_task_script_supports_children_and_manual_clone_modes() {
    let with_children_script = Arc::new(Mutex::new(String::new()));
    let with_children_runner = CapturingRunner {
        payload: json!({
            "id": "copy-1",
            "name": "Copied task",
            "taskStatus": "available"
        }),
        last_script: with_children_script.clone(),
    };
    let with_children = duplicate_task(&with_children_runner, "t3", true)
        .await
        .expect("duplicate_task includeChildren=true should parse");
    assert!(with_children.is_object());
    let with_children_script_text = with_children_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(with_children_script_text.contains(r#"const taskId = "t3";"#));
    assert!(with_children_script_text.contains("const includeChildren = true;"));
    assert!(with_children_script_text.contains("const duplicated = duplicateTasks([task], insertionLocation);"));
    assert!(with_children_script_text.contains("const taskStatusValue = (taskItem) => {"));

    let without_children_script = Arc::new(Mutex::new(String::new()));
    let without_children_runner = CapturingRunner {
        payload: json!({
            "id": "copy-2",
            "name": "Copied task flat"
        }),
        last_script: without_children_script.clone(),
    };
    let without_children = duplicate_task(&without_children_runner, "t3", false)
        .await
        .expect("duplicate_task includeChildren=false should parse");
    assert!(without_children.is_object());
    let without_children_script_text = without_children_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(without_children_script_text.contains("const includeChildren = false;"));
    assert!(without_children_script_text.contains(
        "duplicatedTask = new Task(task.name, insertionLocation);"
    ));
    assert!(without_children_script_text.contains(
        "task.tags.forEach(tag => duplicatedTask.addTag(tag));"
    ));
}

#[tokio::test]
async fn get_task_counts_script_includes_filters_and_counts() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!({
            "total": 6,
            "available": 3,
            "completed": 2,
            "overdue": 1,
            "dueSoon": 2,
            "flagged": 2,
            "deferred": 1
        }),
        last_script: last_script.clone(),
    };

    let counts = get_task_counts(
        &runner,
        Some("Errands"),
        None,
        Some(vec!["Home".to_string()]),
        "any",
        Some(true),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .expect("task counts should parse");
    assert_eq!(counts.total, 6);
    assert_eq!(counts.available, 3);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const projectFilter = "Errands";"#));
    assert!(script.contains(r#"const tagNames = ["Home"];"#));
    assert!(script.contains("const flaggedFilter = true;"));
    assert!(script.contains("const counts = {"));
    assert!(script.contains("counts.overdue += 1;"));
}

#[tokio::test]
async fn get_task_counts_validation_errors() {
    let runner = ErrorRunner {
        message: "runner should not execute for validation errors".to_string(),
    };
    assert!(matches!(
        get_task_counts(
            &runner,
            Some("  "),
            None,
            None,
            "any",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        get_task_counts(
            &runner, None, None, None, "invalid", None, None, None, None, None, None, None, None,
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        get_task_counts(
            &runner,
            None,
            None,
            None,
            "any",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(-1),
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
}

#[tokio::test]
async fn search_tasks_completion_filters_auto_set_sorting() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-search-completed", "search completed task")]),
        last_script: last_script.clone(),
    };

    let searched = search_tasks(
        &runner,
        "shape",
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
        Some("2026-03-01T00:00:00Z"),
        None,
        None,
        "asc",
        5,
    )
    .await
    .expect("search with completion filters should parse");
    assert_eq!(searched.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const statusFilter = "all";"#));
    assert!(script.contains(r#"const sortBy = "completionDate";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
    assert!(script.contains(
        "const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;"
    ));
}

#[tokio::test]
async fn search_tasks_status_filter_and_sorting_are_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-search-overdue", "search overdue task")]),
        last_script: last_script.clone(),
    };

    let searched = search_tasks(
        &runner,
        "shape",
        None,
        None,
        None,
        "any",
        None,
        "overdue",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some("name"),
        "desc",
        5,
    )
    .await
    .expect("search with status and sorting should parse");
    assert_eq!(searched.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const statusFilter = "overdue";"#));
    assert!(script.contains(r#"const sortBy = "name";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
    assert!(script.contains(r#"if (statusFilter === "overdue") {"#));
}

#[tokio::test]
async fn list_projects_script_includes_stalled_and_next_task_fields() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([{"id": "p1", "name": "project one"}]),
        last_script: last_script.clone(),
    };

    let projects = list_projects(&runner, None, "active", None, None, false, None, "asc", 3)
        .await
        .expect("projects should parse");
    assert!(projects.is_array());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const nextTask = project.nextTask;"));
    assert!(script.contains(r#"const isStalled = normalizeProjectStatus(project) === "active""#));
    assert!(script.contains(
        "completionDate: project.completionDate ? project.completionDate.toISOString() : null,"
    ));
    assert!(script.contains("nextTaskId: nextTask ? nextTask.id.primaryKey : null,"));
    assert!(script.contains("nextTaskName: nextTask ? nextTask.name : null,"));
}

#[tokio::test]
async fn list_tags_script_includes_total_count_and_sorting() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([{"id": "g2", "name": "home"}]),
        last_script: last_script.clone(),
    };

    let tags = list_tags(&runner, "active", Some("totalTaskCount"), "desc", 7)
        .await
        .expect("tags should parse");
    assert!(tags.is_array());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const statusFilter = "active";"#));
    assert!(script.contains(r#"const sortBy = "totalTaskCount";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
    assert!(script.contains("totalTaskCount: counts.totalTaskCount,"));
    assert!(script.contains("return sortedTags.slice(0, 7);"));
}

#[tokio::test]
async fn list_projects_completion_filters_auto_set_completed_and_sorting() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([{"id": "p2", "name": "completed project"}]),
        last_script: last_script.clone(),
    };

    let projects = list_projects(
        &runner,
        None,
        "active",
        None,
        Some("2026-03-01T00:00:00Z"),
        false,
        None,
        "asc",
        5,
    )
    .await
    .expect("projects should parse");
    assert!(projects.is_array());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const statusFilter = "completed";"#));
    assert!(script.contains(r#"const sortBy = "completionDate";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
    assert!(script.contains(
        "if (completedAfter !== null && !(project.completionDate !== null && project.completionDate > completedAfter)) return false;"
    ));
}

#[tokio::test]
async fn list_projects_stalled_only_and_explicit_sort_are_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([{"id": "p3", "name": "stalled project"}]),
        last_script: last_script.clone(),
    };

    let projects = list_projects(
        &runner,
        None,
        "completed",
        None,
        None,
        true,
        Some("taskCount"),
        "desc",
        5,
    )
    .await
    .expect("projects should parse");
    assert!(projects.is_array());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const statusFilter = "active";"#));
    assert!(script.contains("const stalledOnly = true;"));
    assert!(script.contains("if (stalledOnly && !isStalled) return false;"));
    assert!(script.contains(r#"const sortBy = "taskCount";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
}

#[tokio::test]
async fn list_tags_status_filter_and_total_task_count_are_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([{"id": "tag1", "name": "errands"}]),
        last_script: last_script.clone(),
    };

    let tags = list_tags(&runner, "all", None, "asc", 9)
        .await
        .expect("tags should parse");
    assert!(tags.is_array());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const statusFilter = "all";"#));
    assert!(script.contains("totalTaskCount: counts.totalTaskCount,"));
    assert!(script.contains("return sortedTags.slice(0, 9);"));
}

#[tokio::test]
async fn list_tags_sort_and_status_filter_are_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([{"id": "tag2", "name": "home"}]),
        last_script: last_script.clone(),
    };

    let tags = list_tags(&runner, "active", Some("totalTaskCount"), "desc", 7)
        .await
        .expect("tags should parse");
    assert!(tags.is_array());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const statusFilter = "active";"#));
    assert!(script.contains(r#"const sortBy = "totalTaskCount";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
    assert!(
        script.contains(r#"statusFilter === "all" || normalizeTagStatus(tag) === statusFilter"#)
    );
    assert!(script.contains("return sortedTags.slice(0, 7);"));
}

#[tokio::test]
async fn list_tags_name_sort_is_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([{"id": "tag3", "name": "alpha"}]),
        last_script: last_script.clone(),
    };

    let tags = list_tags(&runner, "all", Some("name"), "asc", 5)
        .await
        .expect("tags should parse");
    assert!(tags.is_array());

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const sortBy = "name";"#));
    assert!(script.contains(r#"const sortOrder = "asc";"#));
    assert!(script.contains(r#"if (sortBy === "name") {"#));
    assert!(script.contains("return sortedTags.slice(0, 5);"));
}

#[tokio::test]
async fn get_project_script_includes_stalled_and_count_fields() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!({"id": "p1", "name": "project one"}),
        last_script: last_script.clone(),
    };

    let project = get_project(&runner, "p1")
        .await
        .expect("project should parse");
    assert_eq!(project["id"], "p1");

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const nextTask = project.nextTask;"));
    assert!(script.contains(r#"const isStalled = normalizeProjectStatus(project) === "active""#));
    assert!(script
        .contains("completedTaskCount: allProjectTasks.filter(task => task.completed).length,"));
    assert!(script.contains(
        "availableTaskCount: allProjectTasks.filter(task => !task.completed && (task.deferDate === null || task.deferDate <= new Date())).length,"
    ));
    assert!(script.contains(
        "completionDate: project.completionDate ? project.completionDate.toISOString() : null,"
    ));
    assert!(script.contains("modified: project.modified ? project.modified.toISOString() : null,"));
}

#[tokio::test]
async fn get_project_counts_script_includes_status_counters_and_stalled_logic() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!({
            "total": 5,
            "active": 2,
            "onHold": 1,
            "completed": 1,
            "dropped": 1,
            "stalled": 1
        }),
        last_script: last_script.clone(),
    };

    let counts = get_project_counts(&runner, Some("Work"))
        .await
        .expect("project counts should parse");
    assert_eq!(counts.total, 5);
    assert_eq!(counts.on_hold, 1);
    assert_eq!(counts.stalled, 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const folderFilter = "Work";"#));
    assert!(script.contains("const counts = {"));
    assert!(script.contains(r#"if (status === "on_hold") counts.onHold += 1;"#));
    assert!(script.contains("if (isStalled) counts.stalled += 1;"));
}

#[tokio::test]
async fn list_tasks_date_filter_script_contains_expected_logic() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-date", "dated task")]),
        last_script: last_script.clone(),
    };

    let listed = list_tasks(
        &runner,
        Some("Errands"),
        Some("Home"),
        None,
        "any",
        Some(true),
        "available",
        Some("2026-03-10T00:00:00Z"),
        Some("2026-03-01T00:00:00Z"),
        Some("2026-03-08T00:00:00Z"),
        Some("2026-02-25T00:00:00Z"),
        Some("2026-03-09T00:00:00Z"),
        Some("2026-02-20T00:00:00Z"),
        9,
    )
    .await
    .expect("list tasks with date filters should parse");

    assert_eq!(listed.len(), 1);
    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const dueBeforeRaw = \"2026-03-10T00:00:00Z\";"));
    assert!(script.contains("const completedAfterRaw = \"2026-02-20T00:00:00Z\";"));
    assert!(script.contains(
        "const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;"
    ));
    assert!(script.contains("statusMatches = includeCompletedForDateFilter;"));
    assert!(script.contains(
        "completionDate: task.completionDate ? task.completionDate.toISOString() : null,"
    ));
    assert!(script.contains("hasChildren: task.hasChildren"));
    assert!(script.contains("taskStatus: (() => {"));
    assert!(script.contains("if (s.includes(\"Available\")) return \"available\";"));
    assert!(script.contains("if (s.includes(\"Available\")) return \"available\";"));
    assert!(script.contains("must be a valid ISO 8601 date string."));
}

#[tokio::test]
async fn list_tasks_script_supports_planned_date_filters() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-planned", "planned task")]),
        last_script: last_script.clone(),
    };

    let listed = list_tasks_with_planned(
        &runner,
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
        Some("2026-03-15T00:00:00Z"),
        Some("2026-02-15T00:00:00Z"),
        None,
        None,
        "asc",
        5,
    )
    .await
    .expect("list tasks with planned-date filters should parse");
    assert_eq!(listed.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const plannedBeforeRaw = \"2026-03-15T00:00:00Z\";"));
    assert!(script.contains("const plannedAfterRaw = \"2026-02-15T00:00:00Z\";"));
    assert!(script.contains(
        "if (plannedBefore !== null && !(plannedDate !== null && plannedDate < plannedBefore)) return false;"
    ));
    assert!(script.contains(
        "if (plannedAfter !== null && !(plannedDate !== null && plannedDate > plannedAfter)) return false;"
    ));
    assert!(script.contains("plannedDate: plannedDate ? plannedDate.toISOString() : null,"));
}

#[tokio::test]
async fn search_tasks_script_includes_completion_and_children_fields() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-search-shape", "search shape task")]),
        last_script: last_script.clone(),
    };

    let searched = search_tasks(
        &runner,
        "shape",
        Some("Errands"),
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
        2,
    )
    .await
    .expect("search should parse");
    assert_eq!(searched.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(
        "completionDate: task.completionDate ? task.completionDate.toISOString() : null,"
    ));
    assert!(script.contains("hasChildren: task.hasChildren"));
    assert!(script.contains("taskStatus: (() => {"));
    assert!(script.contains("if (s.includes(\"Overdue\")) return \"overdue\";"));
    assert!(script.contains("if (s.includes(\"Overdue\")) return \"overdue\";"));
}

#[tokio::test]
async fn search_tasks_script_supports_project_filter() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-search-project", "search project task")]),
        last_script: last_script.clone(),
    };

    let searched = search_tasks(
        &runner,
        "shape",
        Some("Errands"),
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
        3,
    )
    .await
    .expect("search with project filter should parse");
    assert_eq!(searched.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const projectFilter = "Errands";"#));
}

#[tokio::test]
async fn search_tasks_script_supports_completion_date_filter_with_auto_sort() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-search-date", "search date task")]),
        last_script: last_script.clone(),
    };

    let searched = search_tasks(
        &runner,
        "shape",
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
        Some("2026-03-01T00:00:00Z"),
        None,
        None,
        "asc",
        3,
    )
    .await
    .expect("search with completion date filter should parse");
    assert_eq!(searched.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const completedAfterRaw = "2026-03-01T00:00:00Z";"#));
    assert!(script.contains(r#"const sortBy = "completionDate";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
}

#[tokio::test]
async fn search_tasks_script_supports_planned_date_filters() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-search-planned", "search planned task")]),
        last_script: last_script.clone(),
    };

    let searched = search_tasks_with_planned(
        &runner,
        "shape",
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
        Some("2026-03-10T00:00:00Z"),
        Some("2026-02-20T00:00:00Z"),
        None,
        None,
        "asc",
        3,
    )
    .await
    .expect("search with planned date filters should parse");
    assert_eq!(searched.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const plannedBeforeRaw = "2026-03-10T00:00:00Z";"#));
    assert!(script.contains(r#"const plannedAfterRaw = "2026-02-20T00:00:00Z";"#));
    assert!(script.contains(
        "if (plannedBefore !== null && !(plannedDate !== null && plannedDate < plannedBefore)) return false;"
    ));
    assert!(script.contains(
        "if (plannedAfter !== null && !(plannedDate !== null && plannedDate > plannedAfter)) return false;"
    ));
    assert!(script.contains("plannedDate: plannedDate ? plannedDate.toISOString() : null,"));
}

#[tokio::test]
async fn search_tasks_script_supports_status_filter() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-search-status", "search status task")]),
        last_script: last_script.clone(),
    };

    let searched = search_tasks(
        &runner,
        "shape",
        None,
        None,
        None,
        "any",
        None,
        "overdue",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some("name"),
        "desc",
        3,
    )
    .await
    .expect("search with status filter should parse");
    assert_eq!(searched.len(), 1);

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const statusFilter = "overdue";"#));
    assert!(script.contains(r#"const sortBy = "name";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
}

#[tokio::test]
async fn list_tasks_multi_tag_filter_script_contains_expected_logic() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-tags", "tagged task")]),
        last_script: last_script.clone(),
    };

    let listed_single = list_tasks(
        &runner,
        None,
        None,
        Some(vec!["Home".to_string()]),
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("single tags filter should parse");
    assert_eq!(listed_single.len(), 1);
    let script_single = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_single.contains(r#"const tagNames = ["Home"];"#));
    assert!(script_single.contains(r#"const tagFilterMode = "any";"#));
    assert!(script_single.contains("task.tags.some(t => tagNames.includes(t.name))"));

    let listed_any = list_tasks(
        &runner,
        None,
        None,
        Some(vec!["Home".to_string(), "Deep".to_string()]),
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("any tags filter should parse");
    assert_eq!(listed_any.len(), 1);
    let script_any = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_any.contains(r#"const tagNames = ["Home","Deep"];"#));
    assert!(script_any.contains("task.tags.some(t => tagNames.includes(t.name))"));

    let listed_all = list_tasks(
        &runner,
        None,
        None,
        Some(vec!["Home".to_string(), "Deep".to_string()]),
        "all",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("all tags filter should parse");
    assert_eq!(listed_all.len(), 1);
    let script_all = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_all.contains(r#"const tagFilterMode = "all";"#));
    assert!(script_all.contains("tagNames.every(tn => task.tags.some(t => t.name === tn))"));

    let listed_merged = list_tasks(
        &runner,
        None,
        Some("Home"),
        Some(vec!["Errands".to_string(), "Home".to_string()]),
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("merged tag and tags filter should parse");
    assert_eq!(listed_merged.len(), 1);
    let script_merged = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_merged.contains(r#"const tagNames = ["Home","Errands"];"#));

    let listed_empty = list_tasks(
        &runner,
        None,
        None,
        Some(Vec::new()),
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("empty tags filter should parse");
    assert_eq!(listed_empty.len(), 1);
    let script_empty = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_empty.contains("const tagNames = null;"));
}

#[tokio::test]
async fn list_tasks_sorting_script_contains_expected_logic() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-sort", "sorted task")]),
        last_script: last_script.clone(),
    };

    let listed_due = list_tasks_with_duration(
        &runner,
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
        None,
        Some("dueDate"),
        "asc",
        5,
    )
    .await
    .expect("dueDate asc sort should parse");
    assert_eq!(listed_due.len(), 1);
    let script_due = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_due.contains(r#"const sortBy = "dueDate";"#));
    assert!(script_due.contains(r#"const sortOrder = "asc";"#));
    assert!(script_due.contains(r#"if (sortBy === "dueDate") {"#));

    let listed_name = list_tasks_with_duration(
        &runner,
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
        None,
        Some("name"),
        "desc",
        5,
    )
    .await
    .expect("name desc sort should parse");
    assert_eq!(listed_name.len(), 1);
    let script_name = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_name.contains(r#"const sortBy = "name";"#));
    assert!(script_name.contains(r#"const sortOrder = "desc";"#));
    assert!(script_name.contains("left = String(aValue).toLowerCase();"));

    let listed_auto = list_tasks_with_duration(
        &runner,
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
        Some("2026-03-01T00:00:00Z"),
        None,
        None,
        None,
        None,
        "asc",
        5,
    )
    .await
    .expect("completion filter auto-sort should parse");
    assert_eq!(listed_auto.len(), 1);
    let script_auto = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_auto.contains(r#"const sortBy = "completionDate";"#));
    assert!(script_auto.contains(r#"const sortOrder = "desc";"#));
    assert!(script_auto.contains("if (aValue === null) return 1;"));
    assert!(script_auto.contains("if (bValue === null) return -1;"));
}

#[tokio::test]
async fn list_tasks_duration_filter_script_contains_expected_logic() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-duration", "duration task")]),
        last_script: last_script.clone(),
    };

    let listed_15 = list_tasks_with_duration(
        &runner,
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
        Some(15),
        None,
        "asc",
        5,
    )
    .await
    .expect("15-minute filter should parse");
    assert_eq!(listed_15.len(), 1);
    let script_15 = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_15.contains("const maxEstimatedMinutes = 15;"));
    assert!(script_15.contains(
        "if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;"
    ));

    let listed_60 = list_tasks_with_duration(
        &runner,
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
        Some(60),
        None,
        "asc",
        5,
    )
    .await
    .expect("60-minute filter should parse");
    assert_eq!(listed_60.len(), 1);
    let script_60 = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script_60.contains("const maxEstimatedMinutes = 60;"));
    assert!(script_60.contains(
        "task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes"
    ));
}

#[tokio::test]
async fn list_tasks_sort_due_date_asc_is_included_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-sort-due", "sorted task")]),
        last_script: last_script.clone(),
    };

    let listed = list_tasks_with_duration(
        &runner,
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
        None,
        Some("dueDate"),
        "asc",
        5,
    )
    .await
    .expect("due date sort should parse");

    assert_eq!(listed.len(), 1);
    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const sortBy = "dueDate";"#));
    assert!(script.contains(r#"const sortOrder = "asc";"#));
    assert!(script.contains(r#"if (sortBy === "dueDate") {"#));
}

#[tokio::test]
async fn list_tasks_sort_name_desc_is_included_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-sort-name", "sorted task")]),
        last_script: last_script.clone(),
    };

    let listed = list_tasks_with_duration(
        &runner,
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
        None,
        Some("name"),
        "desc",
        5,
    )
    .await
    .expect("name sort should parse");

    assert_eq!(listed.len(), 1);
    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const sortBy = "name";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
    assert!(script.contains("left = String(aValue).toLowerCase();"));
}

#[tokio::test]
async fn list_tasks_sort_auto_defaults_for_completion_date_filters() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-sort-auto", "sorted task")]),
        last_script: last_script.clone(),
    };

    let listed = list_tasks_with_duration(
        &runner,
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
        Some("2026-03-01T00:00:00Z"),
        None,
        None,
        None,
        None,
        "asc",
        5,
    )
    .await
    .expect("completion-date auto sort should parse");

    assert_eq!(listed.len(), 1);
    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains(r#"const sortBy = "completionDate";"#));
    assert!(script.contains(r#"const sortOrder = "desc";"#));
}

#[tokio::test]
async fn list_tasks_sort_nulls_last_logic_is_included_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-sort-nulls", "sorted task")]),
        last_script: last_script.clone(),
    };

    let listed = list_tasks_with_duration(
        &runner,
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
        None,
        Some("project"),
        "desc",
        5,
    )
    .await
    .expect("null ordering sort should parse");

    assert_eq!(listed.len(), 1);
    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("if (aValue === null) return 1;"));
    assert!(script.contains("if (bValue === null) return -1;"));
}

#[tokio::test]
async fn list_tasks_invalid_date_error_bubbles_up() {
    let runner = ErrorRunner {
        message: "dueBefore must be a valid ISO 8601 date string.".to_string(),
    };

    let error = list_tasks(
        &runner,
        None,
        None,
        None,
        "any",
        None,
        "available",
        Some("bad-date"),
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect_err("invalid date should return omni error");

    assert!(matches!(error, OmniFocusError::OmniFocus(_)));
    assert_eq!(
        error.to_string(),
        "dueBefore must be a valid ISO 8601 date string."
    );
}

#[tokio::test]
async fn get_task_counts_invalid_date_error_bubbles_up() {
    let runner = ErrorRunner {
        message: "dueBefore must be a valid ISO 8601 date string.".to_string(),
    };

    let error = get_task_counts(
        &runner,
        None,
        None,
        None,
        "any",
        None,
        Some("bad-date"),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .expect_err("invalid date should return omni error");

    assert!(matches!(error, OmniFocusError::OmniFocus(_)));
    assert_eq!(
        error.to_string(),
        "dueBefore must be a valid ISO 8601 date string."
    );
}

#[tokio::test]
async fn list_tasks_tag_filters_support_any_all_merge_and_empty_array() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-tags", "tagged task")]),
        last_script: last_script.clone(),
    };

    list_tasks(
        &runner,
        None,
        Some("Home"),
        Some(vec!["Errands".to_string(), "Home".to_string()]),
        "all",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("list tasks with merged all-mode tags should parse");

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const tagNames = [\"Home\",\"Errands\"];"));
    assert!(script.contains("const tagFilterMode = \"all\";"));
    assert!(script.contains("tagNames.every(tn => task.tags.some(t => t.name === tn))"));

    list_tasks(
        &runner,
        None,
        None,
        Some(vec!["Home".to_string(), "Deep".to_string()]),
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("list tasks with any-mode tags should parse");

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const tagNames = [\"Home\",\"Deep\"];"));
    assert!(script.contains("const tagFilterMode = \"any\";"));
    assert!(script.contains("task.tags.some(t => tagNames.includes(t.name))"));

    list_tasks(
        &runner,
        None,
        None,
        Some(vec![]),
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("list tasks with empty tags array should parse");

    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const tagNames = null;"));
}

#[tokio::test]
async fn list_tasks_tags_filter_modes_and_merging_are_in_script() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-tags", "tagged task")]),
        last_script: last_script.clone(),
    };

    let listed = list_tasks(
        &runner,
        Some("Errands"),
        Some("Home"),
        Some(vec!["Errands".to_string(), "Home".to_string()]),
        "all",
        Some(true),
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("list tasks with merged tags should parse");

    assert_eq!(listed.len(), 1);
    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const tagNames = [\"Home\",\"Errands\"];"));
    assert!(script.contains("const tagFilterMode = \"all\";"));
    assert!(script.contains("tagNames.every(tn => task.tags.some(t => t.name === tn))"));
}

#[tokio::test]
async fn list_tasks_empty_tags_array_is_ignored() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-empty-tags", "empty tags task")]),
        last_script: last_script.clone(),
    };

    let listed = list_tasks(
        &runner,
        None,
        None,
        Some(vec![]),
        "any",
        None,
        "all",
        None,
        None,
        None,
        None,
        None,
        None,
        5,
    )
    .await
    .expect("list tasks with empty tags should parse");

    assert_eq!(listed.len(), 1);
    let script = last_script
        .lock()
        .expect("script capture lock should succeed")
        .clone();
    assert!(script.contains("const tagNames = null;"));
}
