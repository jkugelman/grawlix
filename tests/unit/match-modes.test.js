import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSpansWords, matchIsWholeWords } from '../../site/src/engine/norm.js';

const wl = (norm, display = null) => ({ norm, display });

// ─── matchSpansWords ──────────────────────────────────────────────────────────

test('spans: a window crossing a space spans words', () => {
  const e = wl('theirs', 'the IRS');
  assert.equal(matchSpansWords(e, 1, 5), true);    // "heir" — he|IR
  assert.equal(matchSpansWords(e, 0, 3), false);   // "the" — one word
  assert.equal(matchSpansWords(e, 3, 6), false);   // "irs" — one word
});

test('spans: a plain entry has no breaks to span', () => {
  assert.equal(matchSpansWords(wl('theirs'), 1, 5), false);
});

test('spans: hyphens are breaks; apostrophes and periods are not', () => {
  assert.equal(matchSpansWords(wl('xray', 'x-ray'), 0, 2), true);
  assert.equal(matchSpansWords(wl('isnt', "isn't"), 2, 4), false);
  assert.equal(matchSpansWords(wl('usa', 'U.S.A.'), 0, 3), false);
});

test('spans: display-coord edges are trimmed to letters before testing', () => {
  const e = wl('theirs', 'the IRS');
  // " IRS" touches the break but its letters sit in one word.
  assert.equal(matchSpansWords(e, 3, 7, 'display'), false);
  // "e IR" genuinely crosses it.
  assert.equal(matchSpansWords(e, 2, 6, 'display'), true);
});

test('spans: an empty or out-of-range window never spans', () => {
  const e = wl('theirs', 'the IRS');
  assert.equal(matchSpansWords(e, 3, 3), false);
  assert.equal(matchSpansWords(e, 9, 12), false);
});

// ─── matchIsWholeWords ────────────────────────────────────────────────────────

test('whole words: aligned windows pass, misaligned windows fail', () => {
  const e = wl('catfood', 'cat food');
  assert.equal(matchIsWholeWords(e, 0, 3), true);    // "cat"
  assert.equal(matchIsWholeWords(e, 3, 7), true);    // "food"
  assert.equal(matchIsWholeWords(e, 0, 7), true);    // both words
  assert.equal(matchIsWholeWords(e, 1, 3), false);   // "at" — mid-word start
  assert.equal(matchIsWholeWords(e, 0, 4), false);   // "catf" — mid-word end
});

test('whole words: a plain entry is one word, so only the full window passes', () => {
  const e = wl('cat');
  assert.equal(matchIsWholeWords(e, 0, 3), true);
  assert.equal(matchIsWholeWords(e, 0, 2), false);
  assert.equal(matchIsWholeWords(e, 1, 3), false);
});

test('whole words: an apostrophe does not open a word boundary', () => {
  const e = wl('isnt', "isn't");
  assert.equal(matchIsWholeWords(e, 0, 4), true);    // the whole word
  assert.equal(matchIsWholeWords(e, 0, 3), false);   // "isn" stops at the apostrophe
  assert.equal(matchIsWholeWords(e, 3, 4), false);   // "t" starts at it
});

test('whole words: display-coord windows tolerate separator edges', () => {
  const e = wl('catfood', 'cat food');
  assert.equal(matchIsWholeWords(e, 3, 8, 'display'), true);    // " food"
  assert.equal(matchIsWholeWords(e, 0, 4, 'display'), true);    // "cat "
  assert.equal(matchIsWholeWords(e, 2, 6, 'display'), false);   // "t fo"
});

test('whole words: leading punctuation still counts as a word start', () => {
  const e = wl('tis', "'tis");
  assert.equal(matchIsWholeWords(e, 0, 3), true);
});
