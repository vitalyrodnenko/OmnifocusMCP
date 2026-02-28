# Rust Installation Guide

## Preferred: Homebrew

```bash
brew tap user/omnifocus-mcp
brew install omnifocus-mcp
```

After install, verify:

```bash
omnifocus-mcp --version
```

## Build From Source

### Prerequisites

- macOS
- Rust toolchain (`rustc`, `cargo`)
- OmniFocus installed

### Build

```bash
git clone https://github.com/user/OmnifocusMCP.git
cd OmnifocusMCP/rust
cargo build --release
cp target/release/omnifocus-mcp /usr/local/bin/
```

Then verify:

```bash
omnifocus-mcp --version
```

## MCP Client Configuration

### Claude Desktop

Homebrew binary:

```json
{
  "mcpServers": {
    "omnifocus-rust": {
      "command": "omnifocus-mcp"
    }
  }
}
```

Source build binary:

```json
{
  "mcpServers": {
    "omnifocus-rust": {
      "command": "/usr/local/bin/omnifocus-mcp"
    }
  }
}
```

### Cursor

Homebrew binary:

```json
{
  "mcpServers": {
    "omnifocus-rust": {
      "command": "omnifocus-mcp"
    }
  }
}
```

Source build binary:

```json
{
  "mcpServers": {
    "omnifocus-rust": {
      "command": "/absolute/path/to/omnifocus-mcp"
    }
  }
}
```

### Generic stdio client

Homebrew binary:

```json
{
  "command": "omnifocus-mcp",
  "args": []
}
```

Source build binary:

```json
{
  "command": "/absolute/path/to/omnifocus-mcp",
  "args": []
}
```

## Troubleshooting

- OmniFocus not running: open OmniFocus, then retry the command.
- macOS Automation permission denied: grant Terminal/Cursor automation access in System Settings > Privacy & Security > Automation.
- Rust version mismatch: update with `rustup update`.
- Binary architecture mismatch: install the correct release artifact for `aarch64-apple-darwin` (Apple Silicon) or `x86_64-apple-darwin` (Intel).
- Gatekeeper blocked an unsigned binary: run `xattr -cr /path/to/omnifocus-mcp` for binaries downloaded outside Homebrew. Homebrew-installed binaries are not affected.
# install rust implementation

## prerequisites

- macos (arm64 or intel)
- omnifocus installed and running
- terminal has macos automation permission for omnifocus

## method 1: homebrew (recommended)

```bash
brew tap user/omnifocus-mcp
brew install omnifocus-mcp
```

verify:

```bash
omnifocus-mcp --version
```

## method 2: build from source

```bash
git clone https://github.com/user/OmnifocusMCP.git
cd OmnifocusMCP/rust
cargo build --release
cp target/release/omnifocus-mcp /usr/local/bin/
```

verify:

```bash
omnifocus-mcp --version
```

## mcp client configuration

### claude desktop

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

if installed from source and not on `PATH`, use the full binary path:

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "/absolute/path/to/omnifocus-mcp",
      "args": []
    }
  }
}
```

### cursor

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

### generic stdio client

- command: `omnifocus-mcp`
- args: none
- transport: stdio

## troubleshooting

### omnifocus is not running

open omnifocus and retry the command.

### macos automation permission denied

go to system settings -> privacy & security -> automation and allow your terminal app to control omnifocus.

### rust version mismatch

update toolchain:

```bash
rustup update
```

### binary architecture mismatch (arm vs intel)

install the matching binary for your mac architecture from the release assets or rebuild from source on your machine.

### gatekeeper blocked unsigned binary

for binaries downloaded outside homebrew:

```bash
xattr -cr /path/to/omnifocus-mcp
```

homebrew-installed binaries are not affected by this step.
