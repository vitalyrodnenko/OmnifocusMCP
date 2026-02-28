from omnifocus_mcp.registration import typed_resource
from omnifocus_mcp.app import mcp
from omnifocus_mcp.tools.forecast import get_forecast
from omnifocus_mcp.tools.projects import list_projects
from omnifocus_mcp.tools.tasks import get_inbox


@typed_resource(mcp, "omnifocus://inbox")
async def inbox_resource() -> str:
    """resource for current inbox tasks as json."""
    return await get_inbox()


@typed_resource(mcp, "omnifocus://today")
async def today_resource() -> str:
    """resource for forecast sections as json."""
    return await get_forecast()


@typed_resource(mcp, "omnifocus://projects")
async def projects_resource() -> str:
    """resource for active project summaries as json."""
    return await list_projects(status="active")
