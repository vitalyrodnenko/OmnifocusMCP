from omnifocus_mcp.app import mcp
from omnifocus_mcp.jxa import run_omnijs  # noqa: F401
from omnifocus_mcp.registration import typed_tool


@typed_tool(mcp)
async def ping() -> dict[str, str]:
    return {"status": "ok", "message": "pong"}


import omnifocus_mcp.tools.folders as folders_tools  # noqa: E402  # type: ignore
import omnifocus_mcp.tools.tags as tags_tools  # noqa: E402  # type: ignore
from omnifocus_mcp.tools.forecast import get_forecast  # noqa: E402,F401
from omnifocus_mcp.tools.perspectives import list_perspectives  # noqa: E402,F401
from omnifocus_mcp.tools.projects import (  # noqa: E402,F401
    complete_project,
    create_project,
    delete_project,
    get_project,
    get_project_counts,
    list_projects,
    move_project,
    search_projects,
    set_project_status,
    update_project,
    uncomplete_project,
)
from omnifocus_mcp.tools.tasks import (  # noqa: E402,F401
    add_notification,
    append_to_note,
    complete_task,
    duplicate_task,
    create_task,
    create_tasks_batch,
    delete_task,
    delete_tasks_batch,
    duplicate_task,
    get_inbox,
    get_task_counts,
    get_task,
    list_notifications,
    list_subtasks,
    list_tasks,
    move_task,
    remove_notification,
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

create_folder = folders_tools.create_folder
delete_folder = folders_tools.delete_folder
get_folder = folders_tools.get_folder
list_folders = folders_tools.list_folders
update_folder = folders_tools.update_folder
create_tag = tags_tools.create_tag
delete_tag = tags_tools.delete_tag
list_tags = tags_tools.list_tags
search_tags = tags_tools.search_tags
update_tag = tags_tools.update_tag
