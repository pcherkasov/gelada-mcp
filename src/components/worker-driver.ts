import { spawn, ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProcessSupervisor } from './process-supervisor.js';
import { GeladaError } from '../errors.js';
import { SecretRedactor } from '../utils/secret-redactor.js';

export type DriverErrorCode =
  | 'INVALID_INPUT'
  | 'SPAWN_FAILED'
  | 'WORKER_TIMEOUT'
  | 'IDLE_TIMEOUT'
  | 'BUFFER_OVERFLOW'
  | 'EXECUTION_FAILED'
  | 'WORKER_NOT_FOUND';

export class DriverError extends GeladaError {
  public readonly code: DriverErrorCode;
  public readonly cause?: unknown;

  constructor(message: string, code: DriverErrorCode, cause?: unknown) {
    super(message);
    this.name = 'DriverError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, DriverError.prototype);
  }
}

export const DEFAULT_BLOCKED_ENV_KEYS: readonly string[] = [
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_CLIENT_SECRET',
  'GITLAB_TOKEN',
  'GITLAB_PRIVATE_TOKEN',
  'NPM_TOKEN',
  'NPM_AUTH_TOKEN',
  'PYPI_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_TOKEN',
  'AZURE_CLIENT_SECRET',
  'AZURE_OPENAI_API_KEY',
  'AZURE_SUBSCRIPTION_ID',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'HEROKU_API_KEY',
  'NETLIFY_AUTH_TOKEN',
  'VERCEL_TOKEN',
  'DATADOG_API_KEY',
  'STRIPE_SECRET_KEY',
  'MISTRAL_API_KEY',
  'COHERE_API_KEY',
  'REPLICATE_API_TOKEN',
];

export const DEFAULT_BLOCKED_ENV_PATTERNS: readonly RegExp[] = [
  /.*(?:SECRET|PASSWORD|PASSCODE|APIKEY|API_KEY|TOKEN|AUTH|CREDENTIAL|PRIVATE_KEY|PASSPHRASE).*/i,
];

export const DEFAULT_PRESERVED_SYSTEM_ENV_KEYS: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'NODE_ENV',
];

export interface EnvSanitizationOptions {
  /** Enable or disable environment variable sanitization (default: true) */
  sanitizeEnv?: boolean;
  /** Explicit list of environment variable names to block */
  blockedEnvVars?: string[];
  /** Explicit allowlist of environment variable names (if set, only listed keys + system keys pass) */
  allowedEnvVars?: string[];
  /** Additional regex patterns for keys to block */
  blockedPatterns?: (RegExp | string)[];
  /** Whether to preserve essential system variables like PATH and HOME (default: true) */
  preserveSystemVars?: boolean;
}

export interface WorkerOptions {
  taskId: string;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  sanitizeEnv?: boolean;
  blockedEnvVars?: string[];
  allowedEnvVars?: string[];
  sanitization?: EnvSanitizationOptions;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxBufferBytes?: number;
  sandbox?: string;
  sandboxImage?: string;
  /**
   * How the worker's stdin is wired. Defaults to 'ignore': the Antigravity CLI
   * exits immediately with no output when handed an open stdin pipe it can
   * never read from, so a pipe here silently breaks every task.
   */
  stdin?: 'ignore' | 'pipe' | 'inherit';
}

export interface WorkerResult {
  workerId: string;
  taskId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  status: 'completed' | 'failed' | 'terminated' | 'timed_out' | 'idle_timed_out';
  error?: string;
}

export interface WorkerHandle {
  workerId: string;
  taskId: string;
  pid: number;
  status:
    | 'pending' | 'running' | 'completed' | 'failed' | 'terminated' | 'timed_out' | 'idle_timed_out';
  startTime: number;
  endTime?: number;
  promise: Promise<WorkerResult>;
  kill: (signal?: NodeJS.Signals) => Promise<boolean>;
}

export interface AntigravityDriverOptions {
  supervisor?: ProcessSupervisor;
  defaultTimeoutMs?: number;
  defaultIdleTimeoutMs?: number;
  defaultMaxBufferBytes?: number;
  sanitizeEnv?: boolean;
  blockedEnvVars?: string[];
  allowedEnvVars?: string[];
  defaultSanitization?: EnvSanitizationOptions;
}

