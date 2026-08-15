import { SETTINGS, displayValue, validateSetting, type Setting } from './config-schema.js';
import { NotInteractiveError, select, text } from './utils/prompt.js';
import { t } from './utils/i18n.js';

/**
 * The interactive half of `gelada config`.
 *
 * It edits the same file `config set` writes, through the same validator, so
 * the two cannot drift into disagreeing about what a valid setting is. Each
 * change is saved as it is made rather than at the end: there is no "discard
 * everything" affordance on screen, so there should be no unsaved state to
 * lose if the terminal goes away mid-session.
 */

export function getNested(obj: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object' && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

export function setNested(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split('.');
  let cursor = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

/** Builds the rows of the main list: every setting, then a way out. */
export function buildRows(config: Record<string, unknown>): {
  setting: Setting | undefined;
  label: string;
  hint: string;
}[] {
  const rows: { setting: Setting | undefined; label: string; hint: string }[] = SETTINGS.map(
    (setting) => ({
      setting,
      label: t(setting.labelKey),
      hint: displayValue(setting, getNested(config, setting.key)),
    }),
  );

  rows.push({ setting: undefined, label: t('settings.done'), hint: t('settings.doneHint') });
  return rows;
}

/** Turns a stored value back into the string a text field should start from. */
export function currentAsText(setting: Setting, value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === undefined || value === null ? '' : String(value);
}

export interface EditorIO {
  read(): { config: Record<string, unknown>; path: string; corrupt: boolean; error?: string };
  write(config: Record<string, unknown>): void;
  log(message: string): void;
  error(message: string): void;
}

/**
 * Runs the editor until the operator picks Done or presses q.
 *
 * Returns the number of settings actually changed, which is what the caller
 * reports; zero is worth saying out loud so a session that did nothing does not
 * look like a session that silently failed.
 */
export async function runConfigEditor(io: EditorIO): Promise<number> {
  const state = io.read();
  if (state.corrupt) {
    io.error(t('editor.corrupt', { error: state.error ?? '' }));
    io.error(t('editor.corruptHint'));
    return -1;
  }

  const config = state.config;
  let changes = 0;
  let cursor = 0;

  for (;;) {
    const rows = buildRows(config);
    const chosenIndex = await select<number>({
      title: t('editor.title', { path: state.path }),
      choices: rows.map((row, index) => ({ value: index, label: row.label, hint: row.hint })),
      footer: t('editor.footer'),
      initialIndex: cursor,
    });

    if (chosenIndex === undefined) break;
    cursor = chosenIndex;

    const setting = rows[chosenIndex].setting;
    if (!setting) break; // "Done"

    const before = getNested(config, setting.key);
    const next = await promptForValue(setting, before, io);
    if (next === undefined) continue;

    setNested(config, setting.key, next);
    io.write(config);
    changes += 1;
    io.log(t('editor.saved', { key: setting.key, value: displayValue(setting, next) }));
  }

  if (changes === 0) io.log(t('editor.unchanged'));
  return changes;
}

async function promptForValue(
  setting: Setting,
  before: unknown,
  io: EditorIO,
): Promise<unknown | undefined> {
  if (setting.type === 'enum' || setting.type === 'boolean') {
    const choices =
      setting.type === 'boolean'
        ? [
            { value: 'true', label: t('settings.on') },
            { value: 'false', label: t('settings.off') },
          ]
        : (setting.choices ?? []).map((c) => ({ value: c.value, label: t(c.labelKey) }));

    const currentIndex = choices.findIndex((c) => c.value === String(before ?? ''));
    const picked = await select<string>({
      title: `${t(setting.labelKey)} — ${t(setting.helpKey)}`,
      choices,
      footer: t('editor.footerEnum'),
      initialIndex: currentIndex >= 0 ? currentIndex : 0,
    });
    if (picked === undefined) return undefined;

    const result = validateSetting(setting.key, picked);
    return result.ok ? result.value : undefined;
  }

  const current = currentAsText(setting, before);
  const typed = await text({
    title: `${t(setting.labelKey)} — ${t(setting.helpKey)}`,
    current,
    footer: t('editor.footerText', { current: current || t('settings.empty') }),
  });
  if (typed === undefined || typed === current) return undefined;

  const result = validateSetting(setting.key, typed);
  if (!result.ok) {
    io.error(result.error ?? '');
    return undefined;
  }
  return result.value;
}

export { NotInteractiveError };
