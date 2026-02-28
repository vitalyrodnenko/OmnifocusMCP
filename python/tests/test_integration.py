import json
import sys
import types
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
import pytest_asyncio

try:
    from mcp.server.fastmcp import FastMCP as _FastMCP  # type: ignore[import-not-found]
except Exception:
    class _FakeFastMCP:
        def __init__(self, name: str):
            self.name = name

        def tool(self):
            def decorator(func):
                return func

            return decorator

        def resource(self, _uri: str):
            def decorator(func):
                return func

            return decorator

        def prompt(self):
            def decorator(func):
                return func

            return decorator

    mcp_module = types.ModuleType("mcp")
    mcp_server_module = types.ModuleType("mcp.server")
    mcp_fastmcp_module = types.ModuleType("mcp.server.fastmcp")
    mcp_fastmcp_module.FastMCP = _FakeFastMCP
    mcp_server_module.fastmcp = mcp_fastmcp_module
    mcp_module.server = mcp_server_module
    sys.modules["mcp"] = mcp_module
    sys.modules["mcp.server"] = mcp_server_module
    sys.modules["mcp.server.fastmcp"] = mcp_fastmcp_module

from omnifocus_mcp.jxa import run_omnijs
from omnifocus_mcp.tools.folders import list_folders
from omnifocus_mcp.tools.forecast import get_forecast
from omnifocus_mcp.tools.perspectives import list_perspectives
from omnifocus_mcp.tools.projects import complete_project, create_project, get_project, list_projects
from omnifocus_mcp.tools.tags import list_tags
from omnifocus_mcp.tools.tasks import (
    complete_task,
    create_task,
    delete_task,
    get_inbox,
    get_task,
    list_tasks,
    search_tasks,
    update_task,
)


def _parse_json(payload: str) -> object:
    return json.loads(payload)


def _assert_keys(obj: dict[str, object], required: set[str]) -> None:
    assert required.issubset(obj.keys())


def _test_name(suffix: str) -> str:
    return f"[TEST-MCP] {suffix} {uuid4().hex[:8]}"


@pytest_asyncio.fixture
async def cleanup_registry() -> dict[str, list[str]]:
    registry: dict[str, list[str]] = {"task_ids": [], "project_ids": []}
    try:
        yield registry
    finally:
        for task_id in reversed(registry["task_ids"]):
            try:
                await delete_task(task_id=task_id)
            except Exception:
                continue

        for project_id in reversed(registry["project_ids"]):
            try:
                await complete_project(project_id_or_name=project_id)
            except Exception:
                continue


@pytest.mark.integration
@pytest.mark.asyncio
async def test_jxa_bridge_connectivity() -> None:
    result = await run_omnijs("return document.flattenedTasks.length;")
    assert isinstance(result, int)
    assert result >= 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_read_tools_return_valid_json(cleanup_registry: dict[str, list[str]]) -> None:
    created_task = _parse_json(await create_task(name=_test_name("Read tool task"), flagged=True))
    assert isinstance(created_task, dict)
    created_task_id = created_task.get("id")
    assert isinstance(created_task_id, str)
    cleanup_registry["task_ids"].append(created_task_id)

    inbox = _parse_json(await get_inbox(limit=20))
    assert isinstance(inbox, list)
    if inbox:
        assert isinstance(inbox[0], dict)
        _assert_keys(
            inbox[0],
            {"id", "name", "note", "flagged", "dueDate", "deferDate", "tags", "estimatedMinutes"},
        )

    tasks = _parse_json(await list_tasks(status="all", limit=20))
    assert isinstance(tasks, list)
    if tasks:
        assert isinstance(tasks[0], dict)
        _assert_keys(
            tasks[0],
            {
                "id",
                "name",
                "note",
                "flagged",
                "dueDate",
                "deferDate",
                "completed",
                "completionDate",
                "projectName",
                "tags",
                "estimatedMinutes",
                "hasChildren",
            },
        )

    task = _parse_json(await get_task(task_id=created_task_id))
    assert isinstance(task, dict)
    _assert_keys(
        task,
        {
            "id",
            "name",
            "note",
            "flagged",
            "dueDate",
            "deferDate",
            "completed",
            "completionDate",
            "projectName",
            "tags",
            "estimatedMinutes",
            "children",
            "parentName",
            "sequential",
            "repetitionRule",
        },
    )

    search_results = _parse_json(await search_tasks(query="Read tool", limit=20))
    assert isinstance(search_results, list)
    if search_results:
        assert isinstance(search_results[0], dict)
        _assert_keys(
            search_results[0],
            {
                "id",
                "name",
                "note",
                "flagged",
                "dueDate",
                "deferDate",
                "completed",
                "completionDate",
                "projectName",
                "tags",
                "estimatedMinutes",
                "hasChildren",
            },
        )

    projects = _parse_json(await list_projects(limit=20))
    assert isinstance(projects, list)
    if projects:
        assert isinstance(projects[0], dict)
        _assert_keys(
            projects[0],
            {
                "id",
                "name",
                "status",
                "folderName",
                "taskCount",
                "remainingTaskCount",
                "deferDate",
                "dueDate",
                "note",
                "sequential",
                "reviewInterval",
            },
        )

    if projects:
        project_id = projects[0].get("id")
        assert isinstance(project_id, str)
    else:
        created_project = _parse_json(await create_project(name=_test_name("Read tool project")))
        assert isinstance(created_project, dict)
        project_id = created_project.get("id")
        assert isinstance(project_id, str)
        cleanup_registry["project_ids"].append(project_id)

    project = _parse_json(await get_project(project_id_or_name=project_id))
    assert isinstance(project, dict)
    _assert_keys(
        project,
        {
            "id",
            "name",
            "status",
            "folderName",
            "taskCount",
            "remainingTaskCount",
            "deferDate",
            "dueDate",
            "note",
            "sequential",
            "reviewInterval",
            "rootTasks",
        },
    )

    tags = _parse_json(await list_tags(limit=20))
    assert isinstance(tags, list)
    if tags:
        assert isinstance(tags[0], dict)
        _assert_keys(tags[0], {"id", "name", "parent", "availableTaskCount", "status"})

    folders = _parse_json(await list_folders(limit=20))
    assert isinstance(folders, list)
    if folders:
        assert isinstance(folders[0], dict)
        _assert_keys(folders[0], {"id", "name", "parentName", "projectCount"})

    forecast = _parse_json(await get_forecast(limit=20))
    assert isinstance(forecast, dict)
    _assert_keys(forecast, {"overdue", "dueToday", "flagged"})

    perspectives = _parse_json(await list_perspectives(limit=20))
    assert isinstance(perspectives, list)
    if perspectives:
        assert isinstance(perspectives[0], dict)
        _assert_keys(perspectives[0], {"id", "name"})


