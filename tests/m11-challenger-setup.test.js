import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectMcpClients, updateClientConfigs, runSetup } from '../dist/cli/commands/setup.js';

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
      entry.args.some((a) => a.endsWith('gelada.js')),
      `expected an absolute gelada entrypoint in args, got ${JSON.stringify(entry.args)}`,
    );
  }
}


const execFileAsync = promisify(execFile);
const GELADA_BIN = path.resolve(process.cwd(), 'bin/gelada.js');

const tmpGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-global-env-'));
process.env.GELADA_DATA_DIR = path.join(tmpGlobalDir, 'data');
process.env.GELADA_LOG_DIR = path.join(tmpGlobalDir, 'log');

console.log('=== STARTING M11 CHALLENGER SETUP STRESS TEST SUITE ===');

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

// 1. Stress-test Client Discovery across all paths
async function testClientDiscovery() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-discovery-'));
  try {
    // Create a subset of client dirs/files
    const claudeCodeFile = path.join(tmpHome, '.claude.json');
    fs.writeFileSync(claudeCodeFile, '{}', 'utf-8');

    const codexDir = path.join(tmpHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    const codexFile = path.join(codexDir, 'config.json');
    fs.writeFileSync(codexFile, '{}', 'utf-8');

    const codexMcpFile = path.join(codexDir, 'mcp.json');
    fs.writeFileSync(codexMcpFile, '{}', 'utf-8');

    const detected = detectMcpClients(tmpHome);
    assert.ok(Array.isArray(detected), 'Should return an array of client candidates');
    
    // Check claude-code detection
    const claudeCode = detected.find(c => c.configPath === claudeCodeFile);
    assert.ok(claudeCode, 'Should detect ~/.claude.json');
    assert.equal(claudeCode.exists, true, 'claudeCode exists should be true');
    assert.equal(claudeCode.clientType, 'claude-code');

    // Check codex detection
    const codexConfig = detected.find(c => c.configPath === codexFile);
    assert.ok(codexConfig, 'Should detect ~/.codex/config.json');
    assert.equal(codexConfig.exists, true, 'codexConfig exists should be true');
    assert.equal(codexConfig.clientType, 'codex');

    const codexMcp = detected.find(c => c.configPath === codexMcpFile);
    assert.ok(codexMcp, 'Should detect ~/.codex/mcp.json');
    assert.equal(codexMcp.exists, true, 'codexMcp exists should be true');
    assert.equal(codexMcp.clientType, 'codex');

    // Check non-existent client path
    const claudeCodeConfig = detected.find(c => c.configPath.endsWith(path.join('.config', 'claude-code', 'config.json')));
    assert.ok(claudeCodeConfig);
    assert.equal(claudeCodeConfig.exists, false, 'Non-existent file should report exists: false');

    pass('Client discovery across all supported paths and existence checking');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

// 2. Non-clobbering addition with multiple pre-configured servers and extra config fields
async function testNonClobberingAddition() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-nonclobber-home-'));
  const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-nonclobber-config-'));

  try {
    const tmpDataDir = path.join(tmpConfigDir, 'data');
    const tmpLogDir = path.join(tmpConfigDir, 'log');
    process.env.GELADA_DATA_DIR = tmpDataDir;
    process.env.GELADA_LOG_DIR = tmpLogDir;

    // 1. Setup existing multi-server config in ~/.claude.json
    const claudeFile = path.join(tmpHome, '.claude.json');
    const originalClaudeConfig = {
      theme: 'dark',
      customSetting: 42,
      mcpServers: {
        'github-mcp': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        'postgres-mcp': { command: 'node', args: ['/path/to/postgres.js'] },
        'filesystem': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      },
    };
    fs.writeFileSync(claudeFile, JSON.stringify(originalClaudeConfig, null, 2), 'utf-8');

    // 2. Setup existing config in ~/.codex/config.json
    const codexDir = path.join(tmpHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    const codexFile = path.join(codexDir, 'config.json');
    const originalCodexConfig = {
      model: 'gpt-4o',
      mcpServers: {
        'stripe-mcp': { command: 'npx', args: ['-y', 'stripe-mcp'] },
      },
    };
    fs.writeFileSync(codexFile, JSON.stringify(originalCodexConfig, null, 2), 'utf-8');

    // Run setup
    const result = await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir });
    assert.equal(result.success, true);

    // Verify Claude config
    const updatedClaude = JSON.parse(fs.readFileSync(claudeFile, 'utf-8'));
    assert.equal(updatedClaude.theme, 'dark');
    assert.equal(updatedClaude.customSetting, 42);
    assert.ok(updatedClaude.mcpServers['github-mcp']);
    assert.ok(updatedClaude.mcpServers['postgres-mcp']);
    assert.ok(updatedClaude.mcpServers['filesystem']);
    assert.ok(updatedClaude.mcpServers['gelada-mcp']);
    assertGeladaRegistration(updatedClaude.mcpServers['gelada-mcp']);
    
    // Verify Codex config
    const updatedCodex = JSON.parse(fs.readFileSync(codexFile, 'utf-8'));
    assert.equal(updatedCodex.model, 'gpt-4o');
    assert.ok(updatedCodex.mcpServers['stripe-mcp']);
    assert.ok(updatedCodex.mcpServers['gelada-mcp']);
    assertGeladaRegistration(updatedCodex.mcpServers['gelada-mcp']);

    pass('Non-clobbering addition preserving multiple existing servers and custom properties');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
}

// 3. Backup creation (.bak) verification
async function testBackupCreation() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-backup-home-'));
  const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-backup-config-'));

  try {
    const claudeFile = path.join(tmpHome, '.claude.json');
    const initialConfig = { mcpServers: { myServer: { command: 'echo' } } };
    fs.writeFileSync(claudeFile, JSON.stringify(initialConfig, null, 2), 'utf-8');

    const result = await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir });
    const claudeUpdate = result.clientUpdates?.find(u => u.configPath === claudeFile);
    assert.ok(claudeUpdate, 'claude.json should have client update result');
    assert.equal(claudeUpdate.action, 'registered');
    assert.ok(claudeUpdate.backupPath, 'backupPath should be populated');
    assert.ok(fs.existsSync(claudeUpdate.backupPath), 'Backup file should exist on disk');

    const backupContent = JSON.parse(fs.readFileSync(claudeUpdate.backupPath, 'utf-8'));
    assert.deepEqual(backupContent, initialConfig, 'Backup file content should match pre-modified state');

    pass('Backup file creation (.bak) before writing modifications');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
}

