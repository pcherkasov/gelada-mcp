import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Command } from 'commander';
import { getConfigDir, getConfigPath, getDataDir, getLogDir } from '../utils/paths.js';

export interface GeladaConfigSchema {
  version: string;
  worker: {
    command: string;
    args: string[];
    timeoutSeconds: number;
  };
  policy: {
    mode: 'strict' | 'permissive' | 'disabled';
    allowedCommands: string[];
    blockedPatterns: string[];
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    logToFile: boolean;
  };
  server: {
    transport: 'stdio';
  };
}

export const DEFAULT_GELADA_CONFIG: GeladaConfigSchema = {
  version: '1.0.0',
  worker: {
    command: 'agy',
    args: [],
    timeoutSeconds: 300,
  },
  policy: {
    mode: 'strict',
    allowedCommands: ['git', 'npm', 'npx', 'cargo', 'pytest', 'make', 'go'],
    blockedPatterns: ['rm -rf /', 'sudo', 'chmod 777'],
  },
  logging: {
    level: 'info',
    logToFile: true,
  },
  server: {
    transport: 'stdio',
  },
};

export interface ClientDetectionResult {
  clientType: 'claude-desktop' | 'claude-code' | 'codex';
  name: string;
  configPath: string;
  exists: boolean;
}

export interface ClientConfigUpdateResult {
  clientName: string;
  configPath: string;
  action: 'registered' | 'uninstalled' | 'skipped' | 'error';
  backupPath?: string;
  error?: string;
}

export interface SetupOptions {
  force?: boolean;
  configDir?: string;
  json?: boolean;
  quiet?: boolean;
  uninstall?: boolean;
  remove?: boolean;
  installClients?: boolean;
  client?: 'claude' | 'codex' | 'all' | string;
  homeDir?: string;
}

