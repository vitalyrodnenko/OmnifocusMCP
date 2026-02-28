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
