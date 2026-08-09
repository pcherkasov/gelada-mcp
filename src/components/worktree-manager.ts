import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

import { GeladaError } from '../errors.js';

export type WorktreeErrorCode =
  | 'INVALID_INPUT'
  | 'GIT_NOT_FOUND'
  | 'NOT_A_GIT_REPO'
  | 'WORKTREE_EXISTS'
  | 'WORKTREE_NOT_FOUND'
  | 'GIT_EXEC_FAILED';

export class WorktreeError extends GeladaError {
  public readonly code: WorktreeErrorCode;
  public readonly cause?: unknown;

  constructor(message: string, code: WorktreeErrorCode, cause?: unknown) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, WorktreeError.prototype);
  }
}

export interface WorktreeInfo {
  worktreeId: string;
  path: string;
  branch: string;
  createdAt: number;
  baseCommit: string;
  repoPath: string;
}

export interface CreateWorktreeOptions {
  baseCommit?: string;
  repoPath?: string;
  baseWorktreeDir?: string;
}

export interface WorktreeManagerOptions {
  repoRoot?: string;
  worktreesDir?: string;
}

export interface RemoveWorktreeOptions {
  force?: boolean;
  retainOnFailure?: boolean;
}

export interface WorktreeDiffResult {
  worktreeId: string;
  rawDiff: string;
  baseCommit: string;
  changedFiles: string[];
  stat: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export class WorktreeManager {
  private repoRoot: string;
  private worktreesDir: string;
  private worktrees: Map<string, WorktreeInfo> = new Map();

  constructor(options?: WorktreeManagerOptions) {
    this.repoRoot = options?.repoRoot ? path.resolve(options.repoRoot) : process.cwd();
    this.worktreesDir = options?.worktreesDir
      ? path.resolve(options.worktreesDir)
      : path.resolve(this.repoRoot, '.worktrees');
  }

  private async execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          LANG: 'C',
        },
      });
      return { stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (err: unknown) {
      const gitErr = err as { code?: string; stderr?: string | Buffer; message?: string };
      if (gitErr.code === 'ENOENT') {
        throw new WorktreeError('Git CLI binary not found in system PATH.', 'GIT_NOT_FOUND', err);
      }
      const stderr = gitErr.stderr ? gitErr.stderr.toString().trim() : gitErr.message || '';
      if (stderr.includes('not a git repository')) {
        throw new WorktreeError(
          `Directory '${cwd}' is not a Git repository.`,
          'NOT_A_GIT_REPO',
          err,
        );
      }
      throw new WorktreeError(
        `Git command failed: git ${args.join(' ')}\nStderr: ${stderr}`,
        'GIT_EXEC_FAILED',
        err,
      );
    }
  }

  public async createWorktree(
    taskSlug: string,
    options?: CreateWorktreeOptions,
  ): Promise<WorktreeInfo> {
    if (!taskSlug || typeof taskSlug !== 'string' || taskSlug.trim().length === 0) {
      throw new WorktreeError('Task slug must be a non-empty string', 'INVALID_INPUT');
    }

    const safeSlug = taskSlug.trim().replace(/[^a-zA-Z0-9_-]/g, '-') || `task-${Date.now()}`;
    const worktreeId = `wt-${safeSlug}`;
    const repoPath = options?.repoPath ? path.resolve(options.repoPath) : this.repoRoot;
    const baseWorktreeDir = options?.baseWorktreeDir || '.worktrees';
    const absoluteWorktreesDir = path.isAbsolute(baseWorktreeDir)
      ? baseWorktreeDir
      : path.resolve(repoPath, baseWorktreeDir);
    const absWorktreePath = path.resolve(absoluteWorktreesDir, safeSlug);

    // Path traversal check
    if (!absWorktreePath.startsWith(absoluteWorktreesDir)) {
      throw new WorktreeError('Invalid task slug: path traversal detected', 'INVALID_INPUT');
    }

    // Verify git repo
    await this.execGit(['rev-parse', '--is-inside-work-tree'], repoPath);

    // Resolve base commit SHA
    const commitArg = options?.baseCommit || 'HEAD';
    const { stdout: commitHash } = await this.execGit(['rev-parse', commitArg], repoPath);
    const baseCommit = commitHash.trim();

    // Ensure base worktrees directory exists
    await fs.mkdir(absoluteWorktreesDir, { recursive: true });

    // Prune orphan worktrees before creation
    await this.execGit(['worktree', 'prune'], repoPath).catch(() => {});

    // Create detached worktree
    await this.execGit(['worktree', 'add', '--detach', absWorktreePath, baseCommit], repoPath);

    const branch = `worktree/${safeSlug}`;
    const infoPath =
      options?.baseWorktreeDir || !options?.repoPath
        ? `${baseWorktreeDir}/${safeSlug}`
        : absWorktreePath;

    const info: WorktreeInfo = {
      worktreeId,
      path: infoPath,
      branch,
      createdAt: Date.now(),
      baseCommit,
      repoPath,
    };

    this.worktrees.set(worktreeId, info);
    return info;
  }

  public async getDiff(worktreeId: string): Promise<string> {
    const info = this.getWorktree(worktreeId);
    if (!info) {
      throw new WorktreeError(`Worktree not found: ${worktreeId}`, 'WORKTREE_NOT_FOUND');
    }

    const absPath = path.isAbsolute(info.path) ? info.path : path.resolve(info.repoPath, info.path);

    // Stage all untracked and modified files in the worktree
    await this.execGit(['add', '-A'], absPath);

    // Collect full diff against base commit
    const { stdout: rawDiff } = await this.execGit(['diff', info.baseCommit], absPath);
    return rawDiff;
  }

  public async getDiffDetails(worktreeId: string): Promise<WorktreeDiffResult> {
    const info = this.getWorktree(worktreeId);
    if (!info) {
      throw new WorktreeError(`Worktree not found: ${worktreeId}`, 'WORKTREE_NOT_FOUND');
    }

    const absPath = path.isAbsolute(info.path) ? info.path : path.resolve(info.repoPath, info.path);

    await this.execGit(['add', '-A'], absPath);

    const { stdout: rawDiff } = await this.execGit(['diff', info.baseCommit], absPath);
    const { stdout: filesOutput } = await this.execGit(
      ['diff', '--name-only', info.baseCommit],
      absPath,
    );
    const changedFiles = filesOutput.trim().split('\n').filter(Boolean);

    return {
      worktreeId,
      rawDiff,
      baseCommit: info.baseCommit,
      changedFiles,
      stat: {
        filesChanged: changedFiles.length,
        insertions: 0,
        deletions: 0,
      },
    };
  }

  public async removeWorktree(worktreeId: string, options?: RemoveWorktreeOptions): Promise<void> {
    const info = this.worktrees.get(worktreeId);
    const infoPath = info ? info.path : `${this.worktreesDir}/${worktreeId.replace(/^wt-/, '')}`;
    const repoPath = info ? info.repoPath : this.repoRoot;
    const absPath = path.isAbsolute(infoPath) ? infoPath : path.resolve(repoPath, infoPath);

    if (options?.retainOnFailure) {
      console.warn(`[WorktreeManager] Retaining worktree at ${absPath} for diagnostics.`);
      this.worktrees.delete(worktreeId);
      return;
    }

    // Step 1: git worktree remove --force
    await this.execGit(['worktree', 'remove', '--force', absPath], repoPath).catch(() => {});

    // Step 2: Fallback filesystem removal
    await fs.rm(absPath, { recursive: true, force: true }).catch(() => {});

    // Step 3: git worktree prune
    await this.execGit(['worktree', 'prune'], repoPath).catch(() => {});

    // Step 4: Branch cleanup if branch exists
    if (info?.branch) {
      await this.execGit(['branch', '-D', info.branch], repoPath).catch(() => {});
    }

    this.worktrees.delete(worktreeId);
  }

  public getWorktree(worktreeId: string): WorktreeInfo | undefined {
    return this.worktrees.get(worktreeId);
  }

  public listWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }
}
