import { Command } from 'commander';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getConfigDir, getDataDir, getLogDir } from '../utils/paths.js';
import { loadWorkerModelCatalog } from '../../components/model-catalog.js';

const execFileAsync = promisify(execFile);

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type OverallStatus = 'ok' | 'warn' | 'error';

export interface DiagnosticCheck {
  category: 'node' | 'git' | 'config' | 'worker';
  name: string;
  status: CheckStatus;
  message: string;
  details?: string[];
  remediation?: string;
}

export interface DiagnosticReport {
  timestamp: string;
  overallStatus: OverallStatus;
  geladaVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  checks: DiagnosticCheck[];
}

const MIN_NODE_MAJOR = 18;

/** Retained for `gelada debug-bundle`, which embeds a environment snapshot. */
export function getSystemInfo() {
  let agyVersion = 'Not installed or not in PATH';
  try {
    agyVersion = execFileSync(process.env.AGY_COMMAND || 'agy', ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Left as the "not installed" default.
  }

  let npmVersion = 'Unknown';
  try {
    npmVersion = execFileSync('npm', ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Left as "Unknown".
  }

  return {
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memoryTotal: Math.round(os.totalmem() / 1024 ** 3) + ' GB',
      memoryFree: Math.round(os.freemem() / 1024 ** 3) + ' GB',
    },
    nodeVersion: process.version,
    npmVersion,
    agyVersion,
    geladaVersion: process.env.npm_package_version || '0.1.0',
    timestamp: new Date().toISOString(),
  };
}

function checkNode(): DiagnosticCheck {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  return {
    category: 'node',
    name: 'Node.js Version',
    status: ok ? 'pass' : 'fail',
    message: ok
      ? `Node.js ${process.version}`
      : `Node.js ${process.version} is below the required v${MIN_NODE_MAJOR}`,
    details: [`Platform: ${os.platform()} ${os.release()} (${os.arch()})`],
    remediation: ok ? undefined : `Install Node.js v${MIN_NODE_MAJOR} or newer.`,
  };
}

async function checkGit(): Promise<DiagnosticCheck> {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { timeout: 10000 });
    const version = stdout.toString().trim();
    return {
      category: 'git',
      name: 'Git CLI',
      status: 'pass',
      message: version,
      details: ['Required for isolated worktrees (git worktree).'],
    };
  } catch {
    return {
      category: 'git',
      name: 'Git CLI',
      status: 'fail',
      message: 'git was not found in PATH',
      remediation: 'Install Git 2.30 or newer; Gelada isolates every task in a git worktree.',
    };
  }
}

