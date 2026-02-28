# OmniFocus MCP — Rust

Native Rust implementation of the OmniFocus MCP server. Produces a single
compiled binary (`omnifocus-mcp`) distributable via Homebrew.

## Features

- 20 tools, 3 resources, 4 prompts — full parity with Python and TypeScript
- Single binary, zero runtime dependencies
- ~5 MB release build
- Homebrew-installable (`brew install omnifocus-mcp`)

## Prerequisites

- macOS (required — uses `osascript` for OmniFocus communication)
- OmniFocus installed and running
- Rust toolchain for building from source (not needed for Homebrew install)

## Quick start

### Homebrew (recommended)

```bash
brew tap <user>/omnifocus-mcp
brew install omnifocus-mcp
omnifocus-mcp --version
```

### From source

```bash
cd rust
cargo build --release
./target/release/omnifocus-mcp --version
```

## Project structure

```
rust/
  Cargo.toml
  src/
    main.rs              — entry point, clap --version, stdio transport
    lib.rs               — module re-exports
    server.rs            — MCP ServerHandler, tool/resource/prompt registration
    jxa.rs               — osascript subprocess, JxaRunner trait, escape_for_jxa
    error.rs             — OmniFocusError enum
    types.rs             — TaskResult, ProjectResult, TagResult, etc.
    tools/
      mod.rs             — re-exports
      tasks.rs           — 11 task tools (get_inbox, list_tasks, create_task, delete_tasks_batch, etc.)
      projects.rs        — 4 project tools
      tags.rs            — 2 tag tools
      folders.rs         — list_folders
      forecast.rs        — get_forecast
      perspectives.rs    — list_perspectives
    resources.rs         — omnifocus://inbox, today, projects
    prompts.rs           — daily_review, weekly_review, inbox_processing, project_planning
  tests/
    jxa_test.rs          — escaping, error display, envelope unwrapping
    tools_read_test.rs   — mocked read tool tests
    tools_write_test.rs  — mocked write tool tests
    resources_test.rs    — resource content tests
    prompts_test.rs      — prompt rendering tests
    integration_test.rs  — real OmniFocus tests (feature-gated)
  examples/
    probe.rs             — minimal JXA bridge connectivity check
    smoke_test.rs        — full tool validation against real OmniFocus
```

## Testing

```bash
# mocked unit tests (no OmniFocus needed)
cargo test

# lint and format checks
cargo clippy -- -D warnings
cargo fmt --check

# integration tests (requires running OmniFocus)
cargo test --features integration
```

## MCP client configuration

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "omnifocus-mcp",
      "args": []
    }
  }
}
```

When built from source and not on `PATH`, use the full binary path:

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "/absolute/path/to/rust/target/release/omnifocus-mcp",
      "args": []
    }
  }
}
```

## Homebrew distribution

See [`homebrew/omnifocus-mcp.rb`](../homebrew/omnifocus-mcp.rb) for the
formula template and [`.github/workflows/release-rust.yml`](../.github/workflows/release-rust.yml)
for the CI release pipeline.

Full installation guide: [`docs/install-rust.md`](../docs/install-rust.md)
