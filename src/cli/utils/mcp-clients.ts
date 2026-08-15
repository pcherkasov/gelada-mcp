import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { packagePath } from '../../utils/package-paths.js';

export interface ClientDetectionResult {
  clientType: 'claude-desktop' | 'claude-code' | 'codex';
  name: string;
  configPath: string;
  exists: boolean;
}

/**
 * A launch command Gelada is currently registered under, read back from a
 * client's configuration file.
 */
export interface RegisteredLauncher {
  clientName: string;
  configPath: string;
  serverKey: string;
  command: string;
  /** Undefined for a bare name, which the client resolves from its own PATH. */
  commandExists?: boolean;
}

/**
 * Rewrites a Homebrew keg path to the versionless link that points at it.
 *
 * `process.execPath` resolves symlinks, so under Homebrew it yields
 * `<prefix>/Cellar/node/25.9.0_2/bin/node` — a directory Homebrew deletes on
 * every upgrade, including the revision bumps (`_1` → `_2`) it makes whenever a
 * dependency is rebuilt. Written into a client config, that path works until the
 * next `brew upgrade` and then fails as ENOENT before the server prints
 * anything: the client reports only that the transport closed.
 *
 * `<prefix>/opt/<formula>` is Homebrew's stable alias for the current keg, so
 * prefer it whenever it resolves to the same binary. Anything that is not a keg
 * path — a system node, or a version manager, where the versioned directory is
 * the install rather than a disposable copy of it — is left alone.
 */
export function stableNodePath(execPath: string = process.execPath): string {
  const segments = execPath.split(path.sep);
  const cellar = segments.lastIndexOf('Cellar');

  // Needs at least <prefix>/Cellar/<formula>/<version>/<file>.
  if (cellar < 1 || segments.length < cellar + 4) return execPath;

  const optPath = [
    ...segments.slice(0, cellar),
    'opt',
    segments[cellar + 1],
    ...segments.slice(cellar + 3),
  ].join(path.sep);

  try {
    if (fs.realpathSync(optPath) === fs.realpathSync(execPath)) return optPath;
  } catch {
    // No opt link, or a broken one: keep the path we know works today.
  }

  return execPath;
}

/**
 * Resolves the command an MCP client should use to launch this server.
 *
 * The entrypoint is derived from this module's own location rather than from
 * process.argv[1]: setup can be invoked programmatically (tests, or an embedding
 * process), where argv[1] is some other script entirely and registering it would
 * point the client at the wrong program.
 *
 * An absolute node + script path is used rather than the bare `gelada` name so
 * the registration keeps working when PATH changes — notably under node version
 * managers, where the shim directory is version specific. The interpreter half
 * of that pair is passed through stableNodePath(), because absolute is not the
 * same as durable: see the note there on Homebrew kegs.
 */
export function resolveServerLaunchCommand(): { command: string; args: string[] } {
  // Compiled single-file binary: it is its own entrypoint.
  if ((process as unknown as { pkg?: unknown }).pkg && process.execPath) {
    return { command: process.execPath, args: ['mcp', 'serve'] };
  }

  const binPath = packagePath('bin', 'gelada.js');
  if (fs.existsSync(binPath)) {
    return { command: stableNodePath(), args: [binPath, 'mcp', 'serve'] };
  }

  return { command: 'gelada', args: ['mcp', 'serve'] };
}

export function detectMcpClients(customHome?: string): ClientDetectionResult[] {
  const home = customHome || process.env.GELADA_HOME_DIR || os.homedir();
  const platform = process.platform;
  const candidates: { clientType: 'claude-desktop' | 'claude-code' | 'codex'; name: string; path: string }[] = [];

  // 1. Claude Desktop
  if (platform === 'darwin') {
    candidates.push({
      clientType: 'claude-desktop',
      name: 'Claude Desktop (macOS)',
      path: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    });
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push({
      clientType: 'claude-desktop',
      name: 'Claude Desktop (Windows)',
      path: path.join(appData, 'Claude', 'claude_desktop_config.json'),
    });
  } else {
    candidates.push({
      clientType: 'claude-desktop',
      name: 'Claude Desktop (Linux)',
      path: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    });
  }

  // 2. Claude Code CLI
  candidates.push({
    clientType: 'claude-code',
    name: 'Claude Code CLI (~/.claude.json)',
    path: path.join(home, '.claude.json'),
  });
  candidates.push({
    clientType: 'claude-code',
    name: 'Claude Code CLI (~/.config/claude-code/config.json)',
    path: path.join(home, '.config', 'claude-code', 'config.json'),
  });

  // 3. OpenAI Codex CLI / MCP
  candidates.push({
    clientType: 'codex',
    name: 'Codex MCP (~/.codex/config.json)',
    path: path.join(home, '.codex', 'config.json'),
  });
  candidates.push({
    clientType: 'codex',
    name: 'Codex MCP (~/.codex/mcp.json)',
    path: path.join(home, '.codex', 'mcp.json'),
  });
  candidates.push({
    clientType: 'codex',
    name: 'Codex MCP (~/.config/codex/config.json)',
    path: path.join(home, '.config', 'codex', 'config.json'),
  });
  candidates.push({
    clientType: 'codex',
    name: 'Codex MCP (~/.config/codex/mcp.json)',
    path: path.join(home, '.config', 'codex', 'mcp.json'),
  });
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push({
      clientType: 'codex',
      name: 'Codex MCP (Windows AppData)',
      path: path.join(appData, 'Codex', 'config.json'),
    });
  }

  return candidates.map((c) => ({
    clientType: c.clientType,
    name: c.name,
    configPath: c.path,
    exists: fs.existsSync(c.path),
  }));
}

/**
 * Reads back every Gelada registration a detected client currently holds.
 *
 * This is what makes a stale registration visible from the CLI. When the
 * recorded command no longer exists, the failure happens in the client before
 * the server runs a single line, so nothing Gelada logs can report it.
 */
export function inspectRegisteredLaunchers(customHome?: string): RegisteredLauncher[] {
  const launchers: RegisteredLauncher[] = [];

  for (const client of detectMcpClients(customHome)) {
    if (!client.exists) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(fs.readFileSync(client.configPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // A config we cannot parse is not a registration we can vouch for either
      // way; setup reports the parse failure on its own.
      continue;
    }

    for (const key of ['mcpServers', 'mcp_servers']) {
      const container = parsed[key];
      if (!container || typeof container !== 'object') continue;

      for (const serverKey of ['gelada-mcp', 'gelada']) {
        const entry = (container as Record<string, unknown>)[serverKey];
        if (!entry || typeof entry !== 'object') continue;

        const command = (entry as { command?: unknown }).command;
        if (typeof command !== 'string' || command.length === 0) continue;

        launchers.push({
          clientName: client.name,
          configPath: client.configPath,
          serverKey,
          command,
          commandExists: path.isAbsolute(command) ? fs.existsSync(command) : undefined,
        });
      }
    }
  }

  return launchers;
}
