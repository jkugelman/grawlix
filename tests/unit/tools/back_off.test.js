import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.js';

// CATS/CAT and PRESS/PRES are load-bearing: a wildcard back_off skips a single
// trailing s (plural → singular) but NOT a double-s ending. A literal `s`, though,
// is honored — the user asked for that character.
const LIB = [
  { entry: 'party', score: 60 }, { entry: 'part', score: 55 },
  { entry: 'press', score: 50 }, { entry: 'pres', score: 45 },
  { entry: 'cats', score: 40 }, { entry: 'cat', score: 40 },
  { entry: 'dog', score: 40 },
];

test('? cuts one trailing letter, skipping a plural s but keeping a double-s', async () => {
  sameVisible(await visible(LIB, [{ tool: 'back_off', params: { pattern: '?' } }]),
    [['party', 'part'], ['press', 'pres']]);
  const { rows } = await run(LIB, [{ tool: 'back_off', params: { pattern: '?' } }]);
  const row = rowByFirst(rows, 'party');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['y']);
  assert.equal(row.atoms[0].highlights[0].kind, 'removed');
});

test('a literal s is honored — cats → cat, no plural skip', async () => {
  sameVisible(await visible(LIB, [{ tool: 'back_off', params: { pattern: 's' } }]),
    [['cats', 'cat'], ['press', 'pres']]);
});

test('?? cuts two trailing letters and marks them', async () => {
  const lib = [{ entry: 'castle', score: 70 }, { entry: 'cast', score: 50 }];
  sameVisible(await visible(lib, [{ tool: 'back_off', params: { pattern: '??' } }]),
    [['castle', 'cast']]);
  const { rows } = await run(lib, [{ tool: 'back_off', params: { pattern: '??' } }]);
  assert.deepEqual(highlightTexts(rowByFirst(rows, 'castle').atoms[0]), ['le']);
});

test('reversed, back_off grows the back — PETS to PET SCAN in norm space, marked on the output', async () => {
  const lib = [{ entry: 'pets', score: 50 }, { entry: 'pet scan', score: 55 }];
  sameVisible(await visible(lib, [{ tool: 'back_off', params: { pattern: 'can' }, reverse: true }]),
    [['pets', 'pet scan']]);
  const { rows } = await run(lib, [{ tool: 'back_off', params: { pattern: 'can' }, reverse: true }]);
  const row = rowByFirst(rows, 'pets');
  assert.deepEqual(highlightTexts(row.atoms[1]), ['can']);
  assert.equal(row.atoms[1].highlights[0].kind, 'search:0');
});

