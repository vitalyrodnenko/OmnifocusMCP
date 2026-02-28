---
task: OmniFocus MCP — Full API parity (19 new tools across 3 implementations)
test_command: "cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v && cd ../typescript && npx tsc --noEmit && npm test && cd ../rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test"
---

# Task: Full OmniFocus API Parity

The MCP server currently exposes 20 tools but covers only ~50% of the
OmniFocus Omni Automation API surface. This task adds 19 new tools to
achieve full parity with every meaningful action a user can perform in
the OmniFocus UI.

**All three implementations** (Python, TypeScript, Rust) must be updated
for every tool. Tool names, input schemas, and response shapes must be
**identical** across all three. JXA scripts must be **character-identical**.

**Implementation order for each tool:** Python first (design the JXA),
then TypeScript (copy JXA), then Rust (copy JXA). This ensures parity.

Reference implementations:
- Python tools: `python/src/omnifocus_mcp/tools/*.py`
- TypeScript tools: `typescript/src/tools/*.ts`
- Rust tools: `rust/src/tools/*.rs`
- JXA rules: `.cursor/rules/jxa-scripting.mdc`

---

## New Tools Summary

### Task tools (5 new)
| Tool | API | Description |
|------|-----|-------------|
| `delete_tasks_batch` | `task.drop(false)` loop | batch-delete tasks (Rust only — already in Python/TS) |
| `uncomplete_task` | `task.markIncomplete()` | reopen a completed task |
| `create_subtask` | `new Task(name, parentTask.ending)` | create a task under another task |
| `list_subtasks` | `task.children` | list direct children of a task |
| `set_task_repetition` | `task.repetitionRule = ...` or `= null` | set or clear repeating schedule |

### Project tools (5 new)
| Tool | API | Description |
|------|-----|-------------|
| `uncomplete_project` | `project.markIncomplete()` | reopen a completed project |
| `update_project` | property setters | modify project name, note, dates, flags, tags, type |
| `set_project_status` | `project.status = Project.Status.X` | set Active, OnHold, or Dropped |
| `delete_project` | `deleteObject(project)` | permanently remove a project |
| `move_project` | `moveSections([project], folder)` | move project to a folder |

### Tag & Folder tools (6 new)
| Tool | API | Description |
|------|-----|-------------|
| `update_tag` | `tag.name`, `tag.status` | rename tag or change status |
| `delete_tag` | `deleteObject(tag)` | permanently remove a tag |
| `create_folder` | `new Folder(name, position)` | create a folder |
| `get_folder` | folder properties | get folder details with projects/subfolders |
| `update_folder` | `folder.name`, `folder.status` | rename folder or change status |
| `delete_folder` | `deleteObject(folder)` | permanently remove a folder |

### Utility tools (3 new)
| Tool | API | Description |
|------|-----|-------------|
| `append_to_note` | `task.appendStringToNote()` | append text to a task or project note |
| `search_projects` | `projectsMatching(search)` | fuzzy/smart search projects |
| `search_tags` | `tagsMatching(search)` | fuzzy/smart search tags |

---

## Phase 1 — Task Tools

### Success Criteria

1. [x] **`delete_tasks_batch` — Rust only.** Python and TypeScript already
       have this tool. Add to `rust/src/tools/tasks.rs`:
       - Function: `pub async fn delete_tasks_batch<R: JxaRunner>(runner: &R, task_ids: Vec<String>) -> Result<Value>`
       - JXA: character-identical to the Python version. Iterates IDs,
         drops found tasks, reports not-found for missing ones. Returns
         `{ deleted_count, not_found_count, results }`.
       - Validation: non-empty vec, each ID non-empty after trimming.
       - Register in `rust/src/server.rs` with `#[tool]` macro.
       - **Tool description MUST include:** "IMPORTANT: before calling
         this tool, always show the user the list of tasks to be deleted
         and ask for explicit confirmation. do not proceed without user
         approval."
       - Add tests in `rust/tests/tools_write_test.rs`: happy path,
         partial failure (some IDs not found), validation errors.
       - `cargo fmt --check && cargo clippy -- -D warnings && cargo test` pass.

