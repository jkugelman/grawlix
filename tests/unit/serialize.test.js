import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEntries, formatEntryText } from '../../site/src/engine/serialize.js';

const RICH       = { spaces: true,  punctuation: true,  accents: true,  comments: true };
const STRIPPED   = { spaces: false, punctuation: false, accents: false, comments: true };
const NO_ACCENTS = { spaces: true,  punctuation: true,  accents: false, comments: true };

test('serializeEntries (as-is): preserves display, spaces, accents, case, and comments verbatim', () => {
  const out = serializeEntries([
    { norm: 'theirs', display: 'the IRS', score: 60, comment: 'tax' },
    { norm: 'cafe',   display: 'café',    score: 50, comment: '' },
    { norm: 'cat',    display: null,      score: 40, comment: '' },
  ], RICH);
  assert.equal(out, 'café;50\ncat;40\nthe IRS;60;tax\n');
});

test('serializeEntries: output sorts by norm ascending regardless of input order', () => {
  const out = serializeEntries([
    { norm: 'zebra', display: null, score: 1, comment: '' },
    { norm: 'apple', display: null, score: 2, comment: '' },
    { norm: 'mango', display: null, score: 3, comment: '' },
  ], RICH);
  assert.equal(out, 'apple;2\nmango;3\nzebra;1\n');
});

test('serializeEntries: within a norm the highest score leads — the consumer keeps the first', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'cafe', score: 30, comment: '' },
    { norm: 'cafe', display: 'café', score: 70, comment: '' },
    { norm: 'cafe', display: 'CAFE', score: 50, comment: '' },
  ], RICH);
  assert.equal(out, 'café;70\nCAFE;50\ncafe;30\n');
});

test('serializeEntries: on an equal-score tie the variant carrying a comment leads', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'cafe', score: 60, comment: '' },
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
  ], RICH);
  assert.equal(out, 'café;60;drink\ncafe;60\n');
});

test('serializeEntries (as-is): same-norm distinct displays write verbatim — no collapse', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: '' },
    { norm: 'cafe', display: 'cafe', score: 50, comment: '' },
  ], RICH);
  assert.equal(out, 'café;60\ncafe;50\n');
});

test('serializeEntries (strip everything): removes spaces, punctuation, and accents (case untouched)', () => {
  const out = serializeEntries([
    { norm: 'theirs', display: 'the IRS', score: 60, comment: '' },
    { norm: 'cafe',   display: 'café',    score: 50, comment: '' },
    { norm: 'coop',   display: 'co-op',   score: 45, comment: '' },
  ], STRIPPED);
  assert.equal(out, 'cafe;50\ncoop;45\ntheIRS;60\n');
});

test('serializeEntries: stripping a single axis leaves the others intact', () => {
  const out = serializeEntries([
    { norm: 'cafeaulait', display: 'café au lait', score: 50, comment: '' },
    { norm: 'coop',       display: 'co-op',        score: 45, comment: '' },
  ], NO_ACCENTS);
  assert.equal(out, 'cafe au lait;50\nco-op;45\n');
});

test('serializeEntries: entries stripped onto the same text stay separate lines, best first', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'cafe', score: 50, comment: 'the band' },
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
  ], NO_ACCENTS);
  assert.equal(out, 'cafe;60;drink\ncafe;50;the band\n');
});

test('serializeEntries: a byte-identical repeat produced by stripping collapses to one line', () => {
  const out = serializeEntries([
    { norm: 'naive', display: 'naïve', score: 50, comment: '' },
    { norm: 'naive', display: 'naive', score: 50, comment: '' },
  ], NO_ACCENTS);
  assert.equal(out, 'naive;50\n');
});

test('serializeEntries: with comments off, lines differing only by comment collapse', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
    { norm: 'cafe', display: 'cafe', score: 60, comment: 'the band' },
  ], { spaces: true, punctuation: true, accents: false, comments: false });
  assert.equal(out, 'cafe;60\n');
});

test('serializeEntries: comments off drops the third field even when stripping', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
  ], { spaces: true, punctuation: true, accents: false, comments: false });
  assert.equal(out, 'cafe;60\n');
});

test('serializeEntries: an empty list yields an empty string', () => {
  assert.equal(serializeEntries([], RICH), '');
  assert.equal(serializeEntries([], STRIPPED), '');
});

test('serializeEntries: sorts a copy — callers pass live rawEntries, which must not be reordered', () => {
  const input = [
    { norm: 'zebra', display: null, score: 1, comment: '' },
    { norm: 'apple', display: null, score: 2, comment: '' },
  ];
  const out = serializeEntries(input, RICH);
  assert.equal(out, 'apple;2\nzebra;1\n');                                  // output sorted
  assert.deepStrictEqual(input.map(e => e.norm), ['zebra', 'apple']);       // input not
});

test('formatEntryText: each strip axis acts independently on the display', () => {
  const e = { norm: 'cafeaulait', display: 'café au lait' };
  assert.equal(formatEntryText(e, RICH), 'café au lait');
  assert.equal(formatEntryText(e, { spaces: true, punctuation: true, accents: false }), 'cafe au lait');
  assert.equal(formatEntryText(e, { spaces: false, punctuation: true, accents: true }), 'caféaulait');
  assert.equal(formatEntryText({ norm: 'coop', display: 'co-op' }, { spaces: true, punctuation: false, accents: true }), 'coop');
  assert.equal(formatEntryText({ norm: 'cat', display: null }, RICH), 'cat');
});
