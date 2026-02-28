import asyncio
import json
import sys
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from omnifocus_mcp.jxa import run_omnijs
from omnifocus_mcp.tools.folders import list_folders
from omnifocus_mcp.tools.forecast import get_forecast
from omnifocus_mcp.tools.perspectives import list_perspectives
from omnifocus_mcp.tools.projects import get_project, list_projects
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


class SmokeTest:
    def __init__(self) -> None:
        self.total = 0
        self.failed = 0
        self.context: dict[str, Any] = {}

    async def run_step(
        self,
        name: str,
        operation: Callable[[], Awaitable[None]],
    ) -> None:
        self.total += 1
        try:
            await operation()
        except Exception as exc:
            self.failed += 1
            print(f"FAIL {name}: {exc}")
            return
        print(f"PASS {name}")

    def parse_json(self, tool_name: str, payload: str) -> Any:
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{tool_name} returned invalid json") from exc

    def require_keys(self, obj: dict[str, Any], keys: set[str], label: str) -> None:
        missing = sorted(key for key in keys if key not in obj)
        if missing:
            raise ValueError(f"{label} missing keys: {', '.join(missing)}")

    async def check_bridge(self) -> None:
        # BUG: app.evaluateJavaScript failed with message-not-understood (-1708); fixed bridge method name to evaluateJavascript.
        # BUG: OmniJS exposes flattened* globals while tool scripts referenced document.flattened*; fixed with run_omnijs compatibility shim.
        result = await run_omnijs("return document.flattenedTasks.length;")
        if not isinstance(result, int):
            raise ValueError("run_omnijs did not return a numeric task count")
        self.context["task_count"] = result
        print(f"info total tasks in database: {result}")

    async def check_read_tools(self) -> None:
        inbox_items = self.parse_json("get_inbox", await get_inbox(limit=20))
        if not isinstance(inbox_items, list):
            raise ValueError("get_inbox did not return a list")
        if inbox_items:
            self.require_keys(
                inbox_items[0],
                {"id", "name", "note", "flagged", "dueDate", "deferDate", "tags", "estimatedMinutes"},
                "get_inbox item",
            )

        tasks = self.parse_json("list_tasks", await list_tasks(status="all", limit=50))
        if not isinstance(tasks, list):
            raise ValueError("list_tasks did not return a list")
        if not tasks:
            raise ValueError("list_tasks returned no tasks; cannot validate get_task")
        self.require_keys(
            tasks[0],
            {
                "id",
                "name",
                "note",
                "flagged",
                "dueDate",
                "deferDate",
                "completed",
                "projectName",
                "tags",
                "estimatedMinutes",
            },
            "list_tasks item",
        )
        sample_task_id = tasks[0]["id"]
        if not isinstance(sample_task_id, str) or sample_task_id.strip() == "":
            raise ValueError("list_tasks did not return a valid task id")
        self.context["sample_task_id"] = sample_task_id

        task = self.parse_json("get_task", await get_task(task_id=sample_task_id))
        if not isinstance(task, dict):
            raise ValueError("get_task did not return an object")
        self.require_keys(
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
            "get_task result",
        )

        sample_query = str(tasks[0].get("name", "")).split(" ")[0]
        if sample_query.strip() == "":
            sample_query = "a"
        search_results = self.parse_json(
            "search_tasks", await search_tasks(query=sample_query, limit=20)
        )
        if not isinstance(search_results, list):
            raise ValueError("search_tasks did not return a list")
        if search_results:
            self.require_keys(
                search_results[0],
                {
                    "id",
                    "name",
                    "note",
                    "flagged",
                    "dueDate",
                    "deferDate",
                    "completed",
                    "projectName",
                    "tags",
                    "estimatedMinutes",
                },
                "search_tasks item",
            )

        projects = self.parse_json("list_projects", await list_projects(limit=50))
        if not isinstance(projects, list):
            raise ValueError("list_projects did not return a list")
        if not projects:
            raise ValueError("list_projects returned no projects; cannot validate get_project")
        self.require_keys(
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
            "list_projects item",
        )
        sample_project_id = projects[0]["id"]
        if not isinstance(sample_project_id, str) or sample_project_id.strip() == "":
            raise ValueError("list_projects did not return a valid project id")
        project = self.parse_json(
            "get_project", await get_project(project_id_or_name=sample_project_id)
        )
        if not isinstance(project, dict):
            raise ValueError("get_project did not return an object")
        self.require_keys(
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
            "get_project result",
        )

        tags = self.parse_json("list_tags", await list_tags(limit=50))
        if not isinstance(tags, list):
            raise ValueError("list_tags did not return a list")
        if tags:
            self.require_keys(
                tags[0],
                {"id", "name", "parent", "availableTaskCount", "status"},
                "list_tags item",
            )

        folders = self.parse_json("list_folders", await list_folders(limit=50))
        if not isinstance(folders, list):
            raise ValueError("list_folders did not return a list")
        if folders:
            self.require_keys(
                folders[0], {"id", "name", "parentName", "projectCount"}, "list_folders item"
            )

        forecast = self.parse_json("get_forecast", await get_forecast(limit=50))
        if not isinstance(forecast, dict):
            raise ValueError("get_forecast did not return an object")
        self.require_keys(forecast, {"overdue", "dueToday", "flagged"}, "get_forecast result")

        perspectives = self.parse_json("list_perspectives", await list_perspectives(limit=50))
        if not isinstance(perspectives, list):
            raise ValueError("list_perspectives did not return a list")
        if perspectives:
            self.require_keys(perspectives[0], {"id", "name"}, "list_perspectives item")

    async def check_task_lifecycle(self) -> None:
        created_task_id: str | None = None
        try:
            tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
            due_date = tomorrow.replace(microsecond=0).isoformat().replace("+00:00", "Z")

            created = self.parse_json(
                "create_task",
                await create_task(
                    name="[TEST-MCP] Smoke Test Task",
                    flagged=True,
                    dueDate=due_date,
                ),
            )
            if not isinstance(created, dict):
                raise ValueError("create_task did not return an object")
            self.require_keys(created, {"id", "name"}, "create_task result")
            created_task_id = created.get("id")
            if not isinstance(created_task_id, str) or created_task_id.strip() == "":
                raise ValueError("create_task did not return a valid task id")
            print(f"info created task id: {created_task_id}")

            fetched = self.parse_json("get_task", await get_task(task_id=created_task_id))
            if not isinstance(fetched, dict):
                raise ValueError("get_task did not return an object for created task")
            if fetched.get("name") != "[TEST-MCP] Smoke Test Task":
                raise ValueError("created task name mismatch")
            if fetched.get("flagged") is not True:
                raise ValueError("created task flagged mismatch")
            if fetched.get("dueDate") is None:
                raise ValueError("created task dueDate missing")

            updated = self.parse_json(
                "update_task",
                await update_task(task_id=created_task_id, name="[TEST-MCP] Updated Task"),
            )
            if not isinstance(updated, dict):
                raise ValueError("update_task did not return an object")
            if updated.get("name") != "[TEST-MCP] Updated Task":
                raise ValueError("update_task did not update task name")

            completed = self.parse_json(
                "complete_task", await complete_task(task_id=created_task_id)
            )
            if not isinstance(completed, dict):
                raise ValueError("complete_task did not return an object")
            if completed.get("completed") is not True:
                raise ValueError("complete_task did not mark task complete")

            deleted = self.parse_json("delete_task", await delete_task(task_id=created_task_id))
            if not isinstance(deleted, dict):
                raise ValueError("delete_task did not return an object")
            if deleted.get("deleted") is not True:
                raise ValueError("delete_task did not report deleted=true")

            created_task_id = None
        finally:
            if created_task_id:
                try:
                    await delete_task(task_id=created_task_id)
                    print(f"info cleanup deleted task id: {created_task_id}")
                except Exception as exc:
                    print(f"WARN cleanup failed for task {created_task_id}: {exc}")

    async def run(self) -> int:
        print("starting omnifocus smoke test")
        await self.run_step("jxa bridge basics", self.check_bridge)
        await self.run_step("read tools json/field validation", self.check_read_tools)
        await self.run_step("task lifecycle create/get/update/complete/delete", self.check_task_lifecycle)
        print(f"completed {self.total} checks with {self.failed} failures")
        if self.failed == 0:
            print("smoke test PASSED")
        else:
            print("smoke test FAILED")
        return 0 if self.failed == 0 else 1


async def main() -> int:
    return await SmokeTest().run()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