2. [x] **`uncomplete_task`** — all 3 implementations.
       - **Input:** `task_id: str` (non-empty)
       - **JXA:** find task by ID, call `task.markIncomplete()`, return
         `{ id, name, completed: task.completed }`.
       - **Error:** throw if task not found. Throw if task is not
         currently completed (check `task.completed` first).
       - **Python:** add to `python/src/omnifocus_mcp/tools/tasks.py`,
         add test in `python/tests/test_tools_write.py`.
       - **TypeScript:** add to `typescript/src/tools/tasks.ts`,
         add test in corresponding test file.
       - **Rust:** add to `rust/src/tools/tasks.rs`, register in
         `server.rs`, add test in `rust/tests/tools_write_test.rs`.
       - All lint/test commands pass for all 3 implementations.

3. [x] **`create_subtask`** — all 3 implementations.
       - **Input:** `name: str` (required, non-empty),
         `parent_task_id: str` (required, non-empty),
         plus same optional fields as `create_task`: `note`, `dueDate`,
         `deferDate`, `flagged`, `tags`, `estimatedMinutes`.
       - **JXA:** find parent task by ID
         (`document.flattenedTasks.find(...)`), error if not found,
         create `new Task(name, parentTask.ending)`, set optional fields.
         Return `{ id, name, parentTaskId, parentTaskName }`.
       - Implement and test in all 3 implementations.

4. [x] **`list_subtasks`** — all 3 implementations.
       - **Input:** `task_id: str` (non-empty), `limit: int = 100`
       - **JXA:** find task by ID, return `task.children` mapped to
         standard task summary objects (id, name, note, flagged,
         completed, dueDate, deferDate, tags, estimatedMinutes,
         hasChildren). Slice by limit.
       - **Error:** throw if task not found.
       - Implement and test in all 3 implementations.

5. [x] **`set_task_repetition`** — all 3 implementations.
       - **Input:** `task_id: str` (non-empty),
         `rule_string: str | null` (ICS RRULE string like "FREQ=WEEKLY"
         or null to clear repetition),
         `schedule_type: str = "regularly"` (one of: "regularly",
         "from_completion", "none")
       - **JXA:** find task by ID. If `rule_string` is null, set
         `task.repetitionRule = null`. Otherwise, map schedule_type to
         `Task.RepetitionScheduleType` enum and create
         `new Task.RepetitionRule(ruleString, null, scheduleType, null, false)`.
         Return `{ id, name, repetitionRule: task.repetitionRule ? task.repetitionRule.ruleString : null }`.
       - Implement and test in all 3 implementations.

6. [x] All lint and test commands pass for Phase 1:
       - `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v`
       - `cd typescript && npx tsc --noEmit && npm test`
       - `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test`

---

## Phase 2 — Project Tools

### Success Criteria

7. [x] **`uncomplete_project`** — all 3 implementations.
       - **Input:** `project_id_or_name: str` (non-empty)
       - **JXA:** find project by ID or name (same pattern as
         `complete_project`), call `project.markIncomplete()`, return
         `{ id, name, status: "active" }`.
       - **Error:** throw if project not found. Throw if project is
         not currently completed.
       - Implement and test in all 3 implementations.

8. [x] **`update_project`** — all 3 implementations.
       - **Input:** `project_id_or_name: str` (required, non-empty),
         plus optional fields: `name: str`, `note: str`,
         `dueDate: str` (ISO 8601), `deferDate: str` (ISO 8601),
         `flagged: bool`, `tags: list[str]` (replaces all tags),
         `sequential: bool`, `completedByChildren: bool`,
         `reviewInterval: str` (e.g. "2 weeks", "1 month" — parsed
         into steps + unit).
       - **JXA:** find project by ID or name. Apply only provided
         fields (same pattern as `update_task`). For tags, clear
         existing then add new (same as update_task). For
         reviewInterval, parse "N unit" format and set
         `project.reviewInterval = { steps: N, unit: unit }`.
         Return updated project summary.
       - Implement and test in all 3 implementations.

