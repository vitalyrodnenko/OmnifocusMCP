---
task: OmniFocus MCP — Open source preparation and distribution readiness
test_command: "cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v && cd ../typescript && npx tsc --noEmit && npm test && cd ../rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test"
---

# Task: Open Source Preparation + Safe Task Reparenting

Prepare the OmniFocus MCP project for public open-source distribution at
`github.com/vitalyrodnenko/OmnifocusMCP`, and add safe task reparenting
capabilities so assistants can reorganize tasks without delete/recreate
workarounds.

**License:** MIT
**GitHub org:** `vitalyrodnenko`

**CRITICAL (phases 1-8):** Do NOT modify any tool implementation files in
`python/src/`, `typescript/src/`, or `rust/src/`. Do NOT modify test
files.

**CRITICAL (phase 9):** tool implementation and test file changes are
required across Python/TypeScript/Rust with strict parity.

---

## Phase 1 — License and Legal

### Success Criteria

1. [x] Create `LICENSE` file at the repository root with the MIT license.
       Copyright line: `Copyright (c) 2025-2026 Vitaly Rodnenko`.

2. [x] Add a disclaimer block near the top of `README.md` (after the
       title/description, before any other section):
       "This project is not affiliated with, endorsed by, or associated
       with The Omni Group or OmniFocus. OmniFocus is a trademark of
       The Omni Group. This is an independent, non-commercial
       open-source project."

3. [x] Update license metadata in all package manifests to `MIT`:
       - `python/pyproject.toml` — add `license = "MIT"` under
         `[project]` if missing.
       - `typescript/package.json` — add `"license": "MIT"` if missing
         or incorrect.
       - `rust/Cargo.toml` — add `license = "MIT"` under `[package]`
         if missing.

4. [x] Delete the top-level `package.json`. It is a junk placeholder
       (name: "OmnifocusMCP", no real purpose). The real package.json
       lives in `typescript/`. Verify nothing depends on the root one
       before deleting.

---

## Phase 2 — Gitignore Cleanup

### Success Criteria

5. [x] Add the following entries to `.gitignore`:
       ```
       # internal automation state
       .ralph/

       # IDE-specific config
       .cursor/
       ```

6. [x] Remove tracked `.ralph/` and `.cursor/` files from the git
       index WITHOUT deleting them from disk:
       ```
       git rm -r --cached .ralph/ .cursor/
       ```
       Then commit with message: "remove internal automation and IDE
       files from tracking".

       **IMPORTANT:** `RALPH_TASK.md` and `RALPH_TASK_NEXT.md` are at
       the repo root, NOT inside `.ralph/`. They are unaffected.

---

## Phase 3 — Fix All Placeholder URLs

### Success Criteria

7. [x] Replace every occurrence of `<your-org>`, `<user>`, and bare
       `user/` (in GitHub URLs) with `vitalyrodnenko` across:
       - `README.md`
       - `docs/install-python.md`
       - `docs/install-typescript.md`
       - `docs/install-rust.md`
       - `rust/README.md`
       - `homebrew/omnifocus-mcp.rb`
       - `.github/workflows/release-rust.yml`

       Use `grep -r '<your-org>\|<user>\|user/' --include='*.md'
       --include='*.rb' --include='*.yml'` to find all instances.
       Verify no placeholders remain after changes.

---

## Phase 4 — README Overhaul

### Success Criteria

