use std::{
    future::Future,
    pin::Pin,
    time::{SystemTime, UNIX_EPOCH},
};

use omnifocus_mcp::{
    error::{OmniFocusError, Result},
    jxa::{run_omnijs_with_timeout, JxaRunner},
    tools::{
        folders::{create_folder, delete_folder, get_folder, list_folders, update_folder},
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{
            complete_project, create_project, delete_project, get_project, list_projects,
            move_project, search_projects, set_project_status, uncomplete_project, update_project,
        },
        tags::{create_tag, delete_tag, list_tags, search_tags, update_tag},
        tasks::{
            append_to_note, complete_task, create_subtask, create_task, create_tasks_batch,
            delete_task, delete_tasks_batch, get_inbox, get_task, list_subtasks, list_tasks,
            search_tasks, set_task_repetition, uncomplete_task, update_task, CreateTaskInput,
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
    created_folder_ids: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct SmokeJxaRunner;

impl JxaRunner for SmokeJxaRunner {
    fn run_omnijs<'a>(
        &'a self,
        script: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>> {
        Box::pin(async move { run_omnijs_with_timeout(script, 120.0).await })
    }
}

impl SmokeTest {
    fn new() -> Self {
        Self {
            total: 0,
            failed: 0,
            created_task_ids: Vec::new(),
            created_project_ids: Vec::new(),
            created_tag_ids: Vec::new(),
            created_folder_ids: Vec::new(),
        }
    }

    fn unique_name(&self, label: &str) -> String {
        let millis = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_millis(),
            Err(_) => 0,
        };
        format!("[TEST-MCP] {label} {millis}")
    }

    fn pass_step(&mut self, name: &str) {
        self.total += 1;
        println!("PASS {name}");
    }

    fn fail_step(&mut self, name: &str, error: &str) {
        self.total += 1;
        self.failed += 1;
        println!("FAIL {name}: {error}");
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
            Ok(())
        } else {
            Err(OmniFocusError::Validation(format!(
                "{label} missing keys: {}",
                missing.join(", ")
            )))
        }
    }

    async fn check_bridge<R: JxaRunner>(&mut self, runner: &R) -> Result<()> {
        let value = runner
            .run_omnijs("return document.flattenedTasks.length;")
            .await?;
        if value.is_number() {
            Ok(())
        } else {
            Err(OmniFocusError::Validation(
                "run_omnijs did not return a numeric task count.".to_string(),
            ))
        }
    }

    async fn check_read_tools<R: JxaRunner>(&mut self, runner: &R) -> Result<()> {
        let inbox_items = get_inbox(runner, 20)
            .await
            .map_err(|error| OmniFocusError::Validation(format!("get_inbox failed: {error}")))?;
        if let Some(first) = inbox_items.first() {
            if first.id.trim().is_empty() || first.name.trim().is_empty() {
                return Err(OmniFocusError::Validation(
                    "get_inbox returned an invalid task record.".to_string(),
                ));
            }
        }

        let task_id = if let Some(first) = inbox_items.first() {
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
            .await
            .map_err(|error| {
                OmniFocusError::Validation(format!("create_task fallback failed: {error}"))
            })?;
            let created_id = require_string_key(&created, "id", "create_task fallback result")?;
            self.created_task_ids.push(created_id.to_string());
            created_id.to_string()
        };

        let task_value = get_task(runner, &task_id)
            .await
            .map_err(|error| OmniFocusError::Validation(format!("get_task failed: {error}")))?;
        let task_obj = require_object(&task_value, "get_task result")?;
        self.require_keys(
            task_obj,
            &["id", "name", "completed", "tags", "children", "sequential"],
            "get_task result",
        )?;

        let projects_value = list_projects(runner, None, "active", 10)
            .await
            .map_err(|error| {
                OmniFocusError::Validation(format!("list_projects failed: {error}"))
            })?;
        let projects = require_array(&projects_value, "list_projects result")?;
        let project_id = if let Some(first) = projects.first() {
            require_string_key(first, "id", "list_projects item")?.to_string()
        } else {
            let created = create_project(
                runner,
                &self.unique_name("smoke read fallback project"),
                None,
                Some("created for read validation"),
                None,
                None,
                Some(false),
            )
            .await
            .map_err(|error| {
                OmniFocusError::Validation(format!("create_project fallback failed: {error}"))
            })?;
            let created_id = require_string_key(&created, "id", "create_project fallback result")?;
            self.created_project_ids.push(created_id.to_string());
            created_id.to_string()
        };
        let _ = get_project(runner, &project_id).await.map_err(|error| {
            OmniFocusError::Validation(format!("get_project failed: {error}"))
        })?;

        let _ = list_tags(runner, 20)
            .await
            .map_err(|error| OmniFocusError::Validation(format!("list_tags failed: {error}")))?;
        let _ = list_folders(runner, 20)
            .await
            .map_err(|error| OmniFocusError::Validation(format!("list_folders failed: {error}")))?;
        let forecast = get_forecast(runner, 20).await.map_err(|error| {
            OmniFocusError::Validation(format!("get_forecast failed: {error}"))
        })?;
        let forecast_obj = require_object(&forecast, "get_forecast result")?;
        self.require_keys(
            forecast_obj,
            &["overdue", "dueToday", "flagged"],
            "get_forecast result",
        )?;
        let _ = list_perspectives(runner, 20).await.map_err(|error| {
            OmniFocusError::Validation(format!("list_perspectives failed: {error}"))
        })?;
        Ok(())
    }

    async fn check_write_tools<R: JxaRunner>(&mut self, runner: &R) -> Result<()> {
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
        let project_id =
            require_string_key(&created_project, "id", "create_project result")?.to_string();
        self.created_project_ids.push(project_id.clone());

        let folder_name = self.unique_name("smoke folder");
        let created_folder = create_folder(runner, &folder_name, None).await?;
        let folder_id =
            require_string_key(&created_folder, "id", "create_folder result")?.to_string();
        self.created_folder_ids.push(folder_id.clone());
        let updated_folder_name = format!("{folder_name} updated");
        let _ = update_folder(
            runner,
            &folder_id,
            Some(&updated_folder_name),
            Some("active"),
        )
        .await?;
        let folder_value = get_folder(runner, &folder_id).await?;
        let folder_obj = require_object(&folder_value, "get_folder result")?;
        if folder_obj.get("name").and_then(Value::as_str) != Some(updated_folder_name.as_str()) {
            return Err(OmniFocusError::Validation(
                "update_folder did not apply the expected name.".to_string(),
            ));
        }

        let tag_name = self.unique_name("smoke tag");
        let created_tag = create_tag(runner, &tag_name, None).await?;
        let tag_id = require_string_key(&created_tag, "id", "create_tag result")?.to_string();
        self.created_tag_ids.push(tag_id.clone());
        let updated_tag_name = format!("{tag_name} updated");
        let _ = update_tag(runner, &tag_id, Some(&updated_tag_name), Some("on_hold")).await?;

        let created_task = create_task(
            runner,
            &self.unique_name("smoke task"),
            Some(&project_name),
            Some("created by rust smoke test"),
            Some("2030-01-01T10:00:00Z"),
            None,
            Some(true),
            Some(vec![updated_tag_name.clone()]),
            Some(15),
        )
        .await?;
        let task_id = require_string_key(&created_task, "id", "create_task result")?.to_string();
        self.created_task_ids.push(task_id.clone());

        let _ = update_task(
            runner,
            &task_id,
            Some(&self.unique_name("smoke task updated")),
            Some("updated by rust smoke test"),
            None,
            None,
            Some(false),
            Some(vec![updated_tag_name.clone()]),
            Some(20),
        )
        .await?;

        let created_subtask = create_subtask(
            runner,
            &self.unique_name("smoke subtask"),
            &task_id,
            Some("child task"),
            None,
            None,
            Some(false),
            None,
            Some(5),
        )
        .await?;
        let subtask_id =
            require_string_key(&created_subtask, "id", "create_subtask result")?.to_string();
        self.created_task_ids.push(subtask_id.clone());

        let subtasks = list_subtasks(runner, &task_id, 50).await?;
        if !subtasks.iter().any(|item| item.id == subtask_id) {
            return Err(OmniFocusError::Validation(
                "list_subtasks did not include the created subtask.".to_string(),
            ));
        }

        let repetition_set =
            set_task_repetition(runner, &task_id, Some("FREQ=WEEKLY"), "regularly").await?;
        if repetition_set
            .get("repetitionRule")
            .and_then(Value::as_str)
            .unwrap_or("")
            != "FREQ=WEEKLY"
        {
            return Err(OmniFocusError::Validation(
                "set_task_repetition did not set weekly rule.".to_string(),
            ));
        }
        let task_after_repetition_set = get_task(runner, &task_id).await?;
        if task_after_repetition_set
            .get("repetitionRule")
            .and_then(Value::as_str)
            .unwrap_or("")
            != "FREQ=WEEKLY"
        {
            return Err(OmniFocusError::Validation(
                "get_task did not report weekly repetition after set.".to_string(),
            ));
        }
        let repetition_cleared = set_task_repetition(runner, &task_id, None, "regularly").await?;
        if !repetition_cleared
            .get("repetitionRule")
            .map(Value::is_null)
            .unwrap_or(false)
        {
            return Err(OmniFocusError::Validation(
                "set_task_repetition did not clear repetition rule.".to_string(),
            ));
        }
        let task_after_repetition_clear = get_task(runner, &task_id).await?;
        if !task_after_repetition_clear
            .get("repetitionRule")
            .map(Value::is_null)
            .unwrap_or(false)
        {
            return Err(OmniFocusError::Validation(
                "get_task did not report cleared repetition after clear.".to_string(),
            ));
        }

        let _ = complete_task(runner, &task_id).await?;
        let reopened_task = uncomplete_task(runner, &task_id).await?;
        if reopened_task
            .get("completed")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            return Err(OmniFocusError::Validation(
                "uncomplete_task did not reopen the task.".to_string(),
            ));
        }

        let appended = append_to_note(runner, "task", &task_id, "\nsmoke append line").await?;
        if appended
            .get("noteLength")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            <= 0
        {
            return Err(OmniFocusError::Validation(
                "append_to_note returned invalid note length.".to_string(),
            ));
        }
        let appended_task = get_task(runner, &task_id).await?;
        let appended_note = appended_task
            .get("note")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !appended_note.contains("smoke append line") {
            return Err(OmniFocusError::Validation(
                "append_to_note did not persist task note text.".to_string(),
            ));
        }

        let updated_project = update_project(
            runner,
            &project_id,
            Some(&self.unique_name("smoke project updated")),
            Some("updated project note"),
            None,
            None,
            Some(false),
            Some(vec![updated_tag_name.clone()]),
            Some(true),
            Some(false),
            None,
        )
        .await?;
        let updated_project_name =
            require_string_key(&updated_project, "name", "update_project result")?.to_string();
        if updated_project
            .get("note")
            .and_then(Value::as_str)
            .unwrap_or("")
            != "updated project note"
        {
            return Err(OmniFocusError::Validation(
                "update_project did not set project note.".to_string(),
            ));
        }

        let on_hold_project = set_project_status(runner, &project_id, "on_hold").await?;
        if on_hold_project
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            != "on_hold"
        {
            return Err(OmniFocusError::Validation(
                "set_project_status did not set on_hold.".to_string(),
            ));
        }
        let active_project = set_project_status(runner, &project_id, "active").await?;
        if active_project
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            != "active"
        {
            return Err(OmniFocusError::Validation(
                "set_project_status did not set active.".to_string(),
            ));
        }

        let _ = complete_project(runner, &project_id).await?;
        let reopened_project = uncomplete_project(runner, &project_id).await?;
        if reopened_project
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            != "active"
        {
            return Err(OmniFocusError::Validation(
                "uncomplete_project did not set active status.".to_string(),
            ));
        }

        let project_search = search_projects(runner, &updated_project_name, 20).await?;
        if require_array(&project_search, "search_projects result")?.is_empty() {
            return Err(OmniFocusError::Validation(
                "search_projects did not find the updated project.".to_string(),
            ));
        }
        let tag_search = search_tags(runner, &updated_tag_name, 20).await?;
        if require_array(&tag_search, "search_tags result")?.is_empty() {
            return Err(OmniFocusError::Validation(
                "search_tags did not find the created tag.".to_string(),
            ));
        }

        let folder_name = self.unique_name("smoke folder");
        let created_folder = create_folder(runner, &folder_name, None).await?;
        let folder_id =
            require_string_key(&created_folder, "id", "create_folder result")?.to_string();
        self.created_folder_ids.push(folder_id.clone());

        let moved_project = move_project(runner, &project_id, Some(&folder_name)).await?;
        if moved_project
            .get("folderName")
            .and_then(Value::as_str)
            .unwrap_or("")
            != folder_name
        {
            return Err(OmniFocusError::Validation(
                "move_project did not move project to folder.".to_string(),
            ));
        }
        let _ = move_project(runner, &project_id, None).await?;

        let renamed_folder = self.unique_name("smoke folder renamed");
        let updated_folder =
            update_folder(runner, &folder_id, Some(&renamed_folder), Some("active")).await?;
        let _ = require_string_key(&updated_folder, "id", "update_folder result")?;
        let fetched_folder = get_folder(runner, &folder_id).await?;
        let fetched_folder_obj = require_object(&fetched_folder, "get_folder result")?;
        self.require_keys(
            fetched_folder_obj,
            &["id", "name", "status", "projects", "subfolders"],
            "get_folder result",
        )?;

        let deleted_folder = delete_folder(runner, &folder_id).await?;
        if deleted_folder.get("deleted") != Some(&Value::Bool(true)) {
            return Err(OmniFocusError::Validation(
                "delete_folder did not confirm deletion.".to_string(),
            ));
        }
        self.created_folder_ids.retain(|id| id != &folder_id);

        let updated_tag_name = self.unique_name("smoke tag updated");
        let _ = update_tag(runner, &tag_id, Some(&updated_tag_name), Some("active")).await?;
        let updated_tag_results = search_tags(runner, &updated_tag_name, 20).await?;
        let updated_tag_items = require_array(&updated_tag_results, "search_tags result")?;
        if !updated_tag_items.iter().any(|item| {
            item.get("id").and_then(Value::as_str) == Some(tag_id.as_str())
                && item.get("name").and_then(Value::as_str) == Some(updated_tag_name.as_str())
        }) {
            return Err(OmniFocusError::Validation(
                "update_tag verification failed via search_tags.".to_string(),
            ));
        }

        let temp_project = create_project(
            runner,
            &self.unique_name("smoke temp delete project"),
            None,
            Some("delete_project validation"),
            None,
            None,
            Some(false),
        )
        .await?;
        let temp_project_id =
            require_string_key(&temp_project, "id", "create_project temp result")?.to_string();
        self.created_project_ids.push(temp_project_id.clone());
        let deleted_project = delete_project(runner, &temp_project_id).await?;
        if deleted_project.get("deleted") != Some(&Value::Bool(true)) {
            return Err(OmniFocusError::Validation(
                "delete_project did not confirm deletion.".to_string(),
            ));
        }
        if get_project(runner, &temp_project_id).await.is_ok() {
            return Err(OmniFocusError::Validation(
                "get_project succeeded after delete_project.".to_string(),
            ));
        }
        self.created_project_ids.retain(|id| id != &temp_project_id);

        let batch_result = create_tasks_batch(
            runner,
            vec![
                CreateTaskInput {
                    name: self.unique_name("smoke batch task"),
                    project: Some(project_name.clone()),
                    note: Some("created by rust smoke test batch".to_string()),
                    due_date: None,
                    defer_date: None,
                    flagged: Some(false),
                    tags: Some(vec![updated_tag_name.clone()]),
                    estimated_minutes: Some(5),
                },
                CreateTaskInput {
                    name: self.unique_name("smoke batch task"),
                    project: Some(project_name.clone()),
                    note: Some("created by rust smoke test batch".to_string()),
                    due_date: None,
                    defer_date: None,
                    flagged: Some(false),
                    tags: Some(vec![updated_tag_name.clone()]),
                    estimated_minutes: Some(5),
                },
                CreateTaskInput {
                    name: self.unique_name("smoke batch task"),
                    project: Some(project_name.clone()),
                    note: Some("created by rust smoke test batch".to_string()),
                    due_date: None,
                    defer_date: None,
                    flagged: Some(false),
                    tags: Some(vec![updated_tag_name]),
                    estimated_minutes: Some(5),
                },
            ],
        )
        .await?;
        let mut batch_ids: Vec<String> = Vec::new();
        for item in require_array(&batch_result, "create_tasks_batch result")? {
            let batch_id = require_string_key(item, "id", "create_tasks_batch item")?.to_string();
            self.created_task_ids.push(batch_id.clone());
            batch_ids.push(batch_id);
        }
        if batch_ids.len() != 3 {
            return Err(OmniFocusError::Validation(
                "create_tasks_batch did not return three tasks.".to_string(),
            ));
        }

        let delete_result = delete_tasks_batch(runner, batch_ids.clone()).await?;
        let deleted_count = delete_result
            .get("deleted_count")
            .and_then(Value::as_i64)
            .unwrap_or(-1);
        let not_found_count = delete_result
            .get("not_found_count")
            .and_then(Value::as_i64)
            .unwrap_or(-1);
        if deleted_count != 3 || not_found_count != 0 {
            return Err(OmniFocusError::Validation(
                "delete_tasks_batch summary did not confirm deleting all three tasks.".to_string(),
            ));
        }
        for id in &batch_ids {
            if get_task(runner, id).await.is_ok() {
                return Err(OmniFocusError::Validation(
                    "delete_tasks_batch did not remove one or more tasks.".to_string(),
                ));
            }
        }
        for id in batch_ids {
            self.created_task_ids.retain(|existing| existing != &id);
        }

        let _ = delete_tag(runner, &tag_id).await?;
        self.created_tag_ids.retain(|id| id != &tag_id);

        let _ = delete_task(runner, &subtask_id).await;
        self.created_task_ids.retain(|id| id != &subtask_id);
        let _ = delete_task(runner, &task_id).await;
        self.created_task_ids.retain(|id| id != &task_id);

        let _ = delete_project(runner, &project_id).await?;
        self.created_project_ids.retain(|id| id != &project_id);
        Ok(())
    }

    async fn cleanup<R: JxaRunner>(&mut self, runner: &R) {
        for task_id in self.created_task_ids.clone() {
            let _ = delete_task(runner, &task_id).await;
        }
        self.created_task_ids.clear();

        for project_id in self.created_project_ids.clone() {
            let _ = delete_project(runner, &project_id).await;
        }
        self.created_project_ids.clear();

        for folder_id in self.created_folder_ids.clone() {
            let _ = delete_folder(runner, &folder_id).await;
        }
        self.created_folder_ids.clear();

        for tag_id in self.created_tag_ids.clone() {
            let _ = delete_tag(runner, &tag_id).await;
        }
        self.created_tag_ids.clear();
    }

    async fn run<R: JxaRunner>(&mut self, runner: &R) -> i32 {
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
    let runner = SmokeJxaRunner;
    let mut smoke_test = SmokeTest::new();
    let exit_code = smoke_test.run(&runner).await;
    std::process::exit(exit_code);
}
