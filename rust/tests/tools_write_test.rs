use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

use omnifocus_mcp::{
    error::OmniFocusError,
    jxa::{escape_for_jxa, JxaRunner},
    tools::{
        folders::{create_folder, delete_folder, get_folder, update_folder},
        projects::{
            complete_project, create_project, delete_project, move_project, set_project_status,
            uncomplete_project, update_project,
        },
        tags::{create_tag, delete_tag, update_tag},
        tasks::{
            complete_task, create_subtask, create_task, create_tasks_batch, delete_task,
            delete_tasks_batch, duplicate_task, move_task, move_tasks_batch, set_task_repetition,
            uncomplete_task, update_task, CreateTaskInput,
        },
        utility::append_to_note,
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
struct RecordingRunner {
    payload: Value,
    scripts: Arc<Mutex<Vec<String>>>,
    error_message: Option<String>,
}

impl JxaRunner for RecordingRunner {
    fn run_omnijs<'a>(
        &'a self,
        script: &'a str,
    ) -> Pin<Box<dyn Future<Output = omnifocus_mcp::error::Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            self.scripts
                .lock()
                .expect("scripts lock should succeed")
                .push(script.to_string());
            if let Some(message) = &self.error_message {
                return Err(OmniFocusError::OmniFocus(message.clone()));
            }
            Ok(self.payload.clone())
        })
    }
}

#[tokio::test]
async fn write_task_tools_happy_path() {
    let runner = MockRunner {
        payload: json!({"id": "t1", "name": "task"}),
    };

    let created = create_task(
        &runner,
        "task",
        Some("project"),
        Some("note"),
        Some("2026-03-01T12:00:00Z"),
        Some("2026-02-29T12:00:00Z"),
        Some(true),
        Some(vec!["home".to_string()]),
        Some(30),
    )
    .await
    .expect("create_task should succeed");
    assert_eq!(created["id"], "t1");

    let created_batch = create_tasks_batch(
        &runner,
        vec![CreateTaskInput {
            name: "batch task".to_string(),
            project: Some("project".to_string()),
            note: Some("note".to_string()),
            due_date: None,
            defer_date: None,
            flagged: Some(false),
            tags: Some(vec!["home".to_string()]),
            estimated_minutes: Some(15),
        }],
    )
    .await
    .expect("create_tasks_batch should succeed");
    assert_eq!(created_batch["id"], "t1");

    let completed = complete_task(&runner, "t1")
        .await
        .expect("complete_task should succeed");
    assert_eq!(completed["id"], "t1");

    let subtask = create_subtask(
        &runner,
        "subtask",
        "t1",
        Some("note"),
        Some("2026-03-02T12:00:00Z"),
        Some("2026-03-01T12:00:00Z"),
        Some(true),
        Some(vec!["home".to_string()]),
        Some(10),
    )
    .await
    .expect("create_subtask should succeed");
    assert_eq!(subtask["id"], "t1");

    let duplicated = duplicate_task(&runner, "t1", false)
        .await
        .expect("duplicate_task should succeed");
    assert_eq!(duplicated["id"], "t1");

    let uncompleted = uncomplete_task(&runner, "t1")
        .await
        .expect("uncomplete_task should succeed");
    assert_eq!(uncompleted["id"], "t1");

    let repeated = set_task_repetition(&runner, "t1", Some("FREQ=WEEKLY"), "regularly")
        .await
        .expect("set_task_repetition should succeed");
    assert_eq!(repeated["id"], "t1");

    let updated = update_task(
        &runner,
        "t1",
        Some("updated"),
        Some("updated note"),
        None,
        None,
        Some(false),
        Some(vec!["work".to_string()]),
        Some(10),
    )
    .await
    .expect("update_task should succeed");
    assert_eq!(updated["id"], "t1");

    let deleted = delete_task(&runner, "t1")
        .await
        .expect("delete_task should succeed");
    assert_eq!(deleted["id"], "t1");

    let deleted_batch = delete_tasks_batch(&runner, vec!["t1".to_string()])
        .await
        .expect("delete_tasks_batch should succeed");
    assert_eq!(deleted_batch["id"], "t1");

    let moved = move_task(&runner, "t1", Some("project"), None)
        .await
        .expect("move_task should succeed");
    assert_eq!(moved["id"], "t1");

    let moved_batch = move_tasks_batch(&runner, vec!["t1".to_string()], Some("project"), None)
        .await
        .expect("move_tasks_batch should succeed");
    assert_eq!(moved_batch["id"], "t1");

    let appended = append_to_note(&runner, "task", "t1", "more context")
        .await
        .expect("append_to_note should succeed");
    assert_eq!(appended["id"], "t1");
}

#[tokio::test]
async fn move_tasks_batch_rejects_ambiguous_destination_input_criterion29() {
    let runner = MockRunner { payload: json!({}) };
    let result = move_tasks_batch(
        &runner,
        vec!["task-1".to_string()],
        Some("Work"),
        Some("parent-1"),
    )
    .await;
    assert!(matches!(result, Err(OmniFocusError::Validation(_))));
    assert_eq!(
        result.err().map(|error| error.to_string()),
        Some(
            "provide either project or parent_task_id, not both (destination is ambiguous)."
                .to_string()
        )
    );
}

#[tokio::test]
async fn move_tasks_batch_rejects_empty_and_whitespace_ids_criterion29() {
    let runner = MockRunner { payload: json!({}) };

    let empty_result = move_tasks_batch(&runner, Vec::new(), None, None).await;
    assert!(matches!(empty_result, Err(OmniFocusError::Validation(_))));
    assert_eq!(
        empty_result.err().map(|error| error.to_string()),
        Some("task_ids must contain at least one task id.".to_string())
    );

    let whitespace_result = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "   ".to_string()],
        None,
        None,
    )
    .await;
    assert!(matches!(
        whitespace_result,
        Err(OmniFocusError::Validation(_))
    ));
    assert_eq!(
        whitespace_result.err().map(|error| error.to_string()),
        Some("each task id must be a non-empty string.".to_string())
    );
}

#[tokio::test]
async fn move_tasks_batch_rejects_duplicate_task_ids_criterion29() {
    let runner = MockRunner { payload: json!({}) };
    let result = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "task-1".to_string()],
        None,
        None,
    )
    .await;
    assert!(matches!(result, Err(OmniFocusError::Validation(_))));
    let duplicate_error = result
        .err()
        .map(|error| error.to_string())
        .unwrap_or_default();
    assert!(duplicate_error.contains("task_ids must not contain duplicate"));
}

