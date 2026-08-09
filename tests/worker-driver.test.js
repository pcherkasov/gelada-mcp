import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { AntigravityDriver, DriverError } from '../dist/components/worker-driver.js';
import { ProcessSupervisor } from '../dist/components/process-supervisor.js';

describe('AntigravityDriver & ProcessSupervisor Integration Test Suite', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-driver-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. Command Spawning & Worker Result Lifecycle', () => {
    it('should spawn worker process and complete execution successfully', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'success.js');
      await fs.writeFile(scriptPath, 'console.log("Worker finished successfully");');

      const handle = await driver.spawnWorker({
        taskId: 'task-success',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      assert.equal(handle.workerId, 'worker-task-success');
      assert.equal(handle.taskId, 'task-success');
      assert.ok(handle.pid > 0);
      assert.equal(handle.status, 'running');

      const result = await handle.promise;
      assert.equal(result.status, 'completed');
      assert.equal(result.exitCode, 0);
      assert.ok(result.durationMs >= 0);
      assert.ok(result.stdout.includes('Worker finished successfully'));
    });

    it('should parse quoted command arguments and paths with spaces correctly', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'quoted args test.js');
      await fs.writeFile(
        scriptPath,
        `console.log("ARG1:" + process.argv[2] + " ARG2:" + process.argv[3]);`,
      );

      const command = `"${process.execPath}" "${scriptPath}" "hello world"`;
      const handle = await driver.spawnWorker({
        taskId: 'task-quoted-args',
        command: command,
        args: ['extra-arg'],
        cwd: tempDir,
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('ARG1:hello world ARG2:extra-arg'));
    });
  });

  describe('2. Stdout and Stderr Stream Capture', () => {
    it('should capture stdout and stderr output streams independently', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'streams.js');
      await fs.writeFile(
        scriptPath,
        `console.log("STDOUT_LINE_1"); console.error("STDERR_LINE_1"); console.log("STDOUT_LINE_2");`,
      );

      const handle = await driver.spawnWorker({
        taskId: 'task-streams',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('STDOUT_LINE_1'));
      assert.ok(result.stdout.includes('STDOUT_LINE_2'));
      assert.ok(result.stderr.includes('STDERR_LINE_1'));
      assert.ok(!result.stdout.includes('STDERR_LINE_1'));
    });

    it('should handle large stdout buffer without deadlock', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'large-output.js');
      await fs.writeFile(
        scriptPath,
        `const chunk = "A".repeat(10000) + "\\n"; for (let i=0; i<50; i++) process.stdout.write(chunk);`,
      );

      const handle = await driver.spawnWorker({
        taskId: 'task-large-output',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.length, 500050);
      assert.equal(result.stdoutTruncated, false);
    });

    it('should truncate buffer and append sentinel line when maxBufferBytes is exceeded', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'overflow.js');
      await fs.writeFile(
        scriptPath,
        `const chunk = "B".repeat(100); for (let i=0; i<20; i++) process.stdout.write(chunk);`,
      );

      const handle = await driver.spawnWorker({
        taskId: 'task-overflow',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        maxBufferBytes: 500,
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdoutTruncated, true);
      assert.ok(
        result.stdout.includes('[TRUNCATED: Maximum output buffer size of 500 bytes exceeded]'),
      );
    });
  });

  describe('3. Non-Zero Exit Code & Failure Handling', () => {
    it('should capture non-zero exit code and mark status as failed', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'fail.js');
      await fs.writeFile(scriptPath, 'console.error("Fatal exception"); process.exit(42);');

      const handle = await driver.spawnWorker({
        taskId: 'task-fail',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      const result = await handle.promise;
      assert.equal(result.status, 'failed');
      assert.equal(result.exitCode, 42);
      assert.ok(result.stderr.includes('Fatal exception'));
    });

    it('should reject with DriverError when command executable is non-existent', async () => {
      const driver = new AntigravityDriver();

      await assert.rejects(
        async () => {
          await driver.spawnWorker({
            taskId: 'task-bad-cmd',
            command: '/nonexistent/path/to/binary',
            cwd: tempDir,
          });
        },
        (err) => err instanceof DriverError || err.code === 'ENOENT' || err.code === 'SPAWN_FAILED',
      );
    });
  });

  describe('4. Timeout Handling', () => {
    it('should terminate worker process when timeoutMs is exceeded', async () => {
      const driver = new AntigravityDriver({ defaultTimeoutMs: 500 });
      const scriptPath = path.join(tempDir, 'timeout-script.js');
      await fs.writeFile(scriptPath, 'setInterval(() => {}, 1000);');

      const handle = await driver.spawnWorker({
        taskId: 'task-timeout',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        timeoutMs: 200,
      });

      const result = await handle.promise;
      assert.ok(result.status === 'timed_out' || result.status === 'terminated');
      assert.ok(result.durationMs >= 150);
    });

    it('should terminate worker process when idleTimeoutMs is exceeded', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'idle-script.js');
      await fs.writeFile(
        scriptPath,
        `console.log("start"); setTimeout(() => { console.log("late"); }, 5000); setInterval(() => {}, 1000);`,
      );

      const handle = await driver.spawnWorker({
        taskId: 'task-idle-timeout',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        idleTimeoutMs: 200,
      });

      const result = await handle.promise;
      assert.ok(
        result.status === 'idle_timed_out' ||
          result.status === 'timed_out' ||
          result.status === 'terminated',
      );
    });
  });

  describe('5. Requirement R3: Driver & Supervisor Integration', () => {
    it('should automatically register spawned process in ProcessSupervisor', async () => {
      const supervisor = new ProcessSupervisor();
      const driver = new AntigravityDriver({ supervisor });

      const scriptPath = path.join(tempDir, 'sleep.js');
      await fs.writeFile(scriptPath, 'setInterval(() => {}, 1000);');

      const handle = await driver.spawnWorker({
        taskId: 'task-r3-reg',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      const processInfo = supervisor.getProcess(handle.pid);
      assert.ok(processInfo !== undefined);
      assert.equal(processInfo.pid, handle.pid);
      assert.equal(processInfo.workerId, handle.workerId);
      assert.equal(processInfo.taskId, 'task-r3-reg');

      await supervisor.killProcess(handle.pid);
    });

    it('should terminate worker process when supervisor kills PID', async () => {
      const supervisor = new ProcessSupervisor();
      const driver = new AntigravityDriver({ supervisor });

      const scriptPath = path.join(tempDir, 'sleep.js');
      await fs.writeFile(scriptPath, 'setInterval(() => {}, 1000);');

      const handle = await driver.spawnWorker({
        taskId: 'task-r3-kill',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      const killSuccess = await supervisor.killProcess(handle.pid);
      assert.equal(killSuccess, true);

      const result = await handle.promise;
      assert.ok(result.status === 'terminated' || result.status === 'failed');

      assert.equal(supervisor.getActiveProcesses().length, 0);
    });

    it('should terminate worker when handle.kill() is invoked', async () => {
      const supervisor = new ProcessSupervisor();
      const driver = new AntigravityDriver({ supervisor });

      const scriptPath = path.join(tempDir, 'sleep.js');
      await fs.writeFile(scriptPath, 'setInterval(() => {}, 1000);');

      const handle = await driver.spawnWorker({
        taskId: 'task-r3-handle-kill',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      const killed = await handle.kill();
      assert.equal(killed, true);

      const result = await handle.promise;
      assert.ok(result.status === 'terminated' || result.status === 'failed');
      assert.equal(supervisor.getActiveProcesses().length, 0);
    });
  });

  describe('6. Environment Variable Sanitization (Requirement R1)', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
      process.env.AWS_SECRET_ACCESS_KEY = 'mock-aws-secret-12345';
      process.env.OPENAI_API_KEY = 'sk-mock-openai-key-67890';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-mock-key';
      process.env.GITHUB_TOKEN = 'ghp_mocktoken12345';
      process.env.MY_CUSTOM_HOST_SECRET = 'super-secret-passphrase';
      process.env.SAFE_CUSTOM_VAR = 'safe-value-123';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should strip host secrets and sensitive pattern matching keys by default', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'env-dump.js');
      await fs.writeFile(scriptPath, 'console.log(JSON.stringify(process.env));');

      const handle = await driver.spawnWorker({
        taskId: 'task-env-default',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      const childEnv = JSON.parse(result.stdout);

      // Verify blocked default secret keys are omitted
      assert.equal(childEnv.AWS_SECRET_ACCESS_KEY, undefined);
      assert.equal(childEnv.OPENAI_API_KEY, undefined);
      assert.equal(childEnv.ANTHROPIC_API_KEY, undefined);
      assert.equal(childEnv.GITHUB_TOKEN, undefined);

      // Verify regex pattern matching strips custom secret/passphrase keys
      assert.equal(childEnv.MY_CUSTOM_HOST_SECRET, undefined);

      // Verify safe custom variables pass through
      assert.equal(childEnv.SAFE_CUSTOM_VAR, 'safe-value-123');
    });

    it('should preserve essential system environment variables (PATH, HOME, USER, etc.)', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'env-dump.js');
      await fs.writeFile(scriptPath, 'console.log(JSON.stringify(process.env));');

      const handle = await driver.spawnWorker({
        taskId: 'task-env-system',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      const childEnv = JSON.parse(result.stdout);

      assert.ok(childEnv.PATH !== undefined);
      if (process.env.HOME) {
        assert.equal(childEnv.HOME, process.env.HOME);
      }
    });

    it('should respect custom blockedEnvVars options', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'env-dump.js');
      await fs.writeFile(scriptPath, 'console.log(JSON.stringify(process.env));');

      const handle = await driver.spawnWorker({
        taskId: 'task-env-blocked',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        blockedEnvVars: ['SAFE_CUSTOM_VAR'],
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      const childEnv = JSON.parse(result.stdout);

      assert.equal(childEnv.SAFE_CUSTOM_VAR, undefined);
    });

    it('should respect custom allowedEnvVars options (allowlist mode)', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'env-dump.js');
      await fs.writeFile(scriptPath, 'console.log(JSON.stringify(process.env));');

      const handle = await driver.spawnWorker({
        taskId: 'task-env-allowed',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        allowedEnvVars: ['SAFE_CUSTOM_VAR'],
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      const childEnv = JSON.parse(result.stdout);

      assert.equal(childEnv.SAFE_CUSTOM_VAR, 'safe-value-123');
      // Non-allowlisted custom vars should be excluded
      assert.equal(childEnv.UNALLOWED_CUSTOM_VAR, undefined);
      // Essential system vars should still be preserved
      assert.ok(childEnv.PATH !== undefined);
    });

    it('should allow bypassing sanitization when sanitizeEnv is set to false', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'env-dump.js');
      await fs.writeFile(scriptPath, 'console.log(JSON.stringify(process.env));');

      const handle = await driver.spawnWorker({
        taskId: 'task-env-bypass',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        sanitizeEnv: false,
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      const childEnv = JSON.parse(result.stdout);

      assert.equal(childEnv.AWS_SECRET_ACCESS_KEY, 'mock-aws-secret-12345');
      assert.equal(childEnv.OPENAI_API_KEY, 'sk-mock-openai-key-67890');
    });

    it('should retain explicit task environment variables passed via options.env', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'env-dump.js');
      await fs.writeFile(scriptPath, 'console.log(JSON.stringify(process.env));');

      const handle = await driver.spawnWorker({
        taskId: 'task-env-explicit',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        env: {
          EXPLICIT_TASK_VAR: 'task-specific-value',
        },
      });

      const result = await handle.promise;
      assert.equal(result.exitCode, 0);
      const childEnv = JSON.parse(result.stdout);

      assert.equal(childEnv.EXPLICIT_TASK_VAR, 'task-specific-value');
      assert.equal(childEnv.AWS_SECRET_ACCESS_KEY, undefined);
    });
  });
});

