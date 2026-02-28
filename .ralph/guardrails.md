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

