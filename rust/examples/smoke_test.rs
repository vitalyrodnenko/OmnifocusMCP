use std::time::{SystemTime, UNIX_EPOCH};

use omnifocus_mcp::{
    error::{OmniFocusError, Result},
    jxa::{JxaRunner, RealJxaRunner},
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

    async fn check_bridge(&mut self, runner: &RealJxaRunner) -> Result<()> {
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
        let task_id = if let Some(first) = tasks.first() {
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

        let task_value = get_task(runner, &task_id).await?;
        let task_obj = require_object(&task_value, "get_task result")?;
        self.require_keys(
            task_obj,
            &["id", "name", "completed", "tags", "children", "sequential"],
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
            .await?;
            let created_id = require_string_key(&created, "id", "create_project fallback result")?;
            self.created_project_ids.push(created_id.to_string());
            created_id.to_string()
        };
        let _ = get_project(runner, &project_id).await?;

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
        let project_id =
            require_string_key(&created_project, "id", "create_project result")?.to_string();
        self.created_project_ids.push(project_id.clone());

        let folder_name = self.unique_name("smoke folder");
        let created_folder = create_folder(runner, &folder_name, None).await?;
        let folder_id =
            require_string_key(&created_folder, "id", "create_folder result")?.to_string();
        self.created_folder_ids.push(folder_id.clone());

        let moved_project = move_project(runner, &project_id, Some(&folder_name)).await?;
        let moved_project_folder_name = moved_project
            .get("folderName")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OmniFocusError::Validation(
                    "move_project did not return folderName after moving to folder.".to_string(),
                )
            })?;
        if moved_project_folder_name != folder_name {
            return Err(OmniFocusError::Validation(
                "move_project did not move project into the requested folder.".to_string(),
            ));
        }

        let updated_folder_name = self.unique_name("smoke folder updated");
        let updated_folder = update_folder(
            runner,
            &folder_id,
            Some(&updated_folder_name),
            Some("active"),
        )
        .await?;
        let returned_folder_name =
            require_string_key(&updated_folder, "name", "update_folder result")?;
        if returned_folder_name != updated_folder_name {
            return Err(OmniFocusError::Validation(
                "update_folder did not return the new folder name.".to_string(),
            ));
        }
        let _ = get_folder(runner, &folder_id).await?;

        let tag_name = self.unique_name("smoke tag");
        let created_tag = create_tag(runner, &tag_name, None).await?;
        let tag_id = require_string_key(&created_tag, "id", "create_tag result")?.to_string();
        self.created_tag_ids.push(tag_id.clone());

        let updated_tag_name = self.unique_name("smoke tag updated");
        let updated_tag =
            update_tag(runner, &tag_id, Some(&updated_tag_name), Some("on_hold")).await?;
        let returned_tag_name = require_string_key(&updated_tag, "name", "update_tag result")?;
        if returned_tag_name != updated_tag_name {
            return Err(OmniFocusError::Validation(
                "update_tag did not return the new tag name.".to_string(),
            ));
        }
        let searched_tags = search_tags(runner, &updated_tag_name, 20).await?;
        let searched_tags_array = require_array(&searched_tags, "search_tags result")?;
        if searched_tags_array.is_empty() {
            return Err(OmniFocusError::Validation(
                "search_tags did not return the created tag.".to_string(),
            ));
        }

        let updated_project_name = self.unique_name("smoke project updated");
        let updated_project = update_project(
            runner,
            &project_id,
            Some(&updated_project_name),
            Some("updated by rust smoke test"),
            None,
            None,
            Some(true),
            Some(vec![updated_tag_name.clone()]),
            Some(false),
            Some(false),
            None,
        )
        .await?;
        let returned_project_name =
            require_string_key(&updated_project, "name", "update_project result")?;
        if returned_project_name != updated_project_name {
            return Err(OmniFocusError::Validation(
                "update_project did not return the new project name.".to_string(),
            ));
        }

        let on_hold_project = set_project_status(runner, &project_id, "on_hold").await?;
        if on_hold_project["status"] != "on_hold" {
            return Err(OmniFocusError::Validation(
                "set_project_status did not set on_hold status.".to_string(),
            ));
        }
        let active_project = set_project_status(runner, &project_id, "active").await?;
        if active_project["status"] != "active" {
            return Err(OmniFocusError::Validation(
                "set_project_status did not set active status.".to_string(),
            ));
        }

        let searched_projects = search_projects(runner, &updated_project_name, 20).await?;
        let searched_projects_array = require_array(&searched_projects, "search_projects result")?;
        if searched_projects_array.is_empty() {
            return Err(OmniFocusError::Validation(
                "search_projects did not return the updated project.".to_string(),
            ));
        }

        let created_task = create_task(
            runner,
            &self.unique_name("smoke task"),
            Some(&updated_project_name),
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

        let _ = move_task(runner, &task_id, Some(&updated_project_name)).await?;
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

        let _ = complete_task(runner, &task_id).await?;
        let uncompleted_task = uncomplete_task(runner, &task_id).await?;
        if uncompleted_task["completed"] != false {
            return Err(OmniFocusError::Validation(
                "uncomplete_task did not return completed=false.".to_string(),
            ));
        }

        let repetition_set =
            set_task_repetition(runner, &task_id, Some("FREQ=WEEKLY"), "regularly").await?;
        if repetition_set["repetitionRule"].is_null() {
            return Err(OmniFocusError::Validation(
                "set_task_repetition did not set a repetition rule.".to_string(),
            ));
        }
        let repetition_cleared = set_task_repetition(runner, &task_id, None, "none").await?;
        if !repetition_cleared["repetitionRule"].is_null() {
            return Err(OmniFocusError::Validation(
                "set_task_repetition did not clear the repetition rule.".to_string(),
            ));
        }

        let appended_task = append_to_note(runner, "task", &task_id, "appended from smoke").await?;
        let note_length = appended_task
            .get("noteLength")
            .and_then(Value::as_i64)
            .ok_or_else(|| {
                OmniFocusError::Validation(
                    "append_to_note task result missing noteLength.".to_string(),
                )
            })?;
        if note_length < 1 {
            return Err(OmniFocusError::Validation(
                "append_to_note did not increase task note length.".to_string(),
            ));
        }

        let parent_task = create_task(
            runner,
            &self.unique_name("smoke parent task"),
            Some(&updated_project_name),
            None,
            None,
            None,
            Some(false),
            None,
            None,
        )
        .await?;
        let parent_task_id =
            require_string_key(&parent_task, "id", "create_task parent result")?.to_string();
        self.created_task_ids.push(parent_task_id.clone());

        let child_task = create_subtask(
            runner,
            &self.unique_name("smoke child task"),
            &parent_task_id,
            Some("child task note"),
            None,
            None,
            Some(false),
            None,
            Some(5),
        )
        .await?;
        let child_task_id =
            require_string_key(&child_task, "id", "create_subtask result")?.to_string();
        self.created_task_ids.push(child_task_id.clone());

        let subtasks = list_subtasks(runner, &parent_task_id, 20).await?;
        let subtasks_array = require_array(&subtasks, "list_subtasks result")?;
        let subtask_found = subtasks_array
            .iter()
            .any(|item| item.get("id").and_then(Value::as_str) == Some(child_task_id.as_str()));
        if !subtask_found {
            return Err(OmniFocusError::Validation(
                "list_subtasks did not include the created subtask.".to_string(),
            ));
        }

        let _ = append_to_note(runner, "project", &project_id, "project note append").await?;

        let batch_result = create_tasks_batch(
            runner,
            vec![
                CreateTaskInput {
                    name: self.unique_name("smoke batch task"),
                    project: Some(updated_project_name.clone()),
                    note: Some("created by rust smoke test batch".to_string()),
                    due_date: None,
                    defer_date: None,
                    flagged: Some(false),
                    tags: Some(vec![updated_tag_name.clone()]),
                    estimated_minutes: Some(5),
                },
                CreateTaskInput {
                    name: self.unique_name("smoke batch task"),
                    project: Some(updated_project_name.clone()),
                    note: Some("created by rust smoke test batch".to_string()),
                    due_date: None,
                    defer_date: None,
                    flagged: Some(false),
                    tags: Some(vec![updated_tag_name.clone()]),
                    estimated_minutes: Some(5),
                },
                CreateTaskInput {
                    name: self.unique_name("smoke batch task"),
                    project: Some(updated_project_name.clone()),
                    note: Some("created by rust smoke test batch".to_string()),
                    due_date: None,
                    defer_date: None,
                    flagged: Some(false),
                    tags: Some(vec![updated_tag_name.clone()]),
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
            .ok_or_else(|| {
                OmniFocusError::Validation(
                    "delete_tasks_batch result missing deleted_count.".to_string(),
                )
            })?;
        let not_found_count = delete_result
            .get("not_found_count")
            .and_then(Value::as_i64)
            .ok_or_else(|| {
                OmniFocusError::Validation(
                    "delete_tasks_batch result missing not_found_count.".to_string(),
                )
            })?;
        if deleted_count != 3 || not_found_count != 0 {
            return Err(OmniFocusError::Validation(
                "delete_tasks_batch summary did not confirm deleting all three tasks.".to_string(),
            ));
        }
        for id in batch_ids {
            self.created_task_ids.retain(|existing| existing != &id);
        }

        let _ = move_project(runner, &project_id, None).await?;
        let deleted_folder = delete_folder(runner, &folder_id).await?;
        if deleted_folder["deleted"] != true {
            return Err(OmniFocusError::Validation(
                "delete_folder did not confirm deletion.".to_string(),
            ));
        }
        self.created_folder_ids.retain(|id| id != &folder_id);

        let deleted_tag = delete_tag(runner, &tag_id).await?;
        if deleted_tag["deleted"] != true {
            return Err(OmniFocusError::Validation(
                "delete_tag did not confirm deletion.".to_string(),
            ));
        }
        self.created_tag_ids.retain(|id| id != &tag_id);

        let temp_project_name = self.unique_name("smoke temp project");
        let temp_project = create_project(
            runner,
            &temp_project_name,
            None,
            None,
            None,
            None,
            Some(false),
        )
        .await?;
        let temp_project_id =
            require_string_key(&temp_project, "id", "create_project temp result")?.to_string();
        self.created_project_ids.push(temp_project_id.clone());
        let _ = complete_project(runner, &temp_project_id).await?;
        let uncompleted_project = uncomplete_project(runner, &temp_project_id).await?;
        if uncompleted_project["status"] != "active" {
            return Err(OmniFocusError::Validation(
                "uncomplete_project did not return active status.".to_string(),
            ));
        }

        let deleted_project_name = self.unique_name("smoke delete project");
        let deleted_project_created = create_project(
            runner,
            &deleted_project_name,
            None,
            None,
            None,
            None,
            Some(false),
        )
        .await?;
        let deleted_project_id = require_string_key(
            &deleted_project_created,
            "id",
            "create_project delete result",
        )?
        .to_string();
        self.created_project_ids.push(deleted_project_id.clone());
        let _ = delete_project(runner, &deleted_project_id).await?;
        self.created_project_ids
            .retain(|id| id != &deleted_project_id);
        if get_project(runner, &deleted_project_id).await.is_ok() {
            return Err(OmniFocusError::Validation(
                "delete_project verification failed because get_project still succeeded."
                    .to_string(),
            ));
        }

        let _ = delete_task(runner, &child_task_id).await?;
        self.created_task_ids.retain(|id| id != &child_task_id);
        let _ = delete_task(runner, &parent_task_id).await?;
        self.created_task_ids.retain(|id| id != &parent_task_id);
        let _ = delete_task(runner, &task_id).await?;
        self.created_task_ids.retain(|id| id != &task_id);

        let _ = complete_project(runner, &project_id).await?;
        self.created_project_ids.retain(|id| id != &project_id);
        let _ = complete_project(runner, &temp_project_id).await?;
        self.created_project_ids.retain(|id| id != &temp_project_id);
        Ok(())
    }

    async fn cleanup(&mut self, runner: &RealJxaRunner) {
        for task_id in self.created_task_ids.clone() {
            let _ = delete_task(runner, &task_id).await;
        }
        self.created_task_ids.clear();

        for project_id in self.created_project_ids.clone() {
            let _ = complete_project(runner, &project_id).await;
        }
        self.created_project_ids.clear();

        for folder_id in self.created_folder_ids.clone() {
            let _ = delete_folder(runner, &folder_id).await;
        }
        self.created_folder_ids.clear();

        if !self.created_tag_ids.is_empty() {
            let ids_json = match serde_json::to_string(&self.created_tag_ids) {
                Ok(value) => value,
                Err(_) => {
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
            let _ = runner.run_omnijs(&cleanup_script).await;
            self.created_tag_ids.clear();
        }
    }

    async fn run(&mut self, runner: &RealJxaRunner) -> i32 {
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
