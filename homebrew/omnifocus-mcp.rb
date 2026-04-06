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
  version "1.1.9"
  license "MIT"

  depends_on :macos

  on_arm do
    url "https://github.com/vitalyrodnenko/OmnifocusMCP/releases/download/rust-v1.1.9/omnifocus-mcp-1.1.9-aarch64-apple-darwin.tar.gz"
    sha256 "4b877a25afa14f564266e753e2157f3f784e50b77d4884646d4d289abecda835"
  end

  on_intel do
    url "https://github.com/vitalyrodnenko/OmnifocusMCP/releases/download/rust-v1.1.9/omnifocus-mcp-1.1.9-x86_64-apple-darwin.tar.gz"
    sha256 "13aad38eb439920601252656f6aece8e6e1c09046ca341db60aa59ac70787e57"
  end

  def install
    bin.install "omnifocus-mcp"
  end

  test do
    assert_match "omnifocus-mcp", shell_output("#{bin}/omnifocus-mcp --version")
  end
end
