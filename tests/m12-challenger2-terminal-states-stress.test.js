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

import { execSync } from 'node:child_process';
import { settleHandler } from './helpers/agy-mock.js';

describe('M12 Challenger 2: Pre-registration Failures & Terminal States Stress Suite', () => {
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
    tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-m12-challenger2-repo-'));
    try {
      execSync('git init', { cwd: tempRepoRoot, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: tempRepoRoot, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tempRepoRoot, stdio: 'ignore' });
      await fs.writeFile(path.join(tempRepoRoot, 'README.md'), '# Test Repo\n');
      execSync('git add . && git commit -m "initial commit"', { cwd: tempRepoRoot, stdio: 'ignore' });
    } catch {}
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
    const capture = (name, description, schema, handler) => {
      // delegate_task returns once the worker is spawned; these tests assert on
      // the terminal state, so wrap it to resolve after the task settles.
      const settled =
        name === 'delegate_task' ? settleHandler(handler, taskRegistry) : handler;
      registeredTools.set(name, { name, description, schema, handler: settled });
    };
    mockMcpServer = {
      tool: (name, description, schema, handler) => capture(name, description, schema, handler),
      registerTool: (name, config, handler) =>
        capture(name, config?.description, config?.inputSchema, handler),
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

  describe('1. Pre-registration Failures & FAILED_CONTRACT', () => {
    it('records FAILED_CONTRACT state, error details, and metadata on missing required parameter', async () => {
      const tool = registeredTools.get('delegate_task');
      // Pass missing objective to trigger contract validation error
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'unit-test',
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_CONTRACT');
      assert.ok(parsed.taskId);
      assert.equal(parsed.errorDetails.code, 'FAILED_CONTRACT');
      assert.equal(parsed.errorDetails.category, 'contract');
      assert.equal(parsed.errorDetails.stage, 'FAILED_CONTRACT');

      // Check TaskRegistry
      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_CONTRACT');
      assert.equal(task.status, 'failed');
      assert.ok(task.timestamps.failedAt);

      // Check state history
      const historyStates = task.stateHistory.map((h) => h.state);
      assert.deepEqual(historyStates, ['CREATED', 'VALIDATING', 'FAILED_CONTRACT']);

      // Check persisted metadata
      const metaStr = await artifactManager.getArtifact('metadata', parsed.taskId);
      assert.ok(metaStr);
      const meta = JSON.parse(metaStr);
      assert.equal(meta.granularStatus, 'FAILED_CONTRACT');
      assert.equal(meta.status, 'failed');
      assert.equal(meta.errorDetails.code, 'FAILED_CONTRACT');
      assert.ok(meta.timestamps.failedAt);
    });
  });

  describe('2. Policy Rejections & FAILED_POLICY', () => {
    it('records FAILED_POLICY state when allowedPaths policy check fails', async () => {
      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'unit-test',
        objective: 'Test allowed path policy violation',
        allowedPaths: ['../outside/file.js'],
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_POLICY');
      assert.equal(parsed.errorDetails.stage, 'FAILED_POLICY');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_POLICY');
      assert.equal(task.status, 'failed');

      const historyStates = task.stateHistory.map((h) => h.state);
      assert.deepEqual(historyStates, ['CREATED', 'VALIDATING', 'FAILED_POLICY']);

      const metaStr = await artifactManager.getArtifact('metadata', parsed.taskId);
      assert.ok(metaStr);
      const meta = JSON.parse(metaStr);
      assert.equal(meta.granularStatus, 'FAILED_POLICY');
      assert.equal(meta.status, 'failed');
    });

    it('records FAILED_POLICY state when disallowedPaths policy check fails', async () => {
      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'unit-test',
        objective: 'Test disallowed path policy violation',
        disallowedPaths: ['src/**'],
        allowedPaths: ['src/index.ts'],
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_POLICY');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_POLICY');
    });

    it('records FAILED_POLICY state when verification command policy fails', async () => {
      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'unit-test',
        objective: 'Test verification command policy violation',
        verificationCommands: ['rm -rf /'],
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_POLICY');
      assert.equal(parsed.errorDetails.stage, 'FAILED_POLICY');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_POLICY');
    });

    it('records FAILED_POLICY state when repository readiness fails', async () => {
      const nonExistentRepo = path.join(tempRepoRoot, 'does-not-exist');
      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: nonExistentRepo,
        taskType: 'unit-test',
        objective: 'Test repo readiness failure',
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_POLICY');
      assert.equal(parsed.errorDetails.category, 'repository');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_POLICY');
      assert.equal(task.status, 'failed');
    });
  });

  describe('3. Process Execution Failures & FAILED_WORKER', () => {
    it('records FAILED_WORKER state when worker CLI command fails or is missing', async () => {
      // Set invalid AGY_COMMAND to force worker spawn failure
      process.env.AGY_COMMAND = 'non_existent_command_12345';

      try {
        const tool = registeredTools.get('delegate_task');
        const res = await tool.handler({
          repoPath: tempRepoRoot,
          taskType: 'unit-test',
          objective: 'Test worker missing executable failure',
        });

        const parsed = JSON.parse(res.content[0].text);
        assert.equal(parsed.status, 'failed');
        assert.equal(parsed.granularStatus, 'FAILED_WORKER');
        assert.ok(parsed.errorDetails);
        assert.equal(parsed.errorDetails.stage, 'FAILED_WORKER');

        const task = taskRegistry.getTask(parsed.taskId);
        assert.ok(task);
        assert.equal(task.granularStatus, 'FAILED_WORKER');
        assert.equal(task.status, 'failed');

        const historyStates = task.stateHistory.map((h) => h.state);
        assert.ok(historyStates.includes('PREPARING'));
        assert.equal(historyStates[historyStates.length - 1], 'FAILED_WORKER');

        const metaStr = await artifactManager.getArtifact('metadata', parsed.taskId);
        assert.ok(metaStr);
        const meta = JSON.parse(metaStr);
        assert.equal(meta.granularStatus, 'FAILED_WORKER');
        assert.equal(meta.status, 'failed');
      } finally {
        delete process.env.AGY_COMMAND;
      }
    });

    it('records FAILED_WORKER when mock worker process exits with non-zero code', async () => {
      // Mock workerDriver spawnWorker to simulate non-zero exit code worker
      workerDriver.spawnWorker = async (options) => {
        return {
          workerId: 'mock-worker-1',
          process: {},
          promise: Promise.resolve({
            exitCode: 1,
            stdout: 'Build failed error line',
            stderr: 'Compilation error: syntax error in main.ts',
          }),
        };
      };

      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'unit-test',
        objective: 'Test worker exit code 1 failure',
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_WORKER');
      assert.equal(parsed.errorDetails.code, 'FAILED_WORKER');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_WORKER');
      assert.equal(task.status, 'failed');

      const historyStates = task.stateHistory.map((h) => h.state);
      assert.deepEqual(historyStates, [
        'CREATED',
        'VALIDATING',
        'PREPARING',
        'READY',
        'RUNNING',
        'COLLECTING',
        'FAILED_WORKER',
      ]);
    });
  });

  describe('4. Post-execution Verification Failures & FAILED_VERIFICATION', () => {
    it('records FAILED_VERIFICATION state when worker succeeds but verification command fails', async () => {
      // Mock worker execution success
      // The mock has to leave a change behind: a worker that exits 0 without
      // touching anything is now reported as FAILED_WORKER, not success.
      workerDriver.spawnWorker = async (options) => {
        await fs.writeFile(path.join(options.cwd, 'generated.txt'), 'mock worker output\n');
        return {
          workerId: 'mock-worker-2',
          process: {},
          promise: Promise.resolve({
            exitCode: 0,
            stdout: 'Code generated',
            stderr: '',
          }),
        };
      };

      // Mock verification engine failure
      verificationEngine.verifyWorktree = async (path, commands) => {
        return {
          passed: false,
          results: [
            { command: commands[0], passed: false, stdout: '', stderr: '1 test failed' },
          ],
        };
      };

      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'unit-test',
        objective: 'Test verification failure transition',
        verificationCommands: ['npm test'],
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'FAILED_VERIFICATION');
      assert.equal(parsed.errorDetails.code, 'FAILED_VERIFICATION');
      assert.equal(parsed.errorDetails.category, 'verification');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'FAILED_VERIFICATION');
      assert.equal(task.status, 'failed');

      const historyStates = task.stateHistory.map((h) => h.state);
      assert.deepEqual(historyStates, [
        'CREATED',
        'VALIDATING',
        'PREPARING',
        'READY',
        'RUNNING',
        'COLLECTING',
        'VERIFYING',
        'FAILED_VERIFICATION',
      ]);

      assert.ok(task.timestamps.verifiedAt);
      assert.ok(task.timestamps.failedAt);

      const metaStr = await artifactManager.getArtifact('metadata', parsed.taskId);
      assert.ok(metaStr);
      const meta = JSON.parse(metaStr);
      assert.equal(meta.granularStatus, 'FAILED_VERIFICATION');
      assert.equal(meta.status, 'failed');
    });
  });

  describe('5. Authentication Error & AUTH_REQUIRED State', () => {
    it('records AUTH_REQUIRED state when worker stderr indicates authentication failure', async () => {
      workerDriver.spawnWorker = async (options) => {
        return {
          workerId: 'mock-worker-auth',
          process: {},
          promise: Promise.resolve({
            exitCode: 1,
            stdout: '',
            stderr: '401 Unauthorized: please run agy login to authenticate',
          }),
        };
      };

      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'unit-test',
        objective: 'Test authentication error transition',
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.granularStatus, 'AUTH_REQUIRED');
      assert.equal(parsed.errorDetails.code, 'AUTH_REQUIRED');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'AUTH_REQUIRED');
      assert.equal(task.status, 'failed');
      assert.ok(task.timestamps.failedAt);
    });
  });

  describe('6. Completed with Warnings & COMPLETED_WITH_WARNINGS State', () => {
    it('records COMPLETED_WITH_WARNINGS state when execution succeeds with repo warnings', async () => {
      repositoryInspector.validateRepoReady = async () => ({
        valid: true,
        errors: [],
        warnings: ['Uncommitted changes in worktree'],
      });

      // The mock has to leave a change behind: a worker that exits 0 without
      // touching anything is now reported as FAILED_WORKER, not success.
      workerDriver.spawnWorker = async (options) => {
        await fs.writeFile(path.join(options.cwd, 'generated.txt'), 'mock worker output\n');
        return {
          workerId: 'mock-worker-warnings',
          process: {},
          promise: Promise.resolve({
            exitCode: 0,
            stdout: 'Finished successfully',
            stderr: '',
          }),
        };
      };

      const tool = registeredTools.get('delegate_task');
      const res = await tool.handler({
        repoPath: tempRepoRoot,
        taskType: 'unit-test',
        objective: 'Test completed with warnings state',
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'completed');
      assert.equal(parsed.granularStatus, 'COMPLETED_WITH_WARNINGS');

      const task = taskRegistry.getTask(parsed.taskId);
      assert.ok(task);
      assert.equal(task.granularStatus, 'COMPLETED_WITH_WARNINGS');
      assert.equal(task.status, 'completed');
      assert.ok(task.timestamps.completedAt);
    });
  });

  describe('7. Worker Cancellation & CANCELLED State', () => {
    it('transitions active worker task to CANCELLED and terminates worker on discard_task', async () => {
      let workerTerminated = false;
      processSupervisor.terminateProcess = async (pid) => {
        workerTerminated = true;
      };

      const taskId = 'task-cancelled-test';
      taskRegistry.registerTask({
        taskId,
        objective: 'Active task discard test',
        granularStatus: 'RUNNING',
        workerId: 'worker-proc-999',
      });

      const discardTool = registeredTools.get('discard_task');
      const res = await discardTool.handler({
        taskId,
        keepLogs: true,
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'discarded');
      assert.equal(parsed.granularStatus, 'DISCARDED');

      const task = taskRegistry.getTask(taskId);
      assert.ok(task);
      const historyStates = task.stateHistory.map((h) => h.state);
      assert.ok(historyStates.includes('CANCELLED'), 'History should contain CANCELLED transition');
      assert.equal(historyStates[historyStates.length - 1], 'DISCARDED');
    });
  });

  describe('6. Task Discard Flow & DISCARDED State', () => {
    it('properly records DISCARDED state and cleans artifacts when keepLogs is false', async () => {
      const taskId = 'discard-nologs-task';
      taskRegistry.registerTask({
        taskId,
        objective: 'Discard without logs test',
        granularStatus: 'CREATED',
      });
      await artifactManager.saveTaskBundle(taskId, {
        status: 'running',
        granularStatus: 'CREATED',
        objective: 'Discard test',
      });

      const discardTool = registeredTools.get('discard_task');
      const res = await discardTool.handler({
        taskId,
        keepLogs: false,
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'discarded');
      assert.equal(parsed.granularStatus, 'DISCARDED');

      // Artifacts directory should be deleted
      const metaStr = await artifactManager.getArtifact('metadata', taskId);
      assert.equal(metaStr, null);
    });

    it('records DISCARDED state and updates metadata when keepLogs is true', async () => {
      const taskId = 'discard-withlogs-task';
      taskRegistry.registerTask({
        taskId,
        objective: 'Discard with logs test',
        granularStatus: 'CREATED',
      });
      await artifactManager.saveTaskBundle(taskId, {
        status: 'running',
        granularStatus: 'CREATED',
        objective: 'Discard test with logs',
      });

      const discardTool = registeredTools.get('discard_task');
      const res = await discardTool.handler({
        taskId,
        keepLogs: true,
      });

      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.status, 'discarded');
      assert.equal(parsed.granularStatus, 'DISCARDED');

      // Metadata file should still exist and reflect DISCARDED
      const metaStr = await artifactManager.getArtifact('metadata', taskId);
      assert.ok(metaStr);
      const meta = JSON.parse(metaStr);
      assert.equal(meta.granularStatus, 'DISCARDED');
      assert.equal(meta.status, 'discarded');
    });
  });

  describe('7. Legacy status Backward Compatibility', () => {
    const expectedMappings = {
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

    it('maps every granular state to correct legacy status', () => {
      for (const [granular, legacy] of Object.entries(expectedMappings)) {
        assert.equal(
          mapGranularToLegacyStatus(granular),
          legacy,
          `State ${granular} failed mapping`,
        );
      }
    });

    it('maps legacy statuses to representative granular states', () => {
      assert.equal(mapLegacyToGranularStatus('running'), 'RUNNING');
      assert.equal(mapLegacyToGranularStatus('completed'), 'COMPLETED');
      assert.equal(mapLegacyToGranularStatus('revised'), 'REVISION_REQUIRED');
      assert.equal(mapLegacyToGranularStatus('failed'), 'FAILED_WORKER');
      assert.equal(mapLegacyToGranularStatus('discarded'), 'DISCARDED');
    });

    it('synchronizes legacy status when granular state updates in TaskRegistry', () => {
      const taskId = 'task-sync-test';
      taskRegistry.registerTask({ taskId, granularStatus: 'CREATED' });
      const record1 = taskRegistry.getTask(taskId);
      assert.equal(record1.status, 'running');

      taskRegistry.transitionTask(taskId, 'FAILED_CONTRACT');
      const record2 = taskRegistry.getTask(taskId);
      assert.equal(record2.status, 'failed');

      taskRegistry.transitionTask(taskId, 'COMPLETED');
      const record3 = taskRegistry.getTask(taskId);
      assert.equal(record3.status, 'completed');

      taskRegistry.transitionTask(taskId, 'DISCARDED');
      const record4 = taskRegistry.getTask(taskId);
      assert.equal(record4.status, 'discarded');
    });
  });
});
