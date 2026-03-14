use rmcp::{
    handler::server::{
        router::{prompt::PromptRouter, tool::ToolRouter},
        wrapper::Parameters,
    },
    model::{
        CallToolResult, Content, GetPromptRequestParams, GetPromptResult, ListPromptsResult,
        ListResourcesResult, PaginatedRequestParams, PromptMessage, PromptMessageRole, RawResource,
        ReadResourceRequestParams, ReadResourceResult, ResourceContents, ServerCapabilities,
        ServerInfo,
    },
    prompt, prompt_handler, prompt_router, tool, tool_handler, tool_router, ErrorData as McpError,
    ServerHandler,
};
use rmcp::{service::RequestContext, RoleServer};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    error::OmniFocusError,
    jxa::JxaRunner,
    prompts::{daily_review, inbox_processing, project_planning, weekly_review},
    resources::{
        inbox_resource, projects_resource, today_resource, INBOX_RESOURCE_URI,
        PROJECTS_RESOURCE_URI, TODAY_RESOURCE_URI,
    },
    tools::{
        folders::{
            create_folder, delete_folder as delete_folder_tool,
            delete_folders_batch as delete_folders_batch_tool, get_folder, list_folders,
            update_folder as update_folder_tool,
        },
        forecast::get_forecast,
        perspectives::list_perspectives,
        projects::{
            complete_project, create_project, delete_project, delete_projects_batch, get_project,
            get_project_counts, list_projects, move_project, search_projects, set_project_status,
            uncomplete_project, update_project,
        },
        tags::{create_tag, delete_tag, delete_tags_batch, list_tags, search_tags, update_tag},
        tasks::{
            add_notification, complete_task, create_subtask, create_task, create_tasks_batch,
            delete_task, delete_tasks_batch, duplicate_task, get_inbox, get_task,
            get_task_counts_with_added_changed, list_notifications, list_subtasks,
            list_tasks_with_added_changed, move_task, move_tasks_batch, remove_notification,
            search_tasks_with_added_changed, set_task_repetition, uncomplete_task, update_task,
            CreateTaskInput,
        },
        utility::append_to_note as append_to_note_tool,
    },
};

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct LimitParams {
    limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct ListTasksParams {
    project: Option<String>,
    tag: Option<String>,
    tags: Option<Vec<String>>,
    #[serde(rename = "tagFilterMode")]
    tag_filter_mode: Option<String>,
    flagged: Option<bool>,
    status: Option<String>,
    #[serde(rename = "dueBefore")]
    due_before: Option<String>,
    #[serde(rename = "dueAfter")]
    due_after: Option<String>,
    #[serde(rename = "deferBefore")]
    defer_before: Option<String>,
    #[serde(rename = "deferAfter")]
    defer_after: Option<String>,
    #[serde(rename = "completedBefore")]
    completed_before: Option<String>,
    #[serde(rename = "completedAfter")]
    completed_after: Option<String>,
    added_after: Option<String>,
    added_before: Option<String>,
    changed_after: Option<String>,
    changed_before: Option<String>,
    #[serde(rename = "plannedBefore")]
    planned_before: Option<String>,
    #[serde(rename = "plannedAfter")]
    planned_after: Option<String>,
    #[serde(rename = "maxEstimatedMinutes")]
    max_estimated_minutes: Option<i32>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<String>,
    limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct GetTaskCountsParams {
    project: Option<String>,
    tag: Option<String>,
    tags: Option<Vec<String>>,
    #[serde(rename = "tagFilterMode")]
    tag_filter_mode: Option<String>,
    flagged: Option<bool>,
    #[serde(rename = "dueBefore")]
    due_before: Option<String>,
    #[serde(rename = "dueAfter")]
    due_after: Option<String>,
    #[serde(rename = "deferBefore")]
    defer_before: Option<String>,
    #[serde(rename = "deferAfter")]
    defer_after: Option<String>,
    #[serde(rename = "completedBefore")]
    completed_before: Option<String>,
    #[serde(rename = "completedAfter")]
    completed_after: Option<String>,
    added_after: Option<String>,
    added_before: Option<String>,
    changed_after: Option<String>,
    changed_before: Option<String>,
    #[serde(rename = "plannedBefore")]
    planned_before: Option<String>,
    #[serde(rename = "plannedAfter")]
    planned_after: Option<String>,
    #[serde(rename = "maxEstimatedMinutes")]
    max_estimated_minutes: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct TaskIdParams {
    task_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct TaskIdLimitParams {
    task_id: String,
    limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct AddNotificationParams {
    task_id: String,
    #[serde(rename = "absoluteDate")]
    absolute_date: Option<String>,
    #[serde(rename = "relativeOffset")]
    relative_offset: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct DuplicateTaskParams {
    task_id: String,
    #[serde(rename = "includeChildren")]
    include_children: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct RemoveNotificationParams {
    task_id: String,
    notification_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct SearchTasksParams {
    query: String,
    project: Option<String>,
    tag: Option<String>,
    tags: Option<Vec<String>>,
    #[serde(rename = "tagFilterMode")]
    tag_filter_mode: Option<String>,
    flagged: Option<bool>,
    status: Option<String>,
    #[serde(rename = "dueBefore")]
    due_before: Option<String>,
    #[serde(rename = "dueAfter")]
    due_after: Option<String>,
    #[serde(rename = "deferBefore")]
    defer_before: Option<String>,
    #[serde(rename = "deferAfter")]
    defer_after: Option<String>,
    #[serde(rename = "completedBefore")]
    completed_before: Option<String>,
    #[serde(rename = "completedAfter")]
    completed_after: Option<String>,
    added_after: Option<String>,
    added_before: Option<String>,
    changed_after: Option<String>,
    changed_before: Option<String>,
    #[serde(rename = "maxEstimatedMinutes")]
    max_estimated_minutes: Option<i32>,
    #[serde(rename = "plannedBefore")]
    planned_before: Option<String>,
    #[serde(rename = "plannedAfter")]
    planned_after: Option<String>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<String>,
    limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct CreateTaskParams {
    name: String,
    project: Option<String>,
    note: Option<String>,
    due_date: Option<String>,
    defer_date: Option<String>,
    flagged: Option<bool>,
    tags: Option<Vec<String>>,
    estimated_minutes: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct CreateSubtaskParams {
    name: String,
    parent_task_id: String,
    note: Option<String>,
    #[serde(rename = "dueDate")]
    due_date: Option<String>,
    #[serde(rename = "deferDate")]
    defer_date: Option<String>,
    flagged: Option<bool>,
    tags: Option<Vec<String>>,
    #[serde(rename = "estimatedMinutes")]
    estimated_minutes: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct CreateTasksBatchParams {
    tasks: Vec<BatchCreateTaskInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct BatchCreateTaskInput {
    name: String,
    project: Option<String>,
    note: Option<String>,
    due_date: Option<String>,
    defer_date: Option<String>,
    flagged: Option<bool>,
    tags: Option<Vec<String>>,
    estimated_minutes: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct UpdateTaskParams {
    task_id: String,
    name: Option<String>,
    note: Option<String>,
    due_date: Option<String>,
    defer_date: Option<String>,
    flagged: Option<bool>,
    tags: Option<Vec<String>>,
    estimated_minutes: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct MoveTaskParams {
    task_id: String,
    project: Option<String>,
    parent_task_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct MoveTasksBatchParams {
    task_ids: Vec<String>,
    project: Option<String>,
    parent_task_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct AppendToNoteParams {
    object_type: String,
    object_id: String,
    text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct DeleteTasksBatchParams {
    task_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct SetTaskRepetitionParams {
    task_id: String,
    rule_string: Option<String>,
    schedule_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct ListProjectsParams {
    folder: Option<String>,
    status: Option<String>,
    #[serde(rename = "completedBefore")]
    completed_before: Option<String>,
    #[serde(rename = "completedAfter")]
    completed_after: Option<String>,
    #[serde(rename = "stalledOnly")]
    stalled_only: Option<bool>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<String>,
    limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct GetProjectCountsParams {
    folder: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct SearchProjectsParams {
    query: String,
    limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct SearchTagsParams {
    query: String,
    limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct ListTagsParams {
    #[serde(rename = "statusFilter")]
    status_filter: Option<String>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<String>,
    limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct ProjectIdOrNameParams {
    project_id_or_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct DeleteProjectsBatchParams {
    project_ids_or_names: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct MoveProjectParams {
    project_id_or_name: String,
    folder: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct SetProjectStatusParams {
    project_id_or_name: String,
    status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct CreateProjectParams {
    name: String,
    folder: Option<String>,
    note: Option<String>,
    #[serde(rename = "dueDate")]
    due_date: Option<String>,
    #[serde(rename = "deferDate")]
    defer_date: Option<String>,
    sequential: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct UpdateProjectParams {
    project_id_or_name: String,
    name: Option<String>,
    note: Option<String>,
    #[serde(rename = "dueDate")]
    due_date: Option<String>,
    #[serde(rename = "deferDate")]
    defer_date: Option<String>,
    flagged: Option<bool>,
    tags: Option<Vec<String>>,
    sequential: Option<bool>,
    #[serde(rename = "completedByChildren")]
    completed_by_children: Option<bool>,
    #[serde(rename = "reviewInterval")]
    review_interval: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct CreateTagParams {
    name: String,
    parent: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct CreateFolderParams {
    name: String,
    parent: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct FolderNameOrIdParams {
    folder_name_or_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct UpdateFolderParams {
    folder_name_or_id: String,
    name: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct UpdateTagParams {
    tag_name_or_id: String,
    name: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct TagNameOrIdParams {
    tag_name_or_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct DeleteTagsBatchParams {
    tag_ids_or_names: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct DeleteFoldersBatchParams {
    folder_ids_or_names: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct ProjectPlanningPromptParams {
    project: String,
}

#[derive(Clone)]
pub struct OmniFocusServer<R: JxaRunner + Send + Sync + 'static> {
    runner: Arc<R>,
    runner_dyn: Arc<dyn JxaRunner>,
    tool_router: ToolRouter<Self>,
    prompt_router: PromptRouter<Self>,
}

impl<R: JxaRunner + Send + Sync + 'static> OmniFocusServer<R> {
    pub fn new(runner: R) -> Self {
        let runner = Arc::new(runner);
        let runner_dyn: Arc<dyn JxaRunner> = runner.clone();
        Self {
            runner,
            runner_dyn,
            tool_router: Self::tool_router(),
            prompt_router: Self::prompt_router(),
        }
    }
}

fn to_mcp_error(error: OmniFocusError) -> McpError {
    match error {
        OmniFocusError::Validation(message) => McpError::invalid_params(message, None),
        _ => McpError::internal_error(error.to_string(), None),
    }
}

fn as_call_tool_result<T: Serialize>(value: &T) -> std::result::Result<CallToolResult, McpError> {
    let text = serde_json::to_string(value)
        .map_err(|error| McpError::internal_error(error.to_string(), None))?;
    Ok(CallToolResult::success(vec![Content::text(text)]))
}

#[tool_router(router = tool_router)]
impl<R: JxaRunner + Send + Sync + 'static> OmniFocusServer<R> {
    #[tool(description = "get inbox tasks from omnifocus.")]
    async fn get_inbox(
        &self,
        Parameters(params): Parameters<LimitParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = get_inbox(self.runner.as_ref(), params.limit.unwrap_or(100))
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "list tasks with optional filters. added_* and changed_* filters must be ISO 8601 date strings; changed means the task's last modified timestamp."
    )]
    async fn list_tasks(
        &self,
        Parameters(params): Parameters<ListTasksParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let ListTasksParams {
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
            added_after,
            added_before,
            changed_after,
            changed_before,
            max_estimated_minutes,
            planned_before,
            planned_after,
            sort_by,
            sort_order,
            limit,
        } = params;
        let result = list_tasks_with_added_changed(
            self.runner.as_ref(),
            project.as_deref(),
            tag.as_deref(),
            tags,
            tag_filter_mode.as_deref().unwrap_or("any"),
            flagged,
            status.as_deref().unwrap_or("available"),
            due_before.as_deref(),
            due_after.as_deref(),
            defer_before.as_deref(),
            defer_after.as_deref(),
            completed_before.as_deref(),
            completed_after.as_deref(),
            added_after.as_deref(),
            added_before.as_deref(),
            changed_after.as_deref(),
            changed_before.as_deref(),
            planned_before.as_deref(),
            planned_after.as_deref(),
            max_estimated_minutes,
            sort_by.as_deref(),
            sort_order.as_deref().unwrap_or("asc"),
            limit.unwrap_or(100),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "get aggregate task counts for any filter combination without listing individual tasks. added_* and changed_* filters must be ISO 8601 date strings; changed means the task's last modified timestamp. much faster than list_tasks for answering 'how many' questions."
    )]
    async fn get_task_counts(
        &self,
        Parameters(params): Parameters<GetTaskCountsParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = get_task_counts_with_added_changed(
            self.runner.as_ref(),
            params.project.as_deref(),
            params.tag.as_deref(),
            params.tags,
            params.tag_filter_mode.as_deref().unwrap_or("any"),
            params.flagged,
            params.due_before.as_deref(),
            params.due_after.as_deref(),
            params.defer_before.as_deref(),
            params.defer_after.as_deref(),
            params.completed_before.as_deref(),
            params.completed_after.as_deref(),
            params.added_after.as_deref(),
            params.added_before.as_deref(),
            params.changed_after.as_deref(),
            params.changed_before.as_deref(),
            params.max_estimated_minutes,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "get full details for a task by id.")]
    async fn get_task(
        &self,
        Parameters(params): Parameters<TaskIdParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = get_task(self.runner.as_ref(), &params.task_id)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "list direct subtasks for a task id.")]
    async fn list_subtasks(
        &self,
        Parameters(params): Parameters<TaskIdLimitParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = list_subtasks(
            self.runner.as_ref(),
            &params.task_id,
            params.limit.unwrap_or(100),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "list active notifications for a task by id.")]
    async fn list_notifications(
        &self,
        Parameters(params): Parameters<TaskIdParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = list_notifications(self.runner.as_ref(), &params.task_id)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "add one notification to a task by id.")]
    async fn add_notification(
        &self,
        Parameters(params): Parameters<AddNotificationParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = add_notification(
            self.runner.as_ref(),
            &params.task_id,
            params.absolute_date.as_deref(),
            params.relative_offset,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "duplicate a task with all its properties. if the task has subtasks, they are cloned too by default."
    )]
    async fn duplicate_task(
        &self,
        Parameters(params): Parameters<DuplicateTaskParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = duplicate_task(
            self.runner.as_ref(),
            &params.task_id,
            params.include_children.unwrap_or(true),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "remove one notification from a task by id.")]
    async fn remove_notification(
        &self,
        Parameters(params): Parameters<RemoveNotificationParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = remove_notification(
            self.runner.as_ref(),
            &params.task_id,
            &params.notification_id,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "search tasks by name and note text. added_* and changed_* filters must be ISO 8601 date strings; changed means the task's last modified timestamp."
    )]
    async fn search_tasks(
        &self,
        Parameters(params): Parameters<SearchTasksParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = search_tasks_with_added_changed(
            self.runner.as_ref(),
            &params.query,
            params.project.as_deref(),
            params.tag.as_deref(),
            params.tags,
            params.tag_filter_mode.as_deref().unwrap_or("any"),
            params.flagged,
            params.status.as_deref().unwrap_or("available"),
            params.due_before.as_deref(),
            params.due_after.as_deref(),
            params.defer_before.as_deref(),
            params.defer_after.as_deref(),
            params.completed_before.as_deref(),
            params.completed_after.as_deref(),
            params.added_after.as_deref(),
            params.added_before.as_deref(),
            params.changed_after.as_deref(),
            params.changed_before.as_deref(),
            params.planned_before.as_deref(),
            params.planned_after.as_deref(),
            params.max_estimated_minutes,
            params.sort_by.as_deref(),
            params.sort_order.as_deref().unwrap_or("asc"),
            params.limit.unwrap_or(100),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "create one task in inbox or in a project.")]
    async fn create_task(
        &self,
        Parameters(params): Parameters<CreateTaskParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = create_task(
            self.runner.as_ref(),
            &params.name,
            params.project.as_deref(),
            params.note.as_deref(),
            params.due_date.as_deref(),
            params.defer_date.as_deref(),
            params.flagged,
            params.tags,
            params.estimated_minutes,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "create multiple tasks in one OmniFocus call.")]
    async fn create_tasks_batch(
        &self,
        Parameters(params): Parameters<CreateTasksBatchParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let tasks = params
            .tasks
            .into_iter()
            .map(|task| CreateTaskInput {
                name: task.name,
                project: task.project,
                note: task.note,
                due_date: task.due_date,
                defer_date: task.defer_date,
                flagged: task.flagged,
                tags: task.tags,
                estimated_minutes: task.estimated_minutes,
            })
            .collect();
        let result = create_tasks_batch(self.runner.as_ref(), tasks)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "create a subtask under an existing parent task by id.")]
    async fn create_subtask(
        &self,
        Parameters(params): Parameters<CreateSubtaskParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = create_subtask(
            self.runner.as_ref(),
            &params.name,
            &params.parent_task_id,
            params.note.as_deref(),
            params.due_date.as_deref(),
            params.defer_date.as_deref(),
            params.flagged,
            params.tags,
            params.estimated_minutes,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "mark a task complete by id.")]
    async fn complete_task(
        &self,
        Parameters(params): Parameters<TaskIdParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = complete_task(self.runner.as_ref(), &params.task_id)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "mark a completed task incomplete by id.")]
    async fn uncomplete_task(
        &self,
        Parameters(params): Parameters<TaskIdParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = uncomplete_task(self.runner.as_ref(), &params.task_id)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "set or clear a task repetition rule by id.")]
    async fn set_task_repetition(
        &self,
        Parameters(params): Parameters<SetTaskRepetitionParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = set_task_repetition(
            self.runner.as_ref(),
            &params.task_id,
            params.rule_string.as_deref(),
            params.schedule_type.as_deref().unwrap_or("regularly"),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "update fields on an existing task.")]
    async fn update_task(
        &self,
        Parameters(params): Parameters<UpdateTaskParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = update_task(
            self.runner.as_ref(),
            &params.task_id,
            params.name.as_deref(),
            params.note.as_deref(),
            params.due_date.as_deref(),
            params.defer_date.as_deref(),
            params.flagged,
            params.tags,
            params.estimated_minutes,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "delete a task by id. destructive operation: use update_task or move_task for edits/reorganization, and never delete then recreate as a substitute for updating. ask for explicit user confirmation before proceeding."
    )]
    async fn delete_task(
        &self,
        Parameters(params): Parameters<TaskIdParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = delete_task(self.runner.as_ref(), &params.task_id)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "delete multiple tasks by id in a single omnijs call. destructive operation: never use batch delete as a shortcut for edits or reorganization. use update_task/move_task instead when preserving history matters. before calling this tool, always show the user the list of tasks to be deleted and ask for explicit confirmation. do not proceed without user approval."
    )]
    async fn delete_tasks_batch(
        &self,
        Parameters(params): Parameters<DeleteTasksBatchParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = delete_tasks_batch(self.runner.as_ref(), params.task_ids)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "move a task without deleting or recreating it. destination modes: (a) provide project to move to a project, (b) provide parent_task_id to move under an existing parent task, or (c) omit both to move to inbox. move_task preserves the original task object and id by default, and delete is never required for reorganization."
    )]
    async fn move_task(
        &self,
        Parameters(params): Parameters<MoveTaskParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = move_task(
            self.runner.as_ref(),
            &params.task_id,
            params.project.as_deref(),
            params.parent_task_id.as_deref(),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "move multiple tasks without deleting or recreating them. destination modes: (a) provide project to move tasks to a project, (b) provide parent_task_id to move tasks under an existing parent task, or (c) omit both to move tasks to inbox. runs as one omnijs call per invocation and returns per-task move results. destructive delete confirmation remains a separate workflow."
    )]
    async fn move_tasks_batch(
        &self,
        Parameters(params): Parameters<MoveTasksBatchParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = move_tasks_batch(
            self.runner.as_ref(),
            params.task_ids,
            params.project.as_deref(),
            params.parent_task_id.as_deref(),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "append text to a task or project note by object id.")]
    async fn append_to_note(
        &self,
        Parameters(params): Parameters<AppendToNoteParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = append_to_note_tool(
            self.runner.as_ref(),
            &params.object_type,
            &params.object_id,
            &params.text,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "list projects with status and folder filters. status semantics: completed means finished work (done), dropped means intentionally abandoned/not-doing, on_hold means paused, active means current."
    )]
    async fn list_projects(
        &self,
        Parameters(params): Parameters<ListProjectsParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = list_projects(
            self.runner.as_ref(),
            params.folder.as_deref(),
            params.status.as_deref().unwrap_or("active"),
            params.completed_before.as_deref(),
            params.completed_after.as_deref(),
            params.stalled_only.unwrap_or(false),
            params.sort_by.as_deref(),
            params.sort_order.as_deref().unwrap_or("asc"),
            params.limit.unwrap_or(100),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "get aggregate project counts by status without listing individual projects."
    )]
    async fn get_project_counts(
        &self,
        Parameters(params): Parameters<GetProjectCountsParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = get_project_counts(self.runner.as_ref(), params.folder.as_deref())
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "search projects by name text using omnifocus fuzzy matching.")]
    async fn search_projects(
        &self,
        Parameters(params): Parameters<SearchProjectsParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = search_projects(
            self.runner.as_ref(),
            &params.query,
            params.limit.unwrap_or(100),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "get a project by id or by exact name.")]
    async fn get_project(
        &self,
        Parameters(params): Parameters<ProjectIdOrNameParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = get_project(self.runner.as_ref(), &params.project_id_or_name)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "create a project with optional metadata.")]
    async fn create_project(
        &self,
        Parameters(params): Parameters<CreateProjectParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = create_project(
            self.runner.as_ref(),
            &params.name,
            params.folder.as_deref(),
            params.note.as_deref(),
            params.due_date.as_deref(),
            params.defer_date.as_deref(),
            params.sequential,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "mark a project complete by id or name. use this for finished/closed projects (done/completed), not set_project_status(\"dropped\")."
    )]
    async fn complete_project(
        &self,
        Parameters(params): Parameters<ProjectIdOrNameParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = complete_project(self.runner.as_ref(), &params.project_id_or_name)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "mark a completed project incomplete by id or name (reopen done work back to active)."
    )]
    async fn uncomplete_project(
        &self,
        Parameters(params): Parameters<ProjectIdOrNameParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = uncomplete_project(self.runner.as_ref(), &params.project_id_or_name)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "delete a project by id or name. IMPORTANT: this permanently removes the project and all its tasks from the database. never use delete+recreate to apply project changes; use update_project/move_project/set_project_status instead. before calling, show the user the project name and task count, and ask for explicit confirmation."
    )]
    async fn delete_project(
        &self,
        Parameters(params): Parameters<ProjectIdOrNameParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = delete_project(self.runner.as_ref(), &params.project_id_or_name)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "delete multiple projects by id or exact name in a single omnijs call. destructive operation: this permanently removes each matched project and its tasks. use update_project, move_project, or set_project_status for non-destructive changes. before calling, always show the user which projects are targeted and ask for explicit confirmation."
    )]
    async fn delete_projects_batch(
        &self,
        Parameters(params): Parameters<DeleteProjectsBatchParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = delete_projects_batch(self.runner.as_ref(), params.project_ids_or_names)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "move a project by id or name to a folder or top level.")]
    async fn move_project(
        &self,
        Parameters(params): Parameters<MoveProjectParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = move_project(
            self.runner.as_ref(),
            &params.project_id_or_name,
            params.folder.as_deref(),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "update a project by id or name, modifying only provided fields.")]
    async fn update_project(
        &self,
        Parameters(params): Parameters<UpdateProjectParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = update_project(
            self.runner.as_ref(),
            &params.project_id_or_name,
            params.name.as_deref(),
            params.note.as_deref(),
            params.due_date.as_deref(),
            params.defer_date.as_deref(),
            params.flagged,
            params.tags,
            params.sequential,
            params.completed_by_children,
            params.review_interval.as_deref(),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "set a project's organizational status by id or name. allowed values: active, on_hold, dropped. semantics: dropped means intentionally abandoned/cancelled (not completed); for finished/closed projects use complete_project instead. when presenting planned/finished changes to users, prefer business-meaning labels (project name, folder, current->target status) and include raw ids only as secondary references."
    )]
    async fn set_project_status(
        &self,
        Parameters(params): Parameters<SetProjectStatusParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = set_project_status(
            self.runner.as_ref(),
            &params.project_id_or_name,
            &params.status,
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "search tags by name text using omnifocus fuzzy matching.")]
    async fn search_tags(
        &self,
        Parameters(params): Parameters<SearchTagsParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = search_tags(
            self.runner.as_ref(),
            &params.query,
            params.limit.unwrap_or(100),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "list tags.")]
    async fn list_tags(
        &self,
        Parameters(params): Parameters<ListTagsParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = list_tags(
            self.runner.as_ref(),
            params.status_filter.as_deref().unwrap_or("all"),
            params.sort_by.as_deref(),
            params.sort_order.as_deref().unwrap_or("asc"),
            params.limit.unwrap_or(100),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "create a tag with optional parent tag.")]
    async fn create_tag(
        &self,
        Parameters(params): Parameters<CreateTagParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = create_tag(self.runner.as_ref(), &params.name, params.parent.as_deref())
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "update a tag by id or name.")]
    async fn update_tag(
        &self,
        Parameters(params): Parameters<UpdateTagParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = update_tag(
            self.runner.as_ref(),
            &params.tag_name_or_id,
            params.name.as_deref(),
            params.status.as_deref(),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "delete a tag by id or name. warning: tasks using this tag will lose the tag assignment."
    )]
    async fn delete_tag(
        &self,
        Parameters(params): Parameters<TagNameOrIdParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = delete_tag(self.runner.as_ref(), &params.tag_name_or_id)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "delete multiple tags by id or exact name in a single omnijs call. destructive operation: this removes tags and unassigns them from linked tasks. use update_tag for non-destructive edits. before calling, always show the user which tags are targeted and ask for explicit confirmation."
    )]
    async fn delete_tags_batch(
        &self,
        Parameters(params): Parameters<DeleteTagsBatchParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = delete_tags_batch(self.runner.as_ref(), params.tag_ids_or_names)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "list folders.")]
    async fn list_folders(
        &self,
        Parameters(params): Parameters<LimitParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = list_folders(self.runner.as_ref(), params.limit.unwrap_or(100))
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "create a folder with optional parent folder.")]
    async fn create_folder(
        &self,
        Parameters(params): Parameters<CreateFolderParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = create_folder(self.runner.as_ref(), &params.name, params.parent.as_deref())
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "get a folder by id or name with direct child projects and subfolders.")]
    async fn get_folder(
        &self,
        Parameters(params): Parameters<FolderNameOrIdParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = get_folder(self.runner.as_ref(), &params.folder_name_or_id)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "update a folder by id or name.")]
    async fn update_folder(
        &self,
        Parameters(params): Parameters<UpdateFolderParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = update_folder_tool(
            self.runner.as_ref(),
            &params.folder_name_or_id,
            params.name.as_deref(),
            params.status.as_deref(),
        )
        .await
        .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "delete a folder by id or name. warning: this permanently removes the folder. do not use delete+recreate for folder edits or renames; use update_folder instead. contained projects may be moved to top level by omnifocus, so confirm with the user before proceeding."
    )]
    async fn delete_folder(
        &self,
        Parameters(params): Parameters<FolderNameOrIdParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = delete_folder_tool(self.runner.as_ref(), &params.folder_name_or_id)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "delete multiple folders by id or exact name in a single omnijs call. destructive operation: this permanently removes folders and may move contained projects depending on omnifocus behavior. use update_folder for non-destructive edits. before calling, always show the user which folders are targeted and ask for explicit confirmation."
    )]
    async fn delete_folders_batch(
        &self,
        Parameters(params): Parameters<DeleteFoldersBatchParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = delete_folders_batch_tool(self.runner.as_ref(), params.folder_ids_or_names)
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(
        description = "get forecast sections for overdue, due today, flagged, deferred, and due-this-week tasks."
    )]
    async fn get_forecast(
        &self,
        Parameters(params): Parameters<LimitParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = get_forecast(self.runner.as_ref(), params.limit.unwrap_or(100))
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }

    #[tool(description = "list available perspectives.")]
    async fn list_perspectives(
        &self,
        Parameters(params): Parameters<LimitParams>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let result = list_perspectives(self.runner.as_ref(), params.limit.unwrap_or(100))
            .await
            .map_err(to_mcp_error)?;
        as_call_tool_result(&result)
    }
}

#[prompt_router]
impl<R: JxaRunner + Send + Sync + 'static> OmniFocusServer<R> {
    #[prompt(description = "daily planning prompt with due-soon, overdue, and flagged tasks.")]
    async fn daily_review(&self) -> std::result::Result<Vec<PromptMessage>, McpError> {
        let text = daily_review(self.runner.as_ref())
            .await
            .map_err(to_mcp_error)?;
        Ok(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
    }

    #[prompt(description = "weekly review prompt with active projects and next-action coverage.")]
    async fn weekly_review(&self) -> std::result::Result<Vec<PromptMessage>, McpError> {
        let text = weekly_review(self.runner.as_ref())
            .await
            .map_err(to_mcp_error)?;
        Ok(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
    }

    #[prompt(
        description = "inbox processing prompt that drives one-by-one clarification decisions."
    )]
    async fn inbox_processing(&self) -> std::result::Result<Vec<PromptMessage>, McpError> {
        let text = inbox_processing(self.runner.as_ref())
            .await
            .map_err(to_mcp_error)?;
        Ok(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
    }

    #[prompt(
        description = "project planning prompt that turns a project into actionable next steps."
    )]
    async fn project_planning(
        &self,
        Parameters(params): Parameters<ProjectPlanningPromptParams>,
    ) -> std::result::Result<Vec<PromptMessage>, McpError> {
        let text = project_planning(self.runner.as_ref(), &params.project)
            .await
            .map_err(to_mcp_error)?;
        Ok(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
    }
}

#[tool_handler(router = self.tool_router)]
#[prompt_handler(router = self.prompt_router)]
impl<R: JxaRunner + Send + Sync + 'static> ServerHandler for OmniFocusServer<R> {
    fn get_info(&self) -> ServerInfo {
        let _ = &self.runner_dyn;
        ServerInfo {
            instructions: Some(
                "OmniFocus MCP server exposing tools, resources, and prompts. treat conversations as active omnifocus workflows: ground responses in omnifocus data, engage users with concise clarifying questions when needed, propose concrete next actions, and offer to apply approved changes via tool calls. communicate at business-meaning level first: show object names and context (project/folder/status/counts), and use raw ids only as secondary references. project lifecycle semantics: complete_project is for finished/closed work; set_project_status(\"dropped\") means intentionally abandoned/cancelled; set_project_status(\"on_hold\") means paused. for user-requested changes, preserve existing objects by default and prefer update/move tools; never delete and recreate tasks/projects/folders as a shortcut unless the user explicitly asks for deletion. ask explicit confirmation before destructive operations and report resulting object ids after writes."
                    .to_string(),
            ),
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
            ..Default::default()
        }
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> std::result::Result<ListResourcesResult, McpError> {
        use rmcp::model::AnnotateAble;

        Ok(ListResourcesResult::with_all_items(vec![
            RawResource::new(INBOX_RESOURCE_URI, "Inbox tasks").no_annotation(),
            RawResource::new(TODAY_RESOURCE_URI, "Today forecast").no_annotation(),
            RawResource::new(PROJECTS_RESOURCE_URI, "Active projects").no_annotation(),
        ]))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> std::result::Result<ReadResourceResult, McpError> {
        let uri = request.uri;
        let content = match uri.as_str() {
            INBOX_RESOURCE_URI => inbox_resource(self.runner.as_ref())
                .await
                .map_err(to_mcp_error)?,
            TODAY_RESOURCE_URI => today_resource(self.runner.as_ref())
                .await
                .map_err(to_mcp_error)?,
            PROJECTS_RESOURCE_URI => projects_resource(self.runner.as_ref())
                .await
                .map_err(to_mcp_error)?,
            _ => {
                return Err(McpError::invalid_params(
                    format!("Unknown resource URI: {uri}"),
                    None,
                ));
            }
        };

        Ok(ReadResourceResult {
            contents: vec![ResourceContents::text(content, uri)],
        })
    }
}
