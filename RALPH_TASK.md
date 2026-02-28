---
task: OmniFocus MCP — real-world validation, refactor, integration tests
test_command: "cd python && ruff check src/ && mypy src/ --strict && pytest tests/ -v && cd ../typescript && npx tsc --noEmit && npm test"
---

# Task: OmniFocus MCP v2 — Validate, Refactor, Harden

The initial build (v1) created both Python and TypeScript MCP server
implementations with 19 tools, 3 resources, 4 prompts, and 89 passing
unit tests. However, **everything was tested against mocks — no real
OmniFocus validation has been done.** Additionally, both implementations
are monolith files that need splitting per the project's architecture rules.

This task addresses: real-world JXA validation, bug fixes, code
organization, and integration tests.

Previous task archived at: `.ralph/RALPH_TASK_v1_complete.md`

---

## Phase 1 — Real OmniFocus Smoke Test

Validate that the JXA scripts actually work against a running OmniFocus
instance. This is the single highest-risk item — if the scripts are
broken, everything else is wasted work.

**Prerequisite:** OmniFocus must be running on this Mac with at least a
few tasks, projects, and tags.

### Success Criteria

1. [x] Create `python/scripts/smoke_test.py` — a standalone async script
       that imports from `omnifocus_mcp` and runs through a validation
       sequence. Not a pytest test — a runnable script with clear
       pass/fail output. Must be runnable via `python scripts/smoke_test.py`
       from within `python/`.
2. [x] Smoke test verifies JXA bridge basics: `run_omnijs` can execute
       `return document.flattenedTasks.length;` and return a number.
3. [x] Smoke test calls every read tool function and verifies each returns
       valid JSON with expected field names: `get_inbox`, `list_tasks`,
       `get_task` (using an ID from list_tasks), `search_tasks`,
       `list_projects`, `get_project`, `list_tags`, `list_folders`,
       `get_forecast`, `list_perspectives`.
4. [x] Smoke test runs a full task CRUD lifecycle:
       - `create_task` with name `[TEST-MCP] Smoke Test Task`, flagged,
         with a due date of tomorrow
       - `get_task` on the created ID — verify fields match
       - `update_task` — change the name to `[TEST-MCP] Updated Task`
       - `complete_task` on that task
       - `delete_task` to clean up
       Prints clear pass/fail for each step.
5. [x] Smoke test runs successfully against real OmniFocus with zero
       failures. Any bugs discovered are documented as comments in the
       smoke test script with `# BUG:` prefix.

---

## Phase 2 — Fix JXA Bugs

Fix every bug discovered during the smoke test. If no bugs are found,
mark all criteria as complete with a note.

### Success Criteria

6. [x] Every `# BUG:` documented in Phase 1 has a corresponding fix
       in the Python source (`python/src/omnifocus_mcp/`).
7. [x] The same fixes are applied to the TypeScript source
       (`typescript/src/`). JXA strings must be identical.
8. [x] All existing mocked unit tests still pass after fixes:
       `cd python && pytest tests/ -v` (64 pass) and
       `cd typescript && npm test` (25 pass).
9. [x] Smoke test (`python/scripts/smoke_test.py`) passes cleanly
       with zero failures after all fixes.

---

## Phase 3 — Split Monolith Files

Refactor the monolith `server.py` (1,216 lines) and `index.ts`
(4,391 lines) into the modular structure defined in the project's
architecture rules. Pure structural refactor — no behavior changes.

### Python Split

Target structure:
```
python/src/omnifocus_mcp/
  server.py            — FastMCP instance + imports (< 50 lines)
  tools/
    __init__.py
    tasks.py           — get_inbox, list_tasks, get_task, search_tasks,
                         create_task, create_tasks_batch, complete_task,
                         update_task, delete_task, move_task
    projects.py        — list_projects, get_project, create_project,
                         complete_project
    tags.py            — list_tags, create_tag
    folders.py         — list_folders
    forecast.py        — get_forecast
    perspectives.py    — list_perspectives
  resources.py         — 3 resource handlers
  prompts.py           — 4 prompt handlers
```

### TypeScript Split

