import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { runCli } from '../../dist/cli/index.js';

/**
 * `gelada` with nothing after it is the one invocation with two audiences: a
 * person at a terminal, and a client that was configured without `mcp serve`.
 * It used to serve both of them a silent stdio server, so a human who typed the
 * program's own name got no output and a process that never returned.
 */
describe('gelada with no arguments', () => {
  let originalIsTTY;
  let originalWrite;

  afterEach(() => {
    if (originalIsTTY === undefined) delete process.stdin.isTTY;
    else process.stdin.isTTY = originalIsTTY;
    if (originalWrite) process.stdout.write = originalWrite;
    originalIsTTY = undefined;
    originalWrite = undefined;
  });

  function captureStdout() {
    let captured = '';
    originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      captured += String(chunk);
      return true;
    };
    return () => captured;
  }

  it('prints the command list at a terminal, and returns', async () => {
    originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    const output = captureStdout();

    // Returning at all is half the assertion: the old path never did.
    await runCli(['node', 'gelada']);

    process.stdout.write = originalWrite;
    const text = output();

    assert.match(text, /Usage: gelada/);
    for (const command of ['setup', 'doctor', 'mcp', 'update']) {
      assert.match(text, new RegExp(`\\b${command}\\b`), `help should list ${command}`);
    }
  });

  it('does not start a server at a terminal', async () => {
    originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    const output = captureStdout();

    await runCli(['node', 'gelada']);

    process.stdout.write = originalWrite;

    // A stdio server writes JSON-RPC to stdout and nothing else; help is not it.
    assert.ok(!output().includes('"jsonrpc"'), 'no JSON-RPC may reach stdout');
  });
});
