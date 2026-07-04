import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, groups, groupSeeds } from './harness.js';

test('matches entries sharing the same consonant skeleton in order', async () => {
  sameVisible(await visible(['bland', 'blend', 'blind', 'blond', 'brand', 'plant'],
    [{ tool: 'consonantcy', params: { entry: 'BLAND' } }]),
    ['bland', 'blend', 'blind', 'blond']);
});

test('consonant order matters — same consonants in a different order do not match', async () => {
  sameVisible(await visible(['star', 'rats', 'tars'],
    [{ tool: 'consonantcy', params: { entry: 'STAR' } }]),
    ['star']);
});

test('Y counts as a vowel — CRY skeleton is CR, matching consonant-only CAR', async () => {
  sameVisible(await visible(['car', 'core', 'cry', 'city'],
    [{ tool: 'consonantcy', params: { entry: 'CRY' } }]),
    ['car', 'core', 'cry']);
});

test('empty param is inert — the full merged view passes through', async () => {
  sameVisible(await visible(['cat', 'dog'],
    [{ tool: 'consonantcy', params: { entry: '' } }]),
    ['cat', 'dog']);
});

test('grouped: clusters entries by consonant skeleton', async () => {
  const gs = await groups(['bland', 'blend', 'blond', 'brand', 'plant'],
    [{ tool: 'consonantcy', grouped: true }]);
  assert.deepEqual(gs.map(g => groupSeeds(g).sort()).sort(), [['bland', 'blend', 'blond']]);
});