Target structure:
```
typescript/src/
  index.ts             — McpServer + transport + imports (< 50 lines)
  tools/
    tasks.ts           — register function for task tools
    projects.ts        — register function for project tools
    tags.ts            — register function for tag tools
    folders.ts         — register function for folder tools
    forecast.ts        — register function for forecast tool
    perspectives.ts    — register function for perspectives tool
  resources.ts         — resource registrations
  prompts.ts           — prompt registrations
  types.ts             — shared interfaces (TaskResult, etc.)
```

### Success Criteria

10. [x] Python: `server.py` refactored to < 50 lines. Creates FastMCP
        instance, imports tool/resource/prompt modules that register
        themselves, exports `mcp`.
11. [x] Python: `tools/` directory created with separate files per entity.
        Each file imports `mcp` from `server` and registers its tools.
        JXA script constants live in the same file as the tool that uses them.
12. [x] Python: `resources.py` and `prompts.py` created with their
        respective handlers extracted from the old `server.py`.
13. [x] Python: `ruff check src/ && ruff format --check src/ && mypy src/
        --strict && pytest tests/ -v` all pass. Zero test failures.
14. [x] TypeScript: `index.ts` refactored to < 50 lines. Creates
        McpServer, calls `register(server)` from each tool module,
        connects StdioServerTransport.
15. [x] TypeScript: `tools/` directory created with separate files.
        Each exports a `register(server: McpServer): void` function.
        `resources.ts`, `prompts.ts`, `types.ts` created.
16. [x] TypeScript: `npx tsc --noEmit && npm test` passes. Zero failures.
17. [x] Smoke test still passes against real OmniFocus after refactor.

---

## Phase 4 — Integration Tests

Add automated tests that talk to real OmniFocus. These are skipped by
default and only run when explicitly requested.

### Success Criteria

18. [x] `python/pyproject.toml` has pytest marker config:
        `markers = ["integration: requires running OmniFocus"]`.
        `python/tests/conftest.py` updated with skip logic for
        `integration` marker when OmniFocus is not available.
19. [ ] `python/tests/test_integration.py` created with
        `@pytest.mark.integration` on every test. Tests:
        - `test_jxa_bridge_connectivity` — basic `run_omnijs` call
        - `test_read_tools_return_valid_json` — calls each read tool,
          asserts return is parseable JSON with expected top-level keys
        - `test_task_lifecycle` — create → get → update → complete → delete
          using `[TEST-MCP]` prefix. Cleanup in fixture teardown.
        - `test_search_finds_created_task` — create task, search, assert found
        - `test_project_lifecycle` — create → get → complete
20. [ ] Python integration tests pass when run explicitly:
        `cd python && pytest tests/ -v -m integration` (with OmniFocus running).
21. [ ] Python integration tests skip cleanly when run normally:
        `cd python && pytest tests/ -v` shows them as skipped (not failed).
22. [ ] TypeScript: `typescript/tests/integration.test.ts` created with
        equivalent tests. Uses `describe.skipIf()` or environment variable
        to skip when OmniFocus is unavailable.
23. [ ] TypeScript integration tests pass when run explicitly.
24. [ ] No test data leaks — all `[TEST-MCP]` items are cleaned up by
        test teardown, even if assertions fail mid-test.

---

## Phase 5 — Final Cleanup

Verify everything is production-ready.

### Success Criteria

25. [ ] Both servers start and stop cleanly:
        - `echo '{}' | python -m omnifocus_mcp` exits without crash
        - `echo '{}' | node typescript/dist/index.js` exits without crash
26. [ ] Full test commands pass for both implementations (mocked tests):
        - `cd python && ruff check src/ && ruff format --check src/ &&
          mypy src/ --strict && pytest tests/ -v`
        - `cd typescript && npx tsc --noEmit && npm test`
27. [ ] Git status is clean — no untracked source files, no uncommitted
        changes. Commit all work with a descriptive message.
28. [ ] Tag the repo as `v1.0.0` (if not already tagged).

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. Run tests after every code change — all tests must pass before proceeding
4. **Phase 1 requires real OmniFocus** — if OmniFocus is not running or
   permission is denied, output: `<ralph>GUTTER</ralph>` with an
   explanation of what failed
5. Commit your changes frequently
6. When ALL criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
7. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