#[tokio::test]
async fn move_tasks_batch_rejects_parent_id_inside_task_ids_criterion29() {
    let runner = MockRunner { payload: json!({}) };
    let result = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "task-2".to_string()],
        None,
        Some("task-2"),
    )
    .await;
    assert!(matches!(result, Err(OmniFocusError::Validation(_))));
    assert_eq!(
        result.err().map(|error| error.to_string()),
        Some(
            "parent_task_id must not be included in task_ids (cannot move a task under itself)."
                .to_string()
        )
    );
}

#[tokio::test]
async fn move_tasks_batch_parent_destination_script_has_cycle_guard_criterion29() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "requested_count": 1,
            "moved_count": 1,
            "failed_count": 0,
            "partial_success": false,
            "results": [
                {
                    "id": "task-1",
                    "name": "Task One",
                    "moved": true,
                    "destination": {
                        "mode": "parent",
                        "parentTaskId": "parent-1",
                        "parentTaskName": "Parent One"
                    },
                    "error": null
                }
            ]
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = move_tasks_batch(&runner, vec!["task-1".to_string()], None, Some("parent-1"))
        .await
        .expect("move_tasks_batch parent destination should succeed");
    assert_eq!(result["moved_count"], 1);

    let captured_scripts = scripts.lock().expect("scripts lock should succeed");
    let script = captured_scripts
        .last()
        .expect("move_tasks_batch should execute script")
        .clone();
    drop(captured_scripts);

    assert!(script.contains("const parentTaskId = \"parent-1\";"));
    assert!(script.contains("if (taskIds.includes(ancestor.id.primaryKey)) {"));
    assert!(script.contains("Cannot move tasks under their own descendant."));
}

#[tokio::test]
async fn move_task_supports_project_inbox_and_parent_destinations_alt_payloads() {
    let project_runner = MockRunner {
        payload: json!({
            "id": "task-1",
            "name": "Task One",
            "projectName": "Work",
            "inInbox": false
        }),
    };
    let moved_project = move_task(&project_runner, "task-1", Some("Work"), None)
        .await
        .expect("move_task project destination should succeed");
    assert_eq!(moved_project["id"], "task-1");
    assert_eq!(moved_project["name"], "Task One");
    assert_eq!(moved_project["projectName"], "Work");
    assert_eq!(moved_project["inInbox"], false);

    let inbox_runner = MockRunner {
        payload: json!({
            "id": "task-2",
            "name": "Task Two",
            "projectName": null,
            "inInbox": true
        }),
    };
    let moved_inbox = move_task(&inbox_runner, "task-2", None, None)
        .await
        .expect("move_task inbox destination should succeed");
    assert_eq!(moved_inbox["id"], "task-2");
    assert_eq!(moved_inbox["projectName"], Value::Null);
    assert_eq!(moved_inbox["inInbox"], true);

    let parent_runner = MockRunner {
        payload: json!({
            "id": "task-3",
            "name": "Task Three",
            "projectName": "Work",
            "inInbox": false
        }),
    };
    let moved_parent = move_task(&parent_runner, "task-3", None, Some("parent-1"))
        .await
        .expect("move_task parent destination should succeed");
    assert_eq!(moved_parent["id"], "task-3");
    assert_eq!(moved_parent["name"], "Task Three");
    assert_eq!(moved_parent["projectName"], "Work");
    assert_eq!(moved_parent["inInbox"], false);
}

#[tokio::test]
async fn move_task_rejects_ambiguous_destination_input() {
    let runner = MockRunner { payload: json!({}) };
    let result = move_task(&runner, "task-1", Some("Work"), Some("parent-1")).await;
    assert!(matches!(result, Err(OmniFocusError::Validation(_))));
    assert_eq!(
        result.err().map(|error| error.to_string()),
        Some(
            "provide either project or parent_task_id, not both (destination is ambiguous)."
                .to_string()
        )
    );
}

#[tokio::test]
async fn move_task_propagates_self_parenting_and_cycle_rejections() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let self_parent_runner = RecordingRunner {
        payload: json!({}),
        scripts: Arc::clone(&scripts),
        error_message: Some("Cannot move a task under itself.".to_string()),
    };
    let self_parent_result = move_task(&self_parent_runner, "task-4", None, Some("task-4")).await;
    assert!(matches!(
        self_parent_result,
        Err(OmniFocusError::OmniFocus(_))
    ));
    assert_eq!(
        self_parent_result.err().map(|error| error.to_string()),
        Some("Cannot move a task under itself.".to_string())
    );

    let cycle_runner = RecordingRunner {
        payload: json!({}),
        scripts,
        error_message: Some("Cannot move a task under its own descendant.".to_string()),
    };
    let cycle_result = move_task(&cycle_runner, "task-5", None, Some("task-6")).await;
    assert!(matches!(cycle_result, Err(OmniFocusError::OmniFocus(_))));
    assert_eq!(
        cycle_result.err().map(|error| error.to_string()),
        Some("Cannot move a task under its own descendant.".to_string())
    );
}

#[tokio::test]
async fn move_tasks_batch_rejects_duplicate_and_self_parent_inputs() {
    let runner = MockRunner { payload: json!({}) };

    let duplicate_ids = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "task-1".to_string()],
        Some("Work"),
        None,
    )
    .await;
    assert!(matches!(duplicate_ids, Err(OmniFocusError::Validation(_))));
    let duplicate_error = duplicate_ids
        .err()
        .map(|error| error.to_string())
        .unwrap_or_default();
    assert!(duplicate_error.contains("task_ids must not contain duplicate"));

    let self_parent = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "task-2".to_string()],
        None,
        Some("task-2"),
    )
    .await;
    assert!(matches!(self_parent, Err(OmniFocusError::Validation(_))));
    assert_eq!(
        self_parent.err().map(|error| error.to_string()),
        Some(
            "parent_task_id must not be included in task_ids (cannot move a task under itself)."
                .to_string()
        )
    );
}

#[tokio::test]
async fn move_tasks_batch_parent_destination_script_includes_cycle_guard() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "requested_count": 1,
            "moved_count": 1,
            "failed_count": 0,
            "partial_success": false,
            "results": []
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let _ = move_tasks_batch(&runner, vec!["task-1".to_string()], None, Some("parent-1"))
        .await
        .expect("move_tasks_batch should succeed");
    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .join("\n");
    assert!(captured.contains("Cannot move tasks under their own descendant."));
}

