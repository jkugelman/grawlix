import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordBreaks, partBreaks, spansWords, isWholeWords, displayRangeToNorm, isUnspaced,
} from '../../site/src/engine/norm.js';

const wl = (norm, display = null) => ({ norm, display });

const reader = readings => ({ best: norm => readings[norm] ?? null });

// ─── wordBreaks ───────────────────────────────────────────────────────────────

test('breaks: a spaced display breaks at the norm offset of each space', () => {
  assert.deepEqual(wordBreaks(wl('theirs', 'the IRS')), [3]);
  assert.deepEqual(wordBreaks(wl('catfoodbowl', 'cat food bowl')), [3, 7]);
});

test('breaks: hyphens are breaks; apostrophes and periods are not', () => {
  assert.deepEqual(wordBreaks(wl('xray', 'x-ray')), [1]);
  assert.deepEqual(wordBreaks(wl('isnt', "isn't")), []);
  assert.deepEqual(wordBreaks(wl('usa', 'U.S.A.')), []);
});

test('breaks: a run of separators is one break', () => {
  assert.deepEqual(wordBreaks(wl('ab', 'a - b')), [1]);
});

test('breaks: an unspaced entry has none without a reader', () => {
  assert.deepEqual(wordBreaks(wl('theirs')), []);
  assert.deepEqual(wordBreaks(wl('isnt', "isn't")), []);
});

test('breaks: an unspaced entry reads through the reader', () => {
  const r = reader({ datatable: ['data', 'table'], helenoftroy: ['helen', 'of', 'troy'] });
  assert.deepEqual(wordBreaks(wl('datatable'), r), [4]);
  assert.deepEqual(wordBreaks(wl('helenoftroy', 'HelenOfTroy'), r), [5, 7]);
});

test('breaks: a reader that reads the entry as one word gives none', () => {
  assert.deepEqual(wordBreaks(wl('theirs'), reader({})), []);
});

test('breaks: authored spacing wins over the reader', () => {
  const r = reader({ theirs: ['th', 'eirs'] });
  assert.deepEqual(wordBreaks(wl('theirs', 'the IRS'), r), [3]);
});

test("breaks: a reading's parts are measured by their letters, not their spelling", () => {
  assert.deepEqual(partBreaks(['I', "don't", 'care']), [1, 5]);
});

test('isUnspaced: the same policy as the breaks', () => {
  assert.equal(isUnspaced('theirs'), true);
  assert.equal(isUnspaced("isn't"), true);
  assert.equal(isUnspaced('the IRS'), false);
  assert.equal(isUnspaced('x-ray'), false);
});

// ─── spansWords ───────────────────────────────────────────────────────────────

test('spans: a window strictly containing a break spans words', () => {
  const breaks = [3];   // the|irs
  assert.equal(spansWords(breaks, 1, 5), true);    // "heir" — he|ir
  assert.equal(spansWords(breaks, 0, 3), false);   // "the" — one word
  assert.equal(spansWords(breaks, 3, 6), false);   // "irs" — one word
  assert.equal(spansWords(breaks, 2, 4), true);    // "ei" — the smallest spanning window
});

test('spans: no breaks, nothing to span', () => {
  assert.equal(spansWords([], 1, 5), false);
});

test('spans: an empty window never spans', () => {
  assert.equal(spansWords([3], 3, 3), false);
});

// ─── isWholeWords ─────────────────────────────────────────────────────────────

test('whole words: aligned windows pass, misaligned windows fail', () => {
  const breaks = [3];   // cat|food
  assert.equal(isWholeWords(breaks, 7, 0, 3), true);    // "cat"
  assert.equal(isWholeWords(breaks, 7, 3, 7), true);    // "food"
  assert.equal(isWholeWords(breaks, 7, 0, 7), true);    // both words
  assert.equal(isWholeWords(breaks, 7, 1, 3), false);   // "at" — mid-word start
  assert.equal(isWholeWords(breaks, 7, 0, 4), false);   // "catf" — mid-word end
});

test('whole words: with no breaks only the full window passes', () => {
  assert.equal(isWholeWords([], 3, 0, 3), true);
  assert.equal(isWholeWords([], 3, 0, 2), false);
  assert.equal(isWholeWords([], 3, 1, 3), false);
});

test('whole words: an empty window is not a word', () => {
  assert.equal(isWholeWords([3], 7, 3, 3), false);
});

// ─── displayRangeToNorm ───────────────────────────────────────────────────────

test('display→norm: separators at the edges fall away', () => {
  const e = wl('theirs', 'the IRS');
  assert.deepEqual(displayRangeToNorm(e, 3, 7), [3, 6]);   // " IRS" covers the letters of IRS
  assert.deepEqual(displayRangeToNorm(e, 2, 6), [2, 5]);   // "e IR" straddles the break
  assert.deepEqual(displayRangeToNorm(e, 0, 7), [0, 6]);
});

test('display→norm: a window of separators alone is empty', () => {
  assert.deepEqual(displayRangeToNorm(wl('theirs', 'the IRS'), 3, 4), [3, 3]);
});

test('display→norm: a folding character counts every letter it becomes', () => {
  assert.deepEqual(displayRangeToNorm(wl('strasse', 'Straße'), 4, 6), [4, 7]);
});
