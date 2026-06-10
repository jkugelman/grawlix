import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.mjs';

const LIB = [
  { entry: 'sling', score: 50 }, { entry: 'ling', score: 40 },
  { entry: 'bread', score: 60 }, { entry: 'read', score: 55 },
  { entry: 'dog', score: 40 },
];

test('chains an entry with its first-letter-dropped form, dropping entries with no beheaded match', async () => {
  sameVisible(await visible(LIB, [{ tool: 'behead' }]),
    [['bread', 'read'], ['sling', 'ling']]);
});

test('marks the dropped first letter on the originator atom only', async () => {
  const { rows } = await run(LIB, [{ tool: 'behead' }]);
  const row = rowByFirst(rows, 'sling');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['s']);
  assert.equal(row.atoms[0].highlights[0].kind, 'removed');
  assert.equal(row.atoms[1].highlights, null);
});

test('Count drops that many leading letters and marks them', async () => {
  const lib = [
    { entry: 'chair', score: 70 }, { entry: 'air', score: 50 },
    { entry: 'stable', score: 60 }, { entry: 'able', score: 50 },
  ];
  sameVisible(await visible(lib, [{ tool: 'behead', params: { count: '2' } }]),
    [['chair', 'air'], ['stable', 'able']]);

  const { rows } = await run(lib, [{ tool: 'behead', params: { count: '2' } }]);
  assert.deepEqual(highlightTexts(rowByFirst(rows, 'chair').atoms[0]), ['ch']);
});
