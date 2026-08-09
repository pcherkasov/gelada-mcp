import assert from 'node:assert/strict';
import { GeladaServer, createGeladaServer } from '../dist/server.js';
import { ContractValidator } from '../dist/components/contract-validator.js';
import { PolicyEngine } from '../dist/components/policy-engine.js';
import { RepositoryInspector } from '../dist/components/repository-inspector.js';
import { WorktreeManager } from '../dist/components/worktree-manager.js';
import { AntigravityDriver } from '../dist/components/worker-driver.js';
import { ProcessSupervisor } from '../dist/components/process-supervisor.js';
import { VerificationEngine } from '../dist/components/verification-engine.js';
import { ArtifactManager } from '../dist/components/artifact-manager.js';

console.log('=== STARTING M2 CORE COMPONENTS EMPIRICAL TESTS ===');

let passCount = 0;
let testCount = 0;

function runTest(name, fn) {
  testCount++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err);
  }
}

async function runAsyncTest(name, fn) {
  testCount++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err);
  }
}

// 1. ContractValidator Tests
runTest('ContractValidator: valid contract', () => {
  const validator = new ContractValidator();
  const res = validator.validateContract({
    taskId: 'task-1',
    description: 'Implement feature X',
    targetDirectory: '/tmp/repo',
    maxDurationSeconds: 300,
  });
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

runTest('ContractValidator: invalid contract (missing required fields)', () => {
  const validator = new ContractValidator();
  const res = validator.validateContract({
    taskId: '',
    description: '   ',
    targetDirectory: '',
    maxDurationSeconds: -10,
  });
  assert.equal(res.valid, false);
  assert.equal(res.errors.length, 4);
});

// 2. PolicyEngine Tests
runTest('PolicyEngine: evaluateAction default allowed actions', () => {
  const policy = new PolicyEngine();
  const res = policy.evaluateAction('delegate_task');
  assert.equal(res.allowed, true);
  const res2 = policy.evaluateAction('doctor');
  assert.equal(res2.allowed, true);
});

runTest('PolicyEngine: evaluateAction restricted context', () => {
  const policy = new PolicyEngine();
  const res = policy.evaluateAction('delegate_task', { restricted: true });
  assert.equal(res.allowed, false);
  assert.match(res.reason || '', /restricted/i);
});

runTest('PolicyEngine: path traversal protection', () => {
  const policy = new PolicyEngine();
  assert.equal(policy.isPathAllowed('src/index.ts'), true);
  assert.equal(policy.isPathAllowed('../secret.txt'), false);
  assert.equal(policy.isPathAllowed('/var/log/../etc/passwd'), false);
});

// 3. RepositoryInspector Tests
await runAsyncTest('RepositoryInspector: inspectRepo default/custom path', async () => {
  const inspector = new RepositoryInspector();
  const state = await inspector.inspectRepo('./');
  assert.ok(typeof state.isClean === 'boolean');
  assert.ok(typeof state.currentBranch === 'string');
  assert.ok(typeof state.repoPath === 'string' && state.repoPath.length > 0);
});

// 4. WorktreeManager Tests
await runAsyncTest('WorktreeManager: create, get, list, remove worktree', async () => {
  const manager = new WorktreeManager();
  const wt = await manager.createWorktree('feat/test-branch!');
  assert.equal(wt.worktreeId, 'wt-feat-test-branch-');
  assert.equal(wt.path, '.worktrees/feat-test-branch-');

  const retrieved = manager.getWorktree(wt.worktreeId);
  assert.deepEqual(retrieved, wt);

  const list = manager.listWorktrees();
  assert.equal(list.length, 1);

  await manager.removeWorktree(wt.worktreeId);
  assert.equal(manager.listWorktrees().length, 0);
  assert.equal(manager.getWorktree(wt.worktreeId), undefined);
});

// 5. AntigravityDriver Tests
await runAsyncTest('AntigravityDriver: spawn, status, terminate worker', async () => {
  const driver = new AntigravityDriver();
  const handle = await driver.spawnWorker({
    taskId: 't-100',
    command: 'echo hello',
    cwd: '/tmp',
  });
  assert.equal(handle.workerId, 'worker-t-100');
  assert.equal(handle.status, 'running');

  const status = await driver.getWorkerStatus('worker-t-100');
  assert.equal(status.status, 'running');

  const termRes = await driver.terminateWorker('worker-t-100');
  assert.equal(termRes, true);

  const statusAfter = await driver.getWorkerStatus('worker-t-100');
  assert.ok(statusAfter.status === 'completed' || statusAfter.status === 'terminated');
});

// 6. ProcessSupervisor Tests
await runAsyncTest('ProcessSupervisor: register, kill, list processes', async () => {
  const supervisor = new ProcessSupervisor();
  const p1 = supervisor.registerProcess(1234, 'worker-node');
  assert.equal(p1.pid, 1234);
  assert.equal(p1.status, 'running');

  assert.equal(supervisor.getActiveProcesses().length, 1);

  const killed = await supervisor.killProcess(1234);
  assert.equal(killed, true);
  assert.equal(supervisor.getActiveProcesses().length, 0);

  const killedNonExistent = await supervisor.killProcess(9999);
  assert.equal(killedNonExistent, false);
});

// 7. VerificationEngine Tests
await runAsyncTest('VerificationEngine: verifyWorktree', async () => {
  const verifier = new VerificationEngine();
  const res = await verifier.verifyWorktree(process.cwd(), ['node -e "console.log(123)"']);
  assert.equal(res.passed, true);
  assert.equal(res.results.length, 1);
  assert.ok(res.results[0].output.includes('123'));
});

// 8. ArtifactManager Tests
await runAsyncTest('ArtifactManager: save, get, list artifacts', async () => {
  const manager = new ArtifactManager();
  const testTaskId = `test-am-${Date.now()}`;
  const content = JSON.stringify({ key: 'value' });
  const meta = await manager.saveArtifact('art-1', content, { taskId: testTaskId });
  assert.equal(meta.artifactId, 'art-1');
  assert.equal(meta.sizeBytes, Buffer.byteLength(content, 'utf-8'));

  const retrieved = await manager.getArtifact('art-1', testTaskId);
  assert.equal(retrieved, content);

  const nonExistent = await manager.getArtifact('art-999', testTaskId);
  assert.equal(nonExistent, null);

  const list = await manager.listArtifacts(testTaskId);
  assert.ok(list.length >= 1, 'should have at least 1 artifact');
  assert.ok(list.some(a => a.artifactId === 'art-1'), 'art-1 should be in list');

  // cleanup
  await manager.deleteArtifacts(testTaskId);
});

// 9. GeladaServer Initialization Tests
runTest('GeladaServer: clean initialization with all 8 components', () => {
  const server = new GeladaServer();
  assert.ok(server.components.contractValidator instanceof ContractValidator);
  assert.ok(server.components.policyEngine instanceof PolicyEngine);
  assert.ok(server.components.repositoryInspector instanceof RepositoryInspector);
  assert.ok(server.components.worktreeManager instanceof WorktreeManager);
  assert.ok(server.components.workerDriver instanceof AntigravityDriver);
  assert.ok(server.components.processSupervisor instanceof ProcessSupervisor);
  assert.ok(server.components.verificationEngine instanceof VerificationEngine);
  assert.ok(server.components.artifactManager instanceof ArtifactManager);
  assert.ok(server.getMcpServer() !== null);
});

runTest('GeladaServer: createGeladaServer factory with custom components', () => {
  const customPolicy = new PolicyEngine();
  const server = createGeladaServer({ policyEngine: customPolicy });
  assert.equal(server.components.policyEngine, customPolicy);
  assert.ok(server.components.contractValidator instanceof ContractValidator);
});

console.log(`\n=== TEST SUMMARY: ${passCount}/${testCount} PASSED ===`);

if (passCount !== testCount) {
  process.exit(1);
}
