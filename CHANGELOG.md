# Changelog

All notable changes to this project are documented in this file.

## [1.1.9] - 2026-04-05

### Fixed
- Rust MCP server: `tags` on task and project write tools, and on `list_tasks` / `search_tasks` / `get_task_counts`, now deserialize from either a JSON array of strings or a single string containing a JSON array (e.g. `"[\"Quick\",\"Home\"]"`). This matches MCP clients that serialize all tool parameters as strings.

## [1.1.8] - 2026-04-04

### Fixed
- Rust MCP server: tool input JSON Schema now uses camelCase property names for task write tools (`dueDate`, `deferDate`, `estimatedMinutes`) consistent with Python and TypeScript, so `tags` is accepted as a JSON array and no longer fails MCP parameter deserialization (issue #7).

## [1.1.7] - 2026-03-15

### Fixed
- stabilized live integration behavior for task, project, tag, and folder workflows:
  - hierarchy-safe batch deletion now handles parent+child requests without false partial failures
  - status outputs are normalized to canonical values across tag/folder/project surfaces
  - natural-language aliases are accepted for key filters (`descending`, `due soon`, `on hold`, `AND`/`OR`)

## [1.1.6] - 2026-03-03

### Fixed
- added missing task sort fields in `list_tasks` and `search_tasks` across Python, TypeScript, and Rust:
  - canonical date fields: `addedDate`, `changedDate`, `plannedDate`
  - aliases accepted by clients/LLMs: `added`, `modified`, `planned`
- fixed a TypeScript `create_project` OmniJS script syntax bug that could fail with
  `Unexpected keyword 'catch'` during real integration calls
- updated Rust integration harness calls to match the current task API signature

### Validation
- re-ran real OmniFocus integration suites in Python, TypeScript, and Rust, plus Rust smoke test

## [1.1.5] - 2026-03-05

### Added
- support task date filters for creation/last-modified dates:
  - `added_after`, `added_before`
  - `changed_after`, `changed_before` (`changed` maps to OmniFocus `modified`)
- include `addedDate` and `changedDate` in task payloads returned by read tools

### Changed
- updated documentation in root, Python, TypeScript, and Rust READMEs to describe
  the new date filters and task date fields
- bumped Rust package metadata from `1.1.4` to `1.1.5`

## [1.1.4] - 2026-03-03

### Fixed
- perspective enumeration now includes built-in, custom, and document perspectives
  so completed and custom perspectives are returned correctly

### Added
- batch deletion tools for projects, tags, and folders with partial-success output:
  - `delete_projects_batch`
  - `delete_tags_batch`
  - `delete_folders_batch`
