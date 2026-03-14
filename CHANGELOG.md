# Changelog

All notable changes to this project are documented in this file.

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
