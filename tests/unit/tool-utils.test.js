import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParams } from '../../site/src/engine/tools.js';
import { sortLetters } from '../../site/src/engine/tools/shared.js';
import { consonantSkeleton } from '../../site/src/engine/tools/consonantcy.js';
import { vowelSkeleton } from '../../site/src/engine/tools/vowelcy.js';
import { caesarShift, caesarKey } from '../../site/src/engine/tools/caesar.js';
import { patternKey } from '../../site/src/engine/tools/cryptogram.js';
import { wordSplits } from '../../site/src/engine/tools/initialisms.js';

test('sortLetters: returns the letters in ascending code-unit order', () => {
  assert.equal(sortLetters('cat'), 'act');
});

test('sortLetters: anagrams collapse to the same key', () => {
  assert.equal(sortLetters('listen'), sortLetters('silent'));
  assert.equal(sortLetters('listen'), 'eilnst');
});

test('sortLetters: does NOT fold case — uppercase sorts before lowercase', () => {
  assert.equal(sortLetters('Cat'), 'Cat');
});

test('sortLetters: non-letter characters survive and participate', () => {
  assert.equal(sortLetters('a-b'), '-ab');
});

test('sortLetters: falsy input short-circuits to the empty string', () => {
  assert.equal(sortLetters(''), '');
  assert.equal(sortLetters(null), '');
  assert.equal(sortLetters(undefined), '');
});

test('consonantSkeleton: keeps only consonants, dropping vowels', () => {
  assert.equal(consonantSkeleton('beautiful'), 'btfl');
});

test('consonantSkeleton: Y counts as a VOWEL (stripped, not kept)', () => {
  assert.equal(consonantSkeleton('rhythm'), 'rhthm');
  assert.equal(consonantSkeleton('syzygy'), 'szg');
});

test('consonantSkeleton: only matches lowercase a-z; uppercase is stripped', () => {
  assert.equal(consonantSkeleton('CAT'), '');
});

test('consonantSkeleton: punctuation and spaces are removed', () => {
  assert.equal(consonantSkeleton('s-p t'), 'spt');
});

test('consonantSkeleton: falsy input yields the empty string', () => {
  assert.equal(consonantSkeleton(''), '');
  assert.equal(consonantSkeleton(null), '');
});

test('vowelSkeleton: keeps A E I O U Y in order', () => {
  assert.equal(vowelSkeleton('beautiful'), 'eauiu');
  assert.equal(vowelSkeleton('queue'), 'ueue');
});

test('vowelSkeleton: Y counts as a vowel (kept)', () => {
  assert.equal(vowelSkeleton('rhythm'), 'y');
  assert.equal(vowelSkeleton('syzygy'), 'yyy');
});

test('vowelSkeleton: only matches lowercase aeiouy; uppercase is stripped', () => {
  assert.equal(vowelSkeleton('CAT'), '');
  assert.equal(vowelSkeleton('CRY'), '');
});

test('vowelSkeleton: falsy input yields the empty string', () => {
  assert.equal(vowelSkeleton(''), '');
  assert.equal(vowelSkeleton(null), '');
});

test('caesarShift: shifts a-z by n', () => {
  assert.equal(caesarShift('cat', 1), 'dbu');
});

test('caesarShift: wraps past z', () => {
  assert.equal(caesarShift('xyz', 3), 'abc');
});

test('caesarShift: a negative shift wraps the other way', () => {
  assert.equal(caesarShift('abc', -1), 'zab');
});

test('caesarShift: non-letters stay in place', () => {
  assert.equal(caesarShift('a-b c', 1), 'b-c d');
});

test('caesarKey: Caesar-relatives collapse to the same key', () => {
  assert.equal(caesarKey('steeds'), caesarKey('tuffet'));
  assert.equal(caesarKey('cat'), caesarKey('png'));
});

test('caesarKey: anchors the first letter to a', () => {
  assert.equal(caesarKey('steeds'), 'abmmla');
  assert.equal(caesarKey('cat'), 'ayr');
});

test('caesarKey: empty input yields the empty string', () => {
  assert.equal(caesarKey(''), '');
});