// 4. Clean removal via --uninstall and --remove
async function testUninstallAndRemove() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-uninstall-home-'));
  const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-uninstall-config-'));

  try {
    const claudeFile = path.join(tmpHome, '.claude.json');
    const codexDir = path.join(tmpHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    const codexFile = path.join(codexDir, 'config.json');

    // First run setup to register
    fs.writeFileSync(claudeFile, JSON.stringify({ mcpServers: { s1: { command: 'node' } } }), 'utf-8');
    fs.writeFileSync(codexFile, JSON.stringify({ mcpServers: { s2: { command: 'python' } } }), 'utf-8');

    await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir });

    // Verify registered
    let cConfig = JSON.parse(fs.readFileSync(claudeFile, 'utf-8'));
    let xConfig = JSON.parse(fs.readFileSync(codexFile, 'utf-8'));
    assert.ok(cConfig.mcpServers['gelada-mcp']);
    assert.ok(xConfig.mcpServers['gelada-mcp']);

    // Now run setup --uninstall
    const uninstallRes = await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir, uninstall: true });
    assert.equal(uninstallRes.success, true);

    cConfig = JSON.parse(fs.readFileSync(claudeFile, 'utf-8'));
    xConfig = JSON.parse(fs.readFileSync(codexFile, 'utf-8'));
    assert.equal(cConfig.mcpServers['gelada-mcp'], undefined, 'gelada-mcp should be deleted from claude.json');
    assert.ok(cConfig.mcpServers['s1'], 's1 server should remain');
    assert.equal(xConfig.mcpServers['gelada-mcp'], undefined, 'gelada-mcp should be deleted from codex config');
    assert.ok(xConfig.mcpServers['s2'], 's2 server should remain');

    // Re-register for --remove testing
    await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir });
    cConfig = JSON.parse(fs.readFileSync(claudeFile, 'utf-8'));
    assert.ok(cConfig.mcpServers['gelada-mcp']);

    // Test --remove
    const removeRes = await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir, remove: true });
    assert.equal(removeRes.success, true);
    cConfig = JSON.parse(fs.readFileSync(claudeFile, 'utf-8'));
    assert.equal(cConfig.mcpServers['gelada-mcp'], undefined, 'gelada-mcp should be deleted using --remove');

    pass('Clean removal via --uninstall and --remove preserving existing servers');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
}