9. [x] **`set_project_status`** — all 3 implementations.
       - **Input:** `project_id_or_name: str` (non-empty),
         `status: str` (one of: "active", "on_hold", "dropped")
       - **JXA:** find project by ID or name. Map status string to
         `Project.Status.Active`, `Project.Status.OnHold`, or
         `Project.Status.Dropped`. Set `project.status = ...`.
         Return `{ id, name, status }`.
       - **Note:** this is distinct from `complete_project` (which
         calls `markComplete()`) and `uncomplete_project` (which calls
         `markIncomplete()`). This tool sets the organizational status.
       - Implement and test in all 3 implementations.

10. [x] **`delete_project`** — all 3 implementations.
        - **Input:** `project_id_or_name: str` (non-empty)
        - **JXA:** find project by ID or name. Record name and task
          count before deletion. Call `deleteObject(project)`. Return
          `{ id, name, deleted: true, taskCount }`.
        - **Tool description MUST include:** "IMPORTANT: this
          permanently removes the project and all its tasks from the
          database. before calling, show the user the project name and
          task count, and ask for explicit confirmation."
        - Implement and test in all 3 implementations.

11. [x] **`move_project`** — all 3 implementations.
        - **Input:** `project_id_or_name: str` (non-empty),
          `folder: str | null` (folder name; null moves to top level)
        - **JXA:** find project by ID or name. If folder is null, call
          `moveSections([project], library.ending)`. Otherwise find
          folder by name and call
          `moveSections([project], targetFolder.ending)`.
          Return `{ id, name, folderName }`.
        - Implement and test in all 3 implementations.

12. [x] All lint and test commands pass for Phase 2 (same as criterion 6).

---

## Phase 3 — Tag & Folder Tools

### Success Criteria

13. [x] **`update_tag`** — all 3 implementations.
        - **Input:** `tag_name_or_id: str` (non-empty),
          `name: str | null` (new name), `status: str | null`
          (one of: "active", "on_hold", "dropped")
        - **JXA:** find tag by name or ID
          (`document.flattenedTags.find(t => t.id.primaryKey === id || t.name === id)`).
          If name provided, set `tag.name`. If status provided, map to
          `Tag.Status.Active/OnHold/Dropped` and set `tag.status`.
          Return `{ id, name, status }`.
        - Implement and test in all 3 implementations.

14. [x] **`delete_tag`** — all 3 implementations.
        - **Input:** `tag_name_or_id: str` (non-empty)
        - **JXA:** find tag by name or ID. Record name and task count
          (`tag.tasks.length`). Call `deleteObject(tag)`. Return
          `{ id, name, deleted: true, taskCount }`.
        - **Tool description:** include warning that tasks using this
          tag will lose the tag assignment.
        - Implement and test in all 3 implementations.

15. [x] **`create_folder`** — all 3 implementations.
        - **Input:** `name: str` (required, non-empty),
          `parent: str | null` (parent folder name)
        - **JXA:** if parent is null, `new Folder(name)`. Otherwise
          find parent folder by name and
          `new Folder(name, parentFolder.ending)`.
          Return `{ id, name }`.
        - Implement and test in all 3 implementations.

16. [x] **`get_folder`** — all 3 implementations.
        - **Input:** `folder_name_or_id: str` (non-empty)
        - **JXA:** find folder by name or ID. Return
          `{ id, name, status, parentName,
            projects: [{ id, name, status }],
            subfolders: [{ id, name }] }`.
          Projects and subfolders are direct children only.
        - Implement and test in all 3 implementations.

17. [x] **`update_folder`** — all 3 implementations.
        - **Input:** `folder_name_or_id: str` (non-empty),
          `name: str | null` (new name),
          `status: str | null` (one of: "active", "dropped")
        - **JXA:** find folder by name or ID. Apply provided fields.
          Map status to `Folder.Status.Active/Dropped`.
          Return `{ id, name, status }`.
        - Implement and test in all 3 implementations.

