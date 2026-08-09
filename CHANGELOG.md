# Changelog

All notable changes to the **Gelada MCP** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-29

### Added
- **5 Core MCP Tools**: `delegate_task`, `revise_task`, `inspect_task`, `discard_task`, `doctor`.
- **4-Tier Security Policy Engine**: Project policy file support (`.gelada/policy.yaml`), 4-tier security hierarchy, and environment variable sanitization (Requirement R1).
- **Git Worktree Isolation**: Base commit SHA binding and isolated worktree management (`.worktrees/task-XXXX`).
- **17 Granular Task States**: Fine-grained task lifecycle tracking (`CREATED`, `VALIDATING`, `PREPARING`, `READY`, `RUNNING`, `COLLECTING`, `VERIFYING`, `COMPLETED`, `COMPLETED_WITH_WARNINGS`, `REVISION_REQUIRED`, `FAILED_CONTRACT`, `FAILED_WORKER`, `FAILED_POLICY`, `FAILED_VERIFICATION`, `AUTH_REQUIRED`, `CANCELLED`, `DISCARDED`).
- **CLI Commands**: `gelada setup`, `gelada doctor`, `gelada config`, `gelada task`, `gelada cleanup`, `gelada models`, `gelada update`.
- **Public E2E Test Suite**: Integration test coverage for full delegation lifecycle (Requirement R6).
- **Documentation**: Leader agent instructions in `docs/instructions/`, `SECURITY.md`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
