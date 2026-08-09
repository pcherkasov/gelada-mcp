import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseDiskSize } from './policy-engine.js';
import {
  GranularTaskState,
  LegacyTaskStatus,
  StateTransition,
  TaskErrorDetails,
  TaskTimestamps,
  mapGranularToLegacyStatus,
  mapLegacyToGranularStatus,
} from '../types/task.js';

export { parseDiskSize };

export interface RetentionPolicy {
  maxRuns?: number;
  maxAgeDays?: number;
  maxTotalSize?: number | string;
  maxDiskSize?: number | string;
  maxDiskSizeBytes?: number;
}

export interface CleanupSummary {
  deletedBundles: string[];
  deletedCount: number;
  freedBytes: number;
  remainingBundles: number;
}

export type CleanupResult = CleanupSummary;

export interface TaskBundleDetails {
  taskId: string;
  dirPath: string;
  createdAt: number;
  totalSizeBytes: number;
}

export interface ArtifactMeta {
  artifactId: string;
  taskId?: string;
  filename: string;
  path: string;
  relativePath: string;
  createdAt: number;
  sizeBytes: number;
  contentType: string;
  category:
    | 'metadata' | 'contract' | 'prompt' | 'diff' | 'log' | 'verification' | 'summary' | 'custom';
}

export interface TaskExecutionMetadata {
  taskId: string;
  status: LegacyTaskStatus;
  granularStatus?: GranularTaskState;
  stateHistory?: StateTransition[];
  errorDetails?: TaskErrorDetails;
  timestamps?: TaskTimestamps;
  taskType: string;
  objective: string;
  repoPath: string;
  createdAt: number;
  updatedAt: number;
  revisions: number;
  changedFiles: string[];
  totalSizeBytes: number;
  artifacts: ArtifactMeta[];
}

export interface SaveArtifactOptions {
  taskId?: string;
  category?: ArtifactMeta['category'];
  contentType?: string;
  filename?: string;
  overwrite?: boolean;
}

export interface ArtifactManagerOptions {
  repoRoot?: string;
  artifactsDir?: string;
}

export interface TaskArtifactInput {
  taskContract?: object | string;
  prompt?: string;
  patch?: string;
  workerStdout?: string;
  workerStderr?: string;
  verificationResults?: object | string;
  executionSummary?: object | string;
  status?: LegacyTaskStatus;
  granularStatus?: GranularTaskState;
  stateHistory?: StateTransition[];
  errorDetails?: TaskErrorDetails;
  timestamps?: TaskTimestamps;
  taskType?: string;
  objective?: string;
  repoPath?: string;
  changedFiles?: string[];
  revisions?: number;
}

import { GeladaError } from '../errors.js';

export type ArtifactErrorCode = 'INVALID_INPUT' | 'PATH_TRAVERSAL' | 'NOT_FOUND' | 'FS_ERROR';

export class ArtifactError extends GeladaError {
  public readonly code: ArtifactErrorCode;
  public readonly cause?: unknown;

  constructor(message: string, code: ArtifactErrorCode, cause?: unknown) {
    super(message);
    this.name = 'ArtifactError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, ArtifactError.prototype);
  }
}

function inferCategory(filename: string): ArtifactMeta['category'] {
  const lower = filename.toLowerCase();
  if (lower.includes('contract')) return 'contract';
  if (lower.includes('prompt')) return 'prompt';
  if (lower.includes('patch') || lower.endsWith('.diff')) return 'diff';
  if (lower.includes('log') || lower.endsWith('.log')) return 'log';
  if (lower.includes('verification')) return 'verification';
  if (lower.includes('summary')) return 'summary';
  if (lower.includes('metadata')) return 'metadata';
  return 'custom';
}

function inferContentType(filename: string, content: any): string {
  if (
    filename.endsWith('.json') ||
    (typeof content === 'object' && content !== null && !Buffer.isBuffer(content))
  ) {
    return 'application/json';
  }
  if (filename.endsWith('.diff') || filename.endsWith('.patch')) {
    return 'text/x-diff';
  }
  if (Buffer.isBuffer(content)) {
    return 'application/octet-stream';
  }
  return 'text/plain';
}

