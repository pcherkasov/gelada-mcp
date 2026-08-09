# Changelog

All notable changes to **Gelada MCP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-09

First public release.

### Added

- **MCP stdio server** exposing seven tools: `delegate_task`, `revise_task`,
  `inspect_task`, `discard_task`, `cancel_task`, `list_workers` and `doctor`.
- **Worker delegation** to the Antigravity CLI inside an isolated git worktree,
  with model profiles (`FAST`, `BALANCED`, `DEEP`) resolved against the models
  the worker CLI actually reports.
- **4-tier policy engine** with a narrowing invariant: a lower-priority tier can
  restrict limits further but never widen them. Path boundaries, command
  allow/deny lists, task types, timeouts and artifact retention.
- **17 granular task states** with a full transition history per task.
- **Environment sanitization** stripping credentials from the worker process,
  and secret redaction on worker output.
- **Agent-facing discoverability**: server `instructions` delivered at
  `initialize`, tool descriptions that state the delegation trade-off, the
  leader-agent guidance served as MCP resources, and MCP prompts for the
  delegation shapes that work well.
- **`gelada` CLI**: `setup`, `doctor`, `smoke`, `config`, `task`, `init`,
  `models`, `cleanup`, `update`, `debug-bundle`, `mcp serve`.
- **Installation that proves itself**: `gelada setup` registers Gelada with
  detected MCP clients, runs diagnostics, states the worker permission default,
  and then delegates a real task — exiting non-zero unless it produced an actual
  diff. Available separately as `gelada smoke`.
- **`gelada init`** scaffolds `.gelada/policy.yaml` and writes a delegation
  policy into the repository's `CLAUDE.md` / `AGENTS.md`.
- CI across Node 18, 20 and 22, gated on typecheck, lint, 493 tests, leaked
  worktrees and package size.

### Notes

- The worker runs with its own permission prompts disabled, because the
  Antigravity CLI cannot prompt headlessly and ignores its allow-rules in that
  mode — without it the worker cannot write a single file. The isolation
  boundary is the disposable worktree, the sanitized environment and the
  sandboxed terminal, not the worker's own prompts. Configurable per project via
  `workerAutoApprove`. See [`SECURITY.md`](SECURITY.md) §4.
- A worker that exits successfully without changing anything is reported as
  `FAILED_WORKER` / `WORKER_NO_CHANGES` rather than as an empty success.
- `delegate_task` returns as soon as the worker is spawned; poll `inspect_task`
  for the outcome. See the README for the protocol.
