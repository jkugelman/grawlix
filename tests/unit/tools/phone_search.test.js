import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCmuDict } from '../../../site/src/engine/phonetics.js';
import { setUnigramCorpus, invalidateUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { rowAtoms } from '../../../site/src/engine/executor.js';
import { makeToolRow } from '../../../site/src/engine/tools.js';
import { run, sameVisible, visible, highlightTexts, atomWord } from './harness.js';

const CMU = {
  ARE: ['AA1 R', 'ER0'], ARBITER: ['AA1 R B IH0 T ER0'], ARTY: ['AA1 R T IY0'],
  BITTER: ['B IH1 T ER0'], TEE: ['T IY1'], TEA: ['T IY1'], BUTCHER: ['B UH1 CH ER0'],
  KNEE: ['N IY1'], HONEY: ['HH AH1 N IY0'], NOT: ['N AA1 T'], EVEN: ['IY1 V IH0 N'],
  READ: ['R EH1 D', 'R IY1 D'], RED: ['R EH1 D'], REED: ['R IY1 D'],
  BOB: ['B AA1 B'], KNIGHT: ['N AY1 T'], NIGHT: ['N AY1 T'], PHONE: ['F OW1 N'],
  CO: ['K OW1', 'K AH1 M P AH0 N IY0'], AND: ['AH0 N D', 'AE1 N D'], R: ['AA1 R'],
  SAXOPHONE: ['S AE1 K S AH0 F OW2 N'], NEON: ['N IY1 AA0 N'],
};

// Corpus state is module-global and these run in one process, so a corpus seeded
// by one test would silently start splitting another's unspaced entries.
const seed = (freqs = null) => {
  invalidateUnigramCorpus();
  if (freqs) setUnigramCorpus(freqs);
  setCmuDict(CMU);
};

async function hits(specs, entry, mode) {
  const { rows } = await run(specs, [{ tool: 'phone_search', params: mode ? { entry, mode } : { entry } }]);
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
  assert.deepEqual(await hits(['saxophone'], 'phone'), { saxophone: ['phone'] });
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

const FIGURE_CMU = {
  FIGURE: ['F IH1 G Y ER0'], FIGURES: ['F IH1 G Y ER0 Z'], FIGURED: ['F IH1 G Y ER0 D'],
  CONFIGURE: ['K AH0 N F IH1 G Y ER0'], FIGURINE: ['F IH2 G Y ER0 IY1 N'], SKATING: ['S K EY1 T IH0 NG'],
  OUT: ['AW1 T'],
};

test('skips matches of the query word and its inflections, not words containing it', async () => {
  invalidateUnigramCorpus();
  setUnigramCorpus({ figure: -3, skating: -3 });
  setCmuDict(FIGURE_CMU);
  const specs = ['figure', 'figures', { entry: 'figured out' }, { entry: 'figure skating' }, 'figureskating',
    'configure', 'figurine', 'skating'];
  sameVisible(await visible(specs, [{ tool: 'phone_search', params: { entry: 'figure' } }]),
    ['configure', 'figurine']);
});

// ─── Match modes and wildcards ───────────────────────────────────────────────

test('whole entry finds homophones', async () => {
  seed();
  assert.deepEqual(await hits(['knight', 'night', { entry: 'Bob Knight' }], 'knight', 'full'), { night: ['night'] });
});

test('at start and at end anchor only that end of the sounds', async () => {
  seed();
  const specs = ['neon', 'honey', 'tee'];
  assert.deepEqual(await hits(specs, 'knee', 'start'), { neon: ['ne'] });
  assert.deepEqual(await hits(specs, 'knee', 'end'), { honey: ['ney'] });
});

test('whole word needs the sounds to start and end on word breaks', async () => {
  seed();
  assert.deepEqual(await hits(['tee', 'arty', { entry: 'not even' }], 'tea', 'word'), { tee: ['tee'] });
});

test('spans words needs the sounds to cross a word break', async () => {
  seed();
  assert.deepEqual(await hits(['tee', 'arty', { entry: 'not even' }], 'tea', 'span'), { 'not even': ['t', 'e'] });
});

test('the sounds can’t run across a word that can’t be read', async () => {
  seed();
  assert.deepEqual(await hits(['night', { entry: 'night 52' }], 'knight', 'full'), { night: ['night'] });
  assert.deepEqual(await hits([{ entry: 'night 52' }], 'knight', 'start'), { 'night 52': ['night'] });
  assert.deepEqual(await hits([{ entry: 'honey 52 tee' }], 'knee tea'), {});
});

// ─── Replace ─────────────────────────────────────────────────────────────────

const replace = (entry, rep, mode) => [{ tool: 'phone_search', params: mode ? { entry, replace: rep, mode } : { entry, replace: rep } }];

test('a blank replacement deletes the sounds and finds entries that sound like what’s left', async () => {
  seed();
  sameVisible(await visible(['arbiter', 'arty', 'bitter', 'tee'], replace('are', '')),
    [['arbiter', 'bitter'], ['arty', 'tee']]);
  const { rows } = await run(['arbiter', 'bitter'], replace('are', ''));
  assert.deepEqual(rows[0].atoms.map(highlightTexts), [['ar'], []]);
});

test('a filled replacement swaps in its sounds, marked on the output', async () => {
  seed();
  const { rows } = await run(['tee', 'knee'], replace('tea', 'knee'));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].atoms.map(atomWord), ['tee', 'knee']);
  assert.deepEqual(rows[0].atoms.map(highlightTexts), [['tee'], ['knee']]);
});

test('replacing rewrites the typed word itself', async () => {
  invalidateUnigramCorpus();
  setCmuDict({ ...CMU, DAY: ['D EY1'], SHIFT: ['SH IH1 F T'] });
  const { rows } = await run([{ entry: 'Knight Shift' }, { entry: 'Day Shift' }], replace('knight', 'day'));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].atoms.map(highlightTexts), [['Knight'], ['day']]);
});

test('the match mode constrains which sounds are replaced', async () => {
  seed();
  sameVisible(await visible(['arty', 'tee', 'knee'], replace('tea', 'knee', 'full')), [['tee', 'knee']]);
  sameVisible(await visible(['arbiter', 'bitter'], replace('are', '', 'full')), []);
});

test('a replacing row is a transform named Phone replace', () => {
  const row = makeToolRow('phone_search', { entry: 'are', replace: '' });
  assert.equal(row.kind(), 'transform');
  assert.equal(row.name(), 'Phone replace');
  assert.equal(row.outputSide(), 'plain');
  assert.equal(makeToolRow('phone_search', { entry: 'are', replace: 'tea' }).outputSide(), 'highlight');
  assert.equal(makeToolRow('phone_search', { entry: 'are' }).name(), 'Phone search');
});
