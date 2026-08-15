# Gelada MCP Server (`gelada-mcp`)

[![Node.js CI](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.0-green.svg)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Local open-source **Model Context Protocol (MCP)** server that enables primary coding agents (e.g., Claude Code, OpenAI Codex, or Antigravity Leader) to delegate routine coding subtasks to local worker processes (such as the Google Antigravity `agy` CLI).

By delegating verbose, repetitive tasks (unit test generation, boilerplate DTO creation, docstring generation, refactoring) to worker agents executing in isolated Git worktrees, primary agents preserve precious context window space while guaranteeing safe, verifiable code edits.

---

## How it works

A leader agent sends a task contract. Gelada runs the worker inside a disposable
git worktree and hands back a patch and a verification verdict — the worker's
output never enters the leader's context, and nothing is ever written to your
working tree.

```mermaid
flowchart TD
    L["<b>Leader agent</b><br/>Claude Code · Codex · Cursor"]
    G["<b>Gelada MCP server</b> — local, stdio<br/>contract → policy → worktree → sanitized env<br/>→ worker → verification → patch"]
    W["<b>Worker</b>, in a disposable worktree<br/>Antigravity agy today<br/>more backends planned"]
    R[("<b>Your repository</b><br/>never written to")]

    L -->|"delegate_task<br/>objective · allowedPaths · verificationCommands"| G
    G -->|"spawn with a sanitized environment"| W
    W -->|"file edits + thousands of tokens of chatter"| G
    G ==>|"patch + verification verdict + changed files<br/><b>the chatter stays behind</b>"| L
    G -.->|"branches from HEAD, writes only inside .worktrees/"| R
```

The leader stays the leader: it designs the task, reviews the patch, and decides
what to keep. Gelada never applies anything.

### What each part is responsible for

| Component | Responsibility |
|---|---|
| Contract validator | Rejects a malformed task before any process is spawned |
| Policy engine | 4-tier precedence with a narrowing invariant — a lower tier may restrict further, never widen |
| Worktree manager | Allocates and releases the disposable worktree under `.worktrees/` |
| Environment sanitizer | Strips credentials from the worker process |
| Worker driver | Builds the worker invocation and spawns it |
| Process supervisor | Tracks PIDs, enforces timeouts, terminates runaway workers |
| Verification engine | Runs `verificationCommands` inside the worktree before the leader sees anything |
| Artifact manager | Persists logs and diffs, enforces retention |

---

## Installation & Setup

### Prerequisites
- **Node.js**: `>= 18.0.0`
- **Git**: `>= 2.30.0` (required for `git worktree` support)
- **Worker CLI**: Google Antigravity CLI (`agy`) or custom worker executable specified via `AGY_COMMAND`.

### Global Installation
Install `gelada-mcp` globally using npm:
```bash
npm install -g gelada-mcp
```
Alternatively, for local development:
```bash
git clone https://github.com/pcherkasov/gelada-mcp.git
cd gelada-mcp
npm install
npm run build
npm link
```

### Initial Environment Setup
One command does the whole first run — it scaffolds configuration, registers
Gelada with every MCP client it finds, runs diagnostics, explains the worker
permission default, and then **delegates a real task to prove the pipeline
works**:
```bash
gelada setup
```
If the check fails, setup says so plainly and names the likely cause rather than
reporting success. Its exit code reflects its own work — a machine without the
worker CLI installed yet is an unfinished install, not a failed one — so use
`--strict` when you want a non-zero exit on a not-ready environment. Add `--yes`
for unattended runs and `--no-smoke` to skip the check.

Run the check on its own at any time:
```bash
gelada smoke
```

### Uninstallation & Client Removal
To remove `gelada-mcp` server registration from detected MCP client configuration files without deleting data:
```bash
gelada setup --uninstall
# or using alias
gelada setup --remove
```
You can also target specific client tools:
```bash
gelada setup --uninstall --client claude
gelada setup --uninstall --client codex
gelada setup --uninstall --client antigravity
```

---

## MCP Server Configuration Guides

### 1. Claude Code CLI
Add `gelada-mcp` to your `~/.claude.json` configuration file:
```json
{
  "mcpServers": {
    "gelada-mcp": {
      "command": "gelada",
      "args": ["mcp", "serve"]
    }
  }
}
```

### 2. Claude Desktop (macOS / Windows / Linux)
Add `gelada-mcp` to `claude_desktop_config.json`:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gelada-mcp": {
      "command": "gelada",
      "args": ["mcp", "serve"]
    }
  }
}
```

### 3. OpenAI Codex / Cursor / Custom Stdio Clients
Add `gelada-mcp` to `~/.codex/config.json` or `mcp.json`:
```json
{
  "mcpServers": {
    "gelada-mcp": {
      "command": "gelada",
      "args": ["mcp", "serve"]
    }
  }
}
```

### 4. Antigravity
Both the IDE and the CLI read one shared file, `~/.gemini/config/mcp_config.json`
(`%USERPROFILE%\.gemini\config\mcp_config.json` on Windows):
```json
{
  "mcpServers": {
    "gelada-mcp": {
      "command": "gelada",
      "args": ["mcp", "serve"]
    }
  }
}
```
Sharing that file has a consequence worth knowing: `agy` loads these servers on
every run, and `agy` is the worker Gelada delegates to. The worker therefore sees
Gelada's own tools. It cannot use them — `delegate_task` refuses when it is
called from inside a worker, so a worker cannot spawn workers of its own — but if
you would rather it never saw them at all, keep Gelada out of this file and
register it with your leader client only:
```bash
gelada setup --uninstall --client antigravity
```

---

## CLI Command Reference

`gelada` provides a comprehensive command-line interface for configuration, environment diagnostics, task inspection, and artifact cleanup.

```
Usage: gelada [command] [options]

