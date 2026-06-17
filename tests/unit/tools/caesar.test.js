import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, groups, groupSeeds } from './harness.js';

// steeds/tuffet are a +1 pair; cat/png are a ROT13 pair (cat+13 = png, and the
// reverse), so both share a Caesar key; dog is a loner.
const LIB = [
  { entry: 'steeds', score: 50 }, { entry: 'tuffet', score: 40 },
  { entry: 'cat', score: 30 }, { entry: 'png', score: 30 },
  { entry: 'dog', score: 20 },
];

test('seed: keeps the seed\'s shifts but not the seed itself (shift 0 excluded)', async () => {
  sameVisible(await visible(LIB, [{ tool: 'caesar', params: { entry: 'steeds' } }]), ['tuffet']);
  sameVisible(await visible(LIB, [{ tool: 'caesar', params: { entry: 'cat' } }]), ['png']);
});

test('seed: a word with no shift-relative in the list yields nothing', async () => {
  sameVisible(await visible(LIB, [{ tool: 'caesar', params: { entry: 'dog' } }]), []);
});

test('seed: matched case-insensitively', async () => {
  sameVisible(await visible(LIB, [{ tool: 'caesar', params: { entry: 'STEEDS' } }]), ['tuffet']);
});

test('an empty seed with no shift is a no-op — the full view passes through', async () => {
  sameVisible(await visible(LIB, [{ tool: 'caesar', params: {} }]),
    ['steeds', 'tuffet', 'cat', 'png', 'dog']);
});

test('seed + fixed shift: keeps only the entry at exactly that shift', async () => {
  sameVisible(await visible(LIB, [{ tool: 'caesar', params: { entry: 'steeds', shift: '1' } }]), ['tuffet']);
  sameVisible(await visible(LIB, [{ tool: 'caesar', params: { entry: 'steeds', shift: '2' } }]), []);
});

test('a shift with no seed and no all-mode does nothing — all-inputs needs *', async () => {
  sameVisible(await visible(LIB, [{ tool: 'caesar', params: { shift: '1' } }]),
    ['steeds', 'tuffet', 'cat', 'png', 'dog']);
});

test('all-mode + fixed shift: transforms every entry by that shift, dropping misses', async () => {
  sameVisible(await visible(LIB, [{ tool: 'caesar', grouped: true, params: { shift: '1' } }]),
    [['steeds', 'tuffet']]);
});

test('all-mode + ROT13: the symmetric pair folds to a single row', async () => {
  sameVisible(await visible(LIB, [{ tool: 'caesar', grouped: true, params: { shift: '13' } }]),
    [['cat', 'png']]);
});

test('all-mode + no shift: clusters every entry by its Caesar key, dropping loners', async () => {
  const gs = await groups(LIB, [{ tool: 'caesar', grouped: true }]);
  assert.deepEqual(gs.map(g => groupSeeds(g).sort()).sort(),
    [['cat', 'png'], ['steeds', 'tuffet']]);
});
