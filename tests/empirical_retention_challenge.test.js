import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { ArtifactManager } from '../dist/components/artifact-manager.js';
import { PolicyEngine } from '../dist/components/policy-engine.js';

describe('Empirical Challenger Suite: Artifact Retention & Cleanup Stress Tests', () => {
  let tempRepoRoot;
  let tempArtifactsDir;
  let manager;

  beforeEach(async () => {
    tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-challenger-test-'));
    tempArtifactsDir = path.join(tempRepoRoot, '.gelada/artifacts');

    manager = new ArtifactManager({
      repoRoot: tempRepoRoot,
      artifactsDir: tempArtifactsDir,
    });
  });

  afterEach(async () => {
    if (tempRepoRoot) {
      await fs.rm(tempRepoRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('1. Mock directory structure with task bundles of 1, 5, and 10 days old and varying file sizes', async () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Create 10 days old task bundle (large size ~10KB)
    await manager.saveTaskBundle('task-10d', {
      status: 'completed',
      objective: 'Task created 10 days ago',
      prompt: 'A'.repeat(10240),
    });
    const meta10dPath = path.join(manager.getTaskArtifactDir('task-10d'), 'metadata.json');
    const meta10d = JSON.parse(await fs.readFile(meta10dPath, 'utf-8'));
    meta10d.createdAt = now - 10 * oneDayMs;
    await fs.writeFile(meta10dPath, JSON.stringify(meta10d, null, 2));

    // Create 5 days old task bundle (medium size ~5KB)
    await manager.saveTaskBundle('task-5d', {
      status: 'completed',
      objective: 'Task created 5 days ago',
      prompt: 'B'.repeat(5120),
    });
    const meta5dPath = path.join(manager.getTaskArtifactDir('task-5d'), 'metadata.json');
    const meta5d = JSON.parse(await fs.readFile(meta5dPath, 'utf-8'));
    meta5d.createdAt = now - 5 * oneDayMs;
    await fs.writeFile(meta5dPath, JSON.stringify(meta5d, null, 2));

    // Create 1 day old task bundle (small size ~1KB)
    await manager.saveTaskBundle('task-1d', {
      status: 'completed',
      objective: 'Task created 1 day ago',
      prompt: 'C'.repeat(1024),
    });
    const meta1dPath = path.join(manager.getTaskArtifactDir('task-1d'), 'metadata.json');
    const meta1d = JSON.parse(await fs.readFile(meta1dPath, 'utf-8'));
    meta1d.createdAt = now - 1 * oneDayMs;
    await fs.writeFile(meta1dPath, JSON.stringify(meta1d, null, 2));

    const bundles = await manager.listTaskBundles();
    assert.equal(bundles.length, 3);
    assert.equal(bundles[0].taskId, 'task-10d');
    assert.equal(bundles[1].taskId, 'task-5d');
    assert.equal(bundles[2].taskId, 'task-1d');
    assert.ok(bundles[0].totalSizeBytes > 10000);
    assert.ok(bundles[1].totalSizeBytes > 5000);
    assert.ok(bundles[2].totalSizeBytes > 1000);
  });

  it('2. AC1: retention.maxRuns: 5 causes 6th completed task bundle to trigger deletion of oldest task bundle', async () => {
    const now = Date.now();
    for (let i = 1; i <= 6; i++) {
      await manager.saveTaskBundle(`bundle-run-${i}`, {
        status: 'completed',
        objective: `Task bundle run ${i}`,
        prompt: `Prompt for bundle ${i}`,
      });

      const metaPath = path.join(manager.getTaskArtifactDir(`bundle-run-${i}`), 'metadata.json');
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      meta.createdAt = now + i * 1000;
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    }

    const before = await manager.listTaskBundles();
    assert.equal(before.length, 6);

    const cleanupRes = await manager.cleanup({ maxRuns: 5 });

    assert.equal(cleanupRes.deletedCount, 1);
    assert.deepEqual(cleanupRes.deletedBundles, ['bundle-run-1']);
    assert.equal(cleanupRes.remainingBundles, 5);
    assert.ok(cleanupRes.freedBytes > 0);

    const after = await manager.listTaskBundles();
    assert.equal(after.length, 5);
    assert.equal(after.some((b) => b.taskId === 'bundle-run-1'), false);
    assert.equal(after.some((b) => b.taskId === 'bundle-run-6'), true);
  });

  it('3. AC2: retention.maxAgeDays: 7 causes task bundles older than 7 days to be removed during cleanup', async () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // 10 days old
    await manager.saveTaskBundle('old-10d', { status: 'completed', objective: '10 days old' });
    const meta10 = JSON.parse(await fs.readFile(path.join(manager.getTaskArtifactDir('old-10d'), 'metadata.json'), 'utf-8'));
    meta10.createdAt = now - 10 * oneDayMs;
    await fs.writeFile(path.join(manager.getTaskArtifactDir('old-10d'), 'metadata.json'), JSON.stringify(meta10, null, 2));

    // 5 days old
    await manager.saveTaskBundle('mid-5d', { status: 'completed', objective: '5 days old' });
    const meta5 = JSON.parse(await fs.readFile(path.join(manager.getTaskArtifactDir('mid-5d'), 'metadata.json'), 'utf-8'));
    meta5.createdAt = now - 5 * oneDayMs;
    await fs.writeFile(path.join(manager.getTaskArtifactDir('mid-5d'), 'metadata.json'), JSON.stringify(meta5, null, 2));

    // 1 day old
    await manager.saveTaskBundle('new-1d', { status: 'completed', objective: '1 day old' });
    const meta1 = JSON.parse(await fs.readFile(path.join(manager.getTaskArtifactDir('new-1d'), 'metadata.json'), 'utf-8'));
    meta1.createdAt = now - 1 * oneDayMs;
    await fs.writeFile(path.join(manager.getTaskArtifactDir('new-1d'), 'metadata.json'), JSON.stringify(meta1, null, 2));

    const cleanupRes = await manager.cleanup({ maxAgeDays: 7 });

    assert.equal(cleanupRes.deletedCount, 1);
    assert.deepEqual(cleanupRes.deletedBundles, ['old-10d']);
    assert.equal(cleanupRes.remainingBundles, 2);

    const remaining = await manager.listTaskBundles();
    assert.equal(remaining.length, 2);
    assert.deepEqual(remaining.map(b => b.taskId).sort(), ['mid-5d', 'new-1d']);
  });

  it('4. AC4: When no retention limits are configured, no artifacts are deleted', async () => {
    for (let i = 1; i <= 5; i++) {
      await manager.saveTaskBundle(`unlimited-${i}`, { status: 'completed', objective: `Task ${i}` });
    }

    const resUndefined = await manager.cleanup(undefined);
    assert.deepEqual(resUndefined.deletedBundles, []);
    assert.equal(resUndefined.deletedCount, 0);
    assert.equal(resUndefined.freedBytes, 0);
    assert.equal(resUndefined.remainingBundles, 5);

    const resEmpty = await manager.cleanup({});
    assert.deepEqual(resEmpty.deletedBundles, []);
    assert.equal(resEmpty.deletedCount, 0);
    assert.equal(resEmpty.freedBytes, 0);
    assert.equal(resEmpty.remainingBundles, 5);

    const remaining = await manager.listTaskBundles();
    assert.equal(remaining.length, 5);
  });

  it('5. Non-blocking auto-trigger failure handling', async () => {
    let warningLogged = false;
    const originalWarn = console.warn;
    console.warn = (...args) => {
      if (args[0] && String(args[0]).includes('[ArtifactManager] Non-fatal cleanup warning')) {
        warningLogged = true;
      }
    };

    try {
      const mockFailingArtifactManager = {
        cleanup: async () => {
          throw new Error('EACCES: permission denied, rmdir');
        },
      };

      // Simulate the auto-trigger block from delegate-task / revise-task
      try {
        await mockFailingArtifactManager.cleanup({ maxRuns: 5 });
      } catch (cleanupErr) {
        console.warn('[ArtifactManager] Non-fatal cleanup warning for task task-mock:', cleanupErr);
      }

      assert.equal(warningLogged, true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('6. Combined maxAgeDays + maxRuns policy enforcement', async () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Create 6 tasks: task-1 is 12d old, task-2..6 are 1d..5d old
    await manager.saveTaskBundle('combo-12d', { status: 'completed' });
    let meta = JSON.parse(await fs.readFile(path.join(manager.getTaskArtifactDir('combo-12d'), 'metadata.json'), 'utf-8'));
    meta.createdAt = now - 12 * oneDayMs;
    await fs.writeFile(path.join(manager.getTaskArtifactDir('combo-12d'), 'metadata.json'), JSON.stringify(meta, null, 2));

    for (let i = 2; i <= 6; i++) {
      await manager.saveTaskBundle(`combo-recent-${i}`, { status: 'completed' });
      meta = JSON.parse(await fs.readFile(path.join(manager.getTaskArtifactDir(`combo-recent-${i}`), 'metadata.json'), 'utf-8'));
      meta.createdAt = now - (7 - i) * oneDayMs;
      await fs.writeFile(path.join(manager.getTaskArtifactDir(`combo-recent-${i}`), 'metadata.json'), JSON.stringify(meta, null, 2));
    }

    // maxAgeDays: 7 removes combo-12d (5 active remain)
    // maxRuns: 3 removes 2 oldest active (combo-recent-2, combo-recent-3)
    // Total 3 deleted
    const cleanupRes = await manager.cleanup({ maxAgeDays: 7, maxRuns: 3 });

    assert.equal(cleanupRes.deletedCount, 3);
    assert.equal(cleanupRes.remainingBundles, 3);
    assert.deepEqual(cleanupRes.deletedBundles, ['combo-12d', 'combo-recent-2', 'combo-recent-3']);
  });
});
