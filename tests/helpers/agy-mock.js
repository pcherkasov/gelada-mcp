import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Shared harness for tests that drive the worker.
 *
 * Two things here exist to stop old failures from coming back:
 *  - argv is asserted by meaning, not by position, so adding a worker flag does
 *    not break every test that inspects the command line;
 *  - the mock worker can actually write files, because a worker that changes
 *    nothing is now a task failure rather than a success.
 */

/**
 * Writes a mock worker CLI and returns the AGY_COMMAND string that runs it.
 *
 * @param {string} dir            directory to place the script in
 * @param {object} [behavior]
 * @param {string} [behavior.logFile]  where to record argv as JSON
 * @param {number} [behavior.exitCode] process exit code (default 0)
 * @param {string} [behavior.stdout]   text to print on stdout
 * @param {string} [behavior.stderr]   text to print on stderr
 * @param {Record<string,string>} [behavior.writes]
 *        files to create relative to the workspace passed via --add-dir.
 *        Defaults to a single file so tasks can legitimately reach COMPLETED.
 * @param {string} [behavior.models]   output for the `models` subcommand
 * @param {string} [behavior.name]     script filename
 */
export async function createMockAgy(dir, behavior = {}) {
  const {
    logFile,
    exitCode = 0,
    stdout = 'Mock agy executed',
    stderr = '',
    writes = { 'mock-agy-output.txt': 'written by mock agy\n' },
    models = 'mock-flash-medium\tMock Flash (Medium)\nmock-pro-high\tMock Pro (High)\n',
    name = 'mock_agy.mjs',
  } = behavior;

  const scriptPath = path.join(dir, name);
  const script = `import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);

if (argv[0] === 'models') {
  process.stdout.write(${JSON.stringify(models)});
  process.exit(0);
}

const logFile = ${JSON.stringify(logFile ?? null)};
if (logFile) {
  fs.writeFileSync(logFile, JSON.stringify(argv));
}

const addDirIndex = argv.indexOf('--add-dir');
const workspace = addDirIndex >= 0 ? argv[addDirIndex + 1] : process.cwd();

const writes = ${JSON.stringify(writes)};
for (const [rel, content] of Object.entries(writes)) {
  const target = path.join(workspace, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const out = ${JSON.stringify(stdout)};
const err = ${JSON.stringify(stderr)};
if (out) process.stdout.write(out + '\\n');
if (err) process.stderr.write(err + '\\n');
process.exit(${exitCode});
`;

  await fs.writeFile(scriptPath, script);
  return { scriptPath, command: `${process.execPath} ${scriptPath}` };
}

/**
 * Interprets a worker argv by meaning instead of by index.
 *
 * @param {string[]} argv
 * @returns {{model?: string, addDir?: string, prompt?: string,
 *            printTimeout?: string, flags: Set<string>}}
 */
export function parseAgyArgs(argv) {
  const valued = new Set(['--model', '--add-dir', '--prompt', '--print-timeout', '--effort']);
  const result = { flags: new Set() };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    if (valued.has(token)) {
      const value = argv[i + 1];
      i++;
      if (token === '--model') result.model = value;
      else if (token === '--add-dir') result.addDir = value;
      else if (token === '--prompt') result.prompt = value;
      else if (token === '--print-timeout') result.printTimeout = value;
      else if (token === '--effort') result.effort = value;
    } else {
      result.flags.add(token);
    }
  }

  return result;
}

/** Reads and parses the argv recorded by a mock worker. */
export async function readAgyArgs(logFile) {
  return parseAgyArgs(JSON.parse(await fs.readFile(logFile, 'utf-8')));
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
 * delegate_task returns as soon as the worker is spawned, so tests have to wait
 * for the background lifecycle to settle rather than reading the first response.
 *
 * @param {object} taskRegistry
 * @param {string} taskId
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>} the task record in its terminal state
 */
export async function waitForTerminalState(taskRegistry, taskId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const task = taskRegistry.getTask(taskId);
    if (task && !NON_TERMINAL.has(task.granularStatus)) {
      return task;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Task ${taskId} did not reach a terminal state within ${timeoutMs}ms ` +
          `(last state: ${task?.granularStatus ?? 'unknown'})`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Wraps a tool handler so it resolves only once the task has settled, and
 * reports the task's real terminal state.
 *
 * delegate_task returns as soon as the worker is spawned so the MCP call cannot
 * time out on a long task. Tests care about the outcome, not the handoff, so
 * this adapter re-reads the registry and reports what the task actually became.
 * Responses that are already terminal (contract and policy rejections, which
 * never spawn a worker) are passed through untouched.
 */
export function settleHandler(handler, taskRegistry, options = {}) {
  return async (args) => {
    const response = await handler(args);

    let payload;
    try {
      payload = JSON.parse(response.content[0].text);
    } catch {
      return response;
    }

    if (!payload?.taskId || (payload.status && payload.status !== 'running')) {
      return response;
    }

    const task = await waitForTerminalState(taskRegistry, payload.taskId, options);
    const settled = {
      ...payload,
      status: task.status,
      granularStatus: task.granularStatus,
      stateHistory: task.stateHistory,
      errorDetails: task.errorDetails,
      error: task.errorDetails?.message ?? payload.error,
      code: task.errorDetails?.code ?? payload.code,
      changedFiles: task.changedFiles,
      diff: task.latestDiff,
      verificationResults: task.verificationResults,
    };

    return { content: [{ type: 'text', text: JSON.stringify(settled, null, 2) }] };
  };
}

/** Runs delegate_task and waits for the background lifecycle to finish. */
export async function delegateAndWait(delegateHandler, taskRegistry, args, options = {}) {
  const response = await delegateHandler(args);
  const payload = JSON.parse(response.content[0].text);
  if (!payload.taskId) return { payload, task: undefined };
  const task = await waitForTerminalState(taskRegistry, payload.taskId, options);
  return { payload, task };
}
