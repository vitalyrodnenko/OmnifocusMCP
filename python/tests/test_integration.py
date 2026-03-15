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
from omnifocus_mcp.tools.folders import (
    create_folder,
    delete_folder,
    delete_folders_batch,
    get_folder,
    list_folders,
)
from omnifocus_mcp.tools.forecast import get_forecast
from omnifocus_mcp.tools.perspectives import list_perspectives
from omnifocus_mcp.tools.projects import (
    complete_project,
    create_project,
    delete_project,
    delete_projects_batch,
    get_project,
    list_projects,
)
from omnifocus_mcp.tools.tags import create_tag, delete_tag, delete_tags_batch, list_tags
from omnifocus_mcp.tools.tasks import (
    add_notification,
    complete_task,
    create_task,
    delete_task,
    get_task_counts,
    get_inbox,
    get_task,
    list_notifications,
    list_tasks,
    remove_notification,
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
    registry: dict[str, list[str]] = {"task_ids": [], "project_ids": [], "folder_ids": []}
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
        for folder_id in reversed(registry["folder_ids"]):
            try:
                await delete_folder(folder_name_or_id=folder_id)
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
        _assert_keys(tags[0], {"id", "name", "parent", "availableTaskCount", "totalTaskCount", "status"})
        allowed_statuses = {"active", "on_hold", "dropped"}
        for item in tags:
            if isinstance(item, dict):
                assert item.get("status") in allowed_statuses

    folders = _parse_json(await list_folders(limit=20))
    assert isinstance(folders, list)
    if folders:
        assert isinstance(folders[0], dict)
        _assert_keys(folders[0], {"id", "name", "parentName", "projectCount"})

    status_folder = _parse_json(await create_folder(name=_test_name("Status probe folder")))
    assert isinstance(status_folder, dict)
    status_folder_id = status_folder.get("id")
    assert isinstance(status_folder_id, str)
    cleanup_registry["folder_ids"].append(status_folder_id)
    folder_details = _parse_json(await get_folder(folder_name_or_id=status_folder_id))
    assert isinstance(folder_details, dict)
    assert folder_details.get("status") in {"active", "on_hold", "dropped"}
    for project in folder_details.get("projects", []):
        if isinstance(project, dict):
            assert project.get("status") in {"active", "on_hold", "dropped"}

    forecast = _parse_json(await get_forecast(limit=20))
    assert isinstance(forecast, dict)
    _assert_keys(forecast, {"overdue", "dueToday", "flagged", "deferred", "dueThisWeek", "counts"})

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


@pytest.mark.integration
@pytest.mark.asyncio
async def test_new_feature_parity_matrix(cleanup_registry: dict[str, list[str]]) -> None:
    created_tag_ids: list[str] = []
    created_folder_ids: list[str] = []
    created_batch_project_ids: list[str] = []
    notification_task_id: str | None = None
    notification_id: str | None = None
    parity_project_name = _test_name("Parity matrix project")
    try:
        parity_project = _parse_json(await create_project(name=parity_project_name))
        assert isinstance(parity_project, dict)
        parity_project_id = parity_project.get("id")
        assert isinstance(parity_project_id, str)
        cleanup_registry["project_ids"].append(parity_project_id)

        due_date = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)
        due_date_iso = due_date.isoformat().replace("+00:00", "Z")
        created_task = _parse_json(
            await create_task(
                name=_test_name("Parity matrix task"),
                note="parity matrix sort notification",
                project=parity_project_name,
                dueDate=due_date_iso,
            )
        )
        assert isinstance(created_task, dict)
        notification_task_id = created_task.get("id")
        assert isinstance(notification_task_id, str)
        cleanup_registry["task_ids"].append(notification_task_id)

        listed_added = _parse_json(
            await list_tasks(
                project=parity_project_name,
                sortBy="added",
                sortOrder="desc",
                status="all",
                limit=50,
            )
        )
        assert isinstance(listed_added, list)
        assert any(isinstance(item, dict) and item.get("id") == notification_task_id for item in listed_added)

        searched_planned = _parse_json(
            await search_tasks(
                query="parity matrix sort", sortBy="planned", sortOrder="asc", status="all", limit=50
            )
        )
        assert isinstance(searched_planned, list)
        assert any(isinstance(item, dict) and item.get("id") == notification_task_id for item in searched_planned)

        created_notification = _parse_json(
            await add_notification(task_id=notification_task_id, absoluteDate=due_date_iso)
        )
        assert isinstance(created_notification, dict)
        notification_id = created_notification.get("id")
        assert isinstance(notification_id, str)

        listed_notifications = _parse_json(await list_notifications(task_id=notification_task_id))
        assert isinstance(listed_notifications, list)
        assert any(isinstance(item, dict) and item.get("id") == notification_id for item in listed_notifications)

        removed_notification = _parse_json(
            await remove_notification(task_id=notification_task_id, notification_id=notification_id)
        )
        assert isinstance(removed_notification, dict)
        assert removed_notification.get("removed") is True
        notification_id = None

        tag_parent_name = _test_name("Parity batch parent tag")
        tag_parent = _parse_json(await create_tag(name=tag_parent_name))
        assert isinstance(tag_parent, dict)
        tag_child = _parse_json(
            await create_tag(name=_test_name("Parity batch child tag"), parent=tag_parent_name)
        )
        assert isinstance(tag_child, dict)
        tag_parent_id = tag_parent.get("id")
        tag_child_id = tag_child.get("id")
        assert isinstance(tag_parent_id, str) and isinstance(tag_child_id, str)
        created_tag_ids.extend([tag_parent_id, tag_child_id])
        deleted_tags = _parse_json(await delete_tags_batch([tag_parent_id, tag_child_id]))
        assert isinstance(deleted_tags, dict)
        assert deleted_tags.get("summary", {}).get("deleted") == 2
        assert deleted_tags.get("summary", {}).get("failed") == 0
        assert deleted_tags.get("partial_success") is False
        tag_error_text = " ".join(
            str(item.get("error", ""))
            for item in deleted_tags.get("results", [])
            if isinstance(item, dict) and item.get("error")
        ).lower()
        assert "invalid object instance" not in tag_error_text
        created_tag_ids = []

        folder_parent_name = _test_name("Parity batch parent folder")
        folder_parent = _parse_json(await create_folder(name=folder_parent_name))
        assert isinstance(folder_parent, dict)
        folder_child = _parse_json(
            await create_folder(
                name=_test_name("Parity batch child folder"),
                parent=folder_parent_name,
            )
        )
        assert isinstance(folder_child, dict)
        folder_parent_id = folder_parent.get("id")
        folder_child_id = folder_child.get("id")
        assert isinstance(folder_parent_id, str) and isinstance(folder_child_id, str)
        created_folder_ids.extend([folder_parent_id, folder_child_id])
        deleted_folders = _parse_json(await delete_folders_batch([folder_parent_id, folder_child_id]))
        assert isinstance(deleted_folders, dict)
        assert deleted_folders.get("summary", {}).get("deleted") == 2
        assert deleted_folders.get("summary", {}).get("failed") == 0
        assert deleted_folders.get("partial_success") is False
        folder_error_text = " ".join(
            str(item.get("error", ""))
            for item in deleted_folders.get("results", [])
            if isinstance(item, dict) and item.get("error")
        ).lower()
        assert "invalid object instance" not in folder_error_text
        created_folder_ids = []

        project_one = _parse_json(await create_project(name=_test_name("Parity batch project one")))
        project_two = _parse_json(await create_project(name=_test_name("Parity batch project two")))
        assert isinstance(project_one, dict) and isinstance(project_two, dict)
        project_one_id = project_one.get("id")
        project_two_id = project_two.get("id")
        assert isinstance(project_one_id, str) and isinstance(project_two_id, str)
        created_batch_project_ids.extend([project_one_id, project_two_id])
        deleted_projects = _parse_json(await delete_projects_batch([project_one_id, project_two_id]))
        assert isinstance(deleted_projects, dict)
        assert deleted_projects.get("summary", {}).get("deleted") == 2
        created_batch_project_ids = []
    finally:
        if notification_task_id and notification_id:
            try:
                await remove_notification(task_id=notification_task_id, notification_id=notification_id)
            except Exception:
                pass
        for tag_id in reversed(created_tag_ids):
            try:
                await delete_tag(tag_name_or_id=tag_id)
            except Exception:
                continue
        for folder_id in reversed(created_folder_ids):
            try:
                await delete_folder(folder_name_or_id=folder_id)
            except Exception:
                continue
        for project_id in reversed(created_batch_project_ids):
            try:
                await delete_project(project_id_or_name=project_id)
            except Exception:
                continue


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plan_a_parent_child_batch_delete_effective_success() -> None:
    prefix = _test_name("Plan A hierarchy")
    created_tag_ids: list[str] = []
    created_folder_ids: list[str] = []
    try:
        parent_tag_name = f"{prefix} parent tag"
        child_tag_name = f"{prefix} child tag"
        parent_tag = _parse_json(await create_tag(name=parent_tag_name))
        assert isinstance(parent_tag, dict)
        parent_tag_id = parent_tag.get("id")
        assert isinstance(parent_tag_id, str)
        created_tag_ids.append(parent_tag_id)

        child_tag = _parse_json(await create_tag(name=child_tag_name, parent=parent_tag_name))
        assert isinstance(child_tag, dict)
        child_tag_id = child_tag.get("id")
        assert isinstance(child_tag_id, str)
        created_tag_ids.append(child_tag_id)

        deleted_tags = _parse_json(await delete_tags_batch([parent_tag_id, child_tag_id]))
        assert isinstance(deleted_tags, dict)
        assert deleted_tags.get("summary", {}).get("deleted") == 2
        assert deleted_tags.get("summary", {}).get("failed") == 0
        assert deleted_tags.get("partial_success") is False
        tag_results = deleted_tags.get("results")
        assert isinstance(tag_results, list)
        assert all(isinstance(item, dict) and item.get("deleted") is True for item in tag_results)
        assert all(
            isinstance(item, dict)
            and "invalid" not in str(item.get("error", "")).lower()
            and "instance" not in str(item.get("error", "")).lower()
            for item in tag_results
        )
        created_tag_ids = []

        parent_folder_name = f"{prefix} parent folder"
        child_folder_name = f"{prefix} child folder"
        parent_folder = _parse_json(await create_folder(name=parent_folder_name))
        assert isinstance(parent_folder, dict)
        parent_folder_id = parent_folder.get("id")
        assert isinstance(parent_folder_id, str)
        created_folder_ids.append(parent_folder_id)

        child_folder = _parse_json(await create_folder(name=child_folder_name, parent=parent_folder_name))
        assert isinstance(child_folder, dict)
        child_folder_id = child_folder.get("id")
        assert isinstance(child_folder_id, str)
        created_folder_ids.append(child_folder_id)

        deleted_folders = _parse_json(await delete_folders_batch([parent_folder_id, child_folder_id]))
        assert isinstance(deleted_folders, dict)
        assert deleted_folders.get("summary", {}).get("deleted") == 2
        assert deleted_folders.get("summary", {}).get("failed") == 0
        assert deleted_folders.get("partial_success") is False
        folder_results = deleted_folders.get("results")
        assert isinstance(folder_results, list)
        assert all(
            isinstance(item, dict) and item.get("deleted") is True for item in folder_results
        )
        assert all(
            isinstance(item, dict)
            and "invalid" not in str(item.get("error", "")).lower()
            and "instance" not in str(item.get("error", "")).lower()
            for item in folder_results
        )
        created_folder_ids = []
    finally:
        for tag_id in reversed(created_tag_ids):
            try:
                await delete_tag(tag_name_or_id=tag_id)
            except Exception:
                continue
        for folder_id in reversed(created_folder_ids):
            try:
                await delete_folder(folder_name_or_id=folder_id)
            except Exception:
                continue


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plan_c_alias_calls_match_canonical_behavior(
    cleanup_registry: dict[str, list[str]],
) -> None:
    tag_ids: list[str] = []
    try:
        project_name = _test_name("Plan C alias project")
        created_project = _parse_json(await create_project(name=project_name))
        assert isinstance(created_project, dict)
        project_id = created_project.get("id")
        assert isinstance(project_id, str)
        cleanup_registry["project_ids"].append(project_id)

        created_tag_a = _parse_json(await create_tag(name=_test_name("Plan C alias tag A")))
        created_tag_b = _parse_json(await create_tag(name=_test_name("Plan C alias tag B")))
        assert isinstance(created_tag_a, dict)
        assert isinstance(created_tag_b, dict)
        tag_a_id = created_tag_a.get("id")
        tag_b_id = created_tag_b.get("id")
        tag_a_name = created_tag_a.get("name")
        tag_b_name = created_tag_b.get("name")
        assert isinstance(tag_a_id, str)
        assert isinstance(tag_b_id, str)
        assert isinstance(tag_a_name, str)
        assert isinstance(tag_b_name, str)
        tag_ids.extend([tag_a_id, tag_b_id])

        due_date = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        created_task = _parse_json(
            await create_task(
                name=_test_name("Plan C alias task"),
                note="plan c alias integration probe",
                project=project_name,
                dueDate=due_date,
                tags=[tag_a_name, tag_b_name],
            )
        )
        assert isinstance(created_task, dict)
        task_id = created_task.get("id")
        assert isinstance(task_id, str)
        cleanup_registry["task_ids"].append(task_id)

        canonical_list = _parse_json(
            await list_tasks(
                project=project_name,
                tags=[tag_a_name, tag_b_name],
                tagFilterMode="all",
                status="due_soon",
                sortOrder="desc",
                limit=50,
            )
        )
        alias_list = _parse_json(
            await list_tasks(
                project=project_name,
                tags=[tag_a_name, tag_b_name],
                tagFilterMode="AND",
                status="due soon",
                sortOrder="descending",
                limit=50,
            )
        )
        assert isinstance(canonical_list, list)
        assert isinstance(alias_list, list)
        assert any(isinstance(item, dict) and item.get("id") == task_id for item in canonical_list)
        assert any(isinstance(item, dict) and item.get("id") == task_id for item in alias_list)

        canonical_search = _parse_json(
            await search_tasks(
                query="plan c alias integration probe",
                project=project_name,
                tagFilterMode="any",
                status="due_soon",
                sortOrder="asc",
                limit=50,
            )
        )
        alias_search = _parse_json(
            await search_tasks(
                query="plan c alias integration probe",
                project=project_name,
                tagFilterMode="OR",
                status="due-soon",
                sortOrder="ascending",
                limit=50,
            )
        )
        assert isinstance(canonical_search, list)
        assert isinstance(alias_search, list)
        assert any(
            isinstance(item, dict) and item.get("id") == task_id for item in canonical_search
        )
        assert any(isinstance(item, dict) and item.get("id") == task_id for item in alias_search)

        canonical_counts = _parse_json(
            await get_task_counts(
                project=project_name,
                tags=[tag_a_name, tag_b_name],
                tagFilterMode="all",
            )
        )
        alias_counts = _parse_json(
            await get_task_counts(
                project=project_name,
                tags=[tag_a_name, tag_b_name],
                tagFilterMode="AND",
            )
        )
        assert isinstance(canonical_counts, dict)
        assert isinstance(alias_counts, dict)
        assert canonical_counts.get("total") == alias_counts.get("total")
    finally:
        for tag_id in reversed(tag_ids):
            try:
                await delete_tag(tag_name_or_id=tag_id)
            except Exception:
                continue


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plan_b_statuses_are_canonical_in_tags_and_folder_projects(
    cleanup_registry: dict[str, list[str]],
) -> None:
    allowed_statuses = {"active", "on_hold", "dropped"}
    tag_id: str | None = None
    folder_id: str | None = None
    project_id: str | None = None
    try:
        created_tag = _parse_json(await create_tag(name=_test_name("Plan B status tag")))
        assert isinstance(created_tag, dict)
        tag_id = created_tag.get("id")
        assert isinstance(tag_id, str)

        created_folder = _parse_json(await create_folder(name=_test_name("Plan B status folder")))
        assert isinstance(created_folder, dict)
        folder_id = created_folder.get("id")
        folder_name = created_folder.get("name")
        assert isinstance(folder_id, str)
        assert isinstance(folder_name, str)
        cleanup_registry["folder_ids"].append(folder_id)

        created_project = _parse_json(
            await create_project(name=_test_name("Plan B status project"), folder=folder_name)
        )
        assert isinstance(created_project, dict)
        project_id = created_project.get("id")
        assert isinstance(project_id, str)
        cleanup_registry["project_ids"].append(project_id)

        listed_tags = _parse_json(await list_tags(limit=100))
        assert isinstance(listed_tags, list)
        matching_tag = next(
            (
                item
                for item in listed_tags
                if isinstance(item, dict) and item.get("id") == tag_id
            ),
            None,
        )
        assert isinstance(matching_tag, dict)
        assert matching_tag.get("status") in allowed_statuses

        folder_details = _parse_json(await get_folder(folder_name_or_id=folder_id))
        assert isinstance(folder_details, dict)
        assert folder_details.get("status") in allowed_statuses
        folder_projects = folder_details.get("projects")
        assert isinstance(folder_projects, list)
        matching_project = next(
            (
                item
                for item in folder_projects
                if isinstance(item, dict) and item.get("id") == project_id
            ),
            None,
        )
        assert isinstance(matching_project, dict)
        assert matching_project.get("status") in allowed_statuses
    finally:
        if tag_id is not None:
            try:
                await delete_tag(tag_name_or_id=tag_id)
            except Exception:
                pass


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plan_c_alias_inputs_work_for_task_tools(
    cleanup_registry: dict[str, list[str]],
) -> None:
    tag_id: str | None = None
    try:
        tag_name = _test_name("Plan C alias tag")
        created_tag = _parse_json(await create_tag(name=tag_name))
        assert isinstance(created_tag, dict)
        tag_id = created_tag.get("id")
        assert isinstance(tag_id, str)

        task_name = _test_name("Plan C alias task")
        due_date = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
        due_date_iso = due_date.isoformat().replace("+00:00", "Z")
        created_task = _parse_json(
            await create_task(name=task_name, dueDate=due_date_iso, tags=[tag_name])
        )
        assert isinstance(created_task, dict)
        task_id = created_task.get("id")
        assert isinstance(task_id, str)
        cleanup_registry["task_ids"].append(task_id)

        listed = _parse_json(
            await list_tasks(
                tags=[tag_name], tagFilterMode="AND", status="due soon", sortOrder="descending", limit=100
            )
        )
        assert isinstance(listed, list)
        assert any(
            isinstance(item, dict) and item.get("id") == task_id and item.get("taskStatus") == "due_soon"
            for item in listed
        )

        searched = _parse_json(
            await search_tasks(
                query=task_name,
                tags=[tag_name],
                tagFilterMode="and",
                status="due-soon",
                sortOrder="descending",
                limit=100,
            )
        )
        assert isinstance(searched, list)
        assert any(
            isinstance(item, dict) and item.get("id") == task_id and item.get("taskStatus") == "due_soon"
            for item in searched
        )

        counts = _parse_json(await get_task_counts(tags=[tag_name], tagFilterMode="AND"))
        assert isinstance(counts, dict)
        assert isinstance(counts.get("total"), int)
        assert counts["total"] >= 1
    finally:
        if tag_id is not None:
            try:
                await delete_tag(tag_name_or_id=tag_id)
            except Exception:
                pass
