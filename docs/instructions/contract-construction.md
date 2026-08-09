# Gelada MCP: Contract Construction Guidelines

Task contracts in Gelada MCP define the formal specification sent to local worker agents via `delegate_task`. Constructing clear, deterministic, and bounded contracts is essential for worker success, policy compliance, and automated verification.

---

## 1. Task Contract JSON Schema Reference

A complete `delegate_task` payload accepts the following fields:

```json
{
  "repoPath": "/path/to/target/repository",
  "taskType": "unit-test",
  "objective": "Detailed, atomic single-responsibility objective statement.",
  "context": "Background code snippets, interface definitions, or design constraints.",
  "acceptanceCriteria": [
    "Must cover zero-length array input",
    "Must export named function parseString()"
  ],
  "allowedPaths": [
    "src/modules/parser.ts",
    "tests/unit/parser.test.ts"
  ],
  "disallowedPaths": [
    "package.json",
    "tsconfig.json"
  ],
  "verificationCommands": [
    "npm test tests/unit/parser.test.ts",
    "npm run typecheck"
  ],
  "modelProfile": "fast",
  "timeoutSeconds": 300
}
```

### Parameter Specification Table

| Field Name | Type | Required? | Description & Rules |
| :--- | :--- | :--- | :--- |
| `repoPath` | `string` | Optional | Absolute path to target Git repository. Defaults to MCP server current working directory if omitted. |
| `taskType` | `string` | **Required** | Standardized task type classification: `unit-test`, `refactor`, `dto-gen`, `doc-gen`, `bug-fix`, `feature`, `generic`. |
| `objective` | `string` | **Required** | Atomic, explicit description of expected work. Must specify input files, target modifications, and expected behavior. |
| `context` | `string` | Optional | Supporting context: existing source code snippets, TypeScript interfaces, sample data, or style rules. |
| `acceptanceCriteria` | `string[]` | Optional | Human-readable assertions describing target deliverables. |
| `allowedPaths` | `string[]` | Recommended | Whitelist of glob patterns or exact file paths worker agent is permitted to edit. |
| `disallowedPaths` | `string[]` | Recommended | Blacklist of glob patterns or exact file paths worker agent is strictly forbidden from editing. |
| `verificationCommands` | `string[]` | Recommended | Non-interactive shell commands executed automatically during `VERIFYING` state to validate code deliverables. |
| `modelProfile` | `string` | Optional | Specific model tier or profile for worker agent (e.g. `'fast'`, `'standard'`, `'thorough'`). |
| `timeoutSeconds` | `number` | Optional | Maximum execution timeout in seconds before worker process is terminated. Defaults to policy limit (e.g. 300s). |

---

## 2. Defining Explicit Inputs & Outputs

Worker agents operate inside isolated worktrees without access to your active conversation window. Therefore, your `objective` and `context` fields must be **self-contained**.

### The 4-Part Objective Structure

A well-constructed `objective` MUST contain four components:
1. **Target Input Files**: Exactly which file(s) the worker must inspect.
2. **Action / Transformation**: What modifications to perform.
3. **Output File Location**: The exact file path(s) to create or edit.
4. **Behavioral Constraints**: Formatting rules, export names, or edge cases.

#### Example Objective:
> *"Inspect `src/types/user.ts`. Create a new file `src/schemas/user-validator.ts` that exports a Zod schema `userRegistrationSchema` matching `User` interface properties. Validate email formats and enforce password length >= 8 characters. Do not modify existing type files."*

---

## 3. Scope Boundaries & Path Policies

Path boundary rules are enforced by Gelada MCP's `PolicyEngine` at both initialization and diff collection stages.

### Whitelist Globs (`allowedPaths`)
- Precedence: Whitelists restrict worker file modifications exclusively to matched paths.
- Globs supported: Standard glob syntax (`src/**/*.ts`, `tests/unit/*.test.js`, `docs/*.md`).
- Best Practice: Explicitly list both target source files AND target test files.

### Blacklist Globs (`disallowedPaths`)
- Precedence: Blacklists supersede whitelists. If a file matches any pattern in `disallowedPaths`, worker edits will fail policy validation with `FAILED_POLICY`.
- Default Protected Targets:
  - Repository configs: `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`
  - Policy & security: `.gelada/policy.yaml`, `SECURITY.md`
  - Environment files: `.env`, `.env.*`