@pytest.mark.integration
@pytest.mark.asyncio
async def test_task_lifecycle(cleanup_registry: dict[str, list[str]]) -> None:
    due_date = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)
    due_date_iso = due_date.isoformat().replace("+00:00", "Z")

    created = _parse_json(await create_task(name=_test_name("Lifecycle task"), flagged=True, dueDate=due_date_iso))
    assert isinstance(created, dict)
    created_task_id = created.get("id")
    assert isinstance(created_task_id, str)
    cleanup_registry["task_ids"].append(created_task_id)

    fetched = _parse_json(await get_task(task_id=created_task_id))
    assert isinstance(fetched, dict)
    assert fetched["id"] == created_task_id
    assert fetched["flagged"] is True

    updated_name = _test_name("Lifecycle updated")
    updated = _parse_json(await update_task(task_id=created_task_id, name=updated_name))
    assert isinstance(updated, dict)
    assert updated["id"] == created_task_id
    assert updated["name"] == updated_name

    completed = _parse_json(await complete_task(task_id=created_task_id))
    assert isinstance(completed, dict)
    assert completed["id"] == created_task_id
    assert completed["completed"] is True

    deleted = _parse_json(await delete_task(task_id=created_task_id))
    assert isinstance(deleted, dict)
    assert deleted["id"] == created_task_id
    assert deleted["deleted"] is True
    cleanup_registry["task_ids"].remove(created_task_id)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_search_finds_created_task(cleanup_registry: dict[str, list[str]]) -> None:
    token = uuid4().hex[:10]
    created = _parse_json(await create_task(name=f"[TEST-MCP] Search {token}", note=f"search token {token}"))
    assert isinstance(created, dict)
    created_task_id = created.get("id")
    assert isinstance(created_task_id, str)
    cleanup_registry["task_ids"].append(created_task_id)

    results = _parse_json(await search_tasks(query=token, limit=50))
    assert isinstance(results, list)
    result_ids = {item["id"] for item in results if isinstance(item, dict) and "id" in item}
    assert created_task_id in result_ids


@pytest.mark.integration
@pytest.mark.asyncio
async def test_project_lifecycle(cleanup_registry: dict[str, list[str]]) -> None:
    project_name = _test_name("Lifecycle project")
    created = _parse_json(await create_project(name=project_name))
    assert isinstance(created, dict)
    project_id = created.get("id")
    assert isinstance(project_id, str)
    cleanup_registry["project_ids"].append(project_id)

    fetched = _parse_json(await get_project(project_id_or_name=project_id))
    assert isinstance(fetched, dict)
    assert fetched["id"] == project_id
    assert fetched["name"] == project_name

    completed = _parse_json(await complete_project(project_id_or_name=project_id))
    assert isinstance(completed, dict)
    assert completed["id"] == project_id
    assert completed["completed"] is True
