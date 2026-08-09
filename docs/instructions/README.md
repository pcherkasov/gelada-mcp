# Gelada MCP: Leader Agent Guidelines & Delegation Framework

Welcome to the canonical instruction suite for **Leader Agents** (Claude Code, OpenAI Codex, Cursor, and custom orchestrators) integrating with **Gelada MCP**.

Gelada MCP is a Model Context Protocol server that enables Leader Agents to delegate coding tasks, refactoring, test generation, and documentation to local background worker agents executing inside isolated Git worktrees.

---

## 📚 Instruction Suite Overview

This directory (`docs/instructions/`) contains comprehensive guidelines, decision frameworks, contract specifications, and verification protocols for Leader Agents.

| Document | Description | Key Focus Areas |
| :--- | :--- | :--- |
| [**Delegation Criteria**](./delegation-criteria.md) | When and how to delegate tasks vs execute directly. | Decision matrix, task size heuristics, scope scoping rules, high-value delegation patterns. |
| [**Contract Construction**](./contract-construction.md) | How to construct deterministic, unambiguous task contracts. | Parameter specifications, explicit inputs/outputs, path boundary globs, verification command schemas. |
| [**Independent Verification**](./independent-verification.md) | Zero-trust protocol for inspecting and verifying worker deliverables. | `inspect_task` modes, diff inspection, 17 granular task states, `revise_task` feedback loops, `discard_task`. |
| [**Delegation Trade-offs**](./delegation-tradeoffs.md) | Performance, security, and context trade-offs of task delegation. | Latency vs. parallel execution, context window preservation, Git worktree isolation, security boundaries. |
| [**Claude Code Integration**](./claude-code-integration.md) | Direct prompt instructions and configuration for Claude Code (`CLAUDE.md`). | System prompt snippets, tool usage patterns, trigger heuristics. |
| [**Codex Integration**](./codex-integration.md) | Direct prompt instructions and configuration for OpenAI Codex / AGY CLI. | Custom system instructions, tool formatting, CLI integration rules. |

---

## 🛠 Gelada MCP Core Tools

Leader Agents interact with Gelada MCP through four core MCP tools:

```
                  +-----------------------------------+
                  |      1. delegate_task             |
                  |  - Spawn isolated Git worktree    |
                  |  - Pass contract & instructions   |
                  |  - Execute worker process         |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |      2. inspect_task              |
                  |  - Inspect summary / diff / logs  |
                  |  - Check test execution results   |
                  |  - Monitor 17 granular states     |
                  +-----------------------------------+
                                 /     \
                                /       \
                  (Changes Need Revision) (Changes Discarded / Violation)
                              /           \
                             v             v
       +--------------------------+   +--------------------------+
       | 3. revise_task           |   | 4. discard_task          |
       | - Send revision notes    |   | - Kill worker process    |
       | - Add acceptance criteria|   | - Remove worktree        |
       | - Re-run worker process  |   | - Retain logs (optional) |
       +--------------------------+   +--------------------------+
```

### Tool Reference Summary

1. **`delegate_task`**: Initiates a new delegated task.
   - Input: `repoPath`, `taskType`, `objective`, `context`, `acceptanceCriteria`, `allowedPaths`, `disallowedPaths`, `verificationCommands`, `modelProfile`, `timeoutSeconds`.
   - Behavior: Creates an isolated Git worktree, validates contracts/policies, strips sensitive credentials, spawns a worker process (`agy`), runs verification commands, and records outputs.

2. **`inspect_task`**: Queries task status, diffs, outputs, and logs.
   - Input: `taskId`, `mode` (`'summary'`, `'diff'`, `'files'`, `'verifications'`, `'logs'`, `'history'`).
   - Behavior: Provides non-destructive inspection of worker progress, raw patches, changed files, verification results, and state transitions.

3. **`revise_task`**: Sends feedback to revise an existing task deliverable.
   - Input: `taskId`, `revisionNotes`, `additionalCriteria`, `additionalVerificationCommands`.
   - Behavior: Re-executes the worker process inside the existing worktree with revision feedback, re-runs verification commands, and produces an updated patch.

4. **`discard_task`**: Cancels execution and cleans up worktree resources.
   - Input: `taskId`, `keepLogs` (boolean).
   - Behavior: Terminates any active worker process, removes the temporary Git worktree, transitions state to `DISCARDED`, and optionally retains artifact log bundles.

---

## 🔄 The 17 Granular Task States

Gelada MCP tracks task execution across 17 granular task states grouped into active, terminal, and failure categories:

```
  CREATED ──> VALIDATING ──> PREPARING ──> READY ──> RUNNING ──> COLLECTING ──> VERIFYING
                                                                                  │
             ┌──────────────────────────────┬─────────────────────────────────────┘
             │                              │
             v                              v
        COMPLETED                COMPLETED_WITH_WARNINGS
             │                              │
             └──────────────┬───────────────┘
                            v
                    REVISION_REQUIRED (via revise_task) ──> PREPARING ──> READY...
```

### State Classification Table

| State Category | Granular State | Description & Leader Action |
| :--- | :--- | :--- |
| **Progressive** | `CREATED` | Task registered in system registry. |
| | `VALIDATING` | Task contract parameters and security policies being verified. |
| | `PREPARING` | Isolated Git worktree being created and environment initialized. |
| | `READY` | Worktree prepared; worker agent about to spawn. |
| | `RUNNING` | Worker agent process currently executing in worktree. |
| | `COLLECTING` | Worker finished; changed files and git diff being collected. |
| | `VERIFYING` | Automated `verificationCommands` executing. |
| **Success** | `COMPLETED` | Task completed successfully with all verifications passed. |
| | `COMPLETED_WITH_WARNINGS` | Task completed, but non-critical verification warnings occurred. |
| **Iterative** | `REVISION_REQUIRED` | Task delivered, but Leader requested revisions via `revise_task`. |
| **Terminal Failures** | `FAILED_CONTRACT` | Invalid payload or missing required contract fields. Fix schema & re-delegate. |
| | `FAILED_WORKER` | Worker process exited with non-zero status or crashed. Check logs via `inspect_task`. |
| | `FAILED_POLICY` | Task violated path boundaries or executed forbidden shell commands. |
| | `FAILED_VERIFICATION` | Worker code generated, but `verificationCommands` failed test execution. |
| | `AUTH_REQUIRED` | Worker CLI requires authentication (e.g. `agy login`). Leader must alert user. |
| | `QUOTA_EXHAUSTED` | Worker model ran out of quota before doing any work. Nothing is wrong with the task — do not rewrite it. `errorDetails.recommendedAction` carries the reset window; re-delegate unchanged after it passes, or drop to a cheaper model profile. |
| | `CANCELLED` | Task aborted by user or system signal during execution. |
| | `DISCARDED` | Task discarded by Leader via `discard_task` and worktree cleaned up. |

---

## 🎯 Quick Start Checklist for Leader Agents

1. **Evaluate**: Is the task suitable for delegation? (Check [Delegation Criteria](./delegation-criteria.md)).
2. **Construct**: Build a clear, constrained task contract with explicit whitelisted paths and machine-verifiable test commands (Check [Contract Construction](./contract-construction.md)).
3. **Delegate**: Call `delegate_task` with your JSON contract.
4. **Inspect & Verify**: Use `inspect_task` with `mode: "diff"` and `mode: "verifications"`. Never accept deliverables blindly (Check [Independent Verification](./independent-verification.md)).
5. **Iterate or Finalize**: Use `revise_task` if tweaks are needed; use `discard_task` if worktree should be purged.
