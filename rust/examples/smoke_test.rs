use std::time::{SystemTime, UNIX_EPOCH};

use omnifocus_mcp::{
    error::{OmniFocusError, Result},
    jxa::{JxaRunner, RealJxaRunner},
    tools::{
        folders::list_folders,
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{complete_project, create_project, get_project, list_projects},
        tags::{create_tag, list_tags},
        tasks::{
            complete_task, create_task, create_tasks_batch, delete_task, get_inbox, get_task,
            list_tasks, move_task, search_tasks, update_task, CreateTaskInput,
        },
    },
};
use serde_json::Value;

struct SmokeTest {
    total: usize,
    failed: usize,
    created_task_ids: Vec<String>,
    created_project_ids: Vec<String>,
    created_tag_ids: Vec<String>,
}

impl SmokeTest {
    fn new() -> Self {
        Self {
            total: 0,
            failed: 0,
            created_task_ids: Vec::new(),
            created_project_ids: Vec::new(),
            created_tag_ids: Vec::new(),
        }
    }

    fn unique_name(&self, label: &str) -> String {
        let millis = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_millis(),
            Err(_) => 0,
        };
        format!("[TEST-MCP] {label} {millis}")
    }

    fn fail_step(&mut self, name: &str, error: &str) {
        self.total += 1;
        self.failed += 1;
        println!("FAIL {name}: {error}");
    }

    fn pass_step(&mut self, name: &str) {
        self.total += 1;
        println!("PASS {name}");
    }

    fn require_keys(
        &self,
        obj: &serde_json::Map<String, Value>,
        keys: &[&str],
        label: &str,
    ) -> Result<()> {
        let missing: Vec<&str> = keys
            .iter()
            .copied()
            .filter(|key| !obj.contains_key(*key))
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        Err(OmniFocusError::Validation(format!(
            "{label} missing keys: {}",
            missing.join(", ")
        )))
    }

    async fn check_bridge(&mut self, runner: &RealJxaRunner) -> Result<()> {
        let value = runner
            .run_omnijs("return document.flattenedTasks.length;")
            .await?;
        if !value.is_number() {
            return Err(OmniFocusError::Validation(
                "run_omnijs did not return a numeric task count.".to_string(),
            ));
        }
        println!("info total tasks in database: {value}");
        Ok(())
    }

    async fn check_read_tools(&mut self, runner: &RealJxaRunner) -> Result<()> {
        let inbox_items = get_inbox(runner, 20).await?;
        if let Some(first) = inbox_items.first() {
            if first.id.trim().is_empty() || first.name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "get_inbox returned an invalid task record.".to_string(),
                ));
            }
        }

        let tasks = list_tasks(runner, None, None, None, "all", 50).await?;
        let sample_task_id = if let Some(first) = tasks.first() {
            first.id.clone()
        } else {
            let created = create_task(
                runner,
                &self.unique_name("smoke read fallback"),
                None,
                Some("created for read validation"),
                None,
                None,
                Some(false),
                None,
                None,
            )
            .await?;
            let created_id = require_string_key(&created, "id", "create_task fallback result")?;
            self.created_task_ids.push(created_id.to_string());
            created_id.to_string()
        };

        let task_value = get_task(runner, &sample_task_id).await?;
        let task_obj = require_object(&task_value, "get_task result")?;
        self.require_keys(
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

        let query = task_obj
            .get("name")
            .and_then(Value::as_str)
            .and_then(|name| name.split_whitespace().next())
            .filter(|token| !token.trim().is_empty())
            .unwrap_or("a");
        let _ = search_tasks(runner, query, 20).await?;

        let projects_value = list_projects(runner, None, "active", 50).await?;
        let projects = require_array(&projects_value, "list_projects result")?;

        let sample_project_id = if let Some(first) = projects.first() {
            let first_obj = require_object(first, "list_projects item")?;
            self.require_keys(
                first_obj,
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
            require_string_key(first, "id", "list_projects item")?.to_string()
        } else {
            let project_name = self.unique_name("smoke read fallback project");
            let created = create_project(
                runner,
                &project_name,
                None,
                Some("created for read validation"),
                None,
                None,
                Some(false),
            )
            .await?;
            let created_id = require_string_key(&created, "id", "create_project fallback result")?;
            self.created_project_ids.push(created_id.to_string());
            created_id.to_string()
        };

        let project_value = get_project(runner, &sample_project_id).await?;
        let project_obj = require_object(&project_value, "get_project result")?;
        self.require_keys(
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

        let _ = list_tags(runner, 50).await?;
        let _ = list_folders(runner, 50).await?;
        let forecast = get_forecast(runner, 50).await?;
        let forecast_obj = require_object(&forecast, "get_forecast result")?;
        self.require_keys(
            forecast_obj,
            &["overdue", "dueToday", "flagged"],
            "get_forecast result",
        )?;
        let _ = list_perspectives(runner, 50).await?;

        Ok(())
    }

    async fn check_write_tools(&mut self, runner: &RealJxaRunner) -> Result<()> {
        let project_name = self.unique_name("smoke project");
        let created_project = create_project(
            runner,
            &project_name,
            None,
            Some("created by rust smoke test"),
            None,
            None,
            Some(true),
        )
        .await?;
        let project_id = require_string_key(&created_project, "id", "create_project result")?;
        self.created_project_ids.push(project_id.to_string());
        println!("info created project id: {project_id}");

        let tag_name = self.unique_name("smoke tag");
        let created_tag = create_tag(runner, &tag_name, None).await?;
        let tag_id = require_string_key(&created_tag, "id", "create_tag result")?;
        self.created_tag_ids.push(tag_id.to_string());
        println!("info created tag id: {tag_id}");

        let task_name = self.unique_name("smoke task");
        let created_task = create_task(
            runner,
            &task_name,
            None,
            Some("created by rust smoke test"),
            Some("2030-01-01T10:00:00Z"),
            None,
            Some(true),
            Some(vec![tag_name.clone()]),
            Some(15),
        )
        .await?;
        let task_id = require_string_key(&created_task, "id", "create_task result")?.to_string();
        self.created_task_ids.push(task_id.clone());
        println!("info created task id: {task_id}");

        let _ = move_task(runner, &task_id, Some(&project_name)).await?;
        let _ = move_task(runner, &task_id, None).await?;

        let updated_name = self.unique_name("smoke task updated");
        let _ = update_task(
            runner,
            &task_id,
            Some(&updated_name),
            Some("updated by rust smoke test"),
            None,
            None,
            Some(false),
            Some(vec![tag_name.clone()]),
            Some(20),
        )
        .await?;

        let _ = complete_task(runner, &task_id).await?;
        let deleted = delete_task(runner, &task_id).await?;
        let deleted_flag = deleted
            .get("deleted")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !deleted_flag {
            return Err(OmniFocusError::Validation(
                "delete_task did not report deleted=true.".to_string(),
            ));
        }
        self.created_task_ids.retain(|id| id != &task_id);

        let batch = vec![CreateTaskInput {
            name: self.unique_name("smoke batch task"),
            project: Some(project_name.clone()),
            note: Some("created by rust smoke test batch".to_string()),
            due_date: None,
            defer_date: None,
            flagged: Some(false),
            tags: Some(vec![tag_name]),
            estimated_minutes: Some(5),
        }];
        let batch_result = create_tasks_batch(runner, batch).await?;
        let batch_items = require_array(&batch_result, "create_tasks_batch result")?;
        for item in batch_items {
            let batch_id = require_string_key(item, "id", "create_tasks_batch item")?;
            self.created_task_ids.push(batch_id.to_string());
        }

        let batch_ids = self.created_task_ids.clone();
        for id in batch_ids {
            let _ = delete_task(runner, &id).await;
            self.created_task_ids.retain(|existing| existing != &id);
        }

        let _ = complete_project(runner, project_id).await?;
        self.created_project_ids.retain(|id| id != project_id);

        Ok(())
    }

    async fn cleanup(&mut self, runner: &RealJxaRunner) {
        for task_id in self.created_task_ids.clone() {
            if let Err(error) = delete_task(runner, &task_id).await {
                println!("WARN cleanup failed for task {task_id}: {error}");
            }
        }
        self.created_task_ids.clear();

        for project_id in self.created_project_ids.clone() {
            if let Err(error) = complete_project(runner, &project_id).await {
                println!("WARN cleanup failed for project {project_id}: {error}");
            }
        }
        self.created_project_ids.clear();

        if !self.created_tag_ids.is_empty() {
            let ids_json = match serde_json::to_string(&self.created_tag_ids) {
                Ok(value) => value,
                Err(error) => {
                    println!("WARN cleanup failed to serialize tag ids: {error}");
                    self.created_tag_ids.clear();
                    return;
                }
            };
            let cleanup_script = format!(
                r#"const ids = {ids_json};
ids.forEach(id => {{
  const tag = document.flattenedTags.find(item => item.id.primaryKey === id);
  if (tag) {{
    try {{
      tag.drop(false);
    }} catch (_) {{
    }}
  }}
}});
return true;"#
            );
            if let Err(error) = runner.run_omnijs(&cleanup_script).await {
                println!("WARN cleanup failed for created tags: {error}");
            }
            self.created_tag_ids.clear();
        }
    }

    async fn run(&mut self, runner: &RealJxaRunner) -> i32 {
        println!("starting omnifocus rust smoke test");

        match self.check_bridge(runner).await {
            Ok(()) => self.pass_step("jxa bridge basics"),
            Err(error) => self.fail_step("jxa bridge basics", &error.to_string()),
        }

        match self.check_read_tools(runner).await {
            Ok(()) => self.pass_step("read tools validation"),
            Err(error) => self.fail_step("read tools validation", &error.to_string()),
        }

        match self.check_write_tools(runner).await {
            Ok(()) => self.pass_step("write tools validation"),
            Err(error) => self.fail_step("write tools validation", &error.to_string()),
        }

        self.cleanup(runner).await;

        println!(
            "completed {} checks with {} failures",
            self.total, self.failed
        );
        if self.failed == 0 {
            println!("smoke test PASSED");
            0
        } else {
            println!("smoke test FAILED");
            1
        }
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

#[tokio::main]
async fn main() {
    let runner = RealJxaRunner::new();
    let mut smoke_test = SmokeTest::new();
    let exit_code = smoke_test.run(&runner).await;
    std::process::exit(exit_code);
}
