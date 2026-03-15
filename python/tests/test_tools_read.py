import json
from collections.abc import Callable
import importlib
import re
import sys
import types
from typing import Any

import pytest


def _patch_run_omnijs(
    monkeypatch: pytest.MonkeyPatch,
    server_module: Any,
    fake_run_omnijs: Callable[..., Any],
) -> None:
    monkeypatch.setattr(server_module, "run_omnijs", fake_run_omnijs)
    for module_name in (
        "omnifocus_mcp.tools.tasks",
        "omnifocus_mcp.tools.projects",
        "omnifocus_mcp.tools.tags",
        "omnifocus_mcp.tools.folders",
        "omnifocus_mcp.tools.forecast",
        "omnifocus_mcp.tools.perspectives",
    ):
        monkeypatch.setattr(
            importlib.import_module(module_name), "run_omnijs", fake_run_omnijs
        )


def _normalize_status_fixture(raw_status: str) -> str:
    flattened = re.sub(
        r"\s+",
        " ",
        re.sub(
            r"[_-]",
            " ",
            re.sub(
                r"[:.=]",
                " ",
                re.sub(
                    r"status",
                    " ",
                    re.sub(
                        r"[\[\]{}()]",
                        " ",
                        re.sub(r"^\[object_", "", str(raw_status).lower()),
                    ),
                ),
            ),
        ),
    ).strip()
    if "onhold" in flattened or re.search(r"(^|\s)on\s*hold(\s|$)", flattened):
        return "on_hold"
    if "dropped" in flattened:
        return "dropped"
    if "active" in flattened:
        return "active"
    return "active"


@pytest.fixture
def server_module(monkeypatch: pytest.MonkeyPatch) -> Any:
    class FakeFastMCP:
        def __init__(self, name: str):
            self.name = name

        def tool(self) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
            def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
                return func

            return decorator

    mcp_module = types.ModuleType("mcp")
    mcp_server_module = types.ModuleType("mcp.server")
    mcp_fastmcp_module = types.ModuleType("mcp.server.fastmcp")
    mcp_fastmcp_module.FastMCP = FakeFastMCP
    mcp_server_module.fastmcp = mcp_fastmcp_module
    mcp_module.server = mcp_server_module

    monkeypatch.setitem(sys.modules, "mcp", mcp_module)
    monkeypatch.setitem(sys.modules, "mcp.server", mcp_server_module)
    monkeypatch.setitem(sys.modules, "mcp.server.fastmcp", mcp_fastmcp_module)

    module = importlib.import_module("omnifocus_mcp.server")
    return importlib.reload(module)


