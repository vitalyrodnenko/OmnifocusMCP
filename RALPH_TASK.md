---
task: Build OmniFocus MCP server — Python + TypeScript implementations
test_command: "cd python && ruff check src/ && mypy src/ --strict && pytest tests/ -v && cd ../typescript && npx tsc --noEmit && npm test"
---

# Task: OmniFocus MCP Server (Multi-Implementation)

Build a fully functional Model Context Protocol (MCP) server that lets any
MCP-compatible client (Claude Desktop, Cursor, Cline, Zed, custom agents,
etc.) interact with OmniFocus on macOS. Two implementations: **Python**
(primary, built first) and **TypeScript** (port). Both communicate with
OmniFocus via JXA (JavaScript for Automation) executed through `osascript`,
using the `Application('OmniFocus').evaluateJavaScript(...)` pattern for full
Omni Automation API access. Both use stdio transport (the universal MCP
transport supported by all clients).

## Why no Docker?

OmniFocus is a native macOS app. The ONLY way to script it is via `osascript`,
a macOS system binary. Docker containers run Linux and have no access to
`osascript` or the OmniFocus app on the host. There is no REST API, no
network interface, no remote protocol. Docker is fundamentally incompatible
with this use case.

## Why Python first?

1. No compile step — fastest feedback loop for iterating on JXA scripts
2. FastMCP is extremely concise (`@mcp.tool()` decorators, minimal boilerplate)
3. Once every JXA script is proven against real OmniFocus, the TS port is
   mechanical — the JXA strings (the hard part) are identical in both versions
4. The server wrapper is thin either way; the core IP is the JXA scripts

## Architecture Notes

- **Transport:** stdio (universal MCP transport, works with all clients)
- **JXA bridge:** `osascript -l JavaScript` spawning, with an inner
  `evaluateJavaScript()` call so we get the full Omni Automation API
  (flattenedTasks, Task.Status, etc.) rather than the limited external SPI.
- **Input sanitization:** all user-supplied strings MUST be escaped via
  `JSON.stringify()` before interpolation into JXA to prevent injection.
- **Result limiting:** all list tools default to 100 results max, with an
  optional `limit` parameter, to handle databases with thousands of tasks.
- **Date format:** all date inputs/outputs use ISO 8601 strings.
- **Task IDs:** use `id.primaryKey` for stable cross-session references.

## Monorepo Structure

```
OmnifocusMCP/
  README.md                         — top-level overview, feature comparison
  RALPH_TASK.md                     — this file
  .ralph/                           — Ralph loop state
  python/                           — Python implementation
    pyproject.toml                  — uv/pip config with mcp dependency
    tests/                          — pytest test suite
      conftest.py                   — shared fixtures, mocks
      test_jxa.py                   — JXA escaping + execution tests
      test_tools_tasks.py           — task tool tests (mocked JXA)
      test_tools_projects.py        — project tool tests
      test_tools_misc.py            — tags, folders, forecast, perspectives
      test_errors.py                — error handling paths
    src/
      omnifocus_mcp/
        __init__.py
        server.py                   — FastMCP server entry point
        jxa.py                      — osascript execution helpers
        tools/
          __init__.py
          tasks.py                  — task read/write tools
          projects.py               — project read/write tools
          tags.py                   — tag tools
          folders.py                — folder tools
          forecast.py               — forecast/today tools
          perspectives.py           — perspective tools
        resources.py                — MCP resource definitions
        prompts.py                  — MCP prompt templates
  typescript/                       — TypeScript implementation
    package.json
    tsconfig.json
    tests/                          — vitest test suite
      jxa.test.ts
      tools-tasks.test.ts
      tools-projects.test.ts
      tools-misc.test.ts
      errors.test.ts
    src/
      index.ts                      — McpServer entry point
      jxa.ts                        — osascript execution helpers
      tools/
        tasks.ts
        projects.ts
        tags.ts
        folders.ts
        forecast.ts
        perspectives.ts
      resources.ts
      prompts.ts
      types.ts                      — shared TypeScript interfaces
```

---

## Phase 1 — Repo Scaffolding

Set up the monorepo structure, top-level README, and shared configuration.

### Success Criteria

