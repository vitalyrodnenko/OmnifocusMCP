use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TaskResult {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub flagged: bool,
    #[serde(default)]
    pub completed: bool,
    #[serde(rename = "projectName", alias = "project", default)]
    pub project: Option<String>,
    #[serde(rename = "dueDate", alias = "due_date", default)]
    pub due_date: Option<String>,
    #[serde(rename = "deferDate", alias = "defer_date", default)]
    pub defer_date: Option<String>,
    #[serde(rename = "completionDate", alias = "completion_date", default)]
    pub completion_date: Option<String>,
    #[serde(rename = "plannedDate", alias = "planned_date", default)]
    pub planned_date: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "estimatedMinutes", alias = "estimated_minutes", default)]
    pub estimated_minutes: Option<i32>,
    #[serde(rename = "inInbox", alias = "in_inbox", default)]
    pub in_inbox: bool,
    #[serde(rename = "hasChildren", alias = "has_children", default)]
    pub has_children: bool,
    #[serde(rename = "taskStatus", alias = "task_status", default)]
    pub task_status: String,
    #[serde(default)]
    pub sequential: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProjectResult {
    pub id: String,
    pub name: String,
    pub status: String,
    pub note: Option<String>,
    pub folder: Option<String>,
    pub due_date: Option<String>,
    pub defer_date: Option<String>,
    pub completion_date: Option<String>,
    pub sequential: bool,
    pub number_available: Option<i32>,
    pub number_remaining: Option<i32>,
    pub flagged: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TagResult {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub available_task_count: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FolderResult {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TaskCountsResult {
    pub total: i32,
    pub available: i32,
    pub completed: i32,
    pub overdue: i32,
    #[serde(rename = "dueSoon")]
    pub due_soon: i32,
    pub flagged: i32,
    pub deferred: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProjectCountsResult {
    pub total: i32,
    pub active: i32,
    #[serde(rename = "onHold")]
    pub on_hold: i32,
    pub completed: i32,
    pub dropped: i32,
    pub stalled: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ForecastDay {
    pub date: String,
    pub task_count: i32,
    pub tasks: Vec<TaskResult>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PerspectiveResult {
    pub id: String,
    pub name: String,
}
