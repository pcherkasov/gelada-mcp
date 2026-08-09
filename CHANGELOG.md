# Changelog

All notable changes to **Gelada MCP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-08-09

### Added

- **`QUOTA_EXHAUSTED`, a terminal state of its own.** When the worker model runs
  out of quota, that is neither an authentication problem nor a defect in the
  task — the same delegation succeeds once the window resets. Reported as a bare
  `FAILED_WORKER` with "exited with non-zero exit code 1", it invited the two
  wrong reactions: retry immediately, or rewrite an objective that was never at
  fault.

  The state carries what actually helps. The worker CLI reports its reset window
  (`Resets in 2m38s`), and that window is now parsed out and surfaced in
  `errorDetails.recommendedAction` instead of being left to die in stderr, along
  with explicit advice to re-delegate the task unchanged.

  Detection covers the phrasing Antigravity emits plus the common forms used by
  other providers — out of credits, `RESOURCE_EXHAUSTED`, HTTP 429, rate
  limited, usage limit reached — so this does not have to be rediscovered per
  worker CLI. A quota failure is deliberately checked before the authentication
  branch, so it can never be misreported as "run `agy login`".

## [0.1.2] - 2026-08-09

### Fixed

- **The macOS binaries could not run on Apple Silicon.** They were built on a
  Linux runner, where `pkg` cannot ad-hoc sign its darwin output, and macOS
  kills unsigned arm64 executables outright — `gelada-darwin-arm64 --version`
  exited 137 with no output on both 0.1.0 and 0.1.1. Signing them after the fact
  does not help: the signature is appended to the Mach-O and corrupts the
  packaged snapshot. Release binaries are now built on macOS, where they are
  signed as part of the build.

  If you downloaded a macOS binary from 0.1.0 or 0.1.1, replace it — those
  archives cannot be repaired locally. The npm package was never affected.

### Added

- The release now runs the binary it just built and checks both its signature
  and the version it reports, so a binary that cannot start fails the release
  instead of being published.

## [0.1.1] - 2026-08-09

### Fixed

- **Security reports had nowhere to land.** `SECURITY.md` gave
  `security@gelada-mcp.org` as the contact, and that domain does not exist
  (NXDOMAIN). Private vulnerability reporting was also disabled on the
  repository, so a researcher had no working channel at all. Reports now go to a
  private GitHub security advisory, with a maintainer address as fallback.
- **Gelada reported the wrong version of itself.** The version was written as a
  literal in five places in the source, so `gelada --version`, the MCP
  `initialize` handshake and `doctor --json` would all have kept reporting
  `0.1.0` forever. `gelada update` was worse: it resolved `package.json` through
  `__dirname`, which does not exist in ESM, so the lookup always failed and the
  update check silently compared against a hard-coded `0.1.0` regardless of what
  was installed. All of them now read the version from `package.json`, and the
  standalone binary has it baked in at build time.
- **`gelada smoke` could leak a temporary git repository per run.** Cleanup of
  the throwaway repository discarded every error, so a removal that lost a race
  with the worker's last writes left the repository in the system temp directory
  and reported nothing. It now retries briefly and warns instead of hiding.

### Changed

- `@modelcontextprotocol/sdk` moved to 1.30.0, clearing 5 advisories (2 high)
  reaching the tree through `hono`, `fast-uri` and `ip-address`. Installs of
  0.1.0 were never exposed — the declared range is `^1.5.0` and no lockfile
  ships to consumers — so this only pins what the project itself builds against.
- Releases are now cut by the pipeline: merging a version bump to `main`
  publishes to npm with provenance, builds the standalone binaries and creates
  the tag and GitHub release. Publishing authenticates with a short-lived OIDC
  token instead of a stored npm token.

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
