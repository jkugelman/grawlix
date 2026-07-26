import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUnigramCorpus, configureSpaceOutBigrams } from '../../site/src/engine/segmenter.js';
import { casePart, spaceOutSplits, bestSpaceOutSplit } from '../../site/src/engine/space-out.js';
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
