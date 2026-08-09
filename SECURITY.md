# Security Policy & Architecture (`SECURITY.md`)

This document outlines the security architecture, threat model, isolation boundaries, environment variable sanitization policies, policy precedence hierarchy, and vulnerability reporting guidelines for **Gelada MCP** (`gelada-mcp`).

---

## 1. Security Architecture & Boundary Isolation

`gelada-mcp` operates as a security-conscious bridge between primary orchestration/leader agents (such as Claude Code, OpenAI Codex, or Antigravity Leader) and local worker agent processes (such as the `agy` CLI).

```
+-----------------------------------------------------------------------------------+
|                              PRIMARY LEADER AGENT                                 |
|                       (Claude Code / OpenAI Codex / Custom)                      |
+-----------------------------------------------------------------------------------+
                                          |
                                   MCP Stdio Request
                                          v
+-----------------------------------------------------------------------------------+
|                                 GELADA MCP SERVER                                 |
|  +-----------------------------------------------------------------------------+  |
|  | Policy Engine (4-Tier Permission Narrowing Hierarchy)                        |  |
|  +-----------------------------------------------------------------------------+  |
|  | Path Boundary Inspector & Command Sanitizer                                 |  |
|  +-----------------------------------------------------------------------------+  |
|  | Environment Variable Sanitizer (R1 Policy)                                  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                          |
                                Isolated Worktree Spawn
                                          v
+-----------------------------------------------------------------------------------+
|                            ISOLATED GIT WORKTREE                                  |
|                             (.worktrees/task-XXXX)                                |
|  +-----------------------------------------------------------------------------+  |
|  | Worker Process (`agy`) executing task prompt inside sanitized environment   |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 1.1 Git Worktree Isolation
Worker tasks executed by `gelada-mcp` never operate directly on the primary working directory.
- Each delegated task is allocated an isolated Git worktree inside `.worktrees/task-<taskId>` (or a temporary system workspace).
- Uncommitted or experimental changes produced by worker agents remain strictly isolated within the worktree.
- The main branch/working tree is protected from partial writes, accidental syntax breaks, or file corruption until the primary leader agent explicitly reviews and merges the task diff.

### 1.2 OS Path Resolution & Boundary Checks
All file operations and path inputs pass through `PolicyEngine` path normalization and verification checks:
- **Absolute Path Resolution**: All paths are resolved using `path.resolve()` and evaluated against repository roots using system path resolution (`fs.realpathSync`).
- **Path Traversal Protection**: Relative path traversal attempts (`../`, `..\\`, symlink loops targeting system files outside repository boundaries) are automatically detected and rejected.
- **Protected Paths Enforcement**: Critical system and repository paths are permanently protected against worker edits or overwrites:
  - System Git metadata: `.git`, `.git/hooks`, `.git/config`
  - Secrets & Credentials: `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`
  - Configuration & Policy files: `.gelada/policy.yaml`, `SECURITY.md`

### 1.3 Command Sanitization & Verification Safety
Verification test commands specified in task contracts undergo strict pre-execution analysis:
- **Blocked Shell Constructs**: Dangerous shell chaining and command substitution syntax are forbidden by default:
  - Command substitution: `$(...)`, `` `...` ``
  - Shell chaining & piping: `&&`, `;`, `|` (unless `allowShellChaining: true` is explicitly granted and allowed by policy).
  - Redirections: `> /etc/`, `> /dev/`, `> /var/`
- **Blocked Executables & System Commands**: High-risk binaries are permanently blocked:
  - Privilege escalation: `sudo`, `su`, `doas`, `pkexec`, `runas`
  - Disk / System manipulation: `mkfs`, `fdisk`, `parted`, `dd`, `diskutil`, `format`, `shutdown`, `reboot`, `init`, `halt`, `poweroff`
  - User management: `useradd`, `usermod`, `userdel`, `passwd`, `shadow`
  - Code evaluation traps: `eval`, `exec`
  - Destructive file removal: `rm -rf /`, `chmod 777`

---

## 2. Environment Variable Sanitization Policies (Requirement R1)

To prevent secret leakage or unintended credential inheritance by worker processes, `gelada-mcp` implements strict environment variable sanitization when spawning worker agents (`AntigravityDriver`).

### 2.1 Default Blocked Keys
The following 31 high-risk API keys, tokens, and cloud credentials are automatically stripped from worker process environments prior to invocation:

```
AWS_SECRET_ACCESS_KEY, AWS_ACCESS_KEY_ID, AWS_SESSION_TOKEN, AWS_PROFILE,
ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY,
GITHUB_TOKEN, GH_TOKEN, GITHUB_CLIENT_SECRET, GITLAB_TOKEN, GITLAB_PRIVATE_TOKEN,
NPM_TOKEN, NPM_AUTH_TOKEN, PYPI_TOKEN, SLACK_BOT_TOKEN, SLACK_TOKEN,
AZURE_CLIENT_SECRET, AZURE_OPENAI_API_KEY, AZURE_SUBSCRIPTION_ID,
GOOGLE_APPLICATION_CREDENTIALS, HEROKU_API_KEY, NETLIFY_AUTH_TOKEN, VERCEL_TOKEN,
DATADOG_API_KEY, STRIPE_SECRET_KEY, MISTRAL_API_KEY, COHERE_API_KEY, REPLICATE_API_TOKEN
```

### 2.2 Default Regex Patterns
Any environment variable key matching the following regular expression pattern is stripped:
```regex
/.*(?:SECRET|PASSWORD|PASSCODE|APIKEY|API_KEY|TOKEN|AUTH|CREDENTIAL|PRIVATE_KEY|PASSPHRASE).*/i
```

### 2.3 Preserved System & Framework Keys
To ensure standard Node.js and shell tools function properly, essential system keys and framework prefixes are preserved unless explicitly blocked by user config:
- **System Keys**: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `TMP`, `TEMP`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `PATHEXT`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TERM`, `COLORTERM`, `NODE_ENV`
- **Framework Prefixes**: Environment variables prefixed with `AGY_` or `GELADA_` pass through to worker processes to allow worker configuration and test overrides (e.g. `AGY_COMMAND`).

