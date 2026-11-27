import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCmuDict } from '../../site/src/engine/phonetics.js';
import { setUnigramCorpus, invalidateUnigramCorpus } from '../../site/src/engine/segmenter.js';
import { executePipeline, plannedPasses } from '../../site/src/engine/executor.js';
import { TOOLS, makeToolRow } from '../../site/src/engine/tools.js';
import '../../site/lab/sound-shift/tools.js';
import { movedPhoneme, sameStem, makeMorphFilter } from '../../site/lab/sound-shift/sound-shift.js';
import { merged, run, rowWords, visible, sameVisible } from './tools/harness.js';

// Verbatim from cmudict, second pronunciations and all: "around" losing its D in
// variant 2 is what makes "shuffle around"/"shuffled around" a real one-phoneme
// move, and that pair is the whole reason the morphological filter exists.
const seed = () => setCmuDict({
  FRIAR: ['F R AY1 ER0'], TUCK: ['T AH1 K'], FIRE: ['F AY1 ER0', 'F AY1 R'], TRUCK: ['T R AH1 K'],
  DOG: ['D AO1 G'], CAT: ['K AE1 T'],
  RIGHT: ['R AY1 T'], ANGLES: ['AE1 NG G AH0 L Z'], TRIANGLES: ['T R AY1 AE2 NG G AH0 L Z'],
  ABDOMEN: ['AE0 B D OW1 M AH0 N'], BAD: ['B AE1 D'], OMEN: ['OW1 M AH0 N'],
  SHUFFLE: ['SH AH1 F AH0 L'], SHUFFLED: ['SH AH1 F AH0 L D'], AROUND: ['ER0 AW1 N D', 'ER0 AW1 N'],
  AWARD: ['AH0 W AO1 R D'], AWARDS: ['AH0 W AO1 R D Z'], SHOW: ['SH OW1'], SHOWS: ['SH OW1 Z'],
  ARC: ['AA1 R K'], CAR: ['K AA1 R'], OAR: ['AO1 R'],
});

const toks = s => s.split(' ');

test('movedPhoneme identifies the relocated sound', () => {
  assert.equal(movedPhoneme(toks('F R AY ER T AH K'), toks('F AY ER T R AH K')), 'R');
  assert.equal(movedPhoneme(toks('AA R K'), toks('K AA R')), 'K');
  assert.equal(movedPhoneme(toks('T R AY'), toks('R AY T')), 'T', 'leftward move');
});

test('movedPhoneme rejects non-moves', () => {
  assert.equal(movedPhoneme(toks('K AE T'), toks('K AE T')), null, 'identical');
  assert.equal(movedPhoneme(toks('K AE T'), toks('B AE T')), null, 'substitution');
  assert.equal(movedPhoneme(toks('K AE T'), toks('K AE')), null, 'length differs');
  // Same multiset, but no single phoneme can be moved to get there.
  assert.equal(movedPhoneme(toks('A B C D'), toks('D C B A')), null);
  assert.equal(movedPhoneme(toks('A B C D'), toks('B A D C')), null);
});

test('sameStem recognizes an inflected form', () => {
  assert.ok(sameStem('flounder', 'floundered'), '-ed');
  assert.ok(sameStem('billiard', 'billiards'), '-s');
  assert.ok(sameStem('hurry', 'hurried'), 'y -> ied');
  assert.ok(sameStem('party', 'parties'), 'y -> ies');
  assert.ok(sameStem('stop', 'stopped'), 'doubled consonant');
  assert.ok(sameStem('bake', 'baking'), 'e drop before -ing');
  assert.ok(sameStem('love', 'loved'), 'bare -d after -e');
  assert.ok(sameStem('cat', 'cat'), 'identical');
});

test('sameStem rejects look-alikes that are different words', () => {
  assert.ok(!sameStem('for', 'ford'), 'bare -d only counts after -e');
  assert.ok(!sameStem('stan', 'stand'), 'same -d guard');
  assert.ok(!sameStem('clear', 'clearance'), 'derivational, not inflectional');
  assert.ok(!sameStem('clear', 'clearness'), 'derivational, not inflectional');
  assert.ok(!sameStem('bar', 'bra'), 'anagram, not a suffix');
});

// makeMorphFilter needs the segmenter to recover words from solid entries and to
// split compounds, so its parts must be present in norms and scored by the corpus.
const WORDS = [
  'flounder', 'around', 'floundered', 'flounderaround', 'turn', 'over', 'turns', 'turnover', 'turnovers',
  'dry', 'pot', 'pots', 'spot', 'object', 'subject', 'verb', 'stand', 'for', 'ford', 'stanford',
  'less', 'or', 'lessor', 'right', 'angles', 'triangles', 'billiard', 'billiards', 'parlor', 'parlors',
  'billiardsparlor', 'shuffle', 'shuffled',
];
function morphFilter(t) {
  setUnigramCorpus(Object.fromEntries(WORDS.map(w => [w, -2])), -6);
  t.after(invalidateUnigramCorpus);
  return makeMorphFilter({ norms: new Set(WORDS) });
}

