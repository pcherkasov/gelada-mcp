import path from 'node:path';
import { Command } from 'commander';
import { PolicyEngine } from '../../components/policy-engine.js';
import { RetentionPolicy, ArtifactManager } from '../../components/artifact-manager.js';
import { expandHome } from '../utils/paths.js';

export interface CleanupCommandOptions {
  repo?: string;
  globalConfig?: string;
  dryRun?: boolean;
  maxRuns?: string;
  maxAgeDays?: string;
  maxDiskSize?: string;
  json?: boolean;
}

export interface CleanupResultJSON {
  success: boolean;
  dryRun: boolean;
  deletedBundles: string[];
  deletedCount: number;
  freedBytes: number;
  freedFormatted: string;
  remainingBundles: number;
  repoPath: string;
  error?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(2).replace(/\.00$/, '')} ${units[i]}`;
}

export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Clean up obsolete task artifact bundles based on retention policies')
    .option('-r, --repo <path>', 'Target repository workspace path', process.cwd())
    .option('-g, --global-config <path>', 'Custom path or directory for global configuration')
    .option('-n, --dry-run', 'Simulate cleanup without deleting any artifact files')
    .option('--max-runs <count>', 'Override maximum number of task runs to retain')
    .option('--max-age-days <days>', 'Override maximum task artifact age in days')
    .option('--max-disk-size <size>', 'Override maximum total artifact disk space (e.g. 100MB, 1GB)')
    .option('--json', 'Output cleanup summary as JSON')
    .action(async (options: CleanupCommandOptions) => {
      try {
        const repoPath = path.resolve(expandHome(options.repo || process.cwd()));

        // 1. Load PolicyEngine configuration
        const policyEngine = new PolicyEngine(undefined, {
          repoPath,
          globalConfigPath: options.globalConfig,
          autoLoad: true,
        });

        const effectivePolicy = policyEngine.getEffectivePolicy();
        const configuredRetention: RetentionPolicy = (effectivePolicy.retention as RetentionPolicy) || {};

        // 2. Apply CLI option overrides over policy engine configuration
        const retentionPolicy: RetentionPolicy = {
          maxRuns: options.maxRuns !== undefined ? parseInt(options.maxRuns, 10) : configuredRetention.maxRuns,
          maxAgeDays: options.maxAgeDays !== undefined ? parseInt(options.maxAgeDays, 10) : configuredRetention.maxAgeDays,
          maxDiskSize: options.maxDiskSize !== undefined ? options.maxDiskSize : (configuredRetention.maxTotalSize ?? configuredRetention.maxDiskSize),
        };

        // Validate parsed numeric overrides
        if (retentionPolicy.maxRuns !== undefined && (isNaN(retentionPolicy.maxRuns) || retentionPolicy.maxRuns < 0)) {
          throw new Error('Invalid --max-runs value: must be a non-negative integer.');
        }
        if (retentionPolicy.maxAgeDays !== undefined && (isNaN(retentionPolicy.maxAgeDays) || retentionPolicy.maxAgeDays < 0)) {
          throw new Error('Invalid --max-age-days value: must be a non-negative integer.');
        }

        // 3. Instantiate ArtifactManager and invoke cleanup
        const artifactManager = new ArtifactManager({ repoRoot: repoPath });
        const result = await artifactManager.cleanup(retentionPolicy, { dryRun: options.dryRun || false });

        const freedFormatted = formatBytes(result.freedBytes);
        const deletedCount = result.deletedBundles.length;
        const remainingBundles = result.remainingBundles;

        // 4. Output formatting
        if (options.json) {
          const jsonOutput: CleanupResultJSON = {
            success: true,
            dryRun: options.dryRun || false,
            deletedBundles: result.deletedBundles,
            deletedCount,
            freedBytes: result.freedBytes,
            freedFormatted,
            remainingBundles,
            repoPath,
          };
          console.log(JSON.stringify(jsonOutput, null, 2));
        } else {
          const prefix = options.dryRun ? '[Dry Run] Would clean up' : '✅ Cleaned up';
          if (deletedCount === 0) {
            if (options.dryRun) {
              console.log(
                `ℹ️  [Dry Run] No task bundles require cleanup. (${remainingBundles} bundle${remainingBundles === 1 ? '' : 's'} remaining).`,
              );
            } else {
              console.log(
                `ℹ️  No task bundles required cleanup. (0 bundles deleted, 0 B freed, ${remainingBundles} bundle${remainingBundles === 1 ? '' : 's'} remaining).`,
              );
            }
          } else {
            const bundleListStr = result.deletedBundles.join(', ');
            console.log(
              `${prefix} ${deletedCount} task bundle${deletedCount === 1 ? '' : 's'} (${bundleListStr}), freed ${freedFormatted} (${result.freedBytes.toLocaleString()} bytes). ${remainingBundles} bundle${remainingBundles === 1 ? '' : 's'} remaining.`,
            );
          }
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                success: false,
                dryRun: options.dryRun || false,
                deletedBundles: [],
                deletedCount: 0,
                freedBytes: 0,
                freedFormatted: '0 B',
                remainingBundles: 0,
                repoPath: options.repo || process.cwd(),
                error: errorMsg,
              },
              null,
              2,
            ),
          );
        } else {
          console.error(`❌ Cleanup failed: ${errorMsg}`);
        }
        process.exit(1);
      }
    });
}
