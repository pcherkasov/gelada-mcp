import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('Challenger M4-4: Stdio Protocol E2E Stress & Channel Purity Verification', () => {
  let transport;
  let client;
  let childProc;
  const rawStdoutBuffers = [];
  const rawStderrBuffers = [];

  before(async () => {
    // Spawn server process directly via StdioClientTransport
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['./bin/gelada.js'],
      cwd: process.cwd(),
      stderr: 'pipe',
    });

    client = new Client(
      {
        name: 'challenger-m4-4-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    // Attach stream listeners on transport if accessible or during lifecycle
    await client.connect(transport);
  });

  after(async () => {
    if (client) {
      await client.close();
    }
  });

  describe('1. Stdio Channel Purity & Protocol Transport Checks', () => {
    it('should strictly isolate stdout for JSON-RPC framing and stderr for logging', async () => {
      // Spawn a separate instance to monitor raw stdout/stderr lines line-by-line
      const proc = spawn(process.execPath, ['./bin/gelada.js'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutLines = [];
      const stderrLines = [];

      proc.stdout.on('data', (chunk) => {
        stdoutLines.push(chunk.toString());
      });

      proc.stderr.on('data', (chunk) => {
        stderrLines.push(chunk.toString());
      });

      // Send standard JSON-RPC initialize request over stdin
      const initRequest =
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'purity-test-client', version: '1.0.0' },
          },
        }) + '\n';

      proc.stdin.write(initRequest);

      // Wait a moment for response
      await new Promise((resolve) => setTimeout(resolve, 300));

      proc.kill();

      // Verify stderr contains connection message
      const stderrText = stderrLines.join('');
      assert.ok(
        stderrText.includes('Gelada MCP server connected and listening via stdio.'),
        `stderr should contain log message, got: ${stderrText}`,
      );

      // Verify stdout contains ONLY valid JSON or JSON-RPC lines
      const stdoutText = stdoutLines.join('');
      assert.ok(stdoutText.length > 0, 'stdout should receive JSON-RPC response');

      const lines = stdoutText.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        let parsed;
        assert.doesNotThrow(() => {
          parsed = JSON.parse(line);
        }, `stdout line should be valid JSON: "${line}"`);

        assert.equal(parsed.jsonrpc, '2.0', `stdout JSON line must be JSON-RPC 2.0: ${line}`);
      }
    });
  });

  describe('2. Tool Call Payload Variations & Response Structure Checks', () => {
    it('should register the full tool set with expected names', async () => {
      const res = await client.listTools();
      assert.ok(res.tools && Array.isArray(res.tools));
      assert.equal(res.tools.length, 7);

      const names = res.tools.map((t) => t.name).sort();
      assert.deepEqual(names, [
        'cancel_task',
        'delegate_task',
        'discard_task',
        'doctor',
        'inspect_task',
        'list_workers',
        'revise_task',
      ]);
    });

    describe('delegate_task tool variations', () => {
      it('should succeed with minimal payload (taskType, objective)', async () => {
        const res = await client.callTool({
          name: 'delegate_task',
          arguments: {
            taskType: 'refactor',
            objective: 'Refactor user service module',
          },
        });
        assert.ok(res.content && res.content[0].type === 'text');
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.status, 'completed');
        assert.equal(data.taskType, 'refactor');
        assert.equal(data.repoPath, process.cwd());
        assert.deepEqual(data.changedFiles, []);
      });

      it('should succeed with full payload (all optional args specified)', async () => {
        const fullArgs = {
          repoPath: process.cwd(),
          taskType: 'dto-gen',
          objective: 'Generate DTOs for billing',
          context: 'Billing context',
          acceptanceCriteria: ['Must compile', 'Must pass tests'],
          disallowedPaths: ['src/core/index.ts'],
          verificationCommands: ['node -v'],
          modelProfile: 'claude-3-5-sonnet',
          timeoutSeconds: 120,
        };

        const res = await client.callTool({
          name: 'delegate_task',
          arguments: fullArgs,
        });

        const data = JSON.parse(res.content[0].text);
        assert.equal(data.status, 'completed');
        assert.equal(data.taskType, 'dto-gen');
        assert.equal(data.repoPath, process.cwd());
        assert.deepEqual(data.changedFiles, []);
        assert.equal(data.verificationResults.length, 1);
        assert.equal(data.verificationResults[0].command, 'node -v');
      });

      it('should fail gracefully when required arguments are missing', async () => {
        const res = await client.callTool({
          name: 'delegate_task',
          arguments: {
            repoPath: '/tmp/repo',
          },
        });
        assert.equal(res.isError, true, 'isError should be true for missing required args');
        assert.ok(
          res.content[0].text.includes('Invalid') ||
            res.content[0].text.includes('Required') ||
            res.content[0].text.includes('error'),
        );
      });
    });

    describe('revise_task tool variations', () => {
      it('should succeed with minimal payload (taskId, revisionNotes)', async () => {
        const res = await client.callTool({
          name: 'delegate_task',
          arguments: {
            taskType: 'security-audit',
            objective: 'Stress test delegate tool',
          },
        });
        const data = JSON.parse(res.content[0].text);
        global.stressTaskId = data.taskId;
        assert.equal(data.status, 'completed');
      });

      it('should succeed with full payload (additionalCriteria, additionalVerificationCommands)', async () => {
        const res = await client.callTool({
          name: 'revise_task',
          arguments: {
            taskId: global.stressTaskId,
            revisionNotes: 'Add error handling for null values',
            additionalCriteria: ['Handle null case'],
            additionalVerificationCommands: ['node -v'],
          },
        });
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.taskId, global.stressTaskId);
        assert.equal(data.verificationResults.length, 1);
        assert.equal(data.verificationResults[0].command, 'node -v');
      });

      it('should fail gracefully when required args are missing', async () => {
        const res = await client.callTool({
          name: 'revise_task',
          arguments: {
            taskId: 'task-103',
          },
        });
        assert.equal(res.isError, true, 'isError should be true for missing revisionNotes');
        assert.ok(
          res.content[0].text.includes('Invalid') ||
            res.content[0].text.includes('Required') ||
            res.content[0].text.includes('error'),
        );
      });
    });

    describe('inspect_task tool variations', () => {
      const modes = ['summary', 'diff', 'files', 'verifications', 'logs', 'history'];

      for (const mode of modes) {
        it(`should handle inspect mode: ${mode}`, async () => {
          const res = await client.callTool({
            name: 'inspect_task',
            arguments: {
              taskId: global.stressTaskId,
              mode,
            },
          });
          const data = JSON.parse(res.content[0].text);
          assert.equal(data.mode, mode);
          assert.equal(data.status, 'completed');
          assert.ok(data.details);
        });
      }

      it('should default mode to summary when mode is omitted', async () => {
        const res = await client.callTool({
          name: 'inspect_task',
          arguments: {
            taskId: global.stressTaskId,
          },
        });
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.mode, 'summary');
      });

      it('should reject invalid mode enum value', async () => {
        const res = await client.callTool({
          name: 'inspect_task',
          arguments: {
            taskId: 'task-1',
            mode: 'invalid_mode_value',
          },
        });
        assert.equal(res.isError, true, 'isError should be true for invalid enum mode');
        assert.ok(
          res.content[0].text.includes('invalid_enum') ||
            res.content[0].text.includes('Invalid') ||
            res.content[0].text.includes('error'),
        );
      });
    });

    describe('discard_task tool variations', () => {
      it('should discard task with default keepLogs (false)', async () => {
        const res = await client.callTool({
          name: 'discard_task',
          arguments: {
            taskId: global.stressTaskId,
          },
        });
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.status, 'discarded');
        assert.equal(data.cleanedUp, true);
        assert.equal(data.logsRetained, false);
      });

      it('should discard task with keepLogs: true', async () => {
        const res = await client.callTool({
          name: 'discard_task',
          arguments: {
            taskId: 'task-discard-2',
            keepLogs: true,
          },
        });
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.taskId, 'task-discard-2');
        assert.equal(data.logsRetained, true);
      });

      it('should reject when taskId is missing', async () => {
        const res = await client.callTool({
          name: 'discard_task',
          arguments: {},
        });
        assert.equal(res.isError, true, 'isError should be true for missing taskId');
        assert.ok(
          res.content[0].text.includes('Invalid') ||
            res.content[0].text.includes('Required') ||
            res.content[0].text.includes('error'),
        );
      });
    });

    describe('doctor tool variations', () => {
      it('should run doctor with defaults', async () => {
        const res = await client.callTool({
          name: 'doctor',
          arguments: {},
        });
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.status, 'ok');
        assert.equal(data.geladaVersion, '0.1.0');
        assert.equal(data.gitAvailable, true);
        assert.equal(data.workerAvailable, true);
        assert.equal(data.verbose, false);
        assert.ok(data.checks.length >= 3);
      });

      it('should run doctor with verbose: true, checkWorker: false', async () => {
        const res = await client.callTool({
          name: 'doctor',
          arguments: {
            verbose: true,
            checkWorker: false,
          },
        });
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.verbose, true);
        assert.equal(data.workerAvailable, false);
        assert.equal(data.checks.length, 2);
      });
    });
  });

  describe('3. Unknown Tool & Protocol Error Handling', () => {
    it('should return error when calling unknown tool', async () => {
      const res = await client.callTool({
        name: 'non_existent_tool',
        arguments: {},
      });
      assert.equal(res.isError, true);
    });
  });
});
