import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  upToDate: boolean;
  releaseUrl: string;
  assets: GitHubAsset[];
}

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

export class Updater {
  private readonly repo = 'zugoman/gelada-mcp';
  private readonly currentVersion: string;

  constructor(currentVersion: string) {
    this.currentVersion = currentVersion;
  }

  /**
   * Fetches the latest release from GitHub API
   */
  public async checkForUpdates(): Promise<UpdateInfo> {
    try {
      const response = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: { 'User-Agent': 'gelada-mcp-updater' }
      });
      
      if (!response.ok) {
        // Fallback to a mock or npm registry if repository is not public yet
        return this.getMockUpdateInfo();
      }

      const data = await response.json() as any;
      const latestVersion = data.tag_name ? data.tag_name.replace(/^v/, '') : this.currentVersion;
      
      return {
        currentVersion: this.currentVersion,
        latestVersion,
        upToDate: this.isUpToDate(this.currentVersion, latestVersion),
        releaseUrl: data.html_url,
        assets: data.assets || [],
      };
    } catch (e) {
      // In development/private mode, fallback to mock
      return this.getMockUpdateInfo();
    }
  }

  private isUpToDate(current: string, latest: string): boolean {
    // Simple semver comparison
    const currParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);
    
    for (let i = 0; i < Math.max(currParts.length, latestParts.length); i++) {
      const c = currParts[i] || 0;
      const l = latestParts[i] || 0;
      if (l > c) return false;
      if (c > l) return true;
    }
    return true;
  }

  private getMockUpdateInfo(): UpdateInfo {
    return {
      currentVersion: this.currentVersion,
      latestVersion: this.currentVersion,
      upToDate: true,
      releaseUrl: `https://github.com/${this.repo}/releases/latest`,
      assets: []
    };
  }

  /**
   * Performs the update. Depending on the installation method, it will
   * either trigger npm install, or download the binary asset and verify checksum.
   */
  public async installUpdate(info: UpdateInfo): Promise<void> {
    if (info.upToDate) {
      return;
    }

    console.log(`Starting update from v${info.currentVersion} to v${info.latestVersion}...`);

    // Determine if we are running as an npm global package or a standalone binary
    const isStandalone = !process.argv[1].includes('node_modules');

    if (!isStandalone) {
      // NPM Update
      console.log('Detected NPM installation. Running npm install -g gelada-mcp@latest...');
      try {
        const { stdout, stderr } = await execAsync('npm install -g gelada-mcp@latest');
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        console.log('Update completed successfully via npm.');
      } catch (err: any) {
        throw new Error(`Failed to update via npm: ${err.message}`);
      }
    } else {
      // Binary Update Logic (Downloading matching asset, verifying SHA256)
      await this.performBinaryUpdate(info);
    }
  }

  private async performBinaryUpdate(info: UpdateInfo): Promise<void> {
    const platform = os.platform();
    const arch = os.arch();
    
    // 1. Find the appropriate asset
    const assetKeyword = `${platform}-${arch}`;
    const targetAsset = info.assets.find(a => a.name.includes(assetKeyword) && !a.name.endsWith('.sha256'));
    const checksumAsset = info.assets.find(a => a.name.includes(assetKeyword) && a.name.endsWith('.sha256'));

    if (!targetAsset) {
      console.log(`No pre-compiled binary found for ${assetKeyword}. Please update via your package manager.`);
      return;
    }

    console.log(`Found matching binary: ${targetAsset.name}`);
    
    // 2. Download Binary
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-update-'));
    const binaryPath = path.join(tempDir, targetAsset.name);
    await this.downloadFile(targetAsset.browser_download_url, binaryPath);

    // 3. Download and Verify Checksum
    if (checksumAsset) {
      const checksumPath = path.join(tempDir, checksumAsset.name);
      await this.downloadFile(checksumAsset.browser_download_url, checksumPath);
      
      const expectedChecksum = (await fs.readFile(checksumPath, 'utf8')).split(' ')[0].trim();
      const actualChecksum = await this.calculateSha256(binaryPath);

      if (expectedChecksum !== actualChecksum) {
        throw new Error(`Checksum verification failed! Expected: ${expectedChecksum}, Got: ${actualChecksum}`);
      }
      console.log('Checksum verified successfully.');
    } else {
      console.warn('Warning: No checksum file found. Skipping verification.');
    }

    // 4. Replace current executable
    // Typically `process.execPath` points to the node executable, but if it's a pkg binary, it points to the binary.
    const currentExecutable = process.argv[1] || process.execPath;
    console.log(`Replacing executable at ${currentExecutable}`);
    
    // Rename current to backup, move new to current, chmod +x
    const backupPath = `${currentExecutable}.backup`;
    try {
      await fs.rename(currentExecutable, backupPath);
      await fs.copyFile(binaryPath, currentExecutable);
      await fs.chmod(currentExecutable, 0o755);
      console.log('Binary updated successfully.');
    } catch (e: any) {
      console.error('Failed to replace executable, attempting rollback...');
      await fs.rename(backupPath, currentExecutable).catch(() => {});
      throw new Error(`Update replacement failed: ${e.message}`);
    }
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(dest, buffer);
  }

  private async calculateSha256(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
