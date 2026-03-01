use std::{future::Future, pin::Pin};

use omnifocus_mcp::{
    error::OmniFocusError,
    jxa::JxaRunner,
    prompts::{daily_review, inbox_processing, project_planning, weekly_review},
};
use serde_json::{json, Value};

#[derive(Clone)]
struct PromptRunner;

impl JxaRunner for PromptRunner {
    fn run_omnijs<'a>(
        &'a self,
        script: &'a str,
    ) -> Pin<Box<dyn Future<Output = omnifocus_mcp::error::Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            if script.contains("const projectFilter =")
                && script.contains("document.flattenedProjects.find")
            {
                return Ok(json!({
                    "id": "project-1",
                    "name": "alpha",
                    "status": "active"
                }));
            }
            if script.contains("const projectCounts = new Map();") {
                return Ok(json!([{
                    "id": "project-1",
                    "name": "alpha",
                    "status": "active"
                }]));
            }
            if script.contains("const tasks = inbox") {
                return Ok(json!([{
                    "id": "task-inbox",
                    "name": "capture receipt",
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
                }]));
            }
            if script.contains("const statusFilter =") {
                return Ok(json!([{
                    "id": "task-1",
                    "name": "next action",
                    "note": "do thing",
                    "flagged": false,
                    "completed": false,
                    "projectName": "alpha",
                    "dueDate": null,
                    "deferDate": null,
                    "completionDate": null,
                    "tags": [],
                    "estimatedMinutes": null,
                    "inInbox": false,
                    "hasChildren": false,
                    "sequential": false
                }]));
            }
            Ok(Value::Null)
        })
    }
}

#[tokio::test]
async fn prompt_rendering_contains_expected_sections() {
    let runner = PromptRunner;

    let daily = daily_review(&runner)
        .await
        .expect("daily review should render");
    assert!(daily.contains("overdue_tasks_json"));
    assert!(daily.contains("due_soon_tasks_json"));

    let weekly = weekly_review(&runner)
        .await
        .expect("weekly review should render");
    assert!(weekly.contains("active_projects_json"));
    assert!(weekly.contains("available_tasks_json"));

    let inbox = inbox_processing(&runner)
        .await
        .expect("inbox processing should render");
    assert!(inbox.contains("inbox_items_json"));
    assert!(inbox.contains("capture receipt"));

    let planning = project_planning(&runner, "alpha")
        .await
        .expect("project planning should render");
    assert!(planning.contains("project_details_json"));
    assert!(planning.contains("project_available_tasks_json"));
}

#[tokio::test]
async fn project_planning_rejects_empty_project() {
    let runner = PromptRunner;
    let error = project_planning(&runner, "   ")
        .await
        .expect_err("empty project must fail");
    assert!(matches!(error, OmniFocusError::Validation(_)));
}

#[derive(Clone)]
struct MissingProjectRunner;

impl JxaRunner for MissingProjectRunner {
    fn run_omnijs<'a>(
        &'a self,
        script: &'a str,
    ) -> Pin<Box<dyn Future<Output = omnifocus_mcp::error::Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            if script.contains("const projectFilter =")
                && script.contains("document.flattenedProjects.find")
            {
                return Err(OmniFocusError::OmniFocus(
                    "Project not found: new-idea".to_string(),
                ));
            }
            if script.contains("const statusFilter =") {
                return Ok(json!([]));
            }
            Ok(Value::Null)
        })
    }
}

#[tokio::test]
async fn project_planning_falls_back_when_project_does_not_exist() {
    let runner = MissingProjectRunner;
    let planning = project_planning(&runner, "new-idea")
        .await
        .expect("project planning should still render");
    assert!(planning.contains("project_details_json"));
    assert!(planning.contains("\"status\":\"not_found\""));
    assert!(planning.contains("project_available_tasks_json"));
}
