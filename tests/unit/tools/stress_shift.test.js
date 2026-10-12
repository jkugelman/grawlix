import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCmuDict } from '../../../site/src/engine/phonetics.js';
import { invalidateUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { rowAtoms } from '../../../site/src/engine/executor.js';
import { makeToolRow } from '../../../site/src/engine/tools.js';
import { run } from './harness.js';

// Real CMU lines. Corpus state is module-global, so the unigram corpus is cleared
// first or a seeded one from another file would start spacing out the fixtures.
const seed = () => {
  invalidateUnigramCorpus();
  setCmuDict({
    DESERT: ['D EH1 Z ER0 T', 'D IH0 Z ER1 T'], DESSERT: ['D IH0 Z ER1 T'],
    ROCKET: ['R AA1 K AH0 T'], ROCKETTE: ['R AA0 K EH1 T'],
    CARTON: ['K AA1 R T AH0 N'], CARTOON: ['K AA0 R T UW1 N'],
    PROJECT: ['P R AA1 JH EH0 K T', 'P R AH0 JH EH1 K T'],
    CELLAR: ['S EH1 L ER0'], SELLER: ['S EH1 L ER0'],
    RAVEN: ['R EY1 V AH0 N'], RAVINE: ['R AH0 V IY1 N'],
    DAUGHTER: ['D AO1 T ER0'], DEBTOR: ['D EH1 T ER0'], DETER: ['D IH0 T ER1'],
    INSIGHT: ['IH1 N S AY2 T'], IN: ['IH0 N', 'IH1 N'], CITE: ['S AY1 T'],
    DANDY: ['D AE1 N D IY0'], DUNDEE: ['D AH0 N D IY1'],
    EMERGING: ['IH0 M ER1 JH IH0 NG'], IMAGING: ['IH1 M IH0 JH IH0 NG'],
    EMPLOYMENT: ['IH0 M P L OY1 M AH0 N T'], IMPLEMENT: ['IH1 M P L AH0 M AH0 N T'],
    RECUR: ['R IH0 K ER1'], RUCKER: ['R AH1 K ER0'],
    PERSONAL: ['P ER1 S IH0 N AH0 L'], PERSONNEL: ['P ER2 S AH0 N EH1 L'],
    REVERT: ['R IH0 V ER1 T'], RIVET: ['R IH1 V AH0 T'],
    HUMAN: ['HH Y UW1 M AH0 N'], HUMANE: ['HH Y UW0 M EY1 N'],
    CRITIC: ['K R IH1 T IH0 K'], CRITIQUE: ['K R IH0 T IY1 K'],
    PROTEST: ['P R OW1 T EH2 S T', 'P R AH0 T EH1 S T'],
    FINANCE: ['F IH0 N AE1 N S', 'F AY1 N AE2 N S'],
    IFFY: ['IH1 F IY0'], A: ['AH0', 'EY1'], FEE: ['F IY1'],
  });
};

const marked = (text, highlights) => {
  let out = '', at = 0;
  for (const { start, end } of highlights) out += text.slice(at, start) + text.slice(start, end).toUpperCase(), at = end;
  return out + text.slice(at);
};

async function stressGroups(specs, show) {
  const { rows } = await run(specs, [{ tool: 'stress_shift', params: show ? { show } : {} }]);
  return rows.map(g => g.chains.map(c => {
    const atom = rowAtoms(c).at(-1);
    return marked(atom.wlEntry.display ?? atom.wlEntry.norm, atom.highlights);
  }).sort());
}

test('a row is always grouped, with no ✱ toggle', () => {
  const row = makeToolRow('stress_shift');
  assert.equal(row.grouped, true);
  assert.equal(row.kind(), 'group');
  assert.equal(row.params.show, 'homophones');
});

test('groups readings that differ only in stress', async () => {
  seed();
  assert.deepEqual(await stressGroups(['rocket', 'rockette', 'cellar', 'seller']), [['ROCKet', 'roCKETTE']]);
});

test('between two entries, the stressed vowel must be short', async () => {
  seed();
  assert.deepEqual(await stressGroups(['carton', 'cartoon']), []);
  assert.deepEqual(await stressGroups(['human', 'humane']), []);
  assert.deepEqual(await stressGroups(['critic', 'critique']), []);
});

test('one entry\'s own readings may face a long vowel but not a gliding one', async () => {
  seed();
  assert.deepEqual(await stressGroups(['protest'], 'heteronyms'), [['PROtest', 'proTEST']]);
  assert.deepEqual(await stressGroups(['finance'], 'heteronyms'), []);
});

test('an entry said two ways is a group alone, once per reading', async () => {
  seed();
  assert.deepEqual(await stressGroups(['project'], 'heteronyms'), [['PROJect', 'proJECT']]);
});

test('one entry can share a group with another under each of its readings', async () => {
  seed();
  assert.deepEqual(await stressGroups(['desert', 'dessert']), [['DESert', 'deSERT', 'deSSERT']]);
});

test('a phrase meets a word', async () => {
  seed();
  assert.deepEqual(await stressGroups(['insight', { entry: 'in cite' }]), [['INsight', 'in CITE']]);
});

test('Show picks homophones, the default, or heteronyms', async () => {
  seed();
  const specs = ['project', 'rocket', 'rockette'];
  assert.deepEqual(await stressGroups(specs), [['ROCKet', 'roCKETTE']]);
  assert.deepEqual(await stressGroups(specs, 'heteronyms'), [['PROJect', 'proJECT']]);
});

test('only one syllable may reduce: RAVEN is not RAVINE', async () => {
  seed();
  assert.deepEqual(await stressGroups(['raven', 'ravine']), []);
});

test('a reduced vowel must be spelled like the vowel it faces', async () => {
  seed();
  assert.deepEqual(await stressGroups(['dandy', 'dundee']), []);
  assert.deepEqual(await stressGroups(['emerging', 'imaging']), []);
  assert.deepEqual(await stressGroups(['employment', 'implement']), []);
  assert.deepEqual(await stressGroups(['recur', 'rucker']), []);
});

test('the reduced vowel needs both the same first letter and a spelling of the vowel it faces', async () => {
  seed();
  assert.deepEqual(await stressGroups(['revert', 'rivet']), []);
  assert.deepEqual(await stressGroups(['personal', 'personnel']), []);
});

test('the article A never stands in for a stressed vowel', async () => {
  seed();
  assert.deepEqual(await stressGroups(['iffy', { entry: 'a fee' }]), []);
});

test('every member sounds like every other, not merely like a neighbor', async () => {
  seed();
  const out = await stressGroups(['daughter', 'debtor', 'deter']);
  assert.ok(!out.some(g => g.includes('DAUGHter') && g.includes('DEBTor')));
});

test('a group thinned upstream to one stress drops', async () => {
  seed();
  const { rows } = await run(['desert', 'dessert'],
    [{ tool: 'search', params: { pattern: 'dessert' } }, { tool: 'stress_shift' }]);
  assert.deepEqual(rows, []);
});
