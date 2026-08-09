import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as syncFs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

import { createGeladaServer } from '../dist/server.js';
import { registerDelegateTaskTool } from '../dist/tools/delegate-task.js';
import { registerReviseTaskTool } from '../dist/tools/revise-task.js';
import { settleHandler, parseAgyArgs } from './helpers/agy-mock.js';

describe('Challenger 2 Empirical Edge Case Tests', () => {
  let tempRepoDir;
  let oldEnvAgy;

  beforeEach(async () => {
    oldEnvAgy = process.env.AGY_COMMAND;
    tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-challenger-test-repo-'));
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

  async function createExecutableMock(filename, code) {
    const scriptPath = path.join(tempRepoDir, filename);
    const scriptContent = `#!/usr/bin/env node\n${code}`;
    await fs.writeFile(scriptPath, scriptContent, { mode: 0o755 });
    return scriptPath;
  }

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

  describe('1. Prompt Payload Special Characters, Newlines, Unicode', () => {
    it('preserves complex special characters, quotes, shell metacharacters, and unicode without corruption', async () => {
      const logFile = path.join(tempRepoDir, 'agy_special_args.json');
      const mockExec = await createExecutableMock(
        'mock_agy_special',
        `import fs from 'node:fs';
         import nodePath from 'node:path';
         const args = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(args));
         const i = args.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(nodePath.join(args[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = mockExec;

      const { delegateHandler } = setupToolHandlers();

      const complexObjective = `Objective with "double quotes", 'single quotes', \\backslashes\\, $SHELL_VAR, \$(whoami), \`echo test\`, | pipe, > redirect, < input, & background`;
      const complexContext = `Context multiline:\nLine 1\r\nLine 2 with \t tab\nUnicode: 🚀🔥 Component UI 日本語 / 한국어\nANSI: \x1b[31mRed\x1b[0m`;
      const complexCriteria = [
        'Criteria 1: `code_block`',
        'Criteria 2: "quoted criteria" & <tag>',
      ];

      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: complexObjective,
        context: complexContext,
        acceptanceCriteria: complexCriteria,
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'completed');

      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      const passedPrompt = parseAgyArgs(loggedArgs).prompt;

      assert.ok(passedPrompt.includes(complexObjective));
      assert.ok(passedPrompt.includes('Line 1\r\nLine 2 with \t tab'));
      assert.ok(passedPrompt.includes('Unicode: 🚀🔥 Component UI 日本語 / 한국어'));
      assert.ok(passedPrompt.includes('ANSI: \x1b[31mRed\x1b[0m'));
      assert.ok(passedPrompt.includes('- Criteria 1: `code_block`'));
      assert.ok(passedPrompt.includes('- Criteria 2: "quoted criteria" & <tag>'));
    });

    it('handles null byte in prompt gracefully or reports failure without crashing server process', async () => {
      const logFile = path.join(tempRepoDir, 'agy_nullbyte_args.json');
      const mockExec = await createExecutableMock(
        'mock_agy_nullbyte',
        `import fs from 'node:fs';
         import nodePath from 'node:path';
         const args = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(args));
         const i = args.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(nodePath.join(args[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = mockExec;

      const { delegateHandler } = setupToolHandlers();

      let errorCaught = null;
      try {
        const res = await delegateHandler({
          repoPath: tempRepoDir,
          taskType: 'unit-test',
          objective: 'Objective with null byte \0 in text',
        });
        const resData = JSON.parse(res.content[0].text);
        errorCaught = resData;
      } catch (err) {
        errorCaught = err;
      }

      assert.ok(errorCaught !== null);
    });
  });

  describe('2. High Volume / Long Prompt Strings Payload Limits', () => {
    it('handles moderate size prompt (100KB) without issue', async () => {
      const logFile = path.join(tempRepoDir, 'agy_100k_args.json');
      const mockExec = await createExecutableMock(
        'mock_agy_100k',
        `import fs from 'node:fs';
         import nodePath from 'node:path';
         const args = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(args));
         const i = args.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(nodePath.join(args[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = mockExec;

      const { delegateHandler } = setupToolHandlers();

      const largeContext = 'A'.repeat(100 * 1024); // 100 KB string
      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: '100KB prompt test',
        context: largeContext,
      });

      const resData = JSON.parse(res.content[0].text);
      assert.equal(resData.status, 'completed');

      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      assert.ok(parseAgyArgs(loggedArgs).prompt.length >= 100 * 1024);
    });

    it('tests very large prompt (500KB) for OS command line length (ARG_MAX) limits', async () => {
      const logFile = path.join(tempRepoDir, 'agy_500k_args.json');
      const mockExec = await createExecutableMock(
        'mock_agy_500k',
        `import fs from 'node:fs';
         import nodePath from 'node:path';
         const args = process.argv.slice(2);
         fs.writeFileSync('${logFile}', JSON.stringify(args));
         const i = args.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(nodePath.join(args[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = mockExec;

      const { delegateHandler } = setupToolHandlers();

      const hugeContext = 'B'.repeat(500 * 1024); // 500 KB string
      const res = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: '500KB prompt test',
        context: hugeContext,
      });

      const resData = JSON.parse(res.content[0].text);
      // An oversized prompt is written to a file in the workspace and referenced
      // from the command line, so ARG_MAX is no longer reachable.
      assert.equal(resData.status, 'completed');

      const loggedArgs = JSON.parse(await fs.readFile(logFile, 'utf-8'));
      const prompt = parseAgyArgs(loggedArgs).prompt;
      assert.ok(prompt.length < 10 * 1024, 'the huge prompt must not be passed through argv');
      assert.match(prompt, /\.gelada-task\.md/);
    });
  });

  describe('3. revise_task PolicyEngine Model Profile Lookup & Dynamic Reload', () => {
    it('reloads project policy in revise_task when policy.yaml is created or updated after initial delegation', async () => {
      const logFileDel = path.join(tempRepoDir, 'del_args.json');
      const logFileRev = path.join(tempRepoDir, 'rev_args.json');
      const mockExec = await createExecutableMock(
        'mock_agy_policy',
        `import fs from 'node:fs';
         import nodePath from 'node:path';
         const args = process.argv.slice(2);
         if (args.some(a => a.includes('Revision requested'))) {
           fs.writeFileSync('${logFileRev}', JSON.stringify(args));
         } else if (args.some(a => a.includes('Initial task objective'))) {
           fs.writeFileSync('${logFileDel}', JSON.stringify(args));
         }
         const i = args.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(nodePath.join(args[i + 1], 'worker-output.txt'), String(Date.now()));
         }
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = mockExec;

      const { delegateHandler, reviseHandler } = setupToolHandlers();

      // Step 1: Delegate task without policy file -> should use default model profile 'default'
      const delRes = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Initial task objective',
      });
      const delData = JSON.parse(delRes.content[0].text);
      assert.equal(delData.status, 'completed');
      const taskId = delData.taskId;

      const delArgs = JSON.parse(await fs.readFile(logFileDel, 'utf-8'));
      const delModel = parseAgyArgs(delArgs).model;
      assert.ok(delModel && delModel.length > 0);

      // Step 2: Now create .gelada/policy.yaml in tempRepoDir specifying a new defaultModelProfile
      const geladaDir = path.join(tempRepoDir, '.gelada');
      await fs.mkdir(geladaDir, { recursive: true });
      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        'defaultModelProfile: revised-policy-model-v2\n',
      );

      // Step 3: Call revise_task for the existing task
      const revRes = await reviseHandler({
        taskId,
        revisionNotes: 'Apply revision with updated model profile',
      });
      const revData = JSON.parse(revRes.content[0].text);
      assert.equal(revData.status, 'completed');

      // Step 4: Verify that revise_task loaded the newly created policy.yaml and passed --model revised-policy-model-v2
      const revArgs = JSON.parse(await fs.readFile(logFileRev, 'utf-8'));
      assert.equal(parseAgyArgs(revArgs).model, 'revised-policy-model-v2');
    });

    it('falls back to default model profile when repo policy file has syntax errors or fails to parse', async () => {
      const geladaDir = path.join(tempRepoDir, '.gelada');
      await fs.mkdir(geladaDir, { recursive: true });
      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        'defaultModelProfile: [invalid yaml structure: {{{',
      );

      const logFileRev = path.join(tempRepoDir, 'rev_invalid_yaml.json');
      const mockExec = await createExecutableMock(
        'mock_agy_invalid_yaml',
        `import fs from 'node:fs';
         import nodePath from 'node:path';
         const args = process.argv.slice(2);
         fs.writeFileSync('${logFileRev}', JSON.stringify(args));
         const i = args.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(nodePath.join(args[i + 1], 'worker-output.txt'), 'done\\n');
         }
         process.exit(0);
        `,
      );

      process.env.AGY_COMMAND = mockExec;

      const { delegateHandler, reviseHandler } = setupToolHandlers();

      const delRes = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Task with broken yaml policy',
      });
      const delData = JSON.parse(delRes.content[0].text);
      const taskId = delData.taskId;

      const revRes = await reviseHandler({
        taskId,
        revisionNotes: 'Revise task with broken yaml',
      });
      const revData = JSON.parse(revRes.content[0].text);
      assert.equal(revData.status, 'completed');

      const revArgs = JSON.parse(await fs.readFile(logFileRev, 'utf-8'));
      const revModel = parseAgyArgs(revArgs).model;
      assert.ok(revModel && revModel.length > 0);
    });
  });

  describe('4. Real agy Executable Default & Space-Separated AGY_COMMAND Failure Mode', () => {
    it('defaults to agy command when process.env.AGY_COMMAND is unset and returns AGY_NOT_FOUND if agy is missing', async () => {
      delete process.env.AGY_COMMAND;

      // Narrow PATH to just the directory holding git, so the task can still
      // create its worktree while `agy` cannot resolve. Without this the test
      // either spawns a real model run or passes only by accident on a machine
      // that happens not to have the worker CLI installed.
      const realPath = process.env.PATH;
      const gitDir = path.dirname(
        execSync('command -v git', { shell: '/bin/sh', encoding: 'utf-8' }).trim(),
      );
      assert.ok(
        !syncFs.existsSync(path.join(gitDir, 'agy')),
        'this test needs a PATH entry that provides git but not agy',
      );
      process.env.PATH = gitDir;

      try {
        const { delegateHandler } = setupToolHandlers();

        const delRes = await delegateHandler({
          repoPath: tempRepoDir,
          taskType: 'unit-test',
          objective: 'Test real agy executable default',
        });

        const delData = JSON.parse(delRes.content[0].text);
        assert.equal(delData.status, 'failed');
        assert.equal(delData.code, 'AGY_NOT_FOUND');
        assert.match(delData.error, /Antigravity CLI executable 'agy' was not found/i);
      } finally {
        process.env.PATH = realPath;
      }
    });

    it('returns AGY_NOT_FOUND error in revise_task when process.env.AGY_COMMAND points to a non-existent executable', async () => {
      const mockExec = await createExecutableMock('mock_agy_ok', `import fs from 'node:fs';
         import nodePath from 'node:path';
         const args = process.argv.slice(2);
         const i = args.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(nodePath.join(args[i + 1], 'worker-output.txt'), String(Date.now()));
         }
         process.exit(0);
        `);
      process.env.AGY_COMMAND = mockExec;

      const { delegateHandler, reviseHandler } = setupToolHandlers();

      const delRes = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Task for missing binary revise test',
      });
      const delData = JSON.parse(delRes.content[0].text);
      assert.equal(delData.status, 'completed');
      const taskId = delData.taskId;

      process.env.AGY_COMMAND = '/nonexistent/bin/agy-missing-cmd';

      const revRes = await reviseHandler({
        taskId,
        revisionNotes: 'Revise with missing binary',
      });

      const revData = JSON.parse(revRes.content[0].text);
      assert.equal(revData.status, 'failed');
      assert.equal(revData.code, 'AGY_NOT_FOUND');
      assert.match(revData.error, /Antigravity CLI executable '\/nonexistent\/bin\/agy-missing-cmd' was not found/i);
    });

    it('runs a multi-word AGY_COMMAND (e.g. "node script.js") instead of reporting a missing binary', async () => {
      const mockScript = path.join(tempRepoDir, 'mock_agy_multi.mjs');
      await fs.writeFile(
        mockScript,
        `import fs from 'node:fs';
         import nodePath from 'node:path';
         const args = process.argv.slice(2);
         const i = args.indexOf('--add-dir');
         if (i >= 0) {
           fs.writeFileSync(nodePath.join(args[i + 1], 'worker-output.txt'), String(Date.now()));
         }
         process.exit(0);
        `,
      );

      // Passing multi-word command in process.env.AGY_COMMAND
      process.env.AGY_COMMAND = `${process.execPath} ${mockScript}`;

      const { delegateHandler } = setupToolHandlers();

      const delRes = await delegateHandler({
        repoPath: tempRepoDir,
        taskType: 'unit-test',
        objective: 'Task with multi-word AGY_COMMAND',
      });

      const delData = JSON.parse(delRes.content[0].text);
      assert.equal(delData.status, 'completed');
      assert.equal(delData.errorDetails, undefined);
    });
  });
});