#[tokio::test]
async fn move_tasks_batch_propagates_cycle_rejection_errors() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({}),
        scripts,
        error_message: Some("Cannot move tasks under their own descendant.".to_string()),
    };

    let result = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "task-2".to_string()],
        None,
        Some("parent-1"),
    )
    .await;
    assert!(matches!(result, Err(OmniFocusError::OmniFocus(_))));
    assert_eq!(
        result.err().map(|error| error.to_string()),
        Some("Cannot move tasks under their own descendant.".to_string())
    );
}

#[tokio::test]
async fn move_tasks_batch_supports_project_inbox_parent_and_partial_success_payloads() {
    let project_runner = MockRunner {
        payload: json!({
            "requested_count": 2,
            "moved_count": 2,
            "failed_count": 0,
            "partial_success": false,
            "results": [
                {
                    "id": "task-1",
                    "name": "Task One",
                    "moved": true,
                    "destination": {"mode": "project", "projectName": "Work"},
                    "error": null
                },
                {
                    "id": "task-2",
                    "name": "Task Two",
                    "moved": true,
                    "destination": {"mode": "project", "projectName": "Work"},
                    "error": null
                }
            ]
        }),
    };
    let project_result = move_tasks_batch(
        &project_runner,
        vec!["task-1".to_string(), "task-2".to_string()],
        Some("Work"),
        None,
    )
    .await
    .expect("move_tasks_batch project destination should succeed");
    assert_eq!(project_result["moved_count"], 2);
    assert_eq!(project_result["partial_success"], false);

    let inbox_runner = MockRunner {
        payload: json!({
            "requested_count": 2,
            "moved_count": 2,
            "failed_count": 0,
            "partial_success": false,
            "results": [
                {
                    "id": "task-3",
                    "name": "Task Three",
                    "moved": true,
                    "destination": {"mode": "inbox"},
                    "error": null
                },
                {
                    "id": "task-4",
                    "name": "Task Four",
                    "moved": true,
                    "destination": {"mode": "inbox"},
                    "error": null
                }
            ]
        }),
    };
    let inbox_result = move_tasks_batch(
        &inbox_runner,
        vec!["task-3".to_string(), "task-4".to_string()],
        None,
        None,
    )
    .await
    .expect("move_tasks_batch inbox destination should succeed");
    assert_eq!(inbox_result["moved_count"], 2);

    let parent_runner = MockRunner {
        payload: json!({
            "requested_count": 2,
            "moved_count": 1,
            "failed_count": 1,
            "partial_success": true,
            "results": [
                {
                    "id": "task-5",
                    "name": "Task Five",
                    "moved": true,
                    "destination": {"mode": "parent", "parentTaskId": "parent-1", "parentTaskName": "Parent One"},
                    "error": null
                },
                {
                    "id": "missing",
                    "name": null,
                    "moved": false,
                    "destination": {"mode": "parent", "parentTaskId": "parent-1", "parentTaskName": "Parent One"},
                    "error": "Task not found."
                }
            ]
        }),
    };
    let parent_result = move_tasks_batch(
        &parent_runner,
        vec!["task-5".to_string(), "missing".to_string()],
        None,
        Some("parent-1"),
    )
    .await
    .expect("move_tasks_batch parent destination should succeed");
    assert_eq!(parent_result["moved_count"], 1);
    assert_eq!(parent_result["failed_count"], 1);
    assert_eq!(parent_result["partial_success"], true);
}

#[tokio::test]
async fn move_tasks_batch_rejects_ambiguous_duplicate_and_self_parent_inputs() {
    let runner = MockRunner { payload: json!({}) };

    let ambiguous = move_tasks_batch(
        &runner,
        vec!["task-1".to_string()],
        Some("Work"),
        Some("parent-1"),
    )
    .await;
    assert!(matches!(ambiguous, Err(OmniFocusError::Validation(_))));
    assert_eq!(
        ambiguous.err().map(|error| error.to_string()),
        Some(
            "provide either project or parent_task_id, not both (destination is ambiguous)."
                .to_string()
        )
    );

    let duplicate = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "task-1".to_string()],
        Some("Work"),
        None,
    )
    .await;
    assert!(matches!(duplicate, Err(OmniFocusError::Validation(_))));
    let duplicate_error = duplicate
        .err()
        .map(|error| error.to_string())
        .unwrap_or_default();
    assert!(duplicate_error.contains("task_ids must not contain duplicate"));

    let self_parent = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "task-2".to_string()],
        None,
        Some("task-1"),
    )
    .await;
    assert!(matches!(self_parent, Err(OmniFocusError::Validation(_))));
    assert_eq!(
        self_parent.err().map(|error| error.to_string()),
        Some(
            "parent_task_id must not be included in task_ids (cannot move a task under itself)."
                .to_string()
        )
    );
}

#[tokio::test]
async fn move_tasks_batch_script_includes_cycle_guard_and_parity_fields() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "requested_count": 2,
            "moved_count": 1,
            "failed_count": 1,
            "partial_success": true,
            "results": []
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = move_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "missing".to_string()],
        None,
        Some("parent-1"),
    )
    .await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const taskIds = [\"task-1\",\"missing\"];"));
    assert!(captured.contains("const parentTaskId = \"parent-1\";"));
    assert!(captured.contains("Cannot move tasks under their own descendant."));
    assert!(captured.contains("const movableTasks = Array.from(existingTasksById.values());"));
    assert!(captured.contains("moveTasks(movableTasks, destinationInfo.location);"));
    assert!(captured.contains("destination: destinationInfo.summary"));
    assert!(captured.contains("partial_success: movedCount > 0 && failedCount > 0"));
}

