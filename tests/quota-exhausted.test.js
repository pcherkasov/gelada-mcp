import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { isQuotaError, parseQuotaReset, quotaErrorDetails } from '../dist/tools/delegate-task.js';
import { isAuthError } from '../dist/tools/delegate-task.js';
import { createTempRepo, createTempDataDir, delegateAndPoll } from './helpers/e2e-env.js';

/**
 * A worker that runs out of quota is not a broken worker and not a broken task.
 * Reported as a bare "exited 1" it invites exactly the two wrong reactions —
 * retry now, or rewrite the objective — so it gets its own terminal state.
 *
 * The message pinned here is verbatim what Antigravity emitted on a real
 * exhausted account:
 *
 *   Error: Individual quota reached. Please upgrade your subscription to
 *   increase your limits. Resets in 2m38s.
 */
const REAL_AGY_QUOTA_MESSAGE =
  'Error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 2m38s.';

describe('quota exhaustion is diagnosed, not guessed', () => {
  describe('detection', () => {
    it('recognises the message Antigravity actually emits', () => {
      assert.equal(isQuotaError(REAL_AGY_QUOTA_MESSAGE), true);
    });

    it('does not mistake a quota failure for an authentication failure', () => {
      assert.equal(
        isAuthError(REAL_AGY_QUOTA_MESSAGE),
        false,
        'classifying this as auth would send the leader agent to re-run "agy login" for nothing',
      );
    });

    it('recognises the common phrasings of other providers', () => {
      for (const text of [
        'Error: out of credits',
        'RESOURCE_EXHAUSTED: quota exceeded for model',
        'HTTP 429 returned by the API',
        '429 Too Many Requests',
        'You are being rate-limited, slow down',
        'Usage limit reached for this billing period',
      ]) {
        assert.equal(isQuotaError(text), true, `should recognise: ${text}`);
      }
    });

    it('stays quiet on ordinary worker failures', () => {
      for (const text of [
        '',
        'SyntaxError: Unexpected token }',
        'error: pathspec did not match any file known to git',
        'Command failed with exit code 1',
        'Authentication required. Please run agy login.',
      ]) {
        assert.equal(isQuotaError(text), false, `should not claim quota for: ${text}`);
      }
    });
  });

  describe('reset window', () => {
    it('extracts the compact form the worker CLI uses', () => {
      assert.equal(parseQuotaReset(REAL_AGY_QUOTA_MESSAGE), '2m38s');
    });

    it('extracts spelled-out windows too', () => {
      assert.equal(parseQuotaReset('Quota reached. Resets in 10 minutes.'), '10 minutes');
    });

    it('returns undefined rather than inventing a window', () => {
      assert.equal(parseQuotaReset('Error: out of credits'), undefined);
    });

    it('carries the window into the advice, and never tells the agent to rewrite the task', () => {
      const withWindow = quotaErrorDetails(REAL_AGY_QUOTA_MESSAGE);
      assert.equal(withWindow.code, 'QUOTA_EXHAUSTED');
      assert.equal(withWindow.stage, 'QUOTA_EXHAUSTED');
      assert.match(withWindow.message, /2m38s/);
      assert.match(withWindow.recommendedAction ?? '', /2m38s/);
      assert.match(withWindow.recommendedAction ?? '', /unchanged/i);

      const withoutWindow = quotaErrorDetails('Error: out of credits');
      assert.equal(withoutWindow.code, 'QUOTA_EXHAUSTED');
      assert.doesNotMatch(withoutWindow.message, /undefined/);
      assert.doesNotMatch(withoutWindow.recommendedAction ?? '', /undefined/);
    });
  });

  describe('end to end through the MCP server', () => {
    let client;
    let transport;
    let repoDir;
    let dataDir;

    before(async () => {
      repoDir = await createTempRepo('gelada-quota-');
      dataDir = await createTempDataDir();

      // A worker that reports an exhausted quota on stderr and exits non-zero,
      // exactly as observed.
      const scriptPath = path.join(repoDir, 'quota-agy.mjs');
      await fs.writeFile(
        scriptPath,
        `const argv = process.argv.slice(2);
if (argv[0] === 'models') {
  process.stdout.write('mock-flash-medium\\tMock Flash (Medium)\\n');
  process.exit(0);
}
process.stderr.write(${JSON.stringify(REAL_AGY_QUOTA_MESSAGE)} + '\\n');
process.exit(1);
`,
      );

      transport = new StdioClientTransport({
        command: process.execPath,
        args: ['./bin/gelada.js'],
        cwd: process.cwd(),
        env: {
          ...process.env,
          AGY_COMMAND: `${process.execPath} ${scriptPath}`,
          GELADA_DATA_DIR: dataDir,
        },
        stderr: 'pipe',
      });

      client = new Client({ name: 'quota-test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(transport);
    });

    after(async () => {
      await client?.close().catch(() => {});
      await transport?.close().catch(() => {});
    });

    it('reaches QUOTA_EXHAUSTED rather than a generic worker failure', async () => {
      const { summary } = await delegateAndPoll(client, {
        repoPath: repoDir,
        taskType: 'unit-test',
        objective: 'Add a trivial test.',
        allowedPaths: ['added.test.js'],
      });

      assert.equal(summary.granularStatus, 'QUOTA_EXHAUSTED');
      assert.equal(summary.status, 'failed');
      assert.equal(summary.errorDetails?.code, 'QUOTA_EXHAUSTED');

      // The point of the whole change: the reset window reaches the caller
      // instead of dying in stderr.
      assert.match(summary.errorDetails?.message ?? '', /2m38s/);
      assert.match(summary.errorDetails?.recommendedAction ?? '', /2m38s/);

      // And it must not read as "the worker crashed on your code".
      assert.doesNotMatch(summary.errorDetails?.message ?? '', /exit code/i);
    });

    it('leaves the repository untouched', async () => {
      const { summary } = await delegateAndPoll(client, {
        repoPath: repoDir,
        taskType: 'unit-test',
        objective: 'Add another trivial test.',
        allowedPaths: ['other.test.js'],
      });

      assert.equal(summary.granularStatus, 'QUOTA_EXHAUSTED');
      assert.deepEqual(summary.details?.changedFiles ?? [], []);
      assert.equal(summary.details?.repoState?.isClean, true);
    });
  });
});
