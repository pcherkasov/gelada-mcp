import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createGeladaServer } from '../dist/server.js';

console.log('=== STARTING M3 AUDIT EMPIRICAL VERIFICATION TESTS ===');

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

// Subtest 1: Verify GeladaServer tool registration in-process
async function testToolRegistration() {
  const server = createGeladaServer();
  const mcpServer = server.getMcpServer();
  assert.ok(mcpServer, 'McpServer should be instantiated');

  // Verify internal registered tools via McpServer internal state or JSON-RPC listTools handler
  // Using JSON-RPC protocol over Stdio for end-to-end verification
  pass('GeladaServer instantiates and registers tools without throwing');
}

// Subtest 2: End-to-End JSON-RPC tools/list and tools/call test over stdio child process
async function testJsonRpcTools() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['./bin/gelada.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrData = '';
    let stdoutBuffer = '';
    const responses = new Map();

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      // Keep unfinished line in buffer
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) {
            responses.set(msg.id, msg);
          }
        } catch (e) {
          // ignore non-JSON or partial
        }
      }

      // Check if we received responses for our test requests
      if (responses.has(1) && responses.has(2) && responses.has(3) && responses.has(4)) {
        try {
          // Response 1: initialize
          const initRes = responses.get(1);
          assert.equal(initRes.result.serverInfo.name, 'gelada-mcp');

          // Response 2: tools/list
          const listRes = responses.get(2);
          assert.ok(listRes.result, 'Result should exist for tools/list');
          const tools = listRes.result.tools;
          assert.equal(tools.length, 7, `Expected 7 registered tools, got ${tools.length}`);

          const toolNames = tools.map((t) => t.name).sort();
          assert.deepEqual(
            toolNames,
            [
              'cancel_task',
              'delegate_task',
              'discard_task',
              'doctor',
              'inspect_task',
              'list_workers',
              'revise_task',
            ],
            'All tools must be registered',
          );

          // Response 3: tools/call delegate_task
          const delegateRes = responses.get(3);
          assert.ok(delegateRes.result, 'Result should exist for delegate_task call');
          const delegateContent = JSON.parse(delegateRes.result.content[0].text);
          assert.ok(delegateContent.taskId.startsWith('task-'));
          assert.equal(delegateContent.status, 'completed');
          assert.equal(delegateContent.taskType, 'unit-test');

          // Response 4: tools/call doctor
          const doctorRes = responses.get(4);
          assert.ok(doctorRes.result, 'Result should exist for doctor call');
          const doctorContent = JSON.parse(doctorRes.result.content[0].text);
          assert.equal(doctorContent.status, 'ok');
          assert.equal(doctorContent.geladaVersion, '0.1.0');

          pass('End-to-End JSON-RPC tools/list and tools/call over stdio');
          child.kill();
          resolve();
        } catch (err) {
          child.kill();
          fail('End-to-End JSON-RPC tools test', err);
          reject(err);
        }
      }
    });

    child.on('error', (err) => {
      fail('Stdio child process error', err);
      reject(err);
    });

    // Write sequence of JSON-RPC requests
    const requests = [
      // 1: initialize
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'm3-audit-harness', version: '1.0.0' },
        },
      }),
      // 2: tools/list
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
      // 3: tools/call delegate_task
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'delegate_task',
          arguments: {
            taskType: 'unit-test',
            objective: 'Write unit tests for authentication module',
          },
        },
      }),
      // 4: tools/call doctor
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'doctor',
          arguments: {
            verbose: true,
          },
        },
      }),
    ];

    child.stdin.write(requests.join('\n') + '\n');

    setTimeout(() => {
      if (!responses.has(4)) {
        child.kill();
        fail(
          'End-to-End JSON-RPC tools test',
          new Error(`Timeout waiting for responses. Stderr: ${stderrData}`),
        );
        reject(new Error('Timeout'));
      }
    }, 5000);
  });
}

async function main() {
  await testToolRegistration();
  await testJsonRpcTools();

  console.log(`\n=== M3 AUDIT VERIFICATION SUMMARY: ${passCount}/${testCount} PASSED ===`);
  if (passCount !== testCount) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in M3 audit verification test:', err);
  process.exit(1);
});
