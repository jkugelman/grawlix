import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOccurrences, FIND_MATCH_CAP } from '../../site/src/engine/find.js';

const all = (text, needle) => [...findOccurrences(text, needle)];

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
