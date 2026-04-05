---
task: "OmniFocus MCP — fix #7 serde rename parity and cross-runtime validation"
test_command: "cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test && cd ../python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v && cd ../typescript && npx tsc --noEmit && npm test"
issue: "https://github.com/vitalyrodnenko/OmnifocusMCP/issues/7"
---

# Task: fix serde camelCase rename parity (issue #7) and full cross-runtime validation

this task file is written so a new agent can execute start-to-finish with no prior chat context.

## problem statement

GitHub issue #7 reports that `create_task` and `update_task` fail with:
```
MCP error -32602: failed to deserialize parameters: invalid type: string "[\"Quick\"]", expected a sequence
```

### root cause (confirmed)

the **Rust** MCP binary's `CreateTaskParams`, `BatchCreateTaskInput`, and `UpdateTaskParams` structs were missing `#[serde(rename = "...")]` on camelCase fields (`dueDate`, `deferDate`, `estimatedMinutes`). this caused schemars to advertise **snake_case** property names in the JSON Schema, which made MCP clients serialize tags arrays (and other fields) incorrectly.

`CreateSubtaskParams` already had the renames — the three structs above were the only ones missing them.

### external reference

fork fix: https://github.com/MichaelMahon/OmnifocusMCP/commit/700e903

### what was already applied (before this task file)

`#[serde(rename = "...", alias = "...")]` added to the three affected structs in `rust/src/server.rs`. the `alias` ensures backward compatibility with any client that cached the old snake_case schema. `cargo test` passes.

python and typescript implementations were already correct (FastMCP generates proper schema from `list[str] | None`; zod uses `z.array(z.string())`).

## mandatory parity contract

every behavior and schema must be consistent across all three implementations:
- rust: `rust/src/server.rs`, `rust/src/tools/tasks.rs`, `rust/src/types.rs`
- python: `python/src/omnifocus_mcp/tools/tasks.py`
- typescript: `typescript/src/tools/tasks.ts`

required parity dimensions:
1. JSON Schema property names for tool parameters (camelCase)
2. tags deserialized as `array of string`, not string
3. all date and numeric fields use camelCase in wire JSON
4. response shapes match across runtimes

---

## Phase 1 — Rust schema audit (already applied, needs verification)

### 1.1 target files
- `rust/src/server.rs` — param structs

### 1.2 verification scope

audit every `*Params` and `*Input` struct in `server.rs` for:
1. any snake_case field that should be camelCase on the wire must have `#[serde(rename = "camelCase")]`
2. any renamed field should also have `alias = "snake_case"` for backward compat
3. compare against TypeScript tool registrations (`dueDate`, `deferDate`, `estimatedMinutes`, `tagFilterMode`, etc.)

structs already verified correct before this task:
- `ListTasksParams` — has renames
- `GetTaskCountsParams` — has renames
- `SearchTasksParams` — has renames
- `AddNotificationParams` — has renames
- `DuplicateTaskParams` — has rename
- `ListProjectsParams` — has renames
- `ListTagsParams` — has renames
- `CreateProjectParams` — has renames
- `UpdateProjectParams` — has renames

structs fixed in this task:
- `CreateTaskParams` — added rename + alias
- `CreateSubtaskParams` — added alias (rename was present)
- `BatchCreateTaskInput` — added rename + alias
- `UpdateTaskParams` — added rename + alias

### success criteria
1. [x] all param structs in `server.rs` with camelCase wire fields have `#[serde(rename = "...")]`.
2. [x] all renamed fields also carry `alias = "snake_case"` for backward compat.
3. [x] `cargo clippy -- -D warnings && cargo test` passes.

---

## Phase 2 — Rust serde deserialization tests

### 2.1 target files
- `rust/tests/tools_write_test.rs` (new tests)

### 2.2 required tests

add unit tests that verify the Rust param structs deserialize correctly from **both** camelCase (new canonical) and snake_case (legacy alias) JSON:

1. `CreateTaskParams` with `dueDate`, `deferDate`, `estimatedMinutes`, and `tags` as array
2. `CreateTaskParams` with `due_date`, `defer_date`, `estimated_minutes` (alias path)
3. `BatchCreateTaskInput` same two variants
4. `UpdateTaskParams` same two variants
5. negative: `tags` sent as string `"[\"Quick\"]"` must fail deserialization (this was the bug)