18. [x] **`delete_folder`** — all 3 implementations.
        - **Input:** `folder_name_or_id: str` (non-empty)
        - **JXA:** find folder by name or ID. Record name, project
          count, subfolder count. Call `deleteObject(folder)`. Return
          `{ id, name, deleted: true, projectCount, subfolderCount }`.
        - **Tool description:** include warning that contained projects
          will be moved to the top level (verify this behavior) or
          deleted (verify which OmniFocus does).
        - Implement and test in all 3 implementations.

19. [x] All lint and test commands pass for Phase 3 (same as criterion 6).

---

## Phase 4 — Utility Tools

### Success Criteria

20. [ ] **`append_to_note`** — all 3 implementations.
        - **Input:** `object_type: str` (one of: "task", "project"),
          `object_id: str` (non-empty), `text: str` (non-empty)
        - **JXA:** find the task or project by ID. Call
          `obj.appendStringToNote(text)`. Return
          `{ id, name, type, noteLength: obj.note.length }`.
        - Implement and test in all 3 implementations.

21. [ ] **`search_projects`** — all 3 implementations.
        - **Input:** `query: str` (non-empty), `limit: int = 100`
        - **JXA:** call `projectsMatching(query).slice(0, limit)`.
          Map results to project summaries (id, name, status,
          folderName). Return the array.
        - Implement and test in all 3 implementations.

22. [ ] **`search_tags`** — all 3 implementations.
        - **Input:** `query: str` (non-empty), `limit: int = 100`
        - **JXA:** call `tagsMatching(query).slice(0, limit)`.
          Map results to tag summaries (id, name, status, parent).
          Return the array.
        - Implement and test in all 3 implementations.

23. [ ] All lint and test commands pass for Phase 4 (same as criterion 6).

---

## Phase 5 — Integration & Smoke Test

### Success Criteria

24. [ ] Update `rust/examples/smoke_test.rs` to exercise all new tools:
        - `uncomplete_task`: create → complete → uncomplete → verify
        - `create_subtask` + `list_subtasks`: create parent → create
          subtask → list → verify
        - `set_task_repetition`: create task → set weekly → verify →
          clear → verify
        - `uncomplete_project`: create → complete → uncomplete → verify
        - `update_project`: create → update name/note → verify
        - `set_project_status`: create → set on_hold → verify → set
          active → verify
        - `delete_project`: create → delete → verify gone
        - `move_project`: create → create folder → move → verify
        - Tag/folder CRUD: create → update → get → delete
        - `append_to_note`: create task → append → verify note
        - `search_projects` / `search_tags`: call with known name
        - `delete_tasks_batch`: create 3 tasks → batch delete → verify
        - Clean up all test data.

25. [ ] Run smoke test against real OmniFocus — zero failures.
        Fix any bugs discovered before proceeding.

26. [ ] Verify tool parity across all 3 implementations:
        - Same tool names
        - Same input parameter names and types
        - Same response shapes
        - Character-identical JXA scripts

---

## Phase 6 — Documentation

### Success Criteria

27. [ ] Update top-level `README.md`:
        - Update tool count (from 20 to ~39)
        - Add all new tools to the tool list table
        - Note API parity achievement

28. [ ] Update `rust/README.md` if it has a separate tool listing.

29. [ ] Update `docs/install-rust.md` if it references tool counts.

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. Run the phase-appropriate test command after every code change
4. **Implementation order for each tool:** Python → TypeScript → Rust.
   Write the JXA script in Python first, then copy it character-for-
   character to the other two.
5. **Read existing tool implementations** before writing new ones —
   follow the exact same patterns for validation, escaping, error
   handling, and response format.
6. **Tool descriptions** for destructive batch/delete operations MUST
   include user-approval language. Single-item deletes do not need it.
7. **Phase 5 requires real OmniFocus** — if not running or permission
   is denied, output: `<ralph>GUTTER</ralph>`
8. Commit changes after completing each phase.
9. When ALL criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
10. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
