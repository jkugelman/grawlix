import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCmuDict } from '../../../site/src/engine/phonetics.js';
import { setUnigramCorpus, invalidateUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { visible, sameVisible, groups } from './harness.js';

// Corpus state is module-global and these run in one process, so a seeded corpus
// would leak forward and silently start spacing out the unspaced-by-design fixtures.
const seed = () => {
  invalidateUnigramCorpus();
  setCmuDict({
    CAT: ['K AE1 T'], BAT: ['B AE1 T'], HAT: ['HH AE1 T'], MAT: ['M AE1 T'], DOG: ['D AO1 G'],
    OUT: ['AW1 T'], ABOUT: ['AH0 B AW1 T'],
    LIVES: ['L AY1 V Z', 'L IH1 V Z'], FIVES: ['F AY1 V Z'], GIVES: ['G IH1 V Z'],
  });
};

test('filters the wordlist to entries that rhyme with the target', async () => {
  seed();
  const out = await visible(['cat', 'bat', 'hat', 'dog'],
    [{ tool: 'rhymes', params: { entry: 'mat' } }]);
  sameVisible(out, ['cat', 'bat', 'hat']);
});

test('filter mode drops entries that share the target’s last word', async () => {
  seed();
  const out = await visible(['cat', 'bat', { entry: 'scaredy cat' }, { entry: 'fat cat' }],
    [{ tool: 'rhymes', params: { entry: 'cat' } }]);
  sameVisible(out, ['bat']);  // cat (itself), scaredy cat, fat cat all end in "cat"
});

test('rhymes a multi-word entry on its last word', async () => {
  seed();
  const out = await visible(['out', { entry: 'space out' }, 'dog'],
    [{ tool: 'rhymes', params: { entry: 'about' } }]);
  sameVisible(out, ['out', 'space out']);
});

test('matches across any of the target’s pronunciations', async () => {
  seed();
  sameVisible(await visible(['lives', 'fives'], [{ tool: 'rhymes', params: { entry: 'fives' } }]),
    ['lives']);
  sameVisible(await visible(['lives', 'gives'], [{ tool: 'rhymes', params: { entry: 'gives' } }]),
    ['lives']);
});

test('strict anchors on primary stress; loose (default) allows secondary', async () => {
  setCmuDict({
    CUMBERBATCH: ['K AH1 M B ER0 B AE2 CH'], MATCH: ['M AE1 CH'], BATCH: ['B AE1 CH'],
    MISMATCH: ['M IH0 S M AE1 CH', 'M IH1 S M AE2 CH'],
  });
  sameVisible(await visible(['match', 'batch', 'cumberbatch'],
    [{ tool: 'rhymes', params: { entry: 'match', match: 'strict' } }]), ['batch']);
  sameVisible(await visible(['cumberbatch', 'match', 'mismatch'],
    [{ tool: 'rhymes', params: { entry: 'cumberbatch' } }]), ['match', 'mismatch']);
  sameVisible(await visible(['cumberbatch', 'match', 'mismatch'],
    [{ tool: 'rhymes', params: { entry: 'cumberbatch', match: 'strict' } }]), []);
});

test('drops everything when the target has no pronunciation', async () => {
  seed();
  sameVisible(await visible(['cat', 'bat'], [{ tool: 'rhymes', params: { entry: 'xyzzy' } }]), []);
});

test('group mode buckets the wordlist into rhyme families (singletons dropped)', async () => {
  seed();
  const fams = await groups(['cat', 'bat', 'hat', 'dog'], [{ tool: 'rhymes', grouped: true }]);
  assert.equal(fams.length, 1);
  assert.equal(fams[0].key, 'AE T');
  sameVisible(fams[0].chains.map(c => c[0]), ['cat', 'bat', 'hat']);
});

test('group mode drops a family whose members all share one last word', async () => {
  seed();
  const fams = await groups(['cat', { entry: 'scaredy cat' }, { entry: 'fat cat' }],
    [{ tool: 'rhymes', grouped: true }]);
  assert.equal(fams.length, 0);
});

test('group mode keeps a mixed family, trivial members and all', async () => {
  seed();
  const fams = await groups(['cat', 'bat', { entry: 'scaredy cat' }],
    [{ tool: 'rhymes', grouped: true }]);
  assert.equal(fams.length, 1);
  sameVisible(fams[0].chains.map(c => c[0]), ['cat', 'bat', 'scaredy cat']);
});

test('a two-pronunciation word appears in both rhyme families (multi-key grouping)', async () => {
  seed();
  const fams = await groups(['lives', 'fives', 'gives'], [{ tool: 'rhymes', grouped: true }]);
  const byKey = Object.fromEntries(fams.map(f => [f.key, f.chains.map(c => c[0]).sort()]));
  assert.deepEqual(byKey['AY V Z'], ['fives', 'lives']);
  assert.deepEqual(byKey['IH V Z'], ['gives', 'lives']);
});

// ─── Spacing out unspaced entries ────────────────────────────────────────────

const seedSpacing = (cmu, freqs) => {
  setCmuDict(cmu);
  setUnigramCorpus(freqs);
};

const RAGE_CMU = {
  ROAD: ['R OW1 D'], RAGE: ['R EY1 JH'], PARKING: ['P AA1 R K IH0 NG'],
  BIRD: ['B ER1 D'], CAGE: ['K EY1 JH'],
};
const RAGE_FREQS = { road: -3, rage: -3, parking: -3, bird: -3, cage: -3 };

test('spaces out an unspaced entry so it can rhyme at all', async () => {
  seedSpacing(
    { CODE: ['K OW1 D'], PAGE: ['P EY1 JH'], ROAD: ['R OW1 D'], RAGE: ['R EY1 JH'], CAGE: ['K EY1 JH'] },
    { code: -3, page: -3, road: -3, rage: -3, cage: -3 });
  const out = await visible(['roadrage', 'code', 'page', 'road', 'rage', 'cage'],
    [{ tool: 'rhymes', params: { entry: 'codepage' } }]);
  sameVisible(out, ['roadrage', 'rage', 'cage']);
});

test('trusts the dictionary over a split — NOTABLE is not NO TABLE', async () => {
  seedSpacing(
    { NOTABLE: ['N OW1 T AH0 B AH0 L'], TABLE: ['T EY1 B AH0 L'], LABEL: ['L EY1 B AH0 L'], NO: ['N OW1'] },
    { no: -2, table: -2 });
  const out = await visible(['notable', 'table', 'label', 'no'],
    [{ tool: 'rhymes', params: { entry: 'label' } }]);
  sameVisible(out, ['table']);
});

test('rejects a split whose last part is a lone letter', async () => {
  seedSpacing(
    { MESS: ['M EH1 S'], LESS: ['L EH1 S'], S: ['EH1 S'] },
    { yowler: -3, s: -3, less: -3, mess: -3 });
  const out = await visible(['yowlers', 'yowler', 'less'],
    [{ tool: 'rhymes', params: { entry: 'mess' } }]);
  sameVisible(out, ['less']);
});

// Frequencies tuned twice over: the glued form beats the split by more than the default
// window but less than the wide one, and one part sits under the compound floor. Narrow
// the gap or lift BEAN over the floor and the test stops testing anything. LIMABEAN is
// the canary — TIMEMACHINE shares MACHINE with the target, so it drops as a repeat
// whether or not the wordlist spaced it, and cannot report a regression.
test('the typed target is spaced out even where the wordlist declines to', async () => {
  seedSpacing(
    { TIME: ['T AY1 M'], MACHINE: ['M AH0 SH IY1 N'], LIMA: ['L AY1 M AH0'], BEAN: ['B IY1 N'] },
    { timemachine: -16, time: -5, machine: -12, limabean: -16, lima: -5, bean: -12 });
  const out = await visible([{ entry: 'lima bean' }, 'limabean', 'timemachine', 'time', 'machine'],
    [{ tool: 'rhymes', params: { entry: 'timemachine', match: 'whole' } }]);
  sameVisible(out, ['lima bean']);
});

// The real corpus numbers: RICKROLL is a wordfreq token of its own and beats RICK ROLL
// by 10.04, just past the widest window, so the ranked splits are the unsplit entry
// alone and RICKROLL rhymes with nothing at all until the compound fallback reads it.
const RICKROLL_FREQS = { rickroll: -17.57, rick: -10.80, roll: -9.81, stick: -9, coal: -9 };

test('a compound the corpus carries as its own token still gets a reading', async () => {
  seedSpacing(
    { RICK: ['R IH1 K'], ROLL: ['R OW1 L'], STICK: ['S T IH1 K'], COAL: ['K OW1 L'] },
    RICKROLL_FREQS);
  const out = await visible(['rickroll', 'rick', 'roll'],
    [{ tool: 'rhymes', params: { entry: 'stick coal', match: 'whole' } }]);
  sameVisible(out, ['rickroll']);
});

test('an inflected compound splits its stem and keeps the ending', async () => {
  seedSpacing(
    { RICK: ['R IH1 K'], ROLL: ['R OW1 L'], STICK: ['S T IH1 K'],
      ROLLING: ['R OW1 L IH0 NG'], BOWLING: ['B OW1 L IH0 NG'] },
    RICKROLL_FREQS);
  const out = await visible(['rickrolling', 'rick', 'roll'],
    [{ tool: 'rhymes', params: { entry: 'stick bowling', match: 'whole' } }]);
  sameVisible(out, ['rickrolling']);
});

test('leaves an already-spaced entry spelled as its author wrote it', async () => {
  seedSpacing({ RAGE: ['R EY1 JH'], CAGE: ['K EY1 JH'], ROAD: ['R OW1 D'] },
    { road: -2, rage: -2, cage: -2 });
  const out = await visible([{ entry: 'road rage' }, 'cage'],
    [{ tool: 'rhymes', params: { entry: 'cage' } }]);
  sameVisible(out, ['road rage']);
});

// A split is scored against the wordlist's own norms, so the parts have to be
// entries themselves — drop them and the fixtures stop spacing out at all, and
// the dropped-family assertion passes for the wrong reason.
test('group mode counts distinct last words on the spaced form', async () => {
  seedSpacing(RAGE_CMU, RAGE_FREQS);
  assert.deepEqual(
    await groups(['roadrage', 'parkingrage', 'road', 'rage', 'parking'],
      [{ tool: 'rhymes', grouped: true }]),
    []);
});

test('group mode keeps a family once a spaced form contributes a second last word', async () => {
  seedSpacing(RAGE_CMU, RAGE_FREQS);
  const fams = await groups(
    ['roadrage', 'parkingrage', 'birdcage', 'road', 'rage', 'parking', 'bird', 'cage'],
    [{ tool: 'rhymes', grouped: true }]);
  assert.equal(fams.length, 1);
  sameVisible(fams[0].chains.map(c => c[0]),
    ['roadrage', 'parkingrage', 'birdcage', 'rage', 'cage']);
});

// ─── Whole (every syllable rhymes) ───────────────────────────────────────────

const seedWhole = cmu => {
  invalidateUnigramCorpus();
  setCmuDict(cmu);
};

test('whole mode rhymes a phrase against a word syllable for syllable', async () => {
  seedWhole({
    ANNE: ['AE1 N'], BOLEYN: ['B OW0 L IH1 N'],
    MANDOLIN: ['M AE1 N D AH0 L IH2 N'], MANDOLINE: ['M AE1 N D AH0 L IY2 N'], CAT: ['K AE1 T'],
  });
  const out = await visible(['mandolin', 'mandoline', 'cat'],
    [{ tool: 'rhymes', params: { entry: 'Anne Boleyn', match: 'whole' } }]);
  sameVisible(out, ['mandolin']);
});

test('whole mode needs the same syllable count, where loose rhymes on the tail alone', async () => {
  seedWhole({ CAT: ['K AE1 T'], BAT: ['B AE1 T'], HABITAT: ['HH AE1 B AH0 T AE2 T'] });
  sameVisible(await visible(['bat', 'habitat'],
    [{ tool: 'rhymes', params: { entry: 'cat', match: 'whole' } }]), ['bat']);
  sameVisible(await visible(['bat', 'habitat'],
    [{ tool: 'rhymes', params: { entry: 'cat' } }]), ['bat', 'habitat']);
});

test('whole mode drops an entry with a word the dictionary lacks', async () => {
  seedWhole({ CODE: ['K OW1 D'], PAGE: ['P EY1 JH'], ROAD: ['R OW1 D'], RAGE: ['R EY1 JH'] });
  const out = await visible([{ entry: 'road rage' }, { entry: 'zzz rage' }],
    [{ tool: 'rhymes', params: { entry: 'code page', match: 'whole' } }]);
  sameVisible(out, ['road rage']);
});

test('whole mode groups a family that no last-word rhyme would find', async () => {
  seedWhole({
    ANNE: ['AE1 N'], BOLEYN: ['B OW0 L IH1 N'], MANDOLIN: ['M AE1 N D AH0 L IH2 N'],
  });
  const fams = await groups([{ entry: 'Anne Boleyn' }, 'mandolin'],
    [{ tool: 'rhymes', grouped: true, params: { match: 'whole' } }]);
  assert.equal(fams.length, 1);
  assert.equal(fams[0].key, 'AE N | AX | IH N');
  sameVisible(fams[0].chains.map(c => c[0]), ['Anne Boleyn', 'mandolin']);
});

test('one family, however many readings its members share', async () => {
  seedWhole({
    IN: ['IH0 N', 'IH1 N'], THE: ['DH AH0', 'DH IY0'], MOOD: ['M UW1 D'], NUDE: ['N UW1 D'],
  });
  const fams = await groups([{ entry: 'in the mood' }, { entry: 'in the nude' }],
    [{ tool: 'rhymes', grouped: true, params: { match: 'whole' } }]);
  assert.equal(fams.length, 1);
  sameVisible(fams[0].chains.map(c => c[0]), ['in the mood', 'in the nude']);
});
