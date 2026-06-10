import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries whose letters are in non-decreasing order, with or without repeats', async () => {
  sameVisible(await visible(['abbey', 'billowy', 'beef', 'hello', 'book'],
    [{ tool: 'alphabetical' }]),
    ['abbey', 'beef', 'billowy']);
});
