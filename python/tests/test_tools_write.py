import json
from collections.abc import Callable
import inspect
import importlib
import sys
import types
from typing import Any

import pytest

@pytest.fixture
def server_module_duplicate(monkeypatch: pytest.MonkeyPatch) -> Any:
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
def mock_server_run_omnijs_duplicate(
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
async def test_create_task_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
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
async def test_create_subtask_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "child-1",
        "name": "Child task",
        "parentTaskId": "parent-1",
        "parentTaskName": "Parent task",
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    tasks_mod = importlib.import_module("omnifocus_mcp.tools.tasks")

    result = await tasks_mod.create_subtask(
        name="Child task",
        parent_task_id="parent-1",
        note="detail",
        dueDate="2026-03-10T10:00:00Z",
        deferDate="2026-03-09T10:00:00Z",
        flagged=True,
        tags=["home"],
        estimatedMinutes=15,
    )

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskName = "Child task";' in script
    assert 'const parentTaskId = "parent-1";' in script
    assert "const parentTask = document.flattenedTasks.find" in script
    assert "const task = new Task(taskName, parentTask.ending);" in script


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
    assert "deleteObject(task);" in state["calls"][0]["script"]


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
    assert "moveTasks([task], destinationInfo.location);" in state["calls"][0]["script"]


@pytest.mark.asyncio
async def test_move_task_to_inbox_when_destination_omitted(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t4", "name": "Move me", "projectName": None, "inInbox": True}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_task(task_id="t4")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "const projectName = null;" in script
    assert "const parentTaskId = null;" in script
    assert "if (projectName === null || projectName === \"\") {" in script
    assert "return { mode: \"inbox\", location: inbox.ending };" in script


@pytest.mark.asyncio
async def test_move_task_parent_destination_includes_self_and_cycle_guards(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t5", "name": "Move me", "projectName": "Work", "inInbox": False}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_task(task_id="t5", parent_task_id="parent-1")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const parentTaskId = "parent-1";' in script
    assert 'throw new Error("Cannot move a task under itself.");' in script
    assert 'throw new Error("Cannot move a task under its own descendant.");' in script
    assert 'return { mode: "parent", location: parentTask.ending };' in script
    assert "moveTasks([task], destinationInfo.location);" in script


@pytest.mark.asyncio
async def test_move_task_under_parent_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "child-1", "name": "Child", "projectName": "Work", "inInbox": False}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_task(task_id="child-1", parent_task_id="parent-1")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const parentTaskId = "parent-1";' in script
    assert "if (parentTaskId === taskId) {" in script
    assert "throw new Error(\"Cannot move a task under itself.\");" in script
    assert "throw new Error(\"Cannot move a task under its own descendant.\");" in script
    assert "return { mode: \"parent\", location: parentTask.ending };" in script
    assert set(json.loads(result).keys()) == {"id", "name", "projectName", "inInbox"}


@pytest.mark.asyncio
async def test_move_task_signature_uses_parity_parameter_names(server_module: Any) -> None:
    signature = inspect.signature(server_module.move_task)
    assert list(signature.parameters.keys()) == ["task_id", "project", "parent_task_id"]


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
async def test_uncomplete_project_happy_path_criterion7(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "p2", "name": "Project Two", "status": "active"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.uncomplete_project("p2")

    assert json.loads(result) == payload
    assert len(state["calls"]) == 1
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "p2";' in script
    assert "if (!project.completed) {" in script
    assert "project.markIncomplete();" in script
    assert 'status: "active"' in script


@pytest.mark.asyncio
async def test_update_project_happy_path_criterion8(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "p3",
        "name": "Updated Project",
        "status": "active",
        "folderName": "Work",
        "taskCount": 3,
        "remainingTaskCount": 2,
        "deferDate": "2026-03-01T10:00:00Z",
        "dueDate": "2026-03-07T10:00:00Z",
        "note": "updated note",
        "flagged": True,
        "sequential": False,
        "completedByChildren": True,
        "tags": ["work", "focus"],
        "reviewInterval": "2 weeks",
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.update_project(
        project_id_or_name="p3",
        name="Updated Project",
        note="updated note",
        dueDate="2026-03-07T10:00:00Z",
        deferDate="2026-03-01T10:00:00Z",
        flagged=True,
        tags=["work", "focus"],
        sequential=False,
        completedByChildren=True,
        reviewInterval="2 weeks",
    )

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "p3";' in script
    assert '"name": "Updated Project"' in script
    assert '"completedByChildren": true' in script
    assert "project.reviewInterval = parseReviewInterval(updates.reviewInterval);" in script
    assert "existingTags.forEach" in script
    assert "project.addTag(tag);" in script

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


@pytest.mark.asyncio
async def test_update_tag_happy_path_criterion13(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "tag-1", "name": "Next", "status": "on_hold"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.update_tag(tag_name_or_id="tag-1", name="Next", status="on_hold")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const tagFilter = "tag-1";' in script
    assert 'const newName = "Next";' in script
    assert 'const statusValue = "on_hold";' in script
    assert "Tag.Status.OnHold" in script
    assert "tag.status = targetStatus;" in script


@pytest.mark.asyncio
async def test_update_tag_validation_error_criterion13(server_module: Any) -> None:
    with pytest.raises(ValueError, match="tag_name_or_id must not be empty."):
        await server_module.update_tag(tag_name_or_id="   ", name="Next")
    with pytest.raises(ValueError, match="at least one field must be provided: name or status."):
        await server_module.update_tag(tag_name_or_id="tag-1")


@pytest.mark.asyncio
async def test_delete_tag_happy_path_criterion14(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "tag-2", "name": "Someday", "deleted": True, "taskCount": 4}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_tag(tag_name_or_id="tag-2")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const tagFilter = "tag-2";' in script
    assert "const taskCount = tag.tasks.length;" in script
    assert "deleteObject(tag);" in script
    assert "taskCount: taskCount" in script


@pytest.mark.asyncio
async def test_delete_tag_validation_error_criterion14(server_module: Any) -> None:
    with pytest.raises(ValueError, match="tag_name_or_id must not be empty."):
        await server_module.delete_tag(tag_name_or_id="   ")


@pytest.mark.asyncio
async def test_create_folder_happy_path_criterion15(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "folder-1", "name": "Areas"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.create_folder(name="Areas", parent="Work")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const folderName = "Areas";' in script
    assert 'const parentName = "Work";' in script
    assert "return new Folder(folderName, parentFolder.ending);" in script


@pytest.mark.asyncio
async def test_create_folder_validation_error_criterion15(server_module: Any) -> None:
    with pytest.raises(ValueError, match="name must not be empty."):
        await server_module.create_folder(name="   ")
    with pytest.raises(ValueError, match="parent must not be empty when provided."):
        await server_module.create_folder(name="Areas", parent="   ")


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


@pytest.mark.asyncio
async def test_get_folder_validation_error_criterion16(server_module: Any) -> None:
    with pytest.raises(ValueError, match="folder_name_or_id must not be empty."):
        await server_module.get_folder(folder_name_or_id="   ")


@pytest.mark.asyncio
async def test_update_folder_happy_path_criterion17(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "folder-1", "name": "Areas", "status": "dropped"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.update_folder(folder_name_or_id="folder-1", name="Areas", status="dropped")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const folderFilter = "folder-1";' in script
    assert 'const newName = "Areas";' in script
    assert 'const statusValue = "dropped";' in script
    assert "Folder.Status.Dropped" in script
    assert "folder.status = targetStatus;" in script


@pytest.mark.asyncio
async def test_update_folder_validation_error_criterion17(server_module: Any) -> None:
    with pytest.raises(ValueError, match="folder_name_or_id must not be empty."):
        await server_module.update_folder(folder_name_or_id="   ", name="Areas")
    with pytest.raises(ValueError, match="name must not be empty when provided."):
        await server_module.update_folder(folder_name_or_id="folder-1", name="   ")
    with pytest.raises(ValueError, match="status must be one of: active, dropped."):
        await server_module.update_folder(folder_name_or_id="folder-1", status="on_hold")
    with pytest.raises(ValueError, match="at least one field must be provided: name or status."):
        await server_module.update_folder(folder_name_or_id="folder-1")


@pytest.mark.asyncio
async def test_delete_folder_happy_path_criterion18(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "id": "folder-1",
        "name": "Areas",
        "deleted": True,
        "projectCount": 2,
        "subfolderCount": 1,
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_folder(folder_name_or_id="folder-1")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const folderFilter = "folder-1";' in script
    assert "const projectCount = folder.projects.length;" in script
    assert "const subfolderCount = folder.folders.length;" in script
    assert "deleteObject(folder);" in script
    assert "projectCount: projectCount" in script
    assert "subfolderCount: subfolderCount" in script


@pytest.mark.asyncio
async def test_delete_folder_validation_error_criterion18(server_module: Any) -> None:
    with pytest.raises(ValueError, match="folder_name_or_id must not be empty."):
        await server_module.delete_folder(folder_name_or_id="   ")


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
async def test_create_tasks_batch_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
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
async def test_complete_task_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
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
async def test_uncomplete_task_happy_path(mock_server_run_omnijs: Callable[[Any], dict[str, Any]]) -> None:
    payload = {"id": "t4", "name": "Done", "completed": False}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.uncomplete_task("t4")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t4";' in script
    assert "if (!task.completed) {" in script
    assert "task.markIncomplete();" in script


@pytest.mark.asyncio
async def test_set_task_repetition_happy_path_criterion5(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t5", "name": "Weekly task", "repetitionRule": "FREQ=WEEKLY"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.set_task_repetition(
        task_id="t5",
        rule_string="FREQ=WEEKLY",
        schedule_type="regularly",
    )

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t5";' in script
    assert 'const ruleString = "FREQ=WEEKLY";' in script
    assert "Task.RepetitionScheduleType.Regularly" in script
    assert "new Task.RepetitionRule(ruleString, null, scheduleType, null, false);" in script


@pytest.mark.asyncio
async def test_set_task_repetition_clear_rule_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t5", "name": "Weekly task", "repetitionRule": None}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.set_task_repetition(task_id="t5", rule_string=None)

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "const ruleString = null;" in script
    assert "task.repetitionRule = null;" in script


@pytest.mark.asyncio
async def test_set_task_repetition_none_schedule_type_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t5", "name": "Weekly task", "repetitionRule": "FREQ=WEEKLY"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.set_task_repetition(
        task_id="t5",
        rule_string="FREQ=WEEKLY",
        schedule_type="none",
    )

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "Task.RepetitionScheduleType.None" in script


@pytest.mark.asyncio
async def test_append_to_note_happy_path_criterion20(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t6", "name": "Task six", "type": "task", "noteLength": 24}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.append_to_note(
        object_type="task",
        object_id="t6",
        text="\nfollow-up details",
    )

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const objectType = "task";' in script
    assert 'const objectId = "t6";' in script
    assert 'const textValue = "\\nfollow-up details";' in script
    assert "obj.appendStringToNote(textValue);" in script
    assert "noteLength: obj.note.length" in script


@pytest.mark.asyncio
async def test_append_to_note_validation_error_criterion20(server_module: Any) -> None:
    with pytest.raises(ValueError, match="object_type must be one of: task, project."):
        await server_module.append_to_note(object_type="folder", object_id="id-1", text="text")
    with pytest.raises(ValueError, match="object_id must not be empty."):
        await server_module.append_to_note(object_type="task", object_id="   ", text="text")
    with pytest.raises(ValueError, match="text must not be empty."):
        await server_module.append_to_note(object_type="project", object_id="p1", text="   ")


@pytest.mark.asyncio
async def test_update_task_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
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
async def test_delete_task_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t6", "name": "Drop me", "deleted": True, "warning": None}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_task("t6")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t6";' in script
    assert "deleteObject(task);" in script


@pytest.mark.asyncio
async def test_move_task_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t7", "name": "Moved", "projectName": "Work", "inInbox": False}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_task("t7", project="Work")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t7";' in script
    assert 'const projectName = "Work";' in script
    assert "moveTasks([task], destinationInfo.location);" in script


@pytest.mark.asyncio
async def test_duplicate_task_happy_path_include_children(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t8-copy", "name": "Original", "hasChildren": True}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.duplicate_task(task_id="t8")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskId = "t8";' in script
    assert "const includeChildren = true;" in script
    assert "const duplicated = duplicateTasks([task], insertionLocation);" in script


@pytest.mark.asyncio
async def test_duplicate_task_happy_path_without_children(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "t8-copy", "name": "Original", "hasChildren": False}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.duplicate_task(task_id="t8", includeChildren=False)

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "const includeChildren = false;" in script
    assert "duplicatedTask = new Task(task.name, insertionLocation);" in script
    assert "task.tags.forEach(tag => duplicatedTask.addTag(tag));" in script


@pytest.mark.asyncio
async def test_create_project_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
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
async def test_complete_project_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
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
async def test_uncomplete_project_happy_path_criterion7_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "p2", "name": "Launch", "status": "active"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.uncomplete_project("p2")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "p2";' in script
    assert "if (!project.completed) {" in script
    assert "project.markIncomplete();" in script
    assert 'status: "active"' in script


@pytest.mark.asyncio
async def test_create_tag_happy_path_duplicate(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
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
async def test_create_subtask_empty_parent_validation_error(server_module: Any) -> None:
    tasks_mod = importlib.import_module("omnifocus_mcp.tools.tasks")
    with pytest.raises(ValueError, match="parent_task_id must not be empty."):
        await tasks_mod.create_subtask("Task", parent_task_id="   ")


@pytest.mark.asyncio
async def test_set_task_repetition_invalid_schedule_type_validation_error(server_module: Any) -> None:
    with pytest.raises(
        ValueError,
        match="schedule_type must be one of: regularly, from_completion, none.",
    ):
        await server_module.set_task_repetition(
            task_id="task-1",
            rule_string="FREQ=DAILY",
            schedule_type="invalid",
        )


@pytest.mark.asyncio
async def test_move_task_empty_project_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project must not be empty when provided"):
        await server_module.move_task("task-1", project="   ")


@pytest.mark.asyncio
async def test_move_task_both_destinations_validation_error(server_module: Any) -> None:
    with pytest.raises(
        ValueError,
        match="provide either project or parent_task_id, not both \\(destination is ambiguous\\)",
    ):
        await server_module.move_task("task-1", project="Work", parent_task_id="parent-1")


@pytest.mark.asyncio
async def test_move_task_self_parenting_rejection_error_propagates(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError("Cannot move a task under itself.")

    tasks_mod = importlib.import_module("omnifocus_mcp.tools.tasks")
    monkeypatch.setattr(tasks_mod, "run_omnijs", fake_run_omnijs)

    with pytest.raises(RuntimeError, match="Cannot move a task under itself."):
        await tasks_mod.move_task("task-1", parent_task_id="task-1")


@pytest.mark.asyncio
async def test_move_task_cycle_rejection_error_propagates(
    server_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError("Cannot move a task under its own descendant.")

    tasks_mod = importlib.import_module("omnifocus_mcp.tools.tasks")
    monkeypatch.setattr(tasks_mod, "run_omnijs", fake_run_omnijs)

    with pytest.raises(RuntimeError, match="Cannot move a task under its own descendant."):
        await tasks_mod.move_task("task-1", parent_task_id="parent-descendant")


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
    assert "deleteObject(task);" in script
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


@pytest.mark.asyncio
async def test_delete_projects_batch_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "summary": {"requested": 2, "deleted": 2, "failed": 0},
        "partial_success": False,
        "results": [
            {
                "id_or_name": "p1",
                "id": "p1",
                "name": "Project One",
                "deleted": True,
                "error": None,
            },
            {
                "id_or_name": "Project Two",
                "id": "p2",
                "name": "Project Two",
                "deleted": True,
                "error": None,
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_projects_batch(["p1", "Project Two"])

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const projectIdsOrNames = ["p1", "Project Two"];' in script
    assert "summary" in script
    assert "partial_success" in script


@pytest.mark.asyncio
async def test_delete_projects_batch_partial_success(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "summary": {"requested": 2, "deleted": 1, "failed": 1},
        "partial_success": True,
        "results": [
            {
                "id_or_name": "p1",
                "id": "p1",
                "name": "Project One",
                "deleted": True,
                "error": None,
            },
            {
                "id_or_name": "missing-project",
                "id": None,
                "name": None,
                "deleted": False,
                "error": "not found",
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    server = configured["server"]

    result = await server.delete_projects_batch(["p1", "missing-project"])

    assert json.loads(result) == payload


@pytest.mark.asyncio
async def test_delete_projects_batch_empty_array_validation_error(
    server_module: Any,
) -> None:
    with pytest.raises(
        ValueError,
        match="project_ids_or_names must contain at least one project id or name.",
    ):
        await server_module.delete_projects_batch([])


@pytest.mark.asyncio
async def test_delete_projects_batch_empty_item_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="each project id or name must be a non-empty string."):
        await server_module.delete_projects_batch(["p1", "   "])


@pytest.mark.asyncio
async def test_delete_projects_batch_duplicate_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project_ids_or_names must not contain duplicates: p1"):
        await server_module.delete_projects_batch(["p1", "p1"])


@pytest.mark.asyncio
async def test_delete_tags_batch_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "summary": {"requested": 2, "deleted": 2, "failed": 0},
        "partial_success": False,
        "results": [
            {
                "id_or_name": "tag-1",
                "id": "tag-1",
                "name": "Urgent",
                "deleted": True,
                "error": None,
            },
            {
                "id_or_name": "Home",
                "id": "tag-2",
                "name": "Home",
                "deleted": True,
                "error": None,
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_tags_batch(["tag-1", "Home"])

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const tagIdsOrNames = ["tag-1", "Home"];' in script
    assert "sort((left, right) => right.depth - left.depth || left.index - right.index)" in script
    assert "const getLiveTagById = (tagId) => {" in script
    assert "deleteObject(liveTag);" in script
    assert "summary" in script
    assert "partial_success" in script


@pytest.mark.asyncio
async def test_delete_tags_batch_partial_success(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "summary": {"requested": 2, "deleted": 1, "failed": 1},
        "partial_success": True,
        "results": [
            {
                "id_or_name": "tag-1",
                "id": "tag-1",
                "name": "Urgent",
                "deleted": True,
                "error": None,
            },
            {
                "id_or_name": "missing-tag",
                "id": None,
                "name": None,
                "deleted": False,
                "error": "not found",
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    server = configured["server"]

    result = await server.delete_tags_batch(["tag-1", "missing-tag"])

    assert json.loads(result) == payload


@pytest.mark.asyncio
async def test_delete_tags_batch_hierarchy_cascade_effective_success_plan_a(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "summary": {"requested": 2, "deleted": 2, "failed": 0},
        "partial_success": False,
        "results": [
            {
                "id_or_name": "parent-tag",
                "id": "tag-parent",
                "name": "Parent Tag",
                "deleted": True,
                "error": None,
            },
            {
                "id_or_name": "child-tag",
                "id": "tag-child",
                "name": "Child Tag",
                "deleted": True,
                "error": None,
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_tags_batch(["parent-tag", "child-tag"])
    parsed = json.loads(result)

    assert parsed == payload
    assert parsed["summary"]["failed"] == 0
    assert parsed["partial_success"] is False
    script = state["calls"][0]["script"]
    assert "parentId: item.parent ? item.parent.id.primaryKey : null" in script
    assert "right.depth - left.depth || left.index - right.index" in script
    assert "if (!existsTagById(resolvedId)) {" in script
    assert "partial_success: deletedCount > 0 && failedCount > 0" in script


@pytest.mark.asyncio
async def test_delete_tags_batch_empty_array_validation_error(server_module: Any) -> None:
    with pytest.raises(
        ValueError, match="tag_ids_or_names must contain at least one tag id or name."
    ):
        await server_module.delete_tags_batch([])


@pytest.mark.asyncio
async def test_delete_tags_batch_empty_item_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="each tag id or name must be a non-empty string."):
        await server_module.delete_tags_batch(["tag-1", "   "])


@pytest.mark.asyncio
async def test_delete_tags_batch_duplicate_validation_error(server_module: Any) -> None:
    with pytest.raises(
        ValueError, match="tag_ids_or_names must not contain duplicates: duplicate-tag"
    ):
        await server_module.delete_tags_batch(["duplicate-tag", "duplicate-tag"])


@pytest.mark.asyncio
async def test_delete_folders_batch_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "summary": {"requested": 2, "deleted": 2, "failed": 0},
        "partial_success": False,
        "results": [
            {
                "id_or_name": "folder-1",
                "id": "folder-1",
                "name": "Areas",
                "deleted": True,
                "error": None,
            },
            {
                "id_or_name": "Work",
                "id": "folder-2",
                "name": "Work",
                "deleted": True,
                "error": None,
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_folders_batch(["folder-1", "Work"])

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const folderIdsOrNames = ["folder-1", "Work"];' in script
    assert "sort((left, right) => right.depth - left.depth || left.index - right.index)" in script
    assert "const getLiveFolderById = (folderId) => {" in script
    assert "deleteObject(liveFolder);" in script
    assert "summary" in script
    assert "partial_success" in script


@pytest.mark.asyncio
async def test_delete_folders_batch_partial_success(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "summary": {"requested": 2, "deleted": 1, "failed": 1},
        "partial_success": True,
        "results": [
            {
                "id_or_name": "folder-1",
                "id": "folder-1",
                "name": "Areas",
                "deleted": True,
                "error": None,
            },
            {
                "id_or_name": "missing-folder",
                "id": None,
                "name": None,
                "deleted": False,
                "error": "not found",
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    server = configured["server"]

    result = await server.delete_folders_batch(["folder-1", "missing-folder"])

    assert json.loads(result) == payload


@pytest.mark.asyncio
async def test_delete_folders_batch_hierarchy_cascade_effective_success_plan_a(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "summary": {"requested": 2, "deleted": 2, "failed": 0},
        "partial_success": False,
        "results": [
            {
                "id_or_name": "parent-folder",
                "id": "folder-parent",
                "name": "Parent Folder",
                "deleted": True,
                "error": None,
            },
            {
                "id_or_name": "child-folder",
                "id": "folder-child",
                "name": "Child Folder",
                "deleted": True,
                "error": None,
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_folders_batch(["parent-folder", "child-folder"])
    parsed = json.loads(result)

    assert parsed == payload
    assert parsed["summary"]["failed"] == 0
    assert parsed["partial_success"] is False
    script = state["calls"][0]["script"]
    assert "parentId: item.parent ? item.parent.id.primaryKey : null" in script
    assert "right.depth - left.depth || left.index - right.index" in script
    assert "if (!existsFolderById(resolvedId)) {" in script
    assert "partial_success: deletedCount > 0 && failedCount > 0" in script


@pytest.mark.asyncio
async def test_delete_folders_batch_empty_array_validation_error(server_module: Any) -> None:
    with pytest.raises(
        ValueError,
        match="folder_ids_or_names must contain at least one folder id or name.",
    ):
        await server_module.delete_folders_batch([])


@pytest.mark.asyncio
async def test_delete_folders_batch_empty_item_validation_error(server_module: Any) -> None:
    with pytest.raises(ValueError, match="each folder id or name must be a non-empty string."):
        await server_module.delete_folders_batch(["folder-1", "   "])


@pytest.mark.asyncio
async def test_delete_folders_batch_duplicate_validation_error(server_module: Any) -> None:
    with pytest.raises(
        ValueError, match="folder_ids_or_names must not contain duplicates: folder-dup"
    ):
        await server_module.delete_folders_batch(["folder-dup", "folder-dup"])


@pytest.mark.asyncio
async def test_move_tasks_batch_happy_path(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "requested_count": 2,
        "moved_count": 2,
        "failed_count": 0,
        "partial_success": False,
        "results": [
            {
                "id": "t1",
                "name": "Task One",
                "moved": True,
                "destination": {"mode": "project", "projectName": "Work"},
                "error": None,
            },
            {
                "id": "t2",
                "name": "Task Two",
                "moved": True,
                "destination": {"mode": "project", "projectName": "Work"},
                "error": None,
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_tasks_batch(["t1", "t2"], project="Work")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const taskIds = ["t1", "t2"];' in script
    assert 'const projectName = "Work";' in script
    assert "moveTasks(movableTasks, destinationInfo.location);" in script
    assert "partial_success" in script
    assert "moved_count" in script


@pytest.mark.asyncio
async def test_move_tasks_batch_happy_path_parent_destination(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "requested_count": 2,
        "moved_count": 2,
        "failed_count": 0,
        "partial_success": False,
        "results": [
            {
                "id": "t1",
                "name": "Task One",
                "moved": True,
                "destination": {
                    "mode": "parent",
                    "parentTaskId": "parent-1",
                    "parentTaskName": "Parent One",
                },
                "error": None,
            },
            {
                "id": "t2",
                "name": "Task Two",
                "moved": True,
                "destination": {
                    "mode": "parent",
                    "parentTaskId": "parent-1",
                    "parentTaskName": "Parent One",
                },
                "error": None,
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_tasks_batch(["t1", "t2"], parent_task_id="parent-1")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const parentTaskId = "parent-1";' in script
    assert "Cannot move tasks under their own descendant." in script
    assert "parentTaskName: parentTask.name" in script


@pytest.mark.asyncio
async def test_move_tasks_batch_happy_path_inbox_destination(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "requested_count": 2,
        "moved_count": 2,
        "failed_count": 0,
        "partial_success": False,
        "results": [
            {
                "id": "t1",
                "name": "Task One",
                "moved": True,
                "destination": {"mode": "inbox"},
                "error": None,
            },
            {
                "id": "t2",
                "name": "Task Two",
                "moved": True,
                "destination": {"mode": "inbox"},
                "error": None,
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_tasks_batch(["t1", "t2"])

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "const projectName = null;" in script
    assert "const parentTaskId = null;" in script
    assert 'summary: { mode: "inbox" }' in script


@pytest.mark.asyncio
async def test_move_tasks_batch_partial_success_payload(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {
        "requested_count": 2,
        "moved_count": 1,
        "failed_count": 1,
        "partial_success": True,
        "results": [
            {
                "id": "t1",
                "name": "Task One",
                "moved": True,
                "destination": {"mode": "project", "projectName": "Work"},
                "error": None,
            },
            {
                "id": "missing",
                "name": None,
                "moved": False,
                "destination": {"mode": "project", "projectName": "Work"},
                "error": "Task not found.",
            },
        ],
    }
    configured = mock_server_run_omnijs(payload)
    server = configured["server"]

    result = await server.move_tasks_batch(["t1", "missing"], project="Work")

    assert json.loads(result) == payload


@pytest.mark.asyncio
async def test_move_tasks_batch_validation_errors(server_module: Any) -> None:
    with pytest.raises(ValueError, match="task_ids must contain at least one task id."):
        await server_module.move_tasks_batch([])
    with pytest.raises(ValueError, match="each task id must be a non-empty string."):
        await server_module.move_tasks_batch(["task-1", "   "], project="Work")
    with pytest.raises(
        ValueError, match="provide either project or parent_task_id, not both"
    ):
        await server_module.move_tasks_batch(
            ["task-1"], project="Work", parent_task_id="parent-1"
        )
    with pytest.raises(ValueError, match="task_ids must not contain duplicates: task-1"):
        await server_module.move_tasks_batch(["task-1", "task-1"], project="Work")
    with pytest.raises(
        ValueError,
        match="parent_task_id must not be included in task_ids \\(cannot move a task under itself\\)\\.",
    ):
        await server_module.move_tasks_batch(
            ["task-1", "task-2"], parent_task_id="task-1"
        )


@pytest.mark.asyncio
async def test_move_tasks_batch_cycle_rejection_error_propagates(
    monkeypatch: pytest.MonkeyPatch, server_module: Any
) -> None:
    tasks_mod = importlib.import_module("omnifocus_mcp.tools.tasks")

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        raise RuntimeError("Cannot move tasks under their own descendant.")

    monkeypatch.setattr(tasks_mod, "run_omnijs", fake_run_omnijs)

    with pytest.raises(RuntimeError, match="Cannot move tasks under their own descendant."):
        await tasks_mod.move_tasks_batch(["task-1", "task-2"], parent_task_id="parent-descendant")


@pytest.mark.asyncio
async def test_move_tasks_batch_signature_uses_parity_parameter_names(server_module: Any) -> None:
    signature = inspect.signature(server_module.move_tasks_batch)
    assert list(signature.parameters.keys()) == ["task_ids", "project", "parent_task_id"]


@pytest.mark.asyncio
async def test_set_project_status_happy_path_criterion9(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "p4", "name": "Project Four", "status": "on_hold"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.set_project_status(project_id_or_name="p4", status="on_hold")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "p4";' in script
    assert 'const statusValue = "on_hold";' in script
    assert "Project.Status.OnHold" in script
    assert "project.status = targetStatus;" in script


@pytest.mark.asyncio
async def test_set_project_status_validation_error_criterion9(server_module: Any) -> None:
    with pytest.raises(ValueError, match="status must be one of: active, on_hold, dropped."):
        await server_module.set_project_status(project_id_or_name="p4", status="completed")


@pytest.mark.asyncio
async def test_delete_project_happy_path_criterion10(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "p5", "name": "Project Five", "deleted": True, "taskCount": 3}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.delete_project(project_id_or_name="p5")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "p5";' in script
    assert "const taskCount = document.flattenedTasks.filter" in script
    assert "deleteObject(project);" in script
    assert "taskCount: taskCount" in script


@pytest.mark.asyncio
async def test_delete_project_validation_error_criterion10(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project_id_or_name must not be empty."):
        await server_module.delete_project(project_id_or_name="   ")


@pytest.mark.asyncio
async def test_move_project_happy_path_criterion11(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "p6", "name": "Project Six", "folderName": "Work"}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_project(project_id_or_name="p6", folder="Work")

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert 'const projectFilter = "p6";' in script
    assert 'const folderName = "Work";' in script
    assert ("const destination = (() => {" in script) or ("let destination;" in script)
    assert "const destination = (() => {" in script
    assert "return targetFolder.ending;" in script
    assert "moveSections([project], destination);" in script
    assert "folderName: folderName" in script


@pytest.mark.asyncio
async def test_move_project_to_top_level_happy_path_criterion11(
    mock_server_run_omnijs: Callable[[Any], dict[str, Any]],
) -> None:
    payload = {"id": "p6", "name": "Project Six", "folderName": None}
    configured = mock_server_run_omnijs(payload)
    state = configured["state"]
    server = configured["server"]

    result = await server.move_project(project_id_or_name="p6", folder=None)

    assert json.loads(result) == payload
    script = state["calls"][0]["script"]
    assert "const folderName = null;" in script
    assert "if (folderName === null) return library.ending;" in script


@pytest.mark.asyncio
async def test_move_project_validation_error_criterion11(server_module: Any) -> None:
    with pytest.raises(ValueError, match="project_id_or_name must not be empty."):
        await server_module.move_project(project_id_or_name="   ", folder="Work")
    with pytest.raises(ValueError, match="folder must not be empty when provided."):
        await server_module.move_project(project_id_or_name="p6", folder="   ")


