use crate::{
    error::Result,
    jxa::JxaRunner,
    tools::{forecast::get_forecast, projects::list_projects, tasks::get_inbox},
};

pub const INBOX_RESOURCE_URI: &str = "omnifocus://inbox";
pub const TODAY_RESOURCE_URI: &str = "omnifocus://today";
pub const PROJECTS_RESOURCE_URI: &str = "omnifocus://projects";

pub async fn inbox_resource<R: JxaRunner>(runner: &R) -> Result<String> {
    let tasks = get_inbox(runner, 100).await?;
    Ok(serde_json::to_string(&tasks)?)
}

pub async fn today_resource<R: JxaRunner>(runner: &R) -> Result<String> {
    let forecast = get_forecast(runner, 100).await?;
    Ok(serde_json::to_string(&forecast)?)
}

pub async fn projects_resource<R: JxaRunner>(runner: &R) -> Result<String> {
    let projects = list_projects(runner, None, "active", None, None, false, None, "asc", 100).await?;
    Ok(serde_json::to_string(&projects)?)
}
