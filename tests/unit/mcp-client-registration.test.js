import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  stableNodePath,
  resolveServerLaunchCommand,
  inspectRegisteredLaunchers,
} from '../../dist/cli/utils/mcp-clients.js';

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
