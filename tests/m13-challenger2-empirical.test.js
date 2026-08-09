import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TaskRegistry } from '../dist/components/task-registry.js';
import { ArtifactManager } from '../dist/components/artifact-manager.js';
import { RepositoryInspector } from '../dist/components/repository-inspector.js';
import { WorktreeManager } from '../dist/components/worktree-manager.js';
import { AntigravityDriver, sanitizeEnvironment } from '../dist/components/worker-driver.js';
import { VerificationEngine } from '../dist/components/verification-engine.js';
import { ModelRouter } from '../dist/components/model-router.js';
import { PolicyEngine } from '../dist/components/policy-engine.js';
import { ContractValidator } from '../dist/components/contract-validator.js';
import { ProcessSupervisor } from '../dist/components/process-supervisor.js';
import { registerInspectTaskTool } from '../dist/tools/inspect-task.js';
import { registerReviseTaskTool } from '../dist/tools/revise-task.js';
import { registerDelegateTaskTool } from '../dist/tools/delegate-task.js';
import { registerDiscardTaskTool } from '../dist/tools/discard-task.js';
import { mapGranularToLegacyStatus, mapLegacyToGranularStatus } from '../dist/types/task.js';

test('M13 Challenger 2: Granular Task States Verification', async (t) => {
  const expected17States = [
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

  await t.test('All 17 states exist and map correctly to legacy statuses', () => {
    assert.equal(expected17States.length, 17, 'Should have exactly 17 granular states');

    for (const state of expected17States) {
      const legacyStatus = mapGranularToLegacyStatus(state);
      assert.ok(['running', 'completed', 'revised', 'failed', 'discarded'].includes(legacyStatus),
        `State ${state} should map to a valid legacy status`);
    }

    assert.equal(mapGranularToLegacyStatus('CREATED'), 'running');
    assert.equal(mapGranularToLegacyStatus('VALIDATING'), 'running');
    assert.equal(mapGranularToLegacyStatus('PREPARING'), 'running');
    assert.equal(mapGranularToLegacyStatus('READY'), 'running');
    assert.equal(mapGranularToLegacyStatus('RUNNING'), 'running');
    assert.equal(mapGranularToLegacyStatus('COLLECTING'), 'running');
    assert.equal(mapGranularToLegacyStatus('VERIFYING'), 'running');
    assert.equal(mapGranularToLegacyStatus('COMPLETED'), 'completed');
    assert.equal(mapGranularToLegacyStatus('COMPLETED_WITH_WARNINGS'), 'completed');
    assert.equal(mapGranularToLegacyStatus('REVISION_REQUIRED'), 'revised');
    assert.equal(mapGranularToLegacyStatus('FAILED_CONTRACT'), 'failed');
    assert.equal(mapGranularToLegacyStatus('FAILED_WORKER'), 'failed');
    assert.equal(mapGranularToLegacyStatus('FAILED_POLICY'), 'failed');
    assert.equal(mapGranularToLegacyStatus('FAILED_VERIFICATION'), 'failed');
    assert.equal(mapGranularToLegacyStatus('AUTH_REQUIRED'), 'failed');
    assert.equal(mapGranularToLegacyStatus('CANCELLED'), 'failed');
    assert.equal(mapGranularToLegacyStatus('DISCARDED'), 'discarded');
  });

  await t.test('TaskRegistry supports transitions through all 17 states', () => {
    const registry = new TaskRegistry();
    const task = registry.registerTask({
      taskId: 'test-17-states',
      taskType: 'unit-test',
      objective: 'Verify 17 task states transition capability',
      repoPath: process.cwd(),
    });

    assert.equal(task.granularStatus, 'CREATED');

    for (const state of expected17States.slice(1)) {
      const updated = registry.transitionTask('test-17-states', state, `Transitioning to ${state}`);
      assert.equal(updated.granularStatus, state);
    }

    const finalTask = registry.getTask('test-17-states');
    assert.equal(finalTask.stateHistory.length, 17);
  });
});

test('M13 Challenger 2: Zero-Trust Diff Verification via inspect_task', async (t) => {
  const mcpServer = new McpServer({ name: 'test', version: '1.0.0' });
  const taskRegistry = new TaskRegistry();
  const artifactManager = new ArtifactManager();
  const repositoryInspector = new RepositoryInspector();
  const worktreeManager = new WorktreeManager();
  const workerDriver = new AntigravityDriver();
  const verificationEngine = new VerificationEngine();
  const policyEngine = new PolicyEngine();
  const contractValidator = new ContractValidator();
  const supervisor = new ProcessSupervisor();

  const components = {
    taskRegistry,
    artifactManager,
    repositoryInspector,
    worktreeManager,
    workerDriver,
    verificationEngine,
    modelRouter: new ModelRouter(),
    policyEngine,
    contractValidator,
    supervisor,
  };

  registerInspectTaskTool(mcpServer, components);

  const registeredTools = mcpServer._registeredTools || mcpServer._tools;
  assert.ok(registeredTools, 'inspect_task tool should be registered');

  taskRegistry.registerTask({
    taskId: 'inspect-test-task',
    taskType: 'unit-test',
    objective: 'Test inspect_task 6 modes',
    repoPath: process.cwd(),
  });

  taskRegistry.updateTask('inspect-test-task', {
    changedFiles: ['src/foo.ts', 'tests/foo.test.ts'],
    latestDiff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n',
    verificationResults: [{ command: 'npm test', passed: true, exitCode: 0, durationMs: 120 }],
    workerOutput: { stdout: 'Worker finished successfully', stderr: '' },
  });

  const toolDef = registeredTools['inspect_task'];
  assert.ok(toolDef, 'inspect_task definition must exist');

  const modes = ['summary', 'diff', 'files', 'verifications', 'logs', 'history'];
  for (const mode of modes) {
    const response = await toolDef.handler({ taskId: 'inspect-test-task', mode });
    assert.ok(response && response.content && response.content[0], `Mode ${mode} should return valid content`);
    const parsed = JSON.parse(response.content[0].text);
    assert.equal(parsed.taskId, 'inspect-test-task');
    assert.equal(parsed.mode, mode);
    assert.ok(parsed.details, `Mode ${mode} should provide details object`);
  }
});

test('M13 Challenger 2: Security Policies & Env Sanitization', async (t) => {
  await t.test('Sanitize environment strips sensitive credentials', () => {
    const parentEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/test',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      OPENAI_API_KEY: 'sk-openai-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret-key',
      GITHUB_TOKEN: 'ghp_secrettoken',
      STRIPE_SECRET_KEY: 'sk_live_secret',
      CUSTOM_SECRET_PASSWORD: 'supersecretpass',
      GELADA_ALLOW_VAR: 'allowed_val',
    };

    const sanitized = sanitizeEnvironment(parentEnv, undefined, { sanitizeEnv: true });

    assert.equal(sanitized.PATH, '/usr/bin:/bin');
    assert.equal(sanitized.HOME, '/Users/test');
    assert.equal(sanitized.ANTHROPIC_API_KEY, undefined, 'ANTHROPIC_API_KEY must be stripped');
    assert.equal(sanitized.OPENAI_API_KEY, undefined, 'OPENAI_API_KEY must be stripped');
    assert.equal(sanitized.AWS_SECRET_ACCESS_KEY, undefined, 'AWS_SECRET_ACCESS_KEY must be stripped');
    assert.equal(sanitized.GITHUB_TOKEN, undefined, 'GITHUB_TOKEN must be stripped');
    assert.equal(sanitized.STRIPE_SECRET_KEY, undefined, 'STRIPE_SECRET_KEY must be stripped');
    assert.equal(sanitized.CUSTOM_SECRET_PASSWORD, undefined, 'CUSTOM_SECRET_PASSWORD matching secret regex must be stripped');
    assert.equal(sanitized.GELADA_ALLOW_VAR, 'allowed_val', 'Gelada framework variables must be preserved');
  });

  await t.test('PolicyEngine blocks unauthorized actions and dangerous commands', () => {
    const policy = new PolicyEngine();
    const hardLimits = policy.getEffectivePolicy();

    assert.ok(hardLimits.blockedExecutables.includes('sudo'));
    assert.ok(hardLimits.blockedExecutables.includes('su'));
    assert.ok(hardLimits.blockedExecutables.includes('eval'));
    assert.ok(hardLimits.blockedExecutables.includes('exec'));

    const cmdCheck = policy.validateVerificationCommands(['sudo rm -rf /']);
    assert.equal(cmdCheck.allowed, false, 'sudo command should be rejected');
  });
});
