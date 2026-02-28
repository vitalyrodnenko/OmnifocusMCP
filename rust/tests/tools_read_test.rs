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
        projects::{get_project, list_projects, search_projects},
        tags::{list_tags, search_tags},
        tasks::{
            get_inbox, get_task, list_subtasks, list_tasks as list_tasks_with_duration,
            search_tasks,
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

    let get_runner = MockRunner {
        payload: json!({"id": "t3", "name": "single task"}),
    };
    let single = get_task(&get_runner, "t3").await.expect("task should load");
    assert_eq!(single["id"], "t3");

    let subtasks_runner = MockRunner {
        payload: json!([task_value("st1", "child task")]),
    };
    let subtasks = list_subtasks(&subtasks_runner, "t3", 100)
        .await
        .expect("subtasks should parse");
    assert_eq!(subtasks.len(), 1);
    assert_eq!(subtasks[0].id, "st1");

    let search_runner = MockRunner {
        payload: json!([task_value("t4", "searched task")]),
    };
    let searched = search_tasks(&search_runner, "searched", 100)
        .await
        .expect("search should parse");
    assert_eq!(searched.len(), 1);
    assert_eq!(searched[0].name, "searched task");
}

#[tokio::test]
async fn read_non_task_tools_happy_path() {
    let projects_runner = MockRunner {
        payload: json!([{"id": "p1", "name": "project one"}]),
    };
    let projects = list_projects(&projects_runner, None, "active", 100)
        .await
        .expect("projects should load");
    assert!(projects.is_array());

    let project_runner = MockRunner {
        payload: json!({"id": "p1", "name": "project one"}),
    };
    let project = get_project(&project_runner, "p1")
        .await
        .expect("project should load");
    assert_eq!(project["id"], "p1");

    let search_projects_runner = MockRunner {
        payload: json!([{"id": "p8", "name": "personal admin", "status": "active", "folderName": "personal"}]),
    };
    let searched_projects = search_projects(&search_projects_runner, "admin", 100)
        .await
        .expect("project search should load");
    assert!(searched_projects.is_array());

    let tags_runner = MockRunner {
        payload: json!([{"id": "g1", "name": "home"}]),
    };
    let tags = list_tags(&tags_runner, 100)
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
        payload: json!({"overdue": [], "dueToday": [], "flagged": []}),
    };
    let forecast = get_forecast(&forecast_runner, 100)
        .await
        .expect("forecast should load");
    assert!(forecast["overdue"].is_array());

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

    let searched = search_tasks(&empty_runner, "x", 100)
        .await
        .expect("search should parse");
    assert!(searched.is_empty());

    let tags = list_tags(&empty_runner, 100)
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
        search_tasks(&runner, "   ", 100).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        search_tasks(&runner, "x", 0).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        list_projects(&runner, None, "active", 0).await,
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
        list_tags(&runner, 0).await,
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
    assert!(script.contains("must be a valid ISO 8601 date string."));
}

#[tokio::test]
async fn search_tasks_script_includes_completion_and_children_fields() {
    let last_script = Arc::new(Mutex::new(String::new()));
    let runner = CapturingRunner {
        payload: json!([task_value("t-search-shape", "search shape task")]),
        last_script: last_script.clone(),
    };

    let searched = search_tasks(&runner, "shape", 2)
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
