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

1. Create a descriptive feature branch (`git checkout -b feature/my-feature`).
2. Verify all tests pass locally (`npm test`).
3. Commit your changes following clean git commit messages.
4. Push your branch and open a Pull Request against `main`.
