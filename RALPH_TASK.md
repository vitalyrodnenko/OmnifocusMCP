---
task: OmniFocus MCP — fix perspective enumeration for custom/transient views
test_command: "cd python && pytest tests/test_tools_read.py -k perspectives && cd ../typescript && npm test -- tools-representative.test.ts && cd ../rust && cargo test tools_read_test"
---

# Task: fix perspectives listing parity (python/typescript/rust)

Address user-reported behavior where `list_perspectives` only returns the default
built-in set and misses user-created perspectives (and expected transient views like
Completed).

tracking issue: https://github.com/vitalyrodnenko/OmnifocusMCP/issues/1

Target outcome:
- custom perspectives are returned
- built-ins are still returned
- response shape remains unchanged: array of `{ id, name }`
- parity is preserved across Python, TypeScript, and Rust implementations

---

## Phase 1 — confirm and codify expected behavior

### success criteria

1. [x] confirm the current perspective sources used in:
      - `python/src/omnifocus_mcp/tools/perspectives.py`
      - `typescript/src/tools/perspectives.ts`
      - `rust/src/tools/perspectives.rs`

2. [x] document expected perspective sources for implementation:
      - `Perspective.BuiltIn.all`
      - `Perspective.Custom.all`
      - `document.perspectives` (when available)

implementation source contract (all runtimes must match):
- source order: built-ins first, then custom, then document-level perspectives
- dedupe key: stable perspective id
- null-safe source reads: treat missing/undefined sources as empty lists
- output contract unchanged: emit only `{ id, name }` objects after dedupe and `limit`

3. [x] preserve current tool contract:
      - tool name remains `list_perspectives`
      - input remains `limit` with existing validation behavior
      - output remains objects with `id` and `name` only

---

## Phase 2 — implement parity fix in all three runtimes

### success criteria

4. [x] update Python `list_perspectives` JXA/OmniJS script to include
      `Perspective.Custom.all` with defensive guards.

5. [x] update TypeScript `list_perspectives` script with identical behavior and
      matching source order/logic.

6. [x] update Rust `list_perspectives` script with identical behavior and matching
      source order/logic.

7. [x] keep dedupe behavior by stable identifier and preserve `limit` slicing.

8. [x] ensure null-safe/undefined-safe checks for all perspective sources to avoid
      runtime errors on environment/version differences.

---

## Phase 3 — tests and regression coverage

### success criteria

9. [x] Python tests assert updated script includes `Perspective.Custom.all` and
      still enforces limit slicing.

10. [x] TypeScript tests assert updated script includes `Perspective.Custom.all`
       and existing behavior remains intact.

11. [x] Rust tests assert updated script includes `Perspective.Custom.all`
       and existing behavior remains intact.

12. [x] no unrelated test behavior is changed.

---

## Phase 4 — validation and completion

### success criteria

13. [x] run targeted perspective tests using `test_command` from frontmatter.

14. [x] if targeted tests pass, run broader per-language checks as needed for
       confidence:
       - Python: `cd python && pytest tests/ -v`
       - TypeScript: `cd typescript && npm test`
       - Rust: `cd rust && cargo test`

15. [x] verify user-reported expectation:
       - custom perspectives can be listed
       - built-in perspectives remain listed
       - no response-shape changes

---

## Ralph instructions

1. work on the next incomplete criterion (marked `[ ]`)
2. check off completed criteria (change `[ ]` to `[x]`)
3. preserve strict behavior parity across python/typescript/rust
4. keep the change focused to perspective enumeration and related tests
5. read files before modifying and avoid unrelated refactors
6. when all criteria are `[x]`, output: `<ralph>COMPLETE</ralph>`
7. if blocked repeatedly on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