Commands:
  setup                    Scaffold Gelada configuration, data paths, and default settings
  doctor                   Run diagnostic checks on Gelada environment, git, and worker CLI
  mcp serve                Launch Gelada MCP stdio server transport
  config <subcommand>      Manage Gelada configuration settings (list, get, set, reset)
  task <subcommand>        Inspect, patch, or discard delegated task lifecycles
  cleanup                  Clean up obsolete task artifact bundles based on retention policies
  update                   Check for a newer release and optionally install it
```

### 1. `gelada setup`
Scaffolds configuration directories and registers MCP clients.
```bash
gelada setup [options]

Options:
  -f, --force               Overwrite existing configuration file with defaults
  --config-dir <path>       Specify custom target directory for setup
  --json                    Output setup results in JSON format
  -q, --quiet               Suppress stdout messages
  --uninstall               Remove gelada-mcp from detected client configurations
  --remove                  Alias for --uninstall
  --client <name>           Target specific client (claude, codex, antigravity, or all)
  --no-smoke                Skip the end-to-end delegation check
  -y, --yes                 Accept the worker permission default without prompting
  --strict                  Exit non-zero if the environment is not ready
```

### 2. `gelada doctor`
Reports whether Gelada can actually run tasks: Node and Git versions, config
directory permissions, whether the commands your MCP clients were registered
with still exist, and whether the worker CLI is installed and authenticated.
```bash
gelada doctor [options]

Options:
  -v, --verbose             Show per-check details
  --no-worker               Skip worker CLI checks
  --json                    Output the diagnostic report as JSON
  --strict                  Exit non-zero if any check does not pass
```
A run that completed exits 0 even when it has bad news, so scripts can read the
report; only Gelada's own prerequisites fail the command. Use `--strict` to gate
on a fully clean environment.

#### "Server transport closed unexpectedly" right after startup
If a client logs a spawn failure — `Failed to spawn process: No such file or
directory`, or a transport that closes milliseconds after connecting — the
server was never started, so it has nothing to log. The command in the client's
configuration no longer exists. The usual cause is an interpreter path that has
since moved: Homebrew installs Node into a version-and-revision specific keg and
deletes the old one on every upgrade, so a registration naming
`/opt/homebrew/Cellar/node/25.9.0_2/bin/node` stops working the next time `brew
upgrade` runs.

`gelada doctor` names the broken registration, and `gelada setup` rewrites it:
```bash
gelada doctor            # MCP Client Registration: ... — not found
gelada setup             # re-registers with a path that survives upgrades
```
For a client Gelada does not configure for you, set `command` to
`/opt/homebrew/opt/node/bin/node` (Homebrew's stable link to the current
version) rather than to a `Cellar` path.

### 3. `gelada mcp serve`
Launches the stdio transport server for MCP host clients.
```bash
gelada mcp serve
```

### 4. `gelada config`
Inspect and update global Gelada configuration settings (`~/.config/gelada/config.yaml`).
```bash
gelada config list                      # Display active merged configuration
gelada config get worker.command        # Get specific configuration value
gelada config set worker.timeoutSeconds 600  # Set configuration value
gelada config reset                     # Reset configuration to defaults
```

### 5. `gelada init`
Scaffolds a project policy and tells your coding agent that delegation is
available.
```bash
gelada init [preset]        # typescript (default), java, python, go

