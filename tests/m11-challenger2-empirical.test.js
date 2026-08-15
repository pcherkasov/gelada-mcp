import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as syncFs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  detectMcpClients,
  updateClientConfigs,
  runSetup,
  DEFAULT_GELADA_CONFIG,
} from '../dist/cli/commands/setup.js';

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


describe('Milestone 11 Challenger 2 — Setup & Client Integration Empirical Stress Suite', () => {
  let tempDir;
  let originalEnv;
  let originalPlatform;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-m11-ch2-'));
    originalEnv = { ...process.env };
    originalPlatform = process.platform;
  });

  afterEach(async () => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. Nested Config Paths Across OS Platforms (macOS, Linux, Windows)', () => {
    it('detects correct nested candidate paths for macOS (darwin)', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const clients = detectMcpClients(tempDir);

      const paths = clients.map((c) => c.configPath);
      assert.ok(
        paths.some((p) =>
          p.includes(
            path.join('Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
          ),
        ),
        'macOS Claude Desktop path missing',
      );
      assert.ok(
        paths.some((p) => p.includes('.claude.json')),
        'macOS Claude Code ~/.claude.json path missing',
      );
      assert.ok(
        paths.some((p) => p.includes(path.join('.config', 'claude-code', 'config.json'))),
        'macOS Claude Code ~/.config path missing',
      );
      assert.ok(
        paths.some((p) => p.includes(path.join('.codex', 'config.json'))),
        'macOS Codex path missing',
      );
      assert.ok(
        paths.some((p) => p.includes(path.join('.gemini', 'config', 'mcp_config.json'))),
        'macOS Antigravity path missing',
      );
      assert.equal(clients.length, 8, 'Expected 8 candidates on macOS');
    });

    it('detects correct nested candidate paths for Windows (win32)', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const mockAppData = path.join(tempDir, 'AppData', 'Roaming');
      process.env.APPDATA = mockAppData;

      const clients = detectMcpClients(tempDir);
      const paths = clients.map((c) => c.configPath);

      assert.ok(
        paths.some((p) =>
          p.includes(path.join(mockAppData, 'Claude', 'claude_desktop_config.json')),
        ),
        'Windows AppData Claude Desktop path missing',
      );
      assert.ok(
        paths.some((p) => p.includes(path.join(mockAppData, 'Codex', 'config.json'))),
        'Windows AppData Codex path missing',
      );
      assert.ok(
        paths.some((p) => p.includes(path.join('.gemini', 'config', 'mcp_config.json'))),
        'Windows Antigravity path missing',
      );
      assert.equal(clients.length, 9, 'Expected 9 candidates on Windows');
    });

    it('detects correct nested candidate paths for Linux (linux)', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const clients = detectMcpClients(tempDir);
      const paths = clients.map((c) => c.configPath);

      assert.ok(
        paths.some((p) =>
          p.includes(path.join('.config', 'Claude', 'claude_desktop_config.json')),
        ),
        'Linux Claude Desktop path missing',
      );
      assert.ok(
        paths.some((p) => p.includes(path.join('.gemini', 'config', 'mcp_config.json'))),
        'Linux Antigravity path missing',
      );
      assert.equal(clients.length, 8, 'Expected 8 candidates on Linux');
    });

    it('handles deeply nested custom --config-dir during runSetup', async () => {
      const nestedConfigDir = path.join(tempDir, 'deep', 'nested', 'level1', 'level2', 'config');
      process.env.GELADA_CONFIG_DIR = nestedConfigDir;
      process.env.GELADA_DATA_DIR = path.join(nestedConfigDir, 'data');
      process.env.GELADA_LOG_DIR = path.join(nestedConfigDir, 'logs');

      const result = await runSetup({ configDir: nestedConfigDir, homeDir: tempDir });

      assert.equal(result.success, true);
      assert.ok(syncFs.existsSync(result.configDir));
      assert.ok(syncFs.existsSync(result.configFile));
      assert.ok(result.createdDirs.includes(result.configDir));

      const writtenConfig = JSON.parse(await fs.readFile(result.configFile, 'utf-8'));
      assert.deepEqual(writtenConfig, DEFAULT_GELADA_CONFIG);
    });
  });

  describe('2. Non-Existent Directories & File Isolation', () => {
    it('skips client registration if homeDir itself does not exist', () => {
      const nonExistentHome = path.join(tempDir, 'nonexistent-home');
      const { clientUpdates } = updateClientConfigs({ homeDir: nonExistentHome });

      for (const update of clientUpdates) {
        assert.equal(
          update.action,
          'skipped',
          `Client ${update.clientName} should be skipped when home parent dir does not exist`,
        );
      }
    });

    it('skips clients whose subdirectories do not exist in homeDir, but registers direct home files like ~/.claude.json', () => {
      // tempDir exists (represents homedir), but subdirectories like .codex do not exist
      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir });

      const codexUpdate = clientUpdates.find((u) => u.configPath.includes('.codex'));
      assert.ok(codexUpdate);
      assert.equal(codexUpdate.action, 'skipped');

      const claudeHomeUpdate = clientUpdates.find((u) => u.configPath === path.join(tempDir, '.claude.json'));
      assert.ok(claudeHomeUpdate);
      assert.equal(claudeHomeUpdate.action, 'registered');
    });

    it('registers client if client parent directory exists but config file is missing', async () => {
      const codexDir = path.join(tempDir, '.codex');
      await fs.mkdir(codexDir, { recursive: true });

      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir });

      const codexUpdate = clientUpdates.find((u) => u.configPath === path.join(codexDir, 'config.json'));
      assert.ok(codexUpdate);
      assert.equal(codexUpdate.action, 'registered');
      assert.ok(syncFs.existsSync(path.join(codexDir, 'config.json')));

      const content = JSON.parse(await fs.readFile(path.join(codexDir, 'config.json'), 'utf-8'));
      assertGeladaRegistration(content.mcpServers['gelada-mcp']);
    });

    it('gracefully skips uninstallation when client config files do not exist', () => {
      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir, uninstall: true });

      for (const update of clientUpdates) {
        assert.equal(update.action, 'skipped');
      }
    });
  });

  describe('3. Invalid & Malformed JSON File Edge Cases', () => {
    it('returns action: error when existing client config file contains invalid JSON during setup', async () => {
      const codexDir = path.join(tempDir, '.codex');
      await fs.mkdir(codexDir, { recursive: true });
      const configPath = path.join(codexDir, 'config.json');
      await fs.writeFile(configPath, '{ invalid json syntax ...');

      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir });

      const update = clientUpdates.find((u) => u.configPath === configPath);
      assert.ok(update);
      assert.equal(update.action, 'error');
      assert.equal(update.error, 'Failed to parse JSON config file');

      // Verify corrupt file is NOT destroyed or overwritten
      const rawContent = await fs.readFile(configPath, 'utf-8');
      assert.equal(rawContent, '{ invalid json syntax ...');
    });

    it('returns action: error when existing client config file contains invalid JSON during uninstall', async () => {
      const codexDir = path.join(tempDir, '.codex');
      await fs.mkdir(codexDir, { recursive: true });
      const configPath = path.join(codexDir, 'config.json');
      await fs.writeFile(configPath, '{ broken json content');

      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir, uninstall: true });

      const update = clientUpdates.find((u) => u.configPath === configPath);
      assert.ok(update);
      assert.equal(update.action, 'error');
      assert.equal(update.error, 'Failed to parse JSON config file');

      // File remains untouched
      assert.equal(await fs.readFile(configPath, 'utf-8'), '{ broken json content');
    });

    it('populates empty config file (0 bytes) gracefully during setup', async () => {
      const codexDir = path.join(tempDir, '.codex');
      await fs.mkdir(codexDir, { recursive: true });
      const configPath = path.join(codexDir, 'config.json');
      await fs.writeFile(configPath, '   \n');

      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir });

      const update = clientUpdates.find((u) => u.configPath === configPath);
      assert.ok(update);
      assert.equal(update.action, 'registered');

      const parsed = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      assertGeladaRegistration(parsed.mcpServers['gelada-mcp']);
    });

    it('handles non-object JSON values (e.g. primitive 123) without process crash', async () => {
      const codexDir = path.join(tempDir, '.codex');
      await fs.mkdir(codexDir, { recursive: true });
      const configPath = path.join(codexDir, 'config.json');
      await fs.writeFile(configPath, '123');

      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir });

      const update = clientUpdates.find((u) => u.configPath === configPath);
      assert.ok(update);
      assert.equal(update.action, 'error');
      assert.ok(update.error !== undefined);
    });
  });

  describe('4. Multiple Client Types & Client Filtering Simultaneously', () => {
    it('registers multiple distinct client types simultaneously when client: all', async () => {
      // Set up parent directories for multiple clients
      const claudeCodeFile = path.join(tempDir, '.claude.json');
      const claudeConfigDir = path.join(tempDir, '.config', 'claude-code');
      const codexDir = path.join(tempDir, '.codex');

      await fs.writeFile(claudeCodeFile, JSON.stringify({ mcpServers: {} }));
      await fs.mkdir(claudeConfigDir, { recursive: true });
      await fs.mkdir(codexDir, { recursive: true });
      await fs.writeFile(path.join(codexDir, 'config.json'), JSON.stringify({ mcpServers: {} }));

      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir, client: 'all' });

      const registered = clientUpdates.filter((u) => u.action === 'registered');
      assert.ok(registered.length >= 3, `Expected at least 3 registered clients, got ${registered.length}`);

      // Verify backup files (.bak) were created for existing files
      assert.ok(syncFs.existsSync(`${claudeCodeFile}.bak`));
      assert.ok(syncFs.existsSync(`${path.join(codexDir, 'config.json')}.bak`));
    });

    it('filters target clients correctly when option.client is set', async () => {
      const claudeCodeFile = path.join(tempDir, '.claude.json');
      const codexDir = path.join(tempDir, '.codex');
      await fs.writeFile(claudeCodeFile, JSON.stringify({}));
      await fs.mkdir(codexDir, { recursive: true });
      await fs.writeFile(path.join(codexDir, 'config.json'), JSON.stringify({}));

      // Filter by 'codex'
      const { clientUpdates: codexOnly } = updateClientConfigs({ homeDir: tempDir, client: 'codex' });
      assert.ok(codexOnly.every((u) => u.clientName.toLowerCase().includes('codex')));

      // Filter by 'claude'
      const { clientUpdates: claudeOnly } = updateClientConfigs({ homeDir: tempDir, client: 'claude' });
      assert.ok(claudeOnly.every((u) => u.clientName.toLowerCase().includes('claude')));
    });

    it('uninstalls gelada-mcp from all clients simultaneously', async () => {
      const claudeCodeFile = path.join(tempDir, '.claude.json');
      const codexFile = path.join(tempDir, '.codex', 'config.json');
      await fs.mkdir(path.join(tempDir, '.codex'), { recursive: true });

      const initialConfig = {
        mcpServers: {
          'gelada-mcp': { command: 'gelada', args: ['mcp', 'serve'] },
          'other-server': { command: 'node', args: ['index.js'] },
        },
      };

      await fs.writeFile(claudeCodeFile, JSON.stringify(initialConfig));
      await fs.writeFile(codexFile, JSON.stringify(initialConfig));

      const { clientUpdates } = updateClientConfigs({ homeDir: tempDir, uninstall: true });

      const uninstalled = clientUpdates.filter((u) => u.action === 'uninstalled');
      assert.equal(uninstalled.length, 2, 'Expected 2 clients uninstalled');

      const claudeContent = JSON.parse(await fs.readFile(claudeCodeFile, 'utf-8'));
      const codexContent = JSON.parse(await fs.readFile(codexFile, 'utf-8'));

      assert.equal(claudeContent.mcpServers['gelada-mcp'], undefined);
      assert.deepEqual(claudeContent.mcpServers['other-server'], { command: 'node', args: ['index.js'] });

      assert.equal(codexContent.mcpServers['gelada-mcp'], undefined);
      assert.deepEqual(codexContent.mcpServers['other-server'], { command: 'node', args: ['index.js'] });
    });
  });

  describe('5. 100% Preservation of Existing Server Entries in mcpServers', () => {
    it('preserves pre-existing mcpServers and root attributes 100% untouched during setup', async () => {
      const codexDir = path.join(tempDir, '.codex');
      await fs.mkdir(codexDir, { recursive: true });
      const configPath = path.join(codexDir, 'config.json');

      const originalConfig = {
        mcpServers: {
          'alpha-mcp': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-alpha'],
            env: { API_KEY: 'secret-123' },
            disabled: false,
          },
          'beta-mcp': {
            command: 'python3',
            args: ['-m', 'beta_server'],
            autoApprove: ['read_file', 'list_dir'],
          },
        },
        theme: 'dark-mode',
        telemetry: false,
        nestedCustomConfig: {
          nestedKey: 'nestedValue',
          list: [1, 2, 3],
        },
      };

      await fs.writeFile(configPath, JSON.stringify(originalConfig, null, 2));

      updateClientConfigs({ homeDir: tempDir });

      const updated = JSON.parse(await fs.readFile(configPath, 'utf-8'));

      // Check gelada-mcp is added
      assertGeladaRegistration(updated.mcpServers['gelada-mcp']);

      // Check pre-existing servers are 100% untouched
      assert.deepEqual(updated.mcpServers['alpha-mcp'], originalConfig.mcpServers['alpha-mcp']);
      assert.deepEqual(updated.mcpServers['beta-mcp'], originalConfig.mcpServers['beta-mcp']);

      // Check root level attributes are 100% untouched
      assert.equal(updated.theme, originalConfig.theme);
      assert.equal(updated.telemetry, originalConfig.telemetry);
      assert.deepEqual(updated.nestedCustomConfig, originalConfig.nestedCustomConfig);
    });

    it('preserves pre-existing mcpServers 100% untouched during uninstall (removing only gelada-mcp)', async () => {
      const codexDir = path.join(tempDir, '.codex');
      await fs.mkdir(codexDir, { recursive: true });
      const configPath = path.join(codexDir, 'config.json');

      const preUninstallConfig = {
        mcpServers: {
          'alpha-mcp': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-alpha'],
            env: { API_KEY: 'secret-123' },
          },
          'gelada-mcp': {
            command: 'gelada',
            args: ['mcp', 'serve'],
          },
          'gelada': {
            command: 'gelada-legacy',
            args: ['mcp'],
          },
          'gamma-mcp': {
            command: 'docker',
            args: ['run', '-i', 'gamma-server:latest'],
          },
        },
        userPreference: {
          fontSize: 14,
        },
      };

      await fs.writeFile(configPath, JSON.stringify(preUninstallConfig, null, 2));

      updateClientConfigs({ homeDir: tempDir, uninstall: true });

      const afterUninstall = JSON.parse(await fs.readFile(configPath, 'utf-8'));

      // Check gelada-mcp and gelada legacy are deleted
      assert.equal(afterUninstall.mcpServers['gelada-mcp'], undefined);
      assert.equal(afterUninstall.mcpServers['gelada'], undefined);

      // Check all remaining mcpServers entries are 100% untouched
      assert.deepEqual(afterUninstall.mcpServers['alpha-mcp'], preUninstallConfig.mcpServers['alpha-mcp']);
      assert.deepEqual(afterUninstall.mcpServers['gamma-mcp'], preUninstallConfig.mcpServers['gamma-mcp']);

      // Check user preferences untouched
      assert.deepEqual(afterUninstall.userPreference, preUninstallConfig.userPreference);
    });
  });
});
