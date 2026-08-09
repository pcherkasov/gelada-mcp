import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runSmokeTest } from '../dist/cli/commands/smoke.js';
import { resetWorkerModelCatalogCache } from '../dist/components/model-catalog.js';
import { createMockAgyScript } from './helpers/e2e-env.js';

/**
 * The smoke check is what makes installation trustworthy: every component can
 * report healthy while delegation still produces nothing. These tests pin the
 * two outcomes that matter — a worker that changes something passes, a worker
 * that changes nothing does not.
 */
describe('gelada smoke', () => {
  let workDir;
  let dataDir;
  let oldAgy;
  let oldDataDir;

  beforeEach(async () => {
    oldAgy = process.env.AGY_COMMAND;
    oldDataDir = process.env.GELADA_DATA_DIR;
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-smoke-test-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-smoke-data-'));
    process.env.GELADA_DATA_DIR = dataDir;
    resetWorkerModelCatalogCache();
  });

  afterEach(async () => {
    if (oldAgy !== undefined) process.env.AGY_COMMAND = oldAgy;
    else delete process.env.AGY_COMMAND;
    if (oldDataDir !== undefined) process.env.GELADA_DATA_DIR = oldDataDir;
    else delete process.env.GELADA_DATA_DIR;
    resetWorkerModelCatalogCache();

    for (const dir of [workDir, dataDir]) {
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('passes when the worker produces a change', async () => {
    const { command } = await createMockAgyScript(workDir);
    process.env.AGY_COMMAND = command;

    const result = await runSmokeTest({ timeoutSeconds: 30 });

    assert.equal(result.ok, true, `smoke failed: ${result.error}`);
    assert.ok(result.changedFiles.length > 0);
    assert.ok(result.diff && result.diff.length > 0, 'a passing smoke test must carry a diff');
  });

  it('fails when the worker exits cleanly without changing anything', async () => {
    const scriptPath = path.join(workDir, 'noop-agy.mjs');
    await fs.writeFile(
      scriptPath,
      `const argv = process.argv.slice(2);
if (argv[0] === 'models') {
  process.stdout.write('mock-flash-medium\\tMock Flash (Medium)\\n');
  process.exit(0);
}
process.stdout.write('I have completed the task.\\n');
process.exit(0);
`,
    );
    process.env.AGY_COMMAND = `${process.execPath} ${scriptPath}`;

    const result = await runSmokeTest({ timeoutSeconds: 30 });

    assert.equal(result.ok, false);
    assert.equal(result.granularStatus, 'FAILED_WORKER');
    assert.match(result.remediation ?? '', /workerAutoApprove/);
  });

  it('reports a missing worker CLI with actionable remediation', async () => {
    process.env.AGY_COMMAND = '/nonexistent/path/to/agy';

    const result = await runSmokeTest({ timeoutSeconds: 30 });

    assert.equal(result.ok, false);
    assert.match(result.remediation ?? '', /Antigravity CLI/i);
  });

  it('cleans up its temporary repository', async () => {
    const before = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('gelada-smoke-'));
    const { command } = await createMockAgyScript(workDir, 'mock-cleanup.mjs');
    process.env.AGY_COMMAND = command;

    await runSmokeTest({ timeoutSeconds: 30 });

    const after = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('gelada-smoke-'));
    assert.deepEqual(after.sort(), before.sort(), 'smoke must not leave repositories behind');
  });
});
