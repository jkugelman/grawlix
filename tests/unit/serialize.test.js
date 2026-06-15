import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEntries, formatEntryText, sortedEntries } from '../../site/src/engine/serialize.js';

const RICH     = { spaces: true,  punctuation: true,  accents: true,  comments: true };
const STRIPPED = { spaces: false, punctuation: false, accents: false, comments: true };

test('serializeEntries (as-is): preserves display, spaces, accents, case, and comments verbatim', () => {
  const out = serializeEntries([
    { norm: 'theirs', display: 'the IRS', score: 60, comment: 'tax' },
    { norm: 'cafe',   display: 'café',    score: 50, comment: '' },
    { norm: 'cat',    display: null,      score: 40, comment: '' },
  ], RICH);
  assert.equal(out, 'the IRS;60;tax\ncafé;50\ncat;40\n');
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
  assert.equal(out, 'theIRS;60\ncafe;50\ncoop;45\n');
});

test('serializeEntries: stripping a single axis leaves the others intact', () => {
  const out = serializeEntries([
    { norm: 'cafeaulait', display: 'café au lait', score: 50, comment: '' },
    { norm: 'coop',        display: 'co-op',        score: 45, comment: '' },
  ], { spaces: true, punctuation: true, accents: false, comments: true });
  assert.equal(out, 'cafe au lait;50\nco-op;45\n');
});

test('serializeEntries: collapse keeps the highest score and combines distinct comments', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
    { norm: 'cafe', display: 'cafe', score: 50, comment: 'the band' },
  ], { spaces: true, punctuation: true, accents: false, comments: true });
  assert.equal(out, 'cafe;60;drink / the band\n');
});

test('serializeEntries: combined comments dedup and order by score descending', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'cafe', score: 40, comment: 'low' },
    { norm: 'cafe', display: 'café', score: 70, comment: 'high' },
    { norm: 'cafe', display: 'cafè', score: 55, comment: 'high' },
  ], { spaces: true, punctuation: true, accents: false, comments: true });
  assert.equal(out, 'cafe;70;high / low\n');
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

test('formatEntryText: each strip axis acts independently on the display', () => {
  const e = { norm: 'cafeaulait', display: 'café au lait' };
  assert.equal(formatEntryText(e, RICH), 'café au lait');
  assert.equal(formatEntryText(e, { spaces: true, punctuation: true, accents: false }), 'cafe au lait');
  assert.equal(formatEntryText(e, { spaces: false, punctuation: true, accents: true }), 'caféaulait');
  assert.equal(formatEntryText({ norm: 'coop', display: 'co-op' }, { spaces: true, punctuation: false, accents: true }), 'coop');
  assert.equal(formatEntryText({ norm: 'cat', display: null }, RICH), 'cat');
});

test('sortedEntries: orders by norm via localeCompare, leaving the input untouched', () => {
  const input = [
    { norm: 'zebra', display: null, score: 1 },
    { norm: 'apple', display: null, score: 2 },
    { norm: 'mango', display: null, score: 3 },
  ];
  assert.deepStrictEqual(sortedEntries(input).map(e => e.norm), ['apple', 'mango', 'zebra']);
  assert.deepStrictEqual(input.map(e => e.norm), ['zebra', 'apple', 'mango']);
});
