import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { ArtifactManager } from '../dist/components/artifact-manager.js';

describe('Milestone 3 Challenger - Empirical Disk Size & Multi-Limit Stress Tests', () => {
  let tempRepoRoot;
  let tempArtifactsDir;
  let manager;

  beforeEach(async () => {
    tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-m3-challenger-'));
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

  it('Scenario 1: 3 bundles of 5MB each (15MB total) with maxTotalSize: "10MB"', async () => {
    const now = Date.now();
    const MB_5 = 5 * 1024 * 1024;
    const dummyData = Buffer.alloc(MB_5, 'a');

    // Create 3 bundles of 5MB each
    for (let i = 1; i <= 3; i++) {
      const taskId = `task-5mb-${i}`;
      await manager.saveTaskBundle(taskId, {
        status: 'completed',
        objective: `5MB Task ${i}`,
        prompt: dummyData.toString('utf-8', 0, 100), // Prompt header
      });

      // Save a large payload artifact to reach ~5MB
      await manager.saveArtifact('payload', dummyData, {
        taskId,
        filename: 'payload.bin',
        contentType: 'application/octet-stream',
      });

      // Set timestamp explicitly
      const metaPath = path.join(manager.getTaskArtifactDir(taskId), 'metadata.json');
      const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      metaContent.createdAt = now + i * 1000;
      await fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
    }

    const initialBundles = await manager.listTaskBundles();
    assert.equal(initialBundles.length, 3);
    const totalBytesBefore = initialBundles.reduce((sum, b) => sum + b.totalSizeBytes, 0);
    assert.ok(totalBytesBefore >= 15 * 1024 * 1024, `Total bytes before (${totalBytesBefore}) should be >= 15MB`);

    // Cleanup with maxTotalSize: "10MB" (10,485,760 bytes)
    const cleanupRes = await manager.cleanup({ maxTotalSize: '10MB' });

    // Since each bundle is slightly over 5MB, 1 bundle left = ~5MB <= 10MB. 2 bundles evicted.
    assert.equal(cleanupRes.deletedCount, 2, 'Should delete 2 bundles to drop below 10MB');
    assert.deepEqual(cleanupRes.deletedBundles, ['task-5mb-1', 'task-5mb-2']);
    assert.equal(cleanupRes.remainingBundles, 1);
    assert.ok(cleanupRes.freedBytes >= 10 * 1024 * 1024);

    const remainingBundles = await manager.listTaskBundles();
    assert.equal(remainingBundles.length, 1);
    assert.equal(remainingBundles[0].taskId, 'task-5mb-3');
    assert.ok(remainingBundles[0].totalSizeBytes <= 10 * 1024 * 1024);
  });

  it('Scenario 1b: 3 bundles of 5MB with maxTotalSize: "11MB" evicts only 1 bundle', async () => {
    const now = Date.now();
    const MB_5 = 5 * 1024 * 1024;
    const dummyData = Buffer.alloc(MB_5, 'b');

    for (let i = 1; i <= 3; i++) {
      const taskId = `task-5mb-${i}`;
      await manager.saveTaskBundle(taskId, {
        status: 'completed',
        objective: `5MB Task ${i}`,
      });
      await manager.saveArtifact('payload', dummyData, {
        taskId,
        filename: 'payload.bin',
      });

      const metaPath = path.join(manager.getTaskArtifactDir(taskId), 'metadata.json');
      const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      metaContent.createdAt = now + i * 1000;
      await fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
    }

    // Set maxTotalSize: 11 * 1024 * 1024 = 11534336 bytes
    // Total of 3 bundles = 15.72MB.
    // Evicting task-5mb-1 leaves task-5mb-2 + task-5mb-3 = ~10.48MB <= 11MB.
    const cleanupRes = await manager.cleanup({ maxTotalSize: 11 * 1024 * 1024 });

    assert.equal(cleanupRes.deletedCount, 1, 'Should delete only 1 bundle when limit is 11MB');
    assert.deepEqual(cleanupRes.deletedBundles, ['task-5mb-1']);
    assert.equal(cleanupRes.remainingBundles, 2);

    const remaining = await manager.listTaskBundles();
    assert.equal(remaining.length, 2);
    assert.equal(remaining[0].taskId, 'task-5mb-2');
    assert.equal(remaining[1].taskId, 'task-5mb-3');
  });

  it('Scenario 2: Multi-limit retention combination (maxRuns: 10 AND maxTotalSize: "5MB" AND maxAgeDays: 3)', async () => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MB_1 = 1024 * 1024;
    const dummyData = Buffer.alloc(MB_1, 'c');

    // Create 15 task bundles:
    // Bundles 1..3: 10 days old, 1MB each
    // Bundles 4..15: 1 day old, 1MB each
    for (let i = 1; i <= 15; i++) {
      const taskId = `task-multi-${i}`;
      await manager.saveTaskBundle(taskId, {
        status: 'completed',
        objective: `Multi Task ${i}`,
      });
      await manager.saveArtifact('payload', dummyData, {
        taskId,
        filename: 'payload.bin',
      });

      const metaPath = path.join(manager.getTaskArtifactDir(taskId), 'metadata.json');
      const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      if (i <= 3) {
        metaContent.createdAt = now - 10 * DAY_MS + i * 1000; // 10 days old
      } else {
        metaContent.createdAt = now - 1 * DAY_MS + i * 1000;  // 1 day old
      }
      await fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
    }

    const allBefore = await manager.listTaskBundles();
    assert.equal(allBefore.length, 15);

    // Multi-limit policy: maxRuns: 10, maxTotalSize: "5MB", maxAgeDays: 3
    const cleanupRes = await manager.cleanup({
      maxRuns: 10,
      maxTotalSize: '5MB',
      maxAgeDays: 3,
    });

    // Every limit applies, oldest first:
    //  - maxAgeDays (3) removes bundles 1..3
    //  - maxRuns (10) removes the next oldest until 10 remain
    //  - maxTotalSize (5MB) keeps removing until the total fits
    //
    // The exact count depends on per-bundle metadata overhead, so assert the
    // invariants rather than a byte-perfect number: deletion is oldest-first,
    // no limit is left violated, and nothing newer is dropped before something
    // older.
    const remaining = await manager.listTaskBundles();
    const remainingIds = remaining.map((b) => b.taskId);
    const indexOf = (id) => Number(id.replace('task-multi-', ''));

    assert.equal(cleanupRes.deletedCount + remaining.length, 15);
    assert.equal(cleanupRes.remainingBundles, remaining.length);

    // Oldest-first: the deleted set is a prefix of the age-ordered bundles.
    const deletedIdx = cleanupRes.deletedBundles.map(indexOf);
    assert.deepEqual(
      deletedIdx,
      [...deletedIdx].sort((a, b) => a - b),
      'bundles must be deleted oldest first',
    );
    assert.ok(
      Math.max(...deletedIdx) < Math.min(...remainingIds.map(indexOf)),
      'no surviving bundle may be older than a deleted one',
    );

    // All three limits hold afterwards.
    assert.ok(remaining.length <= 10, `maxRuns violated: ${remaining.length} bundles left`);
    assert.ok(
      remainingIds.every((id) => indexOf(id) > 3),
      'bundles older than maxAgeDays must be gone',
    );
    const totalSize = remaining.reduce((sum, b) => sum + (b.totalSizeBytes ?? b.sizeBytes ?? 0), 0);
    assert.ok(
      totalSize <= 5 * 1024 * 1024,
      `maxTotalSize violated: ${totalSize} bytes left`,
    );
  });

  it('Scenario 3: Dry-run execution with maxTotalSize', async () => {
    const now = Date.now();
    const MB_5 = 5 * 1024 * 1024;
    const dummyData = Buffer.alloc(MB_5, 'd');

    for (let i = 1; i <= 3; i++) {
      const taskId = `task-dry-${i}`;
      await manager.saveTaskBundle(taskId, { status: 'completed' });
      await manager.saveArtifact('payload', dummyData, { taskId, filename: 'payload.bin' });

      const metaPath = path.join(manager.getTaskArtifactDir(taskId), 'metadata.json');
      const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      metaContent.createdAt = now + i * 1000;
      await fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
    }

    const dryRunRes = await manager.cleanup({ maxTotalSize: '10MB' }, { dryRun: true });

    assert.equal(dryRunRes.deletedCount, 2);
    assert.deepEqual(dryRunRes.deletedBundles, ['task-dry-1', 'task-dry-2']);
    assert.equal(dryRunRes.remainingBundles, 1);

    // Verify all 3 bundles still exist on disk
    const diskBundles = await manager.listTaskBundles();
    assert.equal(diskBundles.length, 3);
  });

  it('Scenario 4: Single giant bundle exceeding maxTotalSize', async () => {
    const MB_12 = 12 * 1024 * 1024;
    const dummyData = Buffer.alloc(MB_12, 'e');

    await manager.saveTaskBundle('task-giant', { status: 'completed' });
    await manager.saveArtifact('payload', dummyData, { taskId: 'task-giant', filename: 'payload.bin' });

    const cleanupRes = await manager.cleanup({ maxTotalSize: '10MB' });

    assert.equal(cleanupRes.deletedCount, 1);
    assert.deepEqual(cleanupRes.deletedBundles, ['task-giant']);
    assert.equal(cleanupRes.remainingBundles, 0);

    const remaining = await manager.listTaskBundles();
    assert.equal(remaining.length, 0);
  });

  it('Scenario 5: Precedence between maxTotalSize and maxDiskSize', async () => {
    const MB_2 = 2 * 1024 * 1024;
    const dummyData = Buffer.alloc(MB_2, 'f');

    for (let i = 1; i <= 3; i++) {
      await manager.saveTaskBundle(`task-prec-${i}`, { status: 'completed' });
      await manager.saveArtifact('payload', dummyData, { taskId: `task-prec-${i}`, filename: 'payload.bin' });
    }

    // maxTotalSize is 3MB, maxDiskSize is 100MB. Code evaluates policy.maxTotalSize ?? policy.maxDiskSize.
    const cleanupRes = await manager.cleanup({ maxTotalSize: '3MB', maxDiskSize: '100MB' });

    // Should use 3MB limit (maxTotalSize), deleting 2 of the 3 2MB bundles.
    assert.equal(cleanupRes.deletedCount, 2);
    assert.equal(cleanupRes.remainingBundles, 1);
  });
});
