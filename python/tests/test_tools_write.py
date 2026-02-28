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
    for module_name in (
        "omnifocus_mcp.tools.tasks",
        "omnifocus_mcp.tools.projects",
        "omnifocus_mcp.tools.tags",
        "omnifocus_mcp.tools.folders",
        "omnifocus_mcp.tools.forecast",
        "omnifocus_mcp.tools.perspectives",
    ):
        monkeypatch.setattr(importlib.import_module(module_name), "run_omnijs", fake_run_omnijs)
    def configure(result: Any) -> dict[str, Any]:
        state["result"] = result
        return {"state": state, "server": server_module}

    return configure


@pytest.mark.asyncio
async def test_create_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "nt1", "name": "Buy groceries"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_task(
        name="Buy groceries",
        project="Errands",
        note="milk and eggs",
        dueDate="2026-03-01T10:00:00Z",
        deferDate="2026-02-28T10:00:00Z",
        flagged=True,
        tags=["home", "quick"],
        estimatedMinutes=20,
    )

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const taskName = "Buy groceries";' in state["calls"][0]["script"]
    assert 'const projectName = "Errands";' in state["calls"][0]["script"]
    assert "const tagNames = " in state["calls"][0]["script"]
    assert "const estimatedMinutesValue = 20;" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_create_task_optional_field_matrix(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs({"id": "full1", "name": "Full task"})
    state = configured["state"]
    server = configured["server"]

    full_result = await server.create_task(
        name="Full task",
        project="Errands",
        note="all fields",
        dueDate="2026-03-01T10:00:00Z",
        deferDate="2026-02-28T10:00:00Z",
        flagged=True,
        tags=["home"],
        estimatedMinutes=25,
    )

    mock_server_run_omnijs({"id": "req1", "name": "Required only"})
    required_result = await server.create_task(name="Required only")

    assert json.loads(full_result) == {"id": "full1", "name": "Full task"}
    assert json.loads(required_result) == {"id": "req1", "name": "Required only"}
    assert len(state["calls"]) == 2

    full_script = state["calls"][0]["script"]
    required_script = state["calls"][1]["script"]

    assert full_script != required_script
    assert 'const projectName = "Errands";' in full_script
    assert "const projectName = null;" in required_script
    assert 'const noteValue = "all fields";' in full_script
    assert "const noteValue = null;" in required_script
    assert 'const dueDateValue = "2026-03-01T10:00:00Z";' in full_script
    assert "const dueDateValue = null;" in required_script
    assert "const flaggedValue = true;" in full_script
    assert "const flaggedValue = null;" in required_script
    assert 'const tagNames = ["home"];' in full_script
    assert "const tagNames = null;" in required_script
    assert "const estimatedMinutesValue = 25;" in full_script
    assert "const estimatedMinutesValue = null;" in required_script


@pytest.mark.asyncio
async def test_create_tasks_batch_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [{"id": "b1", "name": "Batch One"}, {"id": "b2", "name": "Batch Two"}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_tasks_batch(
        [
            {"name": "Batch One", "project": "Home", "tags": ["one"]},
            {"name": "Batch Two", "flagged": True, "estimatedMinutes": 15},
        ]
    )

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert "const taskInputs = " in state["calls"][0]["script"]
    assert '"name": "Batch One"' in state["calls"][0]["script"]
    assert '"name": "Batch Two"' in state["calls"][0]["script"]
    assert "const created = taskInputs.map" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_complete_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "t1", "name": "Do thing", "completed": True}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.complete_task("t1")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const taskId = "t1";' in state["calls"][0]["script"]
    assert "task.markComplete();" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_update_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {
        "id": "t2",
        "name": "Updated task",
        "note": "new note",
        "flagged": False,
        "dueDate": "2026-03-02T10:00:00Z",
        "deferDate": None,
        "completed": False,
        "projectName": "Work",
        "tags": ["work"],
        "estimatedMinutes": 30,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.update_task(
        task_id="t2",
        name="Updated task",
        note="new note",
        dueDate="2026-03-02T10:00:00Z",
        flagged=False,
        tags=["work"],
        estimatedMinutes=30,
    )

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const taskId = "t2";' in state["calls"][0]["script"]
    assert '"name": "Updated task"' in state["calls"][0]["script"]
    assert '"estimatedMinutes": 30' in state["calls"][0]["script"]
    assert 'if (has("tags")) {' in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_delete_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "t3", "name": "Old task", "deleted": True, "warning": None}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_task("t3")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const taskId = "t3";' in state["calls"][0]["script"]
    assert "task.drop(false);" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_move_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "t4", "name": "Move me", "projectName": "Target", "inInbox": False}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_task(task_id="t4", project="Target")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const taskId = "t4";' in state["calls"][0]["script"]
    assert 'const projectName = "Target";' in state["calls"][0]["script"]
    assert "moveTasks([task], destination);" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_create_project_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "p1"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_project(
        name="Launch Plan",
        folder="Work",
        note="critical",
        dueDate="2026-03-10T10:00:00Z",
        deferDate="2026-03-01T10:00:00Z",
        sequential=True,
    )

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const projectName = "Launch Plan";' in state["calls"][0]["script"]
    assert 'const folderName = "Work";' in state["calls"][0]["script"]
    assert "const sequentialValue = true;" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_complete_project_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "p2", "name": "Project Two", "completed": True}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.complete_project("p2")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const projectFilter = "p2";' in state["calls"][0]["script"]
    assert "project.markComplete();" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_create_tag_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "tag1"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_tag(name="urgent", parent="work")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    assert 'const tagName = "urgent";' in state["calls"][0]["script"]
    assert 'const parentName = "work";' in state["calls"][0]["script"]
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
    for module_name in (
        "omnifocus_mcp.tools.tasks",
        "omnifocus_mcp.tools.projects",
        "omnifocus_mcp.tools.tags",
        "omnifocus_mcp.tools.folders",
        "omnifocus_mcp.tools.forecast",
        "omnifocus_mcp.tools.perspectives",
    ):
        monkeypatch.setattr(importlib.import_module(module_name), "run_omnijs", fake_run_omnijs)

    def configure(result: Any) -> dict[str, Any]:
        state["result"] = result
        return {"state": state, "server": server_module}

    return configure


