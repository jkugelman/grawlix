import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUnigramCorpus, invalidateUnigramCorpus, configureSpaceOutBigrams } from '../../site/src/engine/segmenter.js';
import { casePart, spaceOutSplits, bestSpaceOutSplit, buildSpacingTable, spacingReader } from '../../site/src/engine/space-out.js';
import { merged } from './tools/harness.js';

// The wordlist-aware layer over rankedSplits, shared by the entry panel's rename
// hint and the Space out tool. merged() is the tools' own fixture builder, so a
// casing rule proven here is proven against the corpus shape both callers see.

test('casePart: an off-case entry lends its spelling to the part', () => {
  assert.equal(casePart('dna', merged(['DNA'])), 'DNA');
  assert.equal(casePart('iii', merged(['III'])), 'III');
});

test('casePart: an entry stored in the file default case stays bare', () => {
  // display is null for these (displayForRaw), which is the wordlist declining to
  // claim a spelling — re-casing them would shout every ordinary word.
  assert.equal(casePart('cat', merged(['cat'])), 'cat');
});

test('casePart: among spellings of one norm the most capitalized wins', () => {
  // buildByNorm keeps the code-unit-minimum display, and uppercase sorts below
  // lowercase, so the canonical row is the most-capitalized spelling on file.
  assert.equal(casePart('cat', merged(['Cat', 'CAT'])), 'CAT');
});

test('casePart: an explicit all-lowercase row outranks a capitalized sibling', () => {
  // The xi/Xi collision: the wordlist carrying the bare lowercase spelling is it
  // vouching for lowercase, which must beat the code-unit-minimum rule above.
  assert.equal(casePart('xi', merged([{ entry: 'xi', display: 'xi' }, 'Xi'])), 'xi');
});

test('casePart: a spaced display is refused', () => {
  // `ice cream` norms to icecream; substituting it into a split would turn a
  // two-part split into three words.
  assert.equal(casePart('icecream', merged([{ entry: 'ice cream' }])), 'icecream');
});

test('casePart: a part no source carries stays bare', () => {
  assert.equal(casePart('zzz', merged(['cat'])), 'zzz');
});

test('spaceOutSplits: every part is spelled from the wordlist', () => {
  setUnigramCorpus({ dna: -2, exoneree: -3 });
  const wl = merged(['DNA', 'exoneree', 'dnaexoneree']);
  assert.deepEqual(spaceOutSplits('dnaexoneree', wl, { limit: 1 }), [['DNA', 'exoneree']]);
});

test('spaceOutSplits: keeping one split still enumerates wide enough for bigrams', () => {
  // The regression this layer exists to prevent. `these a` beats `the sea` on
  // unigrams by more than the tightest window spans, so a caller that narrowed the
  // window to match a keep-count of 1 would never enumerate `the sea` for the
  // re-rank to promote. Flatten these frequencies and the test still passes while
  // guarding nothing.
  setUnigramCorpus({ the: -2, sea: -6, these: -2, a: -2.5 });
  const wl = merged(['the', 'sea', 'these', 'a', 'thesea']);
  try {
    configureSpaceOutBigrams('the sea 1000');
    assert.deepEqual(spaceOutSplits('thesea', wl, { limit: 1 }), [['the', 'sea']]);
    assert.deepEqual(bestSpaceOutSplit('thesea', wl), ['the', 'sea']);
  } finally {
    configureSpaceOutBigrams('');
  }
});

test('spaceOutSplits: limit caps the results, window widens them', () => {
  setUnigramCorpus({ abc: -5, def: -5, abcd: -6, ef: -7 });
  const wl = merged(['abc', 'def', 'abcd', 'abcdef']);
  assert.equal(spaceOutSplits('abcdef', wl, { limit: 1 }).length, 1);
  assert.ok(spaceOutSplits('abcdef', wl, { window: 10 }).length > 1);
});

test('bestSpaceOutSplit: a whole word yields null, not a one-part split', () => {
  setUnigramCorpus({ dog: -2, do: -9, g: -12 });
  assert.equal(bestSpaceOutSplit('dog', merged(['dog', 'do'])), null);
});

// ─── Spacing table ───────────────────────────────────────────────────────────

function fakeCache() {
  const store = new Map();
  return {
    store,
    get: key => store.get(key)?.value ?? null,
    take: key => { const value = store.get(key)?.value ?? null; store.delete(key); return value; },
    put: (key, value, bytes, opts = {}) => store.set(key, { value, bytes, ...opts }),
  };
}

function ctxOver(specs, cache = fakeCache()) {
  const wl = merged(specs);
  return {
    cache, wordlist: wl, vocab: wl,
    forEach: async (items, fn) => { let i = 0; for (const item of items) fn(item, i++); },
  };
}

const PHRASES = { helen: -5, of: -2, troy: -5, dog: -2, do: -9, g: -12 };
const LIST = ['helenoftroy', 'Helen of Troy', 'helen', 'of', 'troy', 'dog', 'do'];