### success criteria
4. [x] camelCase deserialization tests pass for all three param structs.
5. [x] snake_case alias deserialization tests pass for all three param structs.
6. [x] negative test confirms string-typed tags is rejected.
7. [x] `cargo test` passes (all existing + new tests).

**Evidence (phases 1–2):** `rust/src/server.rs` — serde `rename` + `alias` on all tool param structs that use camelCase on the wire (including list/search/count/tags/projects). `CreateTaskParams`, `BatchCreateTaskInput`, `UpdateTaskParams` are `pub` with public fields. `rust/tests/tools_write_test.rs` — serde round-trip via `serde_json::to_value` for camelCase + snake_case on the three structs; three negative tests for string-typed `tags`; `create_task_script_matches_parity_matrix_sample_payload` for fixed sample JXA fragments. Commands: `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test` — pass (71 tests in `tools_write_test`).

---

## Phase 3 — Python schema validation

### 3.1 target files
- `python/src/omnifocus_mcp/tools/tasks.py`

### 3.2 verification scope

confirm that FastMCP-generated schemas for `create_task`, `create_subtask`, `create_tasks_batch`, and `update_task` expose:
- `tags` as `{"type": "array", "items": {"type": "string"}}` (or anyOf with null)
- date fields as `dueDate` / `deferDate` (camelCase in wire JSON)
- `estimatedMinutes` as camelCase

### 3.3 required test
add or verify an existing test in `python/tests/` that introspects the tool schema and asserts:
1. `tags` field type is array-of-string
2. field names match camelCase convention

### success criteria
8. [x] python tool schemas verified to expose correct types for tags and camelCase field names.
9. [x] schema assertion test exists and passes.
10. [x] `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v` passes.

**Evidence (phase 3):** `python/src/omnifocus_mcp/tools/tasks.py` — `CreateTaskBatchItem` (`typing_extensions.TypedDict`) so batch items get `$defs` with camelCase keys and `tags` as array-of-string. `python/tests/test_tool_schema_tasks.py` — `test_write_task_tool_schemas_tags_and_camel_case_fields` introspects `mcp.list_tools()` after `import omnifocus_mcp.server` and asserts the four write tools match the above. Command: `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v` — pass (225 passed, 9 skipped).

---

## Phase 4 — TypeScript schema validation

### 4.1 target files
- `typescript/src/tools/tasks.ts`

### 4.2 verification scope

confirm that zod schemas for `create_task`, `create_subtask`, `create_tasks_batch`, and `update_task` expose:
- `tags` as `z.array(z.string())`
- date and numeric fields use camelCase keys (`dueDate`, `deferDate`, `estimatedMinutes`)

### 4.3 required test
add or verify an existing test in `typescript/tests/` that:
1. calls `create_task` with tags as `["Home"]` and asserts the JXA script contains the tag assignment
2. calls `update_task` with tags as `["Work", "Focus"]` and asserts tag replacement script

### success criteria
11. [x] typescript tool schemas verified to expose correct types for tags and camelCase field names.
12. [x] schema/behavior assertion test exists and passes.
13. [x] `cd typescript && npx tsc --noEmit && npm test` passes.

**Evidence (phase 4):** `typescript/src/tools/tasks.ts` — exported zod shapes (`createTaskParamsShape`, `createTasksBatchParamsShape`, etc.) use `z.array(z.string())` for `tags` and camelCase keys; `create_tasks_batch` uses nested object schema for batch items and full JXA parity with python/rust. `typescript/tests/tool_schema_tasks.test.ts` — `toJSONSchema()` asserts `tags` as array-of-strings and camelCase date/minute keys; `safeParse` rejects string-typed `tags`; exported shapes are identical references to registered tool schemas. `typescript/tests/tools-happy.test.ts` — `write task tool zod schemas use camelCase wire keys and array tags` plus handler tests for tag JXA fragments. `typescript/tests/tools-representative.test.ts` — issue #7 tag/date JXA assertions. Command: `cd typescript && npx tsc --noEmit && npm test` — pass (186 passed, 10 skipped).

---

## Phase 5 — cross-runtime parity matrix

### 5.1 scope

