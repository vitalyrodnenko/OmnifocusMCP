# install guide: python implementation

This guide installs and runs the Python OmniFocus MCP server from source.

## prerequisites

- macOS (required for `osascript` + OmniFocus automation)
- OmniFocus installed and running
- Python 3.11+
- `uv` installed (`brew install uv`)
- terminal/editor has Automation permission to control OmniFocus

## install from source

1. clone the repository:

```bash
git clone https://github.com/vitalyrodnenko/OmnifocusMCP.git
cd OmnifocusMCP/python
```

2. create the project environment and install dependencies:

```bash
uv sync
```

3. verify the server starts:

```bash
uv run python -m omnifocus_mcp
```

Expected result: the process starts and waits for JSON-RPC on stdin. Stop with `Ctrl-C`.

## mcp client configuration

Use this real command shape for clients:

```bash
uv run --directory /absolute/path/to/OmnifocusMCP/python python -m omnifocus_mcp
```

### claude desktop

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

### cursor

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

### generic stdio config

```json
{
  "name": "omnifocus-python",
  "transport": "stdio",
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
```

## troubleshooting

### OmniFocus is not running

- symptom: tool calls fail with OmniFocus-unavailable errors
- fix: open OmniFocus, keep it running, retry the MCP call

### permission denied for automation

- symptom: `osascript` reports not authorized to send Apple events
- fix: System Settings -> Privacy & Security -> Automation -> allow your terminal/editor to control OmniFocus

### python version mismatch

- symptom: `uv sync` fails or runtime errors mention unsupported Python
- fix: install Python 3.11+ and rerun `uv sync`
