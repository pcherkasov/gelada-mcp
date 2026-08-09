# Gelada MCP: OpenAI Codex / AGY CLI Integration Guide

This guide provides guidelines and instruction templates for integrating **OpenAI Codex**, **AGY CLI**, and custom LLM orchestrators with **Gelada MCP**.

---

## 1. Overview

OpenAI Codex and custom AGY CLI orchestrators act as **Leader Agents** when connected to Gelada MCP over stdio transport. They use Gelada MCP tools (`delegate_task`, `inspect_task`, `revise_task`, `discard_task`) to delegate execution to sub-worker instances running inside isolated Git worktrees.

---

## 2. System Instructions for Codex / AGY Orchestrators

Add the following instructions to your system prompt or agent system role configuration:

```text
SYSTEM INSTRUCTION: GELADA MCP DELEGATION PROTOCOL

1. DELEGATION CRITERIA:
   - Offload repetitive code generation, unit test creation, schema definitions, and refactoring to `delegate_task`.
   - Execute small (< 5 line) or architectural decisions directly.

2. CONTRACT CONSTRUCTION:
   - Formulate unambiguous JSON contracts for `delegate_task`.
   - Specify `taskType` (unit-test | dto-gen | refactor | doc-gen | bug-fix).
   - Constrain file boundaries using `allowedPaths` (globs) and `disallowedPaths`.
   - Include non-interactive `verificationCommands` (e.g. ["npm test"]).

3. VERIFICATION PROTOCOL:
   - Do NOT assume task completion based on stdout messages.
   - Run `inspect_task` with `mode: "diff"` and `mode: "verifications"`.
   - Validate exit code 0 on all test commands.
   - If verifications fail, send structured logs via `revise_task`.
   - Call `discard_task` if task execution must be cancelled.
```

---

## 3. Handling Environment & Worker Executable Requirements

Codex and AGY orchestrators should verify system environment readiness using the Gelada CLI before initiating delegation:

```bash
# Verify system configuration, Git version, and worker CLI availability
gelada doctor
```

If `AGY_COMMAND` environment variable is set, Gelada MCP uses the custom worker binary specified (e.g. for offline mock testing or enterprise AGY CLI deployment).
