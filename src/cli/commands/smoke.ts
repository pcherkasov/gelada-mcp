import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createGeladaServer } from '../../server.js';
import { registerDelegateTaskTool } from '../../tools/delegate-task.js';

const execFileAsync = promisify(execFile);

export interface SmokeResult {
  ok: boolean;
  taskId?: string;
  granularStatus?: string;
  changedFiles?: string[];
  diff?: string;
  durationMs: number;
  error?: string;
  remediation?: string;
}

const TERMINAL = new Set([
  'COMPLETED',
  'COMPLETED_WITH_WARNINGS',
  'FAILED_CONTRACT',
  'FAILED_WORKER',
  'FAILED_POLICY',
  'FAILED_VERIFICATION',
  'AUTH_REQUIRED',
  'CANCELLED',
  'DISCARDED',
]);

function remediationFor(state?: string, code?: string): string | undefined {
  if (state === 'AUTH_REQUIRED') {
    return 'Run the Antigravity CLI once in a terminal and sign in, then re-run "gelada smoke".';
  }
  if (code === 'AGY_NOT_FOUND') {
    return 'Install the Antigravity CLI and put it on PATH, or point AGY_COMMAND at it.';
  }
  if (code === 'WORKER_NO_CHANGES') {
    return (
      'The worker ran but changed nothing. The usual cause is workerAutoApprove being off — ' +
      'the worker CLI cannot write files headlessly without it. See SECURITY.md §4.'
    );
  }
  if (code === 'UNKNOWN_MODEL') {
    return 'Run "gelada models --refresh" to re-read the worker CLI model list.';
  }
  return undefined;
}

/**
 * Delegates one trivial task end to end in a throwaway repository.
 *
 * This is the only check that proves delegation actually works. Every component
 * can report healthy while the pipeline still produces nothing — a worker that
 * cannot write files exits successfully — so setup is not considered done until
 * a real task has produced a real diff.
 */
export async function runSmokeTest(options: { timeoutSeconds?: number } = {}): Promise<SmokeResult> {
  const started = Date.now();
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-smoke-'));

  try {
    const git = (args: string[]) => execFileAsync('git', args, { cwd: repoDir });
    await git(['init']);
    await git(['config', 'user.name', 'Gelada Smoke Test']);
    await git(['config', 'user.email', 'smoke@gelada.local']);
    await fs.writeFile(
      path.join(repoDir, 'greeting.js'),
      'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n',
    );
    await git(['add', '-A']);
    await git(['commit', '-m', 'smoke fixture']);

    const server = createGeladaServer();
    let delegate: ((args: unknown) => Promise<{ content: { text: string }[] }>) | undefined;
    registerDelegateTaskTool(
      {
        // Minimal registration surface; we only need the handler.
        registerTool: (name: string, _config: unknown, handler: unknown) => {
          if (name === 'delegate_task') {
            delegate = handler as (args: unknown) => Promise<{ content: { text: string }[] }>;
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      server.components,
    );

    if (!delegate) {
      return { ok: false, durationMs: Date.now() - started, error: 'delegate_task did not register' };
    }

    const timeoutSeconds = options.timeoutSeconds ?? 180;
    const response = await delegate({
      repoPath: repoDir,
      taskType: 'doc-gen',
      objective:
        'Add a one-line JSDoc comment directly above the greet function in greeting.js ' +
        'describing what it returns. Do not change any behaviour.',
      allowedPaths: ['greeting.js'],
      requiredFiles: ['greeting.js'],
      modelProfile: 'FAST',
      timeoutSeconds,
    });

    const payload = JSON.parse(response.content[0].text);
    if (payload.status === 'failed') {
      return {
        ok: false,
        taskId: payload.taskId,
        granularStatus: payload.granularStatus,
        durationMs: Date.now() - started,
        error: payload.error,
        remediation: remediationFor(payload.granularStatus, payload.code ?? payload.errorDetails?.code),
      };
    }

    const deadline = Date.now() + (timeoutSeconds + 30) * 1000;
    let task = server.components.taskRegistry.getTask(payload.taskId);
    while (!task || !TERMINAL.has(task.granularStatus)) {
      if (Date.now() > deadline) {
        return {
          ok: false,
          taskId: payload.taskId,
          granularStatus: task?.granularStatus,
          durationMs: Date.now() - started,
          error: `Task did not finish within ${timeoutSeconds + 30}s`,
        };
      }
      await new Promise((r) => setTimeout(r, 500));
      task = server.components.taskRegistry.getTask(payload.taskId);
    }

    const succeeded =
      task.granularStatus === 'COMPLETED' || task.granularStatus === 'COMPLETED_WITH_WARNINGS';
    const changedFiles = task.changedFiles ?? [];

    return {
      ok: succeeded && changedFiles.length > 0,
      taskId: payload.taskId,
      granularStatus: task.granularStatus,
      changedFiles,
      diff: task.latestDiff,
      durationMs: Date.now() - started,
      error: succeeded
        ? changedFiles.length === 0
          ? 'Task reported success but produced no changes'
          : undefined
        : task.errorDetails?.message,
      remediation: remediationFor(task.granularStatus, task.errorDetails?.code),
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: (err as Error).message,
    };
  } finally {
    await removeTempRepo(repoDir);
  }
}

/**
 * Removes the throwaway repository, retrying briefly.
 *
 * A worker process can still be flushing its last writes as the delegation
 * resolves, and a recursive remove that races a concurrent write fails with
 * ENOTEMPTY or EBUSY. Swallowing that failure silently leaks a temporary git
 * repository per smoke run, which is how the leak went unnoticed: the only
 * symptom was an occasional cleanup assertion.
 */
async function removeTempRepo(repoDir: string): Promise<void> {
  const delaysMs = [0, 25, 100, 250];

  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    if (delaysMs[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }

    try {
      await fs.rm(repoDir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'EPERM';
      if (!transient || attempt === delaysMs.length - 1) {
        // Never fail the smoke check over cleanup — its verdict is about
        // delegation — but say so rather than hiding it.
        process.stderr.write(
          `warning: could not remove the smoke test repository at ${repoDir}: ${String(error)}\n`,
        );
        return;
      }
    }
  }
}

export function registerSmokeCommand(program: Command): void {
  program
    .command('smoke')
    .description('Delegate one trivial task end to end and confirm it produced a real change')
    .option('--json', 'Output the result as JSON')
    .option('-t, --timeout <seconds>', 'Worker timeout in seconds', '180')
    .action(async (options: { json?: boolean; timeout?: string }) => {
      if (!options.json) {
        console.log('Running a real delegation against a temporary repository...');
      }

      const result = await runSmokeTest({ timeoutSeconds: Number(options.timeout) || 180 });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        console.log(
          `\n[ok] Delegation works. The worker changed ${result.changedFiles?.join(', ')} ` +
            `in ${(result.durationMs / 1000).toFixed(1)}s.\n`,
        );
        console.log(result.diff?.split('\n').slice(0, 20).join('\n'));
      } else {
        console.error(`\n[fail] Delegation did not work: ${result.error ?? 'unknown error'}`);
        if (result.granularStatus) console.error(`       Final state: ${result.granularStatus}`);
        if (result.remediation) console.error(`       → ${result.remediation}`);
        console.error('\nRun "gelada doctor --verbose" for the full diagnostic.');
      }

      process.exitCode = result.ok ? 0 : 1;
    });
}