function sanitizeName(str: string): string {
  return str.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export class ArtifactManager {
  public readonly repoRoot: string;
  public readonly artifactsDir: string;

  constructor(options?: ArtifactManagerOptions) {
    this.repoRoot = path.resolve(options?.repoRoot?.trim() || process.cwd());

    if (options?.artifactsDir) {
      this.artifactsDir = path.isAbsolute(options.artifactsDir)
        ? path.resolve(options.artifactsDir)
        : path.resolve(this.repoRoot, options.artifactsDir);
    } else {
      this.artifactsDir = path.resolve(this.repoRoot, '.gelada/artifacts');
    }
  }

  private isInsideArtifactsDir(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return resolved === this.artifactsDir || resolved.startsWith(this.artifactsDir + path.sep);
  }

  private isValidArtifactMeta(parsed: unknown): parsed is ArtifactMeta {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    const meta = parsed as Record<string, unknown>;
    if (typeof meta.artifactId !== 'string' || meta.artifactId.trim() === '') {
      return false;
    }
    if (typeof meta.sizeBytes !== 'number' || Number.isNaN(meta.sizeBytes)) {
      return false;
    }
    if (typeof meta.path === 'string') {
      const resolvedPath = path.resolve(meta.path);
      if (!this.isInsideArtifactsDir(resolvedPath) || resolvedPath === this.artifactsDir) {
        return false;
      }
    }
    return true;
  }

  private validateId(id: string | undefined | null, paramName: string): string {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      throw new ArtifactError(`${paramName} must be a non-empty string.`, 'INVALID_INPUT');
    }

    const trimmed = id.trim();
    if (trimmed.includes('..') || trimmed.includes('\0')) {
      throw new ArtifactError(`Path traversal attempt detected in ${paramName}.`, 'PATH_TRAVERSAL');
    }

    return trimmed;
  }

  public getTaskArtifactDir(taskId: string): string {
    const cleanTaskId = this.validateId(taskId, 'taskId');
    const sanitized = sanitizeName(cleanTaskId);

    if (sanitized === '.' || sanitized === '..' || sanitized.trim() === '') {
      throw new ArtifactError('Invalid task ID', 'INVALID_INPUT');
    }

    const targetDir = path.resolve(this.artifactsDir, sanitized);

    if (targetDir === this.artifactsDir) {
      throw new ArtifactError('Invalid task ID', 'INVALID_INPUT');
    }

    if (!this.isInsideArtifactsDir(targetDir)) {
      throw new ArtifactError('Path traversal attempt detected.', 'PATH_TRAVERSAL');
    }

    return targetDir;
  }

  public getArtifactPath(artifactId: string, taskId?: string): string {
    const cleanArtId = this.validateId(artifactId, 'artifactId');
    const parentDir = taskId
      ? this.getTaskArtifactDir(taskId)
      : path.resolve(this.artifactsDir, '_generic');

    let filename = sanitizeName(cleanArtId);
    if (!filename.includes('.')) {
      filename += '.json';
    }

    const targetPath = path.resolve(parentDir, filename);

    if (!this.isInsideArtifactsDir(targetPath)) {
      throw new ArtifactError('Path traversal attempt detected.', 'PATH_TRAVERSAL');
    }

    return targetPath;
  }

  private async atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    try {
      await fs.writeFile(tmpPath, content);
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }

  public async saveArtifact(
    artifactId: string,
    content: string | Buffer | object,
    options?: SaveArtifactOptions,
  ): Promise<ArtifactMeta> {
    const cleanArtId = this.validateId(artifactId, 'artifactId');
    const taskId = options?.taskId ? this.validateId(options.taskId, 'taskId') : undefined;

    if (options?.filename) {
      this.validateId(options.filename, 'filename');
      const baseName = path.basename(options.filename);
      if (baseName === '.' || baseName === '..') {
        throw new ArtifactError('Invalid filename.', 'INVALID_INPUT');
      }
    }

    const parentDir = taskId
      ? this.getTaskArtifactDir(taskId)
      : path.resolve(this.artifactsDir, '_generic');

    let filename = options?.filename
      ? sanitizeName(path.basename(options.filename))
      : sanitizeName(cleanArtId);

    if (filename === '.' || filename === '..' || filename.trim() === '') {
      throw new ArtifactError('Invalid filename.', 'INVALID_INPUT');
    }

    if (!filename.includes('.')) {
      if (typeof content === 'object' && content !== null && !Buffer.isBuffer(content)) {
        filename += '.json';
      } else if (options?.contentType === 'application/json') {
        filename += '.json';
      } else {
        filename += '.txt';
      }
    }

    const targetPath = path.resolve(parentDir, filename);
    if (!this.isInsideArtifactsDir(targetPath) || targetPath === this.artifactsDir) {
      throw new ArtifactError('Path traversal attempt detected.', 'PATH_TRAVERSAL');
    }

    let serialized: string | Buffer;
    if (Buffer.isBuffer(content) || typeof content === 'string') {
      serialized = content;
    } else {
      serialized = JSON.stringify(content, null, 2);
    }

    const sizeBytes = Buffer.isBuffer(serialized)
      ? serialized.length
      : Buffer.byteLength(serialized, 'utf-8');

    const category = options?.category || inferCategory(filename);
    const contentType = options?.contentType || inferContentType(filename, content);
    const relativePath = path.relative(this.repoRoot, targetPath);

    const meta: ArtifactMeta = {
      artifactId: cleanArtId,
      taskId,
      filename,
      path: targetPath,
      relativePath,
      createdAt: Date.now(),
      sizeBytes,
      contentType,
      category,
    };

    await this.atomicWrite(targetPath, serialized);
    await this.atomicWrite(`${targetPath}.meta.json`, JSON.stringify(meta, null, 2));

    return meta;
  }

  public async saveTaskBundle(
    taskId: string,
    bundle: TaskArtifactInput,
  ): Promise<TaskExecutionMetadata> {
    const cleanTaskId = this.validateId(taskId, 'taskId');

    if (bundle.taskContract !== undefined) {
      await this.saveArtifact('task_contract', bundle.taskContract, {
        taskId: cleanTaskId,
        category: 'contract',
        filename: 'task_contract.json',
      });
    }

    if (bundle.prompt !== undefined) {
      await this.saveArtifact('prompt', bundle.prompt, {
        taskId: cleanTaskId,
        category: 'prompt',
        filename: 'prompt.txt',
      });
    }

    if (bundle.patch !== undefined) {
      await this.saveArtifact('patch', bundle.patch, {
        taskId: cleanTaskId,
        category: 'diff',
        contentType: 'text/x-diff',
        filename: 'patch.diff',
      });
    }

    if (bundle.workerStdout !== undefined) {
      await this.saveArtifact('worker_stdout', bundle.workerStdout, {
        taskId: cleanTaskId,
        category: 'log',
        filename: 'worker_stdout.log',
      });
    }

    if (bundle.workerStderr !== undefined) {
      await this.saveArtifact('worker_stderr', bundle.workerStderr, {
        taskId: cleanTaskId,
        category: 'log',
        filename: 'worker_stderr.log',
      });
    }

    if (bundle.verificationResults !== undefined) {
      await this.saveArtifact('verification_results', bundle.verificationResults, {
        taskId: cleanTaskId,
        category: 'verification',
        filename: 'verification_results.json',
      });
    }

    if (bundle.executionSummary !== undefined) {
      await this.saveArtifact('execution_summary', bundle.executionSummary, {
        taskId: cleanTaskId,
        category: 'summary',
        filename: 'execution_summary.json',
      });
    }

    const artifacts = await this.listArtifacts(cleanTaskId);
    const totalSizeBytes = artifacts.reduce((acc, item) => acc + item.sizeBytes, 0);

    const granularStatus =
      bundle.granularStatus ||
      (bundle.status ? mapLegacyToGranularStatus(bundle.status) : 'COMPLETED');
    const legacyStatus = bundle.status || mapGranularToLegacyStatus(granularStatus);

    const metadata: TaskExecutionMetadata = {
      taskId: cleanTaskId,
      status: legacyStatus,
      granularStatus,
      stateHistory: bundle.stateHistory,
      errorDetails: bundle.errorDetails,
      timestamps: bundle.timestamps,
      taskType: bundle.taskType || 'generic',
      objective: bundle.objective || '',
      repoPath: bundle.repoPath || this.repoRoot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      revisions: bundle.revisions || 0,
      changedFiles: bundle.changedFiles || [],
      totalSizeBytes,
      artifacts,
    };

    await this.saveArtifact('metadata', metadata, {
      taskId: cleanTaskId,
      category: 'metadata',
      filename: 'metadata.json',
    });

    return metadata;
  }

  private async findCandidatePath(artifactId: string, taskId?: string): Promise<string | null> {
    const parentDir = taskId
      ? this.getTaskArtifactDir(taskId)
      : path.resolve(this.artifactsDir, '_generic');
    const cleanArtId = this.validateId(artifactId, 'artifactId');
    const sanitized = sanitizeName(cleanArtId);

    const candidates = [
      path.resolve(parentDir, sanitized),
      path.resolve(parentDir, `${sanitized}.json`),
      path.resolve(parentDir, `${sanitized}.txt`),
      path.resolve(parentDir, `${sanitized}.log`),
      path.resolve(parentDir, `${sanitized}.diff`),
    ];

    for (const cand of candidates) {
      try {
        const stat = await fs.stat(cand);
        if (stat.isFile()) return cand;
      } catch {
        // continue
      }
    }

    // Try scanning directory files for matching sidecar artifactId
    try {
      const files = await fs.readdir(parentDir);
      for (const file of files) {
        if (file.endsWith('.meta.json')) {
          try {
            const metaContent = await fs.readFile(path.join(parentDir, file), 'utf-8');
            const parsed = JSON.parse(metaContent);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const meta = parsed as ArtifactMeta;
              if (meta.artifactId === cleanArtId && typeof meta.path === 'string') {
                const resolvedPath = path.resolve(meta.path);
                if (this.isInsideArtifactsDir(resolvedPath) && resolvedPath !== this.artifactsDir) {
                  return resolvedPath;
                }
              }
            }
          } catch {
            // ignore corrupt meta
          }
        }
      }
    } catch {
      // dir doesn't exist
    }

    return null;
  }

  public async getArtifact(artifactId: string, taskId?: string): Promise<string | null> {
    this.validateId(artifactId, 'artifactId');
    if (taskId) this.validateId(taskId, 'taskId');

    const candidatePath = await this.findCandidatePath(artifactId, taskId);
    if (!candidatePath) return null;

    try {
      return await fs.readFile(candidatePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw new ArtifactError(
        `Failed to read artifact '${artifactId}': ${err.message}`,
        'FS_ERROR',
        err,
      );
    }
  }

  public async getArtifactMeta(artifactId: string, taskId?: string): Promise<ArtifactMeta | null> {
    this.validateId(artifactId, 'artifactId');
    if (taskId) this.validateId(taskId, 'taskId');

    const candidatePath = await this.findCandidatePath(artifactId, taskId);
    if (!candidatePath) return null;

    const metaPath = `${candidatePath}.meta.json`;
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      const parsed = JSON.parse(metaContent);
      if (this.isValidArtifactMeta(parsed)) {
        const targetPath =
          typeof parsed.path === 'string' ? path.resolve(parsed.path) : candidatePath;
        const filename = parsed.filename || path.basename(candidatePath);
        return {
          artifactId: parsed.artifactId,
          taskId: parsed.taskId || taskId,
          filename,
          path: targetPath,
          relativePath: parsed.relativePath || path.relative(this.repoRoot, targetPath),
          createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
          sizeBytes: parsed.sizeBytes,
          contentType: parsed.contentType || inferContentType(filename, null),
          category: parsed.category || inferCategory(filename),
        };
      }
    } catch {
      // Fallback
    }

    // Fallback: construct meta from stat
    try {
      const stat = await fs.stat(candidatePath);
      const filename = path.basename(candidatePath);
      return {
        artifactId,
        taskId,
        filename,
        path: candidatePath,
        relativePath: path.relative(this.repoRoot, candidatePath),
        createdAt: stat.birthtimeMs || stat.mtimeMs,
        sizeBytes: stat.size,
        contentType: inferContentType(filename, null),
        category: inferCategory(filename),
      };
    } catch {
      return null;
    }
  }

  private async collectArtifactsFromDir(dirPath: string, taskId?: string): Promise<ArtifactMeta[]> {
    const results: ArtifactMeta[] = [];
    let entries: string[];

    try {
      entries = await fs.readdir(dirPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw new ArtifactError(
        `Failed to read artifacts directory '${dirPath}': ${err.message}`,
        'FS_ERROR',
        err,
      );
    }

    for (const entry of entries) {
      if (entry.endsWith('.meta.json') || entry.includes('.tmp.')) {
        continue;
      }

      const fullPath = path.resolve(dirPath, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;

        const metaPath = `${fullPath}.meta.json`;
        let meta: ArtifactMeta | null = null;

        try {
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          const parsed = JSON.parse(metaContent);
          if (this.isValidArtifactMeta(parsed)) {
            const targetPath =
              typeof parsed.path === 'string' ? path.resolve(parsed.path) : fullPath;
            meta = {
              artifactId: parsed.artifactId,
              taskId: parsed.taskId || taskId,
              filename: parsed.filename || entry,
              path: targetPath,
              relativePath: parsed.relativePath || path.relative(this.repoRoot, targetPath),
              createdAt:
                typeof parsed.createdAt === 'number'
                  ? parsed.createdAt
                  : stat.birthtimeMs || stat.mtimeMs,
              sizeBytes: parsed.sizeBytes,
              contentType: parsed.contentType || inferContentType(entry, null),
              category: parsed.category || inferCategory(entry),
            };
          }
        } catch {
          // Fallback if meta file missing, corrupted, or non-object primitive
        }

        if (!meta) {
          const artId = entry.includes('.') ? entry.substring(0, entry.lastIndexOf('.')) : entry;
          meta = {
            artifactId: artId,
            taskId,
            filename: entry,
            path: fullPath,
            relativePath: path.relative(this.repoRoot, fullPath),
            createdAt: stat.birthtimeMs || stat.mtimeMs,
            sizeBytes: stat.size,
            contentType: inferContentType(entry, null),
            category: inferCategory(entry),
          };
        }

        results.push(meta);
      } catch {
        // Skip inaccessible files
      }
    }

    return results;
  }

  public async listArtifacts(taskId?: string): Promise<ArtifactMeta[]> {
    if (taskId) {
      const taskDir = this.getTaskArtifactDir(taskId);
      return this.collectArtifactsFromDir(taskDir, taskId);
    }

    const results: ArtifactMeta[] = [];
    let taskDirs: string[];

    try {
      taskDirs = await fs.readdir(this.artifactsDir);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw new ArtifactError(
        `Failed to list artifacts directory '${this.artifactsDir}': ${err.message}`,
        'FS_ERROR',
        err,
      );
    }

    for (const taskDirName of taskDirs) {
      const fullTaskDir = path.resolve(this.artifactsDir, taskDirName);
      try {
        const stat = await fs.stat(fullTaskDir);
        if (stat.isDirectory()) {
          const tid = taskDirName === '_generic' ? undefined : taskDirName;
          const items = await this.collectArtifactsFromDir(fullTaskDir, tid);
          results.push(...items);
        }
      } catch {
        // Skip invalid dirs
      }
    }

    return results;
  }

  public async deleteArtifacts(taskId: string): Promise<boolean> {
    const taskDir = this.getTaskArtifactDir(taskId);
    if (taskDir === this.artifactsDir) {
      throw new ArtifactError('Invalid task ID', 'INVALID_INPUT');
    }

    try {
      await fs.stat(taskDir);
    } catch (err: any) {
      if (err.code === 'ENOENT') return false;
    }

    try {
      await fs.rm(taskDir, { recursive: true, force: true });
      return true;
    } catch (err: any) {
      throw new ArtifactError(
        `Failed to delete task artifacts directory '${taskDir}': ${err.message}`,
        'FS_ERROR',
        err,
      );
    }
  }

  public async deleteArtifact(artifactId: string, taskId?: string): Promise<boolean> {
    this.validateId(artifactId, 'artifactId');
    if (taskId) this.validateId(taskId, 'taskId');

    const candidatePath = await this.findCandidatePath(artifactId, taskId);
    if (!candidatePath) return false;

    let primaryUnlinked = false;
    let primaryNotFound = false;

    try {
      await fs.unlink(candidatePath);
      primaryUnlinked = true;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        primaryNotFound = true;
      }
    }

    if (primaryUnlinked || primaryNotFound) {
      try {
        await fs.unlink(`${candidatePath}.meta.json`);
      } catch {
        // ignore
      }
    }

    return primaryUnlinked;
  }

  private async getDirectorySizeBytes(
    dirPath: string,
  ): Promise<{ totalSizeBytes: number; oldestMs: number }> {
    let totalSizeBytes = 0;
    let oldestMs = Infinity;

    const scan = async (currentDir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath);
            totalSizeBytes += stat.size;
            const time = stat.birthtimeMs || stat.mtimeMs;
            if (time < oldestMs) {
              oldestMs = time;
            }
          } catch {
            // Skip unstatable file
          }
        }
      }
    };

    await scan(dirPath);
    if (oldestMs === Infinity) oldestMs = Date.now();
    return { totalSizeBytes, oldestMs };
  }

  private async getTaskBundleDetails(
    taskId: string,
    taskDir: string,
  ): Promise<TaskBundleDetails | null> {
    try {
      const { totalSizeBytes, oldestMs } = await this.getDirectorySizeBytes(taskDir);

      let createdAt = oldestMs;
      const metaPath = path.join(taskDir, 'metadata.json');
      try {
        const metaStr = await fs.readFile(metaPath, 'utf-8');
        const parsed = JSON.parse(metaStr);
        if (
          parsed &&
          typeof parsed.createdAt === 'number' &&
          !isNaN(parsed.createdAt) &&
          parsed.createdAt > 0
        ) {
          createdAt = parsed.createdAt;
        }
      } catch {
        // Fallback to filesystem timestamp
      }

      return {
        taskId,
        dirPath: taskDir,
        createdAt,
        totalSizeBytes,
      };
    } catch {
      return null;
    }
  }

  public async listTaskBundles(): Promise<TaskBundleDetails[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.artifactsDir);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw new ArtifactError(
        `Failed to list artifacts directory '${this.artifactsDir}': ${err.message}`,
        'FS_ERROR',
        err,
      );
    }

    const bundles: TaskBundleDetails[] = [];
    for (const entry of entries) {
      if (entry === '_generic' || entry.startsWith('.')) continue;

      const taskDir = path.resolve(this.artifactsDir, entry);
      try {
        const stat = await fs.stat(taskDir);
        if (stat.isDirectory()) {
          const details = await this.getTaskBundleDetails(entry, taskDir);
          if (details) {
            bundles.push(details);
          }
        }
      } catch {
        // Ignore invalid directory entries
      }
    }

    bundles.sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }
      return a.taskId.localeCompare(b.taskId);
    });

    return bundles;
  }

  public async cleanup(
    policy?: RetentionPolicy,
    options?: { dryRun?: boolean },
  ): Promise<CleanupSummary> {
    const allBundles = await this.listTaskBundles();

    if (!policy || typeof policy !== 'object') {
      return {
        deletedBundles: [],
        deletedCount: 0,
        freedBytes: 0,
        remainingBundles: allBundles.length,
      };
    }

    const maxRuns =
      typeof policy.maxRuns === 'number' && policy.maxRuns > 0 ? policy.maxRuns : undefined;
    const maxAgeDays =
      typeof policy.maxAgeDays === 'number' && policy.maxAgeDays > 0
        ? policy.maxAgeDays
        : undefined;

    let maxDiskSizeBytes = policy.maxDiskSizeBytes;
    const rawDiskSize = policy.maxTotalSize ?? policy.maxDiskSize;
    if (maxDiskSizeBytes === undefined && rawDiskSize !== undefined) {
      maxDiskSizeBytes = parseDiskSize(rawDiskSize);
    }
    if (maxDiskSizeBytes !== undefined && (isNaN(maxDiskSizeBytes) || maxDiskSizeBytes <= 0)) {
      maxDiskSizeBytes = undefined;
    }

    if (maxRuns === undefined && maxAgeDays === undefined && maxDiskSizeBytes === undefined) {
      return {
        deletedBundles: [],
        deletedCount: 0,
        freedBytes: 0,
        remainingBundles: allBundles.length,
      };
    }

    if (allBundles.length === 0) {
      return {
        deletedBundles: [],
        deletedCount: 0,
        freedBytes: 0,
        remainingBundles: 0,
      };
    }

    const toDeleteSet = new Set<string>();
    const now = Date.now();

    // 1. Enforce maxAgeDays
    if (maxAgeDays !== undefined) {
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const cutoffTime = now - maxAgeMs;
      for (const bundle of allBundles) {
        if (bundle.createdAt < cutoffTime) {
          toDeleteSet.add(bundle.taskId);
        }
      }
    }

    // Filter active bundles remaining after age check
    let activeBundles = allBundles.filter((b) => !toDeleteSet.has(b.taskId));

    // 2. Enforce maxRuns
    if (maxRuns !== undefined && activeBundles.length > maxRuns) {
      const excessCount = activeBundles.length - maxRuns;
      for (let i = 0; i < excessCount; i++) {
        toDeleteSet.add(activeBundles[i].taskId);
      }
      activeBundles = activeBundles.slice(excessCount);
    }

    // 3. Enforce maxDiskSize
    if (maxDiskSizeBytes !== undefined) {
      let currentTotalBytes = activeBundles.reduce((sum, b) => sum + b.totalSizeBytes, 0);
      let idx = 0;
      while (currentTotalBytes > maxDiskSizeBytes && idx < activeBundles.length) {
        const bundle = activeBundles[idx];
        toDeleteSet.add(bundle.taskId);
        currentTotalBytes -= bundle.totalSizeBytes;
        idx++;
      }
    }

    const deletedBundles: string[] = [];
    let freedBytes = 0;

    const bundleMap = new Map<string, TaskBundleDetails>();
    for (const bundle of allBundles) {
      bundleMap.set(bundle.taskId, bundle);
    }

    for (const taskId of toDeleteSet) {
      const bundle = bundleMap.get(taskId);
      if (options?.dryRun) {
        deletedBundles.push(taskId);
        if (bundle) {
          freedBytes += bundle.totalSizeBytes;
        }
      } else {
        const success = await this.deleteArtifacts(taskId);
        if (success) {
          deletedBundles.push(taskId);
          if (bundle) {
            freedBytes += bundle.totalSizeBytes;
          }
        }
      }
    }

    const deletedCount = deletedBundles.length;
    const remainingBundles = allBundles.length - deletedCount;

    return {
      deletedBundles,
      deletedCount,
      freedBytes,
      remainingBundles,
    };
  }
}
