import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { getDataDir } from '../cli/utils/paths.js';

const execFileAsync = promisify(execFile);

/** A concrete model the worker CLI is willing to accept. */
export interface WorkerModel {
  id: string;
  label: string;
}

export type CatalogSource = 'cli' | 'cache' | 'fallback';

export interface WorkerModelCatalog {
  models: WorkerModel[];
  source: CatalogSource;
  fetchedAt: number;
  /** Present when the worker CLI could not be queried. */
  warning?: string;
}

export type AbstractModelProfile = 'FAST' | 'BALANCED' | 'DEEP' | 'DEFAULT';

export interface ProfileDefinition {
  name: AbstractModelProfile;
  description: string;
  recommendedTaskTypes: string[];
  /**
   * Ordered preference patterns matched against live model ids. Patterns rather
   * than literal ids so the catalog keeps working when the worker CLI ships a
   * new model generation.
   */
  preferences: RegExp[];
}

export const PROFILE_DEFINITIONS: ProfileDefinition[] = [
  {
    name: 'FAST',
    description: 'Cheapest, quickest worker. Boilerplate, formatting, localization, docstrings.',
    recommendedTaskTypes: ['dto-gen', 'loc-sync', 'format-lint', 'doc-gen'],
    preferences: [/flash.*medium/i, /flash.*low/i, /flash/i, /pro.*low/i],
  },
  {
    name: 'BALANCED',
    description: 'Default trade-off. Targeted unit tests, small refactors, mappers.',
    recommendedTaskTypes: ['unit-test', 'refactor', 'mapper-gen'],
    preferences: [/pro.*low/i, /flash.*high/i, /pro/i, /flash/i],
  },
  {
    name: 'DEEP',
    description: 'Highest capability. Bounded bug fixes and multi-file changes.',
    recommendedTaskTypes: ['bug-fix', 'complex-refactor'],
    preferences: [/pro.*high/i, /opus/i, /sonnet/i, /pro/i, /flash.*high/i],
  },
  {
    name: 'DEFAULT',
    description: 'Fallback profile used when a task does not request one.',
    recommendedTaskTypes: ['general'],
    preferences: [/pro.*low/i, /flash.*high/i, /flash.*medium/i, /pro/i, /flash/i],
  },
];

/**
 * Last-resort catalog, used only when the worker CLI cannot be queried and no
 * cache exists. Deliberately a snapshot, not a source of truth — resolution
 * always prefers what the CLI actually reports.
 */
export const FALLBACK_WORKER_MODELS: WorkerModel[] = [
  { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
  { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
  { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
];

const CACHE_FILE_NAME = 'model-catalog.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Parses `agy models` output. Expected shape is `<id>\t<label>` per line, with
 * progress chatter ("Fetching available models...") interleaved.
 */
export function parseWorkerModelList(raw: string): WorkerModel[] {
  const models: WorkerModel[] = [];
  const seen = new Set<string>();

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let id: string | undefined;
    let label: string | undefined;

    const tabIndex = trimmed.indexOf('\t');
    if (tabIndex > 0) {
      id = trimmed.slice(0, tabIndex).trim();
      label = trimmed.slice(tabIndex + 1).trim();
    } else {
      // Fall back to two-or-more-spaces separation, then to a bare id.
      const spaced = trimmed.match(/^(\S+)\s{2,}(.+)$/);
      if (spaced) {
        id = spaced[1];
        label = spaced[2];
      } else if (/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed) && /[-.\d]/.test(trimmed)) {
        id = trimmed;
        label = trimmed;
      }
    }

    if (!id || id.includes(' ') || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: label || id });
  }

  return models;
}

function cachePath(): string {
  return path.join(getDataDir(), CACHE_FILE_NAME);
}

