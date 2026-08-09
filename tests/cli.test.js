import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * The server is registered with an absolute entrypoint rather than the bare
 * `gelada` name, so the registration survives PATH changes (node version
 * managers in particular). Assert the shape, not one specific spelling.
 */
function assertGeladaRegistration(entry) {
  assert.ok(entry, 'gelada-mcp must be registered');
  assert.ok(typeof entry.command === 'string' && entry.command.length > 0);
  assert.deepEqual(entry.args.slice(-2), ['mcp', 'serve']);
  if (entry.command !== 'gelada') {
    assert.ok(
      entry.args.some((a) => String(a).endsWith('gelada.js')),
      `expected an absolute gelada entrypoint in args, got ${JSON.stringify(entry.args)}`,
    );
  }
}


const execFileAsync = promisify(execFile);
const GELADA_BIN = path.resolve(process.cwd(), 'bin/gelada.js');

console.log('=== STARTING GELADA CLI COMPREHENSIVE TEST SUITE ===');

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

// Subtest 1: Binary help output
async function testCliHelp() {
  const { stdout } = await execFileAsync(process.execPath, [GELADA_BIN, '--help']);
  assert.match(stdout, /Usage: gelada/);
  assert.match(stdout, /setup/);
  assert.match(stdout, /doctor/);
  assert.match(stdout, /config/);
  assert.match(stdout, /task/);
  assert.match(stdout, /mcp/);
  pass('CLI binary execution --help output');
}

// Subtest 2: Diagnostic execution
async function testDoctorCommand() {
  const { stdout: textOut } = await execFileAsync(process.execPath, [GELADA_BIN, 'doctor']);
  assert.match(textOut, /Node\.js/);
  assert.match(textOut, /Git/);

  const { stdout: jsonOut } = await execFileAsync(process.execPath, [
    GELADA_BIN,
    'doctor',
    '--json',
  ]);
  const report = JSON.parse(jsonOut);
  assert.ok(report.checks);
  assert.ok(Array.isArray(report.checks));
  assert.ok(report.overallStatus);
  pass('gelada doctor (text & json formats)');
}

