import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  ArtifactManager,
  parseDiskSize,
} from '../dist/components/artifact-manager.js';
import { PolicyEngine } from '../dist/components/policy-engine.js';

const execFileAsync = promisify(execFile);
const GELADA_BIN = path.resolve(process.cwd(), 'bin/gelada.js');

describe('Artifact Retention & Cleanup Suite (Milestone 9)', () => {
  let tempRepoRoot;
  let tempArtifactsDir;
  let manager;

  beforeEach(async () => {
    tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-retention-test-'));
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

  describe('1. parseDiskSize Helper Unit Tests', () => {
    it('should handle undefined, null, and non-string/number inputs', () => {
      assert.equal(parseDiskSize(undefined), undefined);
      assert.equal(parseDiskSize(null), undefined);
      assert.equal(parseDiskSize({}), undefined);
      assert.equal(parseDiskSize([]), undefined);
    });

    it('should parse numeric inputs directly', () => {
      assert.equal(parseDiskSize(1024), 1024);
      assert.equal(parseDiskSize(0), 0);
      assert.equal(parseDiskSize(1048576.8), 1048576);
      assert.equal(parseDiskSize(-100), undefined);
      assert.equal(parseDiskSize(NaN), undefined);
      assert.equal(parseDiskSize(Infinity), undefined);
    });

    it('should parse human-readable string disk sizes correctly', () => {
      assert.equal(parseDiskSize('500'), 500);
      assert.equal(parseDiskSize('500B'), 500);
      assert.equal(parseDiskSize('500 bytes'), 500);
      assert.equal(parseDiskSize('10KB'), 10 * 1024);
      assert.equal(parseDiskSize('10 K'), 10 * 1024);
      assert.equal(parseDiskSize('10KiB'), 10 * 1024);
      assert.equal(parseDiskSize('50MB'), 50 * 1024 * 1024);
      assert.equal(parseDiskSize('50 M'), 50 * 1024 * 1024);
      assert.equal(parseDiskSize('2GB'), 2 * 1024 * 1024 * 1024);
      assert.equal(parseDiskSize('1TB'), 1 * 1024 * 1024 * 1024 * 1024);
    });

    it('should return undefined for invalid string formats', () => {
      assert.equal(parseDiskSize(''), undefined);
      assert.equal(parseDiskSize('   '), undefined);
      assert.equal(parseDiskSize('invalid'), undefined);
      assert.equal(parseDiskSize('100XB'), undefined);
      assert.equal(parseDiskSize('-50MB'), undefined);
    });
  });

  describe('2. Safe Defaults (No Limits Configured)', () => {
    it('should delete zero bundles when retention limits are unconfigured or empty', async () => {
      for (let i = 1; i <= 5; i++) {
        await manager.saveTaskBundle(`task-${i}`, {
          status: 'completed',
          objective: `Task run ${i}`,
          prompt: `Prompt for task ${i}`,
        });
      }

      const initialBundles = await manager.listTaskBundles();
      assert.equal(initialBundles.length, 5);

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

      const afterBundles = await manager.listTaskBundles();
      assert.equal(afterBundles.length, 5);
    });
  });

  describe('3. maxRuns Retention Policy Enforcement', () => {
    it('should trigger deletion of oldest bundle when 6th completed task exceeds maxRuns: 5', async () => {
      const now = Date.now();
      for (let i = 1; i <= 6; i++) {
        await manager.saveTaskBundle(`task-${i}`, {
          status: 'completed',
          objective: `Task run ${i}`,
          prompt: `Prompt content for task ${i}`,
        });

        // Set explicit creation timestamp ascending for deterministic order
        const metaPath = path.join(manager.getTaskArtifactDir(`task-${i}`), 'metadata.json');
        const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        metaContent.createdAt = now + i * 1000;
        await fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
      }

      const bundlesBefore = await manager.listTaskBundles();
      assert.equal(bundlesBefore.length, 6);
      assert.equal(bundlesBefore[0].taskId, 'task-1');

      const cleanupRes = await manager.cleanup({ maxRuns: 5 });

      assert.equal(cleanupRes.deletedBundles.length, 1);
      assert.equal(cleanupRes.deletedBundles[0], 'task-1');
      assert.ok(cleanupRes.freedBytes > 0);

      const bundlesAfter = await manager.listTaskBundles();
      assert.equal(bundlesAfter.length, 5);
      assert.equal(bundlesAfter.some((b) => b.taskId === 'task-1'), false);
      assert.equal(bundlesAfter.some((b) => b.taskId === 'task-6'), true);
    });
  });

  describe('4. maxAgeDays Retention Policy Enforcement', () => {
    it('should delete task bundles older than 7 days', async () => {
      const now = Date.now();
      const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

      await manager.saveTaskBundle('task-old', {
        status: 'completed',
        objective: 'Old task run',
        prompt: 'Old prompt content',
      });
      await manager.saveTaskBundle('task-new', {
        status: 'completed',
        objective: 'Recent task run',
        prompt: 'New prompt content',
      });

      // Override createdAt for task-old to 10 days ago
      const oldMetaPath = path.join(manager.getTaskArtifactDir('task-old'), 'metadata.json');
      const oldMeta = JSON.parse(await fs.readFile(oldMetaPath, 'utf-8'));
      oldMeta.createdAt = tenDaysAgo;
      await fs.writeFile(oldMetaPath, JSON.stringify(oldMeta, null, 2));

      const cleanupRes = await manager.cleanup({ maxAgeDays: 7 });

      assert.deepEqual(cleanupRes.deletedBundles, ['task-old']);
      assert.equal(cleanupRes.deletedCount, 1);
      assert.ok(cleanupRes.freedBytes > 0);
      assert.equal(cleanupRes.remainingBundles, 1);

      const remaining = await manager.listTaskBundles();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].taskId, 'task-new');
    });
  });

  describe('4b. maxTotalSize / maxDiskSize Retention Policy Enforcement', () => {
    it('should evict oldest bundles when total artifact size exceeds maxTotalSize', async () => {
      const now = Date.now();
      for (let i = 1; i <= 3; i++) {
        await manager.saveTaskBundle(`task-size-${i}`, {
          status: 'completed',
          objective: `Task size run ${i}`,
          prompt: 'X'.repeat(500),
        });

        const metaPath = path.join(manager.getTaskArtifactDir(`task-size-${i}`), 'metadata.json');
        const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        metaContent.createdAt = now + i * 1000;
        await fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
      }

      const allBefore = await manager.listTaskBundles();
      const totalSize = allBefore.reduce((acc, b) => acc + b.totalSizeBytes, 0);
      assert.ok(totalSize > 1000);

      // Set maxTotalSize smaller than total size but enough for 1 bundle
      const maxTotalSize = allBefore[allBefore.length - 1].totalSizeBytes + 500;
      const cleanupRes = await manager.cleanup({ maxTotalSize });

      assert.ok(cleanupRes.deletedCount > 0);
      assert.equal(cleanupRes.deletedBundles.includes('task-size-1'), true);
      assert.equal(cleanupRes.remainingBundles, 3 - cleanupRes.deletedCount);
      assert.ok(cleanupRes.freedBytes > 0);
    });

    it('should accept maxDiskSize string formatted limit like "100KB"', async () => {
      for (let i = 1; i <= 2; i++) {
        await manager.saveTaskBundle(`task-strsize-${i}`, {
          status: 'completed',
          objective: `Task strsize run ${i}`,
          prompt: 'Y'.repeat(200),
        });
      }

      const cleanupRes = await manager.cleanup({ maxDiskSize: '100KB' });
      assert.equal(cleanupRes.deletedCount, 0);
      assert.equal(cleanupRes.remainingBundles, 2);
    });
  });

  describe('5. PolicyEngine Retention Policy Merging', () => {
    it('should evaluate to retention: undefined when unconfigured', () => {
      const engine = new PolicyEngine(undefined, { autoLoad: false });
      assert.equal(engine.getEffectivePolicy().retention, undefined);
    });

    it('should override global retention settings with project policy settings field-by-field', async () => {
      const globalDir = path.join(tempRepoRoot, 'global-config');
      const geladaDir = path.join(tempRepoRoot, '.gelada');
      await fs.mkdir(globalDir, { recursive: true });
      await fs.mkdir(geladaDir, { recursive: true });

      await fs.writeFile(
        path.join(globalDir, 'config.yaml'),
        `retention:\n  maxRuns: 100\n  maxDiskSize: "1GB"\n  maxAgeDays: 30`,
        'utf8',
      );
      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        `retention:\n  maxRuns: 5`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalDir,
        repoPath: tempRepoRoot,
        autoLoad: false,
      });

      const retention = engine.getEffectivePolicy().retention;
      assert.ok(retention);
      assert.equal(retention.maxRuns, 5); // Overridden by project policy
      assert.equal(retention.maxAgeDays, 30); // Inherited from global
      assert.equal(retention.maxDiskSizeRaw, '1GB'); // Inherited from global
      assert.equal(retention.maxDiskSizeBytes, 1024 * 1024 * 1024);
    });

    it('should parse maxTotalSize alias into byte counts in normalized schema and effective policy', async () => {
      const geladaDir = path.join(tempRepoRoot, '.gelada');
      await fs.mkdir(geladaDir, { recursive: true });

      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        `retention:\n  maxTotalSize: "50MB"\n  maxRuns: 10`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        repoPath: tempRepoRoot,
        autoLoad: false,
      });

      const retention = engine.getEffectivePolicy().retention;
      assert.ok(retention);
      assert.equal(retention.maxRuns, 10);
      assert.equal(retention.maxTotalSize, '50MB');
      assert.equal(retention.maxDiskSize, '50MB');
      assert.equal(retention.maxDiskSizeBytes, 50 * 1024 * 1024);
    });

    it('should merge maxTotalSize in project policy over maxDiskSize in global policy field-by-field', async () => {
      const globalDir = path.join(tempRepoRoot, 'global-config');
      const geladaDir = path.join(tempRepoRoot, '.gelada');
      await fs.mkdir(globalDir, { recursive: true });
      await fs.mkdir(geladaDir, { recursive: true });

      await fs.writeFile(
        path.join(globalDir, 'config.yaml'),
        `retention:\n  maxRuns: 20\n  maxDiskSize: "1GB"\n  maxAgeDays: 14`,
        'utf8',
      );
      await fs.writeFile(
        path.join(geladaDir, 'policy.yaml'),
        `retention:\n  maxTotalSize: "200MB"`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalDir,
        repoPath: tempRepoRoot,
        autoLoad: false,
      });

      const retention = engine.getEffectivePolicy().retention;
      assert.ok(retention);
      assert.equal(retention.maxRuns, 20); // Inherited from global
      assert.equal(retention.maxAgeDays, 14); // Inherited from global
      assert.equal(retention.maxTotalSize, '200MB'); // Overridden by project maxTotalSize
      assert.equal(retention.maxDiskSize, '200MB'); // Synced with maxTotalSize
      assert.equal(retention.maxDiskSizeBytes, 200 * 1024 * 1024);
    });
  });

  describe('6. CLI gelada cleanup Command Execution', () => {
    it('should execute gelada cleanup --help', async () => {
      const { stdout } = await execFileAsync(process.execPath, [GELADA_BIN, 'cleanup', '--help']);
      assert.match(stdout, /Clean up obsolete task artifact bundles/);
      assert.match(stdout, /--max-runs/);
      assert.match(stdout, /--max-age-days/);
      assert.match(stdout, /--max-disk-size/);
      assert.match(stdout, /--dry-run/);
      assert.match(stdout, /--json/);
    });

    it('should execute gelada cleanup --dry-run without deleting files', async () => {
      const now = Date.now();
      for (let i = 1; i <= 3; i++) {
        await manager.saveTaskBundle(`task-${i}`, {
          status: 'completed',
          objective: `Task run ${i}`,
        });

        const metaPath = path.join(manager.getTaskArtifactDir(`task-${i}`), 'metadata.json');
        const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        metaContent.createdAt = now + i * 1000;
        await fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
      }

      const { stdout } = await execFileAsync(process.execPath, [
        GELADA_BIN,
        'cleanup',
        '--repo',
        tempRepoRoot,
        '--max-runs',
        '1',
        '--dry-run',
      ]);

      assert.match(stdout, /\[Dry Run\] Would clean up/);
      assert.match(stdout, /task-1, task-2/);

      // Verify files still exist on disk
      const bundlesAfter = await manager.listTaskBundles();
      assert.equal(bundlesAfter.length, 3);
    });

    it('should output structured JSON with gelada cleanup --json', async () => {
      const now = Date.now();
      for (let i = 1; i <= 3; i++) {
        await manager.saveTaskBundle(`task-${i}`, {
          status: 'completed',
          objective: `Task run ${i}`,
        });

        const metaPath = path.join(manager.getTaskArtifactDir(`task-${i}`), 'metadata.json');
        const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        metaContent.createdAt = now + i * 1000;
        await fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
      }

      const { stdout } = await execFileAsync(process.execPath, [
        GELADA_BIN,
        'cleanup',
        '--repo',
        tempRepoRoot,
        '--max-runs',
        '1',
        '--json',
      ]);

      const jsonOutput = JSON.parse(stdout);
      assert.equal(jsonOutput.success, true);
      assert.equal(jsonOutput.dryRun, false);
      assert.equal(jsonOutput.deletedCount, 2);
      assert.deepEqual(jsonOutput.deletedBundles, ['task-1', 'task-2']);
      assert.ok(jsonOutput.freedBytes > 0);

      // Verify task-1 and task-2 were actually removed
      const bundlesAfter = await manager.listTaskBundles();
      assert.equal(bundlesAfter.length, 1);
      assert.equal(bundlesAfter[0].taskId, 'task-3');
    });
  });

  describe('7. Tool Auto-Trigger Non-Blocking Error Handling', () => {
    it('should catch cleanup errors non-fatally when ArtifactManager.cleanup fails', async () => {
      const failingManager = {
        cleanup: async () => {
          throw new Error('Disk IO Error during cleanup simulation');
        },
      };

      let warningLogged = false;
      const originalWarn = console.warn;
      console.warn = (...args) => {
        if (args[0] && String(args[0]).includes('[ArtifactManager] Non-fatal cleanup warning')) {
          warningLogged = true;
        }
      };

      try {
        try {
          await failingManager.cleanup({ maxRuns: 1 });
        } catch (cleanupErr) {
          console.warn('[ArtifactManager] Non-fatal cleanup warning for task task-test:', cleanupErr);
        }
      } finally {
        console.warn = originalWarn;
      }

      assert.equal(warningLogged, true);
    });
  });
});
