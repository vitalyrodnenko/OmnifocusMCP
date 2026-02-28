import json

from omnifocus_mcp.jxa import run_omnijs
from omnifocus_mcp.registration import typed_tool
from omnifocus_mcp.app import mcp


@typed_tool(mcp)
async def get_forecast(limit: int = 100) -> str:
    """get forecast sections for overdue, due today, and flagged tasks.

    returns an object with grouped sections: overdue, dueToday, and flagged.
    each section contains task summaries with id, name, note, due date,
    defer date, project name, tag names, and flagged/completed states.
    """
    if limit < 1:
        raise ValueError("limit must be greater than 0.")

    script = f"""
const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endOfToday = new Date(startOfToday.getTime() + (24 * 60 * 60 * 1000));

const toTaskSummary = (task) => {{
  return {{
    id: task.id.primaryKey,
    name: task.name,
    note: task.note,
    flagged: task.flagged,
    completed: task.completed,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    deferDate: task.deferDate ? task.deferDate.toISOString() : null,
    projectName: task.containingProject ? task.containingProject.name : null,
    tags: task.tags.map(tag => tag.name),
    estimatedMinutes: task.estimatedMinutes
  }};
}};

const openTasks = document.flattenedTasks.filter(task => !task.completed);

const overdue = openTasks
  .filter(task => task.dueDate !== null && task.dueDate < startOfToday)
  .slice(0, {limit})
  .map(toTaskSummary);

const dueToday = openTasks
  .filter(task => task.dueDate !== null && task.dueDate >= startOfToday && task.dueDate < endOfToday)
  .slice(0, {limit})
  .map(toTaskSummary);

const flagged = openTasks
  .filter(task => task.flagged)
  .slice(0, {limit})
  .map(toTaskSummary);

return {{
  overdue: overdue,
  dueToday: dueToday,
  flagged: flagged
}};
""".strip()
    result = await run_omnijs(script)
    return json.dumps(result)
