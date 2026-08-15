# Contributing to Gelada MCP

Thank you for your interest in contributing to **Gelada MCP**! Gelada MCP is an open-source local Model Context Protocol (MCP) server that enables AI leader agents to delegate routine coding subtasks to local worker tools in isolated Git worktrees.

## Development Setup

### Prerequisites
- **Node.js**: `>= 18.0.0`
- **Git**: `>= 2.30.0`
- **TypeScript**: `5.x`

### Setup Workspace
1. Fork and clone the repository:
   ```bash
   git clone https://github.com/pcherkasov/gelada-mcp.git
   cd gelada-mcp
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Transpile TypeScript:
   ```bash
   npm run build
   ```
4. Run tests:
   ```bash
   npm test
   ```

## Workflow & Coding Guidelines

- **TypeScript**: Always write strict, type-safe TypeScript code. Ensure `npm run typecheck` passes without errors.
- **Code Style**: Follow ESLint and Prettier formatting rules (`npm run lint` & `npm run format`).
- **Tests**: Write unit and integration tests under `tests/` for any new feature or bug fix.
- **Security Boundaries**: Ensure path sanitization and environment variable stripping policies are respected across all worker process executions.

## Submitting Pull Requests

`main` is protected: it takes no direct pushes, it keeps a linear history, and
every change arrives as a squash-merged pull request. That applies to the
maintainer as well as to outside contributors.

**If you are an outside contributor**, fork the repository, push your branch to
your fork, and open the pull request from there against `pcherkasov/gelada-mcp:main`.
You do not need write access to the upstream repository, and you should not ask
for it — the fork-and-pull-request flow is the only supported path in.

**If you have write access**, branch directly in this repository. Same rules
otherwise.

1. Create a descriptive feature branch (`git checkout -b feature/my-feature`).
2. Verify the gate passes locally: `npm run typecheck`, `npm run lint`, `npm test`.
3. Commit your changes following clean git commit messages.
4. Push your branch and open a Pull Request against `main`.
5. Fill in every section of the pull request template (see below).
6. Wait for CI to pass. A red pull request will not be merged.

Keep a pull request to one coherent change. A branch that fixes a bug, renames
a module and bumps a dependency is three pull requests wearing a coat.

## Review policy

**Every pull request must be reviewed by the person who opened it, before it is
opened.** This is not a formality and it is not the reviewer's job to do it for
you. Opening a pull request is an assertion that you have already read the
complete diff of your own branch, hunk by hunk, and stand behind all of it.

This matters here more than in most projects. Gelada delegates code generation
to worker agents, and this repository is developed with the same kind of
tooling. Generated code that nobody has actually read is exactly the failure
mode this project exists to contain. If a diff contains work produced by an AI
agent, you are its reviewer, and you must be able to explain any line in it. "The
agent wrote it" is not an answer to a review comment.

Concretely, before you open the pull request:

- Read the whole diff — `git diff main...HEAD` — not just the files you
  remember touching.
- Delete what you did not mean to commit: debug output, commented-out code,
  stray fixtures, unrelated formatting churn.
- Run the change, do not only run the tests. A green suite proves the tests
  pass, not that the feature works.
- Confirm the security boundary is intact if you went near it: worktree
  isolation, path sanitization, environment stripping, worker permissions.

The template's **Author review** checkboxes record this. Tick them only if they
are true.

## Pull request description structure

The repository ships a pull request template
([`.github/pull_request_template.md`](.github/pull_request_template.md)) and
GitHub applies it automatically. Keep its headings; fill in every section:

| Section | What belongs in it |
| --- | --- |
| **What changed** | The change in plain language — what a reader of the diff would see. |
| **Why** | The problem being solved, not a restatement of the diff. Link the issue. |
| **Impact** | Breaking changes, security-boundary changes, package/binary contents, performance. Write "none" explicitly where it does not apply. |
| **Tests** | What you ran and what it proved — paste the result, do not claim it. |
| **Author review** | The self-review checkboxes described above. |

A pull request that leaves sections empty, or fills them with "n/a" without
explanation, will be sent back before anyone reads the code.

## Releasing

There is no release ritual. **The version in `package.json` is the trigger.**

Open a pull request that bumps the version and updates `CHANGELOG.md`. When it
merges to `main`, the pipeline notices that the new version has no matching
`v*` tag and, only then, releases: it publishes to npm with provenance, builds
the five standalone binaries, computes checksums, creates the tag, and attaches
everything to a GitHub release. Merge anything that does not touch the version
and none of that runs.

Nothing needs to be tagged or published by hand. Do not create `v*` tags
yourself — the pipeline creates them, and a tag that already exists is exactly
what tells it there is nothing to release.

Once the release exists, the pipeline installs it the way a stranger would:
[`scripts/verify-install.sh`](scripts/verify-install.sh) downloads `install.sh`
from the release, runs it three ways — no `GELADA_VERSION`, `vX.Y.Z`, and
`X.Y.Z` — and fails unless each one leaves behind a binary that reports the
version being released. It runs on macOS inside the release job and on Linux
straight after, which is the only place a `linux` binary is ever executed. You
can run it against any published release yourself:

```bash
bash scripts/verify-install.sh 0.1.5
```

This exists because `install.sh` requested an archive name no release has ever
carried, from 0.1.0 through 0.1.3, and no test noticed — nothing ran it. Adding
an installer flag, renaming an asset, or changing how a tag is resolved should
all fail here rather than in someone's terminal.

The whole pipeline is one workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
so that a single change is tested exactly once: pull requests are verified by
the `pull_request` event, and pushes are restricted to `main`. Adding a second
workflow, or widening the push trigger to all branches, brings back the
duplicate runs this consolidation removed.

### One-time setup: npm trusted publishing

Publishing authenticates with a short-lived OIDC token rather than a stored
`NPM_TOKEN`, so there is no publish credential in this repository to leak or
rotate. This requires the package to be configured once on npm:

**npmjs.com → `gelada-mcp` → Settings → Trusted publishers → GitHub Actions**,
with organization/repository `pcherkasov/gelada-mcp` and workflow `ci.yml`.

Until that is configured, the publish step fails with an authentication error
while everything before it still succeeds.

## Reporting security issues

Do not open a public pull request or issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md) instead.
