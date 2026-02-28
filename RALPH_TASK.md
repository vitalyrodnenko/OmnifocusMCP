---
task: OmniFocus MCP — Rust implementation with Homebrew distribution
test_command: "cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test"
---

# Task: OmniFocus MCP Rust — Native Binary + Homebrew

Port the OmniFocus MCP server to Rust, producing a single native binary
that can be distributed via Homebrew. The Python and TypeScript
implementations already exist and are fully validated — this is a
**port, not a rewrite**. JXA scripts must be character-identical to the
existing implementations.

Reference implementations:
- Python tools: `python/src/omnifocus_mcp/tools/*.py`
- Python resources: `python/src/omnifocus_mcp/resources.py`
- Python prompts: `python/src/omnifocus_mcp/prompts.py`
- TypeScript tools: `typescript/src/tools/*.ts`
- JXA bridge: `python/src/omnifocus_mcp/jxa.py`
- Cursor rules: `.cursor/rules/jxa-scripting.mdc` (MUST follow)

**Prerequisite:** Rust toolchain must be installed (`rustc`, `cargo`).
If not available, install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.
OmniFocus must be running for smoke/integration tests.

**SDK:** The official Rust MCP SDK is `rmcp` v0.17+ on crates.io
(https://github.com/modelcontextprotocol/rust-sdk). It uses:
- `#[tool_router]` on impl block + `#[tool(description = "...")]` on methods
- `#[tool_handler] impl ServerHandler` for the trait + capabilities
- `ServerCapabilities::builder().enable_tools().enable_resources().enable_prompts().build()`
- `.serve(stdio()).await` + `service.waiting().await` for stdio transport
- `Parameters<T>` wrapper for structured tool inputs
- `CallToolResult::success(vec![Content::text(...)])` for tool returns

---

## Phase 1 — Scaffold & JXA Bridge

Set up the Rust project and implement the core JXA execution layer.
This is the foundation everything else builds on.

### Success Criteria

1. [x] Research the `rmcp` crate (official Rust MCP SDK at
       https://github.com/modelcontextprotocol/rust-sdk). Use the
       `context7` MCP tool to fetch up-to-date documentation. Determine:
       - How to register tools (derive macro, trait impl, or builder)
       - How to register resources and prompts
       - How to wire stdio transport
       - How to define tool parameter schemas
       Document findings as a comment block at the top of `rust/Cargo.toml`.
2. [x] Create `.cursor/rules/rust-conventions.mdc` with:
       - Tooling: `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test`
       - Edition 2021, MSRV matching `rmcp`'s requirement (check Cargo.toml)
       - Error handling: `thiserror` for error enums, `?` operator,
         **no `unwrap()` or `expect()` in production code**
       - Async: `tokio` runtime, use native async traits (Rust 1.75+)
         unless rmcp requires `async-trait`
       - Testing: `#[tokio::test]`, trait-based mocking (no external
         mocking crate), `#[cfg(feature = "integration")]` for integration
       - Code organization: `lib.rs` re-exports all modules, `main.rs`
         is the binary entry point, `tools/` directory one file per entity
       - JXA: same rules as `jxa-scripting.mdc` — escape via
         `serde_json::to_string()`, raw string literals for script
         templates
       - Binary crate: commit `Cargo.lock` to version control
3. [x] Create `rust/Cargo.toml` with:
       - `[package]` name = `"omnifocus-mcp"`, version matching project
       - Dependencies: `rmcp` (with `transport-io` feature or equivalent),
         `tokio` (full features), `serde` + `serde_json`, `schemars`,
         `thiserror`, `clap` (derive feature, for `--version`)
       - Dev dependencies: `tokio` test utils
       - `[features] integration = []`
       - Adjust dependency list based on SDK research from criterion 1
4. [x] Create `rust/src/error.rs`:
       ```rust
       #[derive(thiserror::Error, Debug)]
       pub enum OmniFocusError {
           JxaExecution(String),
           OmniFocus(String),
           JsonParse(serde_json::Error),
           Validation(String),
           Io(std::io::Error),
           Timeout { seconds: f64 },
       }
       ```
       Include `Display` messages matching the Python error strings.
5. [x] Create `rust/src/types.rs` with result structs:
       - `TaskResult` (id, name, note, flagged, completed, project,
         due_date, defer_date, completion_date, tags, estimated_minutes,
         in_inbox, has_children, sequential)
       - `ProjectResult` (id, name, status, note, folder, due_date,
         defer_date, completion_date, sequential, number_available,
         number_remaining, flagged)
       - `TagResult` (id, name, active, available_task_count)
       - `FolderResult` (id, name)
       - `ForecastDay` (date, task_count, tasks)
       - `PerspectiveResult` (id, name)
       All structs derive `Serialize`, `Deserialize`, `Debug`, `Clone`.
       Use `Option<T>` for nullable fields. Use `Vec<String>` for tags.
6. [x] Create `rust/src/jxa.rs` with three layers matching Python's jxa.py:
       - `run_jxa(script) -> Result<String>` — low-level osascript call.
         Uses `tokio::sync::Mutex<()>` for serialized execution,
         `tokio::process::Command` calling `osascript -l JavaScript -e`,
         timeout (default 30s) via `tokio::time::timeout`,
         `friendly_jxa_error()` for stderr → human message.
       - `run_jxa_json(script) -> Result<Value>` — calls `run_jxa`,
         parses stdout as JSON, errors on empty or malformed output.
       - `run_omnijs(script) -> Result<Value>` — wraps the OmniJS
         script in the IIFE + try/catch + JSON envelope, adds the
         `document.flattened*` compatibility shim, calls `run_jxa_json`
         on the outer JXA template, unwraps the `{ok, data, error}`
         envelope. **Copy the exact wrapper string from jxa.py lines
         112–148.**
       - `pub trait JxaRunner: Send + Sync` with
         `async fn run_omnijs(&self, script: &str) -> Result<Value>`
       - `pub struct RealJxaRunner` implementing the trait (delegates
         to the `run_omnijs` function above)
       - `pub fn escape_for_jxa(value: &str) -> String` using
         `serde_json::to_string(value)`
       - `friendly_omnijs_error()` with identical logic to jxa.py
       - The outer JXA template: `const app = Application('OmniFocus');
         const result = app.evaluateJavascript({escaped}); result;`
         — note the lowercase 's' in `evaluateJavascript`
7. [x] Create `rust/src/lib.rs` that re-exports all modules: `error`,
       `types`, `jxa`, `tools`, `resources`, `prompts`, `server`.
       This allows tests to `use omnifocus_mcp::*` cleanly.
8. [x] `cargo build` succeeds with no errors.
9. [x] Create `rust/tests/jxa_test.rs` with unit tests:
       - `escape_for_jxa` handles quotes, backslashes, newlines, unicode,
         null characters
       - `OmniFocusError` display messages match expected strings
       - Mock `JxaRunner` returns canned data, verify parsing
       - Envelope unwrapping: `{ok: true, data: ...}` returns data,
         `{ok: false, error: "..."}` returns friendly error
10. [x] JXA bridge probe against real OmniFocus:
        `RealJxaRunner::new().run_omnijs("return document.flattenedTasks.length;")`
        returns a number. Create `rust/examples/probe.rs` for this.
11. [x] `cargo test && cargo clippy -- -D warnings && cargo fmt --check`
        all pass.

---

## Phase 2 — Tool Implementation

Port all 19 tools. JXA script strings must be **character-identical** to
the Python implementation. Copy them from `python/src/omnifocus_mcp/tools/*.py`.

Use the trait-based approach: tool functions accept `&dyn JxaRunner`
(or be generic over `R: JxaRunner`), build the JXA script, call
`runner.run_omnijs(script)`, parse the response into typed structs.

### Success Criteria

12. [x] Create `rust/src/tools/mod.rs` re-exporting all tool modules.
13. [x] Create `rust/src/tools/tasks.rs` with read tools — **signatures
        must match Python exactly** (read `python/src/omnifocus_mcp/tools/tasks.py`):
        - `get_inbox(limit: i32 = 100)`
        - `list_tasks(project?: String, tag?: String, flagged?: bool,
          status: String = "available", limit: i32 = 100)`
        - `get_task(task_id: String)`
        - `search_tasks(query: String, limit: i32 = 100)` — NO status param
        JXA scripts copied from the Python file.
        Input validation: limit > 0, non-empty task_id, non-empty query.
14. [x] Add write tools to `rust/src/tools/tasks.rs`:
        - `create_task(name, project?, note?, due_date?, defer_date?,
          flagged?, tags?: Vec<String>, estimated_minutes?: i32)`
        - `create_tasks_batch(tasks: Vec<CreateTaskInput>)`
        - `complete_task(task_id)`
        - `update_task(task_id, name?, note?, due_date?, defer_date?,
          flagged?, tags?, estimated_minutes?)`
        - `delete_task(task_id)`
        - `move_task(task_id, project?)` — when project is None,
          moves task to inbox (matches Python, NO extra `to_inbox` param)
        Input validation: non-empty name, non-empty project when provided.
15. [x] Create `rust/src/tools/projects.rs` — **read Python file first**:
        - `list_projects(folder?: String, status: String = "active",
          limit: i32 = 100)`
        - `get_project(project_id_or_name: String)` — accepts BOTH
          ID and name, matching the Python implementation
        - `create_project(name, folder?, note?, due_date?, defer_date?,
          sequential?: bool)` — NO tags parameter
        - `complete_project(project_id_or_name: String)` — accepts
          BOTH ID and name
16. [x] Create `rust/src/tools/tags.rs`:
        - `list_tags(limit: i32 = 100)` — NO status parameter
        - `create_tag(name: String, parent?: String)`
17. [x] Create `rust/src/tools/folders.rs`:
        - `list_folders(limit: i32 = 100)`
18. [x] Create `rust/src/tools/forecast.rs`:
        - `get_forecast(limit: i32 = 100)` — param is `limit`, NOT `days`
19. [x] Create `rust/src/tools/perspectives.rs`:
        - `list_perspectives(limit: i32 = 100)`
20. [ ] Create `rust/tests/tools_read_test.rs` with mocked `JxaRunner`:
        - Happy path for each read tool (canned JSON → typed result)
        - Empty results return empty vec
        - Malformed JSON from JXA produces `JsonParse` error
        - Validation errors (limit < 1, empty id, empty query)
21. [ ] Create `rust/tests/tools_write_test.rs` with mocked `JxaRunner`:
        - Happy path for each write tool
        - Validation errors (empty name, empty project when provided)
        - JXA error propagation
        - `create_task` JXA script contains expected escaped values
22. [ ] `cargo test && cargo clippy -- -D warnings && cargo fmt --check`
        all pass.

---

## Phase 3 — Resources, Prompts & Server Wiring

Connect everything into a working MCP server.

### Success Criteria

23. [ ] Create `rust/src/resources.rs` with 3 resource handlers matching
        Python's `resources.py` exactly:
        - `omnifocus://inbox` — returns current inbox tasks as JSON
          (calls `get_inbox()` internally)
        - `omnifocus://today` — returns forecast sections as JSON
          (calls `get_forecast()` internally)
        - `omnifocus://projects` — returns active project summaries as JSON
          (calls `list_projects(status="active")` internally)
24. [ ] Create `rust/src/prompts.rs` with 4 prompt handlers matching
        Python's `prompts.py` exactly. Read the Python file first.
        - `daily_review` (underscore, not hyphen) — no arguments.
          Calls `list_tasks(status="due_soon")`,
          `list_tasks(status="overdue")`,
          `list_tasks(flagged=true, status="all")`. Returns formatted
          review prompt text.
        - `weekly_review` — no arguments. Calls
          `list_projects(status="active", limit=500)` and
          `list_tasks(status="available", limit=1000)`.
        - `inbox_processing` — no arguments. Calls
          `get_inbox(limit=200)`.
        - `project_planning(project: String)` — **required `project`
          argument**. Validates non-empty. Calls
          `get_project(project_id_or_name)` and
          `list_tasks(project, status="available", limit=500)`.
        Prompt text must match Python output format.
25. [ ] Create `rust/src/server.rs`:
        - Implement MCP server using `rmcp` patterns (see SDK notes
          in preamble): `#[tool_router]` impl, `#[tool_handler]`
          impl ServerHandler, `ServerCapabilities::builder()
          .enable_tools().enable_resources().enable_prompts().build()`
        - Register all 19 tools with names matching Python exactly
          (e.g. `get_inbox`, `list_tasks`, etc.)
        - Register 3 resources and 4 prompts
        - The server struct holds a `Box<dyn JxaRunner>` (or Arc)
26. [ ] Create `rust/src/main.rs`:
        - `clap` for `--version` flag (prints `omnifocus-mcp X.Y.Z`)
        - `#[tokio::main]` async entry point
        - Creates `RealJxaRunner`, creates server, connects stdio
          transport via `.serve(stdio()).await`
        - `service.waiting().await` to keep alive
        - Clean shutdown on EOF/SIGINT
27. [ ] `echo '{}' | cargo run` starts the server and exits cleanly
        (handles invalid JSON-RPC without crashing).
28. [ ] `cargo run -- --version` prints `omnifocus-mcp` followed by
        the version from Cargo.toml.
29. [ ] Create `rust/tests/resources_test.rs` — verify resource content
        strings contain expected keywords.
        Create `rust/tests/prompts_test.rs` — verify prompt rendering
        with mocked JxaRunner returns expected structure. Verify
        `project_planning` validates non-empty project argument.
30. [ ] `cargo test && cargo clippy -- -D warnings && cargo fmt --check`
        all pass.

---

## Phase 4 — Smoke Test & Integration

Validate the Rust server against real OmniFocus. Follow the same
patterns as `python/tests/test_integration.py`.

### Success Criteria

31. [ ] Create `rust/examples/smoke_test.rs` — standalone async binary
        that calls every tool function against real OmniFocus and prints
        pass/fail. Pattern: same as `python/scripts/smoke_test.py`.
32. [ ] Smoke test passes against real OmniFocus with zero failures.
        Any bugs discovered are documented with `// BUG:` and fixed
        before proceeding.
33. [ ] Create `rust/tests/integration_test.rs` gated by
        `#[cfg(feature = "integration")]`. Tests:
        - `test_jxa_bridge_connectivity` — basic run_omnijs call
        - `test_read_tools_return_valid_json` — calls each read tool,
          asserts return is parseable with expected fields
        - `test_task_lifecycle` — create `[TEST-MCP]` → get → update →
          complete → delete. Cleanup in Drop impl or explicit teardown.
        - `test_search_finds_created_task` — create, search, assert found
        - `test_project_lifecycle` — create → get → complete
34. [ ] Integration tests pass: `cargo test --features integration`
        (with OmniFocus running).
35. [ ] Integration tests are excluded from normal `cargo test`.
36. [ ] No test data leaks — all `[TEST-MCP]` items cleaned up by
        teardown even if assertions panic (use `Drop` or explicit
        cleanup at start of each test).

---

## Phase 5 — Homebrew & Distribution

Create the CI pipeline and Homebrew infrastructure for binary
distribution.

### Success Criteria

37. [ ] `cargo build --release` produces a working binary at
        `rust/target/release/omnifocus-mcp`. Verify it starts and
        responds to `--version`.
38. [ ] Create `.github/workflows/release-rust.yml`:
        - Trigger: push tag matching `rust-v*`
        - Jobs: build on `macos-latest` (Apple Silicon) and
          `macos-13` (Intel) — or use cross-compilation with
          `rustup target add x86_64-apple-darwin` on ARM runner
        - Steps: checkout, install Rust, `cargo build --release --target $TARGET`,
          create tarball `omnifocus-mcp-$VERSION-$TARGET.tar.gz`,
          compute SHA256 (`shasum -a 256`)
        - Create GitHub Release with both tarballs attached
        - Output SHA256 values in release notes for Homebrew formula
39. [ ] Create `homebrew/omnifocus-mcp.rb` — Homebrew formula template:
        - `desc`, `homepage`, `version`, `license`
        - `depends_on :macos`
        - `on_arm` / `on_intel` blocks with URL and sha256 placeholders
        - `bin.install "omnifocus-mcp"`
        - `test` block that verifies `--version` output
        Include a comment header explaining how to use: create a tap
        repo, copy this formula, update SHAs from release.
40. [ ] Create `docs/install-rust.md` with:
        - Two install methods: **Homebrew** (preferred) and **from source**
        - Homebrew: `brew tap user/omnifocus-mcp && brew install omnifocus-mcp`
        - From source: prerequisites (macOS, Rust toolchain), `git clone`,
          `cd rust`, `cargo build --release`,
          `cp target/release/omnifocus-mcp /usr/local/bin/`
        - MCP client configuration snippets for Claude Desktop, Cursor,
          and generic stdio. Command: `omnifocus-mcp` (Homebrew) or
          full path to binary (source)
        - Troubleshooting section covering:
          - OmniFocus not running
          - macOS Automation permission denied
          - Rust version mismatch
          - Binary architecture mismatch (ARM vs Intel)
          - **macOS Gatekeeper blocking unsigned binary**: instruct users
            to run `xattr -cr /path/to/omnifocus-mcp` if downloaded
            outside Homebrew, or note that Homebrew-installed binaries
            are not affected
41. [ ] Update top-level `README.md`:
        - Add Rust to the implementation comparison table
        - Add Rust quick-start section linking to `docs/install-rust.md`
        - Note Homebrew as the recommended install method
        - Update feature count if the Rust implementation has parity
42. [ ] Release binary smoke test: build release binary, run the
        `smoke_test` example against real OmniFocus, verify zero failures.

---

## Phase 6 — Final Cleanup

### Success Criteria

43. [ ] `cargo fmt --check` is clean (no formatting issues).
44. [ ] `cargo clippy -- -D warnings` is clean (no lint warnings).
45. [ ] `cargo test` passes (all mocked tests, integration skipped).
46. [ ] `.gitignore` updated to exclude `rust/target/`.
        `rust/Cargo.lock` is committed (Rust convention for binaries).
47. [ ] Git status is clean — no untracked source files, no uncommitted
        changes. Commit all work with a descriptive message.

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. Run `cargo test && cargo clippy -- -D warnings` after every code change
4. **Criterion 1 is critical** — research the rmcp SDK thoroughly before
   writing any server code. Use the `context7` MCP tool to fetch docs.
5. **JXA scripts must be identical** to the Python implementation. Read
   each Python tool file before writing the Rust equivalent.
6. **Phases 4 and 5 require real OmniFocus** — if not running or
   permission is denied, output: `<ralph>GUTTER</ralph>`
7. Commit your changes frequently
8. When ALL criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
9. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
