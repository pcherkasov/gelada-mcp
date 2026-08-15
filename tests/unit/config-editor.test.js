import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  SETTINGS,
  findSetting,
  validateSetting,
  displayValue,
} from '../../dist/cli/config-schema.js';
import {
  buildRows,
  currentAsText,
  getNested,
  setNested,
  runConfigEditor,
} from '../../dist/cli/config-editor.js';
import { applyKey, classifyKey, renderMenu, select, NotInteractiveError } from '../../dist/cli/utils/prompt.js';
import { setLocale } from '../../dist/cli/utils/i18n.js';

const execFileAsync = promisify(execFile);
const GELADA_BIN = path.resolve(process.cwd(), 'bin/gelada.js');

describe('interactive config', () => {
  let tmp;

  beforeEach(() => {
    setLocale('en');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-cfg-'));
  });

  afterEach(() => {
    setLocale(undefined);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('validateSetting', () => {
    it('accepts a value the setting offers and rejects one it does not', () => {
      assert.equal(validateSetting('policy.mode', 'permissive').value, 'permissive');

      const bad = validateSetting('policy.mode', 'nonsense');
      assert.equal(bad.ok, false);
      // Before the registry, this wrote nonsense to disk and the next run
      // silently used a default — indistinguishable from having no effect.
      assert.match(bad.error, /strict, permissive, disabled/);
    });

    it('treats the empty language as a real choice, not a missing one', () => {
      assert.equal(validateSetting('ui.language', '').ok, true);
      assert.equal(validateSetting('ui.language', 'klingon').ok, false);
    });

    it('parses the spellings people actually type for a boolean', () => {
      for (const yes of ['true', 'yes', 'on', '1', 'TRUE']) {
        assert.equal(validateSetting('logging.logToFile', yes).value, true, yes);
      }
      for (const no of ['false', 'no', 'off', '0']) {
        assert.equal(validateSetting('logging.logToFile', no).value, false, no);
      }
      assert.equal(validateSetting('logging.logToFile', 'maybe').ok, false);
    });

    it('holds a number inside its range', () => {
      assert.equal(validateSetting('worker.timeoutSeconds', '600').value, 600);
      assert.equal(validateSetting('worker.timeoutSeconds', '5').ok, false);
      assert.equal(validateSetting('worker.timeoutSeconds', '99999').ok, false);
      assert.equal(validateSetting('worker.timeoutSeconds', '1.5').ok, false);
      assert.equal(validateSetting('worker.timeoutSeconds', 'soon').ok, false);
    });

    it('splits a list and drops the gaps', () => {
      assert.deepEqual(validateSetting('policy.allowedCommands', 'git, npm ,, go').value, [
        'git',
        'npm',
        'go',
      ]);
      assert.deepEqual(validateSetting('policy.allowedCommands', '').value, []);
    });

    it('passes an unknown key through rather than blocking it', () => {
      // The registry validates what it knows; it is not a gate that rejects
      // every future key until somebody remembers to register it.
      assert.deepEqual(validateSetting('some.future.key', 'true'), { ok: true, value: true });
      assert.deepEqual(validateSetting('some.future.key', '42'), { ok: true, value: 42 });
      assert.deepEqual(validateSetting('some.future.key', 'text'), { ok: true, value: 'text' });
    });
  });

  describe('displayValue', () => {
    it('shows a label rather than a raw enum value', () => {
      assert.equal(displayValue(findSetting('policy.mode'), 'strict'), 'Strict — only allowed commands run');
      assert.equal(displayValue(findSetting('ui.language'), ''), 'Follow the system');
    });

    it('says something for an empty value instead of nothing', () => {
      assert.equal(displayValue(findSetting('policy.allowedCommands'), []), '(empty)');
      assert.equal(displayValue(findSetting('worker.command'), ''), '(empty)');
    });

    it('reads booleans as on and off', () => {
      assert.equal(displayValue(findSetting('logging.logToFile'), true), 'on');
      assert.equal(displayValue(findSetting('logging.logToFile'), false), 'off');
    });
  });

  describe('menu navigation', () => {
    const state = (index, count) => ({ index, count, done: false, cancelled: false });

    it('maps the keys a menu understands', () => {
      assert.equal(classifyKey(undefined, { name: 'up' }), 'up');
      assert.equal(classifyKey(undefined, { name: 'j' }), 'down');
      assert.equal(classifyKey(undefined, { name: 'return' }), 'submit');
      assert.equal(classifyKey(undefined, { name: 'escape' }), 'cancel');
      assert.equal(classifyKey(undefined, { name: 'c', ctrl: true }), 'cancel');
      assert.equal(classifyKey('x', { name: 'x' }), 'other');
    });

    it('wraps at both ends, so the last row is not the hardest to reach', () => {
      assert.equal(applyKey(state(0, 3), 'up').index, 2);
      assert.equal(applyKey(state(2, 3), 'down').index, 0);
      assert.equal(applyKey(state(1, 3), 'home').index, 0);
      assert.equal(applyKey(state(1, 3), 'end').index, 2);
    });

    it('finishes on submit and marks cancellation separately', () => {
      assert.deepEqual(applyKey(state(1, 3), 'submit'), { index: 1, count: 3, done: true, cancelled: false });
      assert.deepEqual(applyKey(state(1, 3), 'cancel'), { index: 1, count: 3, done: true, cancelled: true });
    });

    it('cancels an empty menu rather than pointing at nothing', () => {
      assert.equal(applyKey(state(0, 0), 'down').cancelled, true);
    });
  });

  describe('renderMenu', () => {
    it('marks the selected row and lines the hints up', () => {
      const lines = renderMenu(
        'Title',
        [
          { value: 'a', label: 'Short', hint: 'one' },
          { value: 'b', label: 'Much longer label', hint: 'two' },
        ],
        { index: 1, count: 2, done: false, cancelled: false },
        'footer',
      );

      const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
      assert.match(plain[2], /^ {2} Short/);
      assert.match(plain[3], /^❯/);
      // Hints start at the same column regardless of which row is highlighted.
      assert.equal(plain[2].indexOf('one'), plain[3].indexOf('two'));
    });
  });

  describe('editor plumbing', () => {
    it('lists every setting plus a way out', () => {
      const rows = buildRows({});
      assert.equal(rows.length, SETTINGS.length + 1);
      assert.equal(rows.at(-1).setting, undefined);
      assert.equal(rows.at(-1).label, 'Done');
    });

    it('reads and writes nested keys, creating what is missing', () => {
      const config = {};
      setNested(config, 'policy.mode', 'strict');
      assert.equal(getNested(config, 'policy.mode'), 'strict');
      assert.equal(getNested(config, 'nothing.here'), undefined);
    });

    it('offers a list back as the text that produced it', () => {
      assert.equal(currentAsText(findSetting('policy.allowedCommands'), ['git', 'npm']), 'git, npm');
      assert.equal(currentAsText(findSetting('worker.command'), undefined), '');
    });

    it('refuses to edit a corrupt config instead of overwriting it', async () => {
      const errors = [];
      const result = await runConfigEditor({
        read: () => ({ config: {}, path: '/x/config.json', corrupt: true, error: 'bad JSON at line 3' }),
        write: () => assert.fail('a corrupt config must never be written over'),
        log: () => {},
        error: (m) => errors.push(m),
      });

      assert.equal(result, -1);
      assert.match(errors[0], /bad JSON at line 3/);
      assert.match(errors[1], /setup --force/);
    });
  });

  describe('without a terminal', () => {
    it('select refuses rather than blocking on a pipe forever', async () => {
      await assert.rejects(
        () => select({ title: 't', choices: [{ value: 1, label: 'a' }], footer: 'f' }),
        (err) => err instanceof NotInteractiveError,
      );
    });

    it('bare `gelada config` still prints the configuration', async () => {
      const { stdout } = await execFileAsync(process.execPath, [GELADA_BIN, 'config'], {
        env: { ...process.env, GELADA_CONFIG_DIR: tmp, GELADA_LANG: 'en' },
      });
      assert.match(stdout, /"worker"/);
      assert.match(stdout, /"policy"/);
    });

    it('no longer reports a config schema version nothing reads', async () => {
      const { stdout } = await execFileAsync(process.execPath, [GELADA_BIN, 'config'], {
        env: { ...process.env, GELADA_CONFIG_DIR: tmp, GELADA_LANG: 'en' },
      });
      assert.ok(!/"version"/.test(stdout), 'the dead schema version must be gone');
    });
  });

  describe('config set shares the editor validation', () => {
    async function set(key, value) {
      return execFileAsync(process.execPath, [GELADA_BIN, 'config', 'set', key, value], {
        env: { ...process.env, GELADA_CONFIG_DIR: tmp, GELADA_LANG: 'en' },
      });
    }

    it('rejects a value the editor would not have offered', async () => {
      await assert.rejects(
        () => set('policy.mode', 'nonsense'),
        (err) => {
          assert.match(String(err.stderr), /must be one of/);
          return true;
        },
      );
    });

    it('stores a number as a number and a list as a list', async () => {
      await set('worker.timeoutSeconds', '900');
      await set('policy.allowedCommands', 'git, make');

      const config = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf-8'));
      assert.equal(config.worker.timeoutSeconds, 900);
      assert.deepEqual(config.policy.allowedCommands, ['git', 'make']);
    });
  });
});