test('the filter drops same-words variants: inflection, reorder, and compound-vs-phrasal', t => {
  const isVariant = morphFilter(t);
  assert.ok(isVariant('flounder around', 'floundered around'), 're-inflection, same spacing');
  assert.ok(isVariant('flounderaround', 'floundered around'), 're-inflection across a solid/spaced split');
  assert.ok(isVariant('billiardsparlor', 'billiard parlors'), 'plural hops the word boundary');
  assert.ok(isVariant('object subject verb', 'subject object verb'), 'reordering the same words');
  assert.ok(isVariant('turnovers', 'turns over'), 'lexicalized compound vs its phrasal verb');
});

test('the filter spares genuine finds that only look like variants', t => {
  const isVariant = morphFilter(t);
  assert.ok(!isVariant('dry pots', 'dry spot'), 'spot is a real word, not s+pot');
  assert.ok(!isVariant('stand for', 'stanford'), 'the trailing d is root, not inflection');
  assert.ok(!isVariant('lessor', 'or less'), 'a compound must not match its parts reversed');
  assert.ok(!isVariant('right angles', 'triangles'), 'different words, different word counts');
});

test('sweep pairs up the whole list, folded to one row', async () => {
  seed();
  const out = await visible([{ entry: 'friar tuck' }, { entry: 'fire truck' }, 'dog'],
    [{ tool: 'sound_shift', params: {} }]);
  assert.equal(out.length, 1, 'both directions unify into a single row');
  sameVisible(out[0], ['friar tuck', 'fire truck']);
});

test('sweep finds pairs across the list', async () => {
  seed();
  const out = await visible(['arc', 'car', 'oar', 'dog'], [{ tool: 'sound_shift', params: {} }]);
  assert.deepEqual(out.map(pair => [...pair].sort().join(' ')), ['arc car']);
});

test('the Sound param narrows the sweep', async () => {
  seed();
  const kept = await visible([{ entry: 'friar tuck' }, { entry: 'fire truck' }],
    [{ tool: 'sound_shift', params: { sound: 'R' } }]);
  assert.equal(kept.length, 1);
  const dropped = await visible([{ entry: 'friar tuck' }, { entry: 'fire truck' }],
    [{ tool: 'sound_shift', params: { sound: 'K' } }]);
  assert.deepEqual(dropped, []);
});

test('a keeper crossing a word boundary survives the filter', async () => {
  seed();
  sameVisible((await visible([{ entry: 'right angles' }, 'triangles', 'dog'],
    [{ tool: 'sound_shift', params: {} }]))[0], ['right angles', 'triangles']);
  sameVisible((await visible(['abdomen', { entry: 'bad omen' }, 'dog'],
    [{ tool: 'sound_shift', params: {} }]))[0], ['abdomen', 'bad omen']);
});

test('sweep suppresses a pair that is only one phrase re-inflected', async () => {
  seed();
  assert.deepEqual(await visible([{ entry: 'shuffle around' }, { entry: 'shuffled around' }],
    [{ tool: 'sound_shift', params: {} }]), []);
  assert.deepEqual(await visible([{ entry: 'award shows' }, { entry: 'awards show' }],
    [{ tool: 'sound_shift', params: {} }]), []);
});

test('an unknown phoneme is a param error, not a silent empty result', () => {
  assert.match(TOOLS.sound_shift.error({ sound: 'q' }), /isn’t a phoneme/);
  assert.equal(TOOLS.sound_shift.error({ sound: 'ay' }), null);
  assert.equal(TOOLS.sound_shift.error({ sound: '' }), null);
});

// The segmenter authorizes split parts by wordlist membership, not corpus
// frequency, so "fire"/"truck" must be present entries for "firetruck" to split.
const seedWithSegmenter = t => {
  seed();
  setUnigramCorpus({ fire: -1, truck: -1, friar: -2, tuck: -2 }, -5);
  t.after(invalidateUnigramCorpus);
};

test('a solid compound pairs once the segmenter pronounces it', async t => {
  seedWithSegmenter(t);
  const out = await visible(['firetruck', 'fire', 'truck', { entry: 'friar tuck' }, 'dog'],
    [{ tool: 'sound_shift', params: {} }]);
  assert.equal(out.length, 1, 'firetruck ~ friar tuck, folded to one row');
  sameVisible(out[0], ['firetruck', 'friar tuck']);
});

test('segments against the full merge, not just the scoped entries', async t => {
  seedWithSegmenter(t);
  const scoped = ['firetruck', { entry: 'friar tuck' }];
  const { rows } = await run(scoped, [{ tool: 'sound_shift', params: {} }],
    { vocab: [...scoped, 'fire', 'truck'] });
  sameVisible(rows.map(rowWords), [['firetruck', 'friar tuck']]);
});