export function sanitizeEnvironment(
  parentEnv: Record<string, string | undefined>,
  explicitEnv?: Record<string, string>,
  options?: EnvSanitizationOptions,
): Record<string, string> {
  const sanitize = options?.sanitizeEnv !== false;
  if (!sanitize) {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(parentEnv)) {
      if (v !== undefined) {
        merged[k] = v;
      }
    }
    if (explicitEnv) {
      for (const [k, v] of Object.entries(explicitEnv)) {
        merged[k] = v;
      }
    }
    return merged;
  }

  const preserveSystem = options?.preserveSystemVars !== false;
  const blockedKeys = new Set(
    [
      ...DEFAULT_BLOCKED_ENV_KEYS,
      ...(options?.blockedEnvVars || []),
    ].map((k) => k.toUpperCase()),
  );

  const allowedKeys =
    options?.allowedEnvVars && options.allowedEnvVars.length > 0
      ? new Set(options.allowedEnvVars.map((k) => k.toUpperCase()))
      : null;

  const preservedSystemKeys = new Set(
    DEFAULT_PRESERVED_SYSTEM_ENV_KEYS.map((k) => k.toUpperCase()),
  );

  const customPatterns = (options?.blockedPatterns || []).map((p) =>
    typeof p === 'string' ? new RegExp(p, 'i') : p,
  );
  const allPatterns = [...DEFAULT_BLOCKED_ENV_PATTERNS, ...customPatterns];

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();

    // 1. If explicit allowlist is provided, check if key is allowed or system/framework key
    if (allowedKeys) {
      const isExplicitAllowed = allowedKeys.has(upperKey);
      const isSystemPreserved = preserveSystem && preservedSystemKeys.has(upperKey);
      const isGeladaPrefix = upperKey.startsWith('AGY_') || upperKey.startsWith('GELADA_');
      if (!isExplicitAllowed && !isSystemPreserved && !isGeladaPrefix) {
        continue;
      }
    }

    // 2. Check blocklist
    if (blockedKeys.has(upperKey)) {
      continue;
    }

    // 3. Check regex pattern matches (unless essential system key or framework key)
    const isSystemKey = preserveSystem && preservedSystemKeys.has(upperKey);
    const isGeladaPrefix = upperKey.startsWith('AGY_') || upperKey.startsWith('GELADA_');
    if (!isSystemKey && !isGeladaPrefix && allPatterns.some((pattern) => pattern.test(key))) {
      continue;
    }

    result[key] = value;
  }

  // 4. Merge explicit environment variables (options.env)
  if (explicitEnv) {
    const userBlockedKeys =
      options?.blockedEnvVars && options.blockedEnvVars.length > 0
        ? new Set(options.blockedEnvVars.map((k) => k.toUpperCase()))
        : null;

    for (const [k, v] of Object.entries(explicitEnv)) {
      const upperK = k.toUpperCase();

      if (userBlockedKeys && userBlockedKeys.has(upperK)) {
        continue;
      }

      if (allowedKeys) {
        const isExplicitAllowed = allowedKeys.has(upperK);
        const isSystemPreserved = preserveSystem && preservedSystemKeys.has(upperK);
        const isGeladaPrefix = upperK.startsWith('AGY_') || upperK.startsWith('GELADA_');
        if (!isExplicitAllowed && !isSystemPreserved && !isGeladaPrefix) {
          continue;
        }
      }

      result[k] = v;
    }
  }

  return result;
}

/**
 * Looks up a bare command name on PATH, mirroring what spawn would do, so a
 * missing worker CLI can be reported before a process is ever created.
 * Returns the resolved absolute path, or undefined when nothing matches.
 */
export function resolveOnPath(command: string): string | undefined {
  const rawPath = process.env.PATH;
  if (!rawPath) return undefined;

  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];

  for (const dir of rawPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        if (process.platform === 'win32') return candidate;
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
  }

  return undefined;
}

export class AntigravityDriver {
  private supervisor: ProcessSupervisor;
  private activeWorkers: Map<string, WorkerHandle> = new Map();
  private workerResults: Map<string, WorkerResult> = new Map();
  private defaultTimeoutMs?: number;
  private defaultIdleTimeoutMs?: number;
  private defaultMaxBufferBytes: number;
  private defaultSanitization?: EnvSanitizationOptions;

