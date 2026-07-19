import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.js';

test('Kangaroos keeps entries that contain the input as a subsequence with gaps', async () => {
  sameVisible(await visible(['milkandsugar', 'kangaroo', 'hello', 'bangalore'],
    [{ tool: 'kangaroos', params: { entry: 'KANGA' } }]),
    ['kangaroo', 'milkandsugar']);
});

test('subsequence order matters — same letters in a different order are not a kangaroo', async () => {
  sameVisible(await visible(['abcdef', 'fedcba'],
    [{ tool: 'kangaroos', params: { entry: 'ACE' } }]),
    ['abcdef']);
});

test('the input itself is excluded — a kangaroo must be longer than its joey', async () => {
  sameVisible(await visible(['kanga', 'kangas'],
    [{ tool: 'kangaroos', params: { entry: 'KANGA' } }]),
    ['kangas']);
});

test('an empty param is inert — the full merged view passes through', async () => {
  sameVisible(await visible(['cat', 'dog'],
    [{ tool: 'kangaroos', params: { entry: '' } }]),
    ['cat', 'dog']);
});

test('the param is matched case-insensitively', async () => {
  sameVisible(await visible(['kangaroo'],
    [{ tool: 'kangaroos', params: { entry: 'kAnGa' } }]),
    ['kangaroo']);
});

test('highlights each input letter where it lands in the kangaroo', async () => {
  const { rows } = await run(['milkandsugar'], [{ tool: 'kangaroos', params: { entry: 'KANGA' } }]);
  const row = rowByFirst(rows, 'milkandsugar');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['k', 'a', 'n', 'g', 'a']);
});