@pytest.mark.asyncio
async def test_create_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "t1", "name": "Buy milk"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_task(
        name="Buy milk",
        project="Errands",
        note="2%",
        dueDate="2026-03-01T10:00:00Z",
        deferDate="2026-02-28T10:00:00Z",
        flagged=True,
        tags=["home"],
        estimatedMinutes=10,
    )

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskName = "Buy milk";' in script
    assert 'const projectName = "Errands";' in script
    assert 'const tagNames = ["home"];' in script


@pytest.mark.asyncio
async def test_create_tasks_batch_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = [{"id": "t2", "name": "one"}, {"id": "t3", "name": "two"}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_tasks_batch([{"name": "one"}, {"name": "two", "project": "Work"}])

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "const taskInputs = " in script
    assert '"name": "one"' in script
    assert '"project": "Work"' in script


@pytest.mark.asyncio
async def test_create_tasks_batch_uses_single_omnijs_call_for_multiple_tasks(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = [{"id": "t10", "name": "one"}, {"id": "t11", "name": "two"}, {"id": "t12", "name": "three"}]
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_tasks_batch(
        [
            {"name": "one", "project": "Work"},
            {"name": "two", "tags": ["home"]},
            {"name": "three", "flagged": True},
        ]
    )

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    script = state["calls"][0]["script"]
    assert "const taskInputs = " in script
    assert '"name": "one"' in script
    assert '"name": "two"' in script
    assert '"name": "three"' in script


@pytest.mark.asyncio
async def test_complete_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "t4", "name": "Done", "completed": True}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.complete_task("t4")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t4";' in script
    assert "task.markComplete();" in script


@pytest.mark.asyncio
async def test_update_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {
        "id": "t5",
        "name": "Updated",
        "note": "n",
        "flagged": False,
        "dueDate": None,
        "deferDate": None,
        "completed": False,
        "projectName": "Work",
        "tags": ["home"],
        "estimatedMinutes": 20,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.update_task("t5", name="Updated", tags=["home"], estimatedMinutes=20)

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t5";' in script
    assert '"name": "Updated"' in script
    assert '"tags": ["home"]' in script


@pytest.mark.asyncio
async def test_update_task_only_includes_provided_fields_in_updates_payload(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "t5",
        "name": "Renamed",
        "note": "existing note",
        "flagged": True,
        "dueDate": None,
        "deferDate": None,
        "completed": False,
        "projectName": "Work",
        "tags": ["existing"],
        "estimatedMinutes": 10,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    await server.update_task(task_id="t5", name="Renamed", flagged=False)

    assert len(state["calls"]) == 1
    script = state["calls"][0]["script"]
    updates_line = next(line for line in script.splitlines() if line.startswith("const updates = "))
    updates_payload = updates_line.removeprefix("const updates = ").removesuffix(";")
    updates = json.loads(updates_payload)

    assert updates == {"name": "Renamed", "flagged": False}
    assert "note" not in updates
    assert "dueDate" not in updates
    assert "deferDate" not in updates
    assert "tags" not in updates
    assert "estimatedMinutes" not in updates


@pytest.mark.asyncio
async def test_delete_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "t6", "name": "Drop me", "deleted": True, "warning": None}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_task("t6")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t6";' in script
    assert "task.drop(false);" in script


@pytest.mark.asyncio
async def test_move_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "t7", "name": "Moved", "projectName": "Work", "inInbox": False}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_task("t7", project="Work")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t7";' in script
    assert 'const projectName = "Work";' in script
    assert "moveTasks([task], destination);" in script


@pytest.mark.asyncio
async def test_create_project_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "p1"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_project(
        name="Launch",
        folder="Work",
        note="notes",
        dueDate="2026-03-01T10:00:00Z",
        deferDate="2026-02-28T10:00:00Z",
        sequential=True,
    )

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const projectName = "Launch";' in script
    assert 'const folderName = "Work";' in script
    assert "return new Project(projectName, targetFolder.ending);" in script


@pytest.mark.asyncio
async def test_complete_project_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "p2", "name": "Launch", "completed": True}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.complete_project("p2")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "p2";' in script
    assert "project.markComplete();" in script