// Subtest 3: Setup command with temp directory isolation
async function testSetupCommand() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-cli-setup-'));
  try {
    await execFileAsync(process.execPath, [GELADA_BIN, 'setup'], {
      env: { ...process.env, GELADA_CONFIG_DIR: tmpDir },
    });
    const configPath = path.join(tmpDir, 'config.json');
    assert.ok(fs.existsSync(configPath), 'config.json should be created in custom config dir');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(parsed.version);
    assert.ok(parsed.worker);
    pass('gelada setup with GELADA_CONFIG_DIR override');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Subtest 3b: Setup command client integration, non-clobbering merge, backup creation, and clean uninstall
async function testSetupClientIntegrationAndUninstall() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-cli-home-'));
  const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-cli-config-'));

  try {
    // Prepare fake existing client config files in tmpHome
    const claudeJsonPath = path.join(tmpHome, '.claude.json');
    const existingClaudeConfig = {
      mcpServers: {
        'existing-server': {
          command: 'node',
          args: ['server.js'],
        },
      },
    };
    fs.writeFileSync(claudeJsonPath, JSON.stringify(existingClaudeConfig, null, 2), 'utf-8');

    // Run gelada setup targeting tmpHome
    const { stdout: setupOut } = await execFileAsync(
      process.execPath,
      [GELADA_BIN, 'setup', '--json'],
      {
        env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir, GELADA_HOME_DIR: tmpHome },
      },
    );

    const setupResult = JSON.parse(setupOut);
    assert.equal(setupResult.success, true);
    assert.ok(setupResult.clientUpdates, 'clientUpdates should be returned');
    assert.ok(Array.isArray(setupResult.detectedClients), 'detectedClients should be an array');
    const claudeClient = setupResult.detectedClients.find(
      (c) => c.clientType === 'claude-code' && c.configPath.endsWith('.claude.json'),
    );
    assert.ok(claudeClient, 'Claude Code CLI client should be in detectedClients list');
    assert.equal(claudeClient.exists, true, 'Claude Code CLI client exists flag should be true');

    // 1. Verify backup file was created
    const backupPath = `${claudeJsonPath}.bak`;
    assert.ok(fs.existsSync(backupPath), 'Backup file .claude.json.bak should exist');
    const backupContent = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    assert.deepEqual(backupContent, existingClaudeConfig, 'Backup file should preserve original config');

    // 2. Verify non-clobbering registration in updated .claude.json
    const updatedClaudeConfig = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
    assert.ok(updatedClaudeConfig.mcpServers['existing-server'], 'Existing MCP server must be preserved');
    assert.ok(updatedClaudeConfig.mcpServers['gelada-mcp'], 'gelada-mcp server must be registered');
    assertGeladaRegistration(updatedClaudeConfig.mcpServers['gelada-mcp']);

    // 3. Run gelada setup --uninstall
    const { stdout: uninstallOut } = await execFileAsync(
      process.execPath,
      [GELADA_BIN, 'setup', '--uninstall', '--json'],
      {
        env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir, GELADA_HOME_DIR: tmpHome },
      },
    );

    const uninstallResult = JSON.parse(uninstallOut);
    assert.equal(uninstallResult.success, true);

    // 4. Verify gelada-mcp is removed and existing-server is untouched
    const postUninstallConfig = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
    assert.ok(postUninstallConfig.mcpServers['existing-server'], 'Existing server must remain after uninstall');
    assert.equal(postUninstallConfig.mcpServers['gelada-mcp'], undefined, 'gelada-mcp must be removed after uninstall');

    // 5. Test --remove alias as well
    // First re-register
    await execFileAsync(process.execPath, [GELADA_BIN, 'setup', '--json'], {
      env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir, GELADA_HOME_DIR: tmpHome },
    });
    const reRegisteredConfig = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
    assert.ok(reRegisteredConfig.mcpServers['gelada-mcp'], 'gelada-mcp re-registered');

    // Run setup --remove
    await execFileAsync(process.execPath, [GELADA_BIN, 'setup', '--remove', '--json'], {
      env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir, GELADA_HOME_DIR: tmpHome },
    });
    const postRemoveConfig = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
    assert.equal(postRemoveConfig.mcpServers['gelada-mcp'], undefined, 'gelada-mcp must be removed with --remove flag');

    pass('gelada setup client detection, backup creation, non-clobbering merge, and --uninstall/--remove removal');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
}

