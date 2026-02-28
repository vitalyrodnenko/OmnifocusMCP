import asyncio
import json
from typing import Any


DEFAULT_TIMEOUT_SECONDS = 30.0
_JXA_CALL_LOCK = asyncio.Lock()


def escape_for_jxa(value: str) -> str:
    return json.dumps(value)


def _friendly_jxa_error(stderr: str) -> str:
    lowered = stderr.lower()
    if "not running" in lowered and "omnifocus" in lowered:
        return "OmniFocus is not running. Please open OmniFocus and try again."
    if "application isn't running" in lowered and "omnifocus" in lowered:
        return "OmniFocus is not running. Please open OmniFocus and try again."
    if (
        "not authorized" in lowered
        or "not permitted" in lowered
        or "not authorised" in lowered
        or "apple events" in lowered
        or "(-1743)" in lowered
    ):
        return (
            "macOS blocked Automation access to OmniFocus. "
            "Grant permission in System Settings > Privacy & Security > Automation."
        )
    if "syntax error" in lowered:
        return f"JXA script syntax error: {stderr.strip()}"
    return f"JXA execution failed: {stderr.strip()}"


def _friendly_omnijs_error(error: str) -> str:
    cleaned = error.strip()
    lowered = cleaned.lower()
    if lowered.startswith("task not found:"):
        return cleaned
    if lowered.startswith("project not found:"):
        return cleaned
    if lowered.startswith("tag not found:"):
        return cleaned
    if lowered.startswith("folder not found:"):
        return cleaned
    if "not running" in lowered and "omnifocus" in lowered:
        return "OmniFocus is not running. Please open OmniFocus and try again."
    if "application isn't running" in lowered and "omnifocus" in lowered:
        return "OmniFocus is not running. Please open OmniFocus and try again."
    if (
        "not authorized" in lowered
        or "not permitted" in lowered
        or "not authorised" in lowered
        or "apple events" in lowered
        or "(-1743)" in lowered
    ):
        return (
            "macOS blocked Automation access to OmniFocus. "
            "Grant permission in System Settings > Privacy & Security > Automation."
        )
    return f"OmniFocus operation failed: {cleaned}"


async def run_jxa(script: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> str:
    async with _JXA_CALL_LOCK:
        process = await asyncio.create_subprocess_exec(
            "osascript",
            "-l",
            "JavaScript",
            "-e",
            script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout_seconds,
            )
        except TimeoutError as exc:
            process.kill()
            await process.wait()
            raise TimeoutError(
                f"JXA command timed out after {timeout_seconds:.0f}s."
            ) from exc

        if process.returncode != 0:
            stderr_text = stderr_bytes.decode("utf-8", errors="replace")
            raise RuntimeError(_friendly_jxa_error(stderr_text))

        return stdout_bytes.decode("utf-8", errors="replace").strip()


async def run_jxa_json(
    script: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
) -> Any:
    stdout = await run_jxa(script, timeout_seconds=timeout_seconds)
    if stdout == "":
        raise RuntimeError("JXA command returned empty output.")

    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("JXA command returned malformed JSON.") from exc


async def run_omnijs(
    script: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
) -> Any:
    wrapped_omnijs = f"""
(function() {{
  try {{
    if (typeof document === "object" && document) {{
      if (typeof document.flattenedTasks === "undefined" && typeof flattenedTasks !== "undefined") {{
        document.flattenedTasks = flattenedTasks;
      }}
      if (
        typeof document.flattenedProjects === "undefined"
        && typeof flattenedProjects !== "undefined"
      ) {{
        document.flattenedProjects = flattenedProjects;
      }}
      if (typeof document.flattenedTags === "undefined" && typeof flattenedTags !== "undefined") {{
        document.flattenedTags = flattenedTags;
      }}
      if (
        typeof document.flattenedFolders === "undefined"
        && typeof flattenedFolders !== "undefined"
      ) {{
        document.flattenedFolders = flattenedFolders;
      }}
    }}
    const __data = (function() {{
{script}
    }})();
    return JSON.stringify({{ ok: true, data: __data }});
  }} catch (e) {{
    return JSON.stringify({{ ok: false, error: e && e.message ? e.message : String(e) }});
  }}
}})()
""".strip()

    outer_jxa = f"""
const app = Application('OmniFocus');
const result = app.evaluateJavascript({escape_for_jxa(wrapped_omnijs)});
result;
""".strip()

    envelope = await run_jxa_json(outer_jxa, timeout_seconds=timeout_seconds)
    if not isinstance(envelope, dict):
        raise RuntimeError("OmniFocus returned an unexpected response.")

    ok = envelope.get("ok")
    if ok is not True:
        error = envelope.get("error")
        if isinstance(error, str) and error.strip():
            raise RuntimeError(_friendly_omnijs_error(error))
        raise RuntimeError("OmniFocus script error.")

    return envelope.get("data")