1. [x] Monorepo directory structure created: `python/`, `typescript/`,
       top-level `README.md`, `.gitignore` (covers node_modules, dist,
       __pycache__, .venv, *.pyc).
2. [x] Top-level `README.md` explains: what this project is, that there are
       two implementations (Python + TS), prerequisites (macOS, OmniFocus 3+,
       Node 18+ / Python 3.10+), compatible MCP clients (Claude Desktop,
       Cursor, Cline, Zed, etc.), and links to each implementation's README.
3. [x] Git repo initialized with an initial commit.

---

## Phase 2 — Python: JXA Execution Layer

Build the critical foundation — the `osascript` bridge that every tool
depends on. Validate it works against real OmniFocus.

### Success Criteria

4. [x] `python/pyproject.toml` exists with `mcp` dependency, project
       metadata, Python >=3.10 requirement, and dev deps (`pytest`,
       `pytest-asyncio`, `ruff`, `mypy`). Installable via
       `uv pip install -e ".[dev]"` or `pip install -e ".[dev]"`.
5. [x] `python/src/omnifocus_mcp/jxa.py` exports `async def run_jxa(script: str) -> str`
       that spawns `osascript -l JavaScript -e <script>` via asyncio subprocess
       and returns stdout. Raises on non-zero exit with stderr.
6. [x] `python/src/omnifocus_mcp/jxa.py` exports `async def run_jxa_json(script: str) -> Any`
       that parses stdout as JSON.
7. [x] `python/src/omnifocus_mcp/jxa.py` exports `async def run_omnijs(script: str) -> Any`
       that wraps the script in `Application('OmniFocus').evaluateJavaScript()`
       for full Omni Automation API access from external context.
8. [x] Error handling covers: OmniFocus not running (clear error message),
       script syntax errors, and timeout (30 s default).
9. [x] `python/src/omnifocus_mcp/jxa.py` exports `def escape_for_jxa(value: str) -> str`
       that sanitizes user input via `json.dumps()` to prevent injection.
10. [x] `python/src/omnifocus_mcp/server.py` creates a FastMCP server with a
       `ping` health-check tool. Running `python -m omnifocus_mcp` starts
       the server over stdio.

### Tests (Phase 2)

11. [x] Test setup: `python/tests/conftest.py` with shared fixtures and a
       mock for `run_omnijs` that returns pre-built JSON (no real osascript).
12. [x] Tests for `escape_for_jxa`: strings with double quotes, backslashes,
       newlines, unicode, emoji, empty string, very long strings. All pass.
13. [x] Tests for `run_jxa` error paths (mocked subprocess): non-zero exit
       → clear error message. Timeout → TimeoutError.
14. [x] Tests for `run_omnijs` / `run_jxa_json` (mocked subprocess): valid
       JSON stdout → parsed result. Malformed stdout → clean error.
15. [x] `ruff check src/ && mypy src/ --strict && pytest tests/ -v` all pass.

---

## Phase 3 — Python: Read Tools

Expose MCP tools that **read** data from OmniFocus. Each tool returns
well-structured JSON. No mutations. All list tools support a `limit`
parameter (default 100).

### Success Criteria

16. [x] Tool `get_inbox` — returns all inbox (unprocessed) tasks. Each task
        includes: `id`, `name`, `note`, `flagged`, `dueDate`, `deferDate`,
        `tags[]`, `estimatedMinutes`.
17. [x] Tool `list_tasks` — workhorse query tool. Optional filters: `project`
        (name), `tag` (name), `flagged` (bool), `status` (available |
        due_soon | overdue | completed | all), `limit` (default 100).
        Returns task objects with: `id`, `name`, `note`, `flagged`,
        `dueDate`, `deferDate`, `completed`, `projectName`, `tags[]`,
        `estimatedMinutes`.
18. [x] Tool `get_task` — accepts task `id`, returns full detail including:
        all list_tasks fields plus `children[]`, `parentName`, `sequential`,
        `repetitionRule`, `completionDate`.
19. [x] Tool `search_tasks` — accepts `query` string + optional `limit`.
        Searches task names AND notes. Returns matching tasks.
