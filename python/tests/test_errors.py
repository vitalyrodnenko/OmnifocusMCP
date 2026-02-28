import asyncio

import pytest

from omnifocus_mcp.jxa import run_jxa


class FakeProcess:
    def __init__(self, stdout: str, stderr: str, returncode: int, delay: float = 0.0):
        self._stdout = stdout.encode("utf-8")
        self._stderr = stderr.encode("utf-8")
        self.returncode = returncode
        self._delay = delay
        self.killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        if self._delay > 0:
            await asyncio.sleep(self._delay)
        return (self._stdout, self._stderr)

    def kill(self) -> None:
        self.killed = True

    async def wait(self) -> int:
        return self.returncode


@pytest.mark.asyncio
async def test_run_jxa_non_zero_exit_has_clear_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_create_subprocess_exec(*args: str, **kwargs: object) -> FakeProcess:
        return FakeProcess("", "syntax error: expected ';'", 1)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    with pytest.raises(RuntimeError, match="syntax error"):
        await run_jxa("invalid script")


@pytest.mark.asyncio
async def test_run_jxa_timeout_raises_timeout_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_create_subprocess_exec(*args: str, **kwargs: object) -> FakeProcess:
        return FakeProcess("", "", 0, delay=0.2)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    with pytest.raises(TimeoutError, match="timed out"):
        await run_jxa("1 + 1", timeout_seconds=0.01)


@pytest.mark.asyncio
async def test_run_jxa_not_running_has_user_friendly_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_create_subprocess_exec(*args: str, **kwargs: object) -> FakeProcess:
        return FakeProcess("", "Application isn't running: OmniFocus", 1)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    with pytest.raises(RuntimeError, match="OmniFocus is not running"):
        await run_jxa("ignored")


@pytest.mark.asyncio
async def test_run_jxa_permissions_error_has_user_guidance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_create_subprocess_exec(*args: str, **kwargs: object) -> FakeProcess:
        return FakeProcess("", "Not authorised to send Apple events to OmniFocus. (-1743)", 1)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    with pytest.raises(RuntimeError, match="Grant permission in System Settings"):
        await run_jxa("ignored")


@pytest.mark.asyncio
async def test_run_jxa_serializes_concurrent_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    active_calls = 0
    max_active_calls = 0

    class SequentialProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            nonlocal active_calls, max_active_calls
            active_calls += 1
            max_active_calls = max(max_active_calls, active_calls)
            await asyncio.sleep(0.02)
            active_calls -= 1
            return (b"ok", b"")

        def kill(self) -> None:
            return None

        async def wait(self) -> int:
            return 0

    async def fake_create_subprocess_exec(*args: str, **kwargs: object) -> SequentialProcess:
        return SequentialProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    first, second = await asyncio.gather(run_jxa("one"), run_jxa("two"))
    assert first == "ok"
    assert second == "ok"
    assert max_active_calls == 1
