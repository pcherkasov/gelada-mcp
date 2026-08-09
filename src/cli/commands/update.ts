import { Command } from 'commander';
import { Updater } from '../utils/updater.js';
import { packageVersion } from '../../utils/package-paths.js';

export interface UpdateCommandOptions {
  json?: boolean;
  install?: boolean;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Check for Gelada MCP server updates and optionally install them')
    .option('--json', 'Output update information in JSON format')
    .option('--install', 'Install the latest update if available')
    .action(async (options: UpdateCommandOptions) => {
      // This used to resolve package.json through `__dirname`, which does not
      // exist in ESM — so the lookup always threw and the update check silently
      // compared against a hard-coded 0.1.0 no matter what was installed.
      const currentVersion = packageVersion();

      const updater = new Updater(currentVersion);
      
      try {
        const updateInfo = await updater.checkForUpdates();

        if (options.json) {
          console.log(JSON.stringify(updateInfo, null, 2));
          if (options.install && !updateInfo.upToDate) {
            await updater.installUpdate(updateInfo);
          }
          return;
        }

        console.log('=== Gelada Update Status ===');
        console.log(`Current version: v${updateInfo.currentVersion}`);
        console.log(`Latest version:  v${updateInfo.latestVersion}`);
        console.log(`Status:          ${updateInfo.upToDate ? 'Up to date' : 'Update available'}\n`);
        
        if (!updateInfo.upToDate) {
          if (options.install) {
            await updater.installUpdate(updateInfo);
          } else {
            console.log('Run `gelada update --install` to upgrade to the latest version.');
            console.log(`Or view release notes at: ${updateInfo.releaseUrl}`);
          }
        }
      } catch (error: any) {
        if (options.json) {
          console.error(JSON.stringify({ error: error.message }));
        } else {
          console.error(`Update failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
