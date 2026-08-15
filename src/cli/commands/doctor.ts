import { Command } from 'commander';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getConfigDir, getDataDir, getLogDir } from '../utils/paths.js';
import { packageVersion } from '../../utils/package-paths.js';
import { loadWorkerModelCatalog } from '../../components/model-catalog.js';
import { inspectRegisteredLaunchers } from '../utils/mcp-clients.js';
import { t } from '../utils/i18n.js';

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
    geladaVersion: packageVersion(),
    timestamp: new Date().toISOString(),
  };
}

function checkNode(): DiagnosticCheck {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  return {
    category: 'node',
    name: t('doctor.node.name'),
    status: ok ? 'pass' : 'fail',
    message: ok
      ? t('doctor.node.ok', { version: process.version })
      : t('doctor.node.tooOld', { version: process.version, required: MIN_NODE_MAJOR }),
    details: [
      t('doctor.node.platform', {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
      }),
    ],
    remediation: ok ? undefined : t('doctor.node.fix', { required: MIN_NODE_MAJOR }),
  };
}

async function checkGit(): Promise<DiagnosticCheck> {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { timeout: 10000 });
    const version = stdout.toString().trim();
    return {
      category: 'git',
      name: t('doctor.git.name'),
      status: 'pass',
      message: version,
      details: [t('doctor.git.detail')],
    };
  } catch {
    return {
      category: 'git',
      name: t('doctor.git.name'),
      status: 'fail',
      message: t('doctor.git.missing'),
      remediation: t('doctor.git.fix'),
    };
  }
}

function checkConfig(): DiagnosticCheck {
  const configDir = getConfigDir();
  const details = [
    t('doctor.config.dirs', { config: configDir }),
    t('doctor.config.dataDir', { data: getDataDir() }),
    t('doctor.config.logDir', { log: getLogDir() }),
  ];

  if (!fs.existsSync(configDir)) {
    return {
      category: 'config',
      name: t('doctor.config.name'),
      status: 'warn',
      message: t('doctor.config.missing', { path: configDir }),
      details,
      remediation: t('doctor.config.fixSetup'),
    };
  }

  try {
    fs.accessSync(configDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    return {
      category: 'config',
      name: t('doctor.config.name'),
      status: 'fail',
      message: t('doctor.config.unwritable', { path: configDir }),
      details,
      remediation: t('doctor.config.fixPermissions', { path: configDir }),
    };
  }

  return {
    category: 'config',
    name: t('doctor.config.name'),
    status: 'pass',
    message: configDir,
    details,
  };
}

/**
 * Checks that the commands clients were registered with still exist.
 *
 * This is the one failure Gelada cannot report from inside the server, because
 * the server never starts: the client spawns the recorded command, gets ENOENT,
 * and shows nothing beyond "server transport closed unexpectedly". A path that
 * was valid at setup time can stop existing later — a Homebrew node upgrade
 * moves the interpreter, an npm prefix changes, a checkout is deleted — so the
 * registration is worth re-reading rather than assumed good.
 *
 * Only absolute commands are judged. A bare name is resolved from the client's
 * PATH, which is not the PATH this process sees, so calling it broken here would
 * be a guess.
 */
function checkClientRegistrations(): DiagnosticCheck {
  let launchers: ReturnType<typeof inspectRegisteredLaunchers>;
  try {
    launchers = inspectRegisteredLaunchers();
  } catch (err: unknown) {
    return {
      category: 'config',
      name: t('doctor.registration.name'),
      status: 'warn',
      message: t('doctor.registration.unreadable', {
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }

  if (launchers.length === 0) {
    return {
      category: 'config',
      name: t('doctor.registration.name'),
      status: 'warn',
      message: t('doctor.registration.none'),
      details: [t('doctor.registration.noneDetail')],
      remediation: t('doctor.registration.noneFix'),
    };
  }

  const broken = launchers.filter((l) => l.commandExists === false);
  if (broken.length > 0) {
    return {
      category: 'config',
      name: t('doctor.registration.name'),
      status: 'fail',
      message:
        broken.length === launchers.length
          ? t('doctor.registration.allBroken', { count: broken.length })
          : t('doctor.registration.someBroken', {
              broken: broken.length,
              total: launchers.length,
            }),
      details: broken.map((l) =>
        t('doctor.registration.brokenDetail', {
          client: l.clientName,
          command: l.command,
          path: l.configPath,
        }),
      ),
      remediation: t('doctor.registration.brokenFix'),
    };
  }

  return {
    category: 'config',
    name: t('doctor.registration.name'),
    status: 'pass',
    message:
      launchers.length === 1
        ? t('doctor.registration.okOne')
        : t('doctor.registration.okMany', { count: launchers.length }),
    details: launchers.map((l) => `${l.clientName}: ${l.command}`),
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
      name: t('doctor.worker.name'),
      status: 'pass',
      message: `${command} ${version}`,
      details: [
        t('doctor.worker.resolvedFrom', {
          source: process.env.AGY_COMMAND ? 'AGY_COMMAND' : 'PATH',
        }),
      ],
    });
  } catch {
    checks.push({
      category: 'worker',
      name: t('doctor.worker.name'),
      status: 'fail',
      message: t('doctor.worker.missing', { command }),
      remediation: t('doctor.worker.fix'),
    });
    return checks;
  }

  // A worker that cannot list models is almost always an unauthenticated one.
  const catalog = await loadWorkerModelCatalog({ refresh: true });
  if (catalog.source === 'cli') {
    checks.push({
      category: 'worker',
      name: t('doctor.auth.name'),
      status: 'pass',
      message: t('doctor.auth.ok', { count: catalog.models.length }),
      details: catalog.models.map((m) => `${m.id} — ${m.label}`),
    });
  } else {
    checks.push({
      category: 'worker',
      name: t('doctor.auth.name'),
      status: 'warn',
      message: t('doctor.auth.unknown'),
      details: catalog.warning ? [catalog.warning] : undefined,
      remediation: t('doctor.auth.fix', { command }),
    });
  }

  return checks;
}

export async function runDiagnostics(options: { checkWorker?: boolean } = {}): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [
    checkNode(),
    await checkGit(),
    checkConfig(),
    checkClientRegistrations(),
  ];

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
    geladaVersion: packageVersion(),
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
    .description(t('cli.cmd.doctor'))
    .option('--json', t('opt.json'))
    .option('-v, --verbose', t('opt.verbose'))
    .option('--no-worker', t('doctor.opt.noWorker'))
    .option('--strict', t('doctor.opt.strict'))
    .action(async (options: DoctorCommandOptions) => {
      const report = await runDiagnostics({ checkWorker: options.worker });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = doctorExitCode(report, options.strict);
        return;
      }

      console.log(`${t('doctor.title')}\n`);
      for (const check of report.checks) {
        console.log(`${STATUS_MARK[check.status]} ${check.name}: ${check.message}`);
        if (options.verbose && check.details?.length) {
          console.log(t('doctor.details'));
          for (const detail of check.details) {
            console.log(`         - ${detail}`);
          }
        }
        if (check.remediation) {
          console.log(`       → ${check.remediation}`);
        }
      }

      console.log(`\n${t('doctor.status', { status: report.overallStatus.toUpperCase() })}`);
      if (report.overallStatus !== 'ok') {
        console.log(t('doctor.statusHint'));
      }
      console.log(
        `\n${t('doctor.footer', {
          version: report.geladaVersion,
          runtime: path.basename(process.execPath),
          nodeVersion: report.nodeVersion,
        })}`,
      );

      process.exitCode = doctorExitCode(report, options.strict);
    });
}
