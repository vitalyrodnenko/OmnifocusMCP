---
task: OmniFocus MCP — Superior read-side filtering, sorting, and aggregation
test_command: "cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v && cd ../typescript && npx tsc --noEmit && npm test && cd ../rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test"
---

# Task: Superior Read-Side Capabilities

The MCP server currently has powerful write-side tools but basic read-side
filtering. The `list_tasks` tool only supports project, tag (single),
flagged, and a limited status enum. There are no date range filters, no
multi-tag filtering, no sorting, no aggregate counts, and response objects
are missing fields like `completionDate` and `hasChildren`.

This makes LLM interactions clunky — to answer "what did I complete last
week?" the LLM must fetch ALL completed tasks and filter client-side.
To answer "what projects are stalled?" there is no way at all.

This task closes every read-side gap and goes beyond by adding sorting,
duration filtering, aggregate count tools, an enriched forecast, native
OmniFocus `taskStatus` and effective dates, planned date support,
notification management, and task duplication — achieving near-complete
OmniFocus Omni Automation API coverage.

**All three implementations** (Python, TypeScript, Rust) must be updated
for every change. Parameter names, types, and response shapes must be
**identical** across all three. JXA scripts must be **character-identical**.

**Implementation order:** Python first (design the JXA), then TypeScript
(copy JXA), then Rust (copy JXA).

**Critical rule:** all new parameters are OPTIONAL with sensible defaults.
Existing calls with no new parameters must produce identical results to
the current implementation. Zero breaking changes.

Reference implementations:
- Python tools: `python/src/omnifocus_mcp/tools/*.py`
- TypeScript tools: `typescript/src/tools/*.ts`
- Rust tools: `rust/src/tools/*.rs`
- JXA rules: `.cursor/rules/jxa-scripting.mdc`

---

## Enhancements Summary

### list_tasks enhancements
| New Parameter | Type | Description |
|---------------|------|-------------|
| `dueBefore` | `str \| null` (ISO 8601) | tasks with dueDate before this datetime |
| `dueAfter` | `str \| null` (ISO 8601) | tasks with dueDate after this datetime |
| `deferBefore` | `str \| null` (ISO 8601) | tasks with deferDate before this datetime |
| `deferAfter` | `str \| null` (ISO 8601) | tasks with deferDate after this datetime |
| `completedBefore` | `str \| null` (ISO 8601) | tasks completed before this datetime (auto-includes completed) |
| `completedAfter` | `str \| null` (ISO 8601) | tasks completed after this datetime (auto-includes completed) |
| `tags` | `list[str] \| null` | filter by multiple tags (replaces nothing — additive alongside existing `tag`) |
| `tagFilterMode` | `'any' \| 'all'` | when using `tags`, match any (OR) or all (AND); default `'any'` |
| `maxEstimatedMinutes` | `int \| null` | tasks with estimatedMinutes ≤ this value |
| `sortBy` | `str \| null` | one of: `dueDate`, `deferDate`, `name`, `completionDate`, `estimatedMinutes`, `project`, `flagged` |
| `sortOrder` | `'asc' \| 'desc'` | sort direction; default `'asc'` |

New response fields on every task object: `completionDate`, `hasChildren`

### list_projects enhancements
| New Parameter | Type | Description |
|---------------|------|-------------|
| `completedBefore` | `str \| null` (ISO 8601) | projects completed before this datetime |
| `completedAfter` | `str \| null` (ISO 8601) | projects completed after this datetime |
| `stalledOnly` | `bool` | if true, return only stalled projects (active, has tasks, no available next action) |
| `sortBy` | `str \| null` | one of: `name`, `dueDate`, `completionDate`, `taskCount` |
| `sortOrder` | `'asc' \| 'desc'` | sort direction; default `'asc'` |

New response fields on every project object: `completionDate`, `isStalled`, `nextTaskId`, `nextTaskName`

### get_project enhancements
New response fields: `completionDate`, `isStalled`, `nextTaskId`, `nextTaskName`, `completedTaskCount`, `availableTaskCount`

