import fs from 'node:fs';
import YAML from 'yaml';

import { getConfigPath } from './paths.js';
import { en, type MessageKey } from '../i18n/en.js';
import { ru } from '../i18n/ru.js';
import { uk } from '../i18n/uk.js';
import { pl } from '../i18n/pl.js';

export type Locale = 'en' | 'ru' | 'uk' | 'pl';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'ru', 'uk', 'pl'] as const;

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { en, ru, uk, pl };

/**
 * Turns anything that looks like a language tag into a locale we ship.
 *
 * Accepts what actually turns up in the wild: `ru`, `ru_RU.UTF-8`, `uk-UA`,
 * `pl_PL@euro`. Anything else — including `C` and `POSIX`, which mean "no
 * locale", not "a locale we failed to parse" — returns undefined so the caller
 * can fall through to the next source rather than guessing.
 */
export function normalizeLocale(raw: string | undefined | null): Locale | undefined {
  if (!raw) return undefined;
  const tag = raw.trim().toLowerCase().split(/[._@-]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag) ? (tag as Locale) : undefined;
}

/** Reads `ui.language` from the global config, if one has been written. */
export function readConfiguredLocale(configPath: string = getConfigPath()): Locale | undefined {
  try {
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8')) as {
      ui?: { language?: unknown };
    };
    const configured = parsed?.ui?.language;
    return typeof configured === 'string' ? normalizeLocale(configured) : undefined;
  } catch {
    // No config yet, or an unreadable one. Neither is this module's problem:
    // `gelada config` reports a corrupt file on its own.
    return undefined;
  }
}

/**
 * Decides which language the CLI speaks.
 *
 * GELADA_LANG wins so a single command can be forced back to English when
 * pasting output into an issue. Then the configured preference, which is the
 * durable choice. Then the environment, so a Russian, Ukrainian or Polish
 * desktop gets its own language without being told to configure anything. Then
 * English, which every message is guaranteed to have.
 */
export function resolveLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  return (
    normalizeLocale(env.GELADA_LANG) ??
    readConfiguredLocale() ??
    normalizeLocale(env.LC_ALL) ??
    normalizeLocale(env.LC_MESSAGES) ??
    normalizeLocale(env.LANG) ??
    'en'
  );
}

let cached: Locale | undefined;

export function currentLocale(): Locale {
  if (!cached) cached = resolveLocale();
  return cached;
}

/** Test seam, and what `--lang` would hook into if it is ever added. */
export function setLocale(locale: Locale | undefined): void {
  cached = locale;
}

/**
 * Looks up a message and fills in its placeholders.
 *
 * Falls back to English per key rather than per catalogue: a message added to
 * en.ts and not yet translated shows up in English, in an otherwise translated
 * run, instead of breaking it. The catalogues are typed as complete records, so
 * that fallback is a runtime safety net, not a workflow.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const catalogue = CATALOGUES[currentLocale()] ?? en;
  const template = catalogue[key] ?? en[key] ?? key;

  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type { MessageKey };
