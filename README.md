# OmniFocus MCP

OmniFocus MCP is a Model Context Protocol server for OmniFocus automation on macOS, powered by JXA (`osascript`) and Omni Automation (`evaluateJavascript` bridge).

## Status

| Indicator | Value |
| --- | --- |
| Stability | ✅ validated with mocked test suites in both implementations |
| Tooling parity | ✅ Python, TypeScript, and Rust expose matching tool/resource/prompt surfaces |
| Platform support | ✅ macOS host runtime (OmniFocus + Apple Events) |

## Quick Start

- Rust install and runtime guide (homebrew recommended): [`docs/install-rust.md`](docs/install-rust.md)
- Python install and runtime guide: [`docs/install-python.md`](docs/install-python.md)
- TypeScript install and runtime guide: [`docs/install-typescript.md`](docs/install-typescript.md)
- Docker development and CI guide: [`docs/development-docker.md`](docs/development-docker.md)

## Implementations

| implementation | language | install | status |
| --- | --- | --- | --- |
| rust | rust | homebrew (preferred) or source build | ✅ active |
| python | python 3.11+ | `uv` from source | ✅ active |
| typescript | node.js 20+ | `npm` from source | ✅ active |

## Prerequisites

- macOS with OmniFocus installed
- OmniFocus running when tools are used
- Automation permission granted to the terminal/editor process
- Rust toolchain for source builds (Homebrew install does not require Rust)
- Python 3.11+ and `uv` (Python server)
- Node.js 20+ and npm (TypeScript server)

## Features

### tools (20)

| Type | Name | Description |
| --- | --- | --- |
| tool | `get_inbox` | Return inbox tasks that are not completed. |
| tool | `list_tasks` | List tasks with filters for project, tag, flagged state, and status. |
| tool | `get_task` | Fetch one task by stable OmniFocus task id. |
| tool | `search_tasks` | Search tasks by case-insensitive text in name and note. |
| tool | `create_task` | Create one task in inbox or a named project with optional metadata. |
| tool | `create_tasks_batch` | Create multiple tasks in a single OmniJS call. |
| tool | `complete_task` | Mark a task complete by id. |
| tool | `update_task` | Apply partial updates to an existing task by id. |
| tool | `delete_task` | Delete a task by id and return deletion status. |
| tool | `delete_tasks_batch` | Delete multiple tasks in a single OmniJS call (confirm with the user first). |
| tool | `move_task` | Move a task into a target project or back to inbox. |
| tool | `list_projects` | List projects with optional folder and status filters. |
| tool | `get_project` | Return full details for a project by id or exact name. |
| tool | `create_project` | Create a project with optional folder, note, dates, and mode. |
| tool | `complete_project` | Mark a project complete by id or exact name. |
| tool | `list_tags` | List tags with active task counts and status filtering. |
| tool | `create_tag` | Create a tag with an optional parent tag. |
| tool | `list_folders` | List folder hierarchy and project counts. |
| tool | `get_forecast` | Return forecast sections for overdue, due today, and flagged work. |
| tool | `list_perspectives` | List available built-in and custom perspectives. |

### resources (3)

| Type | Name | Description |
| --- | --- | --- |
| resource | `inbox_resource` (`omnifocus://inbox`) | Current inbox snapshot in JSON form. |
| resource | `today_resource` (`omnifocus://today`) | Forecast snapshot for overdue, today, and flagged tasks. |
| resource | `projects_resource` (`omnifocus://projects`) | Active project summaries in JSON form. |

### prompts (4)

| Type | Name | Description |
| --- | --- | --- |
| prompt | `daily_review` | Build a daily plan from overdue, due-soon, and flagged tasks. |
| prompt | `weekly_review` | Run GTD-style weekly review across active projects and next actions. |
| prompt | `inbox_processing` | Process inbox items one-by-one into concrete decisions. |
| prompt | `project_planning` | Turn a project into sequenced executable next actions. |

## MCP client config examples

Any MCP client with stdio support can run either implementation.

### Claude Desktop

Python:

```json
{
  "mcpServers": {
    "omnifocus-python": {
      "command": "uv",
      "args": ["run", "omnifocus-mcp"],
      "cwd": "/absolute/path/to/OmnifocusMCP/python"
    }
  }
}
```

TypeScript:

```json
{
  "mcpServers": {
    "omnifocus-typescript": {
      "command": "node",
      "args": ["/absolute/path/to/OmnifocusMCP/typescript/dist/index.js"]
    }
  }
}
```

### Cursor

Python:

```json
{
  "mcpServers": {
    "omnifocus-python": {
      "command": "python",
      "args": ["-m", "omnifocus_mcp"],
      "cwd": "/absolute/path/to/OmnifocusMCP/python"
    }
  }
}
```

TypeScript:

```json
{
  "mcpServers": {
    "omnifocus-typescript": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/OmnifocusMCP/typescript"
    }
  }
}
```

### switching between Rust, Python, and TypeScript

- use the Rust config when you want the native `omnifocus-mcp` binary
- use the Python config when you want `uv` or `python` execution from `python/`
- use the TypeScript config when you want `node` execution from `typescript/dist/index.js`
- keep only one OmniFocus server entry enabled to avoid duplicate tool sets

## switching implementations

1. choose one command block (Rust, Python, or TypeScript) for your MCP client
2. replace your existing OmniFocus server entry with the other implementation command
3. restart the MCP client so it reloads the server command

## Additional Docs

- Rust implementation details: `rust/README.md`
- Python implementation details: `python/README.md`
- TypeScript implementation details: `typescript/README.md`
