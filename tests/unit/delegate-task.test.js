import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

import { createGeladaServer } from '../../dist/server.js';
import { registerDelegateTaskTool, isAuthError } from '../../dist/tools/delegate-task.js';
import { registerReviseTaskTool } from '../../dist/tools/revise-task.js';
import { resetWorkerModelCatalogCache } from '../../dist/components/model-catalog.js';
import {
  createMockAgy,
  readAgyArgs,
  waitForTerminalState,
  delegateAndWait,
} from '../helpers/agy-mock.js';

describe('Antigravity CLI (agy) Integration Unit Tests', () => {
  let tempRepoDir;
  let tempDataDir;
  let oldEnvAgy;
  let oldDataDir;

  beforeEach(async () => {
    oldEnvAgy = process.env.AGY_COMMAND;
    oldDataDir = process.env.GELADA_DATA_DIR;

    tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-agy-test-repo-'));

    // Isolate the model-catalog cache so a real catalog on this machine cannot
    // leak into tests that point AGY_COMMAND at a mock.
    tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-agy-test-data-'));
    process.env.GELADA_DATA_DIR = tempDataDir;
    resetWorkerModelCatalogCache();

    execSync('git init', { cwd: tempRepoDir });
    execSync('git config user.name "Test User"', { cwd: tempRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: tempRepoDir });
    await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Test Repo');
    execSync('git add . && git commit -m "initial commit"', { cwd: tempRepoDir });
  });

  afterEach(async () => {
    if (oldEnvAgy !== undefined) process.env.AGY_COMMAND = oldEnvAgy;
    else delete process.env.AGY_COMMAND;

    if (oldDataDir !== undefined) process.env.GELADA_DATA_DIR = oldDataDir;
    else delete process.env.GELADA_DATA_DIR;

    resetWorkerModelCatalogCache();

    for (const dir of [tempRepoDir, tempDataDir]) {
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  function setupToolHandlers() {
    const server = createGeladaServer();
    const handlers = {};

    // Accepts both the legacy `tool()` registration and `registerTool()`.
    const mockMcpServer = {
      tool: (name, _desc, _shape, handler) => {
        handlers[name] = handler;
      },
      registerTool: (name, _config, handler) => {
        handlers[name] = handler;
      },
    };

    registerDelegateTaskTool(mockMcpServer, server.components);
    registerReviseTaskTool(mockMcpServer, server.components);

    return {
      server,
      delegateHandler: handlers.delegate_task,
      reviseHandler: handlers.revise_task,
    };
  }

  describe('1. helper isAuthError', () => {
    it('should correctly identify authentication error keywords', () => {
      assert.equal(isAuthError('Error: auth required before proceeding'), true);
      assert.equal(isAuthError('Authentication required'), true);
      assert.equal(isAuthError('Login required to access API'), true);
      assert.equal(isAuthError('Please run login'), true);
      assert.equal(isAuthError('Please run agy login'), true);
      assert.equal(isAuthError('Please authenticate your account'), true);
      assert.equal(isAuthError('Please re-authenticate'), true);
      assert.equal(isAuthError('User is unauthenticated'), true);
      assert.equal(isAuthError('Not logged in to Antigravity service'), true);
      assert.equal(isAuthError('Authentication failed: invalid token'), true);
      assert.equal(isAuthError('Invalid auth credentials'), true);
      assert.equal(isAuthError('Invalid api key'), true);
      assert.equal(isAuthError('Token expired. Please login.'), true);
      assert.equal(isAuthError('HTTP 401 Unauthorized'), true);
      assert.equal(isAuthError('401 unauthorized'), true);
      assert.equal(isAuthError('agy login failed'), true);

      assert.equal(isAuthError('Normal error: file not found'), false);
      assert.equal(isAuthError(''), false);
      assert.equal(isAuthError('error: pathspec "login.ts" did not match any file(s)'), false);
      assert.equal(isAuthError('src/components/login_component.ts:12:8 - error TS2304'), false);
      assert.equal(isAuthError('Error: File not found at src/pages/login/index.ts:42'), false);
      assert.equal(isAuthError('SyntaxError in components/login/LoginForm.tsx line 5'), false);
    });
  });

  describe('2. delegate_task worker invocation', () => {
    it('passes the resolved model, the worktree and the prompt to the worker', async () => {
      const logFile = path.join(tempRepoDir, 'agy_args.json');
      const { command } = await createMockAgy(tempRepoDir, { logFile });
      process.env.AGY_COMMAND = command;

      const { server, delegateHandler } = setupToolHandlers();

      const { payload } = await delegateAndWait(
        delegateHandler,
        server.components.taskRegistry,
        {
          repoPath: tempRepoDir,
          taskType: 'unit-test',
          objective: 'Write tests for feature A',
          modelProfile: 'mock-pro-high',
        },
      );

      assert.equal(payload.status, 'running');

      const args = await readAgyArgs(logFile);
      assert.equal(args.model, 'mock-pro-high');
      assert.ok(args.prompt.includes('Write tests for feature A'));

      // --add-dir is what makes the worker operate on our worktree at all.
      assert.ok(args.addDir, '--add-dir must be passed');
      assert.ok(
        args.addDir.includes('.worktrees'),
        `--add-dir should point at the task worktree, got ${args.addDir}`,
      );
    });

    it('resolves an abstract profile to a model the worker catalog offers', async () => {
      const logFile = path.join(tempRepoDir, 'agy_args_profile.json');
      const { command } = await createMockAgy(tempRepoDir, { logFile });
      process.env.AGY_COMMAND = command;

      const { server, delegateHandler } = setupToolHandlers();

      await delegateAndWait(delegateHandler, server.components.taskRegistry, {
        repoPath: tempRepoDir,
        taskType: 'doc-gen',
        objective: 'Generate documentation',
        modelProfile: 'FAST',
      });

      const args = await readAgyArgs(logFile);
      assert.equal(args.model, 'mock-flash-medium');
    });

    it('falls back to the project policy defaultModelProfile when none is given', async () => {
      const geladaDir = path.join(tempRepoDir, '.gelada');
      await fs.mkdir(geladaDir, { recursive: true });
      await fs.writeFile(path.join(geladaDir, 'policy.yaml'), 'defaultModelProfile: DEEP\n');

      const logFile = path.join(tempRepoDir, 'agy_args_policy.json');
      const { command } = await createMockAgy(tempRepoDir, { logFile });
      process.env.AGY_COMMAND = command;

      const { server, delegateHandler } = setupToolHandlers();

      await delegateAndWait(delegateHandler, server.components.taskRegistry, {
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Refactor module B',
      });

      const args = await readAgyArgs(logFile);
      assert.equal(args.model, 'mock-pro-high');
    });

    it('rejects a model the worker catalog does not know, before spawning', async () => {
      const logFile = path.join(tempRepoDir, 'agy_args_unknown.json');
      const { command } = await createMockAgy(tempRepoDir, { logFile });
      process.env.AGY_COMMAND = command;

      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Use a model that does not exist',
        modelProfile: 'gemini-2.5-pro',
      });

      const data = JSON.parse(res.content[0].text);
      assert.equal(data.status, 'failed');
      assert.equal(data.code, 'UNKNOWN_MODEL');
      await assert.rejects(() => fs.readFile(logFile, 'utf-8'), 'worker must not be spawned');
    });
  });

  describe('3. Missing Binary (ENOENT) Error Handling', () => {
    it('should return clear user-friendly error when agy binary is missing or not in PATH', async () => {
      process.env.AGY_COMMAND = '/nonexistent/path/to/missing-agy-executable';

      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Run test on missing binary',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'failed');
      assert.equal(resData.code, 'AGY_NOT_FOUND');
      assert.match(resData.error, /was not found/i);
      assert.match(resData.error, /ensure agy is installed/i);
    });
  });

  describe('4. Authentication Failure Error Handling', () => {
    it('should return structured error instructing user to run agy login when auth failure occurs', async () => {
      const { command } = await createMockAgy(tempRepoDir, {
        name: 'mock_auth_fail.mjs',
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Authentication required. User is unauthenticated.',
        writes: {},
      });
      process.env.AGY_COMMAND = command;

      const { server, delegateHandler } = setupToolHandlers();

      const { payload, task } = await delegateAndWait(
        delegateHandler,
        server.components.taskRegistry,
        {
          repoPath: tempRepoDir,
          taskType: 'unit-test',
          objective: 'Run test on auth failure',
        },
      );

      assert.equal(payload.status, 'running');
      assert.equal(task.granularStatus, 'AUTH_REQUIRED');
      assert.equal(task.errorDetails.code, 'AUTH_REQUIRED');
      assert.match(task.errorDetails.message, /agy login/i);
    });
  });

  describe('5. Worker that changes nothing', () => {
    it('reports FAILED_WORKER rather than COMPLETED when the diff is empty', async () => {
      const { command } = await createMockAgy(tempRepoDir, {
        name: 'mock_noop.mjs',
        writes: {},
        stdout: 'I have completed the task.',
      });
      process.env.AGY_COMMAND = command;

      const { server, delegateHandler } = setupToolHandlers();

      const { task } = await delegateAndWait(delegateHandler, server.components.taskRegistry, {
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Silently do nothing',
      });

      assert.equal(task.granularStatus, 'FAILED_WORKER');
      assert.equal(task.errorDetails.code, 'WORKER_NO_CHANGES');
    });
  });

  describe('6. revise_task AGY Integration', () => {
    it('should spawn agy with --model profile flag and handle auth error in revise_task', async () => {
      const { command } = await createMockAgy(tempRepoDir, {
        name: 'mock_agy_success.mjs',
        writes: { 'feature.js': 'export const feature = 1;\n' },
      });
      process.env.AGY_COMMAND = command;

      const { server, delegateHandler, reviseHandler } = setupToolHandlers();

      const { payload: delData, task } = await delegateAndWait(
        delegateHandler,
        server.components.taskRegistry,
        {
          repoPath: tempRepoDir,
          taskType: 'unit-test',
          objective: 'Initial task objective',
        },
      );

      assert.equal(delData.status, 'running');
      // The repo carries the mock scripts as untracked files, so a warning here
      // is expected; what matters is that the task succeeded.
      assert.ok(
        ['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(task.granularStatus),
        `expected a successful terminal state, got ${task.granularStatus}`,
      );

      const { command: authFailCommand } = await createMockAgy(tempRepoDir, {
        name: 'mock_agy_auth_fail.mjs',
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Please run agy login to authenticate.',
        writes: {},
      });
      process.env.AGY_COMMAND = authFailCommand;

      const revRes = await reviseHandler({
        taskId: delData.taskId,
        revisionNotes: 'Add extra tests for edge cases',
      });
      const revData = JSON.parse(revRes.content[0].text);
      assert.equal(revData.status, 'failed');
      assert.equal(revData.code, 'AUTH_REQUIRED');
      assert.match(revData.error, /agy login/i);
    });
  });
  describe('7. Nested delegation guard', () => {
    it('refuses to delegate from inside a worker, without registering a task', async () => {
      // Antigravity's IDE and its CLI read one shared mcp_config.json, so a
      // Gelada registered for the IDE is loaded into the worker's own `agy` run
      // too. The worker driver marks its children so this can be refused.
      const { server, delegateHandler } = setupToolHandlers();
      const before = server.components.taskRegistry.getAllTasks?.().length ?? 0;

      process.env.GELADA_WORKER = '1';
      try {
        const res = await delegateHandler({
          objective: 'Delegate something from inside a worker',
          repoPath: tempRepoDir,
          allowedPaths: ['src/**'],
        });
        const data = JSON.parse(res.content[0].text);

        assert.equal(data.status, 'failed');
        assert.match(data.error, /[Nn]ested delegation/);
        assert.equal(data.taskId, undefined, 'a refused delegation must not mint a task id');
        assert.equal(
          server.components.taskRegistry.getAllTasks?.().length ?? 0,
          before,
          'a refused delegation must not register a task',
        );
      } finally {
        delete process.env.GELADA_WORKER;
      }
    });

    it('delegates normally when the marker is absent', async () => {
      const { command } = await createMockAgy(tempRepoDir, {});
      process.env.AGY_COMMAND = command;
      delete process.env.GELADA_WORKER;

      const { server, delegateHandler } = setupToolHandlers();
      const { payload } = await delegateAndWait(delegateHandler, server.components.taskRegistry, {
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Write tests for feature A',
        modelProfile: 'mock-pro-high',
      });

      assert.ok(payload.taskId, 'a normal delegation still mints a task id');
      assert.equal(payload.status, 'running');
    });
  });
});
