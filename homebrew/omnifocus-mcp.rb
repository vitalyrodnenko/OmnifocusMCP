# homebrew formula template for omnifocus-mcp
#
# usage:
# 1. create a tap repo (e.g. github.com/vitalyrodnenko/homebrew-omnifocus-mcp)
# 2. copy this file into Formula/omnifocus-mcp.rb in that tap
# 3. replace version, urls, and sha256 values from a rust-v* release
# 4. run: brew tap vitalyrodnenko/omnifocus-mcp && brew install omnifocus-mcp

class OmnifocusMcp < Formula
  desc "Model Context Protocol server for OmniFocus"
  homepage "https://github.com/vitalyrodnenko/OmnifocusMCP"
  version "1.1.8"
  license "MIT"

  depends_on :macos

  on_arm do
    url "https://github.com/vitalyrodnenko/OmnifocusMCP/releases/download/rust-v1.1.8/omnifocus-mcp-1.1.8-aarch64-apple-darwin.tar.gz"
    sha256 "b1a63d68d29d3dde64ddfa806fae5e767332268b9131e0e023b0acfdc4971795"
  end

  on_intel do
    url "https://github.com/vitalyrodnenko/OmnifocusMCP/releases/download/rust-v1.1.8/omnifocus-mcp-1.1.8-x86_64-apple-darwin.tar.gz"
    sha256 "6ba56b2276f108e653b824cb5307da289e98597ffb6b7c997cafdb4b53338883"
  end

  def install
    bin.install "omnifocus-mcp"
  end

  test do
    assert_match "omnifocus-mcp", shell_output("#{bin}/omnifocus-mcp --version")
  end
end
