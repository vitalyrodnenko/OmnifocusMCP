# install guide: typescript implementation

This guide installs and runs the TypeScript OmniFocus MCP server from source.

## prerequisites

- macOS (required for `osascript` + OmniFocus automation)
- OmniFocus installed and running
- Node.js 20+
- npm
- terminal/editor has Automation permission to control OmniFocus

## install from source

1. clone the repository:

```bash
git clone https://github.com/vitalyrodnenko/OmnifocusMCP.git
cd OmnifocusMCP/typescript
```

2. install dependencies:

```bash
npm install
```

3. build:

```bash
npm run build
```

4. verify the server starts:

```bash
node dist/index.js
```

Expected result: the process starts and waits for JSON-RPC on stdin. Stop with `Ctrl-C`.

## mcp client configuration

Use this real command shape for clients:

```bash
node /absolute/path/to/OmnifocusMCP/typescript/dist/index.js
```

### claude desktop

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

### cursor

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

### generic stdio config

```json
{
  "name": "omnifocus-typescript",
  "transport": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/OmnifocusMCP/typescript/dist/index.js"]
}
```

## troubleshooting

### OmniFocus is not running

- symptom: tool calls fail with OmniFocus-unavailable errors
- fix: open OmniFocus, keep it running, retry the MCP call

### permission denied for automation

- symptom: `osascript` reports not authorized to send Apple events
- fix: System Settings -> Privacy & Security -> Automation -> allow your terminal/editor to control OmniFocus

### node version mismatch

- symptom: build/runtime failures due to unsupported syntax or engine constraints
- fix: upgrade to Node.js 20+ and rerun `npm install && npm run build`

### build errors

- symptom: `npm run build` fails with TypeScript compile errors
- fix: rerun `npm install`, then `npx tsc --noEmit` to inspect details before rebuilding
