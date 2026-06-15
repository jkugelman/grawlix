import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, groups, groupSeeds } from './harness.js';

const LETTER_SET = [
  { entry: 'opt', score: 50 }, { entry: 'pot', score: 40 }, { entry: 'top', score: 30 },
  { entry: 'act', score: 60 }, { entry: 'cat', score: 20 }, { entry: 'dog', score: 70 },
];

test('keeps entries that contain every input letter and only those letters', async () => {
  sameVisible(await visible(['stoops', 'tops', 'postop', 'top', 'pear'],
    [{ tool: 'letter_bank', params: { letters: 'SPOT' } }]),
    ['postop', 'stoops', 'tops']);
});

test('rejects entries missing any letter from the input alphabet', async () => {
  sameVisible(await visible(['ops', 'top', 'postop'],
    [{ tool: 'letter_bank', params: { letters: 'OPTS' } }]),
    ['postop']);
});

test('input duplicates do not raise the per-letter minimum', async () => {
  sameVisible(await visible(['ab', 'aab', 'abba'],
    [{ tool: 'letter_bank', params: { letters: 'AAB' } }]),
    ['aab', 'ab', 'abba']);
});

test('empty letters is inert — the full merged view passes through', async () => {
  sameVisible(await visible(['cat', 'dog'],
    [{ tool: 'letter_bank', params: { letters: '' } }]),
    ['cat', 'dog']);
});

test('grouped: clusters merged entries that share a distinct-letter set, dropping singletons', async () => {
  const gs = await groups(LETTER_SET, [{ tool: 'letter_bank', grouped: true }]);
  assert.deepEqual(gs.map(g => groupSeeds(g).sort()).sort(), [['act', 'cat'], ['opt', 'pot', 'top']]);
  assert.deepEqual(gs.map(g => g.count).sort(), [2, 3]);
  assert.ok(!gs.some(g => groupSeeds(g).includes('dog')));
});

test('grouped: within a group, members sort by score desc then entry asc', async () => {
  const gs = await groups(LETTER_SET, [{ tool: 'letter_bank', grouped: true }]);
  assert.deepEqual(groupSeeds(gs.find(g => g.key === 'opt')), ['opt', 'pot', 'top']);
});
