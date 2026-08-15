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

      let updateInfo;
      try {
        updateInfo = await updater.checkForUpdates();
      } catch (error: unknown) {
        // A check that could not run is reported as a failure, never as good
        // news. Answering "up to date" here is the one answer a user acts on by
        // doing nothing, which is exactly wrong when the truth is unknown.
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) {
          console.log(JSON.stringify({ currentVersion, checked: false, error: message }, null, 2));
        } else {
          console.error(`Could not check for updates: ${message}`);
          console.error(`Current version: v${currentVersion}`);
        }
        process.exitCode = 1;
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ ...updateInfo, checked: true }, null, 2));
      } else {
        console.log('=== Gelada Update Status ===');
        console.log(`Current version: v${updateInfo.currentVersion}`);
        console.log(`Latest version:  v${updateInfo.latestVersion}`);
        console.log(`Status:          ${updateInfo.upToDate ? 'Up to date' : 'Update available'}\n`);
      }

      if (updateInfo.upToDate) return;

      if (!options.install) {
        if (!options.json) {
          console.log('Run `gelada update --install` to upgrade, or do it yourself with:');
          console.log(`  ${updater.manualInstructions(updateInfo)}`);
          console.log(`\nRelease notes: ${updateInfo.releaseUrl}`);
        }
        return;
      }

      try {
        await updater.installUpdate(updateInfo);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Update failed: ${message}`);
        process.exitCode = 1;
      }
    });
}