// Subtest 4: Config command
async function testConfigCommand() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-cli-config-'));
  try {
    await execFileAsync(process.execPath, [GELADA_BIN, 'setup'], {
      env: { ...process.env, GELADA_CONFIG_DIR: tmpDir },
    });

    const { stdout: jsonOut } = await execFileAsync(
      process.execPath,
      [GELADA_BIN, 'config', 'list', '--json'],
      {
        env: { ...process.env, GELADA_CONFIG_DIR: tmpDir },
      },
    );
    const parsed = JSON.parse(jsonOut);
    assert.equal(parsed.worker.command, 'agy');

    await execFileAsync(
      process.execPath,
      [GELADA_BIN, 'config', 'set', 'worker.timeoutSeconds', '600'],
      {
        env: { ...process.env, GELADA_CONFIG_DIR: tmpDir },
      },
    );

    const { stdout: getOut } = await execFileAsync(
      process.execPath,
      [GELADA_BIN, 'config', 'get', 'worker.timeoutSeconds'],
      {
        env: { ...process.env, GELADA_CONFIG_DIR: tmpDir },
      },
    );
    assert.equal(getOut.trim(), '600');
    pass('gelada config list, get, and set subcommands');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Subtest 5: Task subcommands
async function testTaskCommands() {
  // inspect
  const { stdout: inspectOut } = await execFileAsync(process.execPath, [
    GELADA_BIN,
    'task',
    'inspect',
    'task-1001',
    '--json',
  ]);
  const inspectData = JSON.parse(inspectOut);
  assert.equal(inspectData.taskId, 'task-1001');

  // patch
  const { stdout: patchOut } = await execFileAsync(process.execPath, [
    GELADA_BIN,
    'task',
    'patch',
    'task-1001',
    '-m',
    'Fix bug',
    '--json',
  ]);
  const patchData = JSON.parse(patchOut);
  assert.equal(patchData.taskId, 'task-1001');
  assert.equal(patchData.patchApplied, true);

  // discard
  const { stdout: discardOut } = await execFileAsync(process.execPath, [
    GELADA_BIN,
    'task',
    'discard',
    'task-1001',
    '--json',
  ]);
  const discardData = JSON.parse(discardOut);
  assert.equal(discardData.taskId, 'task-1001');
  assert.equal(discardData.status, 'CANCELLED');

  pass('gelada task inspect/patch/discard subcommands');
}

// Subtest 6: Stdio launch via mcp serve
async function testMcpServeCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GELADA_BIN, 'mcp', 'serve'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrData = '';
    let stdoutData = '';

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      try {
        const lines = stdoutData.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            assert.equal(msg.result.serverInfo.name, 'gelada-mcp');
            child.kill('SIGINT');
          }
        }
      } catch {
        // partial JSON frame
      }
    });

    child.on('exit', (code) => {
      try {
        assert.equal(code, 0, `gelada mcp serve should exit with code 0 on SIGINT, got ${code}`);
        assert.ok(
          stderrData.includes('Received SIGINT') ||
            stderrData.includes('shutting down') ||
            stderrData.includes('connected'),
          'Stderr should log shutdown/connection info',
        );
        pass('gelada mcp serve stdio launch and signal shutdown');
        resolve();
      } catch (err) {
        fail('gelada mcp serve stdio launch', err);
        reject(err);
      }
    });

    const initPayload =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'cli-test-harness', version: '1.0.0' },
        },
      }) + '\n';

    child.stdin.write(initPayload);
  });
}

// Subtest 7: Zero-argument default execution
async function testZeroArgDefaultExecution() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GELADA_BIN], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrData = '';
    let stdoutData = '';

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      try {
        const lines = stdoutData.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            assert.equal(msg.result.serverInfo.name, 'gelada-mcp');
            child.kill('SIGINT');
          }
        }
      } catch {
        // partial JSON frame
      }
    });

    child.on('exit', (code) => {
      try {
        assert.equal(
          code,
          0,
          `Zero-arg gelada binary should exit with code 0 on SIGINT, got ${code}`,
        );
        assert.ok(
          stderrData.includes('Gelada MCP server connected'),
          'Stderr should indicate server launch in zero-arg fallback',
        );
        pass('Zero-argument default execution (mcp serve fallback)');
        resolve();
      } catch (err) {
        fail('Zero-argument default execution', err);
        reject(err);
      }
    });

    const initPayload =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'cli-test-harness', version: '1.0.0' },
        },
      }) + '\n';

    child.stdin.write(initPayload);
  });
}

// Subtest 8: Cleanup subcommand
async function testCleanupCommand() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-cli-cleanup-'));
  try {
    const { stdout: textOut } = await execFileAsync(process.execPath, [
      GELADA_BIN,
      'cleanup',
      '--repo',
      tmpDir,
    ]);
    assert.match(textOut, /No task bundles required cleanup/);

    const { stdout: jsonOut } = await execFileAsync(process.execPath, [
      GELADA_BIN,
      'cleanup',
      '--repo',
      tmpDir,
      '--json',
    ]);
    const report = JSON.parse(jsonOut);
    assert.equal(report.success, true);
    assert.equal(report.deletedCount, 0);
    assert.equal(report.remainingBundles, 0);
    pass('gelada cleanup (text & json formats)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  await testCliHelp();
  await testDoctorCommand();
  await testSetupCommand();
  await testSetupClientIntegrationAndUninstall();
  await testConfigCommand();
  await testTaskCommands();
  await testCleanupCommand();
  await testMcpServeCommand();
  await testZeroArgDefaultExecution();

  console.log(`\n=== CLI TEST SUMMARY: ${passCount}/${testCount} PASSED ===`);
  if (passCount !== testCount) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal CLI test failure:', err);
  process.exit(1);
});
