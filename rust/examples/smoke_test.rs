use std::time::{SystemTime, UNIX_EPOCH};

use omnifocus_mcp::{
    error::Result,
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

    fn fail(&mut self, name: &str, message: &str) {
        self.total += 1;
        self.failed += 1;
        println!("FAIL {name}: {message}");
    }

    fn pass(&mut self, name: &str) {
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
        Err(omnifocus_mcp::error::OmniFocusError::Validation(format!(
            "{label} missing keys: {}",
            missing.join(", ")
        )))
    }

    async fn check_bridge(&mut self, runner: &RealJxaRunner) -> Result<()> {
        let result = runner
            .run_omnijs("return document.flattenedTasks.length;")
            .await?;
        if !result.is_u64() {
            return Err(omnifocus_mcp::error::OmniFocusError::Validation(
                "run_omnijs did not return a numeric task count.".to_string(),
            ));
        }
        println!("info total tasks in database: {result}");
        Ok(())
    }

    async fn check_read_tools(&mut self, runner: &RealJxaRunner) -> Result<()> {
        let inbox_items = get_inbox(runner, 20).await?;
        if let Some(first) = inbox_items.first() {
            if first.id.trim().is_empty() || first.name.trim().is_empty() {
                return Err(omnifocus_mcp::error::OmniFocusError::Validation(
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
                Some("created for read tool validation"),
                None,
                None,
                Some(false),
                None,
                None,
            )
            .await?;
            let created_id = created
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .ok_or_else(|| {
                    omnifocus_mcp::error::OmniFocusError::Validation(
                        "create_task fallback did not return a valid id.".to_string(),
                    )
                })?;
            self.created_task_ids.push(created_id.clone());
            created_id
        };

        let task_value = get_task(runner, &sample_task_id).await?;
        let task_obj = task_value.as_object().ok_or_else(|| {
            omnifocus_mcp::error::OmniFocusError::Validation(
                "get_task did not return an object.".to_string(),
            )
        })?;
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
        let _search_results = search_tasks(runner, query, 20).await?;

        let projects_value = list_projects(runner, None, "active", 50).await?;
        let projects = projects_value.as_array().ok_or_else(|| {
            omnifocus_mcp::error::OmniFocusError::Validation(
                "list_projects did not return a list.".to_string(),
            )
        })?;

        let sample_project_id = if let Some(first) = projects.first() {
            let first_obj = first.as_object().ok_or_else(|| {
                omnifocus_mcp::error::OmniFocusError::Validation(
                    "list_projects item did not return an object.".to_string(),
                )
            })?;
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
            first_obj
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .ok_or_else(|| {
                    omnifocus_mcp::error::OmniFocusError::Validation(
                        "list_projects item did not contain a valid id.".to_string(),
                    )
                })?
        } else {
            let project_name = self.unique_name("smoke read fallback project");
            let created_project = create_project(
                runner,
                &project_name,
                None,
                Some("created for read tool validation"),
                None,
                None,
                Some(false),
            )
            .await?;
            let created_id = created_project
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .ok_or_else(|| {
                    omnifocus_mcp::error::OmniFocusError::Validation(
                        "create_project fallback did not return a valid id.".to_string(),
                    )
                })?;
            self.created_project_ids.push(created_id.clone());
            created_id
        };

        let project_value = get_project(runner, &sample_project_id).await?;
        let project_obj = project_value.as_object().ok_or_else(|| {
            omnifocus_mcp::error::OmniFocusError::Validation(
                "get_project did not return an object.".to_string(),
            )
        })?;
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

        let _tags = list_tags(runner, 50).await?;
        let _folders = list_folders(runner, 50).await?;
        let forecast = get_forecast(runner, 50).await?;
        let forecast_obj = forecast.as_object().ok_or_else(|| {
            omnifocus_mcp::error::OmniFocusError::Validation(
                "get_forecast did not return an object.".to_string(),
            )
        })?;
        self.require_keys(
            forecast_obj,
            &["overdue", "dueToday", "flagged"],
            "get_forecast result",
        )?;
        let _perspectives = list_perspectives(runner, 50).await?;

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
        let project_id = created_project
            .get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| {
                omnifocus_mcp::error::OmniFocusError::Validation(
                    "create_project did not return a valid id.".to_string(),
                )
            })?;
        self.created_project_ids.push(project_id.clone());
        println!("info created project id: {project_id}");

        let tag_name = self.unique_name("smoke tag");
        let created_tag = create_tag(runner, &tag_name, None).await?;
        let tag_id = created_tag
            .get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| {
                omnifocus_mcp::error::OmniFocusError::Validation(
                    "create_tag did not return a valid id.".to_string(),
                )
            })?;
        self.created_tag_ids.push(tag_id.clone());
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
        let task_id = created_task
            .get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| {
                omnifocus_mcp::error::OmniFocusError::Validation(
                    "create_task did not return a valid id.".to_string(),
                )
            })?;
        self.created_task_ids.push(task_id.clone());
        println!("info created task id: {task_id}");

        let _moved_to_project = move_task(runner, &task_id, Some(&project_name)).await?;
        let _moved_to_inbox = move_task(runner, &task_id, None).await?;

        let updated_name = self.unique_name("smoke task updated");
        let _updated = update_task(
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

        let _completed = complete_task(runner, &task_id).await?;
        let deleted = delete_task(runner, &task_id).await?;
        if deleted
            .get("deleted")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            self.created_task_ids.retain(|id| id != &task_id);
        } else {
            return Err(omnifocus_mcp::error::OmniFocusError::Validation(
                "delete_task did not report deleted=true.".to_string(),
            ));
        }

        let batch_tasks = vec![CreateTaskInput {
            name: self.unique_name("smoke batch task"),
            project: Some(project_name.clone()),
            note: Some("created by rust smoke test batch".to_string()),
            due_date: None,
            defer_date: None,
            flagged: Some(false),
            tags: Some(vec![tag_name]),
            estimated_minutes: Some(5),
        }];
        let batch_result = create_tasks_batch(runner, batch_tasks).await?;
        let created_batch = batch_result.as_array().ok_or_else(|| {
            omnifocus_mcp::error::OmniFocusError::Validation(
                "create_tasks_batch did not return a list.".to_string(),
            )
        })?;
        for item in created_batch {
            let batch_id = item.get("id").and_then(Value::as_str).ok_or_else(|| {
                omnifocus_mcp::error::OmniFocusError::Validation(
                    "create_tasks_batch item did not include id.".to_string(),
                )
            })?;
            self.created_task_ids.push(batch_id.to_string());
        }

        let batch_ids = self.created_task_ids.clone();
        for id in batch_ids {
            let _ = delete_task(runner, &id).await;
            self.created_task_ids.retain(|existing| existing != &id);
        }

        let _completed_project = complete_project(runner, &project_id).await?;
        self.created_project_ids.retain(|id| id != &project_id);

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
            let cleanup_ids =
                serde_json::to_string(&self.created_tag_ids).unwrap_or_else(|_| "[]".to_string());
            let cleanup_script = format!(
                r#"const ids = {cleanup_ids};
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
            Ok(()) => self.pass("jxa bridge basics"),
            Err(error) => self.fail("jxa bridge basics", &error.to_string()),
        }

        match self.check_read_tools(runner).await {
            Ok(()) => self.pass("read tools validation"),
            Err(error) => self.fail("read tools validation", &error.to_string()),
        }

        match self.check_write_tools(runner).await {
            Ok(()) => self.pass("write tools validation"),
            Err(error) => self.fail("write tools validation", &error.to_string()),
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

#[tokio::main]
async fn main() {
    let runner = RealJxaRunner::new();
    let mut smoke_test = SmokeTest::new();
    let exit_code = smoke_test.run(&runner).await;
    std::process::exit(exit_code);
}
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
    runner: RealJxaRunner,
    total: usize,
    failed: usize,
    created_task_ids: Vec<String>,
    created_project_ids: Vec<String>,
}

impl SmokeTest {
    fn new() -> Self {
        Self {
            runner: RealJxaRunner::new(),
            total: 0,
            failed: 0,
            created_task_ids: Vec::new(),
            created_project_ids: Vec::new(),
        }
    }

    async fn run(&mut self) -> i32 {
        println!("starting omnifocus smoke test");
        self.total += 1;
        match self.check_bridge().await {
            Ok(()) => println!("PASS jxa bridge basics"),
            Err(error) => {
                self.failed += 1;
                println!("FAIL jxa bridge basics: {error}");
            }
        }

        self.total += 1;
        match self.check_read_tools().await {
            Ok(()) => println!("PASS read tools json/field validation"),
            Err(error) => {
                self.failed += 1;
                println!("FAIL read tools json/field validation: {error}");
            }
        }

        self.total += 1;
        match self.check_write_tools().await {
            Ok(()) => println!("PASS write tools lifecycle validation"),
            Err(error) => {
                self.failed += 1;
                println!("FAIL write tools lifecycle validation: {error}");
            }
        }

        self.cleanup().await;
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

    async fn check_bridge(&self) -> Result<()> {
        let value = self
            .runner
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

    async fn check_read_tools(&self) -> Result<()> {
        let inbox_items = get_inbox(&self.runner, 20).await?;
        if let Some(item) = inbox_items.first() {
            if item.id.trim().is_empty() || item.name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "get_inbox returned an invalid task item.".to_string(),
                ));
            }
        }

        let tasks = list_tasks(&self.runner, None, None, None, "all", 50).await?;
        if tasks.is_empty() {
            return Err(OmniFocusError::Validation(
                "list_tasks returned no tasks; cannot validate get_task.".to_string(),
            ));
        }
        let sample_task_id = tasks[0].id.clone();
        if sample_task_id.trim().is_empty() {
            return Err(OmniFocusError::Validation(
                "list_tasks did not return a valid task id.".to_string(),
            ));
        }

        let task = get_task(&self.runner, &sample_task_id).await?;
        require_object(&task, "get_task result")?;
        require_keys(
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
            "get_task result",
        )?;

        let mut query = tasks[0]
            .name
            .split_whitespace()
            .next()
            .unwrap_or("a")
            .to_string();
        if query.trim().is_empty() {
            query = "a".to_string();
        }
        let search_results = search_tasks(&self.runner, &query, 20).await?;
        if let Some(item) = search_results.first() {
            if item.id.trim().is_empty() || item.name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "search_tasks returned an invalid task item.".to_string(),
                ));
            }
        }

        let projects_value = list_projects(&self.runner, None, "active", 50).await?;
        let projects = require_array(&projects_value, "list_projects result")?;
        if projects.is_empty() {
            return Err(OmniFocusError::Validation(
                "list_projects returned no projects; cannot validate get_project.".to_string(),
            ));
        }
        let sample_project_id = get_string_key(&projects[0], "id", "list_projects item")?;
        let project = get_project(&self.runner, sample_project_id).await?;
        require_keys(
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
            "get_project result",
        )?;

        let tags_value = list_tags(&self.runner, 50).await?;
        let tags = require_array(&tags_value, "list_tags result")?;
        if let Some(tag) = tags.first() {
            require_keys(
                tag,
                &["id", "name", "parent", "availableTaskCount", "status"],
                "list_tags item",
            )?;
        }

        let folders_value = list_folders(&self.runner, 50).await?;
        let folders = require_array(&folders_value, "list_folders result")?;
        if let Some(folder) = folders.first() {
            require_keys(
                folder,
                &["id", "name", "parentName", "projectCount"],
                "list_folders item",
            )?;
        }

        let forecast = get_forecast(&self.runner, 50).await?;
        require_keys(
            &forecast,
            &["overdue", "dueToday", "flagged"],
            "get_forecast result",
        )?;

        let perspectives_value = list_perspectives(&self.runner, 50).await?;
        let perspectives = require_array(&perspectives_value, "list_perspectives result")?;
        if let Some(perspective) = perspectives.first() {
            require_keys(perspective, &["id", "name"], "list_perspectives item")?;
        }

        Ok(())
    }

    async fn check_write_tools(&mut self) -> Result<()> {
        let suffix = unique_suffix();
        let project_name = format!("[TEST-MCP] Smoke Project {suffix}");
        let project = create_project(
            &self.runner,
            &project_name,
            None,
            Some("smoke test project"),
            None,
            None,
            Some(true),
        )
        .await?;
        let created_project_id =
            get_string_key(&project, "id", "create_project result")?.to_string();
        self.created_project_ids.push(created_project_id.clone());
        println!("info created project id: {created_project_id}");

        let created = create_task(
            &self.runner,
            "[TEST-MCP] Smoke Test Task",
            None,
            Some("smoke test"),
            None,
            None,
            Some(true),
            None,
            Some(15),
        )
        .await?;
        let created_task_id = get_string_key(&created, "id", "create_task result")?.to_string();
        self.created_task_ids.push(created_task_id.clone());
        println!("info created task id: {created_task_id}");

        let updated = update_task(
            &self.runner,
            &created_task_id,
            Some("[TEST-MCP] Updated Task"),
            None,
            None,
            None,
            Some(false),
            None,
            Some(10),
        )
        .await?;
        require_keys(
            &updated,
            &[
                "id",
                "name",
                "note",
                "flagged",
                "dueDate",
                "deferDate",
                "completed",
                "projectName",
                "tags",
                "estimatedMinutes",
            ],
            "update_task result",
        )?;

        let moved_to_project =
            move_task(&self.runner, &created_task_id, Some(&project_name)).await?;
        let moved_project_name =
            get_optional_string_key(&moved_to_project, "projectName", "move_task result")?;
        if moved_project_name != Some(project_name.clone()) {
            return Err(OmniFocusError::Validation(
                "move_task did not move the task to the expected project.".to_string(),
            ));
        }

        let moved_to_inbox = move_task(&self.runner, &created_task_id, None).await?;
        let in_inbox = moved_to_inbox
            .get("inInbox")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                OmniFocusError::Validation("move_task result missing inInbox boolean.".to_string())
            })?;
        if !in_inbox {
            return Err(OmniFocusError::Validation(
                "move_task did not move the task back to inbox.".to_string(),
            ));
        }

        let fetched = get_task(&self.runner, &created_task_id).await?;
        let fetched_name = get_string_key(&fetched, "name", "get_task created result")?;
        if fetched_name != "[TEST-MCP] Updated Task" {
            return Err(OmniFocusError::Validation(
                "update_task did not persist the expected name.".to_string(),
            ));
        }

        let batch = create_tasks_batch(
            &self.runner,
            vec![
                CreateTaskInput {
                    name: format!("[TEST-MCP] Batch A {suffix}"),
                    project: None,
                    note: None,
                    due_date: None,
                    defer_date: None,
                    flagged: Some(false),
                    tags: None,
                    estimated_minutes: None,
                },
                CreateTaskInput {
                    name: format!("[TEST-MCP] Batch B {suffix}"),
                    project: Some(project_name.clone()),
                    note: Some("batch".to_string()),
                    due_date: None,
                    defer_date: None,
                    flagged: Some(true),
                    tags: None,
                    estimated_minutes: Some(5),
                },
            ],
        )
        .await?;
        let batch_items = require_array(&batch, "create_tasks_batch result")?;
        if batch_items.len() != 2 {
            return Err(OmniFocusError::Validation(
                "create_tasks_batch did not return two created tasks.".to_string(),
            ));
        }
        for item in batch_items {
            let task_id = get_string_key(item, "id", "create_tasks_batch item")?.to_string();
            self.created_task_ids.push(task_id);
        }

        let completed = complete_task(&self.runner, &created_task_id).await?;
        let completed_flag = completed
            .get("completed")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                OmniFocusError::Validation(
                    "complete_task result missing completed boolean.".to_string(),
                )
            })?;
        if !completed_flag {
            return Err(OmniFocusError::Validation(
                "complete_task did not mark task complete.".to_string(),
            ));
        }

        let deleted = delete_task(&self.runner, &created_task_id).await?;
        let deleted_flag = deleted
            .get("deleted")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                OmniFocusError::Validation(
                    "delete_task result missing deleted boolean.".to_string(),
                )
            })?;
        if !deleted_flag {
            return Err(OmniFocusError::Validation(
                "delete_task did not report deleted=true.".to_string(),
            ));
        }
        self.created_task_ids
            .retain(|task_id| task_id != &created_task_id);

        let completed_project = complete_project(&self.runner, &created_project_id).await?;
        let project_completed = completed_project
            .get("completed")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                OmniFocusError::Validation(
                    "complete_project result missing completed boolean.".to_string(),
                )
            })?;
        if !project_completed {
            return Err(OmniFocusError::Validation(
                "complete_project did not report completed=true.".to_string(),
            ));
        }

        let tag_name = format!("[TEST-MCP] Smoke Tag {suffix}");
        let tag = create_tag(&self.runner, &tag_name, None).await?;
        let _ = get_string_key(&tag, "id", "create_tag result")?;

        Ok(())
    }

    async fn cleanup(&mut self) {
        for task_id in self.created_task_ids.drain(..) {
            match delete_task(&self.runner, &task_id).await {
                Ok(_) => println!("info cleanup deleted task id: {task_id}"),
                Err(error) => println!("WARN cleanup failed for task {task_id}: {error}"),
            }
        }
        for project_id in self.created_project_ids.drain(..) {
            match complete_project(&self.runner, &project_id).await {
                Ok(_) => println!("info cleanup completed project id: {project_id}"),
                Err(error) => println!("WARN cleanup failed for project {project_id}: {error}"),
            }
        }
    }
}

fn unique_suffix() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs(),
        Err(_) => 0,
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

fn require_keys(value: &Value, keys: &[&str], label: &str) -> Result<()> {
    let object = require_object(value, label)?;
    for key in keys {
        if !object.contains_key(*key) {
            return Err(OmniFocusError::Validation(format!(
                "{label} missing key: {key}."
            )));
        }
    }
    Ok(())
}

fn get_string_key<'a>(value: &'a Value, key: &str, label: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| OmniFocusError::Validation(format!("{label} missing non-empty {key}.")))
}

fn get_optional_string_key(value: &Value, key: &str, label: &str) -> Result<Option<String>> {
    if !value.get(key).is_some() {
        return Err(OmniFocusError::Validation(format!(
            "{label} missing {key}."
        )));
    }
    Ok(value.get(key).and_then(Value::as_str).map(str::to_string))
}

#[tokio::main]
async fn main() {
    let mut smoke_test = SmokeTest::new();
    std::process::exit(smoke_test.run().await);
}