@pytest.mark.asyncio
async def test_create_tag_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "tag1"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_tag(name="home", parent="areas")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const tagName = "home";' in script
    assert 'const parentName = "areas";' in script
    assert "return new Tag(tagName, parentTag.ending);" in script


@pytest.mark.asyncio
async def test_create_task_optional_fields_vs_required_only(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    configured = mock_server_run_omnijs({"id": "t8", "name": "Full task"})
    state = configured["state"]
    server = configured["server"]

    await server.create_task(
        name="Full task",
        project="Errands",
        note="details",
        dueDate="2026-03-04T10:00:00Z",
        deferDate="2026-03-03T10:00:00Z",
        flagged=True,
        tags=["home", "quick"],
        estimatedMinutes=25,
    )
    full_script = state["calls"][0]["script"]

    state["result"] = {"id": "t9", "name": "Required only"}
    await server.create_task(name="Required only")
    required_only_script = state["calls"][1]["script"]

    assert 'const projectName = "Errands";' in full_script
    assert 'const noteValue = "details";' in full_script
    assert 'const dueDateValue = "2026-03-04T10:00:00Z";' in full_script
    assert 'const deferDateValue = "2026-03-03T10:00:00Z";' in full_script
    assert "const flaggedValue = true;" in full_script
    assert 'const tagNames = ["home", "quick"];' in full_script
    assert "const estimatedMinutesValue = 25;" in full_script

    assert "const projectName = null;" in required_only_script
    assert "const noteValue = null;" in required_only_script
    assert "const dueDateValue = null;" in required_only_script
    assert "const deferDateValue = null;" in required_only_script
    assert "const flaggedValue = null;" in required_only_script
    assert "const tagNames = null;" in required_only_script
    assert "const estimatedMinutesValue = null;" in required_only_script


@pytest.mark.asyncio
async def test_complete_task_nonexistent_id_error(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError("Task not found: missing-id")

    tasks_mod = importlib.import_module("omnifocus_mcp.tools.tasks")
    monkeypatch.setattr(tasks_mod, "run_omnijs", fake_run_omnijs)

    with pytest.raises(RuntimeError, match="Task not found: missing-id"):
        await tasks_mod.complete_task("missing-id")


@pytest.mark.asyncio
async def test_create_task_empty_name_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="name must not be empty."):
        await server_module.create_task("   ")


@pytest.mark.asyncio
async def test_create_task_empty_project_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project must not be empty when provided"):
        await server_module.create_task("Task", project="   ")


@pytest.mark.asyncio
async def test_move_task_empty_project_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project must not be empty when provided"):
        await server_module.move_task("task-1", project="   ")


@pytest.mark.asyncio
async def test_delete_tasks_batch_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "deleted_count": 2,
        "not_found_count": 0,
        "results": [
            {"id": "t1", "name": "Task One", "deleted": True},
            {"id": "t2", "name": "Task Two", "deleted": True},
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_tasks_batch(["t1", "t2"])

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    script = state["calls"][0]["script"]
    assert 'const taskIds = ["t1", "t2"];' in script
    assert "task.drop(false);" in script
    assert "deleted_count" in script


@pytest.mark.asyncio
async def test_delete_tasks_batch_partial_failure(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "deleted_count": 1,
        "not_found_count": 1,
        "results": [
            {"id": "t1", "name": "Task One", "deleted": True},
            {"id": "missing", "deleted": False, "error": "not found"},
        ],
    }
    configured = mock_server_run_omnijs(payload)
    server = configured["server"]

    result = await server.delete_tasks_batch(["t1", "missing"])

    assert json.loads(result) == payload


@pytest.mark.asyncio
async def test_delete_tasks_batch_empty_array_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="task_ids must contain at least one task id."):
        await server_module.delete_tasks_batch([])


@pytest.mark.asyncio
async def test_delete_tasks_batch_empty_string_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="each task id must be a non-empty string."):
        await server_module.delete_tasks_batch(["task-1", "   "])