test('buildSpacingTable: reads every unspaced entry once and caches the table', async () => {
  setUnigramCorpus(PHRASES);
  const ctx = ctxOver(LIST);
  const reader = await buildSpacingTable(ctx);
  assert.deepEqual(reader.best('helenoftroy'), ['helen', 'of', 'troy']);
  assert.equal(reader.best('dog'), null);
  assert.equal(ctx.cache.store.size, 1);
  const [{ value, bytes, patch }] = ctx.cache.store.values();
  assert.ok(bytes > 0);
  assert.equal(typeof patch, 'function');
  assert.equal((await buildSpacingTable(ctx)).table, value);
});

test('buildSpacingTable: a cancelled build caches its readings and the next build finishes them', async () => {
  setUnigramCorpus(PHRASES);
  const fresh = (await buildSpacingTable(ctxOver(LIST))).table;

  const ctx = ctxOver(LIST);
  const fullForEach = ctx.forEach;
  const visited = new Set();
  ctx.forEach = async (items, fn) => {
    let i = 0;
    for (const item of items) {
      if (i === 3) throw Object.assign(new Error('superseded'), { name: 'AbortError' });
      visited.add(item.norm);
      fn(item, i++);
    }
  };
  await assert.rejects(buildSpacingTable(ctx), { name: 'AbortError' });
  const [{ value: partial }] = ctx.cache.store.values();
  assert.equal(partial.complete, false);
  assert.ok(partial.best.size > 0 && partial.best.size < fresh.best.size);
  for (const norm of partial.best.keys()) assert.ok(visited.has(norm));

  ctx.forEach = fullForEach;
  const reader = await buildSpacingTable(ctx);
  assert.equal(reader.table, partial);
  assert.equal(partial.complete, true);
  assert.deepEqual(new Map(partial.best), new Map(fresh.best));
  assert.deepEqual(new Map(partial.compound), new Map(fresh.compound));
  assert.equal(ctx.cache.store.size, 1);
  assert.equal((await buildSpacingTable(ctx)).table, partial);
});

test('buildSpacingTable: caches nothing while the corpus is missing', async () => {
  invalidateUnigramCorpus();
  const ctx = ctxOver(LIST);
  const reader = await buildSpacingTable(ctx);
  assert.equal(reader.best('helenoftroy'), null);
  assert.equal(ctx.cache.store.size, 0);
  setUnigramCorpus(PHRASES);
  assert.deepEqual(reader.best('helenoftroy'), ['helen', 'of', 'troy']);
});

test('spacingReader: reads on demand and never caches a table', () => {
  setUnigramCorpus(PHRASES);
  const ctx = ctxOver(LIST);
  assert.deepEqual(spacingReader(ctx).best('helenoftroy'), ['helen', 'of', 'troy']);
  assert.equal(ctx.cache.store.size, 0);
});

test('spacingReader: reads through a table an earlier run built', async () => {
  setUnigramCorpus(PHRASES);
  const ctx = ctxOver(LIST);
  const { table } = await buildSpacingTable(ctx);
  assert.equal(spacingReader(ctx).table, table);
});

test('a norm the table never read is read on the spot, not taken for one word', async () => {
  setUnigramCorpus(PHRASES);
  const ctx = ctxOver(['dog', 'helen', 'of', 'troy']);
  const reader = await buildSpacingTable(ctx);
  assert.deepEqual(reader.best('helenoftroy'), ['helen', 'of', 'troy']);
});

test('the patch drops exactly the readings a vocab change can reach', async () => {
  setUnigramCorpus({ ...PHRASES, bake: -5, sale: -5 });
  const ctx = ctxOver([...LIST, 'bakesaling', 'bake', 'sale']);
  const { table } = await buildSpacingTable(ctx);
  const [{ patch }] = ctx.cache.store.values();
  const kept = () => [...table.best.keys()].sort();
  const all = kept();

  patch(table, ['zebra', 'a']);
  assert.deepEqual(kept(), all);

  patch(table, ['troy']);
  assert.deepEqual(kept(), all.filter(n => !n.includes('troy')));

  // `sale` reaches BAKESALING only through the stem's restored e.
  patch(table, ['sale']);
  assert.ok(!table.best.has('bakesaling'));
  assert.ok(table.best.has('dog'));
});

test('guess: a compound the corpus carries whole still gets a reading', () => {
  setUnigramCorpus({ rickroll: -17.57, rick: -10.80, roll: -9.81 });
  const reader = spacingReader(ctxOver(['rickroll', 'rick', 'roll']));
  assert.equal(reader.best('rickroll'), null);
  assert.deepEqual(reader.guess('rickroll'), ['rick', 'roll']);
});

test('guess: a split ending in a lone letter is no reading', () => {
  setUnigramCorpus({ avenue: -4, j: -5 });
  const reader = spacingReader(ctxOver(['avenuej', 'avenue']));
  assert.deepEqual(reader.best('avenuej'), ['avenue', 'j']);
  assert.equal(reader.guess('avenuej'), null);
});