#[tokio::test]
async fn write_project_and_tag_tools_happy_path() {
    let runner = MockRunner {
        payload: json!({"id": "p1", "name": "entity"}),
    };

    let created_project = create_project(
        &runner,
        "project",
        Some("folder"),
        Some("note"),
        Some("2026-03-01T00:00:00Z"),
        Some("2026-02-29T00:00:00Z"),
        Some(true),
    )
    .await
    .expect("create_project should succeed");
    assert_eq!(created_project["id"], "p1");

    let completed_project = complete_project(&runner, "p1")
        .await
        .expect("complete_project should succeed");
    assert_eq!(completed_project["id"], "p1");

    let uncompleted_project = uncomplete_project(&runner, "p1")
        .await
        .expect("uncomplete_project should succeed");
    assert_eq!(uncompleted_project["id"], "p1");

    let deleted_project = delete_project(&runner, "p1")
        .await
        .expect("delete_project should succeed");
    assert_eq!(deleted_project["id"], "p1");

    let moved_project = move_project(&runner, "p1", Some("Work"))
        .await
        .expect("move_project should succeed");
    assert_eq!(moved_project["id"], "p1");

    let updated_project = update_project(
        &runner,
        "p1",
        Some("Updated Project"),
        Some("updated note"),
        Some("2026-03-07T10:00:00Z"),
        Some("2026-03-01T10:00:00Z"),
        Some(true),
        Some(vec!["work".to_string(), "focus".to_string()]),
        Some(false),
        Some(true),
        Some("2 weeks"),
    )
    .await
    .expect("update_project should succeed");
    assert_eq!(updated_project["id"], "p1");

    let status_project = set_project_status(&runner, "p1", "on_hold")
        .await
        .expect("set_project_status should succeed");
    assert_eq!(status_project["id"], "p1");

    let created_tag = create_tag(&runner, "home", Some("parent"))
        .await
        .expect("create_tag should succeed");
    assert_eq!(created_tag["id"], "p1");

    let updated_tag = update_tag(&runner, "p1", Some("next"), Some("on_hold"))
        .await
        .expect("update_tag should succeed");
    assert_eq!(updated_tag["id"], "p1");

    let deleted_tag = delete_tag(&runner, "p1")
        .await
        .expect("delete_tag should succeed");
    assert_eq!(deleted_tag["id"], "p1");

    let created_folder = create_folder(&runner, "Areas", Some("Work"))
        .await
        .expect("create_folder should succeed");
    assert_eq!(created_folder["id"], "p1");

    let fetched_folder = get_folder(&runner, "Areas")
        .await
        .expect("get_folder should succeed");
    assert_eq!(fetched_folder["id"], "p1");

    let updated_folder = update_folder(&runner, "Areas", Some("Areas"), Some("active"))
        .await
        .expect("update_folder should succeed");
    assert_eq!(updated_folder["id"], "p1");

    let deleted_folder = delete_folder(&runner, "Areas")
        .await
        .expect("delete_folder should succeed");
    assert_eq!(deleted_folder["id"], "p1");
}

