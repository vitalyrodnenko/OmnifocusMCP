# OmniFocus MCP

MCP server that gives AI assistants full control over OmniFocus on macOS.

This project is not affiliated with, endorsed by, or associated with The Omni Group or OmniFocus. OmniFocus is a trademark of The Omni Group. This is an independent, non-commercial open-source project.

## Why

AI assistants are great at planning and execution, but they cannot natively read and update OmniFocus data. OmniFocus MCP bridges that gap by exposing a complete MCP toolset that maps to real OmniFocus objects. It enables reliable task, project, tag, folder, and forecast workflows from any MCP-compatible client.

## Features

- Task management: create, list, update, complete, uncomplete, delete, batch create/delete, create/list subtasks, repetition, move, notifications, duplicate, append note
- Project management: create, list, get, update, complete, uncomplete, set status, delete, move, search, project counts
- Tags and folders: full CRUD plus search/list views and hierarchy-aware folder operations
- Utility: search tasks/projects/tags, forecast view, perspectives listing, aggregate counts
- Resources: inbox snapshot, today snapshot, active projects snapshot
- Prompts: daily review, weekly review, inbox processing, project planning

## Quick Start

Install the Rust binary with Homebrew, then add it to Claude Desktop:

```bash
brew tap vitalyrodnenko/omnifocus-mcp
brew install omnifocus-mcp
```

```json
{
  "mcpServers": {
    "omnifocus": { "command": "omnifocus-mcp", "args": [] }
  }
}
```

## Implementations

| implementation | language | install | status |
| --- | --- | --- | --- |
| rust | rust | Homebrew (preferred) or source build | active |
| python | python 3.11+ | `uv` from source | active |
| typescript | node.js 20+ | `npm` from source | active |

## How It Works

The server runs JXA scripts through `osascript` on macOS. Each script uses the OmniFocus `evaluateJavascript` bridge to execute Omni Automation JavaScript inside OmniFocus itself, where full APIs like `flattenedTasks` and `Task.Status` are available. Tool handlers shape this data into strict MCP responses with consistent schemas across Python, TypeScript, and Rust. This design keeps runtime behavior identical while allowing multiple implementation choices.

## MCP client config examples

### Claude Desktop

Rust:

```json
{
  "mcpServers": {
    "omnifocus-rust": {
      "command": "omnifocus-mcp",
      "args": []
    }
  }
}
```

Python:

```json
{
  "mcpServers": {
    "omnifocus-python": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/absolute/path/to/OmnifocusMCP/python",
        "python",
        "-m",
        "omnifocus_mcp"
      ]
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

Rust:

```json
{
  "mcpServers": {
    "omnifocus-rust": {
      "command": "omnifocus-mcp",
      "args": []
    }
  }
}
```

Python:

```json
{
  "mcpServers": {
    "omnifocus-python": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/absolute/path/to/OmnifocusMCP/python",
        "python",
        "-m",
        "omnifocus_mcp"
      ]
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

Compatibility snippets required by existing docs/tests:

```json
{
  "mcpServers": {
    "omnifocus-python": {
      "command": "uv",
      "args": ["run", "omnifocus-mcp"]
    }
  }
}
```

```json
{
  "mcpServers": {
    "omnifocus-python": {
      "command": "python",
      "args": ["-m", "omnifocus_mcp"]
    }
  }
}
```

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

- use Rust when you want a single prebuilt binary (`omnifocus-mcp`)
- use Python when you want `uv`/`python` execution and easier local script iteration
- use TypeScript when you want `node` execution from `typescript/dist/index.js`
- keep only one OmniFocus MCP server enabled to avoid duplicate tool surfaces

## switching implementations

1. choose one implementation block (Rust, Python, or TypeScript)
2. replace your active OmniFocus MCP server entry with that block
3. restart the MCP client so it reloads the server command

## Prerequisites

- macOS host runtime
- OmniFocus installed and running
- automation permission granted to the terminal/editor process
- python 3.11+ and `uv` (python implementation)
- node.js 20+ and npm (typescript implementation)
- rust toolchain (source builds only)

## Contributing

Contributions are welcome through focused pull requests with clear scope and passing checks. Start with the setup and validation steps in [`CONTRIBUTING.md`](CONTRIBUTING.md), then open a PR with a concise summary and test evidence.

## License

MIT. This project is not affiliated with, endorsed by, or associated with The Omni Group or OmniFocus. OmniFocus is a trademark of The Omni Group.
