import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  TaskRegistry,
  mapGranularToLegacyStatus,
  mapLegacyToGranularStatus,
} from '../dist/components/task-registry.js';
import { ArtifactManager } from '../dist/components/artifact-manager.js';
import { ContractValidator } from '../dist/components/contract-validator.js';
import { PolicyEngine } from '../dist/components/policy-engine.js';
import { RepositoryInspector } from '../dist/components/repository-inspector.js';
import { WorktreeManager } from '../dist/components/worktree-manager.js';
import { AntigravityDriver } from '../dist/components/worker-driver.js';
import { ProcessSupervisor } from '../dist/components/process-supervisor.js';
import { VerificationEngine } from '../dist/components/verification-engine.js';
import { ModelRouter } from '../dist/components/model-router.js';
import { registerDelegateTaskTool } from '../dist/tools/delegate-task.js';
import { registerInspectTaskTool } from '../dist/tools/inspect-task.js';
import { registerReviseTaskTool } from '../dist/tools/revise-task.js';
import { registerDiscardTaskTool } from '../dist/tools/discard-task.js';

describe('Requirement R3 Granular Task Lifecycle States Unit Tests', () => {
  let tempRepoRoot;
  let taskRegistry;
  let artifactManager;
  let contractValidator;
  let policyEngine;
  let repositoryInspector;
  let worktreeManager;
  let workerDriver;
  let processSupervisor;
  let verificationEngine;
  let components;
  let mockMcpServer;
  let registeredTools;

  beforeEach(async () => {
    tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-r3-test-repo-'));
    const artifactsDir = path.join(tempRepoRoot, '.gelada/artifacts');

    taskRegistry = new TaskRegistry();
    artifactManager = new ArtifactManager({
      repoRoot: tempRepoRoot,
      artifactsDir,
    });
    contractValidator = new ContractValidator();
    policyEngine = new PolicyEngine();
    repositoryInspector = new RepositoryInspector();
    worktreeManager = new WorktreeManager({ repoRoot: tempRepoRoot });
    processSupervisor = new ProcessSupervisor();
    workerDriver = new AntigravityDriver({ supervisor: processSupervisor });
    verificationEngine = new VerificationEngine();

    components = {
      taskRegistry,
      artifactManager,
      contractValidator,
      policyEngine,
      repositoryInspector,
      worktreeManager,
      workerDriver,
      processSupervisor,
      verificationEngine,
      modelRouter: new ModelRouter(),
    };

    registeredTools = new Map();
    mockMcpServer = {
      tool: (name, description, schema, handler) => {
        registeredTools.set(name, { name, description, schema, handler });
      },
      registerTool: (name, config, handler) => {
        registeredTools.set(name, {
          name,
          description: config?.description,
          schema: config?.inputSchema,
          handler,
        });
      },
    };

    registerDelegateTaskTool(mockMcpServer, components);
    registerInspectTaskTool(mockMcpServer, components);
    registerReviseTaskTool(mockMcpServer, components);
    registerDiscardTaskTool(mockMcpServer, components);
  });

  afterEach(async () => {
    if (tempRepoRoot) {
      await fs.rm(tempRepoRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. 17 Granular Task States & Backward Compatibility Mapping', () => {
    const all17States = [
      'CREATED',
      'VALIDATING',
      'PREPARING',
      'READY',
      'RUNNING',
      'COLLECTING',
      'VERIFYING',
      'COMPLETED',
      'COMPLETED_WITH_WARNINGS',
      'REVISION_REQUIRED',
      'FAILED_CONTRACT',
      'FAILED_WORKER',
      'FAILED_POLICY',
      'FAILED_VERIFICATION',
      'AUTH_REQUIRED',
      'CANCELLED',
      'DISCARDED',
    ];

    it('supports all 17 granular states and maps each to legacy status strings', () => {
      assert.equal(all17States.length, 17);

      for (const state of all17States) {
        const legacyStatus = mapGranularToLegacyStatus(state);
        assert.ok(
          ['running', 'completed', 'failed', 'discarded', 'revised'].includes(legacyStatus),
          `State ${state} should map to a valid legacy status string, got '${legacyStatus}'`,
        );

        const inferredGranular = mapLegacyToGranularStatus(legacyStatus);
        assert.ok(
          all17States.includes(inferredGranular),
          `Legacy status '${legacyStatus}' should map to a valid granular state`,
        );
      }
    });

    it('correctly records initial state and transitions in TaskRegistry for all states', () => {
      for (const state of all17States) {
        const taskId = `test-${state.toLowerCase()}-${Date.now()}`;
        const record = taskRegistry.registerTask({
          taskId,
          objective: `Test state ${state}`,
          granularStatus: state,
        });

        assert.equal(record.granularStatus, state);
        assert.equal(record.status, mapGranularToLegacyStatus(state));
        assert.equal(record.stateHistory.length, 1);
        assert.equal(record.stateHistory[0].state, state);
        assert.equal(record.stateHistory[0].toState, state);
        assert.ok(record.stateHistory[0].timestamp);
      }
    });
  });

  describe('2. State Transition History Logging & Timestamp Updates', () => {
    it('appends state transitions chronologically and records phase timestamps', () => {
      const taskId = 'task-history-test';
      taskRegistry.registerTask({
        taskId,
        objective: 'State history tracking test',
        granularStatus: 'CREATED',
      });

      taskRegistry.transitionTask(taskId, 'VALIDATING', 'Validating payload');
      taskRegistry.transitionTask(taskId, 'PREPARING', 'Setting up worktree');
      taskRegistry.transitionTask(taskId, 'READY', 'Ready for worker spawn');
      taskRegistry.transitionTask(taskId, 'RUNNING', 'Worker process started');
      taskRegistry.transitionTask(taskId, 'COLLECTING', 'Collecting diff');
      taskRegistry.transitionTask(taskId, 'VERIFYING', 'Running tests');
      const finalRecord = taskRegistry.transitionTask(taskId, 'COMPLETED', 'All verifications passed');

      assert.ok(finalRecord);
      assert.equal(finalRecord.granularStatus, 'COMPLETED');
      assert.equal(finalRecord.status, 'completed');
      assert.equal(finalRecord.stateHistory.length, 8);

      const statesInHistory = finalRecord.stateHistory.map((h) => h.state);
      assert.deepEqual(statesInHistory, [
        'CREATED',
        'VALIDATING',
        'PREPARING',
        'READY',
        'RUNNING',
        'COLLECTING',
        'VERIFYING',
        'COMPLETED',
      ]);

      assert.ok(finalRecord.timestamps.validatedAt);
      assert.ok(finalRecord.timestamps.preparedAt);
      assert.ok(finalRecord.timestamps.startedAt);
      assert.ok(finalRecord.timestamps.collectedAt);
      assert.ok(finalRecord.timestamps.verifiedAt);
      assert.ok(finalRecord.timestamps.completedAt);
    });
  });

  describe('3. Pre-registration Validation Failure Tracking', () => {
    it('tracks FAILED_CONTRACT pre-registration error and persists in TaskRegistry and artifacts', async () => {
      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        taskType: 'test',
        // missing required objective parameter to trigger contract failure
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_CONTRACT');
      assert.ok(parsed.taskId);
      assert.equal(parsed.errorDetails.code, 'FAILED_CONTRACT');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_CONTRACT');
      assert.equal(task.status, 'failed');
      assert.equal(task.stateHistory[task.stateHistory.length - 1].state, 'FAILED_CONTRACT');

      const metaStr = await artifactManager.getArtifact('metadata', parsed.taskId);
      assert.ok(metaStr);
      const meta = JSON.parse(metaStr);
      assert.equal(meta.granularStatus, 'FAILED_CONTRACT');
      assert.equal(meta.status, 'failed');
      assert.equal(meta.errorDetails.code, 'FAILED_CONTRACT');
    });

    it('tracks FAILED_POLICY for disallowed paths policy violation', async () => {
      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'test',
        objective: 'Test policy disallowed path',
        disallowedPaths: ['.git/**'],
        allowedPaths: ['.git/config'], // path traversal / disallowed path conflict
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_POLICY');
      assert.ok(parsed.taskId);
      assert.equal(parsed.errorDetails.stage, 'FAILED_POLICY');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_POLICY');
      assert.equal(task.status, 'failed');
    });
  });

  describe('4. inspect_task Granular State Output Modes', () => {
    it('returns granularStatus, stateHistory, and errorDetails in summary mode', async () => {
      const taskId = 'inspect-summary-task';
      taskRegistry.registerTask({
        taskId,
        objective: 'Inspect task test',
        granularStatus: 'CREATED',
      });
      taskRegistry.transitionTask(taskId, 'VALIDATING', 'Validation in progress');
      const errorDetails = {
        code: 'FAILED_POLICY',
        message: 'Disallowed path error',
        category: 'policy',
        stage: 'FAILED_POLICY',
      };
      taskRegistry.transitionTask(taskId, 'FAILED_POLICY', errorDetails.message, errorDetails);

      const inspectTool = registeredTools.get('inspect_task');
      const res = await inspectTool.handler({
        taskId,
        mode: 'summary',
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.taskId, taskId);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_POLICY');
      assert.ok(Array.isArray(parsed.stateHistory));
      assert.equal(parsed.stateHistory.length, 3);
      assert.equal(parsed.errorDetails.code, 'FAILED_POLICY');
    });

    it('returns stateHistory timeline and phase timestamps in history mode', async () => {
      const taskId = 'inspect-history-task';
      taskRegistry.registerTask({
        taskId,
        objective: 'Inspect history mode test',
        granularStatus: 'CREATED',
      });
      taskRegistry.transitionTask(taskId, 'VALIDATING');
      taskRegistry.transitionTask(taskId, 'PREPARING');
      taskRegistry.transitionTask(taskId, 'READY');
      taskRegistry.transitionTask(taskId, 'RUNNING');
      taskRegistry.transitionTask(taskId, 'COLLECTING');
      taskRegistry.transitionTask(taskId, 'COMPLETED');

      const inspectTool = registeredTools.get('inspect_task');
      const res = await inspectTool.handler({
        taskId,
        mode: 'history',
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.granularStatus, 'COMPLETED');
      assert.equal(parsed.details.stateHistory.length, 7);
      assert.ok(parsed.details.timestamps.completedAt);
    });

    it('returns errorDetails in logs mode when task failed', async () => {
      const taskId = 'inspect-logs-task';
      taskRegistry.registerTask({
        taskId,
        objective: 'Inspect logs mode test',
        granularStatus: 'CREATED',
      });
      const errorDetails = {
        code: 'FAILED_WORKER',
        message: 'Worker CLI crashed',
        category: 'execution',
        stage: 'FAILED_WORKER',
      };
      taskRegistry.transitionTask(taskId, 'FAILED_WORKER', errorDetails.message, errorDetails);

      const inspectTool = registeredTools.get('inspect_task');
      const res = await inspectTool.handler({
        taskId,
        mode: 'logs',
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.granularStatus, 'FAILED_WORKER');
      assert.equal(parsed.details.errorDetails.code, 'FAILED_WORKER');
    });
  });

  describe('5. Lifecycle Flow in Discard Task', () => {
    it('transitions task state to CANCELLED and DISCARDED on discard_task', async () => {
      const taskId = 'discard-flow-task';
      taskRegistry.registerTask({
        taskId,
        objective: 'Discard test task',
        granularStatus: 'CREATED',
      });
      taskRegistry.transitionTask(taskId, 'RUNNING', 'Task running');

      const discardTool = registeredTools.get('discard_task');
      const res = await discardTool.handler({
        taskId,
        keepLogs: true,
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'discarded');
      assert.equal(parsed.granularStatus, 'DISCARDED');
      assert.ok(parsed.stateHistory.some((h) => h.state === 'DISCARDED'));

      const task = taskRegistry.getTask(taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'DISCARDED');
      assert.equal(task.status, 'discarded');
    });
  });
});
