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
            delete_tasks_batch, move_task, set_task_repetition, uncomplete_task, update_task,
            CreateTaskInput,
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

    let moved = move_task(&runner, "t1", Some("project"))
        .await
        .expect("move_task should succeed");
    assert_eq!(moved["id"], "t1");

    let appended = append_to_note(&runner, "task", "t1", "more context")
        .await
        .expect("append_to_note should succeed");
    assert_eq!(appended["id"], "t1");
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
        move_task(&runner, "task-id", Some("   ")).await,
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
async fn move_project_script_moves_to_folder_or_library() {
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
    assert!(folder_script.contains("return targetFolder;"));
    assert!(folder_script.contains("moveSections([project], destination);"));
    assert!(folder_script.contains("folderName: folderName"));
    assert!(top_level_script.contains("const folderName = null;"));
    assert!(top_level_script.contains("if (folderName === null) return library;"));
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