function readCache(): { models: WorkerModel[]; fetchedAt: number } | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf-8'));
    if (Array.isArray(parsed?.models) && parsed.models.length > 0) {
      return { models: parsed.models, fetchedAt: Number(parsed.fetchedAt) || 0 };
    }
  } catch {
    // No usable cache.
  }
  return undefined;
}

function writeCache(models: WorkerModel[], fetchedAt: number): void {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify({ fetchedAt, models }, null, 2), 'utf-8');
  } catch {
    // Cache is an optimisation; failing to persist it must not break a task.
  }
}

export interface LoadCatalogOptions {
  /** Worker CLI command, defaults to AGY_COMMAND or `agy`. */
  command?: string;
  /** Skip the cache and always query the CLI. */
  refresh?: boolean;
  timeoutMs?: number;
}

let memoryCatalog: WorkerModelCatalog | undefined;

/**
 * Resolves the list of models the worker CLI accepts, preferring live data,
 * then a recent on-disk cache, then the bundled fallback snapshot.
 */
export async function loadWorkerModelCatalog(
  options: LoadCatalogOptions = {},
): Promise<WorkerModelCatalog> {
  const now = Date.now();

  if (!options.refresh && memoryCatalog && now - memoryCatalog.fetchedAt < CACHE_TTL_MS) {
    return memoryCatalog;
  }

  if (!options.refresh) {
    const cached = readCache();
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      memoryCatalog = { models: cached.models, source: 'cache', fetchedAt: cached.fetchedAt };
      return memoryCatalog;
    }
  }

  const rawCommand = (options.command || process.env.AGY_COMMAND || 'agy').trim();
  const tokens = rawCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [rawCommand];
  const binary = tokens[0].replace(/^["']|["']$/g, '');
  const prefixArgs = tokens.slice(1).map((t) => t.replace(/^["']|["']$/g, ''));

  try {
    const { stdout, stderr } = await execFileAsync(binary, [...prefixArgs, 'models'], {
      timeout: options.timeoutMs ?? 20000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf-8',
    });
    const models = parseWorkerModelList(`${stdout}\n${stderr}`);
    if (models.length > 0) {
      writeCache(models, now);
      memoryCatalog = { models, source: 'cli', fetchedAt: now };
      return memoryCatalog;
    }
  } catch (err) {
    const stale = readCache();
    if (stale) {
      return {
        models: stale.models,
        source: 'cache',
        fetchedAt: stale.fetchedAt,
        warning: `Could not query "${binary} models" (${(err as Error).message}); using cached catalog.`,
      };
    }
  }

  const stale = readCache();
  if (stale) {
    return {
      models: stale.models,
      source: 'cache',
      fetchedAt: stale.fetchedAt,
      warning: 'Worker CLI returned no models; using cached catalog.',
    };
  }

  return {
    models: FALLBACK_WORKER_MODELS,
    source: 'fallback',
    fetchedAt: now,
    warning:
      'Worker CLI model list unavailable; using the bundled fallback snapshot. ' +
      'Run "gelada models --refresh" once the worker CLI is installed and authenticated.',
  };
}

export function getProfileDefinition(profile: string): ProfileDefinition | undefined {
  const upper = profile.trim().toUpperCase();
  return PROFILE_DEFINITIONS.find((p) => p.name === upper);
}

/**
 * Picks the best available model id for an abstract profile.
 * Returns undefined when nothing in the catalog matches.
 */
export function selectModelForProfile(
  profile: string,
  models: WorkerModel[],
): string | undefined {
  const definition = getProfileDefinition(profile);
  if (!definition || models.length === 0) return undefined;

  for (const pattern of definition.preferences) {
    const hit = models.find((m) => pattern.test(m.id) || pattern.test(m.label));
    if (hit) return hit.id;
  }

  return models[0].id;
}

/** True when the given string names a model the worker CLI reported. */
export function isKnownModelId(candidate: string, models: WorkerModel[]): boolean {
  const needle = candidate.trim().toLowerCase();
  return models.some((m) => m.id.toLowerCase() === needle);
}
