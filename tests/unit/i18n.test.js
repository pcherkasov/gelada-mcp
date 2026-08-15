import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  normalizeLocale,
  resolveLocale,
  readConfiguredLocale,
  setLocale,
  currentLocale,
  t,
  SUPPORTED_LOCALES,
} from '../../dist/cli/utils/i18n.js';
import { en } from '../../dist/cli/i18n/en.js';
import { ru } from '../../dist/cli/i18n/ru.js';
import { uk } from '../../dist/cli/i18n/uk.js';
import { pl } from '../../dist/cli/i18n/pl.js';

const execFileAsync = promisify(execFile);
const GELADA_BIN = path.resolve(process.cwd(), 'bin/gelada.js');

describe('CLI localisation', () => {
  afterEach(() => setLocale(undefined));

  describe('catalogues', () => {
    const catalogues = { ru, uk, pl };

    it('ships one catalogue per supported locale', () => {
      assert.deepEqual([...SUPPORTED_LOCALES], ['en', 'ru', 'uk', 'pl']);
    });

    for (const [locale, catalogue] of Object.entries(catalogues)) {
      it(`${locale} covers every English key and adds none`, () => {
        // TypeScript already enforces this as Record<MessageKey, string>; the
        // runtime check catches a catalogue that drifted through a loose cast.
        assert.deepEqual(Object.keys(catalogue).sort(), Object.keys(en).sort());
      });

      it(`${locale} keeps every placeholder its English message uses`, () => {
        // A dropped {path} or {count} is a message that silently loses the one
        // piece of information the reader needed.
        for (const [key, english] of Object.entries(en)) {
          const expected = [...english.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
          const actual = [...catalogue[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
          assert.deepEqual(actual, expected, `${locale}/${key} placeholders`);
        }
      });

      it(`${locale} translates something rather than copying English`, () => {
        const identical = Object.keys(en).filter((k) => catalogue[k] === en[k]);
        // Some values are meant to match: 'Git CLI', format-only strings.
        assert.ok(
          identical.length < Object.keys(en).length / 2,
          `${locale} left ${identical.length} of ${Object.keys(en).length} keys untranslated`,
        );
      });
    }
  });

  describe('normalizeLocale', () => {
    it('accepts the shapes an environment actually holds', () => {
      assert.equal(normalizeLocale('ru'), 'ru');
      assert.equal(normalizeLocale('ru_RU.UTF-8'), 'ru');
      assert.equal(normalizeLocale('uk-UA'), 'uk');
      assert.equal(normalizeLocale('pl_PL@euro'), 'pl');
      assert.equal(normalizeLocale('EN_GB'), 'en');
    });

    it('rejects what is not a language we ship', () => {
      // C and POSIX mean "no locale", not "a locale we failed to parse".
      for (const raw of ['C', 'POSIX', 'de_DE.UTF-8', '', undefined, null]) {
        assert.equal(normalizeLocale(raw), undefined, `${raw} must not resolve`);
      }
    });
  });

  describe('resolveLocale precedence', () => {
    // Both inputs are required, so these assertions cannot quietly start
    // reading the config of whoever runs the suite — which is how they used to
    // pass everywhere except on a machine that had a language set.
    const unset = undefined;

    it('lets GELADA_LANG win over everything', () => {
      assert.equal(resolveLocale({ GELADA_LANG: 'pl', LANG: 'ru_RU.UTF-8' }, unset), 'pl');
      assert.equal(resolveLocale({ GELADA_LANG: 'pl', LANG: 'ru_RU.UTF-8' }, 'uk'), 'pl');
    });

    it('lets the configured language win over the environment', () => {
      assert.equal(resolveLocale({ LANG: 'ru_RU.UTF-8' }, 'uk'), 'uk');
    });

    it('falls back through LC_ALL, LC_MESSAGES and LANG', () => {
      assert.equal(resolveLocale({ LC_ALL: 'uk_UA.UTF-8' }, unset), 'uk');
      assert.equal(resolveLocale({ LC_MESSAGES: 'ru_RU.UTF-8' }, unset), 'ru');
      assert.equal(resolveLocale({ LANG: 'pl_PL.UTF-8' }, unset), 'pl');
    });

    it('ends at English when nothing says otherwise', () => {
      assert.equal(resolveLocale({}, unset), 'en');
      assert.equal(resolveLocale({ LANG: 'C' }, unset), 'en');
    });
  });

  describe('readConfiguredLocale', () => {
    it('reads ui.language from the config file', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-i18n-'));
      const file = path.join(dir, 'config.yaml');
      fs.writeFileSync(file, 'ui:\n  language: uk\n', 'utf-8');

      assert.equal(readConfiguredLocale(file), 'uk');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('ignores a missing file, an unparseable one, and an unknown language', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-i18n-'));
      const broken = path.join(dir, 'broken.yaml');
      fs.writeFileSync(broken, '\tui: [unclosed\n', 'utf-8');
      const unknown = path.join(dir, 'unknown.yaml');
      fs.writeFileSync(unknown, 'ui:\n  language: klingon\n', 'utf-8');

      assert.equal(readConfiguredLocale(path.join(dir, 'absent.yaml')), undefined);
      assert.equal(readConfiguredLocale(broken), undefined);
      assert.equal(readConfiguredLocale(unknown), undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('t', () => {
    it('returns the message for the active locale', () => {
      setLocale('ru');
      assert.equal(currentLocale(), 'ru');
      assert.equal(t('doctor.node.name'), ru['doctor.node.name']);

      setLocale('pl');
      assert.equal(t('doctor.node.name'), pl['doctor.node.name']);
    });

    it('fills placeholders', () => {
      setLocale('en');
      assert.equal(t('doctor.node.ok', { version: 'v24.0.0' }), 'Node.js v24.0.0');
      assert.equal(t('doctor.registration.okMany', { count: 3 }), '3 client registrations resolve');
    });

    it('leaves a placeholder alone when nothing was supplied for it', () => {
      setLocale('en');
      assert.match(t('doctor.node.ok', { unrelated: 'x' }), /\{version\}/);
    });
  });

  describe('end to end', () => {
    // A fresh config dir per call: otherwise the fallback case reads whatever
    // ui.language the developer happens to have set, and "unknown language
    // falls back to English" quietly becomes "unknown language falls back to
    // your language".
    async function doctorIn(locale) {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-i18n-e2e-'));
      try {
        const { stdout } = await execFileAsync(
          process.execPath,
          [GELADA_BIN, 'doctor', '--no-worker'],
          { env: { ...process.env, GELADA_LANG: locale, GELADA_CONFIG_DIR: configDir } },
        );
        return stdout;
      } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
      }
    }

    it('prints doctor in each language', async () => {
      assert.match(await doctorIn('en'), /Gelada Diagnostic Check/);
      assert.match(await doctorIn('ru'), /Диагностика Gelada/);
      assert.match(await doctorIn('uk'), /Діагностика Gelada/);
      assert.match(await doctorIn('pl'), /Diagnostyka Gelada/);
    });

    it('falls back to English for a language it does not ship', async () => {
      assert.match(await doctorIn('de'), /Gelada Diagnostic Check/);
    });

    it('refuses an unsupported ui.language rather than ignoring it', async () => {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-i18n-cfg-'));
      try {
        await assert.rejects(
          () =>
            execFileAsync(process.execPath, [GELADA_BIN, 'config', 'set', 'ui.language', 'klingon'], {
              env: { ...process.env, GELADA_CONFIG_DIR: configDir, GELADA_LANG: 'en' },
            }),
          (err) => {
            // Rejected by the shared settings registry, which replaced the
            // language-specific check with one message shape for every setting.
            assert.match(String(err.stderr), /ui\.language must be one of/);
            return true;
          },
        );
      } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
      }
    });
  });
});
