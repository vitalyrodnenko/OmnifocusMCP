from pathlib import Path


def test_readme_contains_required_client_config_examples() -> None:
    readme_path = Path(__file__).resolve().parents[1] / "README.md"
    readme = readme_path.read_text(encoding="utf-8")

    assert '"command": "uv"' in readme
    assert '"args": ["run", "omnifocus-mcp"]' in readme
    assert '"command": "python"' in readme
    assert '"args": ["-m", "omnifocus_mcp"]' in readme
    assert "- command: `omnifocus-mcp`" in readme
    assert "- args: `[]`" in readme


def test_top_level_readme_documents_python_typescript_switching() -> None:
    readme_path = Path(__file__).resolve().parents[2] / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    lowered = readme.lower()

    assert "## mcp client config examples" in lowered
    assert "### switching between rust, python, and typescript" in lowered
    assert '"command": "uv"' in readme
    assert '"args": ["run", "omnifocus-mcp"]' in readme
    assert '"command": "python"' in readme
    assert '"args": ["-m", "omnifocus_mcp"]' in readme
    assert '"command": "node"' in readme
    assert '"args": ["dist/index.js"]' in readme
    assert '"cwd": "/absolute/path/to/OmnifocusMCP/typescript"' in readme
    assert "## switching implementations" in lowered
    assert "restart the mcp client so it reloads the server command" in lowered