8. [x] Rewrite `README.md` to be a polished open-source project page.
       Study https://github.com/umputun/ralphex for tone and structure
       reference. The README must include these sections in order:

       **Title and tagline:**
       `# OmniFocus MCP`
       One-sentence description: MCP server that gives AI assistants
       full control over OmniFocus on macOS.

       **Disclaimer:** (from criterion 2)

       **Why section:** 2-3 sentences explaining the problem (AI
       assistants can't interact with OmniFocus natively) and the
       solution (MCP bridge via JXA/Omni Automation).

       **Features:** clean bullet list grouped by category:
       - Task management (create, read, update, complete, delete, batch, subtasks, repetition)
       - Project management (create, read, update, complete, status, delete, move)
       - Tags and folders (CRUD)
       - Utility (search, forecast, perspectives, append to note)
       - Resources (inbox, today, projects snapshots)
       - Prompts (daily review, weekly review, inbox processing, project planning)

       **Quick Start:** show the fastest path — Homebrew install of
       Rust binary + Claude Desktop config snippet (5 lines).

       **Implementations table:** keep existing table but clean it up.

       **How It Works:** brief explanation of the
       JXA → evaluateJavaScript → Omni Automation bridge. 3-4
       sentences max.

       **MCP Client Configuration:** keep existing Claude Desktop,
       Cursor examples for all 3 implementations.

       **Prerequisites:** macOS, OmniFocus, Automation permission.

       **Contributing:** brief paragraph + link to CONTRIBUTING.md.

       **License:** MIT + disclaimer repeated.

       Keep the tone professional, concise, non-commercial.
       Do NOT use emojis.

---

## Phase 5 — Contributing Guide

### Success Criteria

9. [x] Create `CONTRIBUTING.md` at the repository root with:

       **Development setup:** how to clone and set up all 3
       implementations (Python with uv, TypeScript with npm, Rust
       with cargo). Reference existing docs/ install guides.

       **Running tests:**
       - Python: `cd python && ruff check src/ && mypy src/ --strict && pytest tests/ -v`
       - TypeScript: `cd typescript && npx tsc --noEmit && npm test`
       - Rust: `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test`
       - Integration tests require OmniFocus running.

       **Key rules:**
       - All 3 implementations must expose identical tool names, input
         schemas, and response shapes.
       - JXA scripts must be character-identical across implementations.
       - Write the JXA script in Python first, then copy to TS and Rust.
       - All user input must be escaped via the escape function.
       - Never use shell=True (Python) or exec (Node) for osascript.

       **PR guidelines:** small diffs, one concern per PR, tests must
       pass, lint must pass.

       Keep it concise — under 100 lines.

---

## Phase 6 — Sub-README Consistency

### Success Criteria

10. [x] Fix `python/README.md`:
        - Change Python version requirement from "3.10+" to "3.11+"
          (matches `docs/install-python.md` and `pyproject.toml`).
        - Remove the "Phase 6" reference in the development checks
          section.
        - Fix placeholder URLs if any.

11. [x] Fix `typescript/README.md`:
        - Change Node.js version from "18+" to "20+" (matches
          `docs/install-typescript.md`).
        - Fix placeholder URLs if any.

12. [x] Fix `rust/README.md`:
        - Replace `<user>` in Homebrew tap command with
          `vitalyrodnenko`.

13. [x] Fix `docs/install-rust.md`:
        - Replace all `user/` in homebrew and git clone URLs with
          `vitalyrodnenko`.

---

## Phase 7 — CI Workflow

### Success Criteria

14. [x] Create `.github/workflows/ci.yml` that runs on push and
        pull_request. Jobs:

        **python-checks** (runs-on: `macos-latest`):
        - Checkout
        - Install Python 3.11+
        - Install uv
        - `cd python && uv sync --extra dev`
        - `uv run ruff check src/`
        - `uv run ruff format --check src/`
        - `uv run mypy src/ --strict`
        - `uv run pytest tests/ -v`

        **typescript-checks** (runs-on: `macos-latest`):
        - Checkout
        - Setup Node.js 20
        - `cd typescript && npm install`
        - `npx tsc --noEmit`
        - `npm test`

        **rust-checks** (runs-on: `macos-latest`):
        - Checkout
        - Install Rust toolchain
        - `cd rust && cargo fmt --check`
        - `cargo clippy -- -D warnings`
        - `cargo test`

        Use `macos-latest` for all jobs since the project is macOS-only
        (osascript). Integration tests are NOT run in CI (they need
        OmniFocus). Only mocked unit tests run.

15. [x] Verify the CI workflow YAML is valid by checking syntax.

---

## Phase 8 — Final Verification

### Success Criteria

16. [x] Run `grep -r '<your-org>\|<user>' --include='*.md'
        --include='*.rb' --include='*.yml' --include='*.toml'
        --include='*.json'` and confirm zero results.

17. [x] Verify all lint/test commands still pass (no files were
        accidentally broken):
        - `cd python && ruff check src/ && mypy src/ --strict && pytest tests/ -v`
        - `cd typescript && npx tsc --noEmit && npm test`
        - `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test`

18. [x] Commit all changes. Suggested commit message:
        "prepare project for open-source distribution"

19. [x] Delete this file (`RALPH_TASK_NEXT.md`) after all criteria
        are complete — it was a temporary task file.

---

## Phase 9 — Safe Task Reparenting (No Delete/Recreate)

### Success Criteria

20. [x] Extend `move_task` in all 3 implementations to support moving an
        existing task under another existing task (task -> subtask) while
        preserving the original task object and id.
        - Add optional `parent_task_id` parameter.
        - Keep existing `project` behavior (move to project or inbox).
        - Preserve backwards compatibility for current clients.

21. [x] Add destination validation in all 3 implementations:
        - reject requests where both `project` and `parent_task_id` are
          provided (ambiguous destination).
        - reject empty/whitespace ids.
        - return actionable validation errors.

22. [ ] Implement move-to-parent logic in JXA/OmniJS for all 3
        implementations:
        - locate task by `task_id`
        - locate parent task by `parent_task_id`
        - prevent self-parenting
        - prevent cycles (cannot move task under its own descendant)
        - move task using OmniFocus move API (no delete/recreate)

23. [ ] Support moving a subtask back out to non-subtask destinations:
        - to another project via `project`
        - to inbox when destination omitted
        Ensure this keeps object identity and does not clone/recreate.

24. [ ] Update tool descriptions/docs in all 3 implementations for
        `move_task`:
        - clearly document the 3 destination modes:
          (a) `project`, (b) `parent_task_id`, (c) inbox default
        - explicitly state preserve-by-default behavior
        - explicitly state delete is never required for reorganization

25. [ ] Add/extend tests in all 3 implementations covering:
        - move task to project (existing behavior)
        - move task to inbox (existing behavior)
        - move task under parent task (new behavior)
        - invalid both-destination input
        - self-parenting rejection
        - cycle rejection
        - parity of parameter names/response shape across all 3

26. [ ] Update user-facing docs:
        - `README.md` features section mentions task reparenting support
        - include one short usage example for `move_task` with
          `parent_task_id`
        - clarify that destructive delete confirmation is separate from
          non-destructive move/update workflows

27. [ ] Run full quality gates before marking phase complete:
        - `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v`
        - `cd typescript && npx tsc --noEmit && npm test`
        - `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test`
        - Ensure no regressions in existing move/update/delete tests.

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. For phases 1-8, follow docs/config-only constraints.
4. For phase 9, modify code + tests in all 3 implementations with strict
   parity (same tool names, params, response shapes).
5. Read existing files before modifying — understand context first.
6. Commit changes after completing each phase.
7. When ALL criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
8. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
