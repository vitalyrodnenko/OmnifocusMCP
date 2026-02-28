import json
from collections.abc import Callable
import importlib
import sys
import types
from typing import Any

import pytest

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

    monkeypatch.setattr(server_module, "run_omnijs", fake_run_omnijs)

    def configure(result: Any) -> dict[str, Any]:
        state["result"] = result
        return {"state": state, "server": server_module}

    return configure


@pytest.mark.asyncio
async def test_get_inbox_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = [
        {
            "id": "t1",
            "name": "Inbox Task",
            "note": "n",
            "flagged": False,
            "dueDate": None,
            "deferDate": None,
            "tags": ["home"],
            "estimatedMinutes": 15,
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_inbox(limit=5)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert ".slice(0, 5)" in state["calls"][0]["script"]


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
    payload = {"overdue": [], "dueToday": [{"id": "d1"}], "flagged": [{"id": "f1"}]}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.today_resource()

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "const overdue = openTasks" in state["calls"][0]["script"]


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
async def test_list_tasks_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = [
        {
            "id": "t2",
            "name": "Task",
            "note": "note",
            "flagged": True,
            "dueDate": "2026-03-01T10:00:00Z",
            "deferDate": None,
            "completed": False,
            "projectName": "Proj",
            "tags": ["urgent"],
            "estimatedMinutes": 30,
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_tasks(project="Proj", tag="urgent", flagged=True, status="due_soon", limit=7)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const statusFilter = "due_soon";' in state["calls"][0]["script"]
    assert ".slice(0, 7)" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_get_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {
        "id": "t3",
        "name": "Task 3",
        "note": "",
        "flagged": False,
        "dueDate": None,
        "deferDate": None,
        "completed": False,
        "completionDate": None,
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


@pytest.mark.asyncio
async def test_search_tasks_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = [
        {
            "id": "t4",
            "name": "Buy milk",
            "note": "fridge",
            "flagged": False,
            "dueDate": None,
            "deferDate": None,
            "completed": False,
            "projectName": None,
            "tags": [],
            "estimatedMinutes": 5,
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.search_tasks("milk", limit=3)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const query = "milk".toLowerCase();' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_list_projects_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
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
            "note": "",
            "sequential": False,
            "reviewInterval": None,
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_projects(status="active", limit=4)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const statusFilter = "active";' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_get_project_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {
        "id": "p2",
        "name": "Project Two",
        "status": "active",
        "folderName": "Work",
        "taskCount": 2,
        "remainingTaskCount": 1,
        "deferDate": None,
        "dueDate": None,
        "note": "",
        "sequential": True,
        "reviewInterval": None,
        "rootTasks": [],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_project("p2")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const projectFilter = "p2";' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_list_tags_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = [
        {
            "id": "tag1",
            "name": "errands",
            "parent": None,
            "availableTaskCount": 3,
            "status": "active",
        }
    ]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_tags(limit=9)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "document.flattenedTags.slice(0, 9)" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_list_folders_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = [{"id": "f1", "name": "Work", "parentName": None, "projectCount": 2}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_folders(limit=2)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "document.flattenedFolders.slice(0, 2)" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_get_forecast_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {
        "overdue": [{"id": "t5", "name": "Overdue"}],
        "dueToday": [{"id": "t6", "name": "Today"}],
        "flagged": [{"id": "t7", "name": "Flagged"}],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.get_forecast(limit=6)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "const overdue = openTasks" in state["calls"][0]["script"]
    assert ".slice(0, 6)" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_list_perspectives_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = [{"id": "persp1", "name": "Inbox"}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.list_perspectives(limit=8)

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "Perspective.BuiltIn.all" in state["calls"][0]["script"]
    assert "return unique.slice(0, 8);" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_get_task_not_found_error(server_module: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError("Task not found: missing-id")

    monkeypatch.setattr(server_module, "run_omnijs", fake_run_omnijs)

    with pytest.raises(RuntimeError, match="Task not found: missing-id"):
        await server_module.get_task("missing-id")


@pytest.mark.asyncio
async def test_list_tasks_invalid_status_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="status must be one of"):
        await server_module.list_tasks(status="invalid-status")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_list_tasks_empty_project_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project must not be empty when provided"):
        await server_module.list_tasks(project="   ")


@pytest.mark.asyncio
async def test_list_projects_empty_folder_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="folder must not be empty when provided"):
        await server_module.list_projects(folder="   ")


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

    monkeypatch.setattr(server_module, "run_omnijs", fake_run_omnijs)

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

    monkeypatch.setattr(server_module, "run_omnijs", fake_run_omnijs)

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

    monkeypatch.setattr(server_module, "run_omnijs", fake_run_omnijs)

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

    monkeypatch.setattr(server_module, "run_omnijs", fake_run_omnijs)

    prompt = await server_module.project_planning("Alpha")

    assert "plan this project into clear executable work." in prompt
    assert "project_details_json:" in prompt
    assert "project_available_tasks_json:" in prompt
    assert "work breakdown with columns" in prompt
    assert len(scripts) == 2
    assert any('const projectFilter = "Alpha";' in script for script in scripts)
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

    monkeypatch.setattr(server_module, "run_omnijs", fake_run_omnijs)

    responses: list[str] = []
    for _ in range(50):
        responses.append(await server_module.get_inbox(limit=1))
        responses.append(await server_module.list_tasks(limit=1, status="all"))

    assert len(calls) == 100
    assert all(json.loads(response) == [{"id": "t1", "name": "Task"}] for response in responses)
