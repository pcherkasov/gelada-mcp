import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { PACKAGE_VERSION } from './helpers/package-version.js';

console.log('=== STARTING M2 STDIO LAUNCH EMPIRICAL TESTS ===');

let passCount = 0;
let testCount = 0;

function pass(name) {
  testCount++;
  passCount++;
  console.log(`[PASS] ${name}`);
}

function fail(name, error) {
  testCount++;
  console.error(`[FAIL] ${name}:`, error);
}

// Subtest 1: Verify startup stderr emission and JSON-RPC initialize request/response
async function testServerInitialization() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['./bin/gelada.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrData = '';
    let stdoutData = '';
    let connectedLogged = false;

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
      if (stderrData.includes('Gelada MCP server connected and listening via stdio.')) {
        connectedLogged = true;
      }
    });

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();

      for (const line of stdoutData.split('\n').filter((l) => l.trim().length > 0)) {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          // A partial JSON frame: wait for the rest of the line. Only parsing
          // is tolerated here — an assertion below must never be swallowed.
          continue;
        }

        if (msg.id !== 1 || !msg.result) {
          continue;
        }

        try {
          assert.ok(
            connectedLogged,
            'Stderr should contain connection diagnostic log before/upon init',
          );
          assert.equal(msg.jsonrpc, '2.0');
          assert.ok(msg.result.serverInfo);
          assert.equal(msg.result.serverInfo.name, 'gelada-mcp');
          assert.equal(msg.result.serverInfo.version, PACKAGE_VERSION);
          clearTimeout(timer);
          pass('Stdio server launch & JSON-RPC initialize request/response');
          child.kill();
          resolve();
        } catch (err) {
          clearTimeout(timer);
          child.kill();
          fail('Stdio server launch & JSON-RPC initialize request/response', err);
          reject(err);
        }
        return;
      }
    });

    child.on('error', (err) => {
      fail('Stdio server launch', err);
      reject(err);
    });

    // Send JSON-RPC initialize request
    const initPayload =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-harness', version: '1.0.0' },
        },
      }) + '\n';

    child.stdin.write(initPayload);

    // Unconditional: the promise above settles as soon as the initialize
    // response arrives, so anything still pending here is a genuine stall. The
    // previous guard only fired when nothing at all had been received, which
    // meant a server that answered but answered wrongly hung forever instead of
    // failing — in CI that burns the whole job timeout rather than reporting.
    const timer = setTimeout(() => {
      child.kill();
      fail(
        'Stdio server launch',
        new Error(`Timeout waiting for a valid initialize response. Stderr: ${stderrData}`),
      );
      reject(new Error('Timeout'));
    }, 10000);
    timer.unref?.();
  });
}

// Subtest 2: Signal Handling - SIGINT
async function testSigintHandling() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['./bin/gelada.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrData = '';

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('exit', (code, signal) => {
      try {
        assert.equal(code, 0, `Process exit code should be 0 on SIGINT, got ${code}`);
        assert.ok(stderrData.includes('Received SIGINT'), 'Stderr should log SIGINT receipt');
        pass('Signal handling: SIGINT graceful shutdown');
        resolve();
      } catch (err) {
        fail('Signal handling: SIGINT graceful shutdown', err);
        reject(err);
      }
    });

    // Give server time to connect, then send SIGINT
    setTimeout(() => {
      child.kill('SIGINT');
    }, 500);
  });
}

// Subtest 3: Signal Handling - SIGTERM
async function testSigtermHandling() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['./bin/gelada.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrData = '';

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('exit', (code, signal) => {
      try {
        assert.equal(code, 0, `Process exit code should be 0 on SIGTERM, got ${code}`);
        assert.ok(stderrData.includes('Received SIGTERM'), 'Stderr should log SIGTERM receipt');
        pass('Signal handling: SIGTERM graceful shutdown');
        resolve();
      } catch (err) {
        fail('Signal handling: SIGTERM graceful shutdown', err);
        reject(err);
      }
    });

    // Give server time to connect, then send SIGTERM
    setTimeout(() => {
      child.kill('SIGTERM');
    }, 500);
  });
}

async function main() {
  await testServerInitialization();
  await testSigintHandling();
  await testSigtermHandling();

  console.log(`\n=== STDIO LAUNCH TEST SUMMARY: ${passCount}/${testCount} PASSED ===`);
  if (passCount !== testCount) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in stdio launch test:', err);
  process.exit(1);
});
