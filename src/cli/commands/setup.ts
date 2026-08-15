import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Command } from 'commander';
import * as readline from 'node:readline/promises';

import { getConfigDir, getConfigPath, getDataDir, getLogDir } from '../utils/paths.js';
import { runDiagnostics } from './doctor.js';
import { runSmokeTest } from './smoke.js';
import { detectMcpClients, resolveServerLaunchCommand } from '../utils/mcp-clients.js';
import type { ClientDetectionResult } from '../utils/mcp-clients.js';

// Client discovery and launch-command resolution live in ../utils/mcp-clients.js
// so `gelada doctor` can read a registration back without importing this module,
// which imports doctor itself. Re-exported here because that is where callers
// have always found them.
export { detectMcpClients, resolveServerLaunchCommand, stableNodePath } from '../utils/mcp-clients.js';
export type { ClientDetectionResult } from '../utils/mcp-clients.js';

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
  smoke?: boolean;
  yes?: boolean;
  strict?: boolean;
}

/**
 * Asks the operator to acknowledge that the worker runs with its own permission
 * prompts disabled. It is enabled by default because nothing works without it,
 * but it is the kind of default a user should meet at install time rather than
 * discover in SECURITY.md later.
 */
async function confirmWorkerPermissions(assumeYes: boolean): Promise<boolean> {
  const explanation = [
    '',
    'Worker permissions',
    '------------------',
    'The Antigravity CLI cannot ask for tool approval when it runs headlessly,',
    'and it ignores its own allow-rules in that mode. Gelada therefore starts it',
    'with permission prompts disabled — without that, the worker cannot write a',
    'single file.',
    '',
    'What limits it instead: the worker only ever sees a disposable git worktree,',
    'its environment is stripped of credentials, and terminal commands are',
    'sandboxed. Your working tree is never exposed.',
    '',
    'You can switch this off per project with workerAutoApprove: false in',
    '.gelada/policy.yaml — delegation then stops working. See SECURITY.md §4.',
    '',
  ].join('\n');

  console.log(explanation);

  if (assumeYes || !process.stdin.isTTY) {
    console.log('Proceeding with worker permissions enabled (non-interactive).');
    return true;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Continue with worker permissions enabled? [Y/n] ')).trim();
    return answer === '' || /^y(es)?$/i.test(answer);
  } finally {
    rl.close();
  }
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

        const { command, args } = resolveServerLaunchCommand();

        configObj.mcpServers['gelada-mcp'] = {
          command,
          args,
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
    .option('--no-smoke', 'Skip the end-to-end delegation check')
    .option('-y, --yes', 'Accept the worker permission default without prompting')
    .option('--strict', 'Exit non-zero if the environment is not ready to delegate')
    .action(async (options: SetupOptions) => {
      try {
        const result = await runSetup(options);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const isUninstallRun = Boolean(options.uninstall || options.remove);

        if (!options.quiet) {
          const isUninstall = isUninstallRun;
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

        if (isUninstallRun || options.quiet) {
          return;
        }

        // Diagnose before claiming success: a green setup with an unusable
        // worker is exactly the state that wastes a user's afternoon.
        const report = await runDiagnostics();
        const blocking = report.checks.filter((c) => c.status === 'fail');
        if (blocking.length > 0) {
          console.log('\nSetup finished, but delegation is not ready yet:');
          for (const check of blocking) {
            console.log(`   [fail] ${check.name}: ${check.message}`);
            if (check.remediation) console.log(`          → ${check.remediation}`);
          }
          console.log('\nFix the above, then run "gelada smoke" to confirm.');
          if (options.strict) process.exitCode = 1;
          return;
        }

        const permissionsAccepted = await confirmWorkerPermissions(Boolean(options.yes));
        if (!permissionsAccepted) {
          console.log(
            '\nLeaving worker permissions to your project policy. Set workerAutoApprove: false ' +
              'in .gelada/policy.yaml to keep them off — delegation will not make changes.',
          );
        }

        if (options.smoke === false) {
          console.log('\nSkipped the delegation check. Run "gelada smoke" when you want it.');
          return;
        }

        console.log('\nVerifying delegation end to end...');
        const smoke = await runSmokeTest();
        if (smoke.ok) {
          console.log(
            `[ok] A real task changed ${smoke.changedFiles?.join(', ')} in ` +
              `${(smoke.durationMs / 1000).toFixed(1)}s. Gelada is ready.`,
          );
        } else {
          console.error(`[fail] Delegation check failed: ${smoke.error ?? 'unknown error'}`);
          if (smoke.remediation) console.error(`       → ${smoke.remediation}`);
          console.error('       Configuration is in place, but tasks will not work yet.');
          console.error('       Re-run "gelada smoke" after fixing it — that command gates on the result.');
          if (options.strict) process.exitCode = 1;
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

