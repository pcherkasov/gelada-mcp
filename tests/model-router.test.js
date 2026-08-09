import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelRouter,
  ModelRouterError,
} from '../dist/components/model-router.js';
import {
  parseWorkerModelList,
  selectModelForProfile,
  isKnownModelId,
  PROFILE_DEFINITIONS,
} from '../dist/components/model-catalog.js';

const CATALOG = [
  { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
  { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
  { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
];

test('parseWorkerModelList', async (t) => {
  await t.test('parses the tab-separated listing the worker CLI emits', () => {
    const parsed = parseWorkerModelList(
      'Fetching available models...\n' +
        'gemini-3.6-flash-high\tGemini 3.6 Flash (High)\n' +
        'gemini-3.1-pro-low\tGemini 3.1 Pro (Low)\n',
    );
    assert.deepEqual(parsed, [
      { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
      { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
    ]);
  });

  await t.test('ignores progress chatter and blank lines', () => {
    const parsed = parseWorkerModelList('\nFetching available models...\n\n');
    assert.deepEqual(parsed, []);
  });

  await t.test('does not duplicate repeated ids', () => {
    const parsed = parseWorkerModelList('a-1\tA\na-1\tA again\n');
    assert.equal(parsed.length, 1);
  });
});

test('selectModelForProfile', async (t) => {
  await t.test('maps every profile onto a model the catalog actually contains', () => {
    for (const profile of PROFILE_DEFINITIONS) {
      const selected = selectModelForProfile(profile.name, CATALOG);
      assert.ok(selected, `${profile.name} should resolve`);
      assert.ok(
        CATALOG.some((m) => m.id === selected),
        `${profile.name} resolved to ${selected}, which is not in the catalog`,
      );
    }
  });

  await t.test('FAST prefers a flash model, DEEP prefers a pro model', () => {
    assert.match(selectModelForProfile('FAST', CATALOG), /flash/);
    assert.match(selectModelForProfile('DEEP', CATALOG), /pro/);
  });

  await t.test('is case insensitive', () => {
    assert.equal(selectModelForProfile('fast', CATALOG), selectModelForProfile('FAST', CATALOG));
  });

  await t.test('returns undefined for an unknown profile or an empty catalog', () => {
    assert.equal(selectModelForProfile('NOPE', CATALOG), undefined);
    assert.equal(selectModelForProfile('FAST', []), undefined);
  });
});

test('isKnownModelId', () => {
  assert.equal(isKnownModelId('gemini-3.1-pro-low', CATALOG), true);
  assert.equal(isKnownModelId('GEMINI-3.1-PRO-LOW', CATALOG), true);
  assert.equal(isKnownModelId('gemini-2.5-pro', CATALOG), false);
});

test('ModelRouter', async (t) => {
  // Pin the catalog so the test never depends on a real worker CLI being
  // installed, authenticated, or on any particular model generation.
  function routerWithCatalog(source = 'cli') {
    const router = new ModelRouter();
    router.getCatalog = async () => ({ models: CATALOG, source, fetchedAt: Date.now() });
    return router;
  }

  await t.test('resolves abstract profiles to a real catalog entry', async () => {
    const router = routerWithCatalog();
    for (const name of ['FAST', 'BALANCED', 'DEEP', 'DEFAULT']) {
      const resolution = await router.resolve(name);
      assert.equal(resolution.kind, 'profile');
      assert.ok(CATALOG.some((m) => m.id === resolution.model));
    }
  });

  await t.test('defaults to the DEFAULT profile when none is requested', async () => {
    const router = routerWithCatalog();
    const resolution = await router.resolve(undefined);
    assert.equal(resolution.requested, 'DEFAULT');
    assert.ok(CATALOG.some((m) => m.id === resolution.model));
  });

  await t.test('passes through an explicit model the catalog knows', async () => {
    const router = routerWithCatalog();
    const resolution = await router.resolve('gemini-3.1-pro-high');
    assert.equal(resolution.kind, 'explicit');
    assert.equal(resolution.model, 'gemini-3.1-pro-high');
  });

  await t.test('rejects an unknown model when the catalog is authoritative', async () => {
    const router = routerWithCatalog('cli');
    await assert.rejects(() => router.resolve('gemini-2.5-pro'), ModelRouterError);
  });

  await t.test('passes an unknown model through when the catalog is only a fallback', async () => {
    const router = routerWithCatalog('fallback');
    const resolution = await router.resolve('some-custom-model');
    assert.equal(resolution.model, 'some-custom-model');
    assert.ok(resolution.warning, 'an unverified model should carry a warning');
  });

  await t.test('resolveAgyModel returns just the id', async () => {
    const router = routerWithCatalog();
    assert.equal(typeof (await router.resolveAgyModel('FAST')), 'string');
  });
});
