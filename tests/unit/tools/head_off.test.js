import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.js';

const LIB = [
  { entry: 'swing', score: 50 }, { entry: 'wing', score: 40 },
  { entry: 'bread', score: 60 }, { entry: 'read', score: 55 },
  { entry: 'cantata', score: 60 }, { entry: 'tata', score: 40 },
  { entry: 'dog', score: 40 },
];

test('an empty pattern is inert — the merged view passes through', async () => {
  sameVisible(await visible(LIB, [{ tool: 'head_off' }]),
    ['swing', 'wing', 'bread', 'read', 'cantata', 'tata', 'dog']);
});

test('? cuts one leading letter, marking it, keeping only real remainders', async () => {
  sameVisible(await visible(LIB, [{ tool: 'head_off', params: { pattern: '?' } }]),
    [['swing', 'wing'], ['bread', 'read']]);
  const { rows } = await run(LIB, [{ tool: 'head_off', params: { pattern: '?' } }]);
  const row = rowByFirst(rows, 'swing');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['s']);
  assert.equal(row.atoms[0].highlights[0].kind, 'removed');
  assert.equal(row.atoms[1].highlights, null);
});

test('?? cuts two leading letters and marks them', async () => {
  const lib = [{ entry: 'chair', score: 70 }, { entry: 'air', score: 50 }];
  sameVisible(await visible(lib, [{ tool: 'head_off', params: { pattern: '??' } }]),
    [['chair', 'air']]);
  const { rows } = await run(lib, [{ tool: 'head_off', params: { pattern: '??' } }]);
  assert.deepEqual(highlightTexts(rowByFirst(rows, 'chair').atoms[0]), ['ch']);
});

test('a literal pattern cuts that exact prefix', async () => {
  sameVisible(await visible(LIB, [{ tool: 'head_off', params: { pattern: 'can' } }]),
    [['cantata', 'tata']]);
});

test('reversed, head_off grows the front — adds a prefix, marked on the output', async () => {
  sameVisible(await visible(LIB, [{ tool: 'head_off', params: { pattern: 'can' }, reverse: true }]),
    [['tata', 'cantata']]);
  const { rows } = await run(LIB, [{ tool: 'head_off', params: { pattern: 'can' }, reverse: true }]);
  const row = rowByFirst(rows, 'tata');
  assert.equal(row.atoms[0].highlights, null);
  assert.deepEqual(highlightTexts(row.atoms[1]), ['can']);
  assert.equal(row.atoms[1].highlights[0].kind, 'search:0');
});

test('reversed with a count grows any N leading letters that land on a real word', async () => {
  sameVisible(await visible(LIB, [{ tool: 'head_off', params: { pattern: '?' }, reverse: true }]),
    [['wing', 'swing'], ['read', 'bread']]);
});

test('a transform output surfaces every spelling that shares its norm', async () => {
  const lib = [
    { entry: 'swing', score: 50 },
    { entry: 'wing', score: 40 },
    { entry: 'w ing', score: 30 },   // distinct display, same norm as 'wing'
  ];
  sameVisible(await visible(lib, [{ tool: 'head_off', params: { pattern: '?' } }]),
    [['swing', 'wing'], ['swing', 'w ing']]);
});
