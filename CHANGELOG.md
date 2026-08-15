# Changelog

All notable changes to **Gelada MCP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] - 2026-08-15

### Added

- **The CLI speaks Russian, Ukrainian and Polish.** It follows the environment by
  default — `LANG=ru_RU.UTF-8` needs no configuration — and can be pinned with
  `gelada config set ui.language ru` or overridden for a single command with
  `GELADA_LANG=en`, which is what you want when pasting output into an issue.
  Precedence is `GELADA_LANG` → `ui.language` → `LC_ALL` / `LC_MESSAGES` /
  `LANG` → English. An unsupported `ui.language` is rejected as you set it,
  rather than silently falling back and looking like the setting was ignored.

  The catalogues are typed as complete records of the English key set, so a
  missing message is a build error rather than a blank line at runtime, and
  tests assert that every translation keeps the placeholders its English
  original uses — a dropped `{path}` loses exactly the information the reader
  needed.

  Deliberately **not** translated: tool descriptions, the server instructions,
  the guidance under `docs/instructions/`, and the worker prompt scaffolding.
  Those are read by a model, not by a person. They are tuned text, and a second
  copy drifting from the first is not a cosmetic difference but a silent change
  in how delegation behaves. Which language your agent answers *you* in is the
  agent's decision either way, and a delegated `objective` already reaches the
  worker verbatim in whatever language you wrote it.

## [0.1.7] - 2026-08-15

### Fixed

- **Typing `gelada` started a server instead of showing the commands.** With no
  arguments it went straight to `mcp serve`, so a person who typed the program's
  own name got no output at all and a process that never returned — it was
  sitting there reading JSON-RPC from their keyboard. Nobody starts this server
  by hand; an MCP client spawns it down a pipe.

  A terminal on stdin now gets the command list and exits 0. Without a terminal
  the old behaviour is unchanged, because a bare invocation there is a client
  configured without `mcp serve` and breaking it would help nobody — it prints a
  line on stderr saying which arguments to configure instead.

## [0.1.6] - 2026-08-15

### Fixed

- **`gelada update` always said you were up to date.** It asked GitHub about
  `zugoman/gelada-mcp`, a repository that does not exist. Every request came back
  404, and the handler read any non-ok response as "the repository is not public
  yet" and returned a stub whose latest version was the installed one. Observed
  on 0.1.3 while 0.1.5 was published: `Current version: v0.1.3 / Latest version:
  v0.1.3 / Status: Up to date`.

  That is worse than having no update command. A check that cannot run now fails,
  loudly and with a non-zero exit — reporting success is the one answer a user
  acts on by doing nothing, which is precisely wrong when the truth is unknown.
  The repository is pinned to the `repository` field in package.json by a test,
  so it cannot drift again.

  Three further defects went with it. The version comparison ran `Number()` over
  every dot-separated part, so `0.2.0-rc1` produced `NaN` and any prerelease
  compared as current; it now follows semver, including a prerelease ranking
  below the release it precedes. Installation type was guessed by searching
  `argv[1]` for `node_modules`, which was wrong from a checkout and threw when
  `argv[1]` was unset; it now reads `process.pkg`. And the standalone upgrade
  path downloaded the release `.tar.gz` and copied the archive itself over the
  running executable, without extracting it — on Windows it never matched an
  asset at all, since `os.platform()` is `win32` and the asset is `win-x64`.

- **Standalone upgrades now go through `install.sh`.** It is the only code that
  knows how a release is laid out, and the only path CI exercises end to end, so
  `gelada update --install` runs it into the directory the current binary lives
  in rather than reimplementing download-verify-replace. The Windows standalone
  build says plainly that it cannot self-update, and prints where to get the zip.

### Added

- **`install.sh` verifies what it downloaded.** Releases have always shipped a
  `checksums.txt`; nothing read it. The old updater looked for a per-asset
  `.sha256` that has never existed and skipped verification with a warning on
  every run. The installer now matches the archive against the published
  checksum and refuses to install on a mismatch.

- **`install.sh` lands the binary by rename.** Copying onto the target truncates
  it and fills it back in, so an interrupted install leaves a `gelada` that
  exists and does not run. A fully written sibling is renamed into place instead:
  atomic, and it never opens the file a running process is executing — which
  matters now that `gelada update` replaces the binary it is running from.
  `scripts/verify-install.sh` covers installing over an existing install.

## [0.1.5] - 2026-08-15

### Added

- **`gelada setup` knows Antigravity.** It configured Claude Desktop, Claude Code
  and Codex, but not the IDE whose CLI is Gelada's own worker — so an Antigravity
  user registered Gelada by hand, and when 0.1.4 taught setup to repair a stale
  registration, the one client that needed repairing was the one setup would not
  touch.

  The config is `~/.gemini/config/mcp_config.json`, one file shared by the IDE,
  its `antigravity-ide` variant and the `agy` CLI. Registration, `--uninstall`
  and `--client antigravity` all work as they do for the other clients, and
  `gelada doctor` now validates that registration too.

### Fixed

- **A worker could delegate to itself.** Because Antigravity's CLI reads the same
  config as its IDE, registering Gelada for the IDE also loads Gelada into every
  `agy` run — including the one Gelada spawns as its worker. `agy` has no flag to
  exclude a server, and the worker runs with permission prompts disabled, so
  nothing stood between it and `delegate_task`: workers spawning workers, in
  worktrees inside worktrees, on the same quota, with no ceiling.

  The worker driver now marks every process it spawns, and `delegate_task`
  refuses when it sees that mark, before a task id is minted. Verified against
  the shipped Antigravity bundle and by observing `agy --print` load the shared
  config on a headless run.

## [0.1.4] - 2026-08-15

### Fixed

- **A registration could stop working on the next `brew upgrade`.** `gelada
  setup` recorded `process.execPath` as the command for MCP clients to spawn.
  That is an absolute path, which was the point — it survives PATH changes under
  node version managers — but it is also a fully resolved one, and under Homebrew
  it resolves into a version-and-revision specific keg:
  `/opt/homebrew/Cellar/node/25.9.0_2/bin/node`. Homebrew deletes the old keg on
  every upgrade, including the revision bumps it makes whenever a dependency is
  rebuilt, so the recorded interpreter simply vanished.

  The failure was silent in the worst way. The client spawns the command, gets
  ENOENT, and reports only that the transport closed unexpectedly — the server
  never ran, so no Gelada log, error or diagnostic existed to consult.

  Setup now records `/opt/homebrew/opt/node/bin/node`, Homebrew's versionless
  link to the current keg, whenever it resolves to the same binary. Paths that
  are not kegs are left alone: under fnm, nvm and friends the versioned directory
  *is* the installation, and the globally installed package lives under it, so
  pinning it is correct.

- **`install.sh` could never download anything.** It built the archive name from
  `$TAG`, which defaults to the literal string `latest`, and asked for
  `gelada-latest-darwin-arm64.tar.gz`. Release assets are named after the real
  tag, so every default run 404'd. `latest` is now resolved to a version first,
  by reading where GitHub's `/releases/latest` redirects — no API quota spent —
  and `GELADA_VERSION` accepts `0.1.3` as well as `v0.1.3`.

### Added

- **`gelada doctor` reads the client registrations back.** A stale launch command
  is the one failure the server cannot report, because it is why the server did
  not start. Doctor now checks that every command Gelada is registered under
  still exists, names the client and the file when one does not, and points at
  `gelada setup` to rewrite it. Bare command names are reported but not judged —
  the client resolves those from its own PATH, not ours.

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
