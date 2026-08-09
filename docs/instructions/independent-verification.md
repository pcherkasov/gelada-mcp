# Gelada MCP: Independent Verification & Zero-Trust Protocol

Leader Agents must maintain a **Zero-Trust Posture** regarding code deliverables produced by worker agents. Worker process output claims (e.g. stdout messages saying "All tasks completed successfully") MUST NOT be accepted without independent programmatic verification.

This document details the Zero-Trust Protocol, tool usage patterns for `inspect_task`, state transition monitoring across all 17 granular task states, and failure recovery workflows using `revise_task` and `discard_task`.

---

## 1. The Zero-Trust Verification Protocol

### Core Directives

1. **Rule 1: Worker Self-Reporting Is Inconclusive**
   Worker LLMs may report success even when code contains syntax errors, failed imports, or missing edge cases. Always inspect artifacts directly.
2. **Rule 2: Inspect Patch Diffs Before Acceptance**
   Always invoke `inspect_task(taskId, mode: "diff")` to inspect the exact line-by-line Git patch before incorporating worker changes into main codebase context or committing.
3. **Rule 3: Verify Automated Test Results**
   Inspect verification output via `inspect_task(taskId, mode: "verifications")`. Confirm that all verification commands returned exit code `0`.
4. **Rule 4: Scope Boundary Auditing**
   Verify via `inspect_task(taskId, mode: "files")` that changed files match `allowedPaths` and no unintended file modifications occurred.

---

## 2. Using `inspect_task` Modes

`inspect_task` provides six inspection modes to audit delegated tasks:

```
inspect_task({ taskId: "task-172221-a8f3b", mode: "<MODE>" })
```

| Inspection Mode | Output Data Provided | When to Use |
| :--- | :--- | :--- |
| `summary` (Default) | Overview of task status, granular state, timestamps, file count, error summaries. | Initial status check after delegation completes. |
| `diff` | Full unified Git patch (`git diff`) representing all edits made in worktree. | Essential code review step before accepting work. |
| `files` | Array of modified/created/deleted file paths. | Verifying path policy adherence and file scope. |
| `verifications` | Output logs, exit codes, and durations of all `verificationCommands`. | Confirming unit tests and type checks passed. |
| `logs` | Worker agent stdout and stderr execution logs. | Debugging worker crashes (`FAILED_WORKER`) or prompt misunderstandings. |
| `history` | Complete timeline of state transitions with timestamps and reasons. | Auditing task execution lifecycle and latency. |

---

## 3. Handling 17 Granular Task States

When inspecting task state via `inspect_task` or handling tool responses, Leader Agents will encounter one of 17 granular task states.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            17 GRANULAR TASK STATES                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ Progressive States:                                                         │
│   CREATED ──> VALIDATING ──> PREPARING ──> READY ──> RUNNING                │
│                                                          │                  │
│                                            COLLECTING <──┴── VERIFYING      │
├─────────────────────────────────────────────────────────────────────────────┤
│ Terminal Success States:                                                    │
│   • COMPLETED                  • COMPLETED_WITH_WARNINGS                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ Iterative State:                                                            │
│   • REVISION_REQUIRED (Active worktree retained for revise_task)            │
├─────────────────────────────────────────────────────────────────────────────┤
│ Terminal Failure States:                                                    │
│   • FAILED_CONTRACT            • FAILED_WORKER         • FAILED_POLICY      │
│   • FAILED_VERIFICATION        • AUTH_REQUIRED         • CANCELLED          │
│   • QUOTA_EXHAUSTED                                                         │
│   • DISCARDED                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Action Matrix for Granular States

