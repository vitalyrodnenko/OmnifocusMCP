---
task: OmniFocus MCP — batch deletion for all deletable entities
test_command: "cd python && pytest tests/ -k \"delete_project or delete_tag or delete_folder or delete_tasks_batch\" -v && cd ../typescript && npm test -- tools-happy.test.ts && cd ../rust && cargo test tools_write_test"
---

# Task: add batch delete support for projects, tags, and folders

Current mass cleanups run one-by-one for projects/tags/folders. We already have
`delete_tasks_batch` for tasks, so this task extends batch deletion to other
deletable entities with parity across Python, TypeScript, and Rust.

Goal:
- minimize token/tool overhead for large cleanups
- keep destructive-operation safety and explicit confirmations
- maintain strict cross-runtime parity of tool names, params, and result shape

---

## Phase 1 — feasibility and scope

### success criteria

1. [ ] verify OmniFocus Omni Automation supports per-object deletion for each target:
      - projects
      - tags
      - folders
      and document any object-specific constraints.

2. [ ] confirm existing single-delete tools and response contracts in all runtimes:
      - `delete_project`
      - `delete_tag`
      - `delete_folder`

3. [ ] define batch scope:
      - add `delete_projects_batch`
      - add `delete_tags_batch`
      - add `delete_folders_batch`
      - keep existing `delete_tasks_batch` unchanged unless minor parity alignment is needed.

---

## Phase 2 — shared batch API contract

### success criteria

4. [ ] define identical tool input schemas in Python/TypeScript/Rust:
      - `project_ids_or_names: string[]` for projects
      - `tag_ids_or_names: string[]` for tags
      - `folder_ids_or_names: string[]` for folders
      each required and non-empty.

5. [ ] define identical response shape for all new batch delete tools:
      - summary block (`requested`, `deleted`, `failed`)
      - `partial_success` boolean
      - per-item results array with:
        `id_or_name`, resolved `id` (if found), `name` (if available), `deleted`, `error`.

6. [ ] define validation rules (shared across runtimes):
      - reject empty arrays
      - reject empty/whitespace identifiers
      - reject duplicate identifiers within a request
      - return actionable validation errors.

---

## Phase 3 — implementation parity (python/typescript/rust)

### success criteria

7. [ ] implement `delete_projects_batch` in all three runtimes with one OmniJS call
      per invocation and per-item result reporting.

8. [ ] implement `delete_tags_batch` in all three runtimes with one OmniJS call
      per invocation and per-item result reporting.

9. [ ] implement `delete_folders_batch` in all three runtimes with one OmniJS call
      per invocation and per-item result reporting.

10. [ ] preserve non-throwing partial-success behavior:
       - missing objects become per-item failures
       - successful deletes continue
       - summary reflects mixed outcomes.

11. [ ] keep destructive safety guidance in tool descriptions:
       - explicitly state these are destructive operations
       - require explicit user confirmation before use
       - point to non-destructive alternatives where relevant.

---

## Phase 4 — tests and quality gates

### success criteria

12. [ ] add/extend tests in Python for each new batch delete tool:
       - happy path
       - partial success (mixed found/not-found)
       - validation errors (empty array, empty item, duplicates).

13. [ ] add/extend tests in TypeScript with the same cases and response-shape checks.

14. [ ] add/extend tests in Rust with the same cases and response-shape checks.

15. [ ] verify tool registration parity:
       - tool names identical across runtimes
       - parameter names identical across runtimes
       - response keys identical across runtimes.

16. [ ] run quality gates:
       - Python: `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v`
       - TypeScript: `cd typescript && npx tsc --noEmit && npm test`
       - Rust: `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test`

---

## Ralph instructions

1. work on the next incomplete criterion (marked `[ ]`)
2. check off completed criteria (change `[ ]` to `[x]`)
3. enforce strict parity across python/typescript/rust for names, inputs, and outputs
4. keep changes focused to batch deletion and required tests/docs
5. read existing files before modifying and avoid unrelated refactors
6. when all criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
7. if blocked repeatedly on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
