import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, groups, run, rowByFirst, highlightTexts } from './harness.js';

const LIB = [
  { entry: 'abe', score: 50 },
  'alphabetize',   // alph·abe·tize
  'babel',         // b·abe·l
  'label',         // l·abe·l
  'abettor',       // abe at the front, not centered
  'diabetes',      // abe present but off-center (odd padding)
];

test('keeps only longer words with the input dead-center', async () => {
  sameVisible(await visible(LIB, [{ tool: 'dead_center', params: { entry: 'abe' } }]),
    ['alphabetize', 'babel', 'label']);
});

test('rejects the input itself, front placement, and odd-padding placement', async () => {
  const out = (await visible(LIB, [{ tool: 'dead_center', params: { entry: 'abe' } }])).flat();
  assert.ok(!out.includes('abe'));
  assert.ok(!out.includes('abettor'));
  assert.ok(!out.includes('diabetes'));
});

test('padding must be equal on both sides', async () => {
  sameVisible(
    await visible(['scats', 'scatter', 'cats'], [{ tool: 'dead_center', params: { entry: 'cat' } }]),
    ['scats']);
});

test('normalizes the input: case and spaces are ignored', async () => {
  sameVisible(
    await visible(['x care x', 'care'], [{ tool: 'dead_center', params: { entry: 'CARE' } }]),
    ['x care x']);
});

test('highlights the dead-center span on the matched word', async () => {
  const { rows } = await run(LIB, [{ tool: 'dead_center', params: { entry: 'abe' } }]);
  const row = rowByFirst(rows, 'alphabetize');
  assert.deepEqual(highlightTexts(row.atoms[row.atoms.length - 1]), ['abe']);
});

test('inert with no input: every entry passes', async () => {
  sameVisible(await visible(['ab', 'abc'], [{ tool: 'dead_center', params: { entry: '' } }]),
    ['ab', 'abc']);
});

test('grouped: clusters longer words by a dead-center core that is itself an entry', async () => {
  const gs = await groups(
    [{ entry: 'abe', score: 50 }, 'alphabetize', 'babel', 'label'],
    [{ tool: 'dead_center', grouped: true }]);
  assert.deepEqual(gs.map(g => ({ anchor: g.anchor, count: g.count, chains: g.chains.flat().sort() })),
    [{ anchor: { entry: 'abe', score: 50 }, count: 3,
       chains: ['alphabetize', 'babel', 'label'] }]);
});

test('grouped: drops a core that is not an entry in the wordlist', async () => {
  assert.deepEqual(await groups(['years', 'bears', 'sears'], [{ tool: 'dead_center', grouped: true }]), []);
});

test('grouped: a core with a single longer word is no cluster', async () => {
  assert.deepEqual(
    await groups([{ entry: 'abe', score: 50 }, 'alphabetize'], [{ tool: 'dead_center', grouped: true }]),
    []);
});
