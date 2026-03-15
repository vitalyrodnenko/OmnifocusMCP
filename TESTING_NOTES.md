# plannedDate Feature — Live MCP Testing Notes

Branch: `feature/planned-date-support`
Date: 2026-03-15
Tester: Claude Code (via live OmniFocus MCP connection)
OmniFocus: Running on macOS

## Test Plan

For each implementation (Python, TypeScript, Rust):
1. **Create task with plannedDate** — verify response includes plannedDate
2. **Create task without plannedDate** — verify plannedDate is null
3. **Update task to set plannedDate** — verify change reflected
4. **Cleanup** — delete all test tasks

## Results

### Python (via `uv run python -m omnifocus_mcp`)

| # | Test | Result | Details |
|---|------|--------|---------|
| 1 | Create with `plannedDate: "2026-04-01"` | PASS | Response: `plannedDate: "2026-04-01T00:00:00.000Z"`, `effectivePlannedDate: "2026-04-01T00:00:00.000Z"` |
| 2 | Create without plannedDate | PASS | Response: `plannedDate: null`, `effectivePlannedDate: null` |
| 3 | Update task to set `plannedDate: "2026-05-01"` | PASS | Response: `plannedDate: "2026-05-01T00:00:00.000Z"` |
| 4 | Cleanup (delete test tasks) | PASS | Both tasks deleted successfully |

### TypeScript (via `node dist/index.js`)

| # | Test | Result | Details |
|---|------|--------|---------|
| 1 | Create with `plannedDate: "2026-04-01"` | PASS | Response: `plannedDate: "2026-04-01T00:00:00.000Z"`, `effectivePlannedDate: "2026-04-01T00:00:00.000Z"` |
| 2 | Create without plannedDate | PASS | Response: `plannedDate: null`, `effectivePlannedDate: null` |
| 3 | Update task to set `plannedDate: "2026-05-01"` | PASS | Response: `plannedDate: "2026-05-01T00:00:00.000Z"` |
| 4 | Cleanup (delete test tasks) | PASS | Both tasks deleted successfully |

### Rust (via compiled binary)

| # | Test | Result | Details |
|---|------|--------|---------|
| 1 | Create with `plannedDate: "2026-04-01"` | PASS | Response: `plannedDate: "2026-04-01T00:00:00.000Z"`, `effectivePlannedDate: "2026-04-01T00:00:00.000Z"` |
| 2 | Create without plannedDate | PASS | Response: `plannedDate: null`, `effectivePlannedDate: null` |
| 3 | Update task to set `plannedDate: "2026-05-01"` | PASS | Response: `plannedDate: "2026-05-01T00:00:00.000Z"` |
| 4 | Cleanup (delete test tasks) | PASS | Both tasks deleted successfully |

## Additional Notes

- Also includes fix to `python/src/omnifocus_mcp/__main__.py`: import changed from `app` to `server` to fix tool registration (0 tools → 49 tools). See commit `59d1e5d`.
- `create_task` and `update_task` schemas correctly expose `plannedDate` as optional parameter across all implementations.
- `get_task` responses include both `plannedDate` and `effectivePlannedDate` fields.
