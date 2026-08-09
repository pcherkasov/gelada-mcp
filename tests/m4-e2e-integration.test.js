import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('Milestone 4: E2E Integration & Verification over MCP Stdio Transport', () => {
  let transport;
  let client;

  before(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['./bin/gelada.js'],
      cwd: process.cwd(),
      env: { ...process.env, AGY_COMMAND: 'echo' },
      stderr: 'pipe',
    });

    client = new Client(
      {
        name: 'm4-e2e-integration-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    await client.connect(transport);
  });

  after(async () => {
    if (client) {
      await client.close();
    }
  });

  it('should list every registered MCP tool', async () => {
    const response = await client.listTools();
    assert.ok(response.tools, 'Response should contain tools array');
    assert.equal(response.tools.length, 7, `Expected 7 tools, got ${response.tools.length}`);

    const toolNames = response.tools.map((t) => t.name).sort();
    assert.deepEqual(
      toolNames,
      [
        'cancel_task',
        'delegate_task',
        'discard_task',
        'doctor',
        'inspect_task',
        'list_workers',
        'revise_task',
      ],
      'All expected tools must be registered',
    );
  });

  it('should execute delegate_task tool end-to-end', async () => {
    const res = await client.callTool({
      name: 'delegate_task',
      arguments: {
        taskType: 'unit-test',
        objective: 'Write unit test suite for auth module',
        verificationCommands: ['node -v'],
      },
    });

    assert.ok(res.content && res.content.length > 0, 'Should return text content');
    const data = JSON.parse(res.content[0].text);
    assert.ok(data.taskId && data.taskId.startsWith('task-'), 'taskId should start with task-');
    assert.equal(data.status, 'completed');
    assert.equal(data.taskType, 'unit-test');
    assert.deepEqual(data.changedFiles, []);
    assert.equal(data.verificationResults.length, 1);
    assert.equal(data.verificationResults[0].passed, true);
    
    // Save taskId for next tests
    global.e2eTaskId = data.taskId;
  });

  it('should execute revise_task tool end-to-end', async () => {
    const res = await client.callTool({
      name: 'revise_task',
      arguments: {
        taskId: global.e2eTaskId,
        revisionNotes: 'Add boundary edge cases to auth tests',
        additionalVerificationCommands: ['node -v'],
      },
    });

    assert.ok(res.content && res.content.length > 0, 'Should return text content');
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.taskId, global.e2eTaskId);
    assert.equal(data.status, 'completed');
    assert.equal(data.revisionCount, 1);
    assert.ok(data.notes.includes('Add boundary edge cases'));
    assert.equal(data.verificationResults.length, 2);
    assert.equal(data.verificationResults[1].command, 'node -v');
  });

  it('should execute inspect_task tool end-to-end', async () => {
    const res = await client.callTool({
      name: 'inspect_task',
      arguments: {
        taskId: global.e2eTaskId,
        mode: 'summary',
      },
    });

    assert.ok(res.content && res.content.length > 0, 'Should return text content');
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.taskId, global.e2eTaskId);
    assert.equal(data.mode, 'summary');
    assert.equal(data.status, 'completed');
    assert.ok(data.details, 'details object should exist');
  });

  it('should execute discard_task tool end-to-end', async () => {
    const res = await client.callTool({
      name: 'discard_task',
      arguments: {
        taskId: global.e2eTaskId,
        keepLogs: true,
      },
    });

    assert.ok(res.content && res.content.length > 0, 'Should return text content');
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.taskId, global.e2eTaskId);
    assert.equal(data.status, 'discarded');
    assert.equal(data.cleanedUp, true);
    assert.equal(data.logsRetained, true);
  });

  it('should execute doctor tool end-to-end', async () => {
    const res = await client.callTool({
      name: 'doctor',
      arguments: {
        verbose: true,
        checkWorker: true,
      },
    });

    assert.ok(res.content && res.content.length > 0, 'Should return text content');
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.status, 'ok');
    assert.ok(data.geladaVersion);
    assert.equal(data.gitAvailable, true);
    assert.equal(data.workerAvailable, true);
    assert.equal(data.verbose, true);
    assert.ok(Array.isArray(data.checks), 'checks should be an array');
    assert.ok(data.checks.length >= 3, 'should include at least 3 checks');
  });
});
