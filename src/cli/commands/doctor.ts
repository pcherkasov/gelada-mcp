import { Command } from 'commander';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { execSync } from 'child_process';



export function getSystemInfo() {
  let agyVersion = 'Not installed or not in PATH';
  try {
    agyVersion = execSync('agy --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    // Ignore error
  }

  let npmVersion = 'Unknown';
  try {
    npmVersion = execSync('npm --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    // Ignore error
  }

  return {
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memoryTotal: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + ' GB',
      memoryFree: Math.round(os.freemem() / (1024 * 1024 * 1024)) + ' GB',
    },
    nodeVersion: process.version,
    npmVersion,
    agyVersion,
    geladaVersion: process.env.npm_package_version || '0.1.0',
    timestamp: new Date().toISOString(),
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check system diagnostics')
    .action(async () => {
      console.log('Gathering system diagnostic information...');
      const sysInfo = getSystemInfo();

      console.log('\n--- System Information ---');
      console.log(`OS: ${sysInfo.os.platform} ${sysInfo.os.release} (${sysInfo.os.arch})`);
      console.log(`Node.js: ${sysInfo.nodeVersion}`);
      console.log(`NPM: ${sysInfo.npmVersion}`);
      console.log(`AGY (Antigravity CLI): ${sysInfo.agyVersion}`);
      console.log(`Gelada MCP Version: ${sysInfo.geladaVersion}`);
      console.log('--------------------------\n');
      console.log('System check complete. Use `gelada debug-bundle` to create an archive for debugging.');
    });
}
