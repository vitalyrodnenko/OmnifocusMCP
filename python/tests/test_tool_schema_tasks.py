from typing import Any

import pytest

import omnifocus_mcp.server  # noqa: F401
from omnifocus_mcp.app import mcp


def _tags_property_is_array_of_strings(properties: dict[str, Any]) -> None:
    tags_schema = properties["tags"]
    branches = tags_schema.get("anyOf", [tags_schema])
    found = False
    for branch in branches:
        if not isinstance(branch, dict):
            continue
        items = branch.get("items")
        if (
            branch.get("type") == "array"
            and isinstance(items, dict)
            and items.get("type") == "string"
        ):
            found = True
            break
    assert found, tags_schema


def _defs(schema: dict[str, Any]) -> dict[str, Any]:
    return schema.get("$defs", {})


def _properties_for_tool(name: str, tool_schema: dict[str, Any]) -> dict[str, Any]:
    props = tool_schema.get("properties", {})
    if name == "create_tasks_batch":
        tasks_prop = props["tasks"]
        assert tasks_prop.get("type") == "array"
        item_schema: dict[str, Any]
        items = tasks_prop.get("items", {})
        ref = items.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/$defs/"):
            def_name = ref.split("/")[-1]
            item_schema = _defs(tool_schema)[def_name]
        else:
            item_schema = items
        return item_schema.get("properties", {})
    return props


@pytest.mark.asyncio
async def test_write_task_tool_schemas_tags_and_camel_case_fields() -> None:
    tools = await mcp.list_tools()
    by_name = {t.name: t for t in tools}

    for tool_name in (
        "create_task",
        "create_subtask",
        "update_task",
        "create_tasks_batch",
    ):
        assert tool_name in by_name, f"missing tool {tool_name}"

    for tool_name in ("create_task", "create_subtask", "update_task"):
        raw = by_name[tool_name].inputSchema
        assert isinstance(raw, dict)
        props = _properties_for_tool(tool_name, raw)
        _tags_property_is_array_of_strings(props)
        assert "dueDate" in props
        assert "deferDate" in props
        assert "estimatedMinutes" in props
        assert "due_date" not in props
        assert "defer_date" not in props
        assert "estimated_minutes" not in props

    batch_raw = by_name["create_tasks_batch"].inputSchema
    assert isinstance(batch_raw, dict)
    batch_props = _properties_for_tool("create_tasks_batch", batch_raw)
    _tags_property_is_array_of_strings(batch_props)
    assert "dueDate" in batch_props
    assert "deferDate" in batch_props
    assert "estimatedMinutes" in batch_props
    assert "due_date" not in batch_props
    assert "defer_date" not in batch_props
    assert "estimated_minutes" not in batch_props
