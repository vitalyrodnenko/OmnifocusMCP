---
task: OmniFocus MCP — Add batch deletion tool across all implementations
test_command: "cd python && ruff check src/ && mypy src/ --strict && pytest tests/ -v && cd ../typescript && npx tsc --noEmit && npm test && cd ../rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test"
---

# Task: Add `delete_tasks_batch` Tool

The current `delete_task` tool only accepts a single task ID. When an LLM
needs to delete many tasks, it must call `delete_task` N times — each
spawning a separate `osascript` process with ~0.5-1s overhead. This is
painfully slow for bulk operations.

Add a `delete_tasks_batch` tool that accepts an array of task IDs and
deletes them all in a **single** JXA/OmniJS invocation. Follow the
exact same pattern as `create_tasks_batch`.

**All three implementations** (Python, TypeScript, Rust) must be updated.
Tool name, input schema, and response shape must be **identical** across
all three.

**CRITICAL — User Approval:** This tool performs destructive bulk
operations. The tool description MUST instruct the LLM to always ask
the user for explicit confirmation before executing the deletion,
listing the tasks that will be deleted. This is a UX safety rail, not
a technical enforcement — the tool itself executes immediately when
called, but the description tells the LLM to confirm first.

Reference:
- `create_tasks_batch` in each implementation for the batch pattern
- `delete_task` in each implementation for the deletion JXA logic
- `.cursor/rules/jxa-scripting.mdc` for scripting rules

---

## Phase 1 — Python Implementation

### Success Criteria

1. [x] Read `python/src/omnifocus_mcp/tools/tasks.py` to understand the
       existing `delete_task` and `create_tasks_batch` implementations.
2. [x] Add `delete_tasks_batch` tool to `python/src/omnifocus_mcp/tools/tasks.py`:
       - **Input:** `task_ids: list[str]` — array of task IDs to delete.
         Minimum 1 element. Each ID must be non-empty.
       - **Tool description** must include: "IMPORTANT: before calling
         this tool, always show the user the list of tasks to be deleted
         and ask for explicit confirmation. do not proceed without user
         approval."
       - **JXA script:** single OmniJS invocation that:
         1. Iterates over the task ID array
         2. For each ID, finds the task via `document.flattenedTasks.find()`
         3. Records `{ id, name, deleted: true }` for found tasks,
            `{ id, deleted: false, error: "not found" }` for missing ones
         4. Calls `task.drop(false)` on found tasks
         5. Returns the full results array plus a summary
            `{ deleted_count, not_found_count, results }`
       - **Validation:** `task_ids` must not be empty. Each element
         must be a non-empty string after trimming.
       - **Escape** each task ID via `escape_for_jxa` / `json.dumps`
         (pass the whole array as a JSON-serialized string, same pattern
         as `create_tasks_batch` passes its task array).
3. [x] Add tests in `python/tests/test_tools_write.py`:
       - Happy path: mock JXA returns successful batch deletion
       - Partial failure: some IDs not found
       - Validation error: empty array
       - Validation error: array contains empty string
4. [x] `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v` all pass.

---

## Phase 2 — TypeScript Implementation

### Success Criteria

5. [x] Read `typescript/src/tools/tasks.ts` to understand the existing
       `delete_task` and `create_tasks_batch` implementations.
6. [x] Add `delete_tasks_batch` tool to `typescript/src/tools/tasks.ts`:
       - **Tool name:** `delete_tasks_batch` (must match Python exactly)
       - **Input schema:** `{ task_ids: z.array(z.string().min(1)).min(1) }`
       - **Tool description:** identical approval language as Python
       - **JXA script:** character-identical to the Python version
       - **Response shape:** identical to Python
7. [x] Add tests in `typescript/tests/tools-tasks.test.ts` (or
       equivalent test file) matching the Python test cases.
8. [x] `cd typescript && npx tsc --noEmit && npm run lint && npm test` all pass.

---

## Phase 3 — Rust Implementation

### Success Criteria

9. [ ] Read `rust/src/tools/tasks.rs` to understand the existing
        `delete_task` and `create_tasks_batch` implementations.
10. [ ] Add `delete_tasks_batch` function to `rust/src/tools/tasks.rs`:
        - Function signature: `pub async fn delete_tasks_batch<R: JxaRunner>(runner: &R, task_ids: Vec<String>) -> Result<Value>`
        - **Validation:** same rules as Python (non-empty vec, non-empty strings)
        - **JXA script:** character-identical to Python/TypeScript
        - **Escape:** serialize `task_ids` via `serde_json::to_string()`
11. [ ] Register the tool in `rust/src/server.rs`:
        - Add `#[tool(description = "...")]` method with the approval
          language in the description
        - Input params struct with `task_ids: Vec<String>`
12. [ ] Add tests in `rust/tests/tools_write_test.rs`:
        - Happy path, partial failure, validation errors
13. [ ] `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test` all pass.

---

## Phase 4 — Integration & Smoke Test

### Success Criteria

14. [ ] Add `delete_tasks_batch` to the Rust smoke test
        (`rust/examples/smoke_test.rs`): create 3 test tasks, batch
        delete them, verify all deleted.
15. [ ] Run the smoke test against real OmniFocus — zero failures.
        Fix any bugs discovered.
16. [ ] Verify all three implementations produce identical tool names
        and matching response shapes. Manually compare a sample call
        or add a note confirming parity.

---

## Phase 5 — Documentation

### Success Criteria

17. [ ] Update `README.md` tool count and tool list table to include
        `delete_tasks_batch`.
18. [ ] Update `rust/README.md` if it has a separate tool listing.

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. Run the phase-appropriate test command after every code change
4. **JXA scripts must be character-identical** across all three
   implementations. Write it once in Python, then copy to TS and Rust.
5. **The tool description MUST include the user-approval instruction.**
   This is a hard requirement — do not skip it.
6. **Phases 4 requires real OmniFocus** — if not running or permission
   is denied, output: `<ralph>GUTTER</ralph>`
7. Commit changes after completing each phase
8. When ALL criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
9. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
