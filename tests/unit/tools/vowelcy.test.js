import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, groups, groupSeeds } from './harness.js';

test('matches entries sharing the same vowel sequence in order', async () => {
  sameVisible(await visible(['poem', 'node', 'hole', 'zone', 'peel', 'code'],
    [{ tool: 'vowelcy', params: { entry: 'POEM' } }]),
    ['code', 'hole', 'node', 'poem', 'zone']);
});

test('vowel order matters — same vowels in a different order do not match', async () => {
  sameVisible(await visible(['tails', 'tials', 'pains'],
    [{ tool: 'vowelcy', params: { entry: 'TAILS' } }]),
    ['pains', 'tails']);
});

test('Y does not count as a vowel', async () => {
  sameVisible(await visible(['cry', 'try'],
    [{ tool: 'vowelcy', params: { entry: 'CRY' } }]),
    ['cry', 'try']);
});

test('empty param is inert — the full merged view passes through', async () => {
  sameVisible(await visible(['cat', 'dog'],
    [{ tool: 'vowelcy', params: { entry: '' } }]),
    ['cat', 'dog']);
});

test('grouped: clusters entries by vowel sequence', async () => {
  const gs = await groups(['poem', 'node', 'hole', 'cat', 'bar'],
    [{ tool: 'vowelcy', grouped: true }]);
  assert.deepEqual(gs.map(g => groupSeeds(g).sort()).sort(),
    [['bar', 'cat'], ['hole', 'node', 'poem']]);
});
