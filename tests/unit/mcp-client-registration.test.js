import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  stableNodePath,
  resolveServerLaunchCommand,
  inspectRegisteredLaunchers,
  detectMcpClients,
} from '../../dist/cli/utils/mcp-clients.js';
import { updateClientConfigs } from '../../dist/cli/commands/setup.js';

const ANTIGRAVITY_CONFIG = ['.gemini', 'config', 'mcp_config.json'];

/**
 * Builds a throwaway Homebrew-shaped tree:
 *
 *   <prefix>/Cellar/<formula>/<version>/bin/node   the keg, deleted on upgrade
 *   <prefix>/opt/<formula> -> ../Cellar/…/<version> the link that survives it
 */
function makeHomebrewTree(root, { formula = 'node', version = '25.9.0_2', linked = true } = {}) {
  const keg = path.join(root, 'Cellar', formula, version);
  fs.mkdirSync(path.join(keg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(keg, 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 });

  if (linked) {
    fs.mkdirSync(path.join(root, 'opt'), { recursive: true });
    fs.symlinkSync(keg, path.join(root, 'opt', formula));
  }

  return {
    execPath: path.join(keg, 'bin', 'node'),
    optPath: path.join(root, 'opt', formula, 'bin', 'node'),
  };
}

describe('MCP client registration paths', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-registration-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('stableNodePath', () => {
    it('rewrites a Homebrew keg path to the versionless opt link', () => {
      const { execPath, optPath } = makeHomebrewTree(tmp);
      assert.equal(stableNodePath(execPath), optPath);
    });

    it('survives the upgrade that deletes the keg it was resolved from', () => {
      const { execPath, optPath } = makeHomebrewTree(tmp, { version: '25.9.0_2' });
      const recorded = stableNodePath(execPath);

      // brew upgrade: a new keg is built, opt/ is relinked, the old keg is gone.
      fs.unlinkSync(path.join(tmp, 'opt', 'node'));
      fs.rmSync(path.join(tmp, 'Cellar', 'node', '25.9.0_2'), { recursive: true });
      const upgraded = makeHomebrewTree(tmp, { version: '25.10.0' });

      assert.equal(recorded, optPath);
      assert.ok(fs.existsSync(recorded), 'the recorded path must still resolve after the upgrade');
      assert.equal(fs.realpathSync(recorded), fs.realpathSync(upgraded.execPath));
    });

    it('handles a versioned formula (node@22)', () => {
      const { execPath, optPath } = makeHomebrewTree(tmp, { formula: 'node@22', version: '22.14.0' });
      assert.equal(stableNodePath(execPath), optPath);
    });

    it('keeps the keg path when there is no opt link to prefer', () => {
      const { execPath } = makeHomebrewTree(tmp, { linked: false });
      assert.equal(stableNodePath(execPath), execPath);
    });

    it('keeps the keg path when the opt link points at a different install', () => {
      const { execPath } = makeHomebrewTree(tmp, { version: '25.9.0_2', linked: false });
      const other = makeHomebrewTree(tmp, { version: '99.0.0', linked: false });
      fs.mkdirSync(path.join(tmp, 'opt'), { recursive: true });
      fs.symlinkSync(path.dirname(path.dirname(other.execPath)), path.join(tmp, 'opt', 'node'));

      assert.equal(stableNodePath(execPath), execPath);
    });

    it('leaves a version manager path alone — the version dir is the install', () => {
      // fnm and nvm keep every version side by side; nothing deletes the one in
      // use, and the globally installed package lives under it.
      const fnm = path.join(tmp, '.local/share/fnm/node-versions/v24.15.0/installation/bin/node');
      fs.mkdirSync(path.dirname(fnm), { recursive: true });
      fs.writeFileSync(fnm, '#!/bin/sh\n', { mode: 0o755 });
      assert.equal(stableNodePath(fnm), fnm);
    });

    it('leaves a system node alone', () => {
      assert.equal(stableNodePath('/usr/bin/node'), '/usr/bin/node');
    });

    it('does not crash on a path too short to be a keg', () => {
      assert.equal(stableNodePath('/Cellar'), '/Cellar');
      assert.equal(stableNodePath('/Cellar/node/bin'), '/Cellar/node/bin');
    });
  });

  describe('resolveServerLaunchCommand', () => {
    it('records a command that exists on disk', () => {
      const { command, args } = resolveServerLaunchCommand();

      if (path.isAbsolute(command)) {
        assert.ok(
          fs.existsSync(command),
          `registered command must exist, got ${command}`,
        );
      } else {
        assert.equal(command, 'gelada');
      }
      assert.deepEqual(args.slice(-2), ['mcp', 'serve']);
    });

    it('does not record a Homebrew keg path', () => {
      const { command } = resolveServerLaunchCommand();
      assert.ok(
        !command.split(path.sep).includes('Cellar'),
        `a keg path does not survive brew upgrade, got ${command}`,
      );
    });
  });

  describe('Antigravity client', () => {
    function antigravityConfigDir(home) {
      const dir = path.join(home, ...ANTIGRAVITY_CONFIG.slice(0, -1));
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }

    function readAntigravityConfig(home) {
      return JSON.parse(fs.readFileSync(path.join(home, ...ANTIGRAVITY_CONFIG), 'utf-8'));
    }

    it('is detected at the config path the IDE and the CLI share', () => {
      const client = detectMcpClients(tmp).find((c) => c.clientType === 'antigravity');
      assert.ok(client, 'Antigravity must be a detected client');
      assert.equal(client.configPath, path.join(tmp, ...ANTIGRAVITY_CONFIG));
    });

    it('registers into the existing mcpServers object without disturbing it', () => {
      antigravityConfigDir(tmp);
      fs.writeFileSync(
        path.join(tmp, ...ANTIGRAVITY_CONFIG),
        JSON.stringify({ mcpServers: { context7: { serverUrl: 'https://example.invalid/mcp' } } }),
        'utf-8',
      );

      const { clientUpdates } = updateClientConfigs({ homeDir: tmp, client: 'antigravity' });
      const update = clientUpdates.find((u) => /Antigravity/.test(u.clientName));
      assert.equal(update.action, 'registered');

      const config = readAntigravityConfig(tmp);
      assert.ok(config.mcpServers.context7, 'the servers already there must survive');

      // The IDE validates each entry with additionalProperties: false, so an
      // unrecognized key would make it reject the whole file.
      assert.deepEqual(Object.keys(config.mcpServers['gelada-mcp']).sort(), ['args', 'command']);
      assert.deepEqual(config.mcpServers['gelada-mcp'].args.slice(-2), ['mcp', 'serve']);
    });

    it('creates the config when only the directory exists', () => {
      antigravityConfigDir(tmp);

      const { clientUpdates } = updateClientConfigs({ homeDir: tmp, client: 'antigravity' });
      assert.equal(clientUpdates.find((u) => /Antigravity/.test(u.clientName)).action, 'registered');
      assert.ok(readAntigravityConfig(tmp).mcpServers['gelada-mcp']);
    });

    it('is skipped when Antigravity is not installed', () => {
      const { clientUpdates } = updateClientConfigs({ homeDir: tmp, client: 'antigravity' });
      assert.equal(clientUpdates.find((u) => /Antigravity/.test(u.clientName)).action, 'skipped');
      assert.ok(!fs.existsSync(path.join(tmp, ...ANTIGRAVITY_CONFIG)));
    });

    it('uninstalls its registration and leaves the others alone', () => {
      antigravityConfigDir(tmp);
      updateClientConfigs({ homeDir: tmp, client: 'antigravity' });
      fs.writeFileSync(
        path.join(tmp, ...ANTIGRAVITY_CONFIG),
        JSON.stringify({
          mcpServers: {
            ...readAntigravityConfig(tmp).mcpServers,
            context7: { serverUrl: 'https://example.invalid/mcp' },
          },
        }),
        'utf-8',
      );

      const { clientUpdates } = updateClientConfigs({
        homeDir: tmp,
        client: 'antigravity',
        uninstall: true,
      });
      assert.equal(
        clientUpdates.find((u) => /Antigravity/.test(u.clientName)).action,
        'uninstalled',
      );

      const config = readAntigravityConfig(tmp);
      assert.ok(!config.mcpServers['gelada-mcp']);
      assert.ok(config.mcpServers.context7);
    });

    it('--client antigravity touches no other client', () => {
      antigravityConfigDir(tmp);
      fs.writeFileSync(path.join(tmp, '.claude.json'), '{}', 'utf-8');

      updateClientConfigs({ homeDir: tmp, client: 'antigravity' });

      assert.equal(fs.readFileSync(path.join(tmp, '.claude.json'), 'utf-8'), '{}');
      assert.ok(readAntigravityConfig(tmp).mcpServers['gelada-mcp']);
    });

    it('--client claude and --client codex leave Antigravity alone', () => {
      antigravityConfigDir(tmp);
      fs.writeFileSync(path.join(tmp, ...ANTIGRAVITY_CONFIG), '{}', 'utf-8');

      for (const client of ['claude', 'codex']) {
        updateClientConfigs({ homeDir: tmp, client });
        assert.equal(
          fs.readFileSync(path.join(tmp, ...ANTIGRAVITY_CONFIG), 'utf-8'),
          '{}',
          `--client ${client} must not write to Antigravity`,
        );
      }
    });
  });

  describe('inspectRegisteredLaunchers', () => {
    function writeClaudeCodeConfig(home, entry) {
      fs.writeFileSync(
        path.join(home, '.claude.json'),
        JSON.stringify({ mcpServers: { 'gelada-mcp': entry } }, null, 2),
        'utf-8',
      );
    }

    it('flags an absolute command that no longer exists', () => {
      writeClaudeCodeConfig(tmp, {
        command: path.join(tmp, 'Cellar', 'node', 'gone', 'bin', 'node'),
        args: ['/somewhere/gelada.js', 'mcp', 'serve'],
      });

      const [launcher, ...rest] = inspectRegisteredLaunchers(tmp);
      assert.equal(rest.length, 0);
      assert.equal(launcher.serverKey, 'gelada-mcp');
      assert.equal(launcher.commandExists, false);
    });

    it('accepts an absolute command that resolves', () => {
      writeClaudeCodeConfig(tmp, { command: process.execPath, args: ['mcp', 'serve'] });

      const [launcher] = inspectRegisteredLaunchers(tmp);
      assert.equal(launcher.commandExists, true);
    });

    it('does not judge a bare command name — the client resolves it, not us', () => {
      writeClaudeCodeConfig(tmp, { command: 'gelada', args: ['mcp', 'serve'] });

      const [launcher] = inspectRegisteredLaunchers(tmp);
      assert.equal(launcher.commandExists, undefined);
    });

    it('reports nothing when no client has Gelada registered', () => {
      fs.writeFileSync(
        path.join(tmp, '.claude.json'),
        JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
        'utf-8',
      );
      assert.deepEqual(inspectRegisteredLaunchers(tmp), []);
    });

    it('skips a config it cannot parse rather than throwing', () => {
      fs.writeFileSync(path.join(tmp, '.claude.json'), '{ not json', 'utf-8');
      assert.deepEqual(inspectRegisteredLaunchers(tmp), []);
    });

    it('sees a registration made in Antigravity', () => {
      const dir = path.join(tmp, ...ANTIGRAVITY_CONFIG.slice(0, -1));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ...ANTIGRAVITY_CONFIG),
        JSON.stringify({
          mcpServers: {
            'gelada-mcp': {
              command: '/opt/homebrew/Cellar/node/25.9.0_2/bin/node',
              args: ['/somewhere/gelada.js', 'mcp', 'serve'],
            },
          },
        }),
        'utf-8',
      );

      const [launcher] = inspectRegisteredLaunchers(tmp);
      assert.match(launcher.clientName, /Antigravity/);
      assert.equal(launcher.commandExists, false);
    });

    it('reads the snake_case container some clients use', () => {
      fs.mkdirSync(path.join(tmp, '.codex'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, '.codex', 'config.json'),
        JSON.stringify({ mcp_servers: { gelada: { command: '/nope/node' } } }),
        'utf-8',
      );

      const [launcher] = inspectRegisteredLaunchers(tmp);
      assert.equal(launcher.serverKey, 'gelada');
      assert.equal(launcher.commandExists, false);
    });
  });
});