---

## 4. Acceptance Criteria & Verification Commands Schemas

`verificationCommands` are executed sequentially by Gelada MCP after worker code generation completes (in the `VERIFYING` stage).

### Verification Command Rules
1. **Must Be Non-Interactive**: Commands requiring stdin prompts will cause timeouts.
2. **Must Fail Fast with Non-Zero Exit Code**: Gelada MCP inspects command exit code `0` (success) vs non-zero (failure).
3. **Must Target Isolated Test Suites**: Avoid running full full-suite test suites if the worker only modified a single component.

#### ✅ Recommended Command Patterns:
- `npm test tests/unit/specific-module.test.js`
- `npx tsc --noEmit src/schemas/user-validator.ts`
- `npx eslint src/components/button.tsx`
- `pytest tests/unit/test_parser.py`
- `cargo test --test parser_test`

#### ❌ Dangerous / Invalid Command Patterns:
- `npm test` (running full test suite taking 10 minutes)
- `git commit -m "done"` (interferes with Gelada worktree git management)
- `sudo rm -rf node_modules` (blocked by command sanitization security rules)
- `curl http://external-api.com` (network execution risk)

---

## 5. Exemplar Contracts for Common Task Types

### Task Type 1: `unit-test`
```json
{
  "repoPath": "/Users/developer/projects/my-app",
  "taskType": "unit-test",
  "objective": "Implement unit tests for src/utils/date-formatter.ts covering ISO string parsing, leap years, and invalid date handling.",
  "allowedPaths": ["tests/unit/date-formatter.test.ts"],
  "disallowedPaths": ["package.json", "tsconfig.json"],
  "verificationCommands": ["npm test tests/unit/date-formatter.test.ts"]
}
```

### Task Type 2: `dto-gen`
```json
{
  "repoPath": "/Users/developer/projects/my-app",
  "taskType": "dto-gen",
  "objective": "Generate Zod schema and TypeScript interface for OrderPayload in src/dto/order.dto.ts matching API documentation in context.",
  "context": "Order schema requirement: id (uuid), items (array of item objects with id, qty > 0, price > 0), totalAmount (number), status (enum: PENDING, PAID, SHIPPED).",
  "allowedPaths": ["src/dto/order.dto.ts"],
  "verificationCommands": ["npm run typecheck"]
}
```

### Task Type 3: `refactor`
```json
{
  "repoPath": "/Users/developer/projects/my-app",
  "taskType": "refactor",
  "objective": "Refactor src/services/auth-service.ts to replace callbacks with async/await while preserving function signatures.",
  "allowedPaths": ["src/services/auth-service.ts"],
  "verificationCommands": ["npm test tests/unit/auth-service.test.ts", "npm run typecheck"]
}
```

### Task Type 4: `doc-gen`
```json
{
  "repoPath": "/Users/developer/projects/my-app",
  "taskType": "doc-gen",
  "objective": "Add JSDoc documentation to all exported functions and interfaces in src/utils/string-helpers.ts.",
  "allowedPaths": ["src/utils/string-helpers.ts"],
  "verificationCommands": ["npx tsc --noEmit"]
}
```

### Task Type 5: `bug-fix`
```json
{
  "repoPath": "/Users/developer/projects/my-app",
  "taskType": "bug-fix",
  "objective": "Fix off-by-one boundary error in array slicing logic in src/algorithms/chunker.ts line 42.",
  "allowedPaths": ["src/algorithms/chunker.ts"],
  "verificationCommands": ["npm test tests/unit/chunker.test.ts"]
}
```

---

## 6. Contract Anti-Patterns to Avoid

1. **Vague Objectives**: *"Fix the bugs in parser."* -> Worker has no criteria for success.
2. **Missing Allowed Paths**: Delegating without `allowedPaths` allows worker agents to touch files outside their intended scope.
3. **Interactive Verification Commands**: Command `npm init` or `jest --watch` will hang worker execution until timeout.
4. **Oversized Scope**: Expecting a worker agent to rewrite entire application subsystems in a single task.
