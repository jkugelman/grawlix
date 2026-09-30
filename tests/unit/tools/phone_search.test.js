import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCmuDict } from '../../../site/src/engine/phonetics.js';
import { setUnigramCorpus, invalidateUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { rowAtoms } from '../../../site/src/engine/executor.js';
import { run, sameVisible, visible, highlightTexts } from './harness.js';

const CMU = {
  ARE: ['AA1 R', 'ER0'], ARBITER: ['AA1 R B IH0 T ER0'], ARTY: ['AA1 R T IY0'],
  BITTER: ['B IH1 T ER0'], TEE: ['T IY1'], TEA: ['T IY1'], BUTCHER: ['B UH1 CH ER0'],
  KNEE: ['N IY1'], HONEY: ['HH AH1 N IY0'], NOT: ['N AA1 T'], EVEN: ['IY1 V IH0 N'],
  READ: ['R EH1 D', 'R IY1 D'], RED: ['R EH1 D'], REED: ['R IY1 D'],
  BOB: ['B AA1 B'], KNIGHT: ['N AY1 T'], NIGHT: ['N AY1 T'], PHONE: ['F OW1 N'],
  CO: ['K OW1', 'K AH1 M P AH0 N IY0'], AND: ['AH0 N D', 'AE1 N D'], R: ['AA1 R'],
};

// Corpus state is module-global and these run in one process, so a corpus seeded
// by one test would silently start splitting another's unspaced entries.
const seed = (freqs = null) => {
  invalidateUnigramCorpus();
  if (freqs) setUnigramCorpus(freqs);
  setCmuDict(CMU);
};

async function hits(specs, entry) {
  const { rows } = await run(specs, [{ tool: 'phone_search', params: { entry } }]);
  return Object.fromEntries(rows.map(row => {
    const atom = rowAtoms(row).at(-1);
    return [atom.wlEntry.display ?? atom.wlEntry.norm, highlightTexts(atom)];
  }));
}

test('finds the input’s sounds inside other entries, marking the letters that spell them', async () => {
  seed();
  assert.deepEqual(await hits(['arbiter', 'arty', 'tee', 'bitter'], 'are'),
    { arbiter: ['ar'], arty: ['ar'] });
});

test('ignores stress: unstressed -biter in arbiter is bitter', async () => {
  seed();
  assert.deepEqual(await hits(['arbiter', 'arty'], 'bitter'), { arbiter: ['biter'] });
  assert.deepEqual(await hits(['arty'], 'tee'), { arty: ['ty'] });
});

test('matches by sound, not spelling', async () => {
  seed();
  assert.deepEqual(await hits(['honey', 'tee'], 'knee'), { honey: ['ney'] });
  assert.deepEqual(await hits([{ entry: 'Bob Knight' }], 'night'), { 'Bob Knight': ['Knight'] });
});

test('silent letters at a word’s edge ride along with the sounds beside them', async () => {
  seed();
  assert.deepEqual(await hits(['phone'], 'phone'), { phone: ['phone'] });
});

test('a sound run may cross a word break, marked on both sides', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'not even' }], 'tea'), { 'not even': ['t', 'e'] });
});

test('searches every pronunciation of the input', async () => {
  seed();
  sameVisible(await visible(['red', 'reed', 'tee'], [{ tool: 'phone_search', params: { entry: 'read' } }]),
    ['red', 'reed']);
});

// CMU's weak ARE is ER, which would find BUTCHER; its CO. expands to "company",
// which would hear KNEE at the end of AND CO.
test('skips weak forms and pronunciations the spelling doesn’t spell', async () => {
  seed();
  sameVisible(await visible(['butcher', 'arbiter'], [{ tool: 'phone_search', params: { entry: 'are' } }]),
    ['arbiter']);
  sameVisible(await visible([{ entry: 'and co' }, 'honey'], [{ tool: 'phone_search', params: { entry: 'knee' } }]),
    ['honey']);
});

test('finds nothing when the input has no pronunciation', async () => {
  seed();
  sameVisible(await visible(['arbiter'], [{ tool: 'phone_search', params: { entry: 'xyzzy' } }]), []);
});

test('reads an unspaced entry through its spaced-out words', async () => {
  seed({ bob: -3, knight: -3, not: -3, even: -3 });
  assert.deepEqual(await hits(['bobknight', 'noteven', 'bob', 'knight', 'not', 'even'], 'night'),
    { bobknight: ['knight'], knight: ['knight'] });
});

test('a lone letter from a split is not read as its letter name', async () => {
  seed({ tee: -3, r: -6 });
  sameVisible(await visible(['teertee', 'tee', 'r'], [{ tool: 'phone_search', params: { entry: 'are' } }]), ['r']);
});