20. [x] Tool `list_projects` — optional filters: `folder` (name), `status`
        (active | on_hold | completed | dropped, default: active). Returns:
        `id`, `name`, `status`, `folderName`, `taskCount`,
        `remainingTaskCount`, `deferDate`, `dueDate`, `note`, `sequential`,
        `reviewInterval`.
21. [x] Tool `get_project` — accepts project `id` or `name`. Returns full
        project detail with root-level tasks.
22. [x] Tool `list_tags` — returns all tags: `id`, `name`, `parent` (for
        nested), `availableTaskCount`, `status`.
23. [x] Tool `list_folders` — returns folder hierarchy: `id`, `name`,
        `parentName`, `projectCount`.
24. [x] Tool `get_forecast` — today's dashboard: overdue + due today +
        flagged tasks, grouped by section.
25. [x] Tool `list_perspectives` — available perspectives (built-in + custom):
        `id`, `name`.

### Tests (Phase 3)

26. [x] Happy-path tests for every read tool (mocked `run_omnijs`): mock
        returns realistic JSON → verify correct parsing, field mapping,
        and return shape. One test per tool minimum.
27. [x] Error-path tests: task not found by ID → error response. Invalid
        filter value → validation error. Empty result set → empty array
        (not an error).
28. [x] `ruff check src/ && mypy src/ --strict && pytest tests/ -v` all pass.

---

## Phase 4 — Python: Write Tools

Expose MCP tools that **create, update, complete, and move** items. All
write tools return confirmation with the affected item's current state.

### Success Criteria

29. [x] Tool `create_task` — required `name`, optional `project` (name),
        `note`, `dueDate` (ISO 8601), `deferDate`, `flagged`, `tags[]`
        (names), `estimatedMinutes`. No project → inbox. Returns `{id, name}`.
30. [x] Tool `create_tasks_batch` — array of task definitions (same schema).
        Single JXA call for efficiency. Returns `[{id, name}]`.
31. [x] Tool `complete_task` — by `id`. Handles repeating tasks gracefully.
        Returns confirmation with task name.
32. [x] Tool `update_task` — by `id`. Optional: `name`, `note`, `dueDate`,
        `deferDate`, `flagged`, `tags[]`, `estimatedMinutes`. Only provided
        fields change. Returns updated task.
33. [x] Tool `delete_task` — drops/removes by `id`. Warns if task has
        children. Returns confirmation.
34. [x] Tool `move_task` — moves task to a different project (by name) or
        back to inbox. Returns confirmation.
35. [x] Tool `create_project` — required `name`, optional `folder` (name),
        `note`, `dueDate`, `deferDate`, `sequential` (bool). Returns `{id}`.
36. [x] Tool `complete_project` — by `id` or `name`. Returns confirmation.
37. [x] Tool `create_tag` — required `name`, optional `parent` (tag name
        for nesting). Returns `{id}`.

### Tests (Phase 4)

38. [x] Happy-path tests for every write tool (mocked `run_omnijs`): verify
        the generated JXA script contains correct parameters (e.g.,
        `create_task` sets name, project, tags). Verify return shape.
39. [x] Test `create_task` with all optional fields set and with only
        required fields. Verify JXA script differs correctly.
40. [x] Test `create_tasks_batch` creates N tasks in a single JXA call
        (verify single `run_omnijs` invocation, not N calls).
41. [x] Test `update_task` only modifies provided fields (omitted fields
        must NOT be nulled out in the JXA script).
42. [x] Error-path tests: `complete_task` with nonexistent ID → error.
        `create_task` with empty name → validation error.
43. [x] `ruff check src/ && mypy src/ --strict && pytest tests/ -v` all pass.

---

## Phase 5 — Python: Resources & Prompts

Expose MCP **resources** (read-only context) and **prompt templates**
encoding GTD workflows.

### Success Criteria

44. [x] Resource `omnifocus://inbox` — current inbox tasks as JSON.
45. [x] Resource `omnifocus://today` — forecast: overdue + due today + flagged.
46. [ ] Resource `omnifocus://projects` — all active projects summary.
47. [ ] Prompt `daily_review` — fetches due-soon, overdue, flagged tasks;
        helps prioritize the day and identify top 3 items.
48. [ ] Prompt `weekly_review` — fetches all active projects, identifies
        stalled projects, guides GTD-style weekly review.
