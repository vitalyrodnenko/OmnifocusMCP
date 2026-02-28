# development with docker

## important: docker is for development and ci only

Docker cannot run the OmniFocus MCP server itself because server runtime calls macOS `osascript` to automate OmniFocus. Containers do not have direct access to the host OmniFocus application or Apple Events permissions.

Use Docker for linting, type-checking, and mocked tests only.

## build the development image

From the repository root:

```bash
docker build -t omnifocus-mcp-dev .
```

The root `Dockerfile` installs:

- Node.js 20 + npm
- Python 3 + `uv`

## run checks inside the container

Mount the repository into `/workspace` and run the same checks used in local validation.

### python checks

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace omnifocus-mcp-dev \
  bash -lc "cd python && uv sync && ruff check src/ && mypy src/ --strict && pytest tests/ -v"
```

### typescript checks

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace omnifocus-mcp-dev \
  bash -lc "cd typescript && npm install && npx tsc --noEmit && npm test"
```

### combined check command

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace omnifocus-mcp-dev \
  bash -lc "cd python && uv sync && ruff check src/ && mypy src/ --strict && pytest tests/ -v && cd ../typescript && npm install && npx tsc --noEmit && npm test"
```

## ci example (github actions)

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: build dev image
        run: docker build -t omnifocus-mcp-dev .
      - name: run python checks
        run: docker run --rm -v "$PWD:/workspace" -w /workspace omnifocus-mcp-dev bash -lc "cd python && uv sync && ruff check src/ && mypy src/ --strict && pytest tests/ -v"
      - name: run typescript checks
        run: docker run --rm -v "$PWD:/workspace" -w /workspace omnifocus-mcp-dev bash -lc "cd typescript && npm install && npx tsc --noEmit && npm test"
```
