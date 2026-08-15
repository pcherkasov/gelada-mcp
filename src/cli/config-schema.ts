import { SUPPORTED_LOCALES, t, type MessageKey } from './utils/i18n.js';

/**
 * The settings a person is expected to change, and what a valid value is.
 *
 * One registry, used by both `gelada config set` and the interactive editor, so
 * the two cannot disagree about what is allowed. Before this existed, `set`
 * accepted anything: `gelada config set policy.mode nonsense` wrote nonsense to
 * disk and the next run silently fell back to a default, which looks exactly
 * like the setting having no effect.
 *
 * Anything absent here is still readable with `config get` and writable by hand;
 * it is simply not something the editor offers. `version` and `server.transport`
 * are the current examples — internal, single-valued, not decisions to make.
 */

export type SettingType = 'enum' | 'boolean' | 'number' | 'string' | 'list';

export interface SettingChoice {
  /** Written to the config file verbatim. */
  value: string;
  labelKey: MessageKey;
}

export interface Setting {
  key: string;
  labelKey: MessageKey;
  helpKey: MessageKey;
  type: SettingType;
  choices?: SettingChoice[];
  min?: number;
  max?: number;
}

export const SETTINGS: Setting[] = [
  {
    key: 'ui.language',
    labelKey: 'settings.ui.language.label',
    helpKey: 'settings.ui.language.help',
    type: 'enum',
    choices: [
      { value: '', labelKey: 'settings.ui.language.auto' },
      { value: 'en', labelKey: 'settings.ui.language.en' },
      { value: 'ru', labelKey: 'settings.ui.language.ru' },
      { value: 'uk', labelKey: 'settings.ui.language.uk' },
      { value: 'pl', labelKey: 'settings.ui.language.pl' },
    ],
  },
  {
    key: 'worker.command',
    labelKey: 'settings.worker.command.label',
    helpKey: 'settings.worker.command.help',
    type: 'string',
  },
  {
    key: 'worker.timeoutSeconds',
    labelKey: 'settings.worker.timeout.label',
    helpKey: 'settings.worker.timeout.help',
    type: 'number',
    min: 30,
    max: 7200,
  },
  {
    key: 'policy.mode',
    labelKey: 'settings.policy.mode.label',
    helpKey: 'settings.policy.mode.help',
    type: 'enum',
    choices: [
      { value: 'strict', labelKey: 'settings.policy.mode.strict' },
      { value: 'permissive', labelKey: 'settings.policy.mode.permissive' },
      { value: 'disabled', labelKey: 'settings.policy.mode.disabled' },
    ],
  },
  {
    key: 'policy.allowedCommands',
    labelKey: 'settings.policy.allowed.label',
    helpKey: 'settings.policy.allowed.help',
    type: 'list',
  },
  {
    key: 'policy.blockedPatterns',
    labelKey: 'settings.policy.blocked.label',
    helpKey: 'settings.policy.blocked.help',
    type: 'list',
  },
  {
    key: 'logging.level',
    labelKey: 'settings.logging.level.label',
    helpKey: 'settings.logging.level.help',
    type: 'enum',
    choices: [
      { value: 'debug', labelKey: 'settings.logging.level.debug' },
      { value: 'info', labelKey: 'settings.logging.level.info' },
      { value: 'warn', labelKey: 'settings.logging.level.warn' },
      { value: 'error', labelKey: 'settings.logging.level.error' },
    ],
  },
  {
    key: 'logging.logToFile',
    labelKey: 'settings.logging.toFile.label',
    helpKey: 'settings.logging.toFile.help',
    type: 'boolean',
  },
];

export function findSetting(key: string): Setting | undefined {
  return SETTINGS.find((s) => s.key === key);
}

export interface ValidationResult {
  ok: boolean;
  /** Already localised, ready to print. */
  error?: string;
  /** The value to store, parsed to its real type. */
  value?: unknown;
}

/**
 * Checks a raw string against a setting, and converts it.
 *
 * Keys the registry does not know are accepted unchanged: this validates what it
 * understands rather than becoming a gate that blocks every future key until
 * somebody remembers to add it here.
 */
export function validateSetting(key: string, raw: string): ValidationResult {
  const setting = findSetting(key);
  if (!setting) return { ok: true, value: coerceScalar(raw) };

  switch (setting.type) {
    case 'enum': {
      const allowed = (setting.choices ?? []).map((c) => c.value);
      if (!allowed.includes(raw)) {
        return {
          ok: false,
          error: t('settings.error.enum', {
            key,
            value: raw,
            allowed: allowed.map((v) => (v === '' ? "''" : v)).join(', '),
          }),
        };
      }
      return { ok: true, value: raw };
    }

    case 'boolean': {
      const truthy = ['true', 'yes', 'on', '1'];
      const falsy = ['false', 'no', 'off', '0'];
      const normalised = raw.trim().toLowerCase();
      if (truthy.includes(normalised)) return { ok: true, value: true };
      if (falsy.includes(normalised)) return { ok: true, value: false };
      return { ok: false, error: t('settings.error.boolean', { key, value: raw }) };
    }

    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return { ok: false, error: t('settings.error.number', { key, value: raw }) };
      }
      if (setting.min !== undefined && n < setting.min) {
        return {
          ok: false,
          error: t('settings.error.range', { key, min: setting.min, max: setting.max ?? '∞' }),
        };
      }
      if (setting.max !== undefined && n > setting.max) {
        return {
          ok: false,
          error: t('settings.error.range', { key, min: setting.min ?? 0, max: setting.max }),
        };
      }
      return { ok: true, value: n };
    }

    case 'list': {
      const items = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return { ok: true, value: items };
    }

    default:
      return { ok: true, value: raw };
  }
}

/** What `config set` did before there was a registry, kept for unknown keys. */
function coerceScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

/** Renders a stored value the way the editor should show it. */
export function displayValue(setting: Setting, value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : t('settings.empty');

  if (setting.type === 'enum') {
    const choice = setting.choices?.find((c) => c.value === String(value ?? ''));
    return choice ? t(choice.labelKey) : String(value ?? '');
  }

  if (setting.type === 'boolean') return value ? t('settings.on') : t('settings.off');

  const text = String(value ?? '');
  return text === '' ? t('settings.empty') : text;
}

export { SUPPORTED_LOCALES };