49. [ ] Prompt `inbox_processing` — fetches inbox items, walks through each:
        decide project, tags, dates, or delete.
50. [ ] Prompt `project_planning` — accepts project name, fetches state,
        helps break down into actionable steps with estimates.

### Tests (Phase 5)

51. [ ] Tests for each resource: verify correct JXA script is called and
        response is valid JSON.
52. [ ] Tests for each prompt: verify template renders with expected
        structure (contains instructions, placeholder for data).
53. [ ] `ruff check src/ && mypy src/ --strict && pytest tests/ -v` all pass.

---

## Phase 6 — Python: Polish

Harden error handling, packaging, and MCP client integration docs.

### Success Criteria

54. [ ] All tools return user-friendly errors: OmniFocus not running,
        task/project/tag not found, invalid input, macOS automation
        permissions not granted.
55. [ ] `python/README.md` with: install instructions (uv + pip), MCP client
        configuration examples (Claude Desktop, Cursor, Cline, generic
        stdio), usage examples.
56. [ ] MCP client configs documented and tested. Examples:
        - Claude Desktop: `"command": "uv", "args": ["run", "omnifocus-mcp"]`
        - Cursor: `"command": "python", "args": ["-m", "omnifocus_mcp"]`
        - Generic stdio: `omnifocus-mcp` (any client that supports stdio)
57. [ ] Server handles rapid sequential tool calls without crashing.
58. [ ] `pyproject.toml` has `[project.scripts]` entry so `omnifocus-mcp`
        CLI command works after install.
59. [ ] Full test suite passes: `ruff check src/ && ruff format --check src/
        && mypy src/ --strict && pytest tests/ -v`. Zero warnings.

---

## Phase 7 — TypeScript: Full Implementation

Port the proven Python implementation to TypeScript. All JXA scripts are
identical — only the server framework and subprocess calls change.

### Success Criteria

60. [ ] `typescript/package.json` with `@modelcontextprotocol/sdk`, `zod`,
        dev deps (`typescript`, `@types/node`, `vitest`). `"type": "module"`.
        Scripts: `build`, `start`, `dev`, `test`, `lint`.
61. [ ] `typescript/tsconfig.json` targets ES2022 / NodeNext, outputs `dist/`.
62. [ ] `typescript/src/jxa.ts` — JXA execution layer ported: `runJxa`,
        `runJxaJson`, `runOmniJs`, `escapeForJxa`. Same error handling +
        timeout. Uses `child_process.execFile`.
63. [ ] All 10 read tools ported and `npm run build` passes with no errors.
64. [ ] All 9 write tools ported and build passes.
65. [ ] Resources (3) and prompts (4) ported.
66. [ ] `typescript/README.md` with install instructions, MCP client config
        examples (Claude Desktop, Cursor, Cline, generic stdio).
67. [ ] `package.json` has `"bin"` entry; server runs via `npx`.

### Tests (Phase 7)

68. [ ] Tests for `escapeForJxa`: same adversarial inputs as Python tests
        (quotes, backslashes, newlines, unicode, emoji, empty, long).
69. [ ] Tests for `runJxa` / `runOmniJs` error paths (mocked subprocess):
        non-zero exit, timeout, malformed JSON.
70. [ ] Happy-path tests for at least 3 representative read tools and
        3 representative write tools (mocked `runOmniJs`). Verifies
        correct JXA script generation and response parsing.
71. [ ] `npx tsc --noEmit && npm test` passes with zero errors.

---

## Phase 8 — Final Polish

Ensure both implementations are complete, documented, and consistent.

### Success Criteria

72. [ ] Top-level `README.md` updated with feature comparison table,
        installation instructions for both implementations, MCP client
        config examples for popular clients, and links.
73. [ ] MCP client configs for both implementations tested. Documented
        how to switch between Python and TS versions in any client.
74. [ ] Both implementations pass their respective full check commands
        with no warnings (lint + typecheck + tests).
75. [ ] `.gitignore` is complete, repo is clean, tagged as `v1.0.0`.

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. Run tests after every code change — all tests must pass before proceeding
4. Commit your changes frequently
5. When ALL criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
6. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