### New tools
| Tool | Description |
|------|-------------|
| `get_task_counts` | aggregate counts for any task filter combo — no listing |
| `get_project_counts` | aggregate counts for project statuses — no listing |
| `duplicate_task` | clone a task with all properties and children |

### Native OmniFocus property enhancements (all read tools)
| New Response Field | Type | Description |
|--------------------|------|-------------|
| `taskStatus` | `str` | native OmniFocus computed status: `available`, `blocked`, `next`, `due_soon`, `overdue`, `completed`, `dropped` |
| `effectiveDueDate` | `str \| null` (ISO 8601) | inherited due date from parent task or project |
| `effectiveDeferDate` | `str \| null` (ISO 8601) | inherited defer date from parent task or project |
| `effectiveFlagged` | `bool` | inherited flagged status from parent task or project |
| `modified` | `str \| null` (ISO 8601) | last-modified timestamp on any database object |

### Notifications support (new)
| Tool | Description |
|------|-------------|
| `add_notification` | add a date-based or due-relative notification to a task |
| `remove_notification` | remove a notification from a task |
| `list_notifications` | list active notifications on a task |

### get_inbox, search_tasks, list_tags, get_forecast enhancements
See individual phase criteria below.

---

## Phase 1 — Enhanced list_tasks

### Success Criteria

1. [x] **Add date range filter params to `list_tasks`** — all 3 implementations.
       - New optional params: `dueBefore`, `dueAfter`, `deferBefore`,
         `deferAfter`, `completedBefore`, `completedAfter` (all ISO 8601
         strings, all nullable).
       - **JXA logic:** parse each non-null date param with `new Date()`
         at the top of the filter. Inside the filter function:
         - `dueBefore`: `task.dueDate !== null && task.dueDate < dueBefore`
         - `dueAfter`: `task.dueDate !== null && task.dueDate > dueAfter`
         - `deferBefore`: `task.deferDate !== null && task.deferDate < deferBefore`
         - `deferAfter`: `task.deferDate !== null && task.deferDate > deferAfter`
         - `completedBefore`: `task.completionDate !== null && task.completionDate < completedBefore`
         - `completedAfter`: `task.completionDate !== null && task.completionDate > completedAfter`
       - **Auto-include completed:** when `completedBefore` or
         `completedAfter` is provided, the status filter should
         automatically include completed tasks (override status to
         treat completed tasks as eligible regardless of the `status`
         param value). If `status` is explicitly `"completed"`, no
         change. If `status` is `"available"` or another non-completed
         value AND a completion date filter is set, switch behavior to
         include completed tasks that match the completion date range.
       - **Validation:** each date string must be parseable; if
         `new Date(x)` returns NaN, return a clear error.
       - All new params default to null. Existing calls unchanged.
       - Add tests: date range happy path, invalid date string,
         completedAfter auto-includes completed tasks, combining
         date filters with existing project/tag/flagged filters.
       - All lint/test commands pass for all 3 implementations.

2. [x] **Add multi-tag filtering to `list_tasks`** — all 3 implementations.
       - New optional params: `tags: list[str] | null`,
         `tagFilterMode: str = "any"` (enum: `"any"`, `"all"`).
       - **Backward compatibility:** keep existing `tag` param (single
         string). If `tag` is provided, treat as `tags: [tag]`. If both
         `tag` and `tags` are provided, merge them (union). The `tag`
         param is a convenience alias; `tags` is the primary.
       - **JXA logic:**
         - `any` mode: `task.tags.some(t => tagNames.includes(t.name))`
         - `all` mode: `tagNames.every(tn => task.tags.some(t => t.name === tn))`
       - Add tests: single tag via `tags`, multiple tags any mode,
         multiple tags all mode, combining `tag` and `tags`, empty tags
         array ignored.
       - All lint/test commands pass.