#[tokio::test]
async fn move_task_script_covers_project_inbox_parent_and_cycle_guards() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "id": "t1",
            "name": "task",
            "projectName": "Work",
            "inInbox": false
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let moved_to_project = move_task(&runner, "t1", Some("Work"), None)
        .await
        .expect("move_task project destination should succeed");
    assert_eq!(moved_to_project["id"], "t1");
    assert_eq!(moved_to_project["projectName"], "Work");
    assert_eq!(moved_to_project["inInbox"], false);

    let moved_to_inbox = move_task(&runner, "t1", None, None)
        .await
        .expect("move_task inbox destination should succeed");
    assert_eq!(moved_to_inbox["id"], "t1");

    let moved_to_parent = move_task(&runner, "t1", None, Some("parent-1"))
        .await
        .expect("move_task parent destination should succeed");
    assert_eq!(moved_to_parent["id"], "t1");

    let captured = scripts.lock().expect("scripts lock should succeed");
    assert_eq!(captured.len(), 3);

    assert!(captured[0].contains(r#"const projectName = "Work";"#));
    assert!(captured[0].contains("const parentTaskId = null;"));
    assert!(captured[0].contains(r#"return { mode: "project", location: targetProject.ending };"#));

    assert!(captured[1].contains("const projectName = null;"));
    assert!(captured[1].contains(r#"return { mode: "inbox", location: inbox.ending };"#));

    assert!(captured[2].contains(r#"const parentTaskId = "parent-1";"#));
    assert!(captured[2].contains("if (parentTaskId === taskId) {"));
    assert!(captured[2].contains("Cannot move a task under itself."));
    assert!(captured[2].contains("Cannot move a task under its own descendant."));
    assert!(captured[2].contains(r#"return { mode: "parent", location: parentTask.ending };"#));
}

#[tokio::test]
async fn validation_errors_for_write_tools() {
    let runner = MockRunner { payload: json!({}) };

    assert!(matches!(
        create_task(&runner, "   ", None, None, None, None, None, None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_subtask(&runner, "   ", "task-id", None, None, None, None, None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_subtask(&runner, "name", "   ", None, None, None, None, None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        duplicate_task(&runner, "   ", true).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        set_task_repetition(&runner, "   ", Some("FREQ=DAILY"), "regularly").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        set_task_repetition(&runner, "task-id", Some("FREQ=DAILY"), "invalid").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_task(
            &runner,
            "name",
            Some("   "),
            None,
            None,
            None,
            None,
            None,
            None
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_project(&runner, "   ", None, None, None, None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_project(&runner, "name", Some("   "), None, None, None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_folder(&runner, "   ", None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_folder(&runner, "Areas", Some("   ")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        get_folder(&runner, "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_folder(&runner, "   ", Some("Areas"), None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_folder(&runner, "folder-id", Some("   "), None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_folder(&runner, "folder-id", None, Some("on_hold")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_folder(&runner, "folder-id", None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        delete_folder(&runner, "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        uncomplete_project(&runner, "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        delete_project(&runner, "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        move_project(&runner, "   ", Some("Work")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        move_project(&runner, "project", Some("   ")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_project(&runner, "   ", None, None, None, None, None, None, None, None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_project(
            &runner,
            "project",
            Some("   "),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_project(
            &runner,
            "project",
            None,
            None,
            None,
            None,
            None,
            Some(vec!["ok".to_string(), "   ".to_string()]),
            None,
            None,
            None
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_project(
            &runner,
            "project",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("   ")
        )
        .await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        set_project_status(&runner, "   ", "active").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        set_project_status(&runner, "project", "completed").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_tag(&runner, "   ", None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        create_tag(&runner, "name", Some("   ")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_tag(&runner, "   ", Some("name"), None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_tag(&runner, "tag-id", None, None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        update_tag(&runner, "tag-id", None, Some("inactive")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        delete_tag(&runner, "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        move_task(&runner, "task-id", Some("   "), None).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        move_task(&runner, "task-id", Some("Work"), Some("parent-1")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        move_task(&runner, "task-id", None, Some("   ")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        move_task(&runner, "task-id", Some("Work"), Some("parent-1")).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        append_to_note(&runner, "folder", "task-id", "x").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        append_to_note(&runner, "task", "   ", "x").await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        append_to_note(&runner, "task", "task-id", "   ").await,
        Err(OmniFocusError::Validation(_))
    ));
}

#[tokio::test]
async fn jxa_error_propagates_from_write_tools() {
    let runner = RecordingRunner {
        payload: json!({}),
        scripts: Arc::new(Mutex::new(Vec::new())),
        error_message: Some("Task not found: missing".to_string()),
    };

    let result = delete_task(&runner, "missing").await;
    assert!(matches!(result, Err(OmniFocusError::OmniFocus(_))));
    assert_eq!(
        result.err().map(|e| e.to_string()),
        Some("Task not found: missing".to_string())
    );
}

#[tokio::test]
async fn delete_tasks_batch_handles_partial_not_found() {
    let runner = MockRunner {
        payload: json!({
            "deleted_count": 1,
            "not_found_count": 1,
            "results": [
                {"id": "task-1", "name": "Task 1", "deleted": true},
                {"id": "missing-id", "deleted": false, "error": "not found"}
            ]
        }),
    };

    let result = delete_tasks_batch(
        &runner,
        vec!["task-1".to_string(), "missing-id".to_string()],
    )
    .await
    .expect("delete_tasks_batch should succeed");
    assert_eq!(result["deleted_count"], 1);
    assert_eq!(result["not_found_count"], 1);
    assert_eq!(result["results"][0]["deleted"], true);
    assert_eq!(result["results"][1]["deleted"], false);
    assert_eq!(result["results"][1]["error"], "not found");
}

#[tokio::test]
async fn delete_tasks_batch_happy_path() {
    let runner = MockRunner {
        payload: json!({
            "deleted_count": 2,
            "not_found_count": 0,
            "results": [
                {"id": "task-1", "name": "Task 1", "deleted": true},
                {"id": "task-2", "name": "Task 2", "deleted": true}
            ]
        }),
    };

    let result = delete_tasks_batch(&runner, vec!["task-1".to_string(), "task-2".to_string()])
        .await
        .expect("delete_tasks_batch should succeed");
    assert_eq!(result["deleted_count"], 2);
    assert_eq!(result["not_found_count"], 0);
    assert_eq!(result["results"][0]["id"], "task-1");
    assert_eq!(result["results"][1]["id"], "task-2");
}

#[tokio::test]
async fn delete_tasks_batch_validation_errors() {
    let runner = MockRunner { payload: json!({}) };

    assert!(matches!(
        delete_tasks_batch(&runner, Vec::new()).await,
        Err(OmniFocusError::Validation(_))
    ));
    assert!(matches!(
        delete_tasks_batch(&runner, vec!["   ".to_string()]).await,
        Err(OmniFocusError::Validation(_))
    ));
}

#[tokio::test]
async fn move_task_validation_rejects_ambiguous_destination() {
    let runner = MockRunner { payload: json!({}) };

    let result = move_task(&runner, "task-id", Some("Work"), Some("parent-1")).await;
    match result {
        Err(OmniFocusError::Validation(message)) => {
            assert_eq!(
                message,
                "provide either project or parent_task_id, not both (destination is ambiguous)."
            );
        }
        other => panic!("expected validation error, got {other:?}"),
    }
}

#[tokio::test]
async fn create_task_script_contains_expected_escaped_values() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "t1"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let name = "he said \"hello\"";
    let project = "proj\\root";
    let note = "line1\nline2";
    let due_date = "2026-03-01T12:00:00Z";

    let result = create_task(
        &runner,
        name,
        Some(project),
        Some(note),
        Some(due_date),
        None,
        Some(true),
        Some(vec!["tag-a".to_string(), "tag-b".to_string()]),
        Some(25),
    )
    .await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");

    assert!(captured.contains(&format!("const taskName = {};", escape_for_jxa(name))));
    assert!(captured.contains(&format!("const projectName = {};", escape_for_jxa(project))));
    assert!(captured.contains(&format!("const noteValue = {};", escape_for_jxa(note))));
    assert!(captured.contains(&format!(
        "const dueDateValue = {};",
        escape_for_jxa(due_date)
    )));
}

#[tokio::test]
async fn create_subtask_script_contains_parent_lookup_and_insert_position() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "id": "child-1",
            "name": "Child",
            "parentTaskId": "parent-1",
            "parentTaskName": "Parent"
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = create_subtask(
        &runner,
        "Child",
        "parent-1",
        Some("detail"),
        Some("2026-03-10T10:00:00Z"),
        Some("2026-03-09T10:00:00Z"),
        Some(true),
        Some(vec!["home".to_string()]),
        Some(15),
    )
    .await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const parentTask = document.flattenedTasks.find"));
    assert!(captured.contains("const task = new Task(taskName, parentTask.ending);"));
}

#[tokio::test]
async fn move_task_script_supports_project_inbox_and_parent_destinations() {
    let project_scripts = Arc::new(Mutex::new(Vec::new()));
    let project_runner = RecordingRunner {
        payload: json!({
            "id": "task-5",
            "name": "moved",
            "projectName": "Errands",
            "inInbox": false
        }),
        scripts: Arc::clone(&project_scripts),
        error_message: None,
    };
    let to_project = move_task(&project_runner, "task-5", Some("Errands"), None)
        .await
        .expect("move_task to project should succeed");
    assert_eq!(to_project["id"], "task-5");
    assert_eq!(to_project["name"], "moved");
    assert_eq!(to_project["projectName"], "Errands");
    assert_eq!(to_project["inInbox"], false);
    let project_script = project_scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("project move script should be captured");
    assert!(project_script.contains("const taskId = \"task-5\";"));
    assert!(project_script.contains("const projectName = \"Errands\";"));
    assert!(project_script.contains("const parentTaskId = null;"));
    assert!(project_script.contains("moveTasks([task], destinationInfo.location);"));

    let inbox_scripts = Arc::new(Mutex::new(Vec::new()));
    let inbox_runner = RecordingRunner {
        payload: json!({
            "id": "task-5",
            "name": "moved",
            "projectName": null,
            "inInbox": true
        }),
        scripts: Arc::clone(&inbox_scripts),
        error_message: None,
    };
    let to_inbox = move_task(&inbox_runner, "task-5", None, None)
        .await
        .expect("move_task to inbox should succeed");
    assert_eq!(to_inbox["id"], "task-5");
    assert_eq!(to_inbox["name"], "moved");
    assert_eq!(to_inbox["projectName"], Value::Null);
    assert_eq!(to_inbox["inInbox"], true);
    let inbox_script = inbox_scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("inbox move script should be captured");
    assert!(inbox_script.contains("const projectName = null;"));
    assert!(inbox_script.contains("const parentTaskId = null;"));
    assert!(inbox_script.contains("return { mode: \"inbox\", location: inbox.ending };"));

    let parent_scripts = Arc::new(Mutex::new(Vec::new()));
    let parent_runner = RecordingRunner {
        payload: json!({
            "id": "task-5",
            "name": "moved",
            "projectName": "Errands",
            "inInbox": false
        }),
        scripts: Arc::clone(&parent_scripts),
        error_message: None,
    };
    let to_parent = move_task(&parent_runner, "task-5", None, Some("parent-1"))
        .await
        .expect("move_task to parent should succeed");
    assert_eq!(to_parent["id"], "task-5");
    assert_eq!(to_parent["name"], "moved");
    assert_eq!(to_parent["projectName"], "Errands");
    assert_eq!(to_parent["inInbox"], false);
    let parent_script = parent_scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("parent move script should be captured");
    assert!(parent_script.contains("const parentTaskId = \"parent-1\";"));
    assert!(parent_script.contains("if (parentTaskId === taskId) {"));
    assert!(parent_script.contains("Cannot move a task under itself."));
    assert!(parent_script.contains("Cannot move a task under its own descendant."));
    assert!(parent_script.contains("return { mode: \"parent\", location: parentTask.ending };"));
}

#[tokio::test]
async fn move_task_supports_project_inbox_and_parent_destinations() {
    let project_runner = MockRunner {
        payload: json!({
            "id": "task-1",
            "name": "Task 1",
            "projectName": "Work",
            "inInbox": false
        }),
    };
    let moved_to_project = move_task(&project_runner, "task-1", Some("Work"), None)
        .await
        .expect("move_task to project should succeed");
    assert_eq!(moved_to_project["id"], "task-1");
    assert_eq!(moved_to_project["projectName"], "Work");
    assert_eq!(moved_to_project["inInbox"], false);

    let inbox_runner = MockRunner {
        payload: json!({
            "id": "task-1",
            "name": "Task 1",
            "projectName": Value::Null,
            "inInbox": true
        }),
    };
    let moved_to_inbox = move_task(&inbox_runner, "task-1", None, None)
        .await
        .expect("move_task to inbox should succeed");
    assert_eq!(moved_to_inbox["id"], "task-1");
    assert_eq!(moved_to_inbox["projectName"], Value::Null);
    assert_eq!(moved_to_inbox["inInbox"], true);

    let parent_runner = MockRunner {
        payload: json!({
            "id": "task-1",
            "name": "Task 1",
            "projectName": "Work",
            "inInbox": false
        }),
    };
    let moved_under_parent = move_task(&parent_runner, "task-1", None, Some("parent-1"))
        .await
        .expect("move_task to parent should succeed");
    assert_eq!(moved_under_parent["id"], "task-1");
    assert_eq!(moved_under_parent["projectName"], "Work");
    assert_eq!(moved_under_parent["inInbox"], false);
}

#[tokio::test]
async fn move_task_script_contains_destination_modes_and_parent_guards() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "task-1", "name": "Task 1", "projectName": "Work", "inInbox": false}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let parent_result = move_task(&runner, "task-1", None, Some("parent-1")).await;
    assert!(parent_result.is_ok());
    let mut captured_scripts = scripts.lock().expect("scripts lock should succeed");
    let parent_script = captured_scripts
        .last()
        .cloned()
        .expect("one script should be captured");
    drop(captured_scripts);

    assert!(parent_script.contains(r#"const taskId = "task-1";"#));
    assert!(parent_script.contains("const projectName = null;"));
    assert!(parent_script.contains(r#"const parentTaskId = "parent-1";"#));
    assert!(parent_script.contains("if (parentTaskId === taskId) {"));
    assert!(parent_script.contains(r#"throw new Error("Cannot move a task under itself.");"#));
    assert!(parent_script
        .contains(r#"throw new Error("Cannot move a task under its own descendant.");"#));
    assert!(parent_script.contains(r#"return { mode: "parent", location: parentTask.ending };"#));
    assert!(parent_script.contains("moveTasks([task], destinationInfo.location);"));
    assert!(parent_script
        .contains("projectName: task.containingProject ? task.containingProject.name : null,"));
    assert!(parent_script.contains("inInbox: task.inInbox"));

    let inbox_result = move_task(&runner, "task-1", None, None).await;
    assert!(inbox_result.is_ok());
    captured_scripts = scripts.lock().expect("scripts lock should succeed");
    let inbox_script = captured_scripts
        .last()
        .cloned()
        .expect("inbox script should be captured");

    assert!(inbox_script.contains("const projectName = null;"));
    assert!(inbox_script.contains("const parentTaskId = null;"));
    assert!(inbox_script.contains(r#"return { mode: "inbox", location: inbox.ending };"#));
    assert!(inbox_script.contains("const originalTaskId = task.id.primaryKey;"));
    assert!(
        inbox_script.contains(r#"throw new Error("Task move did not preserve task identity.");"#)
    );
    assert!(
        inbox_script.contains(r#"if (destinationInfo.mode !== "parent" && task.containingTask) {"#)
    );
}

#[tokio::test]
async fn move_task_script_supports_project_inbox_and_parent_modes() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "id": "task-1",
            "name": "Task",
            "projectName": "Work",
            "inInbox": false
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let moved_to_project = move_task(&runner, "task-1", Some("Work"), None).await;
    assert!(moved_to_project.is_ok());
    let first_script = scripts
        .lock()
        .expect("scripts lock should succeed")
        .first()
        .cloned()
        .expect("first script should be captured");
    assert!(first_script.contains("const projectName = \"Work\";"));
    assert!(first_script.contains("const parentTaskId = null;"));
    assert!(first_script.contains("const destinationInfo = (() => {"));
    assert!(first_script.contains("moveTasks([task], destinationInfo.location);"));
    assert!(first_script.contains("Task move did not preserve task identity."));

    let moved_to_inbox = move_task(&runner, "task-1", None, None).await;
    assert!(moved_to_inbox.is_ok());
    let second_script = scripts
        .lock()
        .expect("scripts lock should succeed")
        .get(1)
        .cloned()
        .expect("second script should be captured");
    assert!(second_script.contains("const projectName = null;"));
    assert!(second_script.contains("const parentTaskId = null;"));
    assert!(second_script.contains("return { mode: \"inbox\", location: inbox.ending };"));
    assert!(second_script.contains("Task move failed: task is still nested under a parent."));

    let moved_to_parent = move_task(&runner, "task-1", None, Some("parent-1")).await;
    assert!(moved_to_parent.is_ok());
    let third_script = scripts
        .lock()
        .expect("scripts lock should succeed")
        .get(2)
        .cloned()
        .expect("third script should be captured");
    assert!(third_script.contains("const parentTaskId = \"parent-1\";"));
    assert!(third_script.contains("if (parentTaskId === taskId) {"));
    assert!(third_script.contains("Cannot move a task under itself."));
    assert!(third_script.contains("Cannot move a task under its own descendant."));
    assert!(third_script.contains("return { mode: \"parent\", location: parentTask.ending };"));
}

#[tokio::test]
async fn duplicate_task_script_supports_child_toggle_and_summary_fields() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "dup-1"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = duplicate_task(&runner, "task-1", false).await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains(r#"const taskId = "task-1";"#));
    assert!(captured.contains("const includeChildren = false;"));
    assert!(
        captured.contains("const duplicated = duplicateTasks([task], insertionLocation);")
            || captured.contains("const duplicates = duplicateTasks([task], insertionLocation);")
    );
    assert!(captured.contains("new Task(task.name, insertionLocation);"));
    assert!(captured.contains("estimatedMinutes"));
}

#[tokio::test]
async fn move_task_script_supports_parent_destination_with_guards() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "id": "task-1",
            "name": "Task One",
            "projectName": "Work",
            "inInbox": false
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let moved = move_task(&runner, "task-1", None, Some("parent-1"))
        .await
        .expect("move_task should succeed");
    assert_eq!(moved["id"], "task-1");
    assert_eq!(moved["name"], "Task One");
    assert_eq!(moved["projectName"], "Work");
    assert_eq!(moved["inInbox"], false);

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const parentTaskId = \"parent-1\";"));
    assert!(captured.contains("Cannot move a task under itself."));
    assert!(captured.contains("Cannot move a task under its own descendant."));
    assert!(captured.contains("return { mode: \"parent\", location: parentTask.ending };"));
    assert!(captured.contains("moveTasks([task], destinationInfo.location);"));
}

#[tokio::test]
async fn move_task_script_supports_project_and_inbox_destinations() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "id": "task-2",
            "name": "Task Two",
            "projectName": "Errands",
            "inInbox": false
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let moved_to_project = move_task(&runner, "task-2", Some("Errands"), None)
        .await
        .expect("move_task should succeed");
    assert_eq!(moved_to_project["id"], "task-2");

    let project_script = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("project script should be captured");
    assert!(project_script.contains("const projectName = \"Errands\";"));
    assert!(
        project_script.contains("return { mode: \"project\", location: targetProject.ending };")
    );

    let moved_to_inbox = move_task(&runner, "task-2", None, None)
        .await
        .expect("move_task should succeed");
    assert_eq!(moved_to_inbox["id"], "task-2");

    let inbox_script = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("inbox script should be captured");
    assert!(inbox_script.contains("const projectName = null;"));
    assert!(inbox_script.contains("const parentTaskId = null;"));
    assert!(inbox_script.contains("return { mode: \"inbox\", location: inbox.ending };"));
    assert!(
        inbox_script.contains("if (destinationInfo.mode !== \"parent\" && task.containingTask)")
    );
}

#[tokio::test]
async fn move_task_rejects_ambiguous_destinations() {
    let runner = MockRunner {
        payload: json!({"id": "task-3"}),
    };

    let result = move_task(&runner, "task-3", Some("Work"), Some("parent-1")).await;
    assert!(matches!(result, Err(OmniFocusError::Validation(_))));
}

#[tokio::test]
async fn uncomplete_task_script_marks_incomplete_and_checks_completed_state() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "t2", "name": "Done", "completed": false}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = uncomplete_task(&runner, "t2").await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("if (!task.completed) {"));
    assert!(captured.contains("task.markIncomplete();"));
}

#[tokio::test]
async fn uncomplete_project_script_marks_incomplete_and_checks_completed_state() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "p2", "name": "Done Project", "status": "active"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = uncomplete_project(&runner, "p2").await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("if (!project.completed) {"));
    assert!(captured.contains("project.markIncomplete();"));
}

#[tokio::test]
async fn update_project_script_applies_partial_fields_and_tag_replacement() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "p3", "name": "Updated Project", "status": "active"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = update_project(
        &runner,
        "p3",
        Some("Updated Project"),
        Some("updated note"),
        Some("2026-03-07T10:00:00Z"),
        Some("2026-03-01T10:00:00Z"),
        Some(true),
        Some(vec!["work".to_string(), "focus".to_string()]),
        Some(false),
        Some(true),
        Some("2 weeks"),
    )
    .await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const projectFilter = \"p3\";"));
    assert!(captured.contains("\"completedByChildren\":true"));
    assert!(
        captured.contains("project.reviewInterval = parseReviewInterval(updates.reviewInterval);")
    );
    assert!(captured.contains("existingTags.forEach"));
    assert!(captured.contains("project.addTag(tag);"));
}

#[tokio::test]
async fn set_project_status_script_sets_organizational_status_enum() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "p4", "name": "Project Four", "status": "on_hold"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = set_project_status(&runner, "p4", "on_hold").await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const projectFilter = \"p4\";"));
    assert!(captured.contains("const statusValue = \"on_hold\";"));
    assert!(captured.contains("Project.Status.OnHold"));
    assert!(captured.contains("project.status = targetStatus;"));
}

#[tokio::test]
async fn delete_project_script_captures_task_count_before_deletion() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "p5", "name": "Project Five", "deleted": true, "taskCount": 3}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = delete_project(&runner, "p5").await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const projectFilter = \"p5\";"));
    assert!(captured.contains("const taskCount = document.flattenedTasks.filter"));
    assert!(captured.contains("deleteObject(project);"));
    assert!(captured.contains("taskCount: taskCount"));
}

#[tokio::test]
async fn move_project_script_moves_to_folder_or_library_ending() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "p6", "name": "Project Six", "folderName": "Work"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let to_folder = move_project(&runner, "p6", Some("Work")).await;
    assert!(to_folder.is_ok());
    let to_top_level = move_project(&runner, "p6", None).await;
    assert!(to_top_level.is_ok());

    let captured = scripts.lock().expect("scripts lock should succeed");
    let folder_script = captured
        .first()
        .cloned()
        .expect("move_project folder script should be captured");
    let top_level_script = captured
        .get(1)
        .cloned()
        .expect("move_project top-level script should be captured");
    assert!(folder_script.contains("const projectFilter = \"p6\";"));
    assert!(folder_script.contains("const folderName = \"Work\";"));
    assert!(folder_script.contains("const destination = (() => {"));
    assert!(folder_script.contains("return targetFolder.ending;"));
    assert!(folder_script.contains("moveSections([project], destination);"));
    assert!(folder_script.contains("folderName: folderName"));
    assert!(top_level_script.contains("const folderName = null;"));
    assert!(top_level_script.contains("if (folderName === null) return library.ending;"));
}

#[tokio::test]
async fn update_tag_script_sets_name_and_status() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "tag-1", "name": "Next", "status": "on_hold"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = update_tag(&runner, "tag-1", Some("Next"), Some("on_hold")).await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const tagFilter = \"tag-1\";"));
    assert!(captured.contains("const newName = \"Next\";"));
    assert!(captured.contains("const statusValue = \"on_hold\";"));
    assert!(captured.contains("Tag.Status.OnHold"));
    assert!(captured.contains("tag.status = targetStatus;"));
}

#[tokio::test]
async fn delete_tag_script_captures_task_count_before_deletion() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "tag-2", "name": "Someday", "deleted": true, "taskCount": 4}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = delete_tag(&runner, "tag-2").await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const tagFilter = \"tag-2\";"));
    assert!(captured.contains("const taskCount = tag.tasks.length;"));
    assert!(captured.contains("deleteObject(tag);"));
    assert!(captured.contains("taskCount: taskCount"));
}

#[tokio::test]
async fn create_folder_script_creates_under_optional_parent() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "folder-1", "name": "Areas"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = create_folder(&runner, "Areas", Some("Work")).await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const folderName = \"Areas\";"));
    assert!(captured.contains("const parentName = \"Work\";"));
    assert!(captured.contains("return new Folder(folderName, parentFolder.ending);"));
}

#[tokio::test]
async fn get_folder_script_returns_direct_children() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "id": "folder-1",
            "name": "Work",
            "status": "active",
            "parentName": Value::Null,
            "projects": [{"id": "project-1", "name": "Launch", "status": "active"}],
            "subfolders": [{"id": "folder-2", "name": "Q1"}]
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = get_folder(&runner, "folder-1").await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const folderFilter = \"folder-1\";"));
    assert!(captured.contains("Folder not found"));
    assert!(captured.contains("projects: folder.projects.map"));
    assert!(captured.contains("subfolders: folder.folders.map"));
}

#[tokio::test]
async fn update_folder_script_sets_name_and_status() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "folder-1", "name": "Areas", "status": "dropped"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = update_folder(&runner, "folder-1", Some("Areas"), Some("dropped")).await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const folderFilter = \"folder-1\";"));
    assert!(captured.contains("const newName = \"Areas\";"));
    assert!(captured.contains("const statusValue = \"dropped\";"));
    assert!(captured.contains("Folder.Status.Dropped"));
    assert!(captured.contains("folder.status = targetStatus;"));
}

#[tokio::test]
async fn delete_folder_script_captures_counts_before_deletion() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({
            "id": "folder-1",
            "name": "Areas",
            "deleted": true,
            "projectCount": 2,
            "subfolderCount": 1
        }),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = delete_folder(&runner, "folder-1").await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const folderFilter = \"folder-1\";"));
    assert!(captured.contains("const projectCount = folder.projects.length;"));
    assert!(captured.contains("const subfolderCount = folder.folders.length;"));
    assert!(captured.contains("deleteObject(folder);"));
    assert!(captured.contains("subfolderCount: subfolderCount"));
}

