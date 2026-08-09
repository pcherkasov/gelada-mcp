import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  ArtifactManager,
  ArtifactError,
} from '../dist/components/artifact-manager.js';

describe('ArtifactManager Unit Tests', () => {
  let tempRepoRoot;
  let tempArtifactsDir;
  let manager;

  beforeEach(async () => {
    tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-art-repo-'));
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

  describe('1. Persistent Disk Storage & Lifecycle', () => {
    it('should save string artifact to disk and retrieve it', async () => {
      const meta = await manager.saveArtifact('art-string', 'Hello, Gelada MCP!');

      assert.equal(meta.artifactId, 'art-string');
      assert.ok(meta.path.startsWith(tempArtifactsDir));
      assert.equal(meta.sizeBytes, Buffer.byteLength('Hello, Gelada MCP!'));

      const diskContent = await fs.readFile(meta.path, 'utf-8');
      assert.equal(diskContent, 'Hello, Gelada MCP!');

      const retrieved = await manager.getArtifact('art-string');
      assert.equal(retrieved, 'Hello, Gelada MCP!');
    });

    it('should save JSON object artifact to disk and retrieve it', async () => {
      const payload = { key: 'value', number: 42, active: true };
      const meta = await manager.saveArtifact('art-json', payload);

      assert.equal(meta.contentType, 'application/json');

      const retrieved = await manager.getArtifact('art-json');
      assert.ok(retrieved !== null);
      const parsed = JSON.parse(retrieved);
      assert.deepEqual(parsed, payload);
    });

    it('should save Buffer content to disk', async () => {
      const buffer = Buffer.from('Binary data content');
      const meta = await manager.saveArtifact('art-buf', buffer);

      assert.equal(meta.contentType, 'application/octet-stream');
      const retrieved = await manager.getArtifact('art-buf');
      assert.equal(retrieved, 'Binary data content');
    });

    it('should persist artifacts across manager re-instantiation', async () => {
      await manager.saveArtifact('art-persistent', 'Persistent value across restarts');

      const manager2 = new ArtifactManager({
        repoRoot: tempRepoRoot,
        artifactsDir: tempArtifactsDir,
      });

      const retrieved = await manager2.getArtifact('art-persistent');
      assert.equal(retrieved, 'Persistent value across restarts');
    });
  });

  describe('2. Task Bundle Persistence', () => {
    it('should save complete task bundle to disk under .gelada/artifacts/<taskId>/', async () => {
      const taskId = 'task-2026-abc';
      const bundle = {
        taskContract: { objective: 'Fix bug in auth' },
        prompt: 'You are an agent assigned to fix auth bug.',
        patch: 'diff --git a/auth.js b/auth.js\n+fixed',
        workerStdout: 'Worker output line 1\nWorker output line 2\n',
        workerStderr: '',
        verificationResults: { passed: true, testsRun: 5 },
        executionSummary: { result: 'SUCCESS' },
        status: 'completed',
        taskType: 'bugfix',
        objective: 'Fix bug in auth',
      };

      const taskMeta = await manager.saveTaskBundle(taskId, bundle);

      assert.equal(taskMeta.taskId, taskId);
      assert.equal(taskMeta.status, 'completed');
      assert.equal(taskMeta.taskType, 'bugfix');
      assert.ok(taskMeta.totalSizeBytes > 0);
      assert.ok(taskMeta.artifacts.length >= 7);

      const taskDir = manager.getTaskArtifactDir(taskId);
      const stat = await fs.stat(taskDir);
      assert.equal(stat.isDirectory(), true);

      const contractStr = await manager.getArtifact('task_contract', taskId);
      assert.ok(contractStr !== null);
      assert.deepEqual(JSON.parse(contractStr), { objective: 'Fix bug in auth' });

      const promptStr = await manager.getArtifact('prompt', taskId);
      assert.equal(promptStr, 'You are an agent assigned to fix auth bug.');

      const patchStr = await manager.getArtifact('patch', taskId);
      assert.ok(patchStr.includes('diff --git'));
    });
  });

  describe('3. Listing, Filtering & Metadata', () => {
    it('should list all artifacts across generic and task subdirectories', async () => {
      await manager.saveArtifact('gen-1', 'generic 1');
      await manager.saveArtifact('task-1-art', 'task 1 content', { taskId: 'task-1' });
      await manager.saveArtifact('task-2-art', 'task 2 content', { taskId: 'task-2' });

      const all = await manager.listArtifacts();
      assert.ok(all.length >= 3);

      const task1Only = await manager.listArtifacts('task-1');
      assert.equal(task1Only.length, 1);
      assert.equal(task1Only[0].artifactId, 'task-1-art');
    });

    it('should return accurate ArtifactMeta from getArtifactMeta', async () => {
      await manager.saveArtifact('art-meta-test', 'content metadata test', { taskId: 'task-meta' });

      const meta = await manager.getArtifactMeta('art-meta-test', 'task-meta');
      assert.ok(meta !== null);
      assert.equal(meta.artifactId, 'art-meta-test');
      assert.equal(meta.taskId, 'task-meta');
      assert.equal(meta.sizeBytes, Buffer.byteLength('content metadata test'));
    });
  });

  describe('4. Deletion Operations', () => {
    it('should delete a single artifact file and sidecar metadata', async () => {
      await manager.saveArtifact('to-delete', 'delete me', { taskId: 'task-del' });

      const deleted = await manager.deleteArtifact('to-delete', 'task-del');
      assert.equal(deleted, true);

      const retrieved = await manager.getArtifact('to-delete', 'task-del');
      assert.equal(retrieved, null);

      const repeatDelete = await manager.deleteArtifact('to-delete', 'task-del');
      assert.equal(repeatDelete, false);
    });

    it('should delete entire task artifact directory', async () => {
      await manager.saveTaskBundle('task-to-remove', {
        prompt: 'prompt text',
        workerStdout: 'stdout text',
      });

      const deleted = await manager.deleteArtifacts('task-to-remove');
      assert.equal(deleted, true);

      const taskDir = manager.getTaskArtifactDir('task-to-remove');
      await assert.rejects(async () => {
        await fs.stat(taskDir);
      });

      const repeatDelete = await manager.deleteArtifacts('task-to-remove');
      assert.equal(repeatDelete, false);
    });
  });

  describe('5. Path Traversal Protection & Input Validation', () => {
    it('should reject path traversal in artifactId', async () => {
      await assert.rejects(
        async () => {
          await manager.saveArtifact('../../etc/passwd', 'malicious content');
        },
        (err) => err instanceof ArtifactError && err.code === 'PATH_TRAVERSAL',
      );
    });

    it('should reject path traversal in taskId', async () => {
      await assert.rejects(
        async () => {
          await manager.saveArtifact('normal-art', 'content', { taskId: '../dangerous' });
        },
        (err) => err instanceof ArtifactError && err.code === 'PATH_TRAVERSAL',
      );

      assert.throws(
        () => manager.getTaskArtifactDir('../dangerous'),
        (err) => err instanceof ArtifactError && err.code === 'PATH_TRAVERSAL',
      );
    });

    it('should reject null or non-string inputs with INVALID_INPUT', async () => {
      await assert.rejects(
        async () => {
          await manager.saveArtifact(null, 'content');
        },
        (err) => err instanceof ArtifactError && err.code === 'INVALID_INPUT',
      );

      await assert.rejects(
        async () => {
          await manager.saveArtifact('', 'content');
        },
        (err) => err instanceof ArtifactError && err.code === 'INVALID_INPUT',
      );
    });
  });

  describe('6. Resilience Against Missing & Corrupted Files', () => {
    it('should return null when retrieving non-existent artifact', async () => {
      const res = await manager.getArtifact('missing-art-id');
      assert.equal(res, null);
    });

    it('should handle corrupted sidecar .meta.json file gracefully', async () => {
      const meta = await manager.saveArtifact('art-corrupt', 'some content');

      // Overwrite sidecar meta with invalid JSON
      await fs.writeFile(`${meta.path}.meta.json`, '{ invalid json syntax ');

      // Should still be able to list artifacts and read artifact content without crashing
      const retrieved = await manager.getArtifact('art-corrupt');
      assert.equal(retrieved, 'some content');

      const all = await manager.listArtifacts();
      assert.ok(all.some((a) => a.artifactId === 'art-corrupt'));
    });
  });

  describe('7. Hardened Security & Edge Cases', () => {
    it('should reject or ignore sidecar metadata pointing outside artifactsDir (path poisoning)', async () => {
      const secretPath = path.join(tempRepoRoot, 'secret.txt');
      await fs.writeFile(secretPath, 'CONFIDENTIAL');

      const taskDir = manager.getTaskArtifactDir('task-poison');
      await fs.mkdir(taskDir, { recursive: true });

      const poisonMetaPath = path.join(taskDir, 'poison.meta.json');
      await fs.writeFile(
        poisonMetaPath,
        JSON.stringify({
          artifactId: 'target-artifact',
          path: secretPath,
        }),
      );

      const res = await manager.getArtifact('target-artifact', 'task-poison');
      assert.equal(res, null);
    });

    it('should reject filename escape attempts such as options.filename = ".."', async () => {
      await assert.rejects(
        async () => {
          await manager.saveArtifact('art-escape', 'data', { filename: '..' });
        },
        (err) => err instanceof ArtifactError,
      );

      await assert.rejects(
        async () => {
          await manager.saveArtifact('art-escape-2', 'data', { filename: '../../passwd' });
        },
        (err) => err instanceof ArtifactError,
      );
    });

    it('should reject deleteArtifacts(".") to prevent total artifactsDir deletion', async () => {
      await manager.saveArtifact('keep-me', 'valuable artifact');

      await assert.rejects(
        async () => {
          await manager.deleteArtifacts('.');
        },
        (err) => err instanceof ArtifactError && err.code === 'INVALID_INPUT',
      );

      const retrieved = await manager.getArtifact('keep-me');
      assert.equal(retrieved, 'valuable artifact');
    });

    it('should enforce path boundary validation against sibling directory matching prefix', async () => {
      const siblingDir = `${tempArtifactsDir}-sibling`;
      await fs.mkdir(siblingDir, { recursive: true });
      const siblingFile = path.join(siblingDir, 'secret.txt');
      await fs.writeFile(siblingFile, 'sibling data');

      assert.throws(
        () => manager.getTaskArtifactDir('../.gelada/artifacts-sibling'),
        (err) => err instanceof ArtifactError && err.code === 'PATH_TRAVERSAL',
      );
    });

    it('should handle raw primitive JSON sidecars (e.g. 123 or "str") without outputting NaN sizes', async () => {
      const taskDir = manager.getTaskArtifactDir('task-primitive');
      await fs.mkdir(taskDir, { recursive: true });

      const primaryFile = path.join(taskDir, 'art1.txt');
      await fs.writeFile(primaryFile, 'some text content');

      await fs.writeFile(`${primaryFile}.meta.json`, '123');

      const items = await manager.listArtifacts('task-primitive');
      assert.equal(items.length, 1);
      assert.equal(typeof items[0].sizeBytes, 'number');
      assert.ok(!Number.isNaN(items[0].sizeBytes));
    });

    it('should filter out sidecar metadata pointing outside artifactsDir in listArtifacts()', async () => {
      const secretPath = path.join(tempRepoRoot, 'secret.txt');
      await fs.writeFile(secretPath, 'CONFIDENTIAL');

      const taskDir = manager.getTaskArtifactDir('task-poison-list');
      await fs.mkdir(taskDir, { recursive: true });

      await fs.writeFile(path.join(taskDir, 'art.txt'), 'content');
      await fs.writeFile(
        path.join(taskDir, 'art.txt.meta.json'),
        JSON.stringify({
          artifactId: 'poisoned-art',
          path: secretPath,
        }),
      );

      const items = await manager.listArtifacts('task-poison-list');
      for (const item of items) {
        assert.ok(
          item.path.startsWith(tempArtifactsDir),
          `Item path ${item.path} is outside artifactsDir ${tempArtifactsDir}`
        );
      }
    });

    it('should handle malformed non-ArtifactMeta JSON object sidecars (e.g. {}) without NaN sizeBytes', async () => {
      const taskDir = manager.getTaskArtifactDir('task-empty-object-sidecar');
      await fs.mkdir(taskDir, { recursive: true });

      const primaryFile = path.join(taskDir, 'art1.txt');
      await fs.writeFile(primaryFile, 'some text content');
      await fs.writeFile(`${primaryFile}.meta.json`, '{}');

      const items = await manager.listArtifacts('task-empty-object-sidecar');
      assert.equal(items.length, 1);
      assert.equal(typeof items[0].sizeBytes, 'number');
      assert.ok(!Number.isNaN(items[0].sizeBytes), 'sizeBytes should not be NaN');

      const bundleMeta = await manager.saveTaskBundle('task-empty-object-sidecar', { status: 'completed' });
      assert.ok(!Number.isNaN(bundleMeta.totalSizeBytes), 'totalSizeBytes should not be NaN');
    });

    it('should not delete sidecar metadata if primary file unlinking fails', async () => {
      const taskDir = manager.getTaskArtifactDir('task-dir-fail');
      await fs.mkdir(taskDir, { recursive: true });

      const dirCandidate = path.join(taskDir, 'art-dir');
      await fs.mkdir(dirCandidate, { recursive: true });
      await fs.writeFile(`${dirCandidate}.meta.json`, JSON.stringify({ artifactId: 'art-dir', path: dirCandidate }));

      const deleted = await manager.deleteArtifact('art-dir', 'task-dir-fail');
      assert.equal(deleted, false);

      const sidecarExists = await fs.stat(`${dirCandidate}.meta.json`).then(() => true).catch(() => false);
      assert.equal(sidecarExists, true);
    });
  });
});


