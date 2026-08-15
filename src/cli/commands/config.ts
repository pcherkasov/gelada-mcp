import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { getConfigPath } from '../utils/paths.js';
import { DEFAULT_GELADA_CONFIG, GeladaConfigSchema } from './setup.js';
import { normalizeLocale, SUPPORTED_LOCALES, t } from '../utils/i18n.js';

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

function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: string): void {
  const parts = keyPath.split('.');
  let curr: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!curr[part] || typeof curr[part] !== 'object' || Array.isArray(curr[part])) {
      curr[part] = {};
    }
    curr = curr[part] as Record<string, unknown>;
  }

  let parsedVal: unknown = value;
  if (value === 'true') parsedVal = true;
  else if (value === 'false') parsedVal = false;
  else if (!isNaN(Number(value)) && value.trim() !== '') parsedVal = Number(value);

  curr[parts[parts.length - 1]] = parsedVal;
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

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description(t('cli.cmd.config'));

  configCmd
    .command('list', { isDefault: true })
    .alias('show')
    .description('Display current configuration settings')
    .option('--json', 'Output configuration as raw JSON')
    .action((options: { json?: boolean }) => {
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
    });

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

      // The one key worth checking: a typo here is silent otherwise, since an
      // unknown language simply falls back to English and looks like the
      // setting was ignored.
      if (key === 'ui.language' && value !== '' && !normalizeLocale(value)) {
        console.error(
          `❌ ${t('config.language.invalid', {
            value,
            supported: SUPPORTED_LOCALES.join(', '),
          })}`,
        );
        process.exit(1);
      }

      const configObj = structuredClone(res.config) as unknown as Record<string, unknown>;
      setNestedValue(configObj, key, value);

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
