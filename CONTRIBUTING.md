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

## Reporting security issues

Do not open a public pull request or issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md) instead.
