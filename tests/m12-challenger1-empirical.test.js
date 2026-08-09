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

describe('Milestone 12 - Challenger 1 Empirical Stress Test Suite (R3 Granular Task Lifecycle States)', () => {
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

  const ALL_17_STATES = [
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

  beforeEach(async () => {
    tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-m12-challenger-repo-'));
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

  describe('1. Empirical Verification of all 17 Granular Task States', () => {
    it('verifies exact count of 17 distinct granular states and valid legacy status mappings', () => {
      assert.equal(ALL_17_STATES.length, 17, 'Must have exactly 17 granular task states');

      const expectedLegacyMappings = {
        CREATED: 'running',
        VALIDATING: 'running',
        PREPARING: 'running',
        READY: 'running',
        RUNNING: 'running',
        COLLECTING: 'running',
        VERIFYING: 'running',
        COMPLETED: 'completed',
        COMPLETED_WITH_WARNINGS: 'completed',
        REVISION_REQUIRED: 'revised',
        FAILED_CONTRACT: 'failed',
        FAILED_WORKER: 'failed',
        FAILED_POLICY: 'failed',
        FAILED_VERIFICATION: 'failed',
        AUTH_REQUIRED: 'failed',
        CANCELLED: 'failed',
        DISCARDED: 'discarded',
      };

      for (const state of ALL_17_STATES) {
        const legacy = mapGranularToLegacyStatus(state);
        assert.equal(
          legacy,
          expectedLegacyMappings[state],
          `Granular state ${state} mapped to legacy status ${legacy}, expected ${expectedLegacyMappings[state]}`,
        );
      }
    });

    it('verifies legacy-to-granular fallback mapping', () => {
      assert.equal(mapLegacyToGranularStatus('running'), 'RUNNING');
      assert.equal(mapLegacyToGranularStatus('completed'), 'COMPLETED');
      assert.equal(mapLegacyToGranularStatus('revised'), 'REVISION_REQUIRED');
      assert.equal(mapLegacyToGranularStatus('failed'), 'FAILED_WORKER');
      assert.equal(mapLegacyToGranularStatus('discarded'), 'DISCARDED');
      assert.equal(mapLegacyToGranularStatus('unknown'), 'RUNNING');
    });

    it('empirically tests registration and state history initialization for all 17 states', () => {
      for (const state of ALL_17_STATES) {
        const taskId = `task-state-${state.toLowerCase()}`;
        const record = taskRegistry.registerTask({
          taskId,
          objective: `Testing ${state}`,
          granularStatus: state,
        });

        assert.equal(record.taskId, taskId);
        assert.equal(record.granularStatus, state);
        assert.equal(record.status, mapGranularToLegacyStatus(state));
        assert.equal(record.stateHistory.length, 1);
        assert.equal(record.stateHistory[0].state, state);
        assert.equal(record.stateHistory[0].fromState, null);
        assert.equal(record.stateHistory[0].toState, state);
        assert.ok(record.stateHistory[0].timestamp);
      }
    });
  });

  describe('2. Empirical Verification of Lifecycle Transition History Order', () => {
    it('verifies strict chronological order: CREATED -> VALIDATING -> PREPARING -> READY -> RUNNING -> COLLECTING -> VERIFYING -> COMPLETED', () => {
      const taskId = 'task-happy-path-order';
      taskRegistry.registerTask({
        taskId,
        objective: 'Happy path order test',
        granularStatus: 'CREATED',
      });

      const happyPathSequence = [
        'VALIDATING',
        'PREPARING',
        'READY',
        'RUNNING',
        'COLLECTING',
        'VERIFYING',
        'COMPLETED',
      ];

      let lastState = 'CREATED';
      for (const nextState of happyPathSequence) {
        const updated = taskRegistry.transitionTask(taskId, nextState, `Transition to ${nextState}`);
        assert.ok(updated);
        assert.equal(updated.granularStatus, nextState);
        const lastTransition = updated.stateHistory[updated.stateHistory.length - 1];
        assert.equal(lastTransition.fromState, lastState);
        assert.equal(lastTransition.toState, nextState);
        assert.equal(lastTransition.state, nextState);
        lastState = nextState;
      }

      const finalRecord = taskRegistry.getTask(taskId);
      assert.ok(finalRecord);
      assert.equal(finalRecord.stateHistory.length, 8);

      const historyStates = finalRecord.stateHistory.map((h) => h.state);
      assert.deepEqual(historyStates, [
        'CREATED',
        'VALIDATING',
        'PREPARING',
        'READY',
        'RUNNING',
        'COLLECTING',
        'VERIFYING',
        'COMPLETED',
      ]);

      // Verify phase timestamps
      assert.ok(finalRecord.timestamps.createdAt, 'createdAt must be set');
      assert.ok(finalRecord.timestamps.validatedAt, 'validatedAt must be set');
      assert.ok(finalRecord.timestamps.preparedAt, 'preparedAt must be set');
      assert.ok(finalRecord.timestamps.startedAt, 'startedAt must be set');
      assert.ok(finalRecord.timestamps.collectedAt, 'collectedAt must be set');
      assert.ok(finalRecord.timestamps.verifiedAt, 'verifiedAt must be set');
      assert.ok(finalRecord.timestamps.completedAt, 'completedAt must be set');

      // Verify timestamps order (monotonically non-decreasing)
      const ts = finalRecord.timestamps;
      assert.ok(ts.validatedAt >= ts.createdAt);
      assert.ok(ts.preparedAt >= ts.validatedAt);
      assert.ok(ts.startedAt >= ts.preparedAt);
      assert.ok(ts.collectedAt >= ts.startedAt);
      assert.ok(ts.verifiedAt >= ts.collectedAt);
      assert.ok(ts.completedAt >= ts.verifiedAt);
    });

    it('verifies COMPLETED_WITH_WARNINGS transition path and timestamp recording', () => {
      const taskId = 'task-warnings-order';
      taskRegistry.registerTask({ taskId, objective: 'Warnings test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId, 'VALIDATING');
      taskRegistry.transitionTask(taskId, 'PREPARING');
      taskRegistry.transitionTask(taskId, 'READY');
      taskRegistry.transitionTask(taskId, 'RUNNING');
      taskRegistry.transitionTask(taskId, 'COLLECTING');
      taskRegistry.transitionTask(taskId, 'VERIFYING');
      const final = taskRegistry.transitionTask(taskId, 'COMPLETED_WITH_WARNINGS', 'Completed with warnings');

      assert.ok(final);
      assert.equal(final.granularStatus, 'COMPLETED_WITH_WARNINGS');
      assert.equal(final.status, 'completed');
      assert.ok(final.timestamps.completedAt);
    });

    it('verifies revision loop lifecycle transition order: COMPLETED -> PREPARING -> READY -> RUNNING -> COLLECTING -> VERIFYING -> REVISION_REQUIRED', () => {
      const taskId = 'task-revision-order';
      taskRegistry.registerTask({ taskId, objective: 'Revision test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId, 'VALIDATING');
      taskRegistry.transitionTask(taskId, 'PREPARING');
      taskRegistry.transitionTask(taskId, 'READY');
      taskRegistry.transitionTask(taskId, 'RUNNING');
      taskRegistry.transitionTask(taskId, 'COLLECTING');
      taskRegistry.transitionTask(taskId, 'VERIFYING');
      taskRegistry.transitionTask(taskId, 'COMPLETED');

      // Revision cycle 1
      taskRegistry.transitionTask(taskId, 'PREPARING', 'Preparing revision 1');
      taskRegistry.transitionTask(taskId, 'READY', 'Ready for revision 1');
      taskRegistry.transitionTask(taskId, 'RUNNING', 'Running revision 1');
      taskRegistry.transitionTask(taskId, 'COLLECTING', 'Collecting revision 1');
      taskRegistry.transitionTask(taskId, 'VERIFYING', 'Verifying revision 1');
      const revRecord = taskRegistry.transitionTask(taskId, 'REVISION_REQUIRED', 'Revision required');

      assert.ok(revRecord);
      assert.equal(revRecord.granularStatus, 'REVISION_REQUIRED');
      assert.equal(revRecord.status, 'revised');
      assert.equal(revRecord.stateHistory.length, 14);

      const historyStates = revRecord.stateHistory.map((h) => h.state);
      assert.deepEqual(historyStates, [
        'CREATED',
        'VALIDATING',
        'PREPARING',
        'READY',
        'RUNNING',
        'COLLECTING',
        'VERIFYING',
        'COMPLETED',
        'PREPARING',
        'READY',
        'RUNNING',
        'COLLECTING',
        'VERIFYING',
        'REVISION_REQUIRED',
      ]);
    });

    it('verifies early failure transition orders and failedAt timestamp: CREATED -> VALIDATING -> FAILED_CONTRACT / FAILED_POLICY', () => {
      const taskId1 = 'task-failed-contract';
      taskRegistry.registerTask({ taskId: taskId1, objective: 'Contract failure test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId1, 'VALIDATING');
      const failed1 = taskRegistry.transitionTask(
        taskId1,
        'FAILED_CONTRACT',
        'Invalid payload',
        { code: 'FAILED_CONTRACT', message: 'Payload missing required field', stage: 'FAILED_CONTRACT' },
      );

      assert.equal(failed1?.granularStatus, 'FAILED_CONTRACT');
      assert.equal(failed1?.status, 'failed');
      assert.ok(failed1?.timestamps.failedAt);
      assert.equal(failed1?.errorDetails?.code, 'FAILED_CONTRACT');

      const taskId2 = 'task-failed-policy';
      taskRegistry.registerTask({ taskId: taskId2, objective: 'Policy failure test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId2, 'VALIDATING');
      const failed2 = taskRegistry.transitionTask(
        taskId2,
        'FAILED_POLICY',
        'Disallowed path',
        { code: 'FAILED_POLICY', message: 'Disallowed path accessed', stage: 'FAILED_POLICY' },
      );

      assert.equal(failed2?.granularStatus, 'FAILED_POLICY');
      assert.equal(failed2?.status, 'failed');
      assert.ok(failed2?.timestamps.failedAt);
      assert.equal(failed2?.errorDetails?.code, 'FAILED_POLICY');
    });

    it('verifies worker execution and auth failure transition orders: RUNNING -> FAILED_WORKER / AUTH_REQUIRED', () => {
      const taskId1 = 'task-failed-worker';
      taskRegistry.registerTask({ taskId: taskId1, objective: 'Worker failure test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId1, 'VALIDATING');
      taskRegistry.transitionTask(taskId1, 'PREPARING');
      taskRegistry.transitionTask(taskId1, 'READY');
      taskRegistry.transitionTask(taskId1, 'RUNNING');
      const failedWorker = taskRegistry.transitionTask(
        taskId1,
        'FAILED_WORKER',
        'Worker process exited with non-zero exit code 1',
        { code: 'FAILED_WORKER', message: 'Process exit 1', stage: 'FAILED_WORKER' },
      );

      assert.equal(failedWorker?.granularStatus, 'FAILED_WORKER');
      assert.equal(failedWorker?.status, 'failed');
      assert.ok(failedWorker?.timestamps.failedAt);

      const taskId2 = 'task-auth-required';
      taskRegistry.registerTask({ taskId: taskId2, objective: 'Auth failure test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId2, 'VALIDATING');
      taskRegistry.transitionTask(taskId2, 'PREPARING');
      taskRegistry.transitionTask(taskId2, 'READY');
      taskRegistry.transitionTask(taskId2, 'RUNNING');
      const authReq = taskRegistry.transitionTask(
        taskId2,
        'AUTH_REQUIRED',
        'Antigravity CLI authentication required',
        { code: 'AUTH_REQUIRED', message: 'Run agy login', stage: 'AUTH_REQUIRED' },
      );

      assert.equal(authReq?.granularStatus, 'AUTH_REQUIRED');
      assert.equal(authReq?.status, 'failed');
      assert.ok(authReq?.timestamps.failedAt);
    });

    it('verifies discard lifecycle transition order: RUNNING -> CANCELLED -> DISCARDED', async () => {
      const taskId = 'task-discard-order';
      taskRegistry.registerTask({ taskId, objective: 'Discard order test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId, 'VALIDATING');
      taskRegistry.transitionTask(taskId, 'PREPARING');
      taskRegistry.transitionTask(taskId, 'READY');
      taskRegistry.transitionTask(taskId, 'RUNNING');

      const discardTool = registeredTools.get('discard_task');
      const res = await discardTool.handler({ taskId, keepLogs: true });
      const parsed = JSON.parse(res.content[0].text);

      assert.equal(parsed.status, 'discarded');
      assert.equal(parsed.granularStatus, 'DISCARDED');

      const finalRecord = taskRegistry.getTask(taskId);
      assert.ok(finalRecord);
      assert.equal(finalRecord.granularStatus, 'DISCARDED');
      assert.equal(finalRecord.status, 'discarded');

      const historyStates = finalRecord.stateHistory.map((h) => h.state);
      assert.deepEqual(historyStates, [
        'CREATED',
        'VALIDATING',
        'PREPARING',
        'READY',
        'RUNNING',
        'DISCARDED', // Note: task did not have workerId so direct transition to DISCARDED
      ]);
    });
  });

  describe('3. Empirical Verification of inspect_task Outputs', () => {
    it('verifies summary mode outputs granularStatus, stateHistory, and errorDetails accurately', async () => {
      const taskId = 'inspect-summary-emp';
      taskRegistry.registerTask({ taskId, objective: 'Inspect summary test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId, 'VALIDATING');
      const errDetails = {
        code: 'FAILED_POLICY',
        message: 'Forbidden file pattern matched',
        category: 'policy',
        stage: 'FAILED_POLICY',
      };
      taskRegistry.transitionTask(taskId, 'FAILED_POLICY', errDetails.message, errDetails);

      const inspectTool = registeredTools.get('inspect_task');
      const res = await inspectTool.handler({ taskId, mode: 'summary' });
      const parsed = JSON.parse(res.content[0].text);

      assert.equal(parsed.taskId, taskId);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_POLICY');
      assert.ok(Array.isArray(parsed.stateHistory));
      assert.equal(parsed.stateHistory.length, 3);
      assert.equal(parsed.errorDetails.code, 'FAILED_POLICY');
      assert.equal(parsed.errorDetails.message, 'Forbidden file pattern matched');
      assert.equal(parsed.details.granularStatus, 'FAILED_POLICY');
      assert.equal(parsed.details.status, 'failed');
      assert.deepEqual(parsed.details.errorDetails, errDetails);
    });

    it('verifies history mode outputs granularStatus, stateHistory timeline, errorDetails, and phase timestamps', async () => {
      const taskId = 'inspect-history-emp';
      taskRegistry.registerTask({ taskId, objective: 'Inspect history test', granularStatus: 'CREATED' });
      taskRegistry.transitionTask(taskId, 'VALIDATING');
      taskRegistry.transitionTask(taskId, 'PREPARING');
      taskRegistry.transitionTask(taskId, 'READY');
      taskRegistry.transitionTask(taskId, 'RUNNING');
      taskRegistry.transitionTask(taskId, 'COLLECTING');
      taskRegistry.transitionTask(taskId, 'VERIFYING');
      taskRegistry.transitionTask(taskId, 'COMPLETED');

      const inspectTool = registeredTools.get('inspect_task');
      const res = await inspectTool.handler({ taskId, mode: 'history' });
      const parsed = JSON.parse(res.content[0].text);

      assert.equal(parsed.granularStatus, 'COMPLETED');
      assert.equal(parsed.status, 'completed');
      assert.equal(parsed.details.granularStatus, 'COMPLETED');
      assert.equal(parsed.details.stateHistory.length, 8);
      assert.ok(parsed.details.timestamps);
      assert.ok(parsed.details.timestamps.createdAt);
      assert.ok(parsed.details.timestamps.validatedAt);
      assert.ok(parsed.details.timestamps.preparedAt);
      assert.ok(parsed.details.timestamps.startedAt);
      assert.ok(parsed.details.timestamps.collectedAt);
      assert.ok(parsed.details.timestamps.verifiedAt);
      assert.ok(parsed.details.timestamps.completedAt);
    });

    it('verifies logs mode outputs stdout, stderr, granularStatus, and errorDetails', async () => {
      const taskId = 'inspect-logs-emp';
      taskRegistry.registerTask({
        taskId,
        objective: 'Inspect logs test',
        granularStatus: 'CREATED',
        workerOutput: { stdout: 'Building project...\nDone.', stderr: 'Warning: unused variable' },
      });
      const errDetails = {
        code: 'FAILED_VERIFICATION',
        message: 'Tests failed: 2 broken tests',
        category: 'verification',
        stage: 'FAILED_VERIFICATION',
      };
      taskRegistry.transitionTask(taskId, 'FAILED_VERIFICATION', errDetails.message, errDetails);

      const inspectTool = registeredTools.get('inspect_task');
      const res = await inspectTool.handler({ taskId, mode: 'logs' });
      const parsed = JSON.parse(res.content[0].text);

      assert.equal(parsed.granularStatus, 'FAILED_VERIFICATION');
      assert.equal(parsed.details.stdout, 'Building project...\nDone.');
      assert.equal(parsed.details.stderr, 'Warning: unused variable');
      assert.equal(parsed.details.granularStatus, 'FAILED_VERIFICATION');
      assert.equal(parsed.details.errorDetails.code, 'FAILED_VERIFICATION');
    });

    it('verifies fallback inspection from disk artifact bundle when task is absent in memory TaskRegistry', async () => {
      const taskId = 'inspect-disk-fallback-task';
      const history = [
        { state: 'CREATED', fromState: null, toState: 'CREATED', timestamp: new Date().toISOString() },
        { state: 'VALIDATING', fromState: 'CREATED', toState: 'VALIDATING', timestamp: new Date().toISOString() },
        { state: 'FAILED_CONTRACT', fromState: 'VALIDATING', toState: 'FAILED_CONTRACT', timestamp: new Date().toISOString() },
      ];
      const errDetails = {
        code: 'FAILED_CONTRACT',
        message: 'Disk fallback contract error',
        category: 'contract',
        stage: 'FAILED_CONTRACT',
      };

      // Save metadata artifact bundle directly
      await artifactManager.saveArtifact(
        'metadata',
        {
          taskId,
          status: 'failed',
          granularStatus: 'FAILED_CONTRACT',
          stateHistory: history,
          errorDetails: errDetails,
          objective: 'Disk fallback test',
          revisions: 0,
        },
        { taskId, category: 'metadata', filename: 'metadata.json' },
      );

      // Verify task is NOT in memory taskRegistry
      assert.equal(taskRegistry.getTask(taskId), undefined);

      const inspectTool = registeredTools.get('inspect_task');
      const res = await inspectTool.handler({ taskId, mode: 'summary' });
      const parsed = JSON.parse(res.content[0].text);

      assert.equal(parsed.taskId, taskId);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_CONTRACT');
      assert.equal(parsed.stateHistory.length, 3);
      assert.equal(parsed.errorDetails.code, 'FAILED_CONTRACT');
      assert.equal(parsed.errorDetails.message, 'Disk fallback contract error');
    });

    it('returns formatted error when inspecting non-existent task absent from both memory and disk', async () => {
      const inspectTool = registeredTools.get('inspect_task');
      const res = await inspectTool.handler({ taskId: 'non-existent-task-id', mode: 'summary' });
      assert.ok(res.content[0].text.includes('Error: Task non-existent-task-id not found'));
    });
  });

  describe('4. Empirical Stress Testing & Edge Cases', () => {
    it('handles rapid sequential transitions (50 transitions) without state history corruption', () => {
      const taskId = 'task-rapid-transitions';
      taskRegistry.registerTask({ taskId, objective: 'Rapid transitions test', granularStatus: 'CREATED' });

      const cycle = ['VALIDATING', 'PREPARING', 'READY', 'RUNNING', 'COLLECTING', 'VERIFYING'];
      for (let i = 0; i < 50; i++) {
        const nextState = cycle[i % cycle.length];
        taskRegistry.transitionTask(taskId, nextState, `Transition #${i}`);
      }

      const task = taskRegistry.getTask(taskId);
      assert.ok(task);
      assert.equal(task.stateHistory.length, 51); // Initial CREATED + 50 transitions

      // Verify transition integrity
      for (let i = 1; i < task.stateHistory.length; i++) {
        const prev = task.stateHistory[i - 1];
        const curr = task.stateHistory[i];
        assert.equal(curr.fromState, prev.state);
        assert.equal(curr.toState, curr.state);
        assert.ok(new Date(curr.timestamp).getTime() >= new Date(prev.timestamp).getTime());
      }
    });

    it('ensures tool output responses maintain backward-compatible status field alongside granularStatus', async () => {
      const delegateTool = registeredTools.get('delegate_task');
      const res = await delegateTool.handler({
        taskType: 'unit-test',
        // invalid payload: missing objective
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.ok(parsed.status, 'Must contain legacy status field');
      assert.ok(parsed.granularStatus, 'Must contain granularStatus field');
      assert.equal(parsed.status, mapGranularToLegacyStatus(parsed.granularStatus));
    });
  });
});