Options:
  -f, --force               Overwrite an existing .gelada/policy.yaml
  --no-agent-guide          Do not touch CLAUDE.md / AGENTS.md
```
It writes `.gelada/policy.yaml`, then adds a short delegation policy to the
repository's `CLAUDE.md` and/or `AGENTS.md` between marker comments. Re-running
it replaces that block rather than appending a second copy.

### 6. `gelada task`
Inspect and manage task lifecycles directly from the command line.
```bash
# Inspect task details by mode (summary, diff, files, verifications, logs, history)
gelada task inspect <taskId> --mode diff

# Patch an existing task contract
gelada task patch <taskId> --file patch-spec.json

# Discard a task and clean up temporary worktree resources
gelada task discard <taskId> [--keep-logs]
```

### 7. `gelada cleanup`
Enforces artifact retention policies and cleans up old task runs, log bundles, and diffs.
```bash
gelada cleanup [options]

Options:
  -r, --repo <path>         Target repository workspace path (defaults to cwd)
  -g, --global-config <path> Custom path or directory for global configuration
  -n, --dry-run             Simulate cleanup without deleting any files
  --max-runs <count>        Override maximum number of task runs to retain (e.g. 10)
  --max-age-days <days>     Override maximum task artifact age in days (e.g. 7)
  --max-disk-size <size>    Override maximum total artifact disk space (e.g. "100MB", "1GB")
  --json                    Output cleanup summary as JSON
```

### 8. `gelada update`
Compares the installed version against the latest GitHub release, and upgrades
in the way this copy was installed: `npm install -g gelada-mcp@latest` for a
package install, and `install.sh` for a standalone binary.
```bash
gelada update              # report only
gelada update --install    # report, then upgrade if there is anything to install
gelada update --json       # machine-readable, including a failed check
```
A check that could not run exits non-zero and says so. It is never reported as
"up to date" — that reads as good news and is acted on by doing nothing, which
is the wrong move when the truth is unknown.

### 9. Interface language
The CLI speaks English, Russian, Ukrainian and Polish. It follows your
environment by default, so a `ru_RU.UTF-8` desktop needs no configuration:
```bash
gelada config set ui.language ru     # pin it: en | ru | uk | pl
gelada config set ui.language ''     # back to following the environment
GELADA_LANG=en gelada doctor         # one command in English, for pasting into an issue
```
Precedence is `GELADA_LANG` → `ui.language` → `LC_ALL` / `LC_MESSAGES` / `LANG` →
English. An unsupported value in `ui.language` is rejected when you set it
rather than silently ignored.

Only the CLI is translated. Tool descriptions, the server instructions and the
guidance under `docs/instructions/` stay in English in every language, because
they are read by the model rather than by you — a second copy of tuned prompt
text drifting from the first is not a cosmetic difference but a silent change in
how delegation behaves. The language your agent replies to *you* in is decided
by the agent, not by this setting, and the `objective` you delegate is passed to
the worker verbatim in whatever language you wrote it.

### MCP resources and prompts

Beyond tools, the server exposes the leader-agent guidance in
`docs/instructions/` as MCP **resources** (`gelada://instructions/…`), so an
agent can pull the detail on demand rather than carrying it in every session,
and ships **prompts** for the delegation shapes that work well:
`delegate_unit_tests`, `delegate_docstrings`, `delegate_mechanical_refactor`
and `review_delegated_patch`.

The `initialize` response also carries server `instructions` — a short account
of when delegation pays off and when it does not. MCP clients inject this into
the model's context, which is what makes an agent reach for the server without
being told to.

---

## Policy Engine Configuration Schemas

Gelada MCP configures security boundaries, path protection, worker command limits, and artifact retention limits using YAML policy files.

### Configuration Locations & Precedence
1. **Global Configuration**: `~/.config/gelada/config.yaml`
2. **Project Policy**: `.gelada/policy.yaml` (in target repository root)

