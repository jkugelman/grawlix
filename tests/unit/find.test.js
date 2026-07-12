import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOccurrences, findEntryOccurrences, buildFindMatcher, FIND_MATCH_CAP } from '../../site/src/engine/find.js';
import { buildWlEntry } from '../../site/src/engine/norm.js';
import { buildSearchPattern } from '../../site/src/engine/search.js';

const all = (text, needle) => [...findOccurrences(text, needle)];

const findEntry = (wlEntry, needle) => [...findEntryOccurrences(buildFindMatcher(needle), wlEntry)];

const teresa = buildWlEntry('Mother Teresa', 50, '', 'lower');   // norm 'motherteresa', display 'Mother Teresa'

test('findOccurrences: reports each occurrence as a display-coordinate span', () => {
  assert.deepEqual(all('banana', 'an'), [{ start: 1, end: 3 }, { start: 3, end: 5 }]);
});

test('findOccurrences: the caller pre-lowercases the needle; matching is case-insensitive', () => {
  assert.deepEqual(all('The IRS', 'irs'), [{ start: 4, end: 7 }]);
});

test('findOccurrences: advances by the needle length, so hits never overlap', () => {
  assert.deepEqual(all('aaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
});

test('findOccurrences: an empty needle or empty text yields nothing', () => {
  assert.deepEqual(all('cat', ''), []);
  assert.deepEqual(all('', 'cat'), []);
});

test('findOccurrences: no match yields nothing', () => {
  assert.deepEqual(all('cat', 'dog'), []);
});

test('FIND_MATCH_CAP is 999', () => {
  assert.equal(FIND_MATCH_CAP, 999);
});

test('buildFindMatcher: an empty query yields no matcher', () => {
  assert.equal(buildFindMatcher(''), null);
  assert.equal(buildFindMatcher(null), null);
});

test('findEntryOccurrences: a space-free needle finds a spaced display via the norm', () => {
  assert.deepEqual(findEntry(teresa, 'motherteresa'), [{ start: 0, end: 13 }]);
});

test('findEntryOccurrences: a needle bridging the gap matches via the norm', () => {
  assert.deepEqual(findEntry(teresa, 'ert'), [{ start: 4, end: 8 }]);   // 'er␣T' — the display can't span the space
});

test('findEntryOccurrences: an in-display hit is reported once, in display coordinates', () => {
  assert.deepEqual(findEntry(teresa, 'teresa'), [{ start: 7, end: 13 }]);
});

test('findEntryOccurrences: a norm-only entry (display == null) matches in norm coordinates', () => {
  const apple = buildWlEntry('apple', 50, '', 'lower');
  assert.equal(apple.display, null);
  assert.deepEqual(findEntry(apple, 'app'), [{ start: 0, end: 3 }]);
});

test('findEntryOccurrences: a punctuation needle matches display punctuation', () => {
  const a1 = buildWlEntry('A-1', 50, '', 'lower');
  assert.deepEqual(findEntry(a1, '-'), [{ start: 1, end: 2 }]);
});

test('findEntryOccurrences: a literal query matches the same entries the Search tool does', () => {
  const irs = buildWlEntry('the IRS', 50, '', 'lower');
  for (const [e, q] of [[teresa, 'motherteresa'], [teresa, 'mother teresa'], [irs, 'irs'], [irs, 'the irs'], [irs, 'the-irs']]) {
    assert.equal(findEntry(e, q).length > 0, buildSearchPattern(q).test(e), `find vs Search disagree on "${q}"`);
  }
});

test('findEntryOccurrences: wildcard characters are literal, unlike the Search tool', () => {
  const apple = buildWlEntry('apple', 50, '', 'lower');
  assert.deepEqual(findEntry(apple, 'a*e'), []);              // '*' is a literal, so no match
  assert.equal(buildSearchPattern('a*e').test(apple), true);  // Search reads '*' as a wildcard, so it matches
});
