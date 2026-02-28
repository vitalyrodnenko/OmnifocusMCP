# OmniFocus MCP Server (TypeScript)

TypeScript implementation of an MCP server for OmniFocus on macOS.

## Prerequisites

- macOS with OmniFocus installed and running
- Node.js 20+
- npm
- macOS Automation permission granted to your terminal/editor

## Install

```bash
cd typescript
npm install
```

## Run

```bash
cd typescript
npm run build
node dist/index.js
```

The server uses stdio transport.

## MCP client configuration examples

### Claude Desktop

```json
{
  "mcpServers": {
    "omnifocus-ts": {
      "command": "node",
      "args": ["/absolute/path/to/OmnifocusMCP/typescript/dist/index.js"]
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "omnifocus-ts": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/OmnifocusMCP/typescript"
    }
  }
}
```

### Cline

```json
{
  "mcpServers": {
    "omnifocus-ts": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/OmnifocusMCP/typescript"
    }
  }
}
```

### generic stdio clients

Use:

- command: `node`
- args: `["/absolute/path/to/OmnifocusMCP/typescript/dist/index.js"]`

## usage examples

- `ping`
- `get_inbox`
- `list_tasks`
- `create_task`
- `project_planning`

## development checks

```bash
cd typescript
npx tsc --noEmit
npm test
```
