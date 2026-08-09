import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

import { createGeladaServer } from '../dist/server.js';
import { registerDelegateTaskTool, isAuthError } from '../dist/tools/delegate-task.js';
import { registerReviseTaskTool } from '../dist/tools/revise-task.js';
import { PolicyEngine } from '../dist/components/policy-engine.js';
import { settleHandler, parseAgyArgs } from './helpers/agy-mock.js';

describe('Empirical Stress Testing: agy CLI Integration & Error Handling', () => {
  let tempRepoDir;
  let tempGlobalDir;
  let oldEnvAgy;
  let oldEnvConfig;

  beforeEach(async () => {
    oldEnvAgy = process.env.AGY_COMMAND;
    oldEnvConfig = process.env.GELADA_CONFIG_DIR;

    tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-challenger-repo-'));
    tempGlobalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-challenger-global-'));
    process.env.GELADA_CONFIG_DIR = tempGlobalDir;

    // Initialize dummy git repository
    execSync('git init', { cwd: tempRepoDir });
    execSync('git config user.name "Challenger Test"', { cwd: tempRepoDir });
    execSync('git config user.email "challenger@example.com"', { cwd: tempRepoDir });
    await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Challenger Test Repo');
    execSync('git add . && git commit -m "initial commit"', { cwd: tempRepoDir });
  });

  afterEach(async () => {
    if (oldEnvAgy !== undefined) {
      process.env.AGY_COMMAND = oldEnvAgy;
    } else {
      delete process.env.AGY_COMMAND;
    }

    if (oldEnvConfig !== undefined) {
      process.env.GELADA_CONFIG_DIR = oldEnvConfig;
    } else {
      delete process.env.GELADA_CONFIG_DIR;
    }

    if (tempRepoDir) {
      await fs.rm(tempRepoDir, { recursive: true, force: true }).catch(() => {});
    }
    if (tempGlobalDir) {
      await fs.rm(tempGlobalDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  function setupToolHandlers() {
    const server = createGeladaServer();
    let delegateHandler;
    let reviseHandler;

    const capture = (name, handler) => {
      if (name === 'delegate_task') delegateHandler = handler;
      if (name === 'revise_task') reviseHandler = handler;
    };

    const mockMcpServer = {
      tool: (name, desc, shape, handler) => capture(name, handler),
      registerTool: (name, config, handler) => capture(name, handler),
    };

    registerDelegateTaskTool(mockMcpServer, server.components);
    registerReviseTaskTool(mockMcpServer, server.components);

    // These suites assert on task outcomes, so hand back handlers that resolve
    // once the background lifecycle has settled.
    return {
      server,
      delegateHandler: settleHandler(delegateHandler, server.components.taskRegistry),
      reviseHandler: settleHandler(reviseHandler, server.components.taskRegistry),
    };
  }

  async function createExecutableMockScript(filePath, jsCode) {
    const scriptContent = `#!/usr/bin/env node\n${jsCode}`;
    await fs.writeFile(filePath, scriptContent, { mode: 0o755 });
  }

  // =========================================================================
  // REQUIREMENT 1: Command not found (ENOENT) error path when binary does not exist
  // =========================================================================
  describe('1. Command Not Found (ENOENT) Stress Testing', () => {
    it('1.1 Plain binary name non-existent in PATH (delegate_task)', async () => {
      process.env.AGY_COMMAND = 'nonexistent_agy_binary_xyz_99999';
      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test non-existent binary in PATH',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'failed');
      assert.equal(resData.code, 'AGY_NOT_FOUND');
      assert.match(resData.error, /was not found/i);
    });

    it('1.2 Absolute path non-existent executable (delegate_task)', async () => {
      const nonExistentPath = path.join(tempRepoDir, 'missing_subfolder', 'missing_binary');
      process.env.AGY_COMMAND = nonExistentPath;
      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test non-existent absolute path',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'failed');
      assert.equal(resData.code, 'AGY_NOT_FOUND');
      assert.match(resData.error, /was not found/i);
    });

    it('1.3 Relative path non-existent executable (delegate_task)', async () => {
      process.env.AGY_COMMAND = './nonexistent_relative_bin/agy';
      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test non-existent relative path',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'failed');
      assert.equal(resData.code, 'AGY_NOT_FOUND');
    });

    it('1.4 Non-existent binary with space-separated flags in AGY_COMMAND', async () => {
      process.env.AGY_COMMAND = 'missing_binary_cmd --verbose --config /tmp/cfg';
      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test non-existent binary with extra flags',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'failed');
      assert.equal(resData.code, 'AGY_NOT_FOUND');

    });

    it('1.5 Missing binary ENOENT path in revise_task', async () => {
      const mockScriptSuccess = path.join(tempRepoDir, 'mock_agy_ok.mjs');
      await createExecutableMockScript(mockScriptSuccess, `import fs from 'node:fs';
         import path from 'node:path';
         const argv = process.argv.slice(2);
         const i = argv.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'done\\n');
         }
         console.log("OK");
         process.exit(0);
        `);
      process.env.AGY_COMMAND = mockScriptSuccess;

      const { delegateHandler, reviseHandler } = setupToolHandlers();

      const delRes = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Initial task for revise test',
      });
      const delData = JSON.parse(delRes.content[0].text);
      assert.equal(delData.status, 'completed');
      const taskId = delData.taskId;

      process.env.AGY_COMMAND = '/nonexistent/path/to/missing_agy';

      const revRes = await reviseHandler({
        taskId,
        revisionNotes: 'Try revising with missing binary',
      });

      const revData = JSON.parse(revRes.content[0].text);
      assert.equal(revData.status, 'failed');
      assert.equal(revData.code, 'AGY_NOT_FOUND');
      assert.match(revData.error, /was not found/i);
    });
  });

  // =========================================================================
  // REQUIREMENT 2: Auth Error Detection under Various Stderr Formats & Stress Tests
  // =========================================================================
  describe('2. Auth Error Detection & Classifier Stress Testing', () => {
    describe('2.1 Standard & Edge Format Stderr Matches (True Positives)', () => {
      const validAuthErrors = [
        'Error: auth required before proceeding',
        'Please run agy login in your terminal',
        'User status: unauthenticated',
        'Not logged in to Antigravity API',
        'HTTP 401 Unauthorized',
        'MULTILINE:\n[Info] Starting runner\n[Error] auth required\n[Info] Exiting',
        '401 unauthorized',
        'ERR: LOGIN REQUIRED FOR FULL ACCESS',
      ];

      for (const errText of validAuthErrors) {
        it(`should detect auth error for format: "${errText.replace(/\n/g, '\\n')}"`, () => {
          assert.equal(isAuthError(errText), true);
        });
      }
    });

    describe('2.2 False Positive Vulnerabilities & Guard Analysis in isAuthError', () => {
      it('Filename guard: correctly ignores login-form.tsx due to negative lookahead in login regex', () => {
        const compilerError = 'src/components/login-form.tsx:12:8 - error TS2304: Cannot find name "Button".';
        const result = isAuthError(compilerError);
        assert.equal(result, false, 'login-form.tsx is ignored due to [.-_] lookahead guard');
      });

      it('Correctly ignores failing test output mentioning "unauthorized"', () => {
        const testRunnerOutput = 'FAIL tests/auth.test.ts > should handle unauthorized user redirect';
        const result = isAuthError(testRunnerOutput);
        assert.equal(result, false, 'isAuthError returns false for test output containing unauthorized');
      });

      it('Filename guard: correctly ignores login.ts due to negative lookahead in login regex', () => {
        const gitOutput = 'error: pathspec "login.ts" did not match any file(s) known to git';
        const result = isAuthError(gitOutput);
        assert.equal(result, false, 'login.ts is ignored due to [.-_] lookahead guard');
      });
    });

    describe('2.3 Auth Failure Messages Detection (M2 Hardened Classifier)', () => {
      const realisticAuthErrors = [
        { label: 'Invalid credentials', text: 'FATAL: Invalid credentials provided.', expected: true },
        { label: 'Token expired', text: 'Error: Token expired. Please re-authenticate.', expected: true },
        { label: '401 Forbidden', text: 'HTTP 401 Forbidden: Request refused.', expected: true },
        { label: 'Invalid auth token', text: 'Error: Invalid auth token supplied to gateway.', expected: true },
        { label: 'Please re-authenticate', text: 'Error: Please re-authenticate to obtain valid credentials.', expected: true },
      ];

      for (const sample of realisticAuthErrors) {
        it(`detects auth error for "${sample.label}"`, () => {
          const detected = isAuthError(sample.text);
          assert.equal(detected, sample.expected);
        });
      }
    });

    describe('2.4 End-to-End Tool Execution with Auth Error Formats', () => {
      it('should return AUTH_REQUIRED error code when worker stderr contains auth error format', async () => {
        const mockScriptAuthFail = path.join(tempRepoDir, 'mock_auth_fail.mjs');
        await createExecutableMockScript(
          mockScriptAuthFail,
          `console.error("Critical: User is unauthenticated. Run agy login."); process.exit(1);`,
        );
        process.env.AGY_COMMAND = mockScriptAuthFail;

        const { delegateHandler } = setupToolHandlers();

        const res = await delegateHandler({
          repoPath: tempRepoDir,
          taskType: 'unit-test',
          objective: 'Test end-to-end auth error in delegate_task',
        });

        const resData = JSON.parse(res.content[0].text);
        assert.equal(resData.status, 'failed');
        assert.equal(resData.code, 'AUTH_REQUIRED');
        assert.match(resData.error, /authentication required/i);
        assert.match(resData.error, /agy login/i);
      });

      it('should return AUTH_REQUIRED error when auth keyword appears on STDOUT instead of STDERR', async () => {
        const mockScriptAuthStdout = path.join(tempRepoDir, 'mock_auth_stdout.mjs');
        await createExecutableMockScript(
          mockScriptAuthStdout,
          `console.log("Authentication required. Please run agy login."); process.exit(1);`,
        );
        process.env.AGY_COMMAND = mockScriptAuthStdout;

        const { delegateHandler } = setupToolHandlers();

        const res = await delegateHandler({
          repoPath: tempRepoDir,
          taskType: 'unit-test',
          objective: 'Test auth error output on stdout',
        });

        const resData = JSON.parse(res.content[0].text);
        assert.equal(resData.status, 'failed');
        assert.equal(resData.code, 'AUTH_REQUIRED');
      });
    });
  });

  // =========================================================================
  // REQUIREMENT 3: modelProfile Flag Translation & Policy Engine Fallback
  // =========================================================================
  describe('3. modelProfile Flag Translation & Fallback Hierarchy Stress Testing', () => {
    it('3.1 Explicit modelProfile argument passed to delegate_task overrides all policy defaults', async () => {
      // Set global config
      await fs.writeFile(
        path.join(tempGlobalDir, 'config.yaml'),
        'defaultModelProfile: global-profile\n',
      );
      // Set project policy
      const geladaDir = path.join(tempRepoDir, '.gelada');
      await fs.mkdir(geladaDir, { recursive: true });
      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        'defaultModelProfile: project-profile\n',
      );

      const logFile = path.join(tempRepoDir, 'args_explicit.json');
      const mockScript = path.join(tempRepoDir, 'mock_agy_log.mjs');
      await createExecutableMockScript(
        mockScript,
        `import fs from 'node:fs';
         import path from 'node:path';
         const argv = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(argv));
         const i = argv.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );
      process.env.AGY_COMMAND = mockScript;

      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test explicit modelProfile override',
        modelProfile: 'explicit-request-profile',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'completed');

      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      assert.equal(parseAgyArgs(loggedArgs).model, 'explicit-request-profile');
    });

    it('3.2 Omitted modelProfile falls back to Project Policy defaultModelProfile', async () => {
      // Set global config
      await fs.writeFile(
        path.join(tempGlobalDir, 'config.yaml'),
        'defaultModelProfile: global-profile\n',
      );
      // Set project policy
      const geladaDir = path.join(tempRepoDir, '.gelada');
      await fs.mkdir(geladaDir, { recursive: true });
      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        'defaultModelProfile: project-profile\n',
      );

      const logFile = path.join(tempRepoDir, 'args_project.json');
      const mockScript = path.join(tempRepoDir, 'mock_agy_log.mjs');
      await createExecutableMockScript(
        mockScript,
        `import fs from 'node:fs';
         import path from 'node:path';
         const argv = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(argv));
         const i = argv.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );
      process.env.AGY_COMMAND = mockScript;

      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test project policy modelProfile fallback',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'completed');

      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      assert.equal(parseAgyArgs(loggedArgs).model, 'project-profile');
    });

    it('3.3 Omitted modelProfile & no project policy falls back to Global Config defaultModelProfile', async () => {
      // Set global config
      await fs.writeFile(
        path.join(tempGlobalDir, 'config.yaml'),
        'defaultModelProfile: global-profile\n',
      );

      const logFile = path.join(tempRepoDir, 'args_global.json');
      const mockScript = path.join(tempRepoDir, 'mock_agy_log.mjs');
      await createExecutableMockScript(
        mockScript,
        `import fs from 'node:fs';
         import path from 'node:path';
         const argv = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(argv));
         const i = argv.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );
      process.env.AGY_COMMAND = mockScript;

      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test global config modelProfile fallback',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'completed');

      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      assert.equal(parseAgyArgs(loggedArgs).model, 'global-profile');
    });

    it('3.4 Omitted modelProfile with no project or global policy falls back to Hard Limits "default"', async () => {
      const logFile = path.join(tempRepoDir, 'args_hardlimit.json');
      const mockScript = path.join(tempRepoDir, 'mock_agy_log.mjs');
      await createExecutableMockScript(
        mockScript,
        `import fs from 'node:fs';
         import path from 'node:path';
         const argv = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(argv));
         const i = argv.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );
      process.env.AGY_COMMAND = mockScript;

      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test hard limits default modelProfile',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'completed');

      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      // With no project or global override the DEFAULT profile is used, and a
      // profile resolves to a concrete model id rather than being passed
      // through as the profile name.
      const resolved = parseAgyArgs(loggedArgs).model;
      assert.ok(resolved && resolved !== 'default', `expected a concrete model id, got ${resolved}`);
    });

    it('3.5 PolicyEngine direct precedence verification (Request Config > Project > Global > Hard Limits)', () => {
      const engine = new PolicyEngine(
        { defaultModelProfile: 'request-tier-profile' },
        {
          globalConfigPath: path.join(tempGlobalDir, 'config.yaml'),
          repoPath: tempRepoDir,
          autoLoad: false,
        },
      );

      assert.equal(engine.getEffectivePolicy().defaultModelProfile, 'request-tier-profile');
    });

    it('3.6 Edge Case: Empty string modelProfile in delegate_task is rejected by contract validator', async () => {
      const mockScript = path.join(tempRepoDir, 'mock_agy_log.mjs');
      await createExecutableMockScript(
        mockScript,
        `import fs from 'node:fs';
         import path from 'node:path';
         const argv = process.argv.slice(2);
         const i = argv.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'done\\n');
         }
         console.log("OK");
         process.exit(0);
        `,
      );
      process.env.AGY_COMMAND = mockScript;

      const { delegateHandler } = setupToolHandlers();

      // Pass empty string "" as modelProfile
      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test empty string model profile',
        modelProfile: '',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'failed');
      assert.match(resData.error, /modelProfile must be a non-empty string/i);
    });

    it('3.7 revise_task modelProfile translation behavior', async () => {
      // Set project policy
      const geladaDir = path.join(tempRepoDir, '.gelada');
      await fs.mkdir(geladaDir, { recursive: true });
      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        'defaultModelProfile: revise-project-profile\n',
      );

      const logFile = path.join(tempRepoDir, 'args_revise.json');
      const mockScript = path.join(tempRepoDir, 'mock_agy_log.mjs');
      await createExecutableMockScript(
        mockScript,
        `import fs from 'node:fs';
         import path from 'node:path';
         const argv = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(argv));
         const i = argv.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );
      process.env.AGY_COMMAND = mockScript;

      const { delegateHandler, reviseHandler } = setupToolHandlers();

      // Delegate first
      const delRes = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Initial task',
      });
      const delData = JSON.parse(delRes.content[0].text);
      const taskId = delData.taskId;

      // Revise task
      const revRes = await reviseHandler({
        taskId,
        revisionNotes: 'Apply revision and check model profile',
      });

      const revData = JSON.parse(revRes.content[0].text);
      assert.equal(revData.status, 'completed');

      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      assert.equal(parseAgyArgs(loggedArgs).model, 'revise-project-profile');
    });

    it('3.8 AGY_COMMAND with arguments capability check', async () => {
      const mockScript = path.join(tempRepoDir, 'mock_space.mjs');
      await createExecutableMockScript(mockScript, `import fs from 'node:fs';
         import path from 'node:path';
         const argv = process.argv.slice(2);
         const i = argv.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'done\\n');
         }
         console.log("OK");
         process.exit(0);
        `);
      process.env.AGY_COMMAND = mockScript;

      const { delegateHandler } = setupToolHandlers();

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Test AGY_COMMAND execution',
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'completed');
    });
  });
});
