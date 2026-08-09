import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../dist/components/model-router.js';

test('ModelRouter', async (t) => {
  const router = new ModelRouter();

  await t.test('resolves FAST to flash', () => {
    assert.equal(router.resolveAgyModel('FAST'), 'flash');
    assert.equal(router.resolveAgyModel('fast'), 'flash');
  });

  await t.test('resolves BALANCED and DEFAULT to inherit', () => {
    assert.equal(router.resolveAgyModel('BALANCED'), 'inherit');
    assert.equal(router.resolveAgyModel('balanced'), 'inherit');
    assert.equal(router.resolveAgyModel('DEFAULT'), 'inherit');
    assert.equal(router.resolveAgyModel('default'), 'inherit');
    assert.equal(router.resolveAgyModel(undefined), 'inherit');
  });

  await t.test('resolves DEEP to pro', () => {
    assert.equal(router.resolveAgyModel('DEEP'), 'pro');
    assert.equal(router.resolveAgyModel('deep'), 'pro');
  });

  await t.test('passes through specific agy models', () => {
    assert.equal(router.resolveAgyModel('flash_lite'), 'flash_lite');
    assert.equal(router.resolveAgyModel('gemini-1.5-pro'), 'gemini-1.5-pro');
  });
});
