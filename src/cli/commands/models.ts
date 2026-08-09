import { Command } from 'commander';

export interface ModelProfile {
  name: string;
  description: string;
  targetWorkerModel: string;
  recommendedTaskTypes: string[];
}

export const DEFAULT_MODEL_PROFILES: ModelProfile[] = [
  {
    name: 'FAST',
    description: 'Fast, lightweight worker model for simple boilerplate, localization, and formatting',
    targetWorkerModel: 'gemini-2.5-flash',
    recommendedTaskTypes: ['dto-gen', 'loc-sync', 'format-lint', 'doc-gen'],
  },
  {
    name: 'BALANCED',
    description: 'Balanced worker model for targeted unit tests, small refactoring, and DTO mappers',
    targetWorkerModel: 'gemini-2.5-pro',
    recommendedTaskTypes: ['unit-test', 'refactor', 'mapper-gen'],
  },
  {
    name: 'DEEP',
    description: 'High-capability worker model for complex subtasks and multi-file code modifications',
    targetWorkerModel: 'gemini-2.5-pro',
    recommendedTaskTypes: ['bug-fix', 'complex-refactor'],
  },
  {
    name: 'DEFAULT',
    description: 'Default fallback worker model profile',
    targetWorkerModel: 'gemini-2.5-flash',
    recommendedTaskTypes: ['general'],
  },
];

export interface ModelsCommandOptions {
  json?: boolean;
}

export function registerModelsCommand(program: Command): void {
  program
    .command('models')
    .description('View available Gelada worker model profiles and resolution mappings')
    .option('--json', 'Output model profiles in JSON format')
    .action((options: ModelsCommandOptions) => {
      if (options.json) {
        console.log(JSON.stringify(DEFAULT_MODEL_PROFILES, null, 2));
        return;
      }

      console.log('=== Gelada Worker Model Profiles ===\n');
      for (const profile of DEFAULT_MODEL_PROFILES) {
        console.log(`Profile: ${profile.name}`);
        console.log(`  Description:  ${profile.description}`);
        console.log(`  Target Model: ${profile.targetWorkerModel}`);
        console.log(`  Use Cases:    ${profile.recommendedTaskTypes.join(', ')}`);
        console.log('');
      }
    });
}
