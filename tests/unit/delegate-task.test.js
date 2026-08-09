import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

import { createGeladaServer } from '../../dist/server.js';
import { registerDelegateTaskTool, isAuthError } from '../../dist/tools/delegate-task.js';
import { registerReviseTaskTool } from '../../dist/tools/revise-task.js';

describe('Antigravity CLI (agy) Integration Unit Tests', () => {
  let tempRepoDir;
  let oldEnvAgy;

  beforeEach(async () => {
    oldEnvAgy = process.env.AGY_COMMAND;
    tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-agy-test-repo-'));
    // Initialize dummy git repository
    execSync('git init', { cwd: tempRepoDir });
    execSync('git config user.name "Test User"', { cwd: tempRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: tempRepoDir });
    await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Test Repo');
    execSync('git add . && git commit -m "initial commit"', { cwd: tempRepoDir });
  });

  afterEach(async () => {
    if (oldEnvAgy !== undefined) {
      process.env.AGY_COMMAND = oldEnvAgy;
    } else {
      delete process.env.AGY_COMMAND;
    }
    if (tempRepoDir) {
      await fs.rm(tempRepoDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  function setupToolHandlers() {
    const server = createGeladaServer();
    let delegateHandler;
    let reviseHandler;

    const mockMcpServer = {
      tool: (name, desc, shape, handler) => {
        if (name === 'delegate_task') delegateHandler = handler;
        if (name === 'revise_task') reviseHandler = handler;
      },
    };

    registerDelegateTaskTool(mockMcpServer, server.components);
    registerReviseTaskTool(mockMcpServer, server.components);

    return { server, delegateHandler, reviseHandler };
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

  describe('2. delegate_task spawning agy with model profile flag', () => {
    it('should spawn agy CLI with correct prompt and explicitly passed --model profile flag', async () => {
      const logFile = path.join(tempRepoDir, 'agy_args.json');
      const mockScript = path.join(tempRepoDir, 'mock_agy.js');
      await fs.writeFile(
        mockScript,
        `import fs from 'node:fs';
         const args = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(args));
         console.log('Mock agy executed');
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = `${process.execPath} ${mockScript}`;

      const { server, delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Write tests for feature A',
        modelProfile: 'fast-profile',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'running');

      await new Promise(r => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 50));
      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      assert.equal(loggedArgs[0], '--model');
      assert.equal(loggedArgs[1], 'fast-profile');
      assert.equal(loggedArgs[2], '--prompt');
      assert.ok(loggedArgs[3].includes('Objective: Write tests for feature A'));
    });

    it('should fallback to Policy Engine defaultModelProfile when modelProfile argument is omitted', async () => {
      // Create .gelada/policy.yaml in target repo setting defaultModelProfile
      const geladaDir = path.join(tempRepoDir, '.gelada');
      await fs.mkdir(geladaDir, { recursive: true });
      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        'defaultModelProfile: custom-policy-model\n',
      );

      const logFile = path.join(tempRepoDir, 'agy_args.json');
      const mockScript = path.join(tempRepoDir, 'mock_agy.js');
      await fs.writeFile(
        mockScript,
        `import fs from 'node:fs';
         const args = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(args));
         console.log('Mock agy executed');
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = `${process.execPath} ${mockScript}`;

      const { server, delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Refactor module B',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'running');

      await new Promise(r => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 50));
      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      assert.equal(loggedArgs[0], '--model');
      assert.equal(loggedArgs[1], 'custom-policy-model');
      assert.equal(loggedArgs[2], '--prompt');
    });

    it('should fallback to default model profile ("default") when no repo policy or arg is provided', async () => {
      const logFile = path.join(tempRepoDir, 'agy_args_default.json');
      const mockScript = path.join(tempRepoDir, 'mock_agy.js');
      await fs.writeFile(
        mockScript,
        `import fs from 'node:fs';
         const args = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(args));
         console.log('Mock agy executed');
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = `${process.execPath} ${mockScript}`;

      const { server, delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'doc-gen',
        objective: 'Generate documentation',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'running');

      await new Promise((r) => setTimeout(r, 50));
      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      assert.equal(loggedArgs[0], '--model');
      assert.equal(loggedArgs[1], 'inherit');
    });
  });

  describe('3. Missing Binary (ENOENT) Error Handling', () => {
    it('should return clear user-friendly error when agy binary is missing or not in PATH', async () => {
      process.env.AGY_COMMAND = '/nonexistent/path/to/missing-agy-executable';

      const { server, delegateHandler } = setupToolHandlers();

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
      const mockScript = path.join(tempRepoDir, 'mock_auth_fail.js');
      await fs.writeFile(
        mockScript,
        `console.error("Error: Authentication required. User is unauthenticated.");
         process.exit(1);
        `,
      );

      process.env.AGY_COMMAND = `${process.execPath} ${mockScript}`;

      const { server, delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Run test on auth failure',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'running');
      await new Promise((r) => setTimeout(r, 50));
      const task = server.components.taskRegistry.getTask(resData.taskId);
      assert.equal(task.granularStatus, 'AUTH_REQUIRED');
      assert.equal(task.errorDetails.code, 'AUTH_REQUIRED');
      assert.match(task.errorDetails.message, /agy login/i);
    });
  });

  describe('5. revise_task AGY Integration', () => {
    it('should spawn agy with --model profile flag and handle auth error in revise_task', async () => {
      const mockScriptSuccess = path.join(tempRepoDir, 'mock_agy_success.js');
      await fs.writeFile(mockScriptSuccess, `console.log("Success"); process.exit(0);`);
      process.env.AGY_COMMAND = `${process.execPath} ${mockScriptSuccess}`;

      const { server, delegateHandler, reviseHandler } = setupToolHandlers();

      // Delegate task first
      const delRes = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Initial task objective',
      });
      const delData = JSON.parse(delRes.content[0].text);
      assert.equal(delData.status, 'running');
      const taskId = delData.taskId;
      await new Promise((r) => setTimeout(r, 50));
      const task = server.components.taskRegistry.getTask(taskId);
      assert.notEqual(task.granularStatus, 'FAILED_WORKER');

      // Revise task with auth failure script
      const mockScriptAuthFail = path.join(tempRepoDir, 'mock_agy_auth_fail.js');
      await fs.writeFile(
        mockScriptAuthFail,
        `console.error("Error: Please run agy login to authenticate."); process.exit(1);`,
      );
      process.env.AGY_COMMAND = `${process.execPath} ${mockScriptAuthFail}`;

      const revRes = await reviseHandler({
        taskId,
        revisionNotes: 'Add extra tests for edge cases',
      });
      const revData = JSON.parse(revRes.content[0].text);
      assert.equal(revData.status, 'failed');
      assert.equal(revData.code, 'AUTH_REQUIRED');
      assert.match(revData.error, /agy login/i);
    });
  });
});
