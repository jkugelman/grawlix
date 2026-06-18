import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, groups, groupSeeds } from './harness.js';

// EERIE/EYRIE share four letters but not their multiset — the near-miss that
// keeps the count-sensitivity test honest. Don't simplify it to a plain pair.
const LIB = [
  { entry: 'lindsey', score: 60 }, { entry: 'snidely', score: 50 },
  { entry: 'cat', score: 40 }, { entry: 'act', score: 40 },
  { entry: 'eerie', score: 45 }, { entry: 'eyrie', score: 45 },
  { entry: 'dog', score: 40 },
];

test('keeps every rearrangement of the param, including the param itself', async () => {
  sameVisible(await visible(LIB, [{ tool: 'anagrams', params: { entry: 'LINDSEY' } }]),
    ['lindsey', 'snidely']);
});

test('a different letter multiset is excluded even when most letters overlap', async () => {
  sameVisible(await visible(LIB, [{ tool: 'anagrams', params: { entry: 'EERIE' } }]),
    ['eerie']);
});

test('an empty param is a no-op — the full merged view passes through', async () => {
  sameVisible(await visible(LIB, [{ tool: 'anagrams', params: { entry: '' } }]),
    ['act', 'cat', 'dog', 'eerie', 'eyrie', 'lindsey', 'snidely']);
});

test('the param is matched case-insensitively', async () => {
  sameVisible(await visible(LIB, [{ tool: 'anagrams', params: { entry: 'aCt' } }]),
    ['act', 'cat']);
});

test('grouped: clusters merged entries that share a letter multiset', async () => {
  const gs = await groups(['lives', 'elvis', 'levis', 'evils', 'tiger'],
    [{ tool: 'anagrams', grouped: true }]);
  assert.deepEqual(gs.map(g => groupSeeds(g).sort()), [['elvis', 'evils', 'levis', 'lives']]);
});

test('grouped: TOPS and POTS share a multiset but OPT does not (different length)', async () => {
  const gs = await groups(['tops', 'pots', 'opt', 'pot', 'top'],
    [{ tool: 'anagrams', grouped: true }]);
  assert.deepEqual(gs.map(g => groupSeeds(g).sort()).sort(),
    [['opt', 'pot', 'top'], ['pots', 'tops']]);
});

test('grouped after a transform: distinct words sharing a tail stay separate members', async () => {
  const gs = await groups(['wheat', 'cheat', 'heat', 'tiger'],
    [{ tool: 'behead', params: { count: '1' } }, { tool: 'anagrams', grouped: true }]);
  assert.equal(gs.length, 1);
  assert.deepEqual(gs[0].chains.map(c => c.join('→')).sort(), ['cheat→heat', 'wheat→heat']);
});
