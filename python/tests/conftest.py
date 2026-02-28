from collections.abc import Callable
import subprocess
from typing import Any

import pytest


def _omnifocus_available() -> bool:
    try:
        result = subprocess.run(
            ["osascript", "-e", 'tell application "OmniFocus" to running'],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and result.stdout.strip().lower() == "true"


def pytest_collection_modifyitems(
    config: pytest.Config,
    items: list[pytest.Item],
) -> None:
    if config.getoption("-m") == "integration":
        return
    if _omnifocus_available():
        return
    skip_integration = pytest.mark.skip(reason="integration tests require running OmniFocus")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_integration)


@pytest.fixture
def sample_omnijs_payload() -> list[dict[str, str]]:
    return [{"id": "abc123", "name": "Test Task"}]


@pytest.fixture
def mock_run_omnijs(
    monkeypatch: pytest.MonkeyPatch,
) -> Callable[[Any], dict[str, Any]]:
    state: dict[str, Any] = {"result": [{"id": "abc123", "name": "Test Task"}]}
    calls: list[dict[str, Any]] = []

    async def fake_run_omnijs(script: str, timeout_seconds: float = 30.0) -> Any:
        calls.append({"script": script, "timeout_seconds": timeout_seconds})
        return state["result"]

    monkeypatch.setattr("omnifocus_mcp.jxa.run_omnijs", fake_run_omnijs)

    def configure(result: Any) -> dict[str, Any]:
        state["result"] = result
        return {"state": state, "calls": calls}

    return configure
