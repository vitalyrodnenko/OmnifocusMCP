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

1. [x] verify OmniFocus Omni Automation supports per-object deletion for each target:
      - projects
      - tags
      - folders
      and document any object-specific constraints.
      verification notes:
      - all three runtimes already perform deletes through OmniJS `deleteObject(...)`
      - project deletion removes the project and its contained tasks (`taskCount` is reported)
      - tag deletion removes the tag assignment from linked tasks (`taskCount` is reported)
      - folder deletion removes the folder; OmniFocus may move contained projects to top level (`projectCount`/`subfolderCount` are reported)

2. [x] confirm existing single-delete tools and response contracts in all runtimes:
      - `delete_project`
      - `delete_tag`
      - `delete_folder`
      contract verification notes:
      - `delete_project` exists in `python`, `typescript`, and `rust`; all accept
        one identifier (`project_id_or_name`) and return `{ id, name, deleted, taskCount }`.
      - `delete_tag` exists in `python`, `typescript`, and `rust`; all accept one
        identifier (`tag_name_or_id`) and return `{ id, name, deleted, taskCount }`.
      - `delete_folder` exists in `python`, `typescript`, and `rust`; all accept
        one identifier (`folder_name_or_id`) and return
        `{ id, name, deleted, projectCount, subfolderCount }`.
      - all three tool families resolve by id or exact name, and emit not-found
        errors with the searched identifier when resolution fails.

3. [x] define batch scope:
      - add `delete_projects_batch`
      - add `delete_tags_batch`
      - add `delete_folders_batch`
      - keep existing `delete_tasks_batch` unchanged unless minor parity alignment is needed.
      scope notes:
      - confirmed this iteration adds exactly three new batch-delete tools:
        `delete_projects_batch`, `delete_tags_batch`, and `delete_folders_batch`.
      - existing `delete_tasks_batch` remains in place as the baseline contract for
        partial-success semantics and summary/result structure alignment.

---

## Phase 2 — shared batch API contract

### success criteria

4. [x] define identical tool input schemas in Python/TypeScript/Rust:
      - `project_ids_or_names: string[]` for projects
      - `tag_ids_or_names: string[]` for tags
      - `folder_ids_or_names: string[]` for folders
      each required and non-empty.
      schema notes:
      - each new batch tool accepts exactly one required array field with the
        names above and no fallback aliases.
      - each field maps directly to runtime-native array types:
        `list[str]` (python), `z.array(z.string())` (typescript),
        `Vec<String>` (rust).
      - runtime-level validation enforces non-empty arrays and trimmed non-empty
        string identifiers.

5. [x] define identical response shape for all new batch delete tools:
      - summary block (`requested`, `deleted`, `failed`)
      - `partial_success` boolean
      - per-item results array with:
        `id_or_name`, resolved `id` (if found), `name` (if available), `deleted`, `error`.
      response notes:
      - all three tools return one object with:
        `summary`, `partial_success`, and `results`.
      - `summary` is `{ requested, deleted, failed }`.
      - each `results` item uses the same keys:
        `{ id_or_name, id, name, deleted, error }`, with `id`/`name` nullable
        when resolution fails.

6. [x] define validation rules (shared across runtimes):
      - reject empty arrays
      - reject empty/whitespace identifiers
      - reject duplicate identifiers within a request
      - return actionable validation errors.
      validation notes:
      - empty request arrays fail fast with an error naming the required field.
      - each identifier is trimmed; blank values fail with per-tool field wording.
      - duplicates are detected on normalized (trimmed) identifiers and rejected
        before OmniJS execution.
      - error messages are actionable and include either the field name or the
        duplicate identifier value.

---

## Phase 3 — implementation parity (python/typescript/rust)

### success criteria

7. [x] implement `delete_projects_batch` in all three runtimes with one OmniJS call
      per invocation and per-item result reporting.
      implementation notes:
      - added `delete_projects_batch` in:
        - `python/src/omnifocus_mcp/tools/projects.py`
        - `typescript/src/tools/projects.ts`
        - `rust/src/tools/projects.rs` + `rust/src/server.rs`
      - each runtime validates non-empty array, trimmed non-empty identifiers, and
        duplicate identifiers before executing OmniJS.
      - each runtime performs one OmniJS call that resolves by id or exact name and
        returns `{ summary, partial_success, results }` with per-item
        `{ id_or_name, id, name, deleted, error }`.

8. [x] implement `delete_tags_batch` in all three runtimes with one OmniJS call
      per invocation and per-item result reporting.
      implementation notes:
      - removed duplicate `delete_tags_batch` implementations so each runtime now
        has one canonical tool path (python/typescript/rust).
      - validated shared behavior: one OmniJS call, per-item results with
        `{ id_or_name, id, name, deleted, error }`, and batch summary fields.

