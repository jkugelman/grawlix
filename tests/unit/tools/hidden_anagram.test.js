import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.js';

const LIB = [
  'windiest',   // w·indies·t — hides INSIDE rearranged as "indies"
  'inside',     // the input itself: a whole word, nothing longer wraps it
  'destiny',    // overlapping letters, but no 6-wide window is an anagram of INSIDE
  'sidewinder', // holds i,n,s,i,d,e spread out, but never in one contiguous window
  'dog',        // shorter than the needle
];

test('keeps longer words hiding a contiguous anagram of the input', async () => {
  sameVisible(await visible(LIB, [{ tool: 'hidden_anagram', params: { entry: 'inside' } }]),
    ['windiest']);
});

test('rejects the input itself — a whole-word anagram is not hidden', async () => {
  const out = (await visible(LIB, [{ tool: 'hidden_anagram', params: { entry: 'inside' } }])).flat();
  assert.ok(!out.includes('inside'));
});

test('the anagram window must be contiguous, not a spread-out subsequence', async () => {
  const out = (await visible(LIB, [{ tool: 'hidden_anagram', params: { entry: 'inside' } }])).flat();
  assert.ok(!out.includes('sidewinder'));
});

test('a verbatim occurrence does not count — an anagram is a rearrangement, not plain containment', async () => {
  sameVisible(await visible(['insider', 'windiest'], [{ tool: 'hidden_anagram', params: { entry: 'inside' } }]),
    ['windiest']);
});

test('a scrambled window still counts even when the word also appears verbatim elsewhere', async () => {
  // "inside" verbatim at [0,6] is skipped, but "indies" (an anagram) sits at [6,12].
  sameVisible(await visible(['insideindies'], [{ tool: 'hidden_anagram', params: { entry: 'inside' } }]),
    ['insideindies']);
});

test('letter counts matter — the same letters with the wrong multiset do not hide the anagram', async () => {
  sameVisible(await visible(['settler', 'related'], [{ tool: 'hidden_anagram', params: { entry: 'letter' } }]),
    ['settler']);   // settler hides "ettler", a scramble of letter; related has one T, not two
});

test('an empty param is inert — the full merged view passes through', async () => {
  sameVisible(await visible(['dog', 'cat'], [{ tool: 'hidden_anagram', params: { entry: '' } }]),
    ['dog', 'cat']);
});

test('a 2-letter input filters by scramble only — the verbatim spelling is not a hidden anagram', async () => {
  sameVisible(await visible(['piano', 'onset'], [{ tool: 'hidden_anagram', params: { entry: 'on' } }]),
    ['piano']);   // piano hides "no" (a swap of on); onset only spells "on" straight
});

test('the input is normalized: case and spaces are ignored', async () => {
  sameVisible(await visible(['windiest'], [{ tool: 'hidden_anagram', params: { entry: 'IN SIDE' } }]),
    ['windiest']);
});

test('highlights the hidden anagram span on the matched word', async () => {
  const { rows } = await run(LIB, [{ tool: 'hidden_anagram', params: { entry: 'inside' } }]);
  const row = rowByFirst(rows, 'windiest');
  assert.deepEqual(highlightTexts(row.atoms[row.atoms.length - 1]), ['indies']);
});

test('word spanning keeps only windows that cross a word break', async () => {
  // Both hide "salt" scrambled ("lts a" / "last"), but only the phrase's
  // window crosses a space; the one-word entry drops.
  const lib = ['melts away', 'lastly', 'windiest'];
  sameVisible(await visible(lib, [{ tool: 'hidden_anagram', params: { entry: 'salt', mode: 'span' } }]),
    ['melts away']);
});

test('word spanning skips a same-word window for a later crossing one', async () => {
  // "tales" hides in "stale" (within word 1) and again across "least|ale";
  // the first window fails the span gate but the scan continues to the second.
  const lib = ['stale bread', 'least ale'];
  const out = await visible(lib, [{ tool: 'hidden_anagram', params: { entry: 'tales', mode: 'span' } }]);
  sameVisible(out, ['least ale']);
});
