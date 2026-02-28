# homebrew formula template for omnifocus-mcp releases
# usage:
# 1) create a tap repo like homebrew-omnifocus-mcp
# 2) copy this file into Formula/omnifocus-mcp.rb
# 3) replace version, url, and sha256 values from the rust release

class OmnifocusMcp < Formula
  desc "MCP server for OmniFocus"
  homepage "https://github.com/your-user/OmnifocusMCP"
  version "0.1.0"
  license "MIT"

  depends_on :macos

  on_arm do
    url "https://github.com/your-user/OmnifocusMCP/releases/download/rust-v0.1.0/omnifocus-mcp-0.1.0-aarch64-apple-darwin.tar.gz"
    sha256 "REPLACE_WITH_ARM64_SHA256"
  end

  on_intel do
    url "https://github.com/your-user/OmnifocusMCP/releases/download/rust-v0.1.0/omnifocus-mcp-0.1.0-x86_64-apple-darwin.tar.gz"
    sha256 "REPLACE_WITH_X86_64_SHA256"
  end

  def install
    bin.install "omnifocus-mcp"
  end

  test do
    assert_match "omnifocus-mcp", shell_output("#{bin}/omnifocus-mcp --version")
  end
end
# usage:
# - create a tap repository (for example: github.com/<user>/homebrew-omnifocus-mcp)
# - copy this formula into Formula/omnifocus-mcp.rb in that tap
# - update version, urls, and sha256 values from a rust-v* release
# - run: brew tap <user>/omnifocus-mcp && brew install omnifocus-mcp

class OmnifocusMcp < Formula
  desc "model context protocol server for omnifocus"
  homepage "https://github.com/<user>/omnifocusmcp"
  version "0.1.0"
  license "MIT"

  depends_on :macos

  on_arm do
    url "https://github.com/<user>/OmnifocusMCP/releases/download/rust-v0.1.0/omnifocus-mcp-0.1.0-aarch64-apple-darwin.tar.gz"
    sha256 "REPLACE_WITH_ARM_SHA256"
  end

  on_intel do
    url "https://github.com/<user>/OmnifocusMCP/releases/download/rust-v0.1.0/omnifocus-mcp-0.1.0-x86_64-apple-darwin.tar.gz"
    sha256 "REPLACE_WITH_INTEL_SHA256"
  end

  def install
    bin.install "omnifocus-mcp"
  end

  test do
    assert_match "omnifocus-mcp", shell_output("#{bin}/omnifocus-mcp --version")
  end
end