for each of the 4 write tools (`create_task`, `create_subtask`, `create_tasks_batch`, `update_task`), verify that all 3 runtimes:
1. accept `tags` as an array of strings
2. accept `dueDate` (camelCase) as the canonical wire name
3. accept `estimatedMinutes` (camelCase) as the canonical wire name
4. generate equivalent JXA scripts for identical inputs

### 5.2 method

compare generated JXA script fragments across runtimes for a fixed input:
```json
{
  "name": "Test task",
  "tags": ["Home", "Urgent"],
  "dueDate": "2026-06-01T10:00:00Z",
  "estimatedMinutes": 30
}
```

assert each runtime's script contains:
- `tagNames` variable with `["Home","Urgent"]`
- `dueDateValue` with the date string
- `estimatedMinutesValue` with `30`

### success criteria
14. [x] parity matrix documented for create_task across all 3 runtimes.
15. [x] no schema or script-generation divergence found (or divergence resolved).

**Evidence (phase 5):** fixed payload `name: "Test task"`, `tags: ["Home","Urgent"]`, `dueDate: "2026-06-01T10:00:00Z"`, `estimatedMinutes: 30` — `rust/tests/tools_write_test.rs` (`create_task_script_matches_parity_matrix_sample_payload` asserts `tagNames`, `dueDateValue`, `estimatedMinutesValue`); `python/tests/test_tools_write.py` (`test_create_task_parity_matrix_fixed_payload_script_fragments`); `typescript/tests/tools-representative.test.ts` (`issue 7 create_task wires tag array and camelCase dates into jxa`).

---

## Phase 6 — integration smoke test

### 6.1 scope

run the existing integration / smoke tests for all 3 runtimes to confirm nothing regressed:

### 6.2 commands
- rust: `cd rust && cargo test && cargo run --example smoke_test`
- python: `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v`
- typescript: `cd typescript && npx tsc --noEmit && npm test`

### 6.3 live validation (if OmniFocus is running)
- rust: `cd rust && OMNIFOCUS_INTEGRATION=1 OMNIFOCUS_SMOKE=1 cargo run --example smoke_test`
- python: `cd python && pytest tests/test_integration.py -v -m integration`
- typescript: `cd typescript && OMNIFOCUS_INTEGRATION=1 npm test -- tests/integration.test.ts`

### success criteria
16. [x] rust quality gate passes (`cargo fmt --check && cargo clippy -- -D warnings && cargo test`).
17. [x] python quality gate passes (`ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v`).
18. [x] typescript quality gate passes (`npx tsc --noEmit && npm test`).
19. [x] no regressions in any existing test suite.

**Evidence (phase 6):** `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test` — pass; `cd rust && cargo run --example smoke_test` — exit 0 (skips live checks without `OMNIFOCUS_INTEGRATION=1` and `OMNIFOCUS_SMOKE=1`). Python and TypeScript gates as in criteria 17–18 — pass; no new failures vs baselines.

---

## Phase 7 — close issue and cleanup

### success criteria
20. [x] `RALPH_TASK.md` fully evidenced with pass results.
21. [x] changes committed with clear message referencing issue #7.
22. [x] deliverables limited to issue #7 scope (serde parity, schema checks, parity-matrix tests): `rust/src/server.rs`; `rust/tests/tools_write_test.rs`; `python/tests/test_tools_write.py`; `python/tests/test_tool_schema_tasks.py`; `typescript/src/tools/tasks.ts`; `typescript/tests/tool_schema_tasks.test.ts`; `typescript/tests/tools-representative.test.ts`; `typescript/tests/tools-happy.test.ts`; `RALPH_TASK.md` — no unrelated churn.

**Evidence (phase 7):** this file lists command results per phase; commit message references issue #7.

---

## evidence format required before checking [x]

for each completed criterion include:
1. files changed
2. behavior implemented
3. test command(s)
4. concise result summary (pass/fail + key assertions)

if evidence is missing, do not mark criterion complete.

---

## ralph loop protocol

1. work strictly top-to-bottom on unchecked criteria.
2. never skip cross-runtime parity.
3. when blocked on same issue 3 times: output `<ralph>GUTTER</ralph>`
4. when criteria 1-22 are all `[x]`: output `<ralph>COMPLETE</ralph>`
