import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { getConfigPath } from '../utils/paths.js';
import { DEFAULT_GELADA_CONFIG, GeladaConfigSchema } from './setup.js';
import { t } from '../utils/i18n.js';
import { validateSetting } from '../config-schema.js';
import { runConfigEditor } from '../config-editor.js';
import { NotInteractiveError } from '../utils/prompt.js';

export interface ReadConfigResult {
  config: GeladaConfigSchema;
  path: string;
  exists: boolean;
  corrupt: boolean;
  warning?: string;
  error?: string;
}

function getNestedValue(obj: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object' && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split('.');
  let curr: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!curr[part] || typeof curr[part] !== 'object' || Array.isArray(curr[part])) {
      curr[part] = {};
    }
    curr = curr[part] as Record<string, unknown>;
  }

  curr[parts[parts.length - 1]] = value;
}

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const output: Record<string, unknown> = { ...target };
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    Object.keys(source).forEach((key) => {
      const sourceVal = source[key];
      const targetVal = target[key];
      if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
        if (
          !(key in target) ||
          !targetVal ||
          typeof targetVal !== 'object' ||
          Array.isArray(targetVal)
        ) {
          output[key] = { ...sourceVal };
        } else {
          output[key] = deepMerge(
            targetVal as Record<string, unknown>,
            sourceVal as Record<string, unknown>,
          );
        }
      } else {
        output[key] = sourceVal;
      }
    });
  }
  return output as T;
}

export function readConfig(customPath?: string): ReadConfigResult {
  const configPath = getConfigPath(customPath);

  if (!fs.existsSync(configPath)) {
    return {
      config: DEFAULT_GELADA_CONFIG,
      path: configPath,
      exists: false,
      corrupt: false,
      warning: `Configuration file not found at ${configPath}. Showing default settings. Run 'gelada setup' to initialize.`,
    };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Written by every version up to 0.1.8 and read by nothing: no migration
    // ever consulted it, so it promised a compatibility guarantee that did not
    // exist while looking, next to `gelada --version`, like a wrong answer.
    delete parsed.version;
    const merged = deepMerge(
      DEFAULT_GELADA_CONFIG as unknown as Record<string, unknown>,
      parsed,
    ) as unknown as GeladaConfigSchema;
    return {
      config: merged,
      path: configPath,
      exists: true,
      corrupt: false,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      config: DEFAULT_GELADA_CONFIG,
      path: configPath,
      exists: true,
      corrupt: true,
      error: `Failed to parse configuration file at ${configPath}: ${errorMsg}`,
    };
  }
}

export function writeConfig(config: Record<string, unknown>, customPath?: string): void {
  const configPath = getConfigPath(customPath);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function printConfig(options: { json?: boolean }): void {
  const res = readConfig();
  if (res.corrupt) {
    console.error(`❌ ${res.error}`);
    process.exit(1);
  }

  if (res.warning && !options.json) {
    console.warn(`⚠️  ${res.warning}`);
  }

  if (options.json) {
    console.log(JSON.stringify(res.config, null, 2));
  } else {
    console.log(`Configuration (${res.path}):`);
    console.log(JSON.stringify(res.config, null, 2));
  }
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description(t('cli.cmd.config'));

  // A bare `gelada config` at a terminal opens the editor; through a pipe it
  // keeps printing the configuration, so scripts reading it are unaffected. Same
  // split as a bare `gelada`: a terminal means a person.
  configCmd.action(async () => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      printConfig({});
      return;
    }
    try {
      const changed = await runConfigEditor({
        read: () => {
          const res = readConfig();
          return { config: res.config as unknown as Record<string, unknown>, path: res.path, corrupt: res.corrupt, error: res.error };
        },
        write: (config) => writeConfig(config),
        log: (message) => console.log(message),
        error: (message) => console.error(`❌ ${message}`),
      });
      if (changed === -1) process.exitCode = 1;
    } catch (err: unknown) {
      if (err instanceof NotInteractiveError) {
        console.error(t('editor.notInteractive'));
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  });

  configCmd
    .command('list')
    .alias('show')
    .description('Display current configuration settings')
    .option('--json', 'Output configuration as raw JSON')
    .action((options: { json?: boolean }) => printConfig(options));

  configCmd
    .command('get <key>')
    .description('Get value of a specific configuration property (e.g. worker.command)')
    .option('--json', 'Output value as JSON')
    .action((key: string, options: { json?: boolean }) => {
      const res = readConfig();
      if (res.corrupt) {
        console.error(`❌ ${res.error}`);
        process.exit(1);
      }

      const val = getNestedValue(res.config as unknown as Record<string, unknown>, key);
      if (val === undefined) {
        console.error(`Key '${key}' not found in configuration.`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ key, value: val }, null, 2));
      } else {
        console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val));
      }
    });

  configCmd
    .command('set <key> <value>')
    .description('Set value of a specific configuration property')
    .action((key: string, value: string) => {
      const res = readConfig();
      if (res.corrupt) {
        console.error(`❌ ${res.error}`);
        console.error(
          `Hint: Fix syntax error or run 'gelada setup --force' before modifying settings.`,
        );
        process.exit(1);
      }

      // Validated through the same registry the editor uses, so the two cannot
      // disagree. Before this, `set` took anything: writing nonsense to
      // policy.mode succeeded and the next run quietly used a default, which is
      // indistinguishable from the setting having no effect.
      const validation = validateSetting(key, value);
      if (!validation.ok) {
        console.error(`❌ ${validation.error}`);
        process.exit(1);
      }

      const configObj = structuredClone(res.config) as unknown as Record<string, unknown>;
      setNestedValue(configObj, key, validation.value);

      writeConfig(configObj, res.path);
      console.log(`✅ Updated ${key} = ${value} in ${res.path}`);
    });

  configCmd
    .command('path')
    .description('Display absolute path to configuration file')
    .action(() => {
      console.log(getConfigPath());
    });
}