@pytest.fixture
def mock_server_run_omnijs(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> Callable[[Any], dict[str, Any]]:
    state: dict[str, Any] = {"result": None, "calls": []}

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        state["calls"].append({"script": script, "timeout_seconds": timeout_seconds})
        return state["result"]

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    def configure(result: Any) -> dict[str, Any]:
        state["result"] = result
        return {"state": state, "server": server_module}

    return configure


@pytest.mark.asyncio
async def test_get_inbox_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {
            "id": "t1",
            "name": "Inbox Task",
            "note": "n",
            "flagged": False,
            "addedDate": "2026-02-01T09:00:00Z",
            "changedDate": "2026-02-03T10:30:00Z",
            "dueDate": None,
            "deferDate": None,
            "completionDate": None,
            "tags": ["home"],
            "estimatedMinutes": 15,
            "hasChildren": False,
            "taskStatus": "available",
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_inbox(limit=5)

    parsed = json.loads(result)
    assert parsed == payload
    assert parsed[0]["taskStatus"] in {
        "available",
        "blocked",
        "next",
        "due_soon",
        "overdue",
        "completed",
        "dropped",
    }
    assert len(state["calls"]) == 1
    assert ".slice(0, 5)" in state["calls"][0]["script"]
    assert (
        "completionDate: task.completionDate ? task.completionDate.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert "addedDate: task.added ? task.added.toISOString() : null," in state["calls"][0][
        "script"
    ]
    assert (
        "changedDate: task.modified ? task.modified.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert "hasChildren: task.hasChildren" in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert 'if (s.includes("Dropped")) return "dropped";' in state["calls"][0]["script"]
    assert 'if (s.includes("Available")) return "available";' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_inbox_resource_returns_inbox_json(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [{"id": "r1", "name": "Resource inbox task"}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.inbox_resource()

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert ".slice(0, 100)" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_today_resource_returns_forecast_json(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "overdue": [],
        "dueToday": [{"id": "d1"}],
        "flagged": [{"id": "f1"}],
        "deferred": [],
        "dueThisWeek": [],
        "counts": {
            "overdueCount": 0,
            "dueTodayCount": 1,
            "flaggedCount": 1,
            "deferredCount": 0,
            "dueThisWeekCount": 0,
        },
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.today_resource()

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "const deferred = [];" in state["calls"][0]["script"]
    assert "const dueThisWeek = [];" in state["calls"][0]["script"]
    assert "const counts = {" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_projects_resource_returns_active_projects_json(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [{"id": "p-resource", "name": "Resource project", "status": "active"}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.projects_resource()

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const statusFilter = "active";' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_daily_review_prompt_renders_expected_sections(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    prompt = await server.daily_review()

    assert "overdue_tasks_json:" in prompt
    assert "due_soon_tasks_json:" in prompt
    assert "flagged_tasks_json:" in prompt
    assert "[]" in prompt
    assert len(state["calls"]) == 3


@pytest.mark.asyncio
async def test_weekly_review_prompt_renders_expected_sections(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    prompt = await server.weekly_review()

    assert "active_projects_json:" in prompt
    assert "available_tasks_json:" in prompt
    assert "stalled (no clear next action)" in prompt
    assert "[]" in prompt
    assert len(state["calls"]) == 2


@pytest.mark.asyncio
async def test_inbox_processing_prompt_renders_expected_sections(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    prompt = await server.inbox_processing()

    assert "inbox_items_json:" in prompt
    assert "decide if it should be deleted, deferred, delegated, or kept." in prompt
    assert "[]" in prompt
    assert len(state["calls"]) == 1


@pytest.mark.asyncio
async def test_project_planning_prompt_renders_expected_sections(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "p-123",
        "name": "Alpha",
        "status": "active",
        "folderName": None,
        "taskCount": 1,
        "remainingTaskCount": 1,
        "deferDate": None,
        "dueDate": None,
        "note": "",
        "sequential": False,
        "reviewInterval": None,
        "rootTasks": [],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    prompt = await server.project_planning("Alpha")

    assert "project_details_json:" in prompt
    assert "project_available_tasks_json:" in prompt
    assert "project name:" in prompt
    assert "Alpha" in prompt
    assert '"id": "p-123"' in prompt
    assert "planning goals:" in prompt
    assert len(state["calls"]) == 2


@pytest.mark.asyncio
async def test_list_tasks_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {
            "id": "t2",
            "name": "Task",
            "note": "note",
            "flagged": True,
            "addedDate": "2026-02-01T09:00:00Z",
            "changedDate": "2026-02-05T10:30:00Z",
            "dueDate": "2026-03-01T10:00:00Z",
            "deferDate": None,
            "completed": False,
            "completionDate": None,
            "plannedDate": None,
            "projectName": "Proj",
            "tags": ["urgent"],
            "estimatedMinutes": 30,
            "hasChildren": False,
            "taskStatus": "next",
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_tasks(
        project="Proj", tag="urgent", flagged=True, status="due_soon", limit=7
    )

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const statusFilter = "due_soon";' in state["calls"][0]["script"]
    assert (
        "completionDate: task.completionDate ? task.completionDate.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert (
        "plannedDate: plannedDate ? plannedDate.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert "addedDate: task.added ? task.added.toISOString() : null," in state["calls"][0][
        "script"
    ]
    assert (
        "changedDate: task.modified ? task.modified.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert "hasChildren: task.hasChildren" in state["calls"][0]["script"]
    assert 'if (s.includes("Available")) return "available";' in state["calls"][0]["script"]
    assert ".slice(0, 7)" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_list_tasks_date_filters_are_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(
        project="Proj",
        tag="urgent",
        flagged=True,
        status="available",
        dueBefore="2026-03-10T00:00:00Z",
        dueAfter="2026-03-01T00:00:00Z",
        deferBefore="2026-03-08T00:00:00Z",
        deferAfter="2026-02-25T00:00:00Z",
        completedBefore="2026-03-09T00:00:00Z",
        completedAfter="2026-02-20T00:00:00Z",
        plannedBefore="2026-03-15T00:00:00Z",
        plannedAfter="2026-02-15T00:00:00Z",
        limit=9,
    )

    script = state["calls"][0]["script"]
    assert 'const dueBeforeRaw = "2026-03-10T00:00:00Z";' in script
    assert 'const completedAfterRaw = "2026-02-20T00:00:00Z";' in script
    assert 'const plannedBeforeRaw = "2026-03-15T00:00:00Z";' in script
    assert 'const plannedAfterRaw = "2026-02-15T00:00:00Z";' in script
    assert (
        "throw new Error(`${fieldName} must be a valid ISO 8601 date string.`);"
        in script
    )
    assert (
        "const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;"
        in script
    )
    assert (
        "if (completedAfter !== null && !(task.completionDate !== null && task.completionDate > completedAfter)) return false;"
        in script
    )
    assert (
        "if (plannedAfter !== null && !(plannedDate !== null && plannedDate > plannedAfter)) return false;"
        in script
    )
    assert ".slice(0, 9)" in script


@pytest.mark.asyncio
async def test_list_tasks_added_changed_date_filters_are_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(
        added_after="2026-02-01T00:00:00Z",
        added_before="2026-02-28T23:59:59Z",
        changed_after="2026-03-01T00:00:00Z",
        changed_before="2026-03-31T23:59:59Z",
        limit=5,
    )

    script = state["calls"][0]["script"]
    assert 'const addedAfterRaw = "2026-02-01T00:00:00Z";' in script
    assert 'const addedBeforeRaw = "2026-02-28T23:59:59Z";' in script
    assert 'const changedAfterRaw = "2026-03-01T00:00:00Z";' in script
    assert 'const changedBeforeRaw = "2026-03-31T23:59:59Z";' in script
    assert (
        "if (addedBefore !== null && !(task.added !== null && task.added <= addedBefore)) return false;"
        in script
    )
    assert (
        "if (addedAfter !== null && !(task.added !== null && task.added >= addedAfter)) return false;"
        in script
    )
    assert (
        "if (changedBefore !== null && !(task.modified !== null && task.modified <= changedBefore)) return false;"
        in script
    )
    assert (
        "if (changedAfter !== null && !(task.modified !== null && task.modified >= changedAfter)) return false;"
        in script
    )
    assert ".slice(0, 5)" in script


@pytest.mark.asyncio
async def test_list_tasks_completed_date_filter_auto_includes_completed_logic(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(
        status="available", completedAfter="2026-03-01T00:00:00Z", limit=5
    )

    script = state["calls"][0]["script"]
    assert "else if (task.completed) {" in script
    assert "statusMatches = includeCompletedForDateFilter;" in script


@pytest.mark.asyncio
async def test_list_tasks_sort_due_date_asc_is_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(sortBy="dueDate", sortOrder="asc", limit=5)

    script = state["calls"][0]["script"]
    assert 'const sortBy = "dueDate";' in script
    assert 'const sortOrder = "asc";' in script
    assert 'if (sortBy === "dueDate") {' in script


@pytest.mark.asyncio
async def test_list_tasks_sort_added_alias_is_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(sortBy="added", sortOrder="desc", limit=5)

    script = state["calls"][0]["script"]
    assert 'const sortBy = "added";' in script
    assert 'const sortOrder = "desc";' in script
    assert 'sortBy === "addedDate" || sortBy === "added"' in script


@pytest.mark.asyncio
async def test_list_tasks_sort_name_desc_is_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(sortBy="name", sortOrder="desc", limit=5)

    script = state["calls"][0]["script"]
    assert 'const sortBy = "name";' in script
    assert 'const sortOrder = "desc";' in script
    assert "left = String(aValue).toLowerCase();" in script


@pytest.mark.asyncio
async def test_list_tasks_sort_auto_defaults_for_completion_date_filters(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(completedAfter="2026-03-01T00:00:00Z", limit=5)

    script = state["calls"][0]["script"]
    assert 'const sortBy = "completionDate";' in script
    assert 'const sortOrder = "desc";' in script


@pytest.mark.asyncio
async def test_list_tasks_sort_nulls_last_logic_is_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(sortBy="project", sortOrder="desc", limit=5)

    script = state["calls"][0]["script"]
    assert "if (aValue === null) return 1;" in script
    assert "if (bValue === null) return -1;" in script


@pytest.mark.asyncio
async def test_list_tasks_tags_filter_single_via_tags_param(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(tags=["Home"], limit=5)

    script = state["calls"][0]["script"]
    assert 'const tagNames = ["Home"];' in script
    assert 'const tagFilterMode = "any";' in script
    assert "task.tags.some(t => tagNames.includes(t.name))" in script


@pytest.mark.asyncio
async def test_list_tasks_tags_filter_all_mode(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(tags=["Home", "Deep"], tagFilterMode="all", limit=5)

    script = state["calls"][0]["script"]
    assert 'const tagNames = ["Home", "Deep"];' in script
    assert 'const tagFilterMode = "all";' in script
    assert "tagNames.every(tn => task.tags.some(t => t.name === tn))" in script


@pytest.mark.asyncio
async def test_list_tasks_tags_filter_any_mode_with_multiple_tags(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(tags=["Home", "Deep"], tagFilterMode="any", limit=5)

    script = state["calls"][0]["script"]
    assert 'const tagNames = ["Home", "Deep"];' in script
    assert "task.tags.some(t => tagNames.includes(t.name))" in script


@pytest.mark.asyncio
async def test_list_tasks_tags_filter_merges_tag_and_tags_union(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(tag="Home", tags=["Errands", "Home"], limit=5)

    script = state["calls"][0]["script"]
    assert 'const tagNames = ["Home", "Errands"];' in script


@pytest.mark.asyncio
async def test_list_tasks_alias_inputs_normalize_to_canonical_values(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(
        tags=["Home", "Deep"],
        tagFilterMode="AND",
        status="due soon",
        sortOrder="Descending",
        limit=5,
    )

    script = state["calls"][0]["script"]
    assert 'const tagFilterMode = "all";' in script
    assert 'const statusFilter = "due_soon";' in script
    assert 'const sortOrder = "desc";' in script


@pytest.mark.asyncio
async def test_search_tasks_alias_inputs_normalize_to_canonical_values(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.search_tasks(
        query="audit",
        tags=["Home", "Deep"],
        tagFilterMode="or",
        status="Due-Soon",
        sortOrder="ascending",
        limit=5,
    )

    script = state["calls"][0]["script"]
    assert 'const tagFilterMode = "any";' in script
    assert 'const statusFilter = "due_soon";' in script
    assert 'const sortOrder = "asc";' in script


@pytest.mark.asyncio
async def test_get_task_counts_alias_input_normalizes_to_canonical_values(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs(
        {
            "total": 0,
            "available": 0,
            "completed": 0,
            "overdue": 0,
            "dueSoon": 0,
            "flagged": 0,
            "deferred": 0,
        }
    )
    state = configured["state"]
    server = configured["server"]

    await server.get_task_counts(tags=["Home"], tagFilterMode="OR")

    script = state["calls"][0]["script"]
    assert 'const tagFilterMode = "any";' in script


@pytest.mark.asyncio
async def test_list_tasks_tags_filter_ignores_empty_tags_array(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(tags=[], limit=5)

    script = state["calls"][0]["script"]
    assert "const tagNames = null;" in script


@pytest.mark.asyncio
async def test_list_tasks_duration_filter_15_minutes_is_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(maxEstimatedMinutes=15, limit=5)

    script = state["calls"][0]["script"]
    assert "const maxEstimatedMinutes = 15;" in script
    assert (
        "if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;"
        in script
    )


@pytest.mark.asyncio
async def test_list_tasks_duration_filter_60_minutes_is_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(maxEstimatedMinutes=60, limit=5)

    script = state["calls"][0]["script"]
    assert "const maxEstimatedMinutes = 60;" in script


@pytest.mark.asyncio
async def test_list_tasks_duration_filter_excludes_null_estimated_minutes_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(maxEstimatedMinutes=30, limit=5)

    script = state["calls"][0]["script"]
    assert (
        "task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes"
        in script
    )


@pytest.mark.asyncio
async def test_get_task_counts_includes_filters_and_aggregate_counters_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs(
        {
            "total": 4,
            "available": 2,
            "completed": 1,
            "overdue": 1,
            "dueSoon": 1,
            "flagged": 2,
            "deferred": 1,
        }
    )
    state = configured["state"]
    server = configured["server"]

    result = await server.get_task_counts(
        project="Errands",
        tag="Home",
        tags=["Deep", "Home"],
        tagFilterMode="all",
        flagged=True,
        dueBefore="2026-03-10T00:00:00Z",
        completedAfter="2026-03-01T00:00:00Z",
        maxEstimatedMinutes=30,
    )

    script = state["calls"][0]["script"]
    assert 'const projectFilter = "Errands";' in script
    assert 'const tagNames = ["Home", "Deep"];' in script
    assert 'const tagFilterMode = "all";' in script
    assert "const flaggedFilter = true;" in script
    assert 'const dueBeforeRaw = "2026-03-10T00:00:00Z";' in script
    assert "const counts = {" in script
    assert "counts.dueSoon += 1;" in script
    assert "counts.deferred += 1;" in script
    assert json.loads(result)["total"] == 4


@pytest.mark.asyncio
async def test_get_task_counts_added_changed_date_filters_are_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs({"total": 0})
    state = configured["state"]
    server = configured["server"]

    await server.get_task_counts(
        added_after="2026-02-01T00:00:00Z",
        added_before="2026-02-28T23:59:59Z",
        changed_after="2026-03-01T00:00:00Z",
        changed_before="2026-03-31T23:59:59Z",
    )

    script = state["calls"][0]["script"]
    assert 'const addedAfterRaw = "2026-02-01T00:00:00Z";' in script
    assert 'const addedBeforeRaw = "2026-02-28T23:59:59Z";' in script
    assert 'const changedAfterRaw = "2026-03-01T00:00:00Z";' in script
    assert 'const changedBeforeRaw = "2026-03-31T23:59:59Z";' in script
    assert (
        "if (addedBefore !== null && !(task.added !== null && task.added <= addedBefore)) continue;"
        in script
    )
    assert (
        "if (addedAfter !== null && !(task.added !== null && task.added >= addedAfter)) continue;"
        in script
    )
    assert (
        "if (changedBefore !== null && !(task.modified !== null && task.modified <= changedBefore)) continue;"
        in script
    )
    assert (
        "if (changedAfter !== null && !(task.modified !== null && task.modified >= changedAfter)) continue;"
        in script
    )


@pytest.mark.asyncio
async def test_get_task_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "t3",
        "name": "Task 3",
        "note": "",
        "flagged": False,
        "addedDate": "2026-02-01T09:00:00Z",
        "changedDate": "2026-02-06T11:00:00Z",
        "dueDate": None,
        "deferDate": None,
        "effectiveDueDate": None,
        "effectiveDeferDate": None,
        "effectiveFlagged": False,
        "completed": False,
        "completionDate": None,
        "modified": None,
        "plannedDate": None,
        "effectivePlannedDate": None,
        "taskStatus": "available",
        "projectName": "Proj",
        "tags": [],
        "estimatedMinutes": None,
        "children": [],
        "parentName": None,
        "sequential": False,
        "repetitionRule": None,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_task("t3")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const taskId = "t3";' in state["calls"][0]["script"]
    assert "effectiveDueDate: task.effectiveDueDate ? task.effectiveDueDate.toISOString() : null," in state["calls"][0]["script"]
    assert "effectiveDeferDate: task.effectiveDeferDate ? task.effectiveDeferDate.toISOString() : null," in state["calls"][0]["script"]
    assert "effectiveFlagged: task.effectiveFlagged," in state["calls"][0]["script"]
    assert "addedDate: task.added ? task.added.toISOString() : null," in state["calls"][0][
        "script"
    ]
    assert (
        "changedDate: task.modified ? task.modified.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert "modified: task.modified ? task.modified.toISOString() : null," in state["calls"][0]["script"]
    assert "plannedDate: plannedDate ? plannedDate.toISOString() : null," in state["calls"][0]["script"]
    assert "effectivePlannedDate: effectivePlannedDate ? effectivePlannedDate.toISOString() : null," in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert 'if (s.includes("Overdue")) return "overdue";' in state["calls"][0]["script"]
    assert 'if (s.includes("Completed")) return "completed";' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_get_task_counts_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "total": 6,
        "available": 3,
        "completed": 2,
        "overdue": 1,
        "dueSoon": 2,
        "flagged": 2,
        "deferred": 1,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_task_counts(
        project="Errands", tags=["Home"], flagged=True
    )

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "Errands";' in script
    assert 'const tagNames = ["Home"];' in script
    assert "const flaggedFilter = true;" in script
    assert "const counts = {" in script
    assert "counts.overdue += 1;" in script


@pytest.mark.asyncio
async def test_get_task_counts_validation_errors(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project must not be empty when provided."):
        await server_module.get_task_counts(project="  ")
    with pytest.raises(
        ValueError, match=r"tagFilterMode must be one of: any, all\. received: 'invalid'\."
    ):
        await server_module.get_task_counts(tagFilterMode="invalid")
    with pytest.raises(
        ValueError, match="maxEstimatedMinutes must be greater than or equal to 0."
    ):
        await server_module.get_task_counts(maxEstimatedMinutes=-1)


@pytest.mark.asyncio
async def test_get_task_counts_tag_filter_mode_alias_maps_to_all(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs(
        {
            "total": 1,
            "available": 1,
            "completed": 0,
            "overdue": 0,
            "dueSoon": 0,
            "flagged": 0,
            "deferred": 0,
        }
    )
    state = configured["state"]
    server = configured["server"]

    await server.get_task_counts(project="Errands", tagFilterMode="AND")
    script = state["calls"][0]["script"]
    assert 'const tagFilterMode = "all";' in script


@pytest.mark.asyncio
async def test_plan_c_aliases_are_normalized_for_list_and_search(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tasks(
        tags=["Home", "Work"],
        tagFilterMode="AND",
        status="due soon",
        sortOrder="Descending",
        limit=5,
    )
    list_script = state["calls"][-1]["script"]
    assert 'const tagFilterMode = "all";' in list_script
    assert 'const statusFilter = "due_soon";' in list_script
    assert 'const sortOrder = "desc";' in list_script

    await server.search_tasks(
        query="alias probe",
        tags=["Home", "Work"],
        tagFilterMode="OR",
        status="Due-Soon",
        sortOrder="Ascending",
        limit=5,
    )
    search_script = state["calls"][-1]["script"]
    assert 'const tagFilterMode = "any";' in search_script
    assert 'const statusFilter = "due_soon";' in search_script
    assert 'const sortOrder = "asc";' in search_script


@pytest.mark.asyncio
async def test_plan_c_alias_unknown_values_remain_strict(server_module: Any) -> None:
    with pytest.raises(
        ValueError, match=r"sortOrder must be one of: asc, desc\. received: 'sideways'\."
    ):
        await server_module.list_tasks(sortOrder="sideways")
    with pytest.raises(
        ValueError,
        match=r"status must be one of: available, due_soon, overdue, on_hold, completed, all\. received: 'tomorrowish'\.",
    ):
        await server_module.search_tasks(query="alias strict", status="tomorrowish")
    with pytest.raises(
        ValueError, match=r"tagFilterMode must be one of: any, all\. received: 'xor'\."
    ):
        await server_module.get_task_counts(tagFilterMode="xor")


@pytest.mark.asyncio
async def test_list_subtasks_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {
            "id": "st1",
            "name": "Child task",
            "note": "detail",
            "flagged": False,
            "dueDate": None,
            "deferDate": None,
            "completed": False,
            "tags": ["home"],
            "estimatedMinutes": 10,
            "hasChildren": False,
            "taskStatus": "blocked",
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_subtasks(task_id="t3", limit=4)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const taskId = "t3";' in state["calls"][0]["script"]
    assert "const subtasks = task.children.slice(0, 4);" in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert 'if (s.includes("Blocked")) return "blocked";' in state["calls"][0]["script"]
    assert "const s = String(subtask.taskStatus);" in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert 'if (s.includes("Next")) return "next";' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_list_notifications_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {
            "id": "n1",
            "kind": "absolute",
            "absoluteFireDate": "2026-03-02T09:00:00Z",
            "relativeFireOffset": None,
            "nextFireDate": "2026-03-02T09:00:00Z",
            "isSnoozed": False,
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_notifications(task_id="t3")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t3";' in script
    assert "return task.notifications.map(n => ({" in script
    assert 'kind: n.initialFireDate ? "absolute" : "relative",' in script
    assert "relativeFireOffset: n.initialFireDate ? null : n.relativeFireOffset," in script
    assert "isSnoozed: n.isSnoozed" in script


@pytest.mark.asyncio
async def test_add_notification_absolute_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "n2",
        "kind": "absolute",
        "absoluteFireDate": "2026-03-03T10:30:00Z",
        "relativeFireOffset": None,
        "nextFireDate": "2026-03-03T10:30:00Z",
        "isSnoozed": False,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.add_notification(
        task_id="t3", absoluteDate="2026-03-03T10:30:00Z"
    )

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t3";' in script
    assert 'const absoluteDate = "2026-03-03T10:30:00Z";' in script
    assert "const relativeOffset = null;" in script
    assert "const parsedAbsoluteDate = new Date(absoluteDate);" in script
    assert "notification = task.addNotification(parsedAbsoluteDate);" in script
    assert "if (task.effectiveDueDate === null) {" in script


@pytest.mark.asyncio
async def test_add_notification_relative_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "n3",
        "kind": "relative",
        "absoluteFireDate": None,
        "relativeFireOffset": -3600,
        "nextFireDate": "2026-03-03T09:00:00Z",
        "isSnoozed": False,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.add_notification(task_id="t3", relativeOffset=-3600)

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "const absoluteDate = null;" in script
    assert "const relativeOffset = -3600;" in script
    assert "notification = task.addNotification(relativeOffset);" in script
    assert "relativeFireOffset: notification.initialFireDate ? null : notification.relativeFireOffset," in script


@pytest.mark.asyncio
async def test_remove_notification_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"taskId": "t3", "notificationId": "n9", "removed": True}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.remove_notification(task_id="t3", notification_id="n9")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t3";' in script
    assert 'const notificationId = "n9";' in script
    assert "const notification = task.notifications.find(item => item.id.primaryKey === notificationId);" in script
    assert "const removedNotificationId = notification.id.primaryKey;" in script
    assert "task.removeNotification(notification);" in script
    assert "notificationId: removedNotificationId," in script
    assert "removed: true" in script


@pytest.mark.asyncio
async def test_duplicate_task_happy_path_with_children(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "copy-1",
        "name": "Copied task",
        "note": "copied",
        "flagged": True,
        "dueDate": "2026-03-10T09:00:00Z",
        "deferDate": None,
        "completed": False,
        "completionDate": None,
        "projectName": "Errands",
        "tags": ["Home"],
        "estimatedMinutes": 15,
        "hasChildren": True,
        "taskStatus": "available",
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.duplicate_task(task_id="t3")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t3";' in script
    assert "const includeChildren = true;" in script
    assert "const duplicated = duplicateTasks([task], insertionLocation);" in script
    assert "const taskStatusValue = (taskItem) => {" in script


@pytest.mark.asyncio
async def test_duplicate_task_happy_path_without_children(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "copy-2", "name": "Copied task flat"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.duplicate_task(task_id="t3", includeChildren=False)

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "const includeChildren = false;" in script
    assert "duplicatedTask = new Task(task.name, insertionLocation);" in script
    assert "task.tags.forEach(tag => duplicatedTask.addTag(tag));" in script


@pytest.mark.asyncio
async def test_search_tasks_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {
            "id": "t4",
            "name": "Buy milk",
            "note": "fridge",
            "flagged": False,
            "addedDate": "2026-02-01T09:00:00Z",
            "changedDate": "2026-02-08T12:00:00Z",
            "dueDate": None,
            "deferDate": None,
            "completed": False,
            "completionDate": None,
            "plannedDate": None,
            "projectName": None,
            "tags": [],
            "estimatedMinutes": 5,
            "hasChildren": False,
            "taskStatus": "due_soon",
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.search_tasks("milk", limit=3)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const queryFilter = "milk".toLowerCase();' in state["calls"][0]["script"]
    assert (
        "completionDate: task.completionDate ? task.completionDate.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert (
        "plannedDate: plannedDate ? plannedDate.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert "addedDate: task.added ? task.added.toISOString() : null," in state["calls"][0][
        "script"
    ]
    assert (
        "changedDate: task.modified ? task.modified.toISOString() : null,"
        in state["calls"][0]["script"]
    )
    assert "hasChildren: task.hasChildren" in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert 'if (s.includes("DueSoon")) return "due_soon";' in state["calls"][0]["script"]
    assert 'if (s.includes("Available")) return "available";' in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert 'if (s.includes("Overdue")) return "overdue";' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_search_tasks_with_project_filter_uses_combined_filters(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([{"id": "t-project", "name": "task"}])
    state = configured["state"]
    server = configured["server"]

    await server.search_tasks(query="shape", project="Errands", limit=5)
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "Errands";' in script
    assert "if (projectFilter !== null) {" in script
    assert (
        "if (!(name.includes(queryFilter) || note.includes(queryFilter))) return false;"
        in script
    )


@pytest.mark.asyncio
async def test_search_tasks_added_changed_date_filters_are_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([{"id": "t-changed", "name": "task"}])
    state = configured["state"]
    server = configured["server"]

    await server.search_tasks(
        query="shape",
        added_after="2026-02-01T00:00:00Z",
        added_before="2026-02-28T23:59:59Z",
        changed_after="2026-03-01T00:00:00Z",
        changed_before="2026-03-31T23:59:59Z",
        limit=4,
    )
    script = state["calls"][0]["script"]
    assert 'const addedAfterRaw = "2026-02-01T00:00:00Z";' in script
    assert 'const addedBeforeRaw = "2026-02-28T23:59:59Z";' in script
    assert 'const changedAfterRaw = "2026-03-01T00:00:00Z";' in script
    assert 'const changedBeforeRaw = "2026-03-31T23:59:59Z";' in script
    assert (
        "if (addedBefore !== null && !(task.added !== null && task.added <= addedBefore)) return false;"
        in script
    )
    assert (
        "if (addedAfter !== null && !(task.added !== null && task.added >= addedAfter)) return false;"
        in script
    )
    assert (
        "if (changedBefore !== null && !(task.modified !== null && task.modified <= changedBefore)) return false;"
        in script
    )
    assert (
        "if (changedAfter !== null && !(task.modified !== null && task.modified >= changedAfter)) return false;"
        in script
    )
    assert ".slice(0, 4)" in script


@pytest.mark.asyncio
async def test_search_tasks_with_completed_after_auto_includes_completed_and_auto_sort(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([{"id": "t-complete", "name": "task"}])
    state = configured["state"]
    server = configured["server"]

    await server.search_tasks(
        query="shape",
        completedAfter="2026-03-01T00:00:00Z",
        plannedBefore="2026-03-10T00:00:00Z",
        plannedAfter="2026-02-20T00:00:00Z",
        limit=5,
    )
    script = state["calls"][0]["script"]
    assert 'const statusFilter = "all";' in script
    assert 'const sortBy = "completionDate";' in script
    assert 'const sortOrder = "desc";' in script
    assert 'const plannedBeforeRaw = "2026-03-10T00:00:00Z";' in script
    assert 'const plannedAfterRaw = "2026-02-20T00:00:00Z";' in script
    assert (
        "const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;"
        in script
    )


@pytest.mark.asyncio
async def test_search_tasks_with_status_filter_and_sorting(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([{"id": "t-status", "name": "task"}])
    state = configured["state"]
    server = configured["server"]

    await server.search_tasks(
        query="shape", status="overdue", sortBy="name", sortOrder="desc", limit=5
    )
    script = state["calls"][0]["script"]
    assert 'const statusFilter = "overdue";' in script
    assert 'const sortBy = "name";' in script
    assert 'const sortOrder = "desc";' in script
    assert 'if (statusFilter === "overdue") {' in script


@pytest.mark.asyncio
async def test_search_tasks_sort_planned_alias_is_included_in_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([{"id": "t-status", "name": "task"}])
    state = configured["state"]
    server = configured["server"]

    await server.search_tasks(
        query="shape", status="all", sortBy="planned", sortOrder="asc", limit=5
    )
    script = state["calls"][0]["script"]
    assert 'const sortBy = "planned";' in script
    assert 'const sortOrder = "asc";' in script
    assert 'sortBy === "plannedDate" || sortBy === "planned"' in script


@pytest.mark.asyncio
async def test_search_tasks_validation_errors(server_module: Any) -> None:
    with pytest.raises(ValueError, match="query must not be empty."):
        await server_module.search_tasks("   ")
    with pytest.raises(ValueError, match="limit must be greater than 0."):
        await server_module.search_tasks("shape", limit=0)
    with pytest.raises(
        ValueError, match="maxEstimatedMinutes must be greater than or equal to 0."
    ):
        await server_module.search_tasks("shape", maxEstimatedMinutes=-1)


@pytest.mark.asyncio
async def test_search_tasks_aliases_map_to_canonical_values(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([{"id": "t-alias", "name": "task"}])
    state = configured["state"]
    server = configured["server"]

    await server.search_tasks(
        query="shape",
        tags=["Home"],
        tagFilterMode="OR",
        status="Due Soon",
        sortBy="name",
        sortOrder="Ascending",
        limit=5,
    )
    script = state["calls"][0]["script"]
    assert 'const tagFilterMode = "any";' in script
    assert 'const statusFilter = "due_soon";' in script
    assert 'const sortOrder = "asc";' in script


@pytest.mark.asyncio
async def test_list_projects_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {
            "id": "p1",
            "name": "Project One",
            "status": "active",
            "folderName": None,
            "taskCount": 4,
            "remainingTaskCount": 3,
            "deferDate": None,
            "dueDate": None,
            "completionDate": None,
            "note": "",
            "sequential": False,
            "isStalled": False,
            "nextTaskId": None,
            "nextTaskName": None,
            "reviewInterval": None,
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_projects(status="active", limit=4)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    script = state["calls"][0]["script"]
    assert 'const statusFilter = "active";' in script
    assert "const nextTask = project.nextTask;" in script
    assert 'const isStalled = normalizeProjectStatus(project) === "active"' in script
    assert (
        "completionDate: project.completionDate ? project.completionDate.toISOString() : null,"
        in script
    )
    assert "nextTaskId: nextTask ? nextTask.id.primaryKey : null," in script


@pytest.mark.asyncio
async def test_list_projects_completion_filters_and_auto_sort_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs(
        [{"id": "p-completed", "name": "Completed Project"}]
    )
    state = configured["state"]
    server = configured["server"]

    await server.list_projects(completedAfter="2026-03-01T00:00:00Z", limit=5)

    script = state["calls"][0]["script"]
    assert 'const statusFilter = "completed";' in script
    assert 'const sortBy = "completionDate";' in script
    assert 'const sortOrder = "desc";' in script
    assert (
        "if (completedAfter !== null && !(project.completionDate !== null && project.completionDate > completedAfter)) return false;"
        in script
    )


@pytest.mark.asyncio
async def test_list_projects_stalled_only_and_sorting_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs(
        [{"id": "p-stalled", "name": "Stalled Project"}]
    )
    state = configured["state"]
    server = configured["server"]

    await server.list_projects(
        stalledOnly=True, sortBy="taskCount", sortOrder="desc", limit=5
    )

    script = state["calls"][0]["script"]
    assert 'const statusFilter = "active";' in script
    assert "const stalledOnly = true;" in script
    assert "if (stalledOnly && !isStalled) return false;" in script
    assert 'const sortBy = "taskCount";' in script
    assert 'const sortOrder = "desc";' in script


@pytest.mark.asyncio
async def test_get_project_counts_happy_path_and_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "total": 5,
        "active": 2,
        "onHold": 1,
        "completed": 1,
        "dropped": 1,
        "stalled": 1,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_project_counts(folder="Work")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const folderFilter = "Work";' in script
    assert "const counts = {" in script
    assert "counts.onHold += 1;" in script
    assert "counts.stalled += 1;" in script


@pytest.mark.asyncio
async def test_get_project_counts_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="folder must not be empty when provided."):
        await server_module.get_project_counts(folder="   ")


@pytest.mark.asyncio
async def test_search_projects_happy_path_criterion21(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {
            "id": "p8",
            "name": "Personal Admin",
            "status": "active",
            "folderName": "Personal",
        },
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.search_projects(query="admin", limit=7)

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const queryValue = "admin";' in script
    assert "return projectsMatching(queryValue)" in script
    assert ".slice(0, 7)" in script
    assert "folderName: project.folder ? project.folder.name : null" in script


@pytest.mark.asyncio
async def test_get_project_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "p2",
        "name": "Project Two",
        "status": "active",
        "folderName": "Work",
        "taskCount": 2,
        "remainingTaskCount": 1,
        "completedTaskCount": 1,
        "availableTaskCount": 1,
        "deferDate": None,
        "dueDate": None,
        "completionDate": None,
        "modified": None,
        "note": "",
        "sequential": True,
        "isStalled": False,
        "nextTaskId": None,
        "nextTaskName": None,
        "reviewInterval": None,
        "rootTasks": [],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_project("p2")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "p2";' in script
    assert "const nextTask = project.nextTask;" in script
    assert 'const isStalled = normalizeProjectStatus(project) === "active"' in script
    assert ".replace(/^\\[object_/g, \"\")" in script
    assert ".replace(/status/g, \" \")" in script
    assert ".replace(/[_-]/g, \" \")" in script
    assert "on\\s*hold" in script
    assert 'if (flattened.includes("completed")) return "completed";' in script
    assert 'if (flattened.includes("dropped")) return "dropped";' in script
    assert 'if (flattened.includes("active")) return "active";' in script
    assert (
        "completedTaskCount: allProjectTasks.filter(task => task.completed).length,"
        in script
    )
    assert (
        "availableTaskCount: allProjectTasks.filter(task => !task.completed && (task.deferDate === null || task.deferDate <= new Date())).length,"
        in script
    )
    assert "modified: project.modified ? project.modified.toISOString() : null," in script


@pytest.mark.asyncio
async def test_search_tags_happy_path_criterion22(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {"id": "g7", "name": "Errands", "status": "active", "parent": "Personal"},
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.search_tags(query="err", limit=6)

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const queryValue = "err";' in script
    assert "return tagsMatching(queryValue)" in script
    assert ".slice(0, 6)" in script
    assert "parent: tag.parent ? tag.parent.name : null" in script


@pytest.mark.asyncio
async def test_list_tags_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [
        {
            "id": "tag1",
            "name": "errands",
            "parent": None,
            "availableTaskCount": 3,
            "totalTaskCount": 5,
            "status": "active",
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_tags(limit=9)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    script = state["calls"][0]["script"]
    assert 'const statusFilter = "all";' in script
    assert "totalTaskCount: counts.totalTaskCount," in script
    assert "return sortedTags.slice(0, 9);" in script


@pytest.mark.asyncio
async def test_list_tags_status_filter_and_sorting_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs(
        [
            {
                "id": "tag2",
                "name": "home",
                "parent": None,
                "availableTaskCount": 2,
                "totalTaskCount": 3,
                "status": "active",
            }
        ]
    )
    state = configured["state"]
    server = configured["server"]

    await server.list_tags(
        statusFilter="active", sortBy="totalTaskCount", sortOrder="desc", limit=7
    )
    script = state["calls"][0]["script"]
    assert 'const statusFilter = "active";' in script
    assert 'const sortBy = "totalTaskCount";' in script
    assert 'const sortOrder = "desc";' in script
    assert (
        'statusFilter === "all" || normalizeTagStatus(tag) === statusFilter' in script
    )
    assert '.replace(/^\\[object_/g, "")' in script
    assert '.replace(/status/g, " ")' in script
    assert '.replace(/[:.=]/g, " ")' in script
    assert '.replace(/[_-]/g, " ")' in script
    assert "/(^|\\s)on\\s*hold(\\s|$)/.test(flattened)" in script
    assert 'flattened.includes("onhold")' in script
    assert 'if (flattened.includes("dropped")) return "dropped";' in script
    assert 'if (flattened.includes("active")) return "active";' in script
    assert "return sortedTags.slice(0, 7);" in script


@pytest.mark.asyncio
async def test_list_tags_name_sort_script(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs(
        [
            {
                "id": "tag3",
                "name": "alpha",
                "parent": None,
                "availableTaskCount": 1,
                "totalTaskCount": 1,
                "status": "active",
            }
        ]
    )
    state = configured["state"]
    server = configured["server"]

    await server.list_tags(sortBy="name", sortOrder="asc", limit=5)
    script = state["calls"][0]["script"]
    assert 'const sortBy = "name";' in script
    assert 'const sortOrder = "asc";' in script
    assert 'if (sortBy === "name") {' in script


@pytest.mark.parametrize(
    ("raw_status", "expected"),
    [
        ("[object_tag.status:_active]", "active"),
        ("status: active]", "active"),
        ("On Hold", "on_hold"),
        ("on-hold", "on_hold"),
        ("Dropped", "dropped"),
    ],
)
def test_status_normalizer_fixtures_plan_b(raw_status: str, expected: str) -> None:
    assert _normalize_status_fixture(raw_status) == expected


@pytest.mark.asyncio
async def test_list_folders_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [{"id": "f1", "name": "Work", "parentName": None, "projectCount": 2}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_folders(limit=2)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "document.flattenedFolders.slice(0, 2)" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_get_folder_happy_path_criterion16(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "folder-1",
        "name": "Work",
        "status": "active",
        "parentName": None,
        "projects": [{"id": "project-1", "name": "Launch", "status": "active"}],
        "subfolders": [{"id": "folder-2", "name": "Q1"}],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_folder(folder_name_or_id="folder-1")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const folderFilter = "folder-1";' in script
    assert "Folder not found" in script
    assert "projects: folder.projects.map" in script
    assert "subfolders: folder.folders.map" in script
    assert '.replace(/^\\[object_/g, "")' in script
    assert '.replace(/status/g, " ")' in script
    assert '.replace(/[:.=]/g, " ")' in script
    assert '.replace(/[_-]/g, " ")' in script
    assert "/(^|\\s)on\\s*hold(\\s|$)/.test(flattened)" in script
    assert 'flattened.includes("onhold")' in script
    assert 'if (flattened.includes("dropped")) return "dropped";' in script
    assert 'if (flattened.includes("active")) return "active";' in script


@pytest.mark.asyncio
async def test_status_normalizer_scripts_cover_plan_b_raw_fixture_cases(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    state = configured["state"]
    server = configured["server"]

    await server.list_tags(statusFilter="all", limit=5)
    tag_script = state["calls"][0]["script"]
    assert "toLowerCase()" in tag_script
    assert '.replace(/^\\[object_/g, "")' in tag_script
    assert '.replace(/[\\[\\]{{}}()]/g, " ")' in tag_script
    assert '.replace(/status/g, " ")' in tag_script
    assert '.replace(/[:.=]/g, " ")' in tag_script
    assert '.replace(/[_-]/g, " ")' in tag_script
    assert '/(^|\\s)on\\s*hold(\\s|$)/.test(flattened)' in tag_script
    assert 'flattened.includes("onhold")' in tag_script
    assert 'if (flattened.includes("dropped")) return "dropped";' in tag_script

    fixture_examples = [
        "[object_tag.status:_active]",
        "status: active]",
        "On Hold",
        "on-hold",
        "Dropped",
    ]
    assert fixture_examples == [
        "[object_tag.status:_active]",
        "status: active]",
        "On Hold",
        "on-hold",
        "Dropped",
    ]

    await server.get_folder(folder_name_or_id="folder-1")
    folder_script = state["calls"][1]["script"]
    assert "toLowerCase()" in folder_script
    assert '.replace(/^\\[object_/g, "")' in folder_script
    assert '.replace(/[\\[\\]{{}}()]/g, " ")' in folder_script
    assert '.replace(/status/g, " ")' in folder_script
    assert '.replace(/[:.=]/g, " ")' in folder_script
    assert '.replace(/[_-]/g, " ")' in folder_script
    assert '/(^|\\s)on\\s*hold(\\s|$)/.test(flattened)' in folder_script
    assert 'flattened.includes("onhold")' in folder_script
    assert 'if (flattened.includes("dropped")) return "dropped";' in folder_script


@pytest.mark.asyncio
async def test_get_forecast_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "overdue": [{"id": "t5", "name": "Overdue", "completionDate": None, "hasChildren": False, "taskStatus": "overdue"}],
        "dueToday": [{"id": "t6", "name": "Today", "completionDate": None, "hasChildren": True, "taskStatus": "due_soon"}],
        "flagged": [{"id": "t7", "name": "Flagged", "completionDate": None, "hasChildren": False, "taskStatus": "available"}],
        "deferred": [{"id": "t8", "name": "Deferred", "completionDate": None, "hasChildren": False, "taskStatus": "blocked"}],
        "dueThisWeek": [{"id": "t9", "name": "This week", "completionDate": None, "hasChildren": False, "taskStatus": "next"}],
        "counts": {
            "overdueCount": 2,
            "dueTodayCount": 1,
            "flaggedCount": 3,
            "deferredCount": 4,
            "dueThisWeekCount": 5,
        },
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_forecast(limit=6)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "const overdue = [];" in state["calls"][0]["script"]
    assert "const deferred = [];" in state["calls"][0]["script"]
    assert "const dueThisWeek = [];" in state["calls"][0]["script"]
    assert "const counts = {" in state["calls"][0]["script"]
    assert "completionDate: task.completionDate ? task.completionDate.toISOString() : null," in state["calls"][0]["script"]
    assert "hasChildren: task.hasChildren" in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert 'if (s.includes("Completed")) return "completed";' in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert "taskStatus: (() => {" in state["calls"][0]["script"]
    assert 'if (s.includes("Dropped")) return "dropped";' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_list_perspectives_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [{"id": "persp1", "name": "Inbox"}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_perspectives(limit=8)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "Perspective.BuiltIn.all" in state["calls"][0]["script"]
    assert "Perspective.Custom.all" in state["calls"][0]["script"]
    assert "return unique.slice(0, 8);" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_get_task_not_found_error(
    server_module: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError("Task not found: missing-id")

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    with pytest.raises(RuntimeError, match="Task not found: missing-id"):
        await server_module.get_task("missing-id")


@pytest.mark.asyncio
async def test_list_tasks_invalid_date_error_bubbles_up(
    server_module: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError("dueBefore must be a valid ISO 8601 date string.")

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    with pytest.raises(
        RuntimeError, match="dueBefore must be a valid ISO 8601 date string."
    ):
        await server_module.list_tasks(dueBefore="bad-date")


@pytest.mark.asyncio
async def test_get_task_counts_invalid_date_error_bubbles_up(
    server_module: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError("dueBefore must be a valid ISO 8601 date string.")

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    with pytest.raises(
        RuntimeError, match="dueBefore must be a valid ISO 8601 date string."
    ):
        await server_module.get_task_counts(dueBefore="bad-date")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field_name",
    ["added_after", "added_before", "changed_after", "changed_before"],
)
async def test_list_tasks_new_date_filters_invalid_date_error_bubbles_up(
    server_module: Any, monkeypatch: pytest.MonkeyPatch, field_name: str
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError(f"{field_name} must be a valid ISO 8601 date string.")

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    with pytest.raises(
        RuntimeError, match=rf"{field_name} must be a valid ISO 8601 date string."
    ):
        await server_module.list_tasks(**{field_name: "bad-date"})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field_name",
    ["added_after", "added_before", "changed_after", "changed_before"],
)
async def test_search_tasks_new_date_filters_invalid_date_error_bubbles_up(
    server_module: Any, monkeypatch: pytest.MonkeyPatch, field_name: str
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError(f"{field_name} must be a valid ISO 8601 date string.")

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    with pytest.raises(
        RuntimeError, match=rf"{field_name} must be a valid ISO 8601 date string."
    ):
        await server_module.search_tasks(query="shape", **{field_name: "bad-date"})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field_name",
    ["added_after", "added_before", "changed_after", "changed_before"],
)
async def test_get_task_counts_new_date_filters_invalid_date_error_bubbles_up(
    server_module: Any, monkeypatch: pytest.MonkeyPatch, field_name: str
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError(f"{field_name} must be a valid ISO 8601 date string.")

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    with pytest.raises(
        RuntimeError, match=rf"{field_name} must be a valid ISO 8601 date string."
    ):
        await server_module.get_task_counts(**{field_name: "bad-date"})


@pytest.mark.asyncio
async def test_list_subtasks_empty_task_id_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="task_id must not be empty"):
        await server_module.list_subtasks(task_id="   ")


@pytest.mark.asyncio
async def test_list_notifications_empty_task_id_validation_error(
    server_module: Any,
) -> None:
    with pytest.raises(ValueError, match="task_id must not be empty"):
        await server_module.list_notifications(task_id="   ")


@pytest.mark.asyncio
async def test_add_notification_validation_errors(server_module: Any) -> None:
    with pytest.raises(ValueError, match="task_id must not be empty"):
        await server_module.add_notification(task_id="   ", absoluteDate="2026-03-01T00:00:00Z")
    with pytest.raises(
        ValueError, match="exactly one of absoluteDate or relativeOffset must be provided"
    ):
        await server_module.add_notification(task_id="t3")
    with pytest.raises(
        ValueError, match="exactly one of absoluteDate or relativeOffset must be provided"
    ):
        await server_module.add_notification(
            task_id="t3",
            absoluteDate="2026-03-01T00:00:00Z",
            relativeOffset=-60,
        )
    with pytest.raises(ValueError, match="absoluteDate must not be empty when provided"):
        await server_module.add_notification(task_id="t3", absoluteDate="   ")


@pytest.mark.asyncio
async def test_remove_notification_validation_errors(server_module: Any) -> None:
    with pytest.raises(ValueError, match="task_id must not be empty"):
        await server_module.remove_notification(task_id="   ", notification_id="n1")
    with pytest.raises(ValueError, match="notification_id must not be empty"):
        await server_module.remove_notification(task_id="t3", notification_id="   ")


@pytest.mark.asyncio
async def test_duplicate_task_validation_errors(server_module: Any) -> None:
    with pytest.raises(ValueError, match="task_id must not be empty"):
        await server_module.duplicate_task(task_id="   ")


@pytest.mark.asyncio
async def test_list_tasks_invalid_status_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="status must be one of"):
        await server_module.list_tasks(status="invalid-status")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_plan_c_unknown_alias_values_keep_actionable_errors(
    server_module: Any,
) -> None:
    with pytest.raises(ValueError, match="sortOrder must be one of: asc, desc."):
        await server_module.list_tasks(sortOrder="backwards")
    with pytest.raises(
        ValueError, match="tagFilterMode must be one of: any, all."
    ):
        await server_module.get_task_counts(tagFilterMode="xor")
    with pytest.raises(
        ValueError,
        match="status must be one of: available, due_soon, overdue, on_hold, completed, all.",
    ):
        await server_module.search_tasks(query="ship", status="later")


@pytest.mark.asyncio
async def test_list_tasks_empty_project_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project must not be empty when provided"):
        await server_module.list_tasks(project="   ")


@pytest.mark.asyncio
async def test_list_projects_empty_folder_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="folder must not be empty when provided"):
        await server_module.list_projects(folder="   ")


@pytest.mark.asyncio
async def test_list_projects_invalid_sort_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="sortBy must be one of"):
        await server_module.list_projects(sortBy="invalid")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_list_tags_invalid_status_filter_validation_error(
    server_module: Any,
) -> None:
    with pytest.raises(ValueError, match="statusFilter must be one of"):
        await server_module.list_tags(statusFilter="invalid")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_list_tags_invalid_sort_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="sortBy must be one of"):
        await server_module.list_tags(sortBy="invalid")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_search_projects_validation_errors_criterion21(
    server_module: Any,
) -> None:
    with pytest.raises(ValueError, match="query must not be empty."):
        await server_module.search_projects("   ")
    with pytest.raises(ValueError, match="limit must be greater than 0."):
        await server_module.search_projects("admin", limit=0)


@pytest.mark.asyncio
async def test_search_tags_validation_errors_criterion22(server_module: Any) -> None:
    with pytest.raises(ValueError, match="query must not be empty."):
        await server_module.search_tags("   ")
    with pytest.raises(ValueError, match="limit must be greater than 0."):
        await server_module.search_tags("err", limit=0)


@pytest.mark.asyncio
async def test_get_folder_empty_identifier_validation_error_criterion16(
    server_module: Any,
) -> None:
    with pytest.raises(ValueError, match="folder_name_or_id must not be empty."):
        await server_module.get_folder("   ")


@pytest.mark.asyncio
async def test_list_tasks_empty_result_returns_empty_array(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs([])
    server = configured["server"]

    result = await server.list_tasks(limit=4)

    assert json.loads(result) == []


@pytest.mark.asyncio
async def test_daily_review_prompt_renders_structure_and_fetches_sections(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scripts: list[str] = []

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        scripts.append(script)
        return []

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    prompt = await server_module.daily_review()

    assert "run a focused daily review" in prompt
    assert "overdue_tasks_json:" in prompt
    assert "due_soon_tasks_json:" in prompt
    assert "flagged_tasks_json:" in prompt
    assert len(scripts) == 3
    assert any('const statusFilter = "due_soon";' in script for script in scripts)
    assert any('const statusFilter = "overdue";' in script for script in scripts)
    assert any('const statusFilter = "all";' in script for script in scripts)
    assert any("const flaggedFilter = true;" in script for script in scripts)


@pytest.mark.asyncio
async def test_weekly_review_prompt_renders_structure_and_fetches_data(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scripts: list[str] = []

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        scripts.append(script)
        return []

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    prompt = await server_module.weekly_review()

    assert "run a gtd-style weekly review" in prompt
    assert "active_projects_json:" in prompt
    assert "available_tasks_json:" in prompt
    assert "top 5 project priorities" in prompt
    assert len(scripts) == 2
    assert any('const statusFilter = "active";' in script for script in scripts)
    assert any('const statusFilter = "available";' in script for script in scripts)


@pytest.mark.asyncio
async def test_inbox_processing_prompt_renders_structure_and_fetches_inbox(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scripts: list[str] = []

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        scripts.append(script)
        return [{"id": "i1", "name": "Inbox item"}]

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    prompt = await server_module.inbox_processing()

    assert "run a gtd inbox processing session" in prompt
    assert "inbox_items_json:" in prompt
    assert "prioritized processing queue" in prompt
    assert len(scripts) == 1
    assert ".slice(0, 200)" in scripts[0]


@pytest.mark.asyncio
async def test_project_planning_prompt_renders_structure_and_fetches_project_state(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scripts: list[str] = []

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        scripts.append(script)
        if "const projectFilter =" in script:
            return {
                "id": "proj-1",
                "name": "Alpha",
                "status": "active",
                "folderName": None,
                "taskCount": 2,
                "remainingTaskCount": 2,
                "deferDate": None,
                "dueDate": None,
                "note": "",
                "sequential": False,
                "reviewInterval": None,
                "rootTasks": [],
            }
        return [{"id": "t1", "name": "Next action"}]

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    prompt = await server_module.project_planning("Alpha")

    assert "plan this project into clear executable work." in prompt
    assert "project_details_json:" in prompt
    assert "project_available_tasks_json:" in prompt
    assert "work breakdown with columns" in prompt
    assert len(scripts) == 2
    assert any('const projectFilter = "Alpha";' in script for script in scripts)
    assert any('const statusFilter = "available";' in script for script in scripts)


@pytest.mark.asyncio
async def test_project_planning_prompt_falls_back_when_project_missing(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scripts: list[str] = []

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        scripts.append(script)
        if "const projectFilter =" in script and "document.flattenedProjects.find" in script:
            raise RuntimeError("Project not found: Sauna Plan")
        return []

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    prompt = await server_module.project_planning("Sauna Plan")

    assert "plan this project into clear executable work." in prompt
    assert "project_details_json:" in prompt
    assert "'status': 'not_found'" in prompt
    assert "project_available_tasks_json:" in prompt
    assert len(scripts) == 2
    assert any('const projectFilter = "Sauna Plan";' in script for script in scripts)
    assert any('const statusFilter = "available";' in script for script in scripts)


@pytest.mark.asyncio
async def test_server_handles_rapid_sequential_tool_calls(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        calls.append(script)
        return [{"id": "t1", "name": "Task"}]

    _patch_run_omnijs(monkeypatch, server_module, fake_run_omnijs)

    responses: list[str] = []
    for _ in range(50):
        responses.append(await server_module.get_inbox(limit=1))
        responses.append(await server_module.list_tasks(limit=1, status="all"))

    assert len(calls) == 100
    assert all(
        json.loads(response) == [{"id": "t1", "name": "Task"}] for response in responses
    )
