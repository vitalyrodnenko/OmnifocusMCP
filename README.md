# OmniFocus MCP

[![Platform: macOS](https://img.shields.io/badge/platform-macOS-black)](https://www.omnigroup.com/omnifocus)
[![Protocol: MCP](https://img.shields.io/badge/protocol-MCP-6f42c1)](https://modelcontextprotocol.io)
[![Language: Rust/Python/TypeScript](https://img.shields.io/badge/impl-rust%20%7C%20python%20%7C%20typescript-0ea5e9)](#implementations)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

MCP server that gives AI assistants full control over [OmniFocus](https://www.omnigroup.com/omnifocus) on macOS.

45 tools, 3 resources, and 4 prompts covering tasks, projects, tags, folders, perspectives, forecast, notifications, and review workflows — all through the [Model Context Protocol](https://modelcontextprotocol.io).

This project is not affiliated with, endorsed by, or associated with The Omni Group or OmniFocus. OmniFocus is a trademark of The Omni Group. This is an independent, non-commercial open-source project.

## Quick Start

Install via [Homebrew](https://brew.sh) (if you don't have Homebrew, see the [Homebrew installation guide](https://brew.sh)):

```bash
brew tap vitalyrodnenko/omnifocus-mcp
brew install omnifocus-mcp
```

Then add to your MCP client config (Claude Desktop, Cursor, etc.):

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

That's it. The AI assistant now has full OmniFocus access.

## What It Can Do

### Tasks (23 tools)

Full lifecycle management for OmniFocus tasks:

- **CRUD** — create, get, update, delete individual tasks
- **Batch operations** — create, move, or delete multiple tasks in a single call
- **Subtasks** — create and list subtasks under any parent task
- **Completion** — mark complete, mark incomplete (supports repeating tasks)
- **Search** — full-text search across task names and notes with all filters applied
- **Move and reparent** — relocate tasks between projects, reparent tasks under other tasks, or move subtasks back to inbox/project without delete/recreate
- **Duplicate** — clone a task with all properties and optional subtasks
- **Notifications** — list, add, and remove notifications (absolute date or relative offset)
- **Repetition** — set or clear repetition rules with schedule type (regularly/after completion)
- **Notes** — append text to task notes without overwriting
- **Safety model** — destructive delete confirmations stay separate from non-destructive move/update workflows
- **Aggregate counts** — fast "how many" queries without listing individual tasks

#### Advanced Filtering

`list_tasks` and `search_tasks` support powerful filter combinations:

| Filter | Description |
| --- | --- |
| `project` | Scope to a single project by name |
| `tag` / `tags` | Filter by one tag or multiple tags |
| `tagFilterMode` | `"any"` (default) or `"all"` for multi-tag filtering |
| `flagged` | Flagged tasks only |
| `status` | `"available"`, `"remaining"`, `"completed"`, `"dropped"`, `"all"` |
| `dueBefore` / `dueAfter` | Due date range (ISO 8601) |
| `deferBefore` / `deferAfter` | Defer date range (ISO 8601) |
| `completedBefore` / `completedAfter` | Completion date range (ISO 8601) |
| `addedBefore` / `addedAfter` | Creation date range (ISO 8601) |
| `changedBefore` / `changedAfter` | Last-modified date range (ISO 8601, maps to OmniFocus `modified`) |
| `plannedBefore` / `plannedAfter` | Planned date range (ISO 8601) |
| `maxEstimatedMinutes` | Tasks with estimated duration up to N minutes |

#### Sorting

All list/search tools support `sortBy` and `sortOrder`:

- Sort by: `name`, `dueDate`, `deferDate`, `completionDate`, `estimatedMinutes`, `project`, `flagged`, `addedDate`, `changedDate`, `plannedDate`
- Aliases: `added` -> `addedDate`, `modified` -> `changedDate`, `planned` -> `plannedDate`
- Sort order: `asc` (default) or `desc`
- Task payloads include `addedDate` and `changedDate` (ISO 8601 or `null`)

### Projects (11 tools)

- **CRUD** — create, get, update, delete projects
- **Lifecycle** — complete, uncomplete, set status (active/on-hold/dropped)
- **Organization** — move between folders, search by name
- **Filtering** — by folder, status, completion date range, stalled-only flag
- **Sorting** — by name, due date, or other fields
- **Aggregate counts** — project counts by status, optionally scoped to a folder

#### Project Lifecycle Semantics

- Use `complete_project` when work is finished/closed (done/completed).
- Use `set_project_status` for organizational state only:
  - `active` = current
  - `on_hold` = paused (UI wording is often "on hold"/"on-hold")
  - `dropped` = intentionally abandoned/cancelled, not completed
- Use `uncomplete_project` to reopen a completed project back to active.
- In user-facing summaries, present business meaning first (project name,
  folder, and status transition), and include opaque IDs only as secondary
  references.

### Tags (5 tools)

- **CRUD** — create, update (name and status), delete
- **List** — with status filter (active/on-hold/dropped/all), sorting, and limits
- **Search** — fuzzy name matching

### Folders (5 tools)

- **CRUD** — create, get (with child projects and subfolders), update, delete
- **Hierarchy** — create nested folders with parent parameter
- **List** — all folders with limits

### Forecast (1 tool)

- Structured view with sections: overdue, due today, flagged, deferred, and due this week

### Perspectives (1 tool)

- List all available OmniFocus perspectives

### Resources (3)

Live snapshots available to MCP clients:

| Resource | Description |
| --- | --- |
| Inbox | Current inbox tasks |
| Today | Today's forecast (overdue + due today + flagged) |
| Active Projects | All active projects with task counts |

### Prompts (4)

Ready-to-use review workflows:

| Prompt | Description |
| --- | --- |
| Daily Review | Due-soon, overdue, and flagged tasks for daily planning |
| Weekly Review | Active projects and next-action coverage analysis |
| Inbox Processing | One-by-one inbox clarification decisions |
| Project Planning | Guided planning for a specific project |

## Implementations

Three implementations with identical tool names, parameters, and response shapes:

| Implementation | Language | Install | Recommended For |
| --- | --- | --- | --- |
| **Rust** | Rust | Homebrew (recommended) or source | Production use — single binary, fast startup |
| Python | Python 3.11+ | `uv` from source | Local development, easy scripting |
| TypeScript | Node.js 20+ | `npm` from source | Node.js ecosystems |

Detailed setup guides: [Rust](docs/install-rust.md) · [Python](docs/install-python.md) · [TypeScript](docs/install-typescript.md)

## How It Works

The server runs JXA (JavaScript for Automation) scripts through macOS `osascript`. Each script uses the OmniFocus `evaluateJavascript` bridge to execute Omni Automation JavaScript inside OmniFocus itself, where full APIs like `flattenedTasks`, `Task.Status`, and `new Task()` are available. Data is serialized as JSON and returned through the MCP protocol with consistent schemas across all three implementations.

## MCP Client Config Examples

### Claude Desktop

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

### Cursor

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

### Python (source build)

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "uv",
      "args": ["run", "omnifocus-mcp"]
    }
  }
}
```

### TypeScript (source build)

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/OmnifocusMCP/typescript"
    }
  }
}
```

> Keep only one OmniFocus MCP server enabled at a time to avoid duplicate tool surfaces.

Compatibility snippet:

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "python",
      "args": ["-m", "omnifocus_mcp"]
    }
  }
}
```

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/OmnifocusMCP/typescript"
    }
  }
}
```

## Switching Implementations

### Switching Between Rust, Python, and TypeScript

- Use Rust when you want a single prebuilt `omnifocus-mcp` binary.
- Use Python when you want `uv` or `python -m` execution and fast local iteration.
- Use TypeScript when you want `node` execution from `typescript/dist/index.js`.
- Restart the MCP client so it reloads the server command after you switch implementations.

## Prerequisites

- macOS (required — OmniFocus is macOS-only)
- OmniFocus installed and running
- Automation permission granted to the terminal/editor (System Settings → Privacy & Security → Automation)

For source builds only:
- Python 3.11+ and [`uv`](https://docs.astral.sh/uv/) (Python implementation)
- Node.js 20+ and npm (TypeScript implementation)
- Rust toolchain via [`rustup`](https://rustup.rs) (Rust source build)

## Contributing

Contributions are welcome through focused pull requests with clear scope and passing checks. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and validation steps.

## License

MIT. See [`LICENSE`](LICENSE) for details.
