use std::{future::Future, pin::Pin};

use omnifocus_mcp::{
    error::OmniFocusError,
    jxa::JxaRunner,
    tools::{
        folders::{get_folder, list_folders},
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{get_project, list_projects, search_projects},
        tags::{list_tags, search_tags},
        tasks::{get_inbox, get_task, list_subtasks, list_tasks, search_tasks},
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
    let listed = list_tasks(&list_runner, None, None, None, "available", 100)
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

    let listed = list_tasks(&empty_runner, None, None, None, "all", 100)
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

    let list_err = list_tasks(&malformed_runner, None, None, None, "all", 100)
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
        list_tasks(&runner, None, None, None, "available", 0).await,
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
