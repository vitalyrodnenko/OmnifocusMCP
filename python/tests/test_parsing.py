import asyncio
from typing import Any

import pytest

from omnifocus_mcp.jxa import run_jxa_json, run_omnijs


@pytest.mark.asyncio
async def test_run_jxa_json_parses_valid_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_jxa(script: str, timeout_seconds: float = 30.0) -> str:
        return '{"ok": true, "data": [1, 2, 3]}'

    monkeypatch.setattr("omnifocus_mcp.jxa.run_jxa", fake_run_jxa)

    result = await run_jxa_json("ignored")
    assert result == {"ok": True, "data": [1, 2, 3]}


@pytest.mark.asyncio
async def test_run_jxa_json_malformed_output_raises_clean_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_jxa(script: str, timeout_seconds: float = 30.0) -> str:
        return "not json"

    monkeypatch.setattr("omnifocus_mcp.jxa.run_jxa", fake_run_jxa)

    with pytest.raises(RuntimeError, match="malformed JSON"):
        await run_jxa_json("ignored")


@pytest.mark.asyncio
async def test_run_omnijs_parses_envelope_and_returns_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen_scripts: list[str] = []

    class FakeProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return (b'{"ok": true, "data": {"id": "abc123"}}', b"")

        def kill(self) -> None:
            return None

        async def wait(self) -> int:
            return 0

    async def fake_create_subprocess_exec(*args: Any, **kwargs: Any) -> FakeProcess:
        script = args[4]
        seen_scripts.append(script)
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = await run_omnijs("return { id: 'abc123' };")
    assert result == {"id": "abc123"}
    assert len(seen_scripts) == 1
    assert "evaluateJavascript" in seen_scripts[0]


@pytest.mark.asyncio
async def test_run_omnijs_surfaces_not_found_errors_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_jxa_json(script: str, timeout_seconds: float = 30.0) -> Any:
        return {"ok": False, "error": "Task not found: missing-id"}

    monkeypatch.setattr("omnifocus_mcp.jxa.run_jxa_json", fake_run_jxa_json)

    with pytest.raises(RuntimeError, match="Task not found: missing-id"):
        await run_omnijs("return null;")


@pytest.mark.asyncio
async def test_run_omnijs_wraps_unknown_errors_with_actionable_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_jxa_json(script: str, timeout_seconds: float = 30.0) -> Any:
        return {"ok": False, "error": "unexpected omni automation exception"}

    monkeypatch.setattr("omnifocus_mcp.jxa.run_jxa_json", fake_run_jxa_json)

    with pytest.raises(RuntimeError, match="OmniFocus operation failed: unexpected omni automation exception"):
        await run_omnijs("return null;")


@pytest.mark.asyncio
async def test_run_omnijs_permissions_error_is_user_friendly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_jxa_json(script: str, timeout_seconds: float = 30.0) -> Any:
        return {"ok": False, "error": "Not authorised to send Apple events to OmniFocus. (-1743)"}

    monkeypatch.setattr("omnifocus_mcp.jxa.run_jxa_json", fake_run_jxa_json)

    with pytest.raises(RuntimeError, match="Grant permission in System Settings"):
        await run_omnijs("return null;")
