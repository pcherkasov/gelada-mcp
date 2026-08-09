import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { getSystemInfo } from './doctor.js';

export function registerDebugBundleCommand(program: Command): void {
  program
    .command('debug-bundle')
    .description('Generate a ZIP bundle with system info, config, and artifacts for debugging')
    .action(async () => {
      const cwd = process.cwd();
      const bundleName = `gelada-debug-bundle-${Date.now()}.zip`;
      const bundlePath = path.join(cwd, bundleName);
      
      console.log(`Generating debug bundle: ${bundleName}...`);
      
      try {
        const zip = new AdmZip();
        
        // Add system info JSON
        const sysInfo = getSystemInfo();
        zip.addFile('system-info.json', Buffer.from(JSON.stringify(sysInfo, null, 2), 'utf8'));

        // Add policy if exists
        const geladaDir = path.join(cwd, '.gelada');
        const policyPath = path.join(geladaDir, 'policy.yaml');
        if (fs.existsSync(policyPath)) {
          zip.addLocalFile(policyPath);
        } else {
          zip.addFile('policy.yaml.missing.txt', Buffer.from('No policy.yaml found in .gelada directory.', 'utf8'));
        }

        // Add artifacts if exists
        const artifactsDir = path.join(geladaDir, 'artifacts');
        if (fs.existsSync(artifactsDir)) {
          zip.addLocalFolder(artifactsDir, 'artifacts');
        }

        zip.writeZip(bundlePath);
        console.log(`Debug bundle created successfully.`);
        console.log(`Please attach ${bundleName} when reporting an issue.`);
      } catch (err) {
        console.error('Failed to create debug bundle:', err);
        process.exit(1);
      }
    });
}