  constructor(options?: AntigravityDriverOptions | ProcessSupervisor) {
    if (options instanceof ProcessSupervisor) {
      this.supervisor = options;
      this.defaultMaxBufferBytes = 10 * 1024 * 1024;
    } else {
      this.supervisor = options?.supervisor ?? new ProcessSupervisor();
      this.defaultTimeoutMs = options?.defaultTimeoutMs;
      this.defaultIdleTimeoutMs = options?.defaultIdleTimeoutMs;
      this.defaultMaxBufferBytes = options?.defaultMaxBufferBytes ?? 10 * 1024 * 1024;
      this.defaultSanitization = {
        sanitizeEnv: options?.sanitizeEnv ?? options?.defaultSanitization?.sanitizeEnv,
        blockedEnvVars: options?.blockedEnvVars ?? options?.defaultSanitization?.blockedEnvVars,
        allowedEnvVars: options?.allowedEnvVars ?? options?.defaultSanitization?.allowedEnvVars,
        blockedPatterns: options?.defaultSanitization?.blockedPatterns,
        preserveSystemVars: options?.defaultSanitization?.preserveSystemVars,
      };
    }
  }

  public async spawnWorker(options: WorkerOptions): Promise<WorkerHandle> {
    if (!options || !options.taskId || !options.command || !options.cwd) {
      throw new DriverError(
        'Missing required WorkerOptions (taskId, command, cwd)',
        'INVALID_INPUT',
      );
    }

    let binary: string;
    let commandArgs: string[] = [];

    const trimmedCmd = options.command.trim();
    if (fs.existsSync(trimmedCmd)) {
      binary = trimmedCmd;
    } else {
      const tokens = trimmedCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [trimmedCmd];
      binary = tokens[0].replace(/^["']|["']$/g, '');
      commandArgs = tokens.slice(1).map((t) => t.replace(/^["']|["']$/g, ''));
    }
    const finalArgs = [...commandArgs, ...(options.args || [])];

    if (options.sandbox === 'docker') {
      // We are going to run docker run --rm -v cwd:workspace -w /workspace <image> <command>
      // The sanitized env vars need to be passed with -e KEY=VALUE
      // Note: sanitizedEnv is calculated below, so we'll wrap the spawn call itself, 
      // but let's just adjust binary and finalArgs right before spawn.
    }

    if (binary.startsWith('/') || binary.startsWith('.')) {
      if (!fs.existsSync(binary)) {
        throw new DriverError(`Command executable non-existent: ${binary}`, 'WORKER_NOT_FOUND');
      }
    } else if (options.sandbox !== 'docker' && !resolveOnPath(binary)) {
      // Resolve bare command names up front. Otherwise spawn fails
      // asynchronously with ENOENT and "the worker CLI is not installed" only
      // surfaces to the leader agent through polling, long after the call that
      // could have reported it plainly.
      throw new DriverError(
        `Command executable non-existent: ${binary}`,
        'WORKER_NOT_FOUND',
      );
    }

    const sanitizationOptions: EnvSanitizationOptions = {
      sanitizeEnv:
        options.sanitizeEnv ??
        options.sanitization?.sanitizeEnv ??
        this.defaultSanitization?.sanitizeEnv ??
        true,
      blockedEnvVars: [
        ...(this.defaultSanitization?.blockedEnvVars || []),
        ...(options.blockedEnvVars || []),
        ...(options.sanitization?.blockedEnvVars || []),
      ],
      allowedEnvVars:
        options.allowedEnvVars ??
        options.sanitization?.allowedEnvVars ??
        this.defaultSanitization?.allowedEnvVars,
      blockedPatterns: [
        ...(this.defaultSanitization?.blockedPatterns || []),
        ...(options.sanitization?.blockedPatterns || []),
      ],
      preserveSystemVars:
        options.sanitization?.preserveSystemVars ??
        this.defaultSanitization?.preserveSystemVars ??
        true,
    };

    // Marks every descendant of a worker as being inside one.
    //
    // Antigravity's IDE and its CLI read one shared MCP config, so a Gelada
    // registered for the IDE is also loaded by `agy` — including the `agy` run
    // here. Without a marker the worker holds delegate_task and can spawn
    // workers of its own, in a worktree inside a worktree, on the same quota.
    // Set last so it cannot be dropped by sanitization, and read back in
    // delegate_task.
    const workerEnv = { ...(options.env ?? {}), GELADA_WORKER: '1' };
    const sanitizedEnv = sanitizeEnvironment(process.env, workerEnv, sanitizationOptions);

    let child: ChildProcess;
    try {
      let spawnBinary = binary;
      let spawnArgs = finalArgs;
      const spawnCwd = options.cwd;
      const spawnEnv = sanitizedEnv;

      if (options.sandbox === 'docker') {
        const image = options.sandboxImage || 'node:22';
        spawnBinary = 'docker';
        
        // docker run --rm -v <cwd>:/workspace -w /workspace -e KEY=VAL... <image> <binary> <args>
        spawnArgs = ['run', '--rm', '-v', `${options.cwd}:/workspace`, '-w', '/workspace'];
        
        for (const [key, val] of Object.entries(sanitizedEnv)) {
          if (val !== undefined) {
            spawnArgs.push('-e', `${key}=${val}`);
          }
        }
        
        spawnArgs.push(image);
        spawnArgs.push(binary);
        spawnArgs.push(...finalArgs);
      }

      child = spawn(spawnBinary, spawnArgs, {
        cwd: spawnCwd,
        env: spawnEnv,
        detached: true,
        shell: false,
        stdio: [options.stdin ?? 'ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      const isEnoent = err?.code === 'ENOENT';
      const errorCode: DriverErrorCode = isEnoent ? 'WORKER_NOT_FOUND' : 'SPAWN_FAILED';
      throw new DriverError(
        `Failed to spawn worker process: ${err.message}`,
        errorCode,
        err,
      );
    }

    const workerId = `worker-${options.taskId}`;
    const startTime = Date.now();

    const stdoutDecoder = new StringDecoder('utf-8');
    const stderrDecoder = new StringDecoder('utf-8');
    let stdoutText = '';
    let stderrText = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const maxBufferBytes = options.maxBufferBytes ?? this.defaultMaxBufferBytes;

    let timedOut = false;
    let idleTimedOut = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const idleTimeoutMs = options.idleTimeoutMs ?? this.defaultIdleTimeoutMs;

    const handle: WorkerHandle = {
      workerId,
      taskId: options.taskId,
      pid: child.pid || 0,
      status: 'running',
      startTime,
      promise: Promise.resolve({} as WorkerResult),
      kill: async (signal?: NodeJS.Signals) => {
        handle.status = 'terminated';
        if (child.pid && child.pid > 0) {
          return this.supervisor.killProcess(child.pid, signal);
        }
        return false;
      },
    };

    if (timeoutMs && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        handle.status = 'timed_out';
        if (child.pid && child.pid > 0) {
          this.supervisor.killProcess(child.pid).catch(() => {});
        }
      }, timeoutMs);
    }

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (idleTimeoutMs && idleTimeoutMs > 0 && !idleTimedOut && !timedOut) {
        idleTimer = setTimeout(() => {
          idleTimedOut = true;
          handle.status = 'idle_timed_out';
          if (child.pid && child.pid > 0) {
            this.supervisor.killProcess(child.pid).catch(() => {});
          }
        }, idleTimeoutMs);
      }
    };

    resetIdleTimer();

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        resetIdleTimer();
        stdoutBytes += chunk.length;
        if (stdoutBytes <= maxBufferBytes) {
          stdoutText += stdoutDecoder.write(chunk);
        } else if (!stdoutTruncated) {
          stdoutTruncated = true;
          stdoutText += stdoutDecoder.write(chunk);
          stdoutText += `\n[TRUNCATED: Maximum output buffer size of ${maxBufferBytes} bytes exceeded]`;
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        resetIdleTimer();
        stderrBytes += chunk.length;
        if (stderrBytes <= maxBufferBytes) {
          stderrText += stderrDecoder.write(chunk);
        } else if (!stderrTruncated) {
          stderrTruncated = true;
          stderrText += stderrDecoder.write(chunk);
          stderrText += `\n[TRUNCATED: Maximum output buffer size of ${maxBufferBytes} bytes exceeded]`;
        }
      });
    }

    if (child.pid && child.pid > 0) {
      this.supervisor.registerProcess(
        child.pid,
        {
          workerId,
          taskId: options.taskId,
          command: options.command,
          args: finalArgs,
          cwd: options.cwd,
        },
        child,
      );
    }

    const promise = new Promise<WorkerResult>((resolve, reject) => {
      let finished = false;

      const onFinish = (code: number | null, signal: NodeJS.Signals | string | null) => {
        if (finished) return;
        finished = true;

        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (idleTimer) clearTimeout(idleTimer);

        stdoutText += stdoutDecoder.end();
        stderrText += stderrDecoder.end();

        // Redact secrets at the end to cover the complete output string
        const redactor = new SecretRedactor();
        const sensitiveKeys = new Set(sanitizationOptions.blockedEnvVars?.map(k => k.toUpperCase()) || []);
        sensitiveKeys.forEach(k => DEFAULT_BLOCKED_ENV_KEYS.includes(k) || sensitiveKeys.add(k));
        DEFAULT_BLOCKED_ENV_KEYS.forEach(k => sensitiveKeys.add(k));
        const sensitivePatterns = sanitizationOptions.blockedPatterns?.map(p => typeof p === 'string' ? new RegExp(p, 'i') : p) || [];
        DEFAULT_BLOCKED_ENV_PATTERNS.forEach(p => sensitivePatterns.push(p));

        redactor.addSecretsFromEnv(process.env, sensitiveKeys, sensitivePatterns);
        if (options.env) {
          redactor.addSecretsFromEnv(options.env, sensitiveKeys, sensitivePatterns);
        }

        stdoutText = redactor.redact(stdoutText);
        stderrText = redactor.redact(stderrText);

        const endTime = Date.now();
        handle.endTime = endTime;

        let status: WorkerResult['status'];
        if (timedOut) {
          status = 'timed_out';
        } else if (idleTimedOut) {
          status = 'idle_timed_out';
        } else if (handle.status === 'terminated' || signal) {
          status = 'terminated';
        } else if (code === 0) {
          status = 'completed';
        } else {
          status = 'failed';
        }

        handle.status = status;

        const result: WorkerResult = {
          workerId,
          taskId: options.taskId,
          exitCode: code,
          signal,
          stdout: stdoutText,
          stderr: stderrText,
          stdoutTruncated,
          stderrTruncated,
          durationMs: endTime - startTime,
          status,
        };

        this.activeWorkers.delete(workerId);
        this.workerResults.set(workerId, result);
        resolve(result);
      };

      child.once('close', (code, signal) => onFinish(code, signal));
      child.once('exit', (code, signal) => {
        if (!child.stdout && !child.stderr) {
          onFinish(code, signal);
        }
      });
      child.once('error', (err: any) => {
        if (!finished) {
          finished = true;
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (idleTimer) clearTimeout(idleTimer);
          const isEnoent = err?.code === 'ENOENT';
          const errorCode: DriverErrorCode = isEnoent ? 'WORKER_NOT_FOUND' : 'SPAWN_FAILED';
          const errorMsg = isEnoent
            ? `Antigravity CLI executable '${binary}' was not found. Please ensure agy is installed and in your PATH.`
            : `Worker execution failed: ${err.message}`;
          reject(new DriverError(errorMsg, errorCode, err));
        }
      });
    });

    handle.promise = promise;
    this.activeWorkers.set(workerId, handle);

    return handle;
  }

  public async getWorkerStatus(workerId: string): Promise<WorkerHandle> {
    const active = this.activeWorkers.get(workerId);
    if (active) {
      return active;
    }

    const finishedResult = this.workerResults.get(workerId);
    if (finishedResult) {
      return {
        workerId,
        taskId: finishedResult.taskId,
        pid: 0,
        status: finishedResult.status,
        startTime: Date.now() - finishedResult.durationMs,
        endTime: Date.now(),
        promise: Promise.resolve(finishedResult),
        kill: async () => false,
      };
    }

    return {
      workerId,
      taskId: 'unknown',
      pid: 0,
      status: 'completed',
      startTime: Date.now(),
      endTime: Date.now(),
      promise: Promise.resolve({
        workerId,
        taskId: 'unknown',
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0,
        status: 'completed',
      }),
      kill: async () => false,
    };
  }

  public async terminateWorker(workerId: string, signal?: NodeJS.Signals): Promise<boolean> {
    const active = this.activeWorkers.get(workerId);
    if (active) {
      active.status = 'terminated';
      return this.supervisor.killProcess(active.pid, signal);
    }

    const proc = this.supervisor.getProcessByWorkerId(workerId);
    if (proc) {
      return this.supervisor.killProcess(proc.pid, signal);
    }

    if (this.workerResults.has(workerId)) {
      return true;
    }

    return false;
  }
}