function checkConfig(): DiagnosticCheck {
  const configDir = getConfigDir();
  const details = [
    `Config directory: ${configDir}`,
    `Data directory:   ${getDataDir()}`,
    `Log directory:    ${getLogDir()}`,
  ];

  if (!fs.existsSync(configDir)) {
    return {
      category: 'config',
      name: 'Config Directory',
      status: 'warn',
      message: `Not created yet: ${configDir}`,
      details,
      remediation: 'Run "gelada setup" to scaffold configuration.',
    };
  }

  try {
    fs.accessSync(configDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    return {
      category: 'config',
      name: 'Config Directory',
      status: 'fail',
      message: `Not readable/writable: ${configDir}`,
      details,
      remediation: `Fix permissions on ${configDir}.`,
    };
  }

  return {
    category: 'config',
    name: 'Config Directory',
    status: 'pass',
    message: configDir,
    details,
  };
}

async function checkWorker(): Promise<DiagnosticCheck[]> {
  const command = process.env.AGY_COMMAND || 'agy';
  const checks: DiagnosticCheck[] = [];

  let version: string | undefined;
  try {
    const { stdout } = await execFileAsync(command, ['--version'], { timeout: 15000 });
    version = stdout.toString().trim();
    checks.push({
      category: 'worker',
      name: 'Worker CLI',
      status: 'pass',
      message: `${command} ${version}`,
      details: [`Resolved from ${process.env.AGY_COMMAND ? 'AGY_COMMAND' : 'PATH'}.`],
    });
  } catch {
    checks.push({
      category: 'worker',
      name: 'Worker CLI',
      status: 'fail',
      message: `${command} was not found or failed to run`,
      remediation:
        'Install the Antigravity CLI and make sure it is in PATH, or point AGY_COMMAND at it.',
    });
    return checks;
  }

  // A worker that cannot list models is almost always an unauthenticated one.
  const catalog = await loadWorkerModelCatalog({ refresh: true });
  if (catalog.source === 'cli') {
    checks.push({
      category: 'worker',
      name: 'Worker Authentication',
      status: 'pass',
      message: `${catalog.models.length} models available`,
      details: catalog.models.map((m) => `${m.id} — ${m.label}`),
    });
  } else {
    checks.push({
      category: 'worker',
      name: 'Worker Authentication',
      status: 'warn',
      message: 'Could not read the model list from the worker CLI',
      details: catalog.warning ? [catalog.warning] : undefined,
      remediation: `Run "${command}" once in a terminal and sign in, then re-run "gelada doctor".`,
    });
  }

  return checks;
}

export async function runDiagnostics(options: { checkWorker?: boolean } = {}): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [checkNode(), await checkGit(), checkConfig()];

  if (options.checkWorker !== false) {
    checks.push(...(await checkWorker()));
  }

  const overallStatus: OverallStatus = checks.some((c) => c.status === 'fail')
    ? 'error'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok';

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    geladaVersion: process.env.npm_package_version || '0.1.0',
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    checks,
  };
}

const STATUS_MARK: Record<CheckStatus, string> = { pass: '[ok]  ', warn: '[warn]', fail: '[fail]' };

export interface DoctorCommandOptions {
  json?: boolean;
  verbose?: boolean;
  worker?: boolean;
  strict?: boolean;
}

/**
 * Exit code policy: a diagnostic that ran successfully exits 0 even when it has
 * bad news, so callers can read the report. Only Gelada's own prerequisites
 * (node, git, config) make the command fail. A missing worker CLI is a real
 * problem but an expected one on a fresh machine or in CI, so it is reported
 * rather than thrown. Use --strict to fail on any non-passing check.
 */
export function doctorExitCode(report: DiagnosticReport, strict = false): number {
  if (strict) {
    return report.checks.some((c) => c.status !== 'pass') ? 1 : 0;
  }
  const ownPrerequisites = report.checks.filter((c) => c.category !== 'worker');
  return ownPrerequisites.some((c) => c.status === 'fail') ? 1 : 0;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check that Gelada, Git and the worker CLI are ready to run tasks')
    .option('--json', 'Output the diagnostic report as JSON')
    .option('-v, --verbose', 'Include per-check details')
    .option('--no-worker', 'Skip worker CLI checks')
    .option('--strict', 'Exit non-zero if any check does not pass')
    .action(async (options: DoctorCommandOptions) => {
      const report = await runDiagnostics({ checkWorker: options.worker });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = doctorExitCode(report, options.strict);
        return;
      }

      console.log('=== Gelada Diagnostic Check ===\n');
      for (const check of report.checks) {
        console.log(`${STATUS_MARK[check.status]} ${check.name}: ${check.message}`);
        if (options.verbose && check.details?.length) {
          console.log('       Details:');
          for (const detail of check.details) {
            console.log(`         - ${detail}`);
          }
        }
        if (check.remediation) {
          console.log(`       → ${check.remediation}`);
        }
      }

      console.log(`\nSystem Status: ${report.overallStatus.toUpperCase()}`);
      if (report.overallStatus !== 'ok') {
        console.log('Run "gelada setup" to fix configuration, or address the items above.');
      }
      console.log(`\nGelada ${report.geladaVersion} · ${path.basename(process.execPath)} ${report.nodeVersion}`);

      process.exitCode = doctorExitCode(report, options.strict);
    });
}
