# Ralph Guardrails (Signs)

> Lessons learned from past failures. READ THESE BEFORE ACTING.

## Core Signs

### Sign: Read Before Writing
- **Trigger**: Before modifying any file
- **Instruction**: Always read the existing file first
- **Added after**: Core principle

### Sign: Test After Changes
- **Trigger**: After any code change
- **Instruction**: Run tests to verify nothing broke
- **Added after**: Core principle

### Sign: Commit Checkpoints
- **Trigger**: Before risky changes
- **Instruction**: Commit current working state first
- **Added after**: Core principle

---

## Learned Signs

(Signs added from observed failures will appear below)

### Sign: Probe OmniJS Bridge Early
- **Trigger**: Before running full Phase 1 smoke validation
- **Instruction**: Run a minimal `evaluateJavaScript` probe first; if it hangs, stop and resolve Automation/bridge issues before broader checks
- **Added after**: `uv run python scripts/smoke_test.py` timed out on every OmniJS call while OmniFocus itself was running

### Sign: Validate OmniFocus JXA Verb Casing
- **Trigger**: If OmniJS bridge errors with "Message not understood (-1708)"
- **Instruction**: Verify `evaluateJavascript` casing in external JXA before debugging inner OmniJS scripts
- **Added after**: Bridge probe failed because `evaluateJavaScript` was not recognized by this OmniFocus JXA dictionary

### Sign: Confirm Destructive OmniJS API Signatures
- **Trigger**: Before marking task deletion flow complete
- **Instruction**: Verify destructive API method signatures (`drop`, etc.) against real OmniFocus and pass required arguments explicitly
- **Added after**: `task.drop()` failed at runtime requiring non-null `allOccurrences` argument

