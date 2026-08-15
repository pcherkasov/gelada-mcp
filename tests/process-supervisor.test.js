import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

import { ProcessSupervisor } from '../dist/components/process-supervisor.js';
import { waitForOutput, waitUntil } from './helpers/wait-for.js';

describe('ProcessSupervisor Test Suite', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-supervisor-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. Registration and Indexing', () => {
    it('should register a running child process with PID and metadata', async () => {
      const supervisor = new ProcessSupervisor();
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: tempDir,
      });

      assert.ok(child.pid > 0);

      const info = supervisor.registerProcess(
        child.pid,
        {
          workerId: 'worker-t-1',
          taskId: 'task-1',
          command: 'node sleep',
        },
        child,
      );

      assert.equal(info.pid, child.pid);
      assert.equal(info.workerId, 'worker-t-1');
      assert.equal(info.taskId, 'task-1');
      assert.equal(info.status, 'running');
      assert.ok(info.startTime > 0);

      const retrieved = supervisor.getProcess(child.pid);
      assert.deepEqual(retrieved, info);

      const retrievedByWorker = supervisor.getProcessByWorkerId('worker-t-1');
      assert.deepEqual(retrievedByWorker, info);

      const activeList = supervisor.getActiveProcesses();
      assert.equal(activeList.length, 1);
      assert.equal(activeList[0].pid, child.pid);

      await supervisor.killProcess(child.pid);
    });

    it('should return undefined when querying an unregistered PID', () => {
      const supervisor = new ProcessSupervisor();
      assert.equal(supervisor.getProcess(999999), undefined);
    });
  });

  describe('2. Process Lifecycle & State Cleanup', () => {
    it('should automatically update process status and unregister on natural child exit', async () => {
      const supervisor = new ProcessSupervisor();
      const child = spawn(process.execPath, ['-e', 'console.log("quick exit")'], { cwd: tempDir });

      supervisor.registerProcess(
        child.pid,
        { workerId: 'worker-quick', taskId: 'task-quick', command: 'node quick' },
        child,
      );

      await new Promise((resolve) => child.on('exit', resolve));
      // The supervisor reaps on its own exit handler, so wait for the state it
      // reaches rather than for a duration it usually takes to get there.
      await waitUntil(() => supervisor.getActiveProcesses().length === 0, {
        label: 'the supervisor to drop the exited process',
      });

      const active = supervisor.getActiveProcesses();
      assert.equal(active.length, 0);

      const info = supervisor.getProcess(child.pid);
      assert.ok(info === undefined || info.status === 'exited' || info.status === 'completed');
    });
  });

  describe('3. Signal Termination & Signal Escalation', () => {
    it('should gracefully terminate process using SIGTERM', async () => {
      const supervisor = new ProcessSupervisor();
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: tempDir,
      });

      supervisor.registerProcess(
        child.pid,
        { workerId: 'worker-sigterm', taskId: 'task-sigterm', command: 'node sleep' },
        child,
      );

      const success = await supervisor.killProcess(child.pid, 'SIGTERM');
      assert.equal(success, true);

      const active = supervisor.getActiveProcesses();
      assert.equal(active.length, 0);
    });

    it('should escalate to SIGKILL if process ignores SIGTERM within grace period', async () => {
      const supervisor = new ProcessSupervisor({ gracePeriodMs: 250 });
      const ignoreScript = path.join(tempDir, 'ignore-sigterm.js');
      // Announces itself once the handler is installed, so the test can wait
      // for that instead of assuming it fits in a fixed number of milliseconds.
      await fs.writeFile(
        ignoreScript,
        `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('ready');`,
      );

      const child = spawn(process.execPath, [ignoreScript], {
        cwd: tempDir,
        detached: true,
        stdio: 'pipe',
      });
      const ready = waitForOutput(child.stdout, 'ready', {
        label: 'the child to install its SIGTERM handler',
      });
      child.stderr.on('data', () => {});

      supervisor.registerProcess(
        child.pid,
        { workerId: 'worker-stubborn', taskId: 'task-stubborn', command: 'node ignore-sigterm.js' },
        child,
      );

      // Escalation can only be measured once the handler exists to ignore the
      // signal. Signalling too early kills the child outright, and the elapsed
      // assertion below then blames the grace period.
      await ready;

      const startTime = Date.now();
      const success = await supervisor.killProcess(child.pid, 'SIGTERM');
      const elapsed = Date.now() - startTime;

      assert.equal(success, true);
      assert.ok(elapsed >= 200, `Expected grace period delay >= 200ms, got ${elapsed}ms`);
      assert.equal(supervisor.getActiveProcesses().length, 0);
    });
  });

  describe('4. Batch Process Termination (killAll / shutdownAll)', () => {
    it('should terminate all active processes when killAll() is invoked', async () => {
      const supervisor = new ProcessSupervisor();
      const child1 = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: tempDir,
      });
      const child2 = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: tempDir,
      });

      supervisor.registerProcess(
        child1.pid,
        { workerId: 'w-1', taskId: 't-1', command: 'sleep1' },
        child1,
      );
      supervisor.registerProcess(
        child2.pid,
        { workerId: 'w-2', taskId: 't-2', command: 'sleep2' },
        child2,
      );

      assert.equal(supervisor.getActiveProcesses().length, 2);

      await supervisor.killAll();

      assert.equal(supervisor.getActiveProcesses().length, 0);
    });
  });

  describe('5. Error Handling & Idempotency', () => {
    it('should return false when attempting to kill non-existent or already terminated PID', async () => {
      const supervisor = new ProcessSupervisor();
      const result = await supervisor.killProcess(999999);
      assert.equal(result, false);
    });
  });
});
