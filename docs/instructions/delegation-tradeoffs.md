# Gelada MCP: Delegation Trade-offs, Performance & Security Boundaries

Task delegation provides massive benefits in context window preservation, code isolation, and parallel execution. However, delegation introduces system overhead, process startup latency, and structural boundaries that Leader Agents must evaluate.

This document details the quantitative trade-offs, security architecture, and performance characteristics of Gelada MCP delegation.

---

## 1. Performance & Overhead Breakdown

Delegating a task via `delegate_task` involves several operational stages. Understanding their latency costs enables Leader Agents to make optimal delegation decisions.

```
+------------------------------------------------------------------------------------+
|                         DELEGATION OVERHEAD TIMELINE                               |
+------------------------------------------------------------------------------------+
| 1. Contract & Policy Validation ─────────────────────────────> [ ~5ms - 15ms ]     |
| 2. Worktree Creation (git worktree add) ─────────────────────> [ ~100ms - 350ms ]  |
| 3. Environment Sanitization & Secret Stripping ──────────────> [ ~2ms - 5ms ]      |
| 4. Worker Process Spawn (agy CLI) ───────────────────────────> [ ~200ms - 500ms ]  |
| 5. Worker LLM Token Generation ──────────────────────────────> [ Task Dependent ]  |
| 6. Verification Execution (npm test / pytest) ───────────────> [ Test Dependent ]  |
| 7. Diff Collection & Artifact Saving ────────────────────────> [ ~50ms - 150ms ]   |
+------------------------------------------------------------------------------------+
  Total Fixed Setup Overhead: ~350ms - 1000ms
```

### Overhead Cost Components

1. **Worktree Spawn Latency (~100ms – 350ms)**: Creating an isolated Git worktree (`git worktree add .worktrees/task-...`) requires filesystem disk operations and Git ref updates.
2. **Worker CLI & Node.js Startup (~200ms – 500ms)**: Spawning the worker process (`agy`) requires Node.js runtime initialization and CLI argument parsing.
3. **Verification Command Overhead (Task Dependent)**: Automated test execution adds test-runner startup time (e.g. Jest, Vitest, PyTest).

---

## 2. Context Window Preservation vs Exhaustion

The primary economic and architectural advantage of delegating tasks is **Context Window Preservation**.

### The Context Exhaustion Problem
When a Leader Agent generates repetitive boilerplate code, unit test suites, or large DTO schemas directly:
- Hundreds or thousands of code lines enter the active prompt context.
- LLM attention window degraded by verbose syntax.
- Available context space for system architecture and user requirements shrinks rapidly.
- Token costs increase linearly with every subsequent conversation turn.

### Context Preservation via Gelada MCP
By delegating task execution:
- The Leader Agent passes a compact JSON task contract (~200 tokens).
- The worker agent generates code in an isolated sub-process.
- The Leader Agent receives a compact inspection summary or unified diff patch.
- **Context Preservation Ratio**: Up to **90-95% reduction** in tokens consumed by the Leader Agent for implementation details.

---

## 3. Latency vs Parallel Execution

| Execution Strategy | Latency Characteristic | Context Impact | Workspace Risk |
| :--- | :--- | :--- | :--- |
| **Direct Execution (Synchronous)** | Low setup latency (< 1s). Execution time equals token generation time. | High context window consumption. | High risk of dirty uncommitted workspace state. |
| **Gelada Delegation (Asynchronous)** | Fixed setup overhead (~500ms - 1s). Token generation offloaded to background worker. | Minimal context window consumption (~200 tokens). | Zero workspace risk. Worktree isolated until accepted. |
| **Parallel Delegation (Multi-Task)** | Multiple worker tasks spawned concurrently in distinct worktrees (`.worktrees/task-A`, `.worktrees/task-B`). | Zero cumulative context bloat across parallel tasks. | Completely isolated parallel worktrees. |

---

## 4. Security Boundaries & Threat Isolation

Gelada MCP enforces strict multi-layered security boundaries around delegated worker processes:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GELADA MCP SECURITY BOUNDARY                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Git Worktree Isolation                                                   │
│    • All worker edits isolated to .worktrees/task-...                       │
│    • Main workspace branch never mutated directly during execution          │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Environment Sanitization & Secret Stripping (R1 Integration)            │
│    Worker environment automatically stripped of sensitive keys:             │
│    • API Keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, STRIPE_*  │
│    • Cloud Keys: AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AZURE_*, GCP_*   │
│    • VCS/Auth: GITHUB_TOKEN, GH_TOKEN, GITLAB_TOKEN, NPM_TOKEN             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Path Policy Whitelisting & Blacklisting                                  │
│    • allowedPaths whitelist restricts editable file globs                   │
│    • disallowedPaths blacklist protects package.json, SECURITY.md, etc.     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Command Injection & Binary Sanitization                                  │
│    • verificationCommands checked for dangerous operators (&&, ;, |, $(..)) │
│    • Blocked binaries: sudo, rm, curl, wget, nc, chmod                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Security Guarantees:
- **Zero Secret Leakage**: Worker sub-processes cannot leak production API keys or cloud tokens because sensitive environment variables are automatically purged before process spawning.
- **Path Confinement**: Worker processes attempting to modify files outside `allowedPaths` or touch `disallowedPaths` are rejected by PolicyEngine validation.
- **Command Sanitization**: Verification shell execution blocks destructive binaries (`rm -rf`, `sudo`) and command substitution syntax.

---

## 5. Quantitative Cost-Benefit Decision Framework

Leader Agents should apply the following quantitative rules of thumb:

```
Delegation Benefit Score = (Preserved Context Tokens * Value Factor) - (Fixed Setup Overhead + Execution Latency)
```

### Delegation Rules of Thumb:

1. **Rule of 20 Lines**: If expected output is > 20 lines of code, **DELEGATE**.
2. **Rule of 30 Seconds**: If expected generation time is > 30 seconds, **DELEGATE**.
3. **Rule of Machine Verification**: If acceptance criteria can be verified by `npm test` or `tsc`, **DELEGATE**.
4. **Rule of Single Edit**: If the edit is a 1-3 line fix in a known file, **EXECUTE DIRECTLY**.
