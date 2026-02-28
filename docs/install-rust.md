# install rust implementation

## prerequisites

- macos with omnifocus installed
- omnifocus running when tools are used
- terminal/editor has macos automation permission for omnifocus
- rust toolchain (`rustc`, `cargo`) for source builds

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

use `omnifocus-mcp` when installed via homebrew. use an absolute binary path when running a source-built binary not on `PATH`.

### claude desktop

homebrew:

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

source build:

```json
{
  "mcpServers": {
    "omnifocus-rust": {
      "command": "/usr/local/bin/omnifocus-mcp",
      "args": []
    }
  }
}
```

### cursor

homebrew:

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

source build:

```json
{
  "mcpServers": {
    "omnifocus-rust": {
      "command": "/absolute/path/to/omnifocus-mcp",
      "args": []
    }
  }
}
```

### generic stdio client

homebrew:

```json
{
  "command": "omnifocus-mcp",
  "args": []
}
```

source build:

```json
{
  "command": "/absolute/path/to/omnifocus-mcp",
  "args": []
}
```

## troubleshooting

### omnifocus not running

open omnifocus, then retry.

### macos automation permission denied

go to system settings -> privacy & security -> automation and allow your terminal/editor to control omnifocus.

### rust version mismatch

update rust:

```bash
rustup update
```

### binary architecture mismatch (arm vs intel)

install the matching binary for your machine (`aarch64-apple-darwin` for apple silicon, `x86_64-apple-darwin` for intel) or build locally from source.

### macos gatekeeper blocked unsigned binary

for binaries downloaded outside homebrew:

```bash
xattr -cr /path/to/omnifocus-mcp
```

homebrew-installed binaries are not affected.
