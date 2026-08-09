# Gelada MCP: Delegation Criteria & Decision Framework

This document provides Leader Agents (Claude Code, OpenAI Codex, Cursor) with clear heuristics, decision matrices, and scoping rules for deciding **when to delegate** a task to a local Gelada MCP worker agent versus **when to execute directly** in the primary context.

---

## 1. Executive Summary & Core Principle

**Core Principle**: *Delegate tasks where worker process overhead and context-switching costs are outweighed by context window savings, isolation safety, and automated test verifiability.*

Delegating a task spawns a background worker process in an isolated Git worktree (`.worktrees/task-...`). While this provides total safety and context window savings, it introduces a small latency cost (~100-300ms for worktree creation plus worker startup).

---

## 2. Delegation Decision Matrix

Use the following matrix to decide whether to invoke `delegate_task` or handle the request directly in your main LLM execution loop:

| Criteria | Delegate to Worker Agent (`delegate_task`) | Execute Directly in Leader Agent |
| :--- | :--- | :--- |
| **Task Complexity** | Well-scoped, repetitive, boilerplate-heavy, or modular implementation. | Architectural design, cross-cutting multi-module refactoring, strategic planning. |
| | Examples: Writing unit tests, building DTOs/schemas, adding JSDoc comments, implementing standard CRUD endpoints. | Examples: Redesigning system architecture, introducing new frameworks, setting up CI/CD pipelines. |
| **Verifiability** | Machine-verifiable acceptance criteria (e.g. `npm test`, `pytest`, `cargo test`, `eslint`). | Subjective or visually-inspected tasks without automated test coverage. |
| **Code Volume** | > 20 lines of code or multi-file boilerplate generation. | < 5-10 lines of code or one-line bug fixes. |
| **Execution Time** | Estimated execution time > 30 seconds of token generation. | Quick edits taking < 5-10 seconds. |
| **Workspace Safety** | High risk of introducing uncommitted dirty state or experimental edits. | Safe, minimal edit to a single known line. |
| **Context Impact** | Large reference files or verbose schemas that would bloat the Leader context window. | Small context footprint already loaded in Leader context. |
| **Security & Secrets** | Public/standard source code execution without requiring sensitive credentials. | Tasks requiring production secrets, private API keys, or cloud access. |

---

## 3. Task Size & Complexity Heuristics

Leader Agents should evaluate candidate tasks using three quantitative heuristics:

### Heuristic 1: Token Overhead vs Context Saving (The 1:5 Rule)
- If delegating a task requires sending a 200-token prompt contract to save generating 1,000+ tokens of boilerplate output, **DELEGATE**.
- If the prompt instructions require 2,000 tokens of context to generate a 5-token fix, **EXECUTE DIRECTLY**.

### Heuristic 2: Execution Time Heuristic
- **< 10 seconds expected work**: Execute directly. Worktree setup and worker startup overhead (~1-2 seconds) negated by context switching.
- **10s – 5 minutes expected work**: Ideal delegation window. High context savings and full worktree safety.
- **> 5 minutes expected work**: Delegate with custom `timeoutSeconds` (e.g. `timeoutSeconds: 600`).

### Heuristic 3: The Isolation Threshold
- If failing execution could leave the primary repository in a broken compilation state, **DELEGATE**. Worktree isolation ensures that partial or buggy code remains trapped inside `.worktrees/task-...` until verified and accepted.

---

## 4. Scope Scoping Rules

When delegating tasks, Leader Agents must enforce strict scoping rules to guarantee deterministic execution and security:

### Rule 1: Atomic Responsibility
Each delegated task must have a single primary objective. Do not bundle unrelated refactoring, formatting, and feature development into one task.
- ❌ *Bad Objective*: "Refactor auth middleware, update user model, fix typos in docs, and rewrite tests."
- ✅ *Good Objective*: "Add unit test suite for JWT verification in `src/auth/jwt-verifier.ts` covering expired token edge cases."

### Rule 2: Explicit Whitelisting (`allowedPaths`)
Always restrict worker edits to explicit file paths or glob patterns:
- ✅ `allowedPaths: ["src/dto/*.ts", "tests/unit/dto/*.test.ts"]`
- Disallow editing configuration files, dependencies, or infrastructure code unless specifically requested.

### Rule 3: Defensive Blacklisting (`disallowedPaths`)
Protect system critical files from worker modification:
- Always include `disallowedPaths: ["package.json", "package-lock.json", "tsconfig.json", ".env", "SECURITY.md"]` unless dependency modification is the explicit objective.

---

## 5. High-Value Delegation Patterns

### Pattern A: Unit & Integration Test Generation
- **Why**: High volume, highly repetitive code with 100% machine-verifiable acceptance criteria (`npm test`).
- **Contract Example**:
  ```json
  {
    "taskType": "unit-test",
    "objective": "Generate unit test suite for src/utils/parser.ts focusing on edge cases: empty strings, null bytes, malformed JSON, and oversized buffers.",
    "allowedPaths": ["tests/unit/parser.test.ts"],
    "verificationCommands": ["npm test tests/unit/parser.test.ts"]
  }
  ```

### Pattern B: DTO & Schema Generation
- **Why**: Type definitions, Zod schemas, and data structures are verbose and consume context.
- **Contract Example**:
  ```json
  {
    "taskType": "dto-gen",
    "objective": "Create Zod validation schema and TypeScript type interfaces for UserRegistrationPayload based on context schema.",
    "allowedPaths": ["src/schemas/user-schema.ts"],
    "verificationCommands": ["npm run typecheck"]
  }
  ```

### Pattern C: Isolated Component Refactoring
- **Why**: Refactoring pure functions, utilities, or standalone modules with existing test suites guarantees safety.
- **Contract Example**:
  ```json
  {
    "taskType": "refactor",
    "objective": "Refactor src/services/calculator.ts to use ES2022 array methods while maintaining exact test coverage.",
    "allowedPaths": ["src/services/calculator.ts"],
    "verificationCommands": ["npm test tests/unit/calculator.test.ts"]
  }
  ```

### Pattern D: JSDoc & Documentation Generation
- **Why**: Adding inline JSDoc comments or generating markdown documentation is context-heavy but low risk.

---

## 6. Antipatterns: When NOT to Delegate

Leader Agents MUST NOT delegate under the following circumstances:

1. ❌ **Architectural Decision-Making**: Worker agents operate within local task context; they lack full workspace vision and project history.
2. ❌ **Credential/Secret Handling**: Workers run in sanitized environments where environment variables (`OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`) are automatically stripped for security.
3. ❌ **Cross-Repository Dependencies**: Gelada MCP operates within a single target repository worktree. Tasks requiring multi-repo orchestration must be managed directly by the Leader.
4. ❌ **Interactive Command Tasks**: Worker execution is non-interactive. Tasks requiring interactive CLI input (e.g. `npm init`, `git cz`, `ssh-keygen`) will hang or fail.
