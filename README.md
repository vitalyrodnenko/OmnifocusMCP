# OmniFocus MCP

OmniFocus MCP is a Model Context Protocol server that lets MCP-compatible clients interact with OmniFocus on macOS via JXA (`osascript` + `evaluateJavaScript`).

This monorepo contains two independent implementations with matching tool names, schemas, and response shapes:

- Python implementation (primary): `python/`
- TypeScript implementation (port): `typescript/`

## prerequisites

- macOS
- OmniFocus 3+
- Python 3.10+ (for the Python implementation)
- Node.js 18+ and npm (for the TypeScript implementation)
- macOS Automation permission granted to your terminal/editor for OmniFocus

## feature comparison

| Capability | Python (`python/`) | TypeScript (`typescript/`) |
|---|---|---|
| transport | stdio | stdio |
| JXA bridge (`evaluateJavaScript`) | yes | yes |
| read tools (tasks/projects/tags/folders/forecast/perspectives) | yes | yes |
| write tools (create/update/complete/move/delete) | yes | yes |
| resources (`omnifocus://inbox`, `omnifocus://today`, `omnifocus://projects`) | yes | yes |
| prompts (`daily_review`, `weekly_review`, `inbox_processing`, `project_planning`) | yes | yes |
| packaging/entry point | `omnifocus-mcp` | `omnifocus-mcp-typescript` |

## install

### Python

```bash
cd python
uv pip install -e ".[dev]"
```

Alternative:

```bash
cd python
python -m pip install -e ".[dev]"
```

### TypeScript

```bash
cd typescript
npm install
npm run build
```

## MCP client config examples

Any MCP client that supports stdio transport is supported (Claude Desktop, Cursor, Cline, Zed, and custom clients).

### switching between Python and TypeScript

For any client, switching implementations only requires changing the stdio command pair:

- Python: command/args should launch `omnifocus-mcp` (or `python -m omnifocus_mcp`)
- TypeScript: command/args should launch `dist/index.js` (or `npx omnifocus-mcp-typescript`)

Keep one server block enabled at a time and disable/remove the other block to switch cleanly.

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

### Cline

Use the same stdio command shape as Cursor for either implementation.

### generic stdio clients

Python:

- command: `omnifocus-mcp`
- args: `[]`
- cwd: `/absolute/path/to/OmnifocusMCP/python`

TypeScript:

- command: `node`
- args: `["/absolute/path/to/OmnifocusMCP/typescript/dist/index.js"]`

## switching python vs typescript

To switch any client between implementations:

1. keep the same server key if you want existing references to continue working
2. replace only the command section
3. restart the client after changing config

python command options:

- `uv run omnifocus-mcp` (from `python/`)
- `python -m omnifocus_mcp` (from `python/`)

typescript command option:

- `node /absolute/path/to/OmnifocusMCP/typescript/dist/index.js`

## switching implementations

To switch any MCP client between Python and TypeScript:

1. keep the same server key (for example `omnifocus`) in your client config
2. change only the command/args:
   - Python: `uv run omnifocus-mcp` (or `python -m omnifocus_mcp`)
   - TypeScript: `node /absolute/path/to/OmnifocusMCP/typescript/dist/index.js`
3. restart the MCP client so it reloads the server command

Both implementations expose the same tool names and parameter shapes, so prompt/tool usage does not need to change when you switch.

## implementation docs

- Python guide: `python/README.md`
- TypeScript guide: `typescript/README.md`
