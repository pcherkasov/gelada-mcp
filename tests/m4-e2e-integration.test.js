import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTempRepo, createTempDataDir, createMockAgyScript, delegateAndPoll, pollTask } from './helpers/e2e-env.js';

describe('Milestone 4: E2E Integration & Verification over MCP Stdio Transport', () => {
  let transport;
  let client;
  let repoDir;
  let dataDir;

  before(async () => {
    // Drive a throwaway repository, never the checkout under test: the server
    // creates worktrees and artifacts in whatever repository it is pointed at.
    repoDir = await createTempRepo('gelada-m4-e2e-');
    dataDir = await createTempDataDir();
    const { command } = await createMockAgyScript(repoDir);

    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['./bin/gelada.js'],
      cwd: process.cwd(),
      env: { ...process.env, AGY_COMMAND: command, GELADA_DATA_DIR: dataDir },
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
    for (const dir of [repoDir, dataDir]) {
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
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
    // delegate_task hands back as soon as the worker is spawned, so a client
    // polls inspect_task for the outcome, exactly as a leader agent would.
    const { handoff, summary } = await delegateAndPoll(client, {
      repoPath: repoDir,
      taskType: 'unit-test',
      objective: 'Write unit test suite for auth module',
      verificationCommands: ['node -v'],
    });

    assert.ok(handoff.taskId && handoff.taskId.startsWith('task-'), 'taskId should start with task-');
    assert.equal(handoff.status, 'running');
    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.details.changedFiles, ['worker-output.txt']);
    assert.equal(summary.details.verificationPassed, true);

    global.e2eTaskId = handoff.taskId;
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
    assert.equal(data.verificationResults.at(-1).command, 'node -v');
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
