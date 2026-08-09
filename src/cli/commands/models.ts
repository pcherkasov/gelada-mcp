import { Command } from 'commander';

import {
  PROFILE_DEFINITIONS,
  loadWorkerModelCatalog,
  selectModelForProfile,
} from '../../components/model-catalog.js';

export interface ModelsCommandOptions {
  json?: boolean;
  refresh?: boolean;
}

export function registerModelsCommand(program: Command): void {
  program
    .command('models')
    .description('List worker models available to Gelada and how profiles resolve to them')
    .option('--json', 'Output as JSON')
    .option('--refresh', 'Bypass the cache and re-query the worker CLI')
    .action(async (options: ModelsCommandOptions) => {
      const catalog = await loadWorkerModelCatalog({ refresh: options.refresh });

      const profiles = PROFILE_DEFINITIONS.map((profile) => ({
        name: profile.name,
        description: profile.description,
        resolvesTo: selectModelForProfile(profile.name, catalog.models) ?? null,
        recommendedTaskTypes: profile.recommendedTaskTypes,
      }));

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              source: catalog.source,
              fetchedAt: new Date(catalog.fetchedAt).toISOString(),
              warning: catalog.warning,
              models: catalog.models,
              profiles,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (catalog.warning) {
        console.warn(`Warning: ${catalog.warning}\n`);
      }

      console.log(`=== Worker models (source: ${catalog.source}) ===\n`);
      for (const model of catalog.models) {
        console.log(`  ${model.id}${model.label !== model.id ? `  —  ${model.label}` : ''}`);
      }

      console.log('\n=== Profiles ===\n');
      for (const profile of profiles) {
        console.log(`Profile: ${profile.name}`);
        console.log(`  ${profile.description}`);
        console.log(`  Resolves to: ${profile.resolvesTo ?? '(no matching model available)'}`);
        console.log(`  Typical tasks: ${profile.recommendedTaskTypes.join(', ')}`);
        console.log('');
      }
    });
}
