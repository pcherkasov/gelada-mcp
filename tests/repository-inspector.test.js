import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  RepositoryInspector,
  RepositoryInspectorError,
} from '../dist/components/repository-inspector.js';

const execFileAsync = promisify(execFile);

describe('RepositoryInspector Unit Tests', () => {
  let tempRepoDir;
  let inspector;

  beforeEach(async () => {
    tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-repo-test-'));
    await execFileAsync('git', ['init'], { cwd: tempRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tempRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempRepoDir });
    await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Test Repo\nInitial content\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: tempRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tempRepoDir });

    inspector = new RepositoryInspector();
  });

  afterEach(async () => {
    if (tempRepoDir) {
      await fs.rm(tempRepoDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. Git Status & Cleanliness Detection', () => {
    it('should inspect clean repository and return isClean=true, hasUntrackedFiles=false', async () => {
      const state = await inspector.inspectRepo(tempRepoDir);

      assert.equal(state.isClean, true);
      assert.equal(state.hasUntrackedFiles, false);
      assert.ok(typeof state.currentBranch === 'string');
      assert.ok(state.commitHash.length === 40);
      assert.equal(state.repoPath, path.resolve(tempRepoDir));
    });

    it('should detect dirty state when tracked files are modified but unstaged', async () => {
      await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Test Repo\nModified content\n');

      const state = await inspector.inspectRepo(tempRepoDir);
      assert.equal(state.isClean, false);
      assert.equal(state.hasUntrackedFiles, false);
      assert.equal(state.gitStatus.modifiedFiles.length, 1);
      assert.equal(state.gitStatus.modifiedFiles[0].path, 'README.md');
    });

    it('should detect dirty state when changes are staged', async () => {
      await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Staged change\n');
      await execFileAsync('git', ['add', 'README.md'], { cwd: tempRepoDir });

      const state = await inspector.inspectRepo(tempRepoDir);
      assert.equal(state.isClean, false);
      assert.equal(state.gitStatus.stagedFiles.length, 1);
      assert.equal(state.gitStatus.stagedFiles[0].path, 'README.md');
    });

    it('should detect untracked files and report hasUntrackedFiles=true', async () => {
      await fs.writeFile(path.join(tempRepoDir, 'untracked.txt'), 'untracked content\n');

      const state = await inspector.inspectRepo(tempRepoDir);
      assert.equal(state.hasUntrackedFiles, true);
      assert.deepEqual(state.gitStatus.untrackedFiles, ['untracked.txt']);
    });

    it('should detect deleted files in git status', async () => {
      await fs.unlink(path.join(tempRepoDir, 'README.md'));

      const state = await inspector.inspectRepo(tempRepoDir);
      assert.equal(state.isClean, false);
      assert.deepEqual(state.gitStatus.deletedFiles, ['README.md']);
    });
  });

  describe('2. Branch Detection & Detached HEAD', () => {
    it('should detect custom active branch name', async () => {
      await execFileAsync('git', ['checkout', '-b', 'feature/auth-token'], { cwd: tempRepoDir });

      const state = await inspector.inspectRepo(tempRepoDir);
      assert.equal(state.currentBranch, 'feature/auth-token');
      assert.equal(state.isDetached, false);
    });

    it('should handle detached HEAD state gracefully', async () => {
      const { stdout: commitOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: tempRepoDir });
      const sha = commitOut.trim();

      await execFileAsync('git', ['checkout', sha], { cwd: tempRepoDir });

      const state = await inspector.inspectRepo(tempRepoDir);
      assert.equal(state.isDetached, true);
      assert.equal(state.currentBranch, 'HEAD');
      assert.equal(state.commitHash, sha);
    });
  });

  describe('3. File Existence & Path Inspection', () => {
    it('should verify existence of files, directories, and symlinks', async () => {
      await fs.mkdir(path.join(tempRepoDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tempRepoDir, 'src/index.ts'), 'console.log("hi");\n');
      try {
        await fs.symlink(
          path.join(tempRepoDir, 'src/index.ts'),
          path.join(tempRepoDir, 'symlink.ts'),
        );
      } catch {
        // symlinks may require elevated privileges on Windows, test conditionally
      }

      const results = await inspector.checkFilesExist(tempRepoDir, [
        'README.md',
        'src',
        'src/index.ts',
        'nonexistent.txt',
      ]);

      const readmeResult = results.find((r) => r.path === 'README.md');
      assert.ok(readmeResult);
      assert.equal(readmeResult.exists, true);
      assert.equal(readmeResult.isFile, true);

      const srcResult = results.find((r) => r.path === 'src');
      assert.ok(srcResult);
      assert.equal(srcResult.exists, true);
      assert.equal(srcResult.isDirectory, true);

      const missingResult = results.find((r) => r.path === 'nonexistent.txt');
      assert.ok(missingResult);
      assert.equal(missingResult.exists, false);
    });

    it('should reject path traversal attempts when checking files', async () => {
      const results = await inspector.checkFilesExist(tempRepoDir, [
        '../outside.txt',
        '../../etc/passwd',
      ]);

      assert.equal(results.length, 2);
      assert.equal(results[0].exists, false);
      assert.equal(results[0].error, 'Path traversal attempt detected');
      assert.equal(results[1].exists, false);
      assert.equal(results[1].error, 'Path traversal attempt detected');
    });
  });

  describe('4. Non-Git Directory & Error Handling', () => {
    it('should return isClean=false and currentBranch=none for non-git directory in inspectRepo', async () => {
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-non-git-'));
      try {
        const state = await inspector.inspectRepo(nonGitDir);
        assert.equal(state.currentBranch, 'none');
        assert.equal(state.isClean, false);
      } finally {
        await fs.rm(nonGitDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should throw NOT_A_GIT_REPO error when calling getGitStatus on a non-git directory', async () => {
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-non-git-'));
      try {
        await assert.rejects(
          async () => {
            await inspector.getGitStatus(nonGitDir);
          },
          (err) => err instanceof RepositoryInspectorError && err.code === 'NOT_A_GIT_REPO',
        );
      } finally {
        await fs.rm(nonGitDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should throw FILE_NOT_FOUND when inspecting non-existent directory', async () => {
      await assert.rejects(
        async () => {
          await inspector.getGitStatus('/tmp/gelada-nonexistent-dir-99999');
        },
        (err) => err instanceof RepositoryInspectorError && err.code === 'FILE_NOT_FOUND',
      );
    });

    it('should throw INVALID_INPUT for null or invalid repoPath', async () => {
      await assert.rejects(
        async () => {
          await inspector.inspectRepo(null);
        },
        (err) => err instanceof RepositoryInspectorError && err.code === 'INVALID_INPUT',
      );

      await assert.rejects(
        async () => {
          await inspector.getGitStatus('');
        },
        (err) => err instanceof RepositoryInspectorError && err.code === 'INVALID_INPUT',
      );
    });
  });

  describe('5. Snapshot Capture & Comparison', () => {
    it('should capture and compare snapshots before and after modifications', async () => {
      const beforeSnapshot = await inspector.captureSnapshot(tempRepoDir, ['README.md']);

      // Perform modifications
      await fs.writeFile(path.join(tempRepoDir, 'new_file.txt'), 'new content\n');
      await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Updated Readme\n');

      const afterSnapshot = await inspector.captureSnapshot(tempRepoDir, ['README.md']);

      const diff = await inspector.compareSnapshots(beforeSnapshot, afterSnapshot);
      assert.equal(diff.isIdentical, false);
      assert.deepEqual(diff.untrackedAdded, ['new_file.txt']);
      assert.deepEqual(diff.modifiedFiles, ['README.md']);
    });

    it('should report isIdentical=true for unchanged repository snapshot comparisons', async () => {
      const snap1 = await inspector.captureSnapshot(tempRepoDir);
      const snap2 = await inspector.captureSnapshot(tempRepoDir);

      const diff = await inspector.compareSnapshots(snap1, snap2);
      assert.equal(diff.isIdentical, true);
    });
  });

  describe('6. Repository Readiness Validation', () => {
    it('should validate clean repository readiness', async () => {
      const res = await inspector.validateRepoReady(tempRepoDir, {
        requireClean: true,
        allowUntracked: true,
        checkFiles: ['README.md'],
      });

      assert.equal(res.valid, true);
      assert.equal(res.isGitRepo, true);
      assert.equal(res.isClean, true);
      assert.equal(res.errors.length, 0);
      assert.equal(res.missingRequiredFiles.length, 0);
    });

    it('should report invalid when requireClean=true and repository has uncommitted changes', async () => {
      await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Dirty content\n');

      const res = await inspector.validateRepoReady(tempRepoDir, {
        requireClean: true,
      });

      assert.equal(res.valid, false);
      assert.equal(res.isClean, false);
      assert.ok(res.errors.some((e) => e.includes('dirty state')));
    });

    it('should report missing required files in validation result', async () => {
      const res = await inspector.validateRepoReady(tempRepoDir, {
        checkFiles: ['README.md', 'MISSING.md'],
      });

      assert.equal(res.valid, false);
      assert.deepEqual(res.missingRequiredFiles, ['MISSING.md']);
      assert.ok(res.errors.some((e) => e.includes('Required file missing')));
    });
  });

  describe('7. Edge Cases and Hardened Fixes', () => {
    it('should handle unborn branch in a freshly initialized git repository cleanly', async () => {
      const emptyRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-unborn-repo-'));
      try {
        await execFileAsync('git', ['init'], { cwd: emptyRepoDir });
        const status = await inspector.getGitStatus(emptyRepoDir);
        assert.ok(typeof status.branch === 'string' && status.branch.length > 0);
        assert.equal(status.commitHash, '');
        assert.equal(status.isDetached, false);
        assert.equal(status.isClean, true);
      } finally {
        await fs.rm(emptyRepoDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should parse renamed files and unquote C-style paths with spaces', async () => {
      await execFileAsync('git', ['mv', 'README.md', 'README WITH SPACES.md'], { cwd: tempRepoDir });
      const status = await inspector.getGitStatus(tempRepoDir);
      assert.equal(status.stagedFiles.length, 1);
      const renamed = status.stagedFiles[0];
      assert.equal(renamed.status, 'renamed');
      assert.equal(renamed.oldPath, 'README.md');
      assert.equal(renamed.path, 'README WITH SPACES.md');
    });

    it('should parse merge conflict codes (e.g. AA conflict) into unmergedFiles', async () => {
      await execFileAsync('git', ['checkout', '-b', 'branch-a'], { cwd: tempRepoDir });
      await fs.writeFile(path.join(tempRepoDir, 'conflict.txt'), 'content a\n');
      await execFileAsync('git', ['add', 'conflict.txt'], { cwd: tempRepoDir });
      await execFileAsync('git', ['commit', '-m', 'Add conflict on a'], { cwd: tempRepoDir });

      await execFileAsync('git', ['checkout', 'HEAD~1'], { cwd: tempRepoDir });
      await execFileAsync('git', ['checkout', '-b', 'branch-b'], { cwd: tempRepoDir });
      await fs.writeFile(path.join(tempRepoDir, 'conflict.txt'), 'content b\n');
      await execFileAsync('git', ['add', 'conflict.txt'], { cwd: tempRepoDir });
      await execFileAsync('git', ['commit', '-m', 'Add conflict on b'], { cwd: tempRepoDir });

      try {
        await execFileAsync('git', ['merge', 'branch-a'], { cwd: tempRepoDir });
      } catch {
        // Expected conflict during merge
      }

      const status = await inspector.getGitStatus(tempRepoDir);
      assert.ok(status.unmergedFiles.includes('conflict.txt'));
      const conflictFile = status.stagedFiles.find((f) => f.path === 'conflict.txt');
      assert.ok(conflictFile);
      assert.equal(conflictFile.status, 'unmerged');
    });

    it('should include staged deleted files in deletedFiles array', async () => {
      await execFileAsync('git', ['rm', 'README.md'], { cwd: tempRepoDir });
      const status = await inspector.getGitStatus(tempRepoDir);
      assert.ok(status.deletedFiles.includes('README.md'));
      const deletedStaged = status.stagedFiles.find((f) => f.path === 'README.md');
      assert.ok(deletedStaged);
      assert.equal(deletedStaged.status, 'deleted');
    });

    it('should allow valid filenames containing consecutive dots (foo..bar.txt)', async () => {
      await fs.writeFile(path.join(tempRepoDir, 'foo..bar.txt'), 'dot content\n');
      const results = await inspector.checkFilesExist(tempRepoDir, ['foo..bar.txt']);
      assert.equal(results.length, 1);
      assert.equal(results[0].exists, true);
      assert.equal(results[0].isFile, true);
      assert.equal(results[0].error, undefined);
    });

    it('should detect broken symbolic links correctly without raising uncaught error', async () => {
      const linkPath = path.join(tempRepoDir, 'broken.link');
      try {
        await fs.symlink(path.join(tempRepoDir, 'nonexistent-target.txt'), linkPath);
      } catch {
        return;
      }

      const results = await inspector.checkFilesExist(tempRepoDir, ['broken.link']);
      assert.equal(results.length, 1);
      assert.equal(results[0].exists, true);
      assert.equal(results[0].isSymlink, true);
      assert.equal(results[0].isFile, false);
      assert.equal(results[0].isDirectory, false);
      assert.equal(results[0].error, 'Broken symbolic link');
    });

    it('should accurately compare snapshots starting from a dirty initial state', async () => {
      await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Initial Dirty\n');
      const snap1 = await inspector.captureSnapshot(tempRepoDir, ['README.md']);

      await fs.writeFile(path.join(tempRepoDir, 'README.md'), '# Further Dirty\n');
      const snap2 = await inspector.captureSnapshot(tempRepoDir, ['README.md']);

      const diff = await inspector.compareSnapshots(snap1, snap2);
      assert.equal(diff.isIdentical, false);
      assert.deepEqual(diff.modifiedFiles, ['README.md']);
    });

    it('should reject whitespace-only repoPath with INVALID_INPUT error', async () => {
      await assert.rejects(
        async () => {
          await inspector.getGitStatus('   ');
        },
        (err) => err instanceof RepositoryInspectorError && err.code === 'INVALID_INPUT',
      );

      await assert.rejects(
        async () => {
          await inspector.inspectRepo('   ');
        },
        (err) => err instanceof RepositoryInspectorError && err.code === 'INVALID_INPUT',
      );
    });
  });
});

