import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.js';

// PET SCAN is load-bearing: collapse it to PETSCAN and these tests still pass
// while no longer proving affixes match in norm space (spaces/punctuation stripped).
const LIB = [
  { entry: 'tata', score: 40 }, { entry: 'cantata', score: 60 },
  { entry: 'pets', score: 50 }, { entry: 'pet scan', score: 55 },
  { entry: 'read', score: 50 }, { entry: 'bread', score: 60 },
  { entry: 'dog', score: 40 },
];

test('add prefix chains an entry to its prefixed form, dropping ones with no match', async () => {
  sameVisible(await visible(LIB, [{ tool: 'add_prefix', params: { prefix: 'can' } }]),
    [['tata', 'cantata']]);
});

test('add prefix marks the prepended letters on the output atom', async () => {
  const { rows } = await run(LIB, [{ tool: 'add_prefix', params: { prefix: 'can' } }]);
  const row = rowByFirst(rows, 'tata');
  assert.equal(row.atoms[0].highlights, null);
  assert.deepEqual(highlightTexts(row.atoms[1]), ['can']);
  assert.equal(row.atoms[1].highlights[0].kind, 'search:0');
});

test('remove prefix chains an entry to its deprefixed form, only when the entry starts with it', async () => {
  sameVisible(await visible(LIB, [{ tool: 'remove_prefix', params: { prefix: 'can' } }]),
    [['cantata', 'tata']]);
});

test('remove prefix marks the dropped letters on the input atom only', async () => {
  const { rows } = await run(LIB, [{ tool: 'remove_prefix', params: { prefix: 'can' } }]);
  const row = rowByFirst(rows, 'cantata');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['can']);
  assert.equal(row.atoms[0].highlights[0].kind, 'removed');
  assert.equal(row.atoms[1].highlights, null);
});

test('add suffix matches in norm space — PETS + can lands on PET SCAN', async () => {
  sameVisible(await visible(LIB, [{ tool: 'add_suffix', params: { suffix: 'can' } }]),
    [['pets', 'pet scan']]);
});

test('add suffix marks the appended letters on the output atom, projected onto the display', async () => {
  const { rows } = await run(LIB, [{ tool: 'add_suffix', params: { suffix: 'can' } }]);
  const row = rowByFirst(rows, 'pets');
  assert.deepEqual(highlightTexts(row.atoms[1]), ['can']);
  assert.equal(row.atoms[1].highlights[0].kind, 'search:0');
});

test('remove suffix inverts add suffix — PET SCAN back to PETS', async () => {
  sameVisible(await visible(LIB, [{ tool: 'remove_suffix', params: { suffix: 'can' } }]),
    [['pet scan', 'pets']]);
});

test('remove suffix marks the dropped trailing letters on the input atom only', async () => {
  const { rows } = await run(LIB, [{ tool: 'remove_suffix', params: { suffix: 'can' } }]);
  const row = rowByFirst(rows, 'pet scan');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['can']);
  assert.equal(row.atoms[0].highlights[0].kind, 'removed');
  assert.equal(row.atoms[1].highlights, null);
});

test('an affix never strips an entry to nothing — entry equal to the prefix is skipped', async () => {
  const lib = [{ entry: 'can', score: 40 }, { entry: 'cantata', score: 60 }, { entry: 'tata', score: 40 }];
  sameVisible(await visible(lib, [{ tool: 'remove_prefix', params: { prefix: 'can' } }]),
    [['cantata', 'tata']]);
});

test('add then remove the same suffix round-trips back to the original entry', async () => {
  sameVisible(
    await visible(LIB, [
      { tool: 'add_suffix', params: { suffix: 'can' } },
      { tool: 'remove_suffix', params: { suffix: 'can' } },
    ]),
    [['pets', 'pet scan', 'pets']]);
});
