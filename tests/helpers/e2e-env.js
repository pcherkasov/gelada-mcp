import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Environment for tests that drive the server over real stdio.
 *
 * Every such test gets its own git repository under the OS temp directory.
 * Running them against the checkout under test would leave worktrees and
 * artifacts behind in the working tree, which is how this repository ended up
 * with hundreds of stale worktrees.
 */

/**
 * Creates an isolated data directory for the model-catalog cache, so one
 * suite's mock catalog cannot leak into another's.
 */
export async function createTempDataDir(prefix = 'gelada-e2e-data-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Creates a throwaway git repository with one commit. */
export async function createTempRepo(prefix = 'gelada-e2e-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "E2E Test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "e2e@example.com"', { cwd: dir, stdio: 'ignore' });
  await fs.writeFile(path.join(dir, 'README.md'), '# E2E fixture\n');
  await fs.writeFile(path.join(dir, 'index.js'), 'export const value = 1;\n');
  execSync('git add . && git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

/**
 * Writes a standalone mock worker CLI usable by a server running in another
 * process, and returns the AGY_COMMAND string that invokes it.
 */
export async function createMockAgyScript(dir, name = 'mock-agy.mjs') {
  const scriptPath = path.join(dir, name);
  await fs.writeFile(
    scriptPath,
    `import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);

if (argv[0] === 'models') {
  process.stdout.write('mock-flash-medium\\tMock Flash (Medium)\\nmock-pro-high\\tMock Pro (High)\\n');
  process.exit(0);
}

const i = argv.indexOf('--add-dir');
if (i >= 0) {
  fs.writeFileSync(path.join(argv[i + 1], 'worker-output.txt'), 'mock worker run ' + Date.now() + '\\n');
}

process.stdout.write('Mock worker finished\\n');
process.exit(0);
`,
  );
  return { scriptPath, command: `${process.execPath} ${scriptPath}` };
}

const NON_TERMINAL = new Set([
  'CREATED',
  'VALIDATING',
  'PREPARING',
  'READY',
  'RUNNING',
  'COLLECTING',
  'VERIFYING',
]);

/**
 * Polls inspect_task the way a leader agent would, until the task settles.
 * Returns the parsed summary payload.
 */
export async function pollTask(client, taskId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const deadline = Date.now() + timeoutMs;
  let last;

  for (;;) {
    const res = await client.callTool({
      name: 'inspect_task',
      arguments: { taskId, mode: options.mode ?? 'summary' },
    });
    last = JSON.parse(res.content[0].text);
    const state = last.granularStatus ?? last.status;

    if (state && !NON_TERMINAL.has(state)) return last;
    if (Date.now() > deadline) {
      throw new Error(`Task ${taskId} still in ${state} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Calls delegate_task and polls until the task reaches a terminal state. */
export async function delegateAndPoll(client, args, options = {}) {
  const res = await client.callTool({ name: 'delegate_task', arguments: args });
  const handoff = JSON.parse(res.content[0].text);
  if (!handoff.taskId || (handoff.status && handoff.status !== 'running')) {
    return { handoff, summary: handoff };
  }
  const summary = await pollTask(client, handoff.taskId, options);
  return { handoff, summary };
}
