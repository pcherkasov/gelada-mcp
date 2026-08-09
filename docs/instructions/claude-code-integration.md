# Gelada MCP: Claude Code Integration Guide (`CLAUDE.md`)

This guide provides system instructions, prompt rules, and `CLAUDE.md` snippets for integrating **Claude Code** with **Gelada MCP**.

---

## 1. Overview

When running Claude Code in a repository configured with Gelada MCP, Claude Code acts as the **Leader Agent**. It handles high-level user interaction, architecture design, and system planning, while offloading implementation tasks to local worker agents via MCP tool calls (`delegate_task`, `inspect_task`, `revise_task`, `discard_task`).

---

## 2. Recommended `CLAUDE.md` Integration Snippet

Include the following section in your project's `CLAUDE.md` or global Claude Code configuration:

```markdown
## Gelada MCP Task Delegation Rules

You have access to Gelada MCP tools (`delegate_task`, `inspect_task`, `revise_task`, `discard_task`) for task delegation to local background worker agents.

### When to Delegate
- Delegate routine coding tasks, unit test suite generation, DTO/Zod schema generation, and JSDoc documentation to `delegate_task`.
- Always set explicit `allowedPaths` (whitelisting target files) and `disallowedPaths` (protecting package.json, SECURITY.md).
- Always include machine-verifiable `verificationCommands` (e.g. `npm test tests/unit/foo.test.js`).

### Zero-Trust Verification Rules
- NEVER accept worker claims without independent verification.
- Always call `inspect_task(taskId, mode: "diff")` to inspect line-by-line patches before accepting work.
- Always call `inspect_task(taskId, mode: "verifications")` to verify test suite pass status.
- If test commands fail or code requires tweaks, call `revise_task` with specific failure logs.
- If task violates policy or requires aborting, call `discard_task`.
```

---

## 3. Tool Invocation Workflow for Claude Code

```
User Prompt -> Claude Code (Leader) 
                  │
                  ├── Evaluates Delegation Criteria (delegation-criteria.md)
                  │
                  ├── Constructs JSON Task Contract (contract-construction.md)
                  │
                  ├── Calls `delegate_task` tool
                  │
                  ├── Calls `inspect_task` (mode: "diff" & mode: "verifications")
                  │
                  ├── [Option A: Code Passed] -> Summarizes deliverable to User
                  ├── [Option B: Code Failed] -> Calls `revise_task` with feedback
                  └── [Option C: Policy/Fatal Error] -> Calls `discard_task`
```

---

## 4. Trigger Directives & Prompt Heuristics

Claude Code should trigger `delegate_task` automatically when receiving user requests matching these patterns:
- *"Write unit tests for..."*
- *"Generate DTOs / Zod schemas for..."*
- *"Add JSDoc documentation to..."*
- *"Refactor function X in file Y while keeping tests passing..."*
- *"Fix failing unit test in..."*