3. [x] **Add duration filter to `list_tasks`** — all 3 implementations.
       - New optional param: `maxEstimatedMinutes: int | null`
       - **JXA logic:** `task.estimatedMinutes !== null && task.estimatedMinutes <= max`
         When this filter is active, tasks with null estimatedMinutes
         are excluded (we can't know if they fit the time budget).
       - Add tests: filter by 15 min, filter by 60 min, null
         estimatedMinutes excluded.
       - All lint/test commands pass.

4. [x] **Add sorting to `list_tasks`** — all 3 implementations.
       - New optional params: `sortBy: str | null` (enum: `"dueDate"`,
         `"deferDate"`, `"name"`, `"completionDate"`,
         `"estimatedMinutes"`, `"project"`, `"flagged"`),
         `sortOrder: str = "asc"` (enum: `"asc"`, `"desc"`).
       - **Auto-sort:** when `completedBefore` or `completedAfter` is
         provided and `sortBy` is null, auto-set `sortBy` to
         `"completionDate"` and `sortOrder` to `"desc"` (matching
         OmniFocus Completed perspective).
       - **JXA logic:** after filtering and before slicing, sort the
         array. For null-valued sort fields, push nulls to the end
         regardless of sort order. String comparison for `name` and
         `project` (case-insensitive). Boolean comparison for `flagged`
         (true before false in desc, after in asc).
       - **Important:** sorting happens BEFORE the `.slice(0, limit)`.
         This means sorting the potentially large filtered set. For
         performance, the sort must be in JXA (not post-hoc).
       - Add tests: sort by dueDate asc, sort by name desc, auto-sort
         on completion filters, nulls-last behavior.
       - All lint/test commands pass.

5. [x] **Add `completionDate` and `hasChildren` to list_tasks response** —
       all 3 implementations.
       - Add to the task object mapper in the JXA script:
         `completionDate: task.completionDate ? task.completionDate.toISOString() : null`
         `hasChildren: task.hasChildren`
       - These fields are added unconditionally to every task object in
         the list_tasks response.
       - `search_tasks` response must also get these two fields (same
         JXA mapper pattern).
       - Update tests to verify new fields are present in response.
       - All lint/test commands pass.

6. [x] All lint and test commands pass for Phase 1:
       - `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v`
       - `cd typescript && npx tsc --noEmit && npm test`
       - `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test`

---

## Phase 2 — Enhanced list_projects and get_project

### Success Criteria

7. [x] **Add stalled detection to `list_projects` and `get_project`** —
       all 3 implementations.
       - **New response fields on list_projects project objects:**
         `completionDate`, `isStalled`, `nextTaskId`, `nextTaskName`
       - **New response fields on get_project:**
         `completionDate`, `isStalled`, `nextTaskId`, `nextTaskName`,
         `completedTaskCount`, `availableTaskCount`
       - **isStalled logic in JXA:**
         ```
         const isStalled = normalizeProjectStatus(project) === "active"
           && project.flattenedTasks.some(t => !t.completed)
           && project.nextTask === null;
         ```
         `project.nextTask` is an Omni Automation property that returns
         the first available action (respects defer dates and sequential
         ordering). If null but there are remaining tasks, the project
         is stalled.
       - **nextTask fields:** if `project.nextTask` is not null:
         `nextTaskId: project.nextTask.id.primaryKey`,
         `nextTaskName: project.nextTask.name`. Otherwise both null.
       - **completionDate:** `project.completionDate ? project.completionDate.toISOString() : null`
       - **get_project additional counts:**
         `completedTaskCount: allProjectTasks.filter(t => t.completed).length`
         `availableTaskCount`: count of tasks where `!t.completed && (t.deferDate === null || t.deferDate <= new Date())`
       - Add tests for isStalled, nextTask, completionDate fields.
       - All lint/test commands pass.

8. [x] **Add completion date filters and sorting to `list_projects`** —
       all 3 implementations.
       - New optional params: `completedBefore: str | null`,
         `completedAfter: str | null` (ISO 8601).
       - When either is provided, automatically switch to include
         completed projects (same pattern as list_tasks criterion 1).
         Status filter should be set/overridden to `"completed"` when
         completion date filters are active.
       - New optional params: `sortBy: str | null` (enum: `"name"`,
         `"dueDate"`, `"completionDate"`, `"taskCount"`),
         `sortOrder: str = "asc"` (enum: `"asc"`, `"desc"`).
       - **Auto-sort:** when completion date filters are active and
         `sortBy` is null, auto-set `sortBy` to `"completionDate"`,
         `sortOrder` to `"desc"`.
       - New optional param: `stalledOnly: bool = false`. When true,
         filter to only stalled projects (isStalled === true). Implies
         active status.
       - **JXA logic:** completion date filter:
         `project.completionDate !== null && project.completionDate > completedAfter`
         (and similar for completedBefore). Sorting applied after
         filtering, before slicing.
       - Add tests: completedAfter filter, stalledOnly, sorting.
       - All lint/test commands pass.

9. [x] All lint and test commands pass for Phase 2 (same as criterion 6).

---

## Phase 3 — Enhanced get_inbox, list_tags, search_tasks

### Success Criteria

10. [x] **Add `completionDate` and `hasChildren` to `get_inbox` response** —
        all 3 implementations.
        - Same two fields added to the task object mapper in get_inbox
          JXA script.
        - All lint/test commands pass.

11. [x] **Add status filter and sorting to `list_tags`** —
        all 3 implementations.
        - New optional param: `statusFilter: str = "all"` (enum:
          `"active"`, `"on_hold"`, `"dropped"`, `"all"`). Default `"all"`
          preserves current behavior (return all tags).
        - New response field: `totalTaskCount` (count of ALL tasks
          assigned to this tag, including completed). The existing
          `availableTaskCount` only counts non-completed tasks.
        - New optional params: `sortBy: str | null` (enum: `"name"`,
          `"availableTaskCount"`, `"totalTaskCount"`),
          `sortOrder: str = "asc"`.
        - JXA: add status filter in the tag filter. Count total tasks
          per tag alongside available tasks. Sort after mapping.
        - Add tests: filter by active status, sort by name, sort by
          count desc, totalTaskCount field.
        - All lint/test commands pass.

12. [x] **Add filter params to `search_tasks`** — all 3 implementations.
        - Add same optional filter params as list_tasks: `project`,
          `tag`, `tags`, `tagFilterMode`, `flagged`, `status`,
          `dueBefore`, `dueAfter`, `deferBefore`, `deferAfter`,
          `completedBefore`, `completedAfter`, `maxEstimatedMinutes`,
          `sortBy`, `sortOrder`.
        - The search query filters by name/note text. The additional
          params further narrow results. This enables "search for X
          within project Y where flagged".
        - **JXA:** apply the text search filter first (name/note
          includes query), then apply all the same conditional filters
          from list_tasks. Reuse the exact same filter logic.
        - `completionDate` and `hasChildren` already added in
          criterion 5 above.
        - Add tests: search with project filter, search with date
          range, search with status filter.
        - All lint/test commands pass.

13. [x] All lint and test commands pass for Phase 3 (same as criterion 6).

---

## Phase 4 — Aggregate Count Tools

### Success Criteria

14. [x] **`get_task_counts`** — all 3 implementations (NEW TOOL).
        - **Input:** same filter params as the enhanced `list_tasks`:
          `project`, `tag`, `tags`, `tagFilterMode`, `flagged`,
          `dueBefore`, `dueAfter`, `deferBefore`, `deferAfter`,
          `completedBefore`, `completedAfter`, `maxEstimatedMinutes`.
          All optional. No `limit`, `sortBy`, `sortOrder` (not
          relevant for counts).
        - **Response:** `{ total, available, completed, overdue,
          dueSoon, flagged, deferred }` where:
          - `total`: all tasks matching the filters
          - `available`: not completed AND (no deferDate OR
            deferDate <= now)
          - `completed`: completed tasks matching filters
          - `overdue`: not completed AND dueDate < now
          - `dueSoon`: not completed AND dueDate between now and
            now + 7 days
          - `flagged`: flagged tasks matching filters
          - `deferred`: not completed AND deferDate > now
        - **JXA:** single pass over filtered tasks, incrementing
          counters. No `.map()`, no object creation — just counting.
        - **Tool description:** "get aggregate task counts for any
          filter combination without listing individual tasks. much
          faster than list_tasks for answering 'how many' questions."
        - Implement and test in all 3 implementations.

15. [x] **`get_project_counts`** — all 3 implementations (NEW TOOL).
        - **Input:** `folder: str | null` (optional folder filter)
        - **Response:** `{ total, active, onHold, completed, dropped,
          stalled }` where each is a count of projects in that state.
          `stalled` uses same logic as Phase 2 isStalled.
        - **JXA:** single pass over projects, incrementing counters.
        - **Tool description:** "get aggregate project counts by status
          without listing individual projects."
        - Implement and test in all 3 implementations.

16. [x] All lint and test commands pass for Phase 4 (same as criterion 6).

---

## Phase 5 — Enhanced get_forecast

### Success Criteria

17. [x] **Enrich `get_forecast` response** — all 3 implementations.
        - Add `completionDate` and `hasChildren` to all task summaries
          in the forecast response.
        - Add new section `deferred`: tasks where deferDate is in the
          future (deferDate > now). These are upcoming tasks that will
          become available. Slice by limit.
        - Add new section `dueThisWeek`: tasks due between end of
          today and 7 days from now (exclusive of dueToday and
          overdue). Slice by limit.
        - Add counts object: `{ overdueCount, dueTodayCount,
          flaggedCount, deferredCount, dueThisWeekCount }`. These
          are total counts (not limited by the slice), giving the LLM
          a summary even when individual lists are truncated.
        - **JXA:** compute all sections in a single pass where possible.
          The deferred section filters `openTasks` where
          `task.deferDate !== null && task.deferDate > now`.
          The dueThisWeek section filters where
          `task.dueDate !== null && task.dueDate >= endOfToday && task.dueDate < endOfWeek`.
        - Existing sections (overdue, dueToday, flagged) remain
          unchanged in behavior, just gain new response fields.
        - Add tests: deferred section present, dueThisWeek section
          present, counts object present.
        - All lint/test commands pass.

18. [x] All lint and test commands pass for Phase 5 (same as criterion 6).

---

## Phase 6 — Tests and Parity Verification

### Success Criteria

19. [x] **Verify parameter parity across all 3 implementations:**
        - For every enhanced tool (list_tasks, list_projects,
          get_project, get_inbox, list_tags, search_tasks,
          get_forecast) and new tool (get_task_counts,
          get_project_counts): verify identical param names, types,
          enum values, and defaults.
        - For every response object: verify identical field names
          and types.
        - Character-identical JXA scripts across implementations.
        - Document any unavoidable differences (e.g., type system
          syntax) and confirm they produce identical behavior.

20. [x] **Run full test suites for all 3 implementations — zero failures:**
        - `cd python && ruff check src/ && ruff format --check src/ && mypy src/ --strict && pytest tests/ -v`
        - `cd typescript && npx tsc --noEmit && npm test`
        - `cd rust && cargo fmt --check && cargo clippy -- -D warnings && cargo test`

---

## Phase 7 — Documentation

### Success Criteria

21. [ ] Update top-level `README.md`:
        - Add "Advanced Filtering" section listing all new params
          on list_tasks and list_projects.
        - Add "Aggregate Counts" section describing get_task_counts
          and get_project_counts.
        - Add example LLM queries that use the new capabilities:
          "what did I complete last week?", "what can I do in 15
          minutes?", "what projects are stalled?", "how many tasks
          are overdue?"
        - Update tool count if needed.

22. [ ] Update `rust/README.md` if it has a separate tool listing.

---

## Phase 8 — Native OmniFocus Properties and Effective Values

OmniFocus computes "effective" values for dates and flags that inherit
from parent tasks and projects. It also has a native `taskStatus` enum
that accounts for defer dates, sequential project ordering, and
completion state. Exposing these gives the LLM the same view of task
availability that OmniFocus shows in its UI.

### Success Criteria

23. [ ] **Add `taskStatus` to all task response objects** — all 3
        implementations.
        - New response field on every task object returned by
          `list_tasks`, `search_tasks`, `get_inbox`, `get_forecast`,
          `list_subtasks`, and `get_task`:
          `taskStatus: (() => { const s = String(task.taskStatus); if (s.includes("Available")) return "available"; if (s.includes("Blocked")) return "blocked"; if (s.includes("Next")) return "next"; if (s.includes("DueSoon")) return "due_soon"; if (s.includes("Overdue")) return "overdue"; if (s.includes("Completed")) return "completed"; if (s.includes("Dropped")) return "dropped"; return "unknown"; })()`
        - This is the **native** OmniFocus computed status. It differs
          from our `status` filter param (which is user-facing). The
          native status accounts for sequential project blocking,
          defer dates, and on-hold tags — things our simple filters
          cannot replicate.
        - Add tests verifying taskStatus field is present and is one
          of the expected enum values.
        - All lint/test commands pass.

24. [ ] **Add effective dates and flags to `get_task` response** — all 3
        implementations.
        - New response fields on `get_task` only (not on list tools,
          to avoid performance overhead on bulk queries):
          `effectiveDueDate: task.effectiveDueDate ? task.effectiveDueDate.toISOString() : null`
          `effectiveDeferDate: task.effectiveDeferDate ? task.effectiveDeferDate.toISOString() : null`
          `effectiveFlagged: task.effectiveFlagged`
        - These show the *inherited* values. A task inside a project
          with a due date will show the project's due date in
          `effectiveDueDate` even if the task's own `dueDate` is null.
        - Add tests verifying effective fields are present.
        - All lint/test commands pass.

25. [ ] **Add `modified` timestamp to `get_task` and `get_project`** —
        all 3 implementations.
        - New response field: `modified: task.modified ? task.modified.toISOString() : null`
        - Added to `get_task` and `get_project` responses only (not
          list tools — too expensive for bulk).
        - Enables "what did I change recently?" queries.
        - Add tests verifying modified field is present.
        - All lint/test commands pass.

26. [ ] **Add `plannedDate` support** — all 3 implementations.
        - New response field on `get_task`:
          `plannedDate: task.plannedDate ? task.plannedDate.toISOString() : null`
          `effectivePlannedDate: task.effectivePlannedDate ? task.effectivePlannedDate.toISOString() : null`
        - New response field on `list_tasks` and `search_tasks`:
          `plannedDate: task.plannedDate ? task.plannedDate.toISOString() : null`
        - New optional filter params on `list_tasks` and `search_tasks`:
          `plannedBefore: str | null` (ISO 8601),
          `plannedAfter: str | null` (ISO 8601).
        - **JXA logic:** same date range pattern as other date filters.
          `plannedDate` is available in OmniFocus 4.7+ — wrap access
          in a try/catch so older databases don't error. If the property
          doesn't exist, return null and skip filtering.
        - Add tests for plannedDate field and filter params.
        - All lint/test commands pass.

27. [ ] All lint and test commands pass for Phase 8 (same as criterion 6).

---

## Phase 9 — Notifications

OmniFocus supports date-based and due-relative notifications (reminders)
on tasks. These are the "remind me" alerts. Exposing them lets the LLM
set reminders without the user opening OmniFocus.

### Success Criteria

28. [ ] **`list_notifications`** — all 3 implementations (NEW TOOL).
        - **Input:** `task_id: str` (required, non-empty)
        - **JXA:** find task by ID. Return `task.notifications.map(n => ({
          id: n.id.primaryKey,
          kind: n.initialFireDate ? "absolute" : "relative",
          absoluteFireDate: n.initialFireDate ? n.initialFireDate.toISOString() : null,
          relativeFireOffset: n.initialFireDate ? null : n.relativeFireOffset,
          nextFireDate: n.nextFireDate ? n.nextFireDate.toISOString() : null,
          isSnoozed: n.isSnoozed
          }))`.
        - **Error:** throw if task not found.
        - Implement and test in all 3 implementations.

29. [ ] **`add_notification`** — all 3 implementations (NEW TOOL).
        - **Input:** `task_id: str` (required), plus ONE of:
          `absoluteDate: str` (ISO 8601 — fire at this exact time), OR
          `relativeOffset: number` (seconds before due date — negative
          means before, e.g. -3600 = 1 hour before due).
        - **Validation:** exactly one of `absoluteDate` or
          `relativeOffset` must be provided. If `relativeOffset` is
          used, the task must have an effectiveDueDate (error if not).
        - **JXA:**
          - Absolute: `task.addNotification(new Date(absoluteDate))`
          - Relative: `task.addNotification(relativeOffset)`
        - Return the created notification summary (same shape as
          list_notifications items).
        - Implement and test in all 3 implementations.

30. [ ] **`remove_notification`** — all 3 implementations (NEW TOOL).
        - **Input:** `task_id: str` (required), `notification_id: str`
          (required)
        - **JXA:** find task by ID. Find notification by ID in
          `task.notifications`. Call `task.removeNotification(notif)`.
          Return `{ taskId, notificationId, removed: true }`.
        - **Error:** throw if task or notification not found.
        - Implement and test in all 3 implementations.

31. [ ] All lint and test commands pass for Phase 9 (same as criterion 6).

---

## Phase 10 — Duplicate Task

### Success Criteria

32. [ ] **`duplicate_task`** — all 3 implementations (NEW TOOL).
        - **Input:** `task_id: str` (required, non-empty),
          `includeChildren: bool = true` (whether to clone subtasks)
        - **JXA:** find task by ID. Determine the insertion location
          (same parent container — containing project or inbox).
          Call `duplicateTasks([task], insertionLocation)`. The
          returned array contains the new cloned task. Return the
          new task's standard summary (id, name, note, flagged,
          dueDate, deferDate, tags, etc.).
        - If `includeChildren` is false, create a new task manually
          with the same properties but without children. If true,
          `duplicateTasks()` clones the full subtree by default.
        - **Tool description:** "duplicate a task with all its
          properties. if the task has subtasks, they are cloned too
          by default."
        - Implement and test in all 3 implementations.

