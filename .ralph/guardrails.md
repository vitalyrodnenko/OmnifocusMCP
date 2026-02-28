# Ralph Guardrails (Signs)

> Lessons learned from past failures. READ THESE BEFORE ACTING.

## Core Signs

### Sign: Read Before Writing
- **Trigger**: Before modifying any file
- **Instruction**: Always read the existing file first
- **Added after**: Core principle

### Sign: Test After Changes
- **Trigger**: After any code change
- **Instruction**: Run tests to verify nothing broke
- **Added after**: Core principle

### Sign: Commit Checkpoints
- **Trigger**: Before risky changes
- **Instruction**: Commit current working state first
- **Added after**: Core principle

---

## Learned Signs

(Signs added from observed failures will appear below)

### Sign: Probe OmniJS Bridge Early
- **Trigger**: Before running full Phase 1 smoke validation
- **Instruction**: Run a minimal `evaluateJavaScript` probe first; if it hangs, stop and resolve Automation/bridge issues before broader checks
- **Added after**: `uv run python scripts/smoke_test.py` timed out on every OmniJS call while OmniFocus itself was running

### Sign: Validate OmniFocus JXA Verb Casing
- **Trigger**: If OmniJS bridge errors with "Message not understood (-1708)"
- **Instruction**: Verify `evaluateJavascript` casing in external JXA before debugging inner OmniJS scripts
- **Added after**: Bridge probe failed because `evaluateJavaScript` was not recognized by this OmniFocus JXA dictionary

### Sign: Confirm Destructive OmniJS API Signatures
- **Trigger**: Before marking task deletion flow complete
- **Instruction**: Verify destructive API method signatures (`drop`, etc.) against real OmniFocus and pass required arguments explicitly
- **Added after**: `task.drop()` failed at runtime requiring non-null `allOccurrences` argument

### Sign: Avoid Symbol Imports in Bootstrap Registration
- **Trigger**: When tool modules import `mcp` from `server` and `server` imports those modules to register tools
- **Instruction**: Use module imports (`import package.module`) in `server.py`, not `from module import symbol`, to avoid circular import failures during direct tool-module imports
- **Added after**: smoke test direct import of `tools.folders` failed with partially initialized module error for `list_folders`

### Sign: Keep Bootstrap Imports Side-Effect Only
- **Trigger**: When modular server bootstrap imports tools/resources/prompts
- **Instruction**: Import modules for registration side effects instead of re-exporting tool symbols from `server.py` to avoid circular imports
- **Added after**: smoke test import path hit circular import (`partially initialized module`) between `server.py` and tool modules

### Sign: Declare Every JXA Filter Constant Inside Script
- **Trigger**: Before finalizing a tool that builds OmniJS filter expressions from escaped inputs
- **Instruction**: Ensure every interpolated filter variable (for example `statusFilter`) is declared in the embedded OmniJS string, then run the real integration test path that exercises that filter
- **Added after**: TypeScript integration failed in `list_tags` with `Can't find variable: statusFilter` because the script referenced a variable that was never declared inside OmniJS

### Sign: Recreate Corrupted Test Files From Scratch
- **Trigger**: When a new test file reports repeated inner-attribute parse errors at multiple line numbers
- **Instruction**: Delete the file and recreate a single canonical version before running fmt/clippy/tests, then verify only one `#![cfg(...)]` header remains
- **Added after**: `rust/tests/integration_test.rs` accumulated duplicated blocks and failed default `cargo test` with multiple `inner attribute is not permitted` errors

### Sign: Verify Single-Definition File Integrity After Large Rewrites
- **Trigger**: After replacing a large file with generated or merged content
- **Instruction**: Immediately validate symbol uniqueness (for example with `rg` counts for core types/functions) before running broader test commands
- **Added after**: Rust smoke test failed to compile because `examples/smoke_test.rs` contained duplicated type/function blocks

### Sign: Confirm Existing Tool Symbol Before Adding New Function
- **Trigger**: Before implementing a tool criterion in a file that has active in-progress changes
- **Instruction**: Run `rg` for the target function name in the destination file first; if already present, extend or fix it instead of appending a second definition
- **Added after**: Rust `cargo clippy` failed with `E0428` because `create_subtask` was accidentally defined twice in `src/tools/tasks.rs`

### Sign: Check Existing Symbol Before Adding Tool Function
- **Trigger**: Before adding a new tool function in an already-evolving module
- **Instruction**: Run `rg` for the target function name first to avoid duplicate definitions, then patch the existing implementation or wiring gaps instead of adding a second copy
- **Added after**: Python lint failed with `F811` because `uncomplete_task` was accidentally added twice in `tools/tasks.py`

### Sign: Align Mock-Handler Tests With Runtime Validation Paths
- **Trigger**: When testing tool handlers through mocked server registration without schema execution
- **Instruction**: Add explicit runtime validation in handlers for constrained fields that tests can pass as raw values, and assert against the handler error message rather than schema-only errors
- **Added after**: TypeScript `set_project_status` happy/invalid tests failed because mock tool invocation bypassed zod schema enforcement

