import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

import { GeladaError } from '../errors.js';

export type RepositoryInspectorErrorCode =
  | 'INVALID_INPUT'
  | 'PATH_TRAVERSAL'
  | 'PROTECTED_PATH'
  | 'GIT_NOT_FOUND'
  | 'NOT_A_GIT_REPO'
  | 'GIT_EXEC_FAILED'
  | 'FILE_NOT_FOUND'
  | 'FS_ACCESS_ERROR';

export class RepositoryInspectorError extends GeladaError {
  public readonly code: RepositoryInspectorErrorCode;
  public readonly cause?: unknown;

  constructor(message: string, code: RepositoryInspectorErrorCode, cause?: unknown) {
    super(message);
    this.name = 'RepositoryInspectorError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, RepositoryInspectorError.prototype);
  }
}

export interface FileStatus {
  path: string;
  status: 'modified' | 'staged' | 'untracked' | 'deleted' | 'renamed' | 'copied' | 'unmerged';
  stagedStatus?: string;
  unstagedStatus?: string;
  oldPath?: string;
}

export interface FileCheckResult {
  path: string;
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  sizeBytes?: number;
  modifiedTimeMs?: number;
  error?: string;
}

export interface GitStatusInfo {
  branch: string;
  isDetached: boolean;
  commitHash: string;
  shortCommitHash: string;
  commitSubject?: string;
  commitDate?: string;
  isClean: boolean;
  hasUntrackedFiles: boolean;
  stagedFiles: FileStatus[];
  modifiedFiles: FileStatus[];
  untrackedFiles: string[];
  deletedFiles: string[];
  unmergedFiles: string[];
  totalChangedFiles: number;
}

export interface RepoSnapshot {
  repoPath: string;
  timestamp: number;
  gitStatus: GitStatusInfo;
  checkedFiles?: Record<string, FileCheckResult>;
}

export interface RepoStateDiff {
  repoPath: string;
  beforeCommit: string;
  afterCommit: string;
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  untrackedAdded: string[];
  isIdentical: boolean;
}

export interface RepoReadyOptions {
  requireClean?: boolean;
  allowUntracked?: boolean;
  checkFiles?: string[];
}

export interface RepoValidationResult {
  valid: boolean;
  isGitRepo: boolean;
  isClean: boolean;
  missingRequiredFiles: string[];
  errors: string[];
  warnings: string[];
  gitStatus?: GitStatusInfo;
}

export interface RepoState {
  isClean: boolean;
  currentBranch: string;
  hasUntrackedFiles: boolean;
  repoPath: string;
}

export interface DetailedRepoState extends RepoState {
  commitHash: string;
  shortCommitHash: string;
  isDetached: boolean;
  gitStatus: GitStatusInfo;
  checkedFiles?: FileCheckResult[];
}

function unquotePath(str: string): string {
  let s = str.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.substring(1, s.length - 1);
    s = s
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');
  }
  return s;
}