#[tokio::test]
async fn set_task_repetition_script_sets_and_clears_rules() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "t3", "name": "Recurring", "repetitionRule": "FREQ=WEEKLY"}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let set_result = set_task_repetition(&runner, "t3", Some("FREQ=WEEKLY"), "regularly").await;
    assert!(set_result.is_ok());

    let clear_result = set_task_repetition(&runner, "t3", None, "regularly").await;
    assert!(clear_result.is_ok());

    let captured = scripts.lock().expect("scripts lock should succeed");
    let set_script = captured
        .first()
        .cloned()
        .expect("set_task_repetition set script should be captured");
    let clear_script = captured
        .get(1)
        .cloned()
        .expect("set_task_repetition clear script should be captured");

    assert!(set_script.contains("const scheduleTypeInput = \"regularly\";"));
    assert!(set_script.contains(
        "task.repetitionRule = new Task.RepetitionRule(ruleString, null, scheduleType, null, false);"
    ));
    assert!(clear_script.contains("const ruleString = null;"));
    assert!(clear_script.contains("task.repetitionRule = null;"));
}

#[tokio::test]
async fn append_to_note_script_targets_task_or_project_and_appends_text() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "task-1", "name": "Task 1", "type": "task", "noteLength": 42}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = append_to_note(&runner, "task", "task-1", "more context").await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const objectType = \"task\";"));
    assert!(captured.contains("const objectId = \"task-1\";"));
    assert!(captured.contains("const textToAppend = \"more context\";"));
    assert!(captured.contains("obj.appendStringToNote(textToAppend);"));
}

#[tokio::test]
async fn move_task_script_uses_parity_parameter_names_and_cycle_guards() {
    let scripts = Arc::new(Mutex::new(Vec::new()));
    let runner = RecordingRunner {
        payload: json!({"id": "task-8", "name": "Task Eight", "projectName": "Work", "inInbox": false}),
        scripts: Arc::clone(&scripts),
        error_message: None,
    };

    let result = move_task(&runner, "task-8", None, Some("parent-8")).await;
    assert!(result.is_ok());

    let captured = scripts
        .lock()
        .expect("scripts lock should succeed")
        .last()
        .cloned()
        .expect("one script should be captured");
    assert!(captured.contains("const taskId = \"task-8\";"));
    assert!(captured.contains("const projectName = null;"));
    assert!(captured.contains("const parentTaskId = \"parent-8\";"));
    assert!(captured.contains("throw new Error(\"Cannot move a task under itself.\");"));
    assert!(captured.contains("throw new Error(\"Cannot move a task under its own descendant.\");"));
    assert!(captured.contains("moveTasks([task], destinationInfo.location);"));
    assert!(captured.contains("inInbox: task.inInbox"));
}
