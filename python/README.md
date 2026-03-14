# OmniFocus MCP (Python)

Python implementation of the OmniFocus Model Context Protocol (MCP) server for OmniFocus on macOS.

## Prerequisites

- macOS with OmniFocus installed and running
- Python 3.11+
- automation permission granted for your terminal/editor to control OmniFocus

## Install

### Option 1: uv (recommended)

```bash
cd python
uv pip install -e ".[dev]"
```

### Option 2: pip

```bash
cd python
python -m pip install -e ".[dev]"
```

## Run Server

From the `python/` directory:

```bash
python -m omnifocus_mcp
```

This starts the MCP server over stdio.

## MCP Client Configuration

### Claude Desktop

Add this to your `claude_desktop_config.json` MCP servers section:

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "uv",
      "args": ["run", "omnifocus-mcp"],
      "cwd": "/Users/your-user/Projects/OmnifocusMCP/python"
    }
  }
}
```

### Cursor

Use a stdio MCP entry that runs the module directly:

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "python",
      "args": ["-m", "omnifocus_mcp"],
      "cwd": "/Users/your-user/Projects/OmnifocusMCP/python"
    }
  }
}
```

### Cline

Configure the same stdio command in Cline MCP settings:

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "python",
      "args": ["-m", "omnifocus_mcp"],
      "cwd": "/Users/your-user/Projects/OmnifocusMCP/python"
    }
  }
}
```

### Generic stdio clients

Any MCP client that supports stdio can use:

- command: `omnifocus-mcp`
- args: `[]`
- cwd: `/path/to/OmnifocusMCP/python`

## Usage Examples

Once connected from your MCP client, try:

- `ping` to verify server health
- `get_inbox` to retrieve current inbox tasks
- `list_tasks` with filters such as `status="due_soon"` or date ranges (`added_after`, `added_before`, `changed_after`, `changed_before`)
- `create_task` to add an inbox or project task
- `project_planning` prompt to generate a structured plan from project state

Task payloads returned by read tools include:
- `addedDate` (task creation timestamp, ISO 8601 or `null`)
- `changedDate` (task last-modified timestamp, ISO 8601 or `null`; maps to OmniFocus `modified`)

## Development Checks

Run the Python checks:

```bash
cd python
ruff check src/
ruff format --check src/
mypy src/ --strict
pytest tests/ -v
```
