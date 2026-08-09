# Roadmap

`gelada-mcp` lets a strong coding agent (Claude Code, Codex) delegate routine,
well-bounded subtasks to a cheaper local worker (the Antigravity `agy` CLI)
running inside an isolated git worktree. The leader agent keeps architecture,
review and final acceptance; the worker does the verbose typing.

This file tracks what works today and what is planned. For the design rationale
see [`README.md`](README.md); for the threat model see [`SECURITY.md`](SECURITY.md).

## Status

| Area | State |
|---|---|
| MCP stdio server, 7 tools | working |
| Policy engine (4-tier precedence, narrowing invariant) | working |
| Git worktree isolation | working |
| Contract validation, artifact retention | working |
| CLI (`setup`, `doctor`, `config`, `task`, `cleanup`, `models`, `init`) | working |
| `agy` worker delegation end-to-end | working |
| Test suite (474 tests) and CI | green |
| Agent-side discoverability (MCP `instructions`, resources, prompts) | see Milestone 2 |
| One-command install with smoke verification | see Milestone 3 |

## Milestone 1 — Reliable worker execution ✅

The worker integration had to be made correct against the real `agy` CLI rather
than against assumptions about it. Verified end to end: a delegated task now
produces a real diff in the target repository.

- [x] Resolve model profiles against the models `agy` actually offers, from one
      source of truth shared by the server and `gelada models`
- [x] Pass the worktree to the worker explicitly — `agy` does not treat the spawn
      `cwd` as its workspace
- [x] Deliver an oversized prompt through a file rather than through `argv`
- [x] Explicit write-permission handling for headless runs, configurable per
      project via `workerAutoApprove` / `workerSandbox`
- [x] Treat "exit 0 with an empty diff" as a failure, not a success — silent
      no-ops are the worst failure mode for a delegation tool
- [x] Separate `allowedPaths` (write boundary) from file preconditions
      (`requiredFiles`), so that creating a new file is a valid task
- [x] Anchor artifacts and worktrees to the target repository, not to the
      server's working directory
- [x] Release worktrees that hold no changes; keep the ones that do

### A note on worker permissions

The Antigravity CLI cannot prompt for tool approval in headless mode and ignores
its own `permissions.allow` rules there, so a worker that is not given
`--dangerously-skip-permissions` cannot write anything. Gelada therefore passes
that flag by default and relies on the surrounding isolation for safety: the
worker only ever sees a disposable git worktree, its environment is stripped of
credentials, and `--sandbox` restricts terminal commands. Both behaviours are
policy flags — set `workerAutoApprove: false` in `.gelada/policy.yaml` to turn
the bypass off, at the cost of the worker being unable to make changes. See
[`SECURITY.md`](SECURITY.md).

## Milestone 2 — Discoverability

A capable server that no agent chooses is not useful. The leader agent needs to
know *when* delegation pays off.

- [ ] Ship server-level `instructions` describing when to delegate, when not to,
      and how to poll
- [ ] Tool descriptions that state the trade-off, with proper annotations
- [ ] Expose the guidance in `docs/instructions/` as MCP resources, and typical
      delegation scenarios as MCP prompts
- [ ] State the async polling contract explicitly in the `delegate_task` response
- [ ] `gelada init` writes a short delegation policy into the target repo's
      `CLAUDE.md` / `AGENTS.md`

## Milestone 3 — Frictionless install

- [ ] `npx gelada-mcp setup` performs the whole first-run flow: dependency checks,
      client registration, worker auth check, project policy scaffold
- [ ] Setup finishes with a real smoke delegation; if it produces no diff, setup
      reports failure rather than success
- [ ] `doctor` reports accurate, machine-readable diagnostics (`--json`, `--verbose`)

## Milestone 4 — Release

- [ ] Test suite green on CI for every push and pull request
- [ ] Deterministic worker stub so end-to-end tests need no network or model
- [ ] Publish to npm, tag `v0.1.0`, working `install.sh`

## Beyond 0.1

- Additional worker drivers behind the same contract (the worker driver is an
  interface, not a hard dependency on `agy`)
- Richer verification strategies (coverage deltas, lint gates)
- Optional container sandboxing for untrusted task types

## Contributing

Issues and pull requests are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
The most useful contributions right now are on Milestone 1.