### `.gelada/policy.yaml` Schema Reference
Below is a complete annotated example of a project policy file:

```yaml
# .gelada/policy.yaml
version: "1.0"

# Task execution limits
maxFiles: 20                  # Maximum files a worker may modify in one task
maxLines: 1000                # Maximum total line edits allowed per task
taskTimeout: 300              # Maximum task execution timeout in seconds
maxRevisions: 5               # Maximum allowed revision cycles per task
defaultModelProfile: "default"

# Path boundary restrictions
protectedPaths:
  - "src/core/security.ts"
  - "package.json"
  - "tsconfig.json"
  - ".env*"

# Security and networking flags
allowNetwork: false           # Block external network access during worker run
allowShellChaining: false     # Block shell chaining (&&, ;, |) in verification commands

# Worker permissions (see SECURITY.md)
workerAutoApprove: true       # Let the worker CLI write files without prompting.
                              # Required for headless operation: the CLI cannot ask
                              # for approval and ignores its allow-rules in that mode.
                              # Setting this to false means the worker cannot make
                              # any changes.
workerSandbox: true           # Ask the worker CLI to restrict terminal commands

# Task and command permissions
allowedTaskTypes:
  - "unit-test"
  - "refactor"
  - "doc-gen"
  - "dto-gen"
  - "bug-fix"

allowedCommands:
  - "npm test"
  - "npm run build"
  - "npx jest"
  - "cargo test"
  - "pytest"

disallowedCommands:
  - "rm -rf *"
  - "chmod 777"
  - "curl"
  - "wget"

# Artifact Retention Limits
retention:
  maxRuns: 20                 # Maximum number of completed task runs to retain
  maxAgeDays: 14              # Maximum age of task artifact bundles in days
  maxTotalSize: "500MB"       # Total disk size limit for artifact storage (e.g. 500MB, 2GB)
```

---

## Available MCP Tools

Gelada MCP exposes seven tools over MCP stdio transport:

| MCP Tool | Description | Key Parameters |
|---|---|---|
| `delegate_task` | Delegates a routine coding task to a local worker inside an isolated Git worktree. Returns as soon as the worker is spawned — see *Task lifecycle* below. | `taskType`, `objective`, `repoPath`, `allowedPaths`, `requiredFiles`, `disallowedPaths`, `verificationCommands`, `modelProfile`, `timeoutSeconds` |
| `revise_task` | Supplies revision feedback and additional test constraints to an existing task. | `taskId`, `revisionNotes`, `additionalCriteria`, `additionalVerificationCommands` |
| `inspect_task` | Queries granular state, diffs, changed files, test output, or execution logs of a task. | `taskId`, `mode` (`summary` \| `diff` \| `files` \| `verifications` \| `logs` \| `history`) |
| `discard_task` | Cancels running worker execution and purges temporary worktrees. | `taskId`, `keepLogs` |
| `cancel_task` | Terminates a running worker without discarding task history or its worktree. | `taskId` |
| `list_workers` | Lists local worker drivers and their statuses. | — |
| `doctor` | Diagnostics on Node, Git, config permissions, and worker CLI availability. | `verbose`, `checkWorker` |

### Task lifecycle: delegate, then poll

`delegate_task` does not block until the worker finishes — a real task can run
for minutes, well past an MCP call timeout. It validates the contract, prepares
the worktree, spawns the worker and returns `status: "running"` with a `taskId`.

The leader agent then polls `inspect_task` until the task reaches a terminal
state, and reads the patch from `mode: "diff"`:

```jsonc
// 1. delegate
{ "taskId": "task-1786264803049-23gtd", "status": "running", "granularStatus": "RUNNING" }

// 2. poll every few seconds
{ "taskId": "task-...", "status": "completed", "granularStatus": "COMPLETED" }
```

Contract and policy rejections are returned synchronously with `status:
"failed"` — those never spawn a worker.

### Worker paths: `allowedPaths` vs `requiredFiles`

- `allowedPaths` is the **write boundary**: the paths the worker may create or
  modify. Listed files do not have to exist yet, so "create this file" is a
  valid task.
- `requiredFiles` is a **precondition**: files that must already be present, or
  the task fails validation before any worker runs.

A path that appears in both `allowedPaths` and `disallowedPaths` is rejected as
a contradictory contract.