test('patternKey: same-shape words collapse to the same key', () => {
  assert.equal(patternKey('level'), patternKey('rotor'));
  assert.equal(patternKey('noon'), patternKey('peep'));
});

test('patternKey: relabels letters a, b, c… by first appearance', () => {
  assert.equal(patternKey('level'), 'abcba');
  assert.equal(patternKey('puppy'), 'abaac');
});

test('patternKey: digits are literal anchors, not enciphered', () => {
  assert.equal(patternKey('k9k9'), 'a9a9');
});

test('patternKey: empty input yields the empty string', () => {
  assert.equal(patternKey(''), '');
});

test('wordSplits: a single word yields one space-split candidate', () => {
  assert.deepEqual(wordSplits('cat'), [['cat']]);
});

test('wordSplits: a multi-word phrase splits on spaces only (no hyphen variant)', () => {
  assert.deepEqual(wordSplits('hello world'), [['hello', 'world']]);
});

test('wordSplits: runs of spaces collapse (no empty segments)', () => {
  assert.deepEqual(wordSplits('a  b'), [['a', 'b']]);
});

test('wordSplits: a hyphenated word adds a SECOND candidate split further on hyphens', () => {
  assert.deepEqual(wordSplits('merry-go-round'), [
    ['merry-go-round'],
    ['merry', 'go', 'round'],
  ]);
});

test('wordSplits: the hyphen pass applies across all space-separated words', () => {
  assert.deepEqual(wordSplits('la-di-da time'), [
    ['la-di-da', 'time'],
    ['la', 'di', 'da', 'time'],
  ]);
});

test('wordSplits: leading/trailing hyphens drop to empty (filtered out)', () => {
  assert.deepEqual(wordSplits('-cat-'), [
    ['-cat-'],
    ['cat'],
  ]);
});

test('wordSplits: consecutive hyphens split as one boundary', () => {
  assert.deepEqual(wordSplits('a--b'), [
    ['a--b'],
    ['a', 'b'],
  ]);
});

test('normalizeParams: lowercases ordinary string params', () => {
  assert.deepEqual(normalizeParams({ word: 'CAT' }, [{ key: 'word' }]), { word: 'cat' });
});

test('normalizeParams: a raw-flagged param keeps its case verbatim', () => {
  // Why raw exists: lowercasing a regex would turn \D into \d, silently
  // inverting the character class with no error.
  assert.deepEqual(
    normalizeParams({ pattern: '\\D+ABC' }, [{ key: 'pattern', raw: true }]),
    { pattern: '\\D+ABC' },
  );
});

test('normalizeParams: lowercases only the non-raw params in a mixed schema', () => {
  assert.deepEqual(
    normalizeParams(
      { word: 'DOG', pattern: 'AbC' },
      [{ key: 'word' }, { key: 'pattern', raw: true }],
    ),
    { word: 'dog', pattern: 'AbC' },
  );
});

test('normalizeParams: lowercases but does NOT trim whitespace', () => {
  assert.deepEqual(normalizeParams({ word: '  CAT  ' }, [{ key: 'word' }]), { word: '  cat  ' });
});

test('normalizeParams: non-string values pass through unchanged', () => {
  assert.deepEqual(normalizeParams({ count: 5, flag: true }, []), { count: 5, flag: true });
});

test('normalizeParams: a null/absent schema means no param is raw (all lowercased)', () => {
  assert.deepEqual(normalizeParams({ a: 'X', b: 'Y' }), { a: 'x', b: 'y' });
});

test('normalizeParams: null params yields an empty object', () => {
  assert.deepEqual(normalizeParams(null, [{ key: 'word' }]), {});
});

test('normalizeParams: an array param lowercases element-wise unless raw', () => {
  assert.deepEqual(
    normalizeParams(
      { from: ['Tool', 'BAR'], to: ['Ⓣ', '★'] },
      [{ key: 'from', repeat: true }, { key: 'to', repeat: true, raw: true }],
    ),
    { from: ['tool', 'bar'], to: ['Ⓣ', '★'] },
  );
});