| Granular State | State Type | Diagnostic & Leader Action Protocol |
| :--- | :--- | :--- |
| `CREATED` | Progressive | Task registered in task registry. Wait or continue monitoring. |
| `VALIDATING` | Progressive | Payload contract being validated. |
| `PREPARING` | Progressive | Git worktree being created and initialized. |
| `READY` | Progressive | Worktree ready; worker driver spawning executable process. |
| `RUNNING` | Progressive | Worker process active in worktree. Wait for completion notification. |
| `COLLECTING` | Progressive | Worker finished; diffs and file lists being collected from worktree. |
| `VERIFYING` | Progressive | `verificationCommands` executing inside worktree. |
| `COMPLETED` | Success | All verifications passed (exit code 0). Inspect diff (`mode: "diff"`) and finalize. |
| `COMPLETED_WITH_WARNINGS` | Success | Task finished, but non-critical verification warnings occurred. Review `verifications` logs. |
| `REVISION_REQUIRED` | Iterative | Revisions requested via `revise_task`. Worktree preserved for iterative edits. |
| `FAILED_CONTRACT` | Failure | Contract validation failed (e.g. missing `objective`). Correct payload and re-delegate. |
| `FAILED_WORKER` | Failure | Worker CLI crashed or exited non-zero. Call `inspect_task(mode: "logs")` to diagnose. |
| `FAILED_POLICY` | Failure | Policy violation (tried editing forbidden paths or banned commands). Revise allowed paths. |
| `FAILED_VERIFICATION` | Failure | Worker executed, but test command failed. Use `revise_task` to send failure logs back to worker. |
| `AUTH_REQUIRED` | Failure | Worker CLI requires auth (e.g. `agy login`). Alert human user to authenticate. |
| `QUOTA_EXHAUSTED` | Failure | Worker model quota ran out; the task was never attempted. Wait for the reset window in `errorDetails.recommendedAction`, then re-delegate unchanged. Do not treat as a task defect. |
| `CANCELLED` | Terminal | Task cancelled during execution via signal or system shutdown. Re-delegate if required. |
| `DISCARDED` | Terminal | Task discarded via `discard_task`. Worktree purged. No further action needed. |

---

## 4. Iterative Revision Protocol (`revise_task`)

When worker code fails verifications (`FAILED_VERIFICATION`), contains minor bugs, or omits requested edge cases, Leader Agents should invoke `revise_task` instead of delegating a new task from scratch.

### Advantages of `revise_task`:
1. **Preserves Worktree State**: Edits build incrementally on top of the worker's prior changes.
2. **Context Continuity**: The worker process receives the prior patch diff alongside your revision notes.
3. **Efficiency**: Avoids re-creating worktrees and re-installing dependencies.

### `revise_task` Input Schema:
```json
{
  "taskId": "task-172221-a8f3b",
  "revisionNotes": "The unit test test_parse_invalid_iso_string failed because date-formatter returned null instead of throwing InvalidDateError. Update src/utils/date-formatter.ts to throw InvalidDateError on bad date format.",
  "additionalCriteria": [
    "Must throw InvalidDateError on malformed ISO strings"
  ],
  "additionalVerificationCommands": [
    "npm test tests/unit/date-formatter.test.ts"
  ]
}
```

### Revision Loop Rules:
- Limit revision attempts to **3 iterations max**. If the worker fails after 3 revisions, discard the task and handle directly or re-frame the objective.
- Always include specific error output snippets from `inspect_task(mode: "verifications")` inside `revisionNotes`.

---

## 5. Cancellation & Cleanup Protocol (`discard_task`)

When a task enters an unrecoverable failure state, violates policies, or is no longer needed, Leader Agents must call `discard_task`.

### `discard_task` Input Schema:
```json
{
  "taskId": "task-172221-a8f3b",
  "keepLogs": true
}
```

### Discard Protocol Actions:
1. **Terminates Running Processes**: Kills worker process (`agy`) if still running (`CANCELLED` state).
2. **Purges Temporary Worktrees**: Removes `.worktrees/task-...` Git worktree cleanly, preventing directory clutter.
3. **Log Retention (`keepLogs`)**:
   - `keepLogs: false` (Default): Cleans up all artifacts and logs.
   - `keepLogs: true`: Retains `.gelada/artifacts/task-...` metadata and logs for debugging while purging worktree code.

---

## 6. Zero-Trust Verification Checklist

Before accepting code from a completed task (`COMPLETED` or `COMPLETED_WITH_WARNINGS`):

- [ ] 1. Run `inspect_task(taskId, mode: "summary")` -> Confirm status is `COMPLETED`.
- [ ] 2. Run `inspect_task(taskId, mode: "files")` -> Confirm all modified files fall within whitelist boundaries.
- [ ] 3. Run `inspect_task(taskId, mode: "verifications")` -> Confirm test commands returned exit code `0`.
- [ ] 4. Run `inspect_task(taskId, mode: "diff")` -> Review line changes for code quality, formatting, and safety.
- [ ] 5. If any step fails -> Call `revise_task` with specific failure feedback, or call `discard_task`.
