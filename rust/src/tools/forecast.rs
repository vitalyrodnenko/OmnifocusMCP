use serde_json::Value;

use crate::{
    error::{OmniFocusError, Result},
    jxa::JxaRunner,
};

pub async fn get_forecast<R: JxaRunner>(runner: &R, limit: i32) -> Result<Value> {
    if limit < 1 {
        return Err(OmniFocusError::Validation(
            "limit must be greater than 0.".to_string(),
        ));
    }

    let script = format!(
        r#"const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endOfToday = new Date(startOfToday.getTime() + (24 * 60 * 60 * 1000));
const endOfWeek = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

const toTaskSummary = (task) => {{
  return {{
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    completed: task.completed,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    completionDate: task.completionDate ? task.completionDate.toISOString() : null,
    taskStatus: (() => {{
      const s = String(task.taskStatus);
      if (s.includes("Available")) return "available";
      if (s.includes("Blocked")) return "blocked";
      if (s.includes("Next")) return "next";
      if (s.includes("DueSoon")) return "due_soon";
      if (s.includes("Overdue")) return "overdue";
      if (s.includes("Completed")) return "completed";
      if (s.includes("Dropped")) return "dropped";
      return "unknown";
    }})(),
    projectName: task.containingProject ? task.containingProject.name : null,
    tags: task.tags.map(tag => tag.name),
    estimatedMinutes: task.estimatedMinutes,
    hasChildren: task.hasChildren
  }};
}};

const openTasks = document.flattenedTasks.filter(task => !task.completed);
const overdue = [];
const dueToday = [];
const flagged = [];
const deferred = [];
const dueThisWeek = [];

const counts = {{
  overdueCount: 0,
  dueTodayCount: 0,
  flaggedCount: 0,
  deferredCount: 0,
  dueThisWeekCount: 0
}};

openTasks.forEach(task => {{
  if (task.dueDate !== null && task.dueDate < startOfToday) {{
    counts.overdueCount += 1;
    if (overdue.length < {limit}) overdue.push(toTaskSummary(task));
  }}
  if (task.dueDate !== null && task.dueDate >= startOfToday && task.dueDate < endOfToday) {{
    counts.dueTodayCount += 1;
    if (dueToday.length < {limit}) dueToday.push(toTaskSummary(task));
  }}
  if (task.flagged) {{
    counts.flaggedCount += 1;
    if (flagged.length < {limit}) flagged.push(toTaskSummary(task));
  }}
  if (task.deferDate !== null && task.deferDate > now) {{
    counts.deferredCount += 1;
    if (deferred.length < {limit}) deferred.push(toTaskSummary(task));
  }}
  if (task.dueDate !== null && task.dueDate >= endOfToday && task.dueDate < endOfWeek) {{
    counts.dueThisWeekCount += 1;
    if (dueThisWeek.length < {limit}) dueThisWeek.push(toTaskSummary(task));
  }}
}});

return {{
  overdue: overdue,
  dueToday: dueToday,
  flagged: flagged,
  deferred: deferred,
  dueThisWeek: dueThisWeek,
  counts: counts
}};"#
    );

    runner.run_omnijs(&script).await
}
