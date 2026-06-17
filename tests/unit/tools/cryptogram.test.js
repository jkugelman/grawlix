import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, groups, groupSeeds } from './harness.js';

// NOON/PEEP are abba-mates that are NOT a Caesar shift of each other — the
// near-miss that keeps these tests distinct from Caesar; don't swap in a
// shift-pair. CRANE is an abcde loner the same length as the abcba words, so a
// length-based grouping would wrongly fold it in.
const LIB = [
  { entry: 'level', score: 60 }, { entry: 'rotor', score: 50 },
  { entry: 'noon', score: 40 }, { entry: 'peep', score: 40 },
  { entry: 'crane', score: 30 },
];

test('seed: keeps every entry sharing the pattern, the seed included', async () => {
  sameVisible(await visible(LIB, [{ tool: 'cryptogram', params: { entry: 'LEVEL' } }]),
    ['level', 'rotor']);
});

test('seed: pattern-mates need not be Caesar shifts', async () => {
  sameVisible(await visible(LIB, [{ tool: 'cryptogram', params: { entry: 'noon' } }]),
    ['noon', 'peep']);
});

test('seed: an empty param is a no-op — the full merged view passes through', async () => {
  sameVisible(await visible(LIB, [{ tool: 'cryptogram', params: { entry: '' } }]),
    ['crane', 'level', 'noon', 'peep', 'rotor']);
});

test('seed: matched case-insensitively', async () => {
  sameVisible(await visible(LIB, [{ tool: 'cryptogram', params: { entry: 'NoOn' } }]),
    ['noon', 'peep']);
});

test('grouped: clusters merged entries that share a pattern', async () => {
  const gs = await groups(LIB, [{ tool: 'cryptogram', grouped: true }]);
  assert.deepEqual(gs.map(g => groupSeeds(g).sort()).sort(),
    [['level', 'rotor'], ['noon', 'peep']]);
});

test('grouped: all-distinct words still cluster by shape (no repeated-letter rule)', async () => {
  const gs = await groups(['crane', 'pales', 'cat'], [{ tool: 'cryptogram', grouped: true }]);
  assert.deepEqual(gs.map(g => groupSeeds(g).sort()).sort(),
    [['crane', 'pales']]);
});
