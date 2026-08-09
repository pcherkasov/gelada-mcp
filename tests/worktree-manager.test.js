import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { WorktreeManager, WorktreeError } from '../dist/components/worktree-manager.js';

const execFileAsync = promisify(execFile);

describe('WorktreeManager Test Suite', () => {
  let tempRepoDir;

  beforeEach(async () => {
    tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-wt-test-'));
    await execFileAsync('git', ['init'], { cwd: tempRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tempRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempRepoDir });
    await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Test Repo\nInitial content\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: tempRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tempRepoDir });
  });

  afterEach(async () => {
    if (tempRepoDir) {
      await fs.rm(tempRepoDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. Worktree Creation & Lifecycle', () => {
    it('should create worktree in .worktrees/ directory with valid metadata', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('feat/task-1');

      assert.equal(info.worktreeId, 'wt-feat-task-1');
      assert.equal(info.path, '.worktrees/feat-task-1');
      assert.equal(info.branch, 'worktree/feat-task-1');
      assert.ok(info.createdAt > 0);
      assert.ok(typeof info.baseCommit === 'string' && info.baseCommit.length === 40);

      const absPath = path.resolve(tempRepoDir, info.path);
      const stat = await fs.stat(absPath);
      assert.ok(stat.isDirectory());

      const readmeContent = await fs.readFile(path.join(absPath, 'README.md'), 'utf-8');
      assert.equal(readmeContent, '# Test Repo\nInitial content\n');

      assert.equal(manager.listWorktrees().length, 1);
      assert.deepEqual(manager.getWorktree('wt-feat-task-1'), info);
    });

    it('should sanitize task slug for branch and directory paths', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('feature/add-auth!@#$');

      assert.equal(info.worktreeId, 'wt-feature-add-auth----');
      assert.equal(info.path, '.worktrees/feature-add-auth----');
      assert.equal(info.branch, 'worktree/feature-add-auth----');
    });

    it('should prevent path traversal attempts in task slug', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('../../etc/passwd');
      assert.ok(!info.path.includes('..'));
      assert.ok(info.path.startsWith('.worktrees/'));
    });
  });

  describe('2. File Modification & Git Diff Collection', () => {
    it('should return empty string when no modifications exist', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-clean');

      const diff = await manager.getDiff(info.worktreeId);
      assert.equal(diff, '');
    });

    it('should collect diff for unstaged modifications to existing files', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-mod');
      const absPath = path.resolve(tempRepoDir, info.path);

      await fs.writeFile(path.join(absPath, 'README.md'), '# Test Repo\nModified content\n');

      const diff = await manager.getDiff(info.worktreeId);
      assert.ok(diff.includes('diff --git a/README.md b/README.md'));
      assert.ok(diff.includes('-Initial content'));
      assert.ok(diff.includes('+Modified content'));
    });

    it('should collect diff for newly created untracked files (git add -A verification)', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-untracked');
      const absPath = path.resolve(tempRepoDir, info.path);

      await fs.mkdir(path.join(absPath, 'src'), { recursive: true });
      await fs.writeFile(path.join(absPath, 'src/new-tool.ts'), 'export const hello = "world";\n');

      const diff = await manager.getDiff(info.worktreeId);
      assert.ok(diff.includes('diff --git a/src/new-tool.ts b/src/new-tool.ts'));
      assert.ok(diff.includes('new file mode'));
      assert.ok(diff.includes('+export const hello = "world";'));

      const details = await manager.getDiffDetails(info.worktreeId);
      assert.equal(details.worktreeId, info.worktreeId);
      assert.deepEqual(details.changedFiles, ['src/new-tool.ts']);
    });

    it('should collect diff for deleted files', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-del');
      const absPath = path.resolve(tempRepoDir, info.path);

      await fs.unlink(path.join(absPath, 'README.md'));

      const diff = await manager.getDiff(info.worktreeId);
      assert.ok(diff.includes('diff --git a/README.md b/README.md'));
      assert.ok(diff.includes('deleted file mode'));
    });

    it('should collect net diff when worker makes intermediate git commits', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-commits');
      const absPath = path.resolve(tempRepoDir, info.path);

      await fs.writeFile(path.join(absPath, 'file1.txt'), 'content 1\n');
      await execFileAsync('git', ['add', 'file1.txt'], { cwd: absPath });
      await execFileAsync('git', ['commit', '-m', 'worker commit 1'], { cwd: absPath });

      await fs.writeFile(path.join(absPath, 'file2.txt'), 'content 2\n');

      const diff = await manager.getDiff(info.worktreeId);
      assert.ok(diff.includes('diff --git a/file1.txt b/file1.txt'));
      assert.ok(diff.includes('diff --git a/file2.txt b/file2.txt'));
    });
  });

  describe('3. Worktree & Temporary Branch Cleanup', () => {
    it('should remove worktree directory and metadata', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-cleanup');
      const absPath = path.resolve(tempRepoDir, info.path);

      await manager.removeWorktree(info.worktreeId);

      await assert.rejects(async () => {
        await fs.stat(absPath);
      });

      assert.equal(manager.listWorktrees().length, 0);
      assert.equal(manager.getWorktree(info.worktreeId), undefined);
    });

    it('should force remove worktree with uncommitted/dirty changes', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-dirty-cleanup');
      const absPath = path.resolve(tempRepoDir, info.path);

      await fs.writeFile(path.join(absPath, 'scratch.txt'), 'untracked dirty content');

      await manager.removeWorktree(info.worktreeId);

      await assert.rejects(async () => {
        await fs.stat(absPath);
      });
    });

    it('should handle cleanup idempotently without throwing', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-idempotent');

      await manager.removeWorktree(info.worktreeId);
      await manager.removeWorktree(info.worktreeId);
      await manager.removeWorktree('wt-nonexistent');
    });

    it('should support retainOnFailure option', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });
      const info = await manager.createWorktree('task-retain');
      const absPath = path.resolve(tempRepoDir, info.path);

      await manager.removeWorktree(info.worktreeId, { retainOnFailure: true });

      const stat = await fs.stat(absPath);
      assert.ok(stat.isDirectory());
      assert.equal(manager.getWorktree(info.worktreeId), undefined);
    });
  });

  describe('4. Error Handling & Edge Cases', () => {
    it('should throw WorktreeError with INVALID_INPUT for null or non-string taskSlug', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });

      await assert.rejects(
        async () => {
          await manager.createWorktree(null);
        },
        (err) => err instanceof WorktreeError && err.code === 'INVALID_INPUT',
      );

      await assert.rejects(
        async () => {
          await manager.createWorktree('');
        },
        (err) => err instanceof WorktreeError && err.code === 'INVALID_INPUT',
      );
    });

    it('should throw WorktreeError with WORKTREE_NOT_FOUND when requesting diff for non-existent worktreeId', async () => {
      const manager = new WorktreeManager({ repoRoot: tempRepoDir });

      await assert.rejects(
        async () => {
          await manager.getDiff('wt-nonexistent');
        },
        (err) => err instanceof WorktreeError && err.code === 'WORKTREE_NOT_FOUND',
      );
    });

    it('should throw WorktreeError with NOT_A_GIT_REPO when operating in non-git directory', async () => {
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-non-git-'));
      try {
        const manager = new WorktreeManager({ repoRoot: nonGitDir });
        await assert.rejects(
          async () => {
            await manager.createWorktree('task-test');
          },
          (err) => err instanceof WorktreeError && err.code === 'NOT_A_GIT_REPO',
        );
      } finally {
        await fs.rm(nonGitDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
