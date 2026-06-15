import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, groups } from './harness.js';

const LIB = ['what the fuck', 'world tour finals', 'cat', 'co-op', "don't", 'big easy'];

test('matches displays whose word-initial letters spell the initialism', async () => {
  sameVisible(await visible(LIB, [{ tool: 'initialisms', params: { word: 'WTF' } }]),
    ['what the fuck', 'world tour finals']);
});

test('hyphens are optional word boundaries', async () => {
  sameVisible(await visible(LIB, [{ tool: 'initialisms', params: { word: 'CO' } }]),
    ['co-op']);
});

test('single-letter pattern matches every entry whose first word starts with it', async () => {
  sameVisible(await visible(LIB, [{ tool: 'initialisms', params: { word: 'C' } }]),
    ['cat', 'co-op']);
});

test("apostrophes aren't word boundaries — DT doesn't match \"don't\"", async () => {
  sameVisible(await visible(LIB, [{ tool: 'initialisms', params: { word: 'DT' } }]), []);
});

test('grouped: clusters multi-word entries by their initialism when the initialism is an entry', async () => {
  const gs = await groups(
    [{ entry: 'WTF', score: 60 }, 'what the fuck', 'where the front', 'who the fudge'],
    [{ tool: 'initialisms', grouped: true }]);
  assert.deepEqual(gs.map(g => ({ anchor: g.anchor, count: g.count, chains: g.chains.flat().sort() })),
    [{ anchor: { entry: 'WTF', score: 60 }, count: 3,
       chains: ['what the fuck', 'where the front', 'who the fudge'] }]);
});

test('grouped: drops clusters whose initialism is not an entry in the wordlist', async () => {
  assert.deepEqual(await groups(['cool cat', 'cow case'], [{ tool: 'initialisms', grouped: true }]), []);
});

test('grouped: skips single-word entries (one-letter initialisms are just prefix buckets)', async () => {
  assert.deepEqual(await groups(['C', 'cat', 'cow'], [{ tool: 'initialisms', grouped: true }]), []);
});

test('grouped: hyphens are not word boundaries in grouped mode', async () => {
  const gs = await groups(
    [{ entry: 'CO', score: 60 }, 'Cycle Op', 'Camera Op', 'co-op'],
    [{ tool: 'initialisms', grouped: true }]);
  assert.deepEqual(gs.map(g => ({ anchor: g.anchor, chains: g.chains.flat().sort() })),
    [{ anchor: { entry: 'CO', score: 60 }, chains: ['Camera Op', 'Cycle Op'] }]);
});
