use crate::{
    error::{OmniFocusError, Result},
    jxa::JxaRunner,
    tools::{
        projects::{get_project, list_projects},
        tasks::{get_inbox, list_tasks},
    },
};

pub async fn daily_review<R: JxaRunner>(runner: &R) -> Result<String> {
    let due_soon = list_tasks(
        runner, None, None, None, "any", None, "due_soon", None, None, None, None, None, None,
        None, None, None, None, "asc", 25,
    )
    .await?;
    let overdue = list_tasks(
        runner, None, None, None, "any", None, "overdue", None, None, None, None, None, None, None,
        None, None, "asc", 25,
    )
    .await?;
    let flagged = list_tasks(
        runner,
        None,
        None,
        None,
        "any",
        Some(true),
        "all",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "asc",
        25,
    )
    .await?;

    let due_soon_json = serde_json::to_string(&due_soon)?;
    let overdue_json = serde_json::to_string(&overdue)?;
    let flagged_json = serde_json::to_string(&flagged)?;

    Ok(format!(
        "run a focused daily review using the task data below.\n\n1) identify the highest-risk overdue items.\n2) review due-soon tasks and sequence today's execution.\n3) evaluate flagged work and confirm urgency.\n4) produce exactly three top priorities for today with short rationale.\n5) call out anything that should be deferred, delegated, or dropped.\n\noverdue_tasks_json:\n{overdue_json}\n\ndue_soon_tasks_json:\n{due_soon_json}\n\nflagged_tasks_json:\n{flagged_json}\n"
    ))
}

pub async fn weekly_review<R: JxaRunner>(runner: &R) -> Result<String> {
    let active_projects =
        list_projects(runner, None, "active", None, None, false, None, "asc", 500).await?;
    let available_tasks = list_tasks(
        runner,
        None,
        None,
        None,
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "asc",
        1000,
    )
    .await?;

    let active_projects_json = serde_json::to_string(&active_projects)?;
    let available_tasks_json = serde_json::to_string(&available_tasks)?;

    Ok(format!(
        "run a gtd-style weekly review using the data below.\n\n1) review all active projects and classify each as:\n   - on track\n   - at risk\n   - stalled (no clear next action)\n2) identify stalled projects by checking whether each project has at least one available next action.\n3) propose the next concrete action for every stalled project.\n4) highlight projects that need defer/due date updates or scope adjustments.\n5) produce a concise weekly plan:\n   - top 5 project priorities\n   - key risks/blockers\n   - cleanup actions (drop, defer, delegate, or someday/maybe)\n\nactive_projects_json:\n{active_projects_json}\n\navailable_tasks_json:\n{available_tasks_json}\n"
    ))
}

pub async fn inbox_processing<R: JxaRunner>(runner: &R) -> Result<String> {
    let inbox_items = get_inbox(runner, 200).await?;
    let inbox_items_json = serde_json::to_string(&inbox_items)?;

    Ok(format!(
        "run a gtd inbox processing session using the inbox data below.\n\nfor each inbox item, guide a decision in this order:\n1) clarify desired outcome and next action.\n2) decide if it should be deleted, deferred, delegated, or kept.\n3) if kept, assign the best target project (or keep in inbox if truly unassigned).\n4) propose relevant tags and whether it should be flagged.\n5) suggest due/defer dates only when there is a real deadline or start date.\n6) suggest estimated minutes when the task is actionable.\n\nrespond with:\n- a prioritized processing queue\n- concrete update recommendations per item\n- a short batch action plan for the first 5 items\n\ninbox_items_json:\n{inbox_items_json}\n"
    ))
}

pub async fn project_planning<R: JxaRunner>(runner: &R, project: &str) -> Result<String> {
    if project.trim().is_empty() {
        return Err(OmniFocusError::Validation(
            "project must not be empty.".to_string(),
        ));
    }

    let project_name = project.trim();
    let project_details = get_project(runner, project_name).await?;
    let available_tasks = list_tasks(
        runner,
        Some(project_name),
        None,
        None,
        "any",
        None,
        "available",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "asc",
        500,
    )
    .await?;

    let project_details_json = serde_json::to_string(&project_details)?;
    let available_tasks_json = serde_json::to_string(&available_tasks)?;

    Ok(format!(
        "plan this project into clear executable work.\n\nproject name:\n{project_name}\n\nplanning goals:\n1) summarize the project outcome in one concise sentence.\n2) evaluate current task coverage and identify missing steps.\n3) convert vague items into concrete next actions (verb-first, observable).\n4) sequence work logically (dependencies first, then parallelizable actions).\n5) estimate effort (minutes/hours) for each next action and flag high-risk items.\n6) recommend what to do now, next, later, and what to defer/drop.\n\noutput format:\n- project summary\n- work breakdown with columns:\n  action, estimate, priority, dependency, suggested tags, due/defer recommendation, rationale\n- first 3 actions to execute immediately\n- risk/blocker list with mitigation ideas\n\nproject_details_json:\n{project_details_json}\n\nproject_available_tasks_json:\n{available_tasks_json}\n"
    ))
}
