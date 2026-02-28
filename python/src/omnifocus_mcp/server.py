from omnifocus_mcp.app import mcp
from omnifocus_mcp.jxa import run_omnijs  # noqa: F401
from omnifocus_mcp.registration import typed_tool


@typed_tool(mcp)
async def ping() -> dict[str, str]:
    return {"status": "ok", "message": "pong"}


from omnifocus_mcp.tools.folders import create_folder, list_folders  # noqa: E402,F401
from omnifocus_mcp.tools.forecast import get_forecast  # noqa: E402,F401
from omnifocus_mcp.tools.perspectives import list_perspectives  # noqa: E402,F401
from omnifocus_mcp.tools.projects import (  # noqa: E402,F401
    complete_project,
    create_project,
    delete_project,
    get_project,
    list_projects,
    move_project,
    set_project_status,
    update_project,
    uncomplete_project,
)
from omnifocus_mcp.tools.tags import create_tag, delete_tag, list_tags, update_tag  # noqa: E402,F401
from omnifocus_mcp.tools.tasks import (  # noqa: E402,F401
    complete_task,
    create_task,
    create_tasks_batch,
    delete_task,
    delete_tasks_batch,
    get_inbox,
    get_task,
    list_subtasks,
    list_tasks,
    move_task,
    search_tasks,
    set_task_repetition,
    uncomplete_task,
    update_task,
)

from omnifocus_mcp.prompts import (  # noqa: E402,F401
    daily_review,
    inbox_processing,
    project_planning,
    weekly_review,
)
from omnifocus_mcp.resources import (  # noqa: E402,F401
    inbox_resource,
    projects_resource,
    today_resource,
)