export interface SetupResult {
  success: boolean;
  configDir: string;
  configFile: string;
  dataDir: string;
  logDir: string;
  createdConfigFile: boolean;
  createdDirs: string[];
  permissionsOk: boolean;
  detectedClients?: ClientDetectionResult[];
  clientUpdates?: ClientConfigUpdateResult[];
  error?: string;
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

export function updateClientConfigs(options: SetupOptions = {}): {
  detectedClients: ClientDetectionResult[];
  clientUpdates: ClientConfigUpdateResult[];
} {
  const detectedClients = detectMcpClients(options.homeDir);
  const clientFilter = options.client ? options.client.toLowerCase() : 'all';
  const isUninstall = Boolean(options.uninstall || options.remove);

  const filteredCandidates = detectedClients.filter((client) => {
    if (clientFilter === 'all') return true;
    if (clientFilter === 'claude') return client.clientType.startsWith('claude');
    if (clientFilter === 'codex') return client.clientType === 'codex';
    return client.clientType.includes(clientFilter);
  });

  const clientUpdates: ClientConfigUpdateResult[] = [];

  for (const client of filteredCandidates) {
    const filePath = client.configPath;
    const exists = fs.existsSync(filePath);

    if (isUninstall) {
      if (!exists) {
        clientUpdates.push({
          clientName: client.name,
          configPath: filePath,
          action: 'skipped',
        });
        continue;
      }

      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        let configObj: Record<string, any> = {};
        try {
          configObj = JSON.parse(fileContent);
        } catch {
          clientUpdates.push({
            clientName: client.name,
            configPath: filePath,
            action: 'error',
            error: 'Failed to parse JSON config file',
          });
          continue;
        }

        let hasGelada = false;
        if (configObj.mcpServers && typeof configObj.mcpServers === 'object') {
          if ('gelada-mcp' in configObj.mcpServers || 'gelada' in configObj.mcpServers) {
            hasGelada = true;
          }
        }
        if (configObj.mcp_servers && typeof configObj.mcp_servers === 'object') {
          if ('gelada-mcp' in configObj.mcp_servers || 'gelada' in configObj.mcp_servers) {
            hasGelada = true;
          }
        }

        if (!hasGelada) {
          clientUpdates.push({
            clientName: client.name,
            configPath: filePath,
            action: 'skipped',
          });
          continue;
        }

        const backupPath = `${filePath}.bak`;
        fs.copyFileSync(filePath, backupPath);

        if (configObj.mcpServers && typeof configObj.mcpServers === 'object') {
          delete configObj.mcpServers['gelada-mcp'];
          delete configObj.mcpServers['gelada'];
        }
        if (configObj.mcp_servers && typeof configObj.mcp_servers === 'object') {
          delete configObj.mcp_servers['gelada-mcp'];
          delete configObj.mcp_servers['gelada'];
        }

        fs.writeFileSync(filePath, JSON.stringify(configObj, null, 2), 'utf-8');
        clientUpdates.push({
          clientName: client.name,
          configPath: filePath,
          action: 'uninstalled',
          backupPath,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        clientUpdates.push({
          clientName: client.name,
          configPath: filePath,
          action: 'error',
          error: errorMsg,
        });
      }
    } else {
      const parentDirExists = fs.existsSync(path.dirname(filePath));
      if (!exists && !parentDirExists) {
        clientUpdates.push({
          clientName: client.name,
          configPath: filePath,
          action: 'skipped',
        });
        continue;
      }

      try {
        let configObj: Record<string, any> = {};
        let backupPath: string | undefined = undefined;

        if (exists) {
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          if (fileContent.trim().length > 0) {
            try {
              configObj = JSON.parse(fileContent);
            } catch {
              clientUpdates.push({
                clientName: client.name,
                configPath: filePath,
                action: 'error',
                error: 'Failed to parse JSON config file',
              });
              continue;
            }
          }
          backupPath = `${filePath}.bak`;
          fs.copyFileSync(filePath, backupPath);
        } else {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
        }

        if (!configObj.mcpServers || typeof configObj.mcpServers !== 'object') {
          configObj.mcpServers = {};
        }

        const isCompiled = Boolean((process as any).pkg);
        const scriptPath = process.argv[1] || '';
        
        let command = 'gelada';
        let args = ['mcp', 'serve'];
        
        if (isCompiled && process.execPath) {
           // Running as a compiled binary (e.g. installed via install.sh)
           command = process.execPath;
        } else if (scriptPath && fs.existsSync(scriptPath)) {
           // Running via node (e.g. local development or npm global install)
           command = process.execPath;
           args = [path.resolve(scriptPath), 'mcp', 'serve'];
        }

        configObj.mcpServers['gelada-mcp'] = {
          command: command,
          args: args,
        };

        fs.writeFileSync(filePath, JSON.stringify(configObj, null, 2), 'utf-8');
        clientUpdates.push({
          clientName: client.name,
          configPath: filePath,
          action: 'registered',
          backupPath,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        clientUpdates.push({
          clientName: client.name,
          configPath: filePath,
          action: 'error',
          error: errorMsg,
        });
      }
    }
  }

  return { detectedClients, clientUpdates };
}

export function verifyDirectoryPermissions(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      return false;
    }
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    const tempFile = path.join(
      dirPath,
      `.permcheck_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    );
    fs.writeFileSync(tempFile, 'test', 'utf-8');
    fs.unlinkSync(tempFile);
    return true;
  } catch {
    return false;
  }
}

export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const configDir = getConfigDir(options.configDir);
  const configFile = getConfigPath(
    options.configDir ? path.join(configDir, 'config.json') : undefined,
  );
  const dataDir = getDataDir();
  const logDir = getLogDir();

  const createdDirs: string[] = [];
  const dirsToCreate = [configDir, dataDir, logDir];

  for (const dir of dirsToCreate) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDirs.push(dir);
    }
  }

  const permissionsOk =
    verifyDirectoryPermissions(configDir) && verifyDirectoryPermissions(dataDir);
  if (!permissionsOk) {
    throw new Error(`Insufficient read/write permissions for Gelada directory: ${configDir}`);
  }

  let createdConfigFile = false;
  const configExists = fs.existsSync(configFile);

  if (!configExists || options.force) {
    fs.writeFileSync(configFile, JSON.stringify(DEFAULT_GELADA_CONFIG, null, 2), 'utf-8');
    createdConfigFile = true;
  }

  const { detectedClients, clientUpdates } = updateClientConfigs(options);

  return {
    success: true,
    configDir,
    configFile,
    dataDir,
    logDir,
    createdConfigFile,
    createdDirs,
    permissionsOk,
    detectedClients,
    clientUpdates,
  };
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Scaffold Gelada MCP configuration directory, data paths, and default config file')
    .option('-f, --force', 'Overwrite existing configuration file with default settings')
    .option('--config-dir <path>', 'Custom target directory for setup')
    .option('--json', 'Output setup results in JSON format')
    .option('-q, --quiet', 'Suppress stdout messages')
    .option('--uninstall', 'Remove gelada-mcp server from detected client configuration files')
    .option('--remove', 'Alias for --uninstall')
    .option('--client <name>', 'Target specific client configuration (claude, codex, or all)')
    .action(async (options: SetupOptions) => {
      try {
        const result = await runSetup(options);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!options.quiet) {
          const isUninstall = Boolean(options.uninstall || options.remove);
          if (isUninstall) {
            console.log('🗑️ Gelada MCP Client Uninstallation Completed');
          } else {
            console.log('✅ Gelada MCP Environment Setup Completed');
          }
          console.log(`   Config Directory: ${result.configDir}`);
          console.log(
            `   Config File:      ${result.configFile} (${result.createdConfigFile ? 'CREATED' : 'EXISTING'})`,
          );
          console.log(`   Data Directory:   ${result.dataDir}`);
          console.log(`   Log Directory:    ${result.logDir}`);

          if (result.clientUpdates && result.clientUpdates.length > 0) {
            console.log('   Client Updates:');
            for (const update of result.clientUpdates) {
              console.log(
                `     - ${update.clientName}: ${update.action.toUpperCase()} (${update.configPath})`,
              );
            }
          }
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (options.json) {
          console.log(JSON.stringify({ success: false, error: errorMsg }, null, 2));
        } else {
          console.error(`❌ Setup failed: ${errorMsg}`);
        }
        process.exit(1);
      }
    });
}