9. [x] implement `delete_folders_batch` in all three runtimes with one OmniJS call
      per invocation and per-item result reporting.
      implementation notes:
      - removed duplicate `delete_folders_batch` implementations so each runtime
        now has a single canonical tool path.
      - aligned batch-delete folder behavior with shared contract:
        one OmniJS call, per-item result keys, and summary/partial-success output.

10. [x] preserve non-throwing partial-success behavior:
       - missing objects become per-item failures
       - successful deletes continue
       - summary reflects mixed outcomes.
      implementation notes:
      - verified `delete_projects_batch`, `delete_tags_batch`, and
        `delete_folders_batch` across python/typescript/rust all resolve each
        requested identifier independently.
      - not-found entities are returned as per-item failures (`deleted: false`,
        `error: "not found"`) and do not abort the batch.
      - delete exceptions are caught per-item inside OmniJS; successful deletes
        continue and final summary/`partial_success` reflect mixed outcomes.

11. [x] keep destructive safety guidance in tool descriptions:
       - explicitly state these are destructive operations
       - require explicit user confirmation before use
       - point to non-destructive alternatives where relevant.
      implementation notes:
      - validated batch-delete descriptions/docstrings for projects, tags, and
        folders in python/typescript/rust all explicitly mark these operations
        as destructive.
      - all three runtimes instruct explicit user confirmation before execution.
      - each tool points to non-destructive alternatives (`update_*`, `move_*`,
        or `set_project_status`) where appropriate.

---

## Phase 4 — tests and quality gates

### success criteria

12. [x] add/extend tests in Python for each new batch delete tool:
       - happy path
       - partial success (mixed found/not-found)
       - validation errors (empty array, empty item, duplicates).
      implementation notes:
      - confirmed Python coverage in `python/tests/test_tools_write.py` for:
        `delete_projects_batch`, `delete_tags_batch`, and `delete_folders_batch`.
      - each tool has happy-path, partial-success, empty-array, empty-item, and
        duplicate-identifier validation tests.

13. [x] add/extend tests in TypeScript with the same cases and response-shape checks.
      implementation notes:
      - confirmed TypeScript coverage in `typescript/tests/tools-happy.test.ts` for:
        `delete_projects_batch`, `delete_tags_batch`, and `delete_folders_batch`.
      - each tool has summary/response-shape happy-path assertions, partial-success
        behavior checks, and validation error tests for empty arrays, empty trimmed
        identifiers, and duplicate identifiers.

14. [x] add/extend tests in Rust with the same cases and response-shape checks.
      implementation notes:
      - confirmed Rust tests in `rust/tests/tools_write_test.rs` cover
        `delete_projects_batch`, `delete_tags_batch`, and `delete_folders_batch`.
      - each tool includes happy-path, partial-success, and validation-error tests
        (empty array, empty item, duplicates).
      - assertions verify shared response keys and per-item batch result shape.

15. [x] verify tool registration parity:
       - tool names identical across runtimes
       - parameter names identical across runtimes
       - response keys identical across runtimes.
      parity notes:
      - tool names aligned across runtimes:
        `delete_projects_batch`, `delete_tags_batch`, `delete_folders_batch`.
      - parameter names aligned across runtimes:
        `project_ids_or_names`, `tag_ids_or_names`, `folder_ids_or_names`.
      - response keys aligned across runtimes:
        top-level `{ summary, partial_success, results }`,
        summary `{ requested, deleted, failed }`,
        per-item `{ id_or_name, id, name, deleted, error }`.

16. [x] run quality gates:
       - Python: `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v`
       - TypeScript: `cd typescript && npx tsc --noEmit && npm test`
       - Rust: `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test`
      quality gate notes:
      - Python gate passed after formatting updates in new batch-delete tool files.
      - TypeScript gate passed (`/opt/homebrew/bin/npx tsc --noEmit` and `/opt/homebrew/bin/npm test`).
      - Rust gate passed after `cargo fmt` normalization, then
        `cargo fmt --check`, `cargo clippy -- -D warnings`, and `cargo test`.

---

## Ralph instructions

1. work on the next incomplete criterion (marked `[ ]`)
2. check off completed criteria (change `[ ]` to `[x]`)
3. enforce strict parity across python/typescript/rust for names, inputs, and outputs
4. keep changes focused to batch deletion and required tests/docs
5. read existing files before modifying and avoid unrelated refactors
6. when all criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
7. if blocked repeatedly on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
