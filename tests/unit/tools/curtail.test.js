import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.js';

// CATS/CAT and PRESS/PRES are load-bearing: curtail skips a single trailing s
// (plural → singular) but NOT a double-s ending. CATS must not chain to CAT even
// though CAT is a real entry; PRESS must still chain to PRES. Don't drop either.
const LIB = [
  { entry: 'party', score: 60 }, { entry: 'part', score: 55 },
  { entry: 'press', score: 50 }, { entry: 'pres', score: 45 },
  { entry: 'cats', score: 40 }, { entry: 'cat', score: 40 },
  { entry: 'dog', score: 40 },
];

test('chains last-letter-dropped forms, skipping a plural s but keeping a double-s', async () => {
  sameVisible(await visible(LIB, [{ tool: 'curtail' }]),
    [['party', 'part'], ['press', 'pres']]);
});

test('marks the dropped last letter on the originator atom only', async () => {
  const { rows } = await run(LIB, [{ tool: 'curtail' }]);
  const row = rowByFirst(rows, 'party');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['y']);
  assert.equal(row.atoms[0].highlights[0].kind, 'removed');
  assert.equal(row.atoms[1].highlights, null);
});

test('Count drops that many trailing letters and marks them', async () => {
  const lib = [
    { entry: 'castle', score: 70 }, { entry: 'cast', score: 50 },
    { entry: 'planet', score: 60 }, { entry: 'plan', score: 50 },
  ];
  sameVisible(await visible(lib, [{ tool: 'curtail', params: { count: '2' } }]),
    [['castle', 'cast'], ['planet', 'plan']]);

  const { rows } = await run(lib, [{ tool: 'curtail', params: { count: '2' } }]);
  assert.deepEqual(highlightTexts(rowByFirst(rows, 'castle').atoms[0]), ['le']);
});