// 5. Selective client filter testing (--client)
async function testClientFiltering() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-filter-home-'));
  const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-filter-config-'));

  try {
    const claudeFile = path.join(tmpHome, '.claude.json');
    const codexDir = path.join(tmpHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    const codexFile = path.join(codexDir, 'config.json');

    fs.writeFileSync(claudeFile, JSON.stringify({ mcpServers: {} }), 'utf-8');
    fs.writeFileSync(codexFile, JSON.stringify({ mcpServers: {} }), 'utf-8');

    // Filter --client claude
    const resultClaude = await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir, client: 'claude' });
    const updatedClaude = JSON.parse(fs.readFileSync(claudeFile, 'utf-8'));
    const updatedCodex = JSON.parse(fs.readFileSync(codexFile, 'utf-8'));
    assert.ok(updatedClaude.mcpServers['gelada-mcp'], 'Claude config should be updated');
    assert.equal(updatedCodex.mcpServers['gelada-mcp'], undefined, 'Codex config should NOT be updated when filtering --client claude');

    // Filter --client codex
    await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir, client: 'codex' });
    const updatedCodex2 = JSON.parse(fs.readFileSync(codexFile, 'utf-8'));
    assert.ok(updatedCodex2.mcpServers['gelada-mcp'], 'Codex config should now be updated with --client codex');

    pass('Selective client targeting via --client option');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
}

// 6. Malformed JSON handling
async function testMalformedJsonHandling() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-malformed-home-'));
  const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-malformed-config-'));

  try {
    const claudeFile = path.join(tmpHome, '.claude.json');
    fs.writeFileSync(claudeFile, '{ invalid json content...', 'utf-8');

    const result = await runSetup({ homeDir: tmpHome, configDir: tmpConfigDir });
    assert.equal(result.success, true);
    const claudeUpdate = result.clientUpdates?.find(u => u.configPath === claudeFile);
    assert.ok(claudeUpdate);
    assert.equal(claudeUpdate.action, 'error');
    assert.equal(claudeUpdate.error, 'Failed to parse JSON config file');

    // Verify file was NOT overwritten with corrupted data
    const contentAfter = fs.readFileSync(claudeFile, 'utf-8');
    assert.equal(contentAfter, '{ invalid json content...');

    pass('Graceful error handling when client JSON file is malformed');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
}

// 7. CLI End-to-end binary execution
async function testCliE2E() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-cli-home-'));
  const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm11-cli-config-'));

  try {
    const claudeFile = path.join(tmpHome, '.claude.json');
    fs.writeFileSync(claudeFile, JSON.stringify({ mcpServers: { existing: { command: 'node' } } }), 'utf-8');

    const { stdout } = await execFileAsync(
      process.execPath,
      [GELADA_BIN, 'setup', '--json'],
      { env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir, GELADA_HOME_DIR: tmpHome } }
    );

    const json = JSON.parse(stdout);
    assert.equal(json.success, true);
    assert.equal(json.configDir, tmpConfigDir);

    const fileContent = JSON.parse(fs.readFileSync(claudeFile, 'utf-8'));
    assert.ok(fileContent.mcpServers['gelada-mcp']);
    assert.ok(fileContent.mcpServers['existing']);

    pass('CLI binary execution end-to-end with --json and env vars');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
}

async function main() {
  await testClientDiscovery();
  await testNonClobberingAddition();
  await testBackupCreation();
  await testUninstallAndRemove();
  await testClientFiltering();
  await testMalformedJsonHandling();
  await testCliE2E();

  console.log(`\n=== M11 CHALLENGER TEST SUMMARY: ${passCount}/${testCount} PASSED ===`);
  if (passCount !== testCount) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal M11 Challenger test failure:', err);
  process.exit(1);
});