---

## 17 Granular Task Lifecycle States

Gelada MCP tracks task execution through 17 explicit lifecycle states, providing precise transparency into task progression and failure reasons:

```
                  +-----------------------------------+
                  |              CREATED              |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |            VALIDATING             |
                  +-----------------------------------+
                        |                       |
               (Pass)   v                       v  (Fail)
  +-------------------------------+   +-------------------------------+
  |           PREPARING           |   |        FAILED_CONTRACT        |
  +-------------------------------+   +-------------------------------+
                |
                v
  +-------------------------------+
  |             READY             |
  +-------------------------------+
                |
                v
  +-------------------------------+
  |            RUNNING            | ----(Auth Error)----> [ AUTH_REQUIRED ]
  |            RUNNING            | ----(Quota Out)-----> [ QUOTA_EXHAUSTED ]
  +-------------------------------+ ----(Timeout/Kill)--> [ CANCELLED     ]
          |               |             ----(Policy Fail)--> [ FAILED_POLICY ]
   (Pass) v               v (Crash/Code)
  +---------------+   +---------------+
  |  COLLECTING   |   | FAILED_WORKER |
  +---------------+   +---------------+
          |
          v
  +---------------+
  |   VERIFYING   | ----(Tests Fail)----> [ FAILED_VERIFICATION ]
  +---------------+
          |
   (Pass) v
  +-------------------------------+
  |  COMPLETED / WITH_WARNINGS    | ----(Feedback)----> [ REVISION_REQUIRED ]
  +-------------------------------+                             |
                |                                               v
                |                                      (Re-enter PREPARING)
                v
  +-------------------------------+
  |           DISCARDED           |
  +-------------------------------+
```

### Granular State Reference Table

| Granular State | Description | Legacy Mapping |
|---|---|---|
| `CREATED` | Initial state when task delegation is received and instantiated. | `running` |
| `VALIDATING` | Validating contract schema, path boundaries, and policy permissions. | `running` |
| `PREPARING` | Creating isolated Git worktree and setting up workspace directory. | `running` |
| `READY` | Worktree and environment initialized; ready to launch worker CLI. | `running` |
| `RUNNING` | Worker agent process (`agy`) actively executing task prompt. | `running` |
| `COLLECTING` | Worker process exited; gathering stdout, stderr, modified files, and Git diff. | `running` |
| `VERIFYING` | Running automated verification test commands inside worktree. | `running` |
| `COMPLETED` | All verification test commands passed; task completed successfully. | `completed` |
| `COMPLETED_WITH_WARNINGS` | Task finished successfully but logged non-fatal warnings (e.g. truncated output). | `completed` |
| `REVISION_REQUIRED` | Task requires revision based on leader agent feedback (`revise_task`). | `revised` |
| `FAILED_CONTRACT` | Contract validation failed (invalid fields, malformed JSON, prohibited paths). | `failed` |
| `FAILED_WORKER` | Worker process failed (non-zero exit code, unhandled crash, execution error). | `failed` |
| `FAILED_POLICY` | Task execution blocked by Policy Engine security rule or path restriction. | `failed` |
| `FAILED_VERIFICATION` | Automated verification commands failed (tests broke). | `failed` |
| `AUTH_REQUIRED` | Worker agent requires authentication (e.g., `agy login` required). | `failed` |
| `QUOTA_EXHAUSTED` | Worker model quota ran out before any work was done. The task is fine; retry unchanged once the reset window in `errorDetails.recommendedAction` has passed. | `failed` |
| `CANCELLED` | Task execution timed out or was cancelled during runtime. | `failed` |
| `DISCARDED` | Task worktree and runtime resources discarded via `discard_task`. | `discarded` |

---

## Development & Verification Commands

### Build & Typecheck
```bash
npm run build         # Transpile TypeScript to dist/
npm run typecheck     # Run tsc type checking
npm run lint          # Run ESLint validation
npx prettier --check .# Check formatting
```

### Running Tests
Execute unit and E2E integration test suites:
```bash
npm test
```

---

## Security & Vulnerability Reporting

Please refer to [`SECURITY.md`](SECURITY.md) for details on our threat model, isolation boundaries, environment variable sanitization policies (Requirement R1), and vulnerability reporting procedures.

## License

[MIT](LICENSE) © 2026 Gelada MCP Contributors.
