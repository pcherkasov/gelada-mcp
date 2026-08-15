import { Command } from 'commander';
import { Updater } from '../utils/updater.js';
import { packageVersion } from '../../utils/package-paths.js';
import { t } from '../utils/i18n.js';

export interface UpdateCommandOptions {
  json?: boolean;
  install?: boolean;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description(t('cli.cmd.update'))
    .option('--json', t('opt.json'))
    .option('--install', t('update.opt.install'))
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
          console.error(t('update.checkFailed', { error: message }));
          console.error(t('update.currentOnly', { version: currentVersion }));
        }
        process.exitCode = 1;
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ ...updateInfo, checked: true }, null, 2));
      } else {
        console.log(t('update.title'));
        console.log(t('update.current', { version: updateInfo.currentVersion }));
        console.log(t('update.latest', { version: updateInfo.latestVersion }));
        console.log(
          `${t('update.status', {
            status: updateInfo.upToDate ? t('update.upToDate') : t('update.available'),
          })}\n`,
        );
      }

      if (updateInfo.upToDate) return;

      if (!options.install) {
        if (!options.json) {
          console.log(t('update.howTo'));
          console.log(`  ${updater.manualInstructions(updateInfo)}`);
          console.log(`\n${t('update.releaseNotes', { url: updateInfo.releaseUrl })}`);
        }
        return;
      }

      try {
        await updater.installUpdate(updateInfo);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(t('update.failed', { error: message }));
        process.exitCode = 1;
      }
    });
}
