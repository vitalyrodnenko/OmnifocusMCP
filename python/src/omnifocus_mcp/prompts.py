from omnifocus_mcp.registration import typed_prompt
from omnifocus_mcp.app import mcp
from omnifocus_mcp.tools.projects import get_project, list_projects
from omnifocus_mcp.tools.tasks import get_inbox, list_tasks


@typed_prompt(mcp)
async def daily_review() -> str:
    """daily planning prompt with due-soon, overdue, and flagged tasks."""
    due_soon = await list_tasks(status="due_soon", limit=25)
    overdue = await list_tasks(status="overdue", limit=25)
    flagged = await list_tasks(flagged=True, status="all", limit=25)

    return f"""run a focused daily review using the task data below.

1) identify the highest-risk overdue items.
2) review due-soon tasks and sequence today's execution.
3) evaluate flagged work and confirm urgency.
4) produce exactly three top priorities for today with short rationale.
5) call out anything that should be deferred, delegated, or dropped.

overdue_tasks_json:
{overdue}

due_soon_tasks_json:
{due_soon}

flagged_tasks_json:
{flagged}
"""


@typed_prompt(mcp)
async def weekly_review() -> str:
    """weekly review prompt with active projects and next-action coverage."""
    active_projects = await list_projects(status="active", limit=500)
    available_tasks = await list_tasks(status="available", limit=1000)

    return f"""run a gtd-style weekly review using the data below.

1) review all active projects and classify each as:
   - on track
   - at risk
   - stalled (no clear next action)
2) identify stalled projects by checking whether each project has at least one available next action.
3) propose the next concrete action for every stalled project.
4) highlight projects that need defer/due date updates or scope adjustments.
5) produce a concise weekly plan:
   - top 5 project priorities
   - key risks/blockers
   - cleanup actions (drop, defer, delegate, or someday/maybe)

active_projects_json:
{active_projects}

available_tasks_json:
{available_tasks}
"""


@typed_prompt(mcp)
async def inbox_processing() -> str:
    """inbox processing prompt that drives one-by-one clarification decisions."""
    inbox_items = await get_inbox(limit=200)

    return f"""run a gtd inbox processing session using the inbox data below.

for each inbox item, guide a decision in this order:
1) clarify desired outcome and next action.
2) decide if it should be deleted, deferred, delegated, or kept.
3) if kept, assign the best target project (or keep in inbox if truly unassigned).
4) propose relevant tags and whether it should be flagged.
5) suggest due/defer dates only when there is a real deadline or start date.
6) suggest estimated minutes when the task is actionable.

respond with:
- a prioritized processing queue
- concrete update recommendations per item
- a short batch action plan for the first 5 items

inbox_items_json:
{inbox_items}
"""


@typed_prompt(mcp)
async def project_planning(project: str) -> str:
    """project planning prompt that turns a project into actionable next steps."""
    if project.strip() == "":
        raise ValueError("project must not be empty.")

    project_name = project.strip()
    project_details = await get_project(project_id_or_name=project_name)
    available_tasks = await list_tasks(
        project=project_name, status="available", limit=500
    )

    return f"""plan this project into clear executable work.

project name:
{project_name}

planning goals:
1) summarize the project outcome in one concise sentence.
2) evaluate current task coverage and identify missing steps.
3) convert vague items into concrete next actions (verb-first, observable).
4) sequence work logically (dependencies first, then parallelizable actions).
5) estimate effort (minutes/hours) for each next action and flag high-risk items.
6) recommend what to do now, next, later, and what to defer/drop.

output format:
- project summary
- work breakdown with columns:
  action, estimate, priority, dependency, suggested tags, due/defer recommendation, rationale
- first 3 actions to execute immediately
- risk/blocker list with mitigation ideas

project_details_json:
{project_details}

project_available_tasks_json:
{available_tasks}
"""