33. [ ] All lint and test commands pass for Phase 10 (same as criterion 6).

---

## Phase 11 — Final Parity Verification and Documentation

### Success Criteria

34. [ ] **Verify all new fields and tools across all 3 implementations:**
        - taskStatus field present on all task response objects
        - effective dates on get_task
        - modified on get_task and get_project
        - plannedDate on list_tasks, search_tasks, get_task
        - Notification tools registered and working
        - duplicate_task registered and working
        - Character-identical JXA scripts

35. [ ] **Update top-level `README.md`:**
        - Add native taskStatus field to feature list
        - Add effective dates to feature list
        - Add notifications support section
        - Add duplicate_task to tool table
        - Add plannedDate to filtering documentation
        - Update total tool count

36. [ ] **Run full test suites — zero failures** (same as criterion 20).

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. Run the phase-appropriate test command after every code change
4. **Implementation order for each tool/enhancement:** Python →
   TypeScript → Rust. Write the JXA script in Python first, then
   copy it character-for-character to the other two.
5. **Read existing tool implementations** before modifying — follow
   the exact same patterns for validation, escaping, error handling,
   and response format.
6. **Zero breaking changes.** All new parameters must be optional with
   defaults that produce current behavior. Existing tool calls with
   no new parameters must return identical results.
7. **Keep the `tag` param** on list_tasks as a convenience alias.
   When `tag` is provided, treat as `tags: [tag]`. When both are
   provided, merge (union). The `tagFilterMode` applies to the
   merged set.
8. Commit changes after completing each phase.
9. When ALL criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
10. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
