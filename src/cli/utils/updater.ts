import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { t } from './i18n.js';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * The repository releases are published from.
 *
 * Kept as a literal because the standalone binary carries no package.json to
 * read, and guarded by a test that compares it against the `repository` field.
 * The previous value named a repository that does not exist; every check 404'd,
 * and the 404 was reported as "up to date".
 */
export const RELEASE_REPO = 'pcherkasov/gelada-mcp';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  upToDate: boolean;
  releaseUrl: string;
}

/** How this copy of Gelada was installed, which decides how it can be replaced. */
export type InstallKind = 'npm' | 'standalone';

export class UpdateCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateCheckError';
  }
}

/**
 * Compares two release versions.
 *
 * Only the numeric core is compared, and a version carrying a prerelease suffix
 * loses to the same core without one, per semver. Written out rather than
 * reusing `Number(part)` across the whole string, which turned "0-rc1" into NaN
 * and made every comparison against a prerelease answer "up to date".
 */
export function isUpToDate(current: string, latest: string): boolean {
  const split = (v: string) => {
    const [core, ...rest] = v.trim().replace(/^v/, '').split('-');
    return {
      parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
      prerelease: rest.join('-'),
    };
  };

  const a = split(current);
  const b = split(latest);

  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
    const c = a.parts[i] ?? 0;
    const l = b.parts[i] ?? 0;
    if (l > c) return false;
    if (c > l) return true;
  }

  // Same numeric core: a prerelease is behind the final release of that core.
  if (a.prerelease && !b.prerelease) return false;
  return true;
}

/**
 * npm replaces its own package; a standalone binary has to be swapped on disk.
 *
 * Detected through `process.pkg`, which only the packaged build defines, rather
 * than by looking for "node_modules" in argv[1] — that guessed wrong for anyone
 * running from a checkout, and threw outright when argv[1] was unset.
 */
export function detectInstallKind(): InstallKind {
  return (process as unknown as { pkg?: unknown }).pkg ? 'standalone' : 'npm';
}

export class Updater {
  private readonly repo = RELEASE_REPO;
  private readonly currentVersion: string;

  constructor(currentVersion: string) {
    this.currentVersion = currentVersion;
  }

  /**
   * Asks GitHub what the latest release is.
   *
   * Throws when it cannot find out. A check that failed is not a check that
   * passed: the previous version answered "up to date" whenever the request
   * failed, which is the one answer guaranteed to be unhelpful — it is also the
   * answer a user acts on by doing nothing.
   */
  public async checkForUpdates(): Promise<UpdateInfo> {
    const endpoint = `https://api.github.com/repos/${this.repo}/releases/latest`;

    let response: Response;
    try {
      response = await fetch(endpoint, { headers: { 'User-Agent': 'gelada-mcp-updater' } });
    } catch (err: unknown) {
      throw new UpdateCheckError(
        `Could not reach GitHub to check for updates: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new UpdateCheckError(
        `GitHub answered ${response.status} ${response.statusText} for ${endpoint}`,
      );
    }

    const data = (await response.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name) {
      throw new UpdateCheckError(`No tag_name in the latest release from ${endpoint}`);
    }

    const latestVersion = data.tag_name.replace(/^v/, '');

    return {
      currentVersion: this.currentVersion,
      latestVersion,
      upToDate: isUpToDate(this.currentVersion, latestVersion),
      releaseUrl: data.html_url || `https://github.com/${this.repo}/releases/tag/${data.tag_name}`,
    };
  }

  /** The command a user would run by hand to get this release. */
  public manualInstructions(info: UpdateInfo): string {
    if (detectInstallKind() === 'npm') {
      return 'npm install -g gelada-mcp@latest';
    }
    if (process.platform === 'win32') {
      return `Download gelada-v${info.latestVersion}-win-x64.zip from ${info.releaseUrl}`;
    }
    return `curl -fsSL https://github.com/${this.repo}/releases/latest/download/install.sh | bash`;
  }

  public async installUpdate(info: UpdateInfo): Promise<void> {
    if (info.upToDate) return;

    console.log(t('update.starting', { from: info.currentVersion, to: info.latestVersion }));

    if (detectInstallKind() === 'npm') {
      await this.installViaNpm();
      return;
    }

    await this.installViaInstaller(info);
  }

  private async installViaNpm(): Promise<void> {
    console.log(t('update.viaNpm'));
    try {
      const { stdout, stderr } = await execFileAsync('npm', [
        'install',
        '-g',
        'gelada-mcp@latest',
      ]);
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      console.log(t('update.npmDone'));
    } catch (err: unknown) {
      throw new Error(
        `Failed to update via npm: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Runs the installer published with the release, into the directory this
   * binary already lives in.
   *
   * install.sh is the only path that knows how a release is laid out — asset
   * names, archive shape, checksums — and the only one CI exercises end to end
   * (scripts/verify-install.sh). Reimplementing it here is what produced a
   * download step that copied a .tar.gz over the running executable and a
   * checksum step that never found a checksum to compare.
   */
  private async installViaInstaller(info: UpdateInfo): Promise<void> {
    if (process.platform === 'win32') {
      throw new Error(
        `Automatic update is not supported for the standalone Windows build. ${this.manualInstructions(info)}`,
      );
    }

    const target = process.execPath;
    const installDir = path.dirname(target);

    try {
      await fs.access(installDir, fs.constants.W_OK);
    } catch {
      throw new Error(
        `${installDir} is not writable by this user. Re-run with the rights to write there, or: ${this.manualInstructions(info)}`,
      );
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-update-'));
    const installer = path.join(workDir, 'install.sh');

    try {
      const url = `https://github.com/${this.repo}/releases/download/v${info.latestVersion}/install.sh`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`could not download the installer from ${url} (${res.status})`);
      }
      await fs.writeFile(installer, Buffer.from(await res.arrayBuffer()));

      console.log(t('update.installing', { version: info.latestVersion, dir: installDir }));
      const { stdout, stderr } = await execFileAsync('bash', [installer], {
        env: {
          ...process.env,
          GELADA_VERSION: info.latestVersion,
          INSTALL_DIR: installDir,
        },
      });
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);

      console.log(t('update.done', { path: target, version: info.latestVersion }));
    } catch (err: unknown) {
      throw new Error(
        `Failed to update the standalone binary: ${err instanceof Error ? err.message : String(err)}. ` +
          `Nothing was replaced — ${this.manualInstructions(info)}`,
      );
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