### Sign: Check Active Rust Module Path Before Editing Tool Files
- **Trigger**: Before modifying Rust `tools` modules when compile errors mention duplicate definitions or missing modules
- **Instruction**: Verify `rust/src/tools/mod.rs` uses `#[path = ...]` indirection and edit the active file (`tags_clean.rs` in this repo) instead of an unused mirror path
- **Added after**: `cargo clippy` failed with repeated `E0428` duplicate symbol errors from `tags.rs` while the active module was redirected via `#[path = "tags_clean.rs"]`

### Sign: Scan For Duplicate Registrations Before Full Gates
- **Trigger**: Before running full cross-implementation lint/typecheck/tests for a criterion
- **Instruction**: Run `rg` for the target tool symbol in Python/TypeScript/Rust sources and tests, then remove duplicate definitions/registrations before validation
- **Added after**: full gate failed due repeated `set_project_status` definitions in Python and inconsistent duplicate handler variants in TypeScript

### Sign: Scan Adjacent Folder Tool Symbols Before Running Full Gate
- **Trigger**: Before running the global `test_command` after finishing one folder criterion
- **Instruction**: Run `rg` for both current and next folder tool symbols (`update_folder`, `delete_folder`) in Python/TypeScript/Rust tool modules to catch duplicate in-progress definitions before lint
- **Added after**: full gate failed at Python lint with `F811` because `delete_folder` was defined twice while `update_folder` criterion work was being validated

### Sign: Treat OmniJS Smoke Timeouts as Environment Blockers
- **Trigger**: During Phase 5 smoke run when bridge, read, and write checks all time out at 30s
- **Instruction**: Treat repeated timeout failures as OmniFocus automation availability issues (app not ready, permissions, or bridge stall), stop further criterion work, and emit `<ralph>GUTTER</ralph>`
- **Added after**: `cargo run --example smoke_test` failed every phase with `JXA command timed out after 30s` on iteration 12

### Sign: Keep `noqa` On The First Deferred Import Line
- **Trigger**: After adding a new symbol to deferred imports in `server.py` that sit below runtime code
- **Instruction**: Keep `# noqa: E402,F401` on the opening `from ... import (` line (not only the closing parenthesis line) so ruff suppresses deferred-import and re-export warnings for each imported symbol
- **Added after**: full `test_command` failed on `server.py` with `E402` and per-symbol `F401` after formatter expanded the tags import block

### Sign: Never Read Full Tool Source Files for Parity Checks
- **Trigger**: When verifying tool parity (criterion 26) or comparing implementations across Python/TypeScript/Rust
- **Instruction**: Tool source files are 500-1000 lines / 50-100KB each. Reading even 2-3 will blow the 80k token context budget and trigger rotation. Use `rg` (ripgrep) to extract specific tool names, parameter names, JXA script snippets, and response shapes. Diff the grep outputs instead of reading full files.
- **Added after**: Sessions 1-7 post-truncation all rotated because agent read projects.py + projects.ts + projects.rs (~177KB total) for parity checking

### Sign: Monitor Context Budget Before Large Reads
- **Trigger**: Before reading any file larger than 200 lines
- **Instruction**: Check the token breakdown in activity.log or estimate: each 1KB of file content ≈ 250 tokens. With ~15k tokens used by state files, you have ~65k tokens left. A 500-line source file is ~50KB ≈ 12,500 tokens. Plan reads accordingly — never read more than ~250KB of source in one session.
- **Added after**: Repeated rotation loops caused by reading multiple large files without considering cumulative token cost

### Sign: Snapshot Task References Before Batch Deletion
- **Trigger**: When deleting multiple tasks by id in one OmniJS script
- **Instruction**: Build a task-id map before any delete calls and resolve ids from that snapshot; deleting while repeatedly scanning `document.flattenedTasks` can invalidate task objects mid-loop
- **Added after**: smoke test failed with `Task is no longer valid` after switching to `deleteObject(task)` in `delete_tasks_batch`

### Sign: Re-read Full File When Parser Errors Contradict Partial Reads
- **Trigger**: When compiler/rustfmt reports delimiter or duplicate-type errors but chunked reads look clean
- **Instruction**: Read the full file once to catch duplicated blocks/stray braces introduced by partial edits, then repair the canonical single-definition structure before rerunning gates
- **Added after**: `rust/tests/tools_read_test.rs` had duplicated `CapturingRunner`/brace fragments causing alternating `unexpected closing delimiter` and `unclosed delimiter` failures during criterion 6 validation

### Sign: Deduplicate Tool Symbols Before Cross-Implementation Gates
- **Trigger**: When mypy/tsc/rustc reports function redefinition for tool helpers during full gate runs
- **Instruction**: Run `rg` for the symbol in Python/TypeScript/Rust tool modules and keep exactly one canonical exported implementation name per module before rerunning tests
- **Added after**: full gate for criterion 14 failed on duplicated `get_task_counts`/`getTaskCountsData` definitions across all 3 implementations

### Sign: Patch Signature Changes With Function-Scoped Context
- **Trigger**: When adding/removing parameters in `tasks.rs` and multiple functions share similar argument blocks
- **Instruction**: Use `@@ pub async fn <name>` scoped patches and immediately verify with `rg` that the target signature changed exactly once; shared context patches can silently modify a different function and cause cascading arg-count compile errors
- **Added after**: criterion 26 rust parity fix accidentally inserted planned params into `get_task_counts` instead of `list_tasks_with_planned`, producing repeated `E0061`/`E0425` failures