test('a homophone is not a shift', async t => {
  seedWithSegmenter(t);
  sameVisible(await visible([{ entry: 'fire truck' }, { entry: 'firetruck' }],
    [{ tool: 'sound_shift', params: {} }]), []);
});

test('without the unigram corpus, a solid compound simply drops out', async () => {
  seed();
  invalidateUnigramCorpus();
  sameVisible(await visible(['firetruck', 'fire', 'truck', { entry: 'friar tuck' }],
    [{ tool: 'sound_shift', params: {} }]), []);
});

test('a word’s weak forms don’t pose as moves', async () => {
  setCmuDict({ IT: ['IH1 T'], TO: ['T UW1', 'T IH0', 'T AH0'] });
  sameVisible(await visible(['it', 'to'], [{ tool: 'sound_shift', params: {} }]), []);
});

test('a move counts in the plain or the folded reading', async () => {
  setCmuDict({
    PARTING: ['P AA1 R T IH0 NG'], PRODDING: ['P R AA1 D IH0 NG'],
    EASTER: ['IY1 S T ER0'], SEATER: ['S IY1 T ER0'],
  });
  sameVisible(await visible(['parting', 'prodding', 'easter', 'seater'], [{ tool: 'sound_shift', params: {} }]),
    [['parting', 'prodding'], ['easter', 'seater']]);
});

test('an initialism CMU lacks is read by its letter names', async () => {
  setCmuDict({ MESSY: ['M EH1 S IY0'] });
  sameVisible(await visible(['MC', 'messy'], [{ tool: 'sound_shift', params: {} }]), [['MC', 'messy']]);
});

// ─── The pair-list cache ─────────────────────────────────────────────────

const dict = () => setCmuDict({
  FRIAR: ['F R AY1 ER0'], TUCK: ['T AH1 K'], FIRE: ['F AY1 ER0', 'F AY1 R'], TRUCK: ['T R AH1 K'],
  DOG: ['D AO1 G'],
});

function fakeCache() {
  const store = new Map();
  const stats = { gets: 0, puts: 0, hits: 0 };
  const keys = [];
  return {
    get(k) { stats.gets++; const v = store.get(k); if (v !== undefined) stats.hits++; return v ?? null; },
    peek: k => store.get(k) ?? null,
    put(k, v) { stats.puts++; keys.push(k); store.set(k, v); },
    stats, keys,
  };
}

const sweep = (wl, params, cache) =>
  executePipeline(wl, [makeToolRow('sound_shift', params)], null, { prepareCache: cache })
    .then(out => out.rows.map(rowWords));

test('the pair list is computed once and reused across Sound-param runs', async () => {
  dict();
  const wl = merged([{ entry: 'friar tuck' }, { entry: 'fire truck' }, 'dog']);
  const cache = fakeCache();

  const blank = await sweep(wl, {}, cache);              // miss → compute + cache
  assert.equal(cache.stats.puts, 1, 'computed and cached once');
  assert.equal(blank.length, 1);
  sameVisible(blank[0], ['friar tuck', 'fire truck']);

  const rHit = await sweep(wl, { sound: 'R' }, cache);   // hit → filter cached pairs by R
  assert.equal(cache.stats.puts, 1, 'no recompute on the Sound change');
  assert.ok(cache.stats.hits >= 1, 'served from the cache');
  assert.equal(rHit.length, 1);
  sameVisible(rHit[0], ['friar tuck', 'fire truck']);    // the moved phoneme is R

  const kHit = await sweep(wl, { sound: 'K' }, cache);   // no pair moves a K
  assert.equal(cache.stats.puts, 1);
  assert.deepEqual(kHit, []);
});

test('a warm-cache run equals a cold recompute of the same query', async () => {
  dict();
  const wl = merged([{ entry: 'friar tuck' }, { entry: 'fire truck' }, 'dog']);
  const cold = await sweep(wl, { sound: 'R' }, fakeCache());   // fresh cache → computes
  const warm = fakeCache();
  await sweep(wl, {}, warm);                                   // seed the pairs
  const hit = await sweep(wl, { sound: 'R' }, warm);           // reuse them
  assert.equal(warm.stats.puts, 1);
  sameVisible(hit.flat(), cold.flat());
});

test('the artifacts a sweep builds are exactly the passes it plans', async () => {
  dict();
  const cache = fakeCache();
  const stack = [makeToolRow('sound_shift', {})];
  const planned = new Set(plannedPasses(stack, 0, cache).map(p => p.artifact ?? p.key).filter(k => typeof k === 'string'));
  await executePipeline(merged(['friar tuck', 'fire truck', 'dog']), stack, null, { prepareCache: cache });
  assert.deepEqual([...new Set(cache.keys)].sort(), [...planned].sort());
});