export class RepositoryInspector {
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
        throw new RepositoryInspectorError(
          'Git CLI binary not found in PATH.',
          'GIT_NOT_FOUND',
          err,
        );
      }
      const stderr = gitErr.stderr ? gitErr.stderr.toString().trim() : gitErr.message || '';
      if (stderr.includes('not a git repository')) {
        throw new RepositoryInspectorError(
          `Directory '${cwd}' is not a Git repository.`,
          'NOT_A_GIT_REPO',
          err,
        );
      }
      throw new RepositoryInspectorError(
        `Git command failed: git ${args.join(' ')}\nStderr: ${stderr}`,
        'GIT_EXEC_FAILED',
        err,
      );
    }
  }

  public async getGitStatus(repoPath: string): Promise<GitStatusInfo> {
    if (!repoPath || typeof repoPath !== 'string' || repoPath.trim() === '') {
      throw new RepositoryInspectorError(
        'Repository path must be a non-empty string.',
        'INVALID_INPUT',
      );
    }

    const normalizedPath = path.resolve(repoPath.trim());

    try {
      const stat = await fs.stat(normalizedPath);
      if (!stat.isDirectory()) {
        throw new RepositoryInspectorError(
          `Path '${normalizedPath}' is not a directory.`,
          'INVALID_INPUT',
        );
      }
    } catch (err: any) {
      if (err instanceof RepositoryInspectorError) throw err;
      if (err.code === 'ENOENT') {
        throw new RepositoryInspectorError(
          `Repository directory '${normalizedPath}' does not exist.`,
          'FILE_NOT_FOUND',
          err,
        );
      }
      throw new RepositoryInspectorError(
        `Failed to access path '${normalizedPath}': ${err.message}`,
        'FS_ACCESS_ERROR',
        err,
      );
    }

    // 1. Verify Git repo
    await this.execGit(['rev-parse', '--is-inside-work-tree'], normalizedPath);

    // 2. Branch & Commit Hash
    let branch = 'main';
    let isDetached = false;
    try {
      const { stdout: branchOut } = await this.execGit(
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        normalizedPath,
      );
      const trimmedBranch = branchOut.trim();
      if (trimmedBranch === 'HEAD') {
        try {
          const { stdout: symOut } = await this.execGit(
            ['symbolic-ref', '--short', 'HEAD'],
            normalizedPath,
          );
          branch = symOut.trim();
          isDetached = false;
        } catch {
          branch = 'HEAD';
          isDetached = true;
        }
      } else {
        branch = trimmedBranch;
        isDetached = false;
      }
    } catch {
      try {
        const { stdout: symOut } = await this.execGit(
          ['symbolic-ref', '--short', 'HEAD'],
          normalizedPath,
        );
        branch = symOut.trim();
      } catch {
        branch = 'main';
      }
      isDetached = false;
    }

    let commitHash = '';
    let shortCommitHash = '';
    let commitSubject = '';
    let commitDate = '';

    try {
      const { stdout: commitOut } = await this.execGit(['rev-parse', 'HEAD'], normalizedPath);
      commitHash = commitOut.trim();
      shortCommitHash = commitHash.substring(0, 7);

      const { stdout: logOut } = await this.execGit(
        ['log', '-1', '--format=%s|%cI'],
        normalizedPath,
      );
      const [subj, dt] = logOut.trim().split('|');
      commitSubject = subj || '';
      commitDate = dt || '';
    } catch {
      // Empty repository without commits
    }

    // 3. Porcelain Status
    const { stdout: statusOut } = await this.execGit(['status', '--porcelain=v1'], normalizedPath);
    const lines = statusOut.split('\n').filter((l) => l.length > 0);

    const stagedFiles: FileStatus[] = [];
    const modifiedFiles: FileStatus[] = [];
    const untrackedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const unmergedFiles: string[] = [];

    const conflictCodes = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']);

    for (const line of lines) {
      const stagedCode = line[0];
      const unstagedCode = line[1];
      const rawPathStr = line.substring(3).trim();

      let filePath = rawPathStr;
      let oldPath: string | undefined = undefined;

      if (rawPathStr.includes(' -> ')) {
        const arrowIndex = rawPathStr.indexOf(' -> ');
        oldPath = unquotePath(rawPathStr.substring(0, arrowIndex));
        filePath = unquotePath(rawPathStr.substring(arrowIndex + 4));
      } else {
        filePath = unquotePath(rawPathStr);
      }

      if (stagedCode === '?' && unstagedCode === '?') {
        untrackedFiles.push(filePath);
        continue;
      }

      const statusCodePair = stagedCode + unstagedCode;
      if (stagedCode === 'U' || unstagedCode === 'U' || conflictCodes.has(statusCodePair)) {
        unmergedFiles.push(filePath);
        stagedFiles.push({
          path: filePath,
          status: 'unmerged',
          stagedStatus: stagedCode,
          unstagedStatus: unstagedCode,
          oldPath,
        });
        continue;
      }

      if (stagedCode !== ' ' && stagedCode !== '?') {
        let status: FileStatus['status'] = 'modified';
        if (stagedCode === 'A') status = 'staged';
        if (stagedCode === 'D') status = 'deleted';
        if (stagedCode === 'R') status = 'renamed';
        if (stagedCode === 'C') status = 'copied';
        stagedFiles.push({
          path: filePath,
          status,
          stagedStatus: stagedCode,
          unstagedStatus: unstagedCode,
          oldPath,
        });
        if (stagedCode === 'D' && !deletedFiles.includes(filePath)) {
          deletedFiles.push(filePath);
        }
      }

      if (unstagedCode !== ' ' && unstagedCode !== '?') {
        if (unstagedCode === 'D') {
          if (!deletedFiles.includes(filePath)) {
            deletedFiles.push(filePath);
          }
        } else {
          modifiedFiles.push({
            path: filePath,
            status: 'modified',
            stagedStatus: stagedCode,
            unstagedStatus: unstagedCode,
            oldPath,
          });
        }
      }
    }

    const isClean =
      stagedFiles.length === 0 &&
      modifiedFiles.length === 0 &&
      deletedFiles.length === 0 &&
      unmergedFiles.length === 0;

    return {
      branch,
      isDetached,
      commitHash,
      shortCommitHash,
      commitSubject,
      commitDate,
      isClean,
      hasUntrackedFiles: untrackedFiles.length > 0,
      stagedFiles,
      modifiedFiles,
      untrackedFiles,
      deletedFiles,
      unmergedFiles,
      totalChangedFiles: lines.length,
    };
  }

  public async checkFilesExist(repoPath: string, filePaths: string[]): Promise<FileCheckResult[]> {
    if (!repoPath || typeof repoPath !== 'string' || repoPath.trim() === '') {
      throw new RepositoryInspectorError(
        'Repository path must be a non-empty string.',
        'INVALID_INPUT',
      );
    }
    if (!Array.isArray(filePaths)) {
      throw new RepositoryInspectorError('filePaths must be an array of strings.', 'INVALID_INPUT');
    }

    const rootAbs = path.resolve(repoPath.trim());
    const results: FileCheckResult[] = [];

    for (const rawPath of filePaths) {
      if (!rawPath || typeof rawPath !== 'string' || rawPath.trim() === '') {
        results.push({
          path: rawPath,
          exists: false,
          isFile: false,
          isDirectory: false,
          isSymlink: false,
          error: 'Path must be a non-empty string',
        });
        continue;
      }

      const targetAbs = path.resolve(rootAbs, rawPath);
      const rel = path.relative(rootAbs, targetAbs);
      const isInside = targetAbs === rootAbs || targetAbs.startsWith(rootAbs + path.sep);

      if (!isInside || rel.startsWith('..') || path.isAbsolute(rel)) {
        results.push({
          path: rawPath,
          exists: false,
          isFile: false,
          isDirectory: false,
          isSymlink: false,
          error: 'Path traversal attempt detected',
        });
        continue;
      }

      try {
        const lstat = await fs.lstat(targetAbs);
        const isSymlink = lstat.isSymbolicLink();
        let isFile = false;
        let isDirectory = false;
        let sizeBytes: number | undefined = lstat.size;
        let modifiedTimeMs: number | undefined = lstat.mtimeMs;
        let error: string | undefined = undefined;

        if (isSymlink) {
          try {
            const stat = await fs.stat(targetAbs);
            isFile = stat.isFile();
            isDirectory = stat.isDirectory();
            sizeBytes = stat.size;
            modifiedTimeMs = stat.mtimeMs;
          } catch {
            // Broken symbolic link
            isFile = false;
            isDirectory = false;
            error = 'Broken symbolic link';
          }
        } else {
          isFile = lstat.isFile();
          isDirectory = lstat.isDirectory();
        }

        results.push({
          path: rel || rawPath,
          exists: true,
          isFile,
          isDirectory,
          isSymlink,
          sizeBytes,
          modifiedTimeMs,
          error,
        });
      } catch (err: any) {
        results.push({
          path: rel || rawPath,
          exists: false,
          isFile: false,
          isDirectory: false,
          isSymlink: false,
          error: err.code === 'ENOENT' ? undefined : err.message || String(err),
        });
      }
    }

    return results;
  }

  public async inspectRepo(repoPath: string, checkFiles?: string[]): Promise<DetailedRepoState> {
    if (!repoPath || typeof repoPath !== 'string' || repoPath.trim() === '') {
      throw new RepositoryInspectorError(
        'Repository path must be a non-empty string.',
        'INVALID_INPUT',
      );
    }

    const normalizedPath = path.resolve(repoPath.trim());

    try {
      const gitStatus = await this.getGitStatus(normalizedPath);
      const checkedFiles =
        checkFiles && checkFiles.length > 0
          ? await this.checkFilesExist(normalizedPath, checkFiles)
          : undefined;

      return {
        isClean: gitStatus.isClean,
        currentBranch: gitStatus.branch,
        hasUntrackedFiles: gitStatus.hasUntrackedFiles,
        repoPath: normalizedPath,
        commitHash: gitStatus.commitHash,
        shortCommitHash: gitStatus.shortCommitHash,
        isDetached: gitStatus.isDetached,
        gitStatus,
        checkedFiles,
      };
    } catch (err: any) {
      if (err instanceof RepositoryInspectorError && err.code === 'NOT_A_GIT_REPO') {
        const checkedFiles =
          checkFiles && checkFiles.length > 0
            ? await this.checkFilesExist(normalizedPath, checkFiles)
            : undefined;

        return {
          isClean: false,
          currentBranch: 'none',
          hasUntrackedFiles: false,
          repoPath: normalizedPath,
          commitHash: '',
          shortCommitHash: '',
          isDetached: false,
          gitStatus: {
            branch: 'none',
            isDetached: false,
            commitHash: '',
            shortCommitHash: '',
            isClean: false,
            hasUntrackedFiles: false,
            stagedFiles: [],
            modifiedFiles: [],
            untrackedFiles: [],
            deletedFiles: [],
            unmergedFiles: [],
            totalChangedFiles: 0,
          },
          checkedFiles,
        };
      }
      throw err;
    }
  }

  public async captureSnapshot(repoPath: string, checkFiles?: string[]): Promise<RepoSnapshot> {
    if (!repoPath || typeof repoPath !== 'string' || repoPath.trim() === '') {
      throw new RepositoryInspectorError(
        'Repository path must be a non-empty string.',
        'INVALID_INPUT',
      );
    }

    const normalizedPath = path.resolve(repoPath.trim());
    const gitStatus = await this.getGitStatus(normalizedPath);
    let checkedFilesMap: Record<string, FileCheckResult> | undefined;

    if (checkFiles && checkFiles.length > 0) {
      const fileResults = await this.checkFilesExist(normalizedPath, checkFiles);
      checkedFilesMap = {};
      for (const res of fileResults) {
        checkedFilesMap[res.path] = res;
      }
    }

    return {
      repoPath: normalizedPath,
      timestamp: Date.now(),
      gitStatus,
      checkedFiles: checkedFilesMap,
    };
  }

  public async compareSnapshots(before: RepoSnapshot, after: RepoSnapshot): Promise<RepoStateDiff> {
    if (!before || !after || !before.gitStatus || !after.gitStatus) {
      throw new RepositoryInspectorError(
        'Valid before and after snapshots are required for comparison.',
        'INVALID_INPUT',
      );
    }

    const isIdenticalCommit = before.gitStatus.commitHash === after.gitStatus.commitHash;

    const beforeUntracked = new Set(before.gitStatus.untrackedFiles || []);
    const untrackedAdded = (after.gitStatus.untrackedFiles || []).filter(
      (f) => !beforeUntracked.has(f),
    );

    const beforeStagedAdded = new Set(
      (before.gitStatus.stagedFiles || [])
        .filter((f) => f.status === 'staged' || f.stagedStatus === 'A')
        .map((f) => f.path),
    );
    const addedFiles = (after.gitStatus.stagedFiles || [])
      .filter((f) => f.status === 'staged' || f.stagedStatus === 'A')
      .map((f) => f.path)
      .filter((f) => !beforeStagedAdded.has(f));

    const beforeDeleted = new Set(before.gitStatus.deletedFiles || []);
    const deletedFiles = (after.gitStatus.deletedFiles || []).filter((f) => !beforeDeleted.has(f));

    const beforeModMap = new Map<
      string,
      { status: string; stagedStatus?: string; unstagedStatus?: string }
    >();
    for (const f of before.gitStatus.modifiedFiles || []) {
      beforeModMap.set(f.path, f);
    }
    for (const f of before.gitStatus.stagedFiles || []) {
      if (f.status === 'modified' || f.stagedStatus === 'M' || f.unstagedStatus === 'M') {
        beforeModMap.set(f.path, f);
      }
    }

    const afterModFiles = new Map<string, FileStatus>();
    for (const f of after.gitStatus.modifiedFiles || []) {
      afterModFiles.set(f.path, f);
    }
    for (const f of after.gitStatus.stagedFiles || []) {
      if (f.status === 'modified' || f.stagedStatus === 'M' || f.unstagedStatus === 'M') {
        afterModFiles.set(f.path, f);
      }
    }

    const modifiedFiles: string[] = [];
    for (const [p, afterFile] of afterModFiles.entries()) {
      const beforeFile = beforeModMap.get(p);
      if (!beforeFile) {
        modifiedFiles.push(p);
      } else {
        const statusChanged =
          beforeFile.stagedStatus !== afterFile.stagedStatus ||
          beforeFile.unstagedStatus !== afterFile.unstagedStatus ||
          beforeFile.status !== afterFile.status;

        const beforeCheck = before.checkedFiles?.[p];
        const afterCheck = after.checkedFiles?.[p];
        const timeChanged =
          beforeCheck && afterCheck
            ? beforeCheck.modifiedTimeMs !== afterCheck.modifiedTimeMs ||
              beforeCheck.sizeBytes !== afterCheck.sizeBytes
            : false;

        if (statusChanged || timeChanged) {
          modifiedFiles.push(p);
        }
      }
    }

    const isIdentical =
      isIdenticalCommit &&
      untrackedAdded.length === 0 &&
      addedFiles.length === 0 &&
      modifiedFiles.length === 0 &&
      deletedFiles.length === 0;

    return {
      repoPath: after.repoPath,
      beforeCommit: before.gitStatus.commitHash,
      afterCommit: after.gitStatus.commitHash,
      addedFiles,
      modifiedFiles,
      deletedFiles,
      untrackedAdded,
      isIdentical,
    };
  }

  public async validateRepoReady(
    repoPath: string,
    options?: RepoReadyOptions,
  ): Promise<RepoValidationResult> {
    if (!repoPath || typeof repoPath !== 'string' || repoPath.trim() === '') {
      throw new RepositoryInspectorError(
        'Repository path must be a non-empty string.',
        'INVALID_INPUT',
      );
    }

    const normalizedPath = path.resolve(repoPath.trim());
    const errors: string[] = [];
    const warnings: string[] = [];
    let isGitRepo = false;
    let isClean = false;
    let gitStatus: GitStatusInfo | undefined;
    const missingRequiredFiles: string[] = [];

    try {
      gitStatus = await this.getGitStatus(normalizedPath);
      isGitRepo = true;
      isClean = gitStatus.isClean;

      if (options?.requireClean && !isClean) {
        errors.push(`Repository at '${normalizedPath}' has uncommitted changes (dirty state).`);
      }

      if (!options?.allowUntracked && gitStatus.hasUntrackedFiles) {
        warnings.push(
          `Repository at '${normalizedPath}' has ${gitStatus.untrackedFiles.length} untracked file(s).`,
        );
      }
    } catch (err: any) {
      if (err instanceof RepositoryInspectorError && err.code === 'NOT_A_GIT_REPO') {
        errors.push(`Directory '${normalizedPath}' is not a valid Git repository.`);
      } else {
        errors.push(`Failed to inspect Git status at '${normalizedPath}': ${err.message}`);
      }
    }

    if (options?.checkFiles && options.checkFiles.length > 0) {
      const fileChecks = await this.checkFilesExist(normalizedPath, options.checkFiles);
      for (const fc of fileChecks) {
        if (!fc.exists) {
          missingRequiredFiles.push(fc.path);
          errors.push(`Required file missing: '${fc.path}'`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      isGitRepo,
      isClean,
      missingRequiredFiles,
      errors,
      warnings,
      gitStatus,
    };
  }
}
