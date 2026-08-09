import { ChildProcess } from 'node:child_process';
import treeKill from 'tree-kill';
import { GeladaError } from '../errors.js';

export type SupervisorErrorCode = 'INVALID_PID' | 'PROCESS_NOT_FOUND' | 'KILL_FAILED' | 'SYSTEM_ERROR';

export class SupervisorError extends GeladaError {
  public readonly code: SupervisorErrorCode;
  public readonly cause?: unknown;

  constructor(message: string, code: SupervisorErrorCode, cause?: unknown) {
    super(message);
    this.name = 'SupervisorError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, SupervisorError.prototype);
  }
}

export type ProcessStatus = 'running' | 'terminating' | 'terminated' | 'exited' | 'failed';

export interface ProcessRegistrationOptions {
  workerId?: string;
  taskId?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  name?: string;
}

export interface ProcessInfo {
  pid: number;
  workerId: string;
  taskId: string;
  command: string;
  args?: string[];
  cwd?: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: ProcessStatus;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  childProcess?: ChildProcess;
}

export interface KillProcessOptions {
  gracePeriodMs?: number;
  signal?: NodeJS.Signals;
}

export interface ProcessSupervisorOptions {
  gracePeriodMs?: number;
}

export class ProcessSupervisor {
  private activeProcesses: Map<number, ProcessInfo> = new Map();
  private processesByWorkerId: Map<string, ProcessInfo> = new Map();
  private defaultGracePeriodMs: number;

  constructor(options?: ProcessSupervisorOptions) {
    this.defaultGracePeriodMs = options?.gracePeriodMs ?? 2000;
  }

  public registerProcess(
    pid: number,
    metadataOrName: string | ProcessRegistrationOptions,
    childProcess?: ChildProcess,
  ): ProcessInfo {
    if (!pid || pid <= 0 || !Number.isInteger(pid)) {
      throw new SupervisorError(`Invalid PID: ${pid}`, 'INVALID_PID');
    }

    let meta: ProcessRegistrationOptions;
    if (typeof metadataOrName === 'string') {
      meta = {
        name: metadataOrName,
        workerId: metadataOrName,
        taskId: metadataOrName,
        command: metadataOrName,
      };
    } else {
      meta = metadataOrName;
    }

    const workerId = meta.workerId ?? meta.name ?? `process-${pid}`;
    const taskId = meta.taskId ?? `task-${pid}`;
    const command = meta.command ?? meta.name ?? 'unknown';
    const name = meta.name ?? workerId;

    const info: ProcessInfo = {
      pid,
      workerId,
      taskId,
      command,
      args: meta.args,
      cwd: meta.cwd,
      name,
      startTime: Date.now(),
      status: 'running',
      childProcess,
    };

    this.activeProcesses.set(pid, info);
    if (workerId) {
      this.processesByWorkerId.set(workerId, info);
    }

    if (childProcess) {
      let cleanedUp = false;

      const cleanup = (
        code: number | null,
        signal: NodeJS.Signals | string | null,
        error?: Error,
      ) => {
        if (cleanedUp) return;
        cleanedUp = true;

        info.endTime = Date.now();
        info.exitCode = code;
        info.signal = signal;

        if (error) {
          info.status = 'failed';
        } else if (info.status !== 'terminating' && info.status !== 'terminated') {
          info.status = code === 0 ? 'exited' : 'failed';
        } else if (info.status === 'terminating') {
          info.status = 'terminated';
        }

        this.activeProcesses.delete(pid);
        if (workerId && this.processesByWorkerId.get(workerId)?.pid === pid) {
          this.processesByWorkerId.delete(workerId);
        }
      };

      childProcess.once('error', (err) => {
        cleanup(null, null, err);
      });

      childProcess.once('exit', (code, signal) => {
        info.exitCode = code;
        info.signal = signal;
        if (!childProcess.stdout && !childProcess.stderr) {
          cleanup(code, signal);
        }
      });

      childProcess.once('close', (code, signal) => {
        cleanup(code, signal);
      });
    }

    return info;
  }

  public getProcess(pid: number): ProcessInfo | undefined {
    return this.activeProcesses.get(pid);
  }

  public getProcessByWorkerId(workerId: string): ProcessInfo | undefined {
    return this.processesByWorkerId.get(workerId);
  }

  public getActiveProcesses(): ProcessInfo[] {
    return Array.from(this.activeProcesses.values());
  }

  public async killProcess(
    pid: number,
    optionsOrSignal?: KillProcessOptions | NodeJS.Signals,
    timeoutOverrideMs?: number,
  ): Promise<boolean> {
    const info = this.activeProcesses.get(pid);
    if (!info) {
      return false;
    }

    let signal: NodeJS.Signals = 'SIGTERM';
    let gracePeriodMs = this.defaultGracePeriodMs;

    if (typeof optionsOrSignal === 'string') {
      signal = optionsOrSignal;
      if (timeoutOverrideMs !== undefined) {
        gracePeriodMs = timeoutOverrideMs;
      }
    } else if (optionsOrSignal) {
      if (optionsOrSignal.signal) signal = optionsOrSignal.signal;
      if (optionsOrSignal.gracePeriodMs !== undefined)
        gracePeriodMs = optionsOrSignal.gracePeriodMs;
    }

    info.status = 'terminating';

    // Step 1: Send initial signal (e.g. SIGTERM)
    this.sendSignal(info, signal);

    // Step 2: Wait up to gracePeriodMs for process exit
    const exitedGracefully = await this.waitForExit(pid, gracePeriodMs);
    if (exitedGracefully) {
      info.status = 'terminated';
      info.endTime = info.endTime ?? Date.now();
      this.activeProcesses.delete(pid);
      if (info.workerId) this.processesByWorkerId.delete(info.workerId);
      return true;
    }

    // Step 3: Escalate to SIGKILL if still running
    this.sendSignal(info, 'SIGKILL');
    info.status = 'terminated';

    // Give short safety window for SIGKILL to take effect
    await this.waitForExit(pid, 1000);

    info.endTime = info.endTime ?? Date.now();
    this.activeProcesses.delete(pid);
    if (info.workerId) this.processesByWorkerId.delete(info.workerId);
    return true;
  }

  public async killAll(
    signal: NodeJS.Signals = 'SIGTERM',
    gracePeriodMs?: number,
  ): Promise<boolean> {
    const active = Array.from(this.activeProcesses.keys());
    const killPromises = active.map((pid) => this.killProcess(pid, { signal, gracePeriodMs }));
    await Promise.allSettled(killPromises);
    return true;
  }

  public async shutdownAll(
    signal: NodeJS.Signals = 'SIGTERM',
    gracePeriodMs?: number,
  ): Promise<void> {
    await this.killAll(signal, gracePeriodMs);
  }

  private sendSignal(info: ProcessInfo, signal: NodeJS.Signals): void {
    const pid = info.pid;
    
    treeKill(pid, signal, (err) => {
      if (err) {
        // Fallback to direct kill
        try {
          if (info.childProcess) {
            info.childProcess.kill(signal);
          } else {
            process.kill(pid, signal);
          }
        } catch (fallbackErr: unknown) {
          const error = fallbackErr as { code?: string };
          if (error.code !== 'ESRCH') {
            // Ignored
          }
        }
      }
    });
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    const checkInterval = 20;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (!this.activeProcesses.has(pid)) {
        return true;
      }

      try {
        process.kill(pid, 0);
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === 'ESRCH') {
          return true;
        }
      }

      await new Promise((r) => setTimeout(r, checkInterval));
    }

    return !this.activeProcesses.has(pid);
  }
}