### 2.4 Task Overrides & Allowlist Options
Task delegation requests can specify custom environment sanitization rules:
- `blockedEnvVars`: Additional keys to block for a specific task.
- `allowedEnvVars`: Explicit whitelist. When provided, **only** explicitly listed keys (plus system keys and framework prefixes) are passed to the worker.
- `env`: Explicit key-value pairs passed to worker execution. (User-specified blocklists are still strictly enforced against explicit `env` additions).

---

## 3. Policy Engine 4-Tier Permission Narrowing Hierarchy

`gelada-mcp` uses a 4-tier hierarchical policy precedence model. Security permissions can **ONLY be narrowed** as higher tiers are merged. A lower (more specific) tier can never grant permissions forbidden by a higher (more authoritative) tier.

```
+-----------------------------------------------------------------------------------+
| Tier 1: Hard Limits (Immutable Safety Rules Built into Server Code)               |
+-----------------------------------------------------------------------------------+
                                          v
+-----------------------------------------------------------------------------------+
| Tier 2: Global Configuration (~/.config/gelada/config.yaml)                       |
+-----------------------------------------------------------------------------------+
                                          v
+-----------------------------------------------------------------------------------+
| Tier 3: Project Policy (.gelada/policy.yaml in repository)                        |
+-----------------------------------------------------------------------------------+
                                          v
+-----------------------------------------------------------------------------------+
| Tier 4: Request Overrides (Tool Invocation Arguments)                              |
+-----------------------------------------------------------------------------------+
```

### 3.1 Tier Hierarchy Descriptions

1. **Tier 1: Hard Limits**: Immutable safety rules hardcoded in `PolicyEngine`. Defines non-overridable safety constraints (blocked binaries, protected system paths like `.git`, `blockedCommandPatterns`).
2. **Tier 2: Global Configuration**: User-wide configuration stored in `~/.config/gelada/config.yaml` or `config.json`. Applies across all repositories on the machine.
3. **Tier 3: Project Policy**: Repository-specific policy defined in `.gelada/policy.yaml` or `.gelada/policy.yml`. Customizes permissions, retention rules, and command whitelists for a specific codebase.
4. **Tier 4: Request Overrides**: Individual tool invocation parameters (e.g., `allowedPaths`, `disallowedPaths`, `taskTimeout` passed during `delegate_task`).

### 3.2 Narrowing Precedence Logic
When merging policies across tiers:
- **Set Intersection (Whitelists)**: Whitelisted task types (`allowedTaskTypes`) or verification commands (`allowedCommands`) use set intersection. A command or task type must be allowed in *all* applicable tiers.
- **Set & Array Union (Blacklists)**: Protected paths (`protectedPaths`) and blocked executables (`blockedExecutables`) use set union. Adding a blocked path in any tier blocks it globally.
- **Numeric Upper Bounds**: Numeric parameters (`maxFiles`, `maxLines`, `taskTimeout`, `maxRevisions`) select the minimum value (`Math.min`) across all defined tiers.
- **Boolean AND Logic**: Boolean security flags (`allowNetwork`, `allowShellChaining`) default to `false`. If any tier specifies `false`, the effective policy evaluates to `false`.

---

## 4. Vulnerability Reporting Procedures

We take the security of `gelada-mcp` seriously. If you discover a security vulnerability or potential threat in this project, please follow our responsible disclosure guidelines.

### 4.1 Contact Guidelines
- **Email**: Report vulnerabilities privately by emailing `security@gelada-mcp.org` (or opening a private security advisory on GitHub).
- **Do Not Disclose Publicly**: Please do not open public GitHub issues or publicly post details about unpatched security vulnerabilities.

### 4.2 Response Timelines
- **Initial Acknowledgment**: Within **48 hours** of receiving your vulnerability report.
- **Triage & Assessment**: Preliminary assessment and severity rating provided within **7 days**.
- **Security Patch Release**: High-severity vulnerabilities patched and released within **14 days**.

### 4.3 Disclosure Policy
Once a fix has been developed and verified:
1. A patch release of `gelada-mcp` will be published to npm.
2. A security advisory detailing the issue, affected versions, and mitigation steps will be published.
3. Reporter contributions will be credited in the security advisory (unless anonymity is requested).
