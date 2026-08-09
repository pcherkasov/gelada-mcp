import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { WorktreeManager } from '../dist/components/worktree-manager.js';
import { ProcessSupervisor } from '../dist/components/process-supervisor.js';
import { VerificationEngine } from '../dist/components/verification-engine.js';
import { TaskRegistry } from '../dist/components/task-registry.js';
import { ArtifactManager } from '../dist/components/artifact-manager.js';

const execAsync = promisify(exec);

test('Public E2E Integration Suite (Requirement R6)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-public-e2e-'));
  const repoDir = path.join(tmpDir, 'test-repo');

  // Setup git repo
  fs.mkdirSync(repoDir, { recursive: true });
  await execAsync('git init', { cwd: repoDir });
  await execAsync('git config user.name "Test User"', { cwd: repoDir });
  await execAsync('git config user.email "test@example.com"', { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test Repo');
  await execAsync('git add README.md', { cwd: repoDir });
  await execAsync('git commit -m "initial commit"', { cwd: repoDir });

  const { stdout: commitSha } = await execAsync('git rev-parse HEAD', { cwd: repoDir });
  const baseSha = commitSha.trim();

  const taskRegistry = new TaskRegistry();
  const worktreeManager = new WorktreeManager();
  const processSupervisor = new ProcessSupervisor();
  const verificationEngine = new VerificationEngine();
  const artifactManager = new ArtifactManager();

  await t.test('1. Full task delegation lifecycle transitions to COMPLETED', async () => {
    const taskId = 'task-e2e-001';
    taskRegistry.registerTask({ taskId, repoPath: repoDir, taskType: 'unit-test', objective: 'e2e test' });
    taskRegistry.transitionTask(taskId, 'VALIDATING');
    assert.equal(taskRegistry.getTask(taskId)?.granularStatus, 'VALIDATING');

    taskRegistry.transitionTask(taskId, 'PREPARING');
    const worktreeInfo = await worktreeManager.createWorktree(taskId, { repoPath: repoDir, baseCommit: baseSha });
    const absPath = path.isAbsolute(worktreeInfo.path) ? worktreeInfo.path : path.resolve(repoDir, worktreeInfo.path);
    assert.ok(fs.existsSync(absPath));

    taskRegistry.transitionTask(taskId, 'READY');
    assert.equal(taskRegistry.getTask(taskId)?.granularStatus, 'READY');

    taskRegistry.transitionTask(taskId, 'RUNNING');
    // Simulate worker writing a new test file inside worktree
    const newTestFile = path.join(absPath, 'sample.test.js');
    fs.writeFileSync(newTestFile, 'console.log("mock test passed");');

    taskRegistry.transitionTask(taskId, 'COLLECTING');
    assert.equal(taskRegistry.getTask(taskId)?.granularStatus, 'COLLECTING');

    taskRegistry.transitionTask(taskId, 'VERIFYING');
    const verifyRes = await verificationEngine.verifyWorktree(absPath, ['node sample.test.js']);
    assert.equal(verifyRes.passed, true);

    taskRegistry.transitionTask(taskId, 'COMPLETED');
    assert.equal(taskRegistry.getTask(taskId)?.granularStatus, 'COMPLETED');

    await worktreeManager.removeWorktree(worktreeInfo.worktreeId);
  });

  await t.test('2. Task failure transition on verification test failure', async () => {
    const taskId = 'task-e2e-002';
    taskRegistry.registerTask({ taskId, repoPath: repoDir });
    taskRegistry.transitionTask(taskId, 'PREPARING');

    const worktreeInfo = await worktreeManager.createWorktree(taskId, { repoPath: repoDir, baseCommit: baseSha });
    const absPath = path.isAbsolute(worktreeInfo.path) ? worktreeInfo.path : path.resolve(repoDir, worktreeInfo.path);
    taskRegistry.transitionTask(taskId, 'RUNNING');
    taskRegistry.transitionTask(taskId, 'VERIFYING');

    const verifyRes = await verificationEngine.verifyWorktree(absPath, ['node non_existent.js']);
    assert.equal(verifyRes.passed, false);

    taskRegistry.transitionTask(taskId, 'FAILED_VERIFICATION');
    assert.equal(taskRegistry.getTask(taskId)?.granularStatus, 'FAILED_VERIFICATION');

    await worktreeManager.removeWorktree(worktreeInfo.worktreeId);
  });

  await t.test('3. Shell chaining operator restriction in VerificationEngine', async () => {
    const taskId = 'task-e2e-003';
    const worktreeInfo = await worktreeManager.createWorktree(taskId, { repoPath: repoDir, baseCommit: baseSha });
    const absPath = path.isAbsolute(worktreeInfo.path) ? worktreeInfo.path : path.resolve(repoDir, worktreeInfo.path);

    const verifyRes = await verificationEngine.verifyWorktree(absPath, ['echo hello && echo world'], {
      allowShellChaining: false,
    });

    assert.equal(verifyRes.passed, false);
    assert.ok(verifyRes.results[0].output.includes('Shell chaining operators'));

    await worktreeManager.removeWorktree(worktreeInfo.worktreeId);
  });

  // Cleanup temp test directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
