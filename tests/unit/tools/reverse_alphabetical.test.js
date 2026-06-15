import { test } from 'node:test';
import { visible, sameVisible } from './harness.js';

test('keeps entries whose letters are in non-increasing order, with or without repeats', async () => {
  sameVisible(await visible(['spoofed', 'yuppie', 'wolfed', 'hello', 'cat'],
    [{ tool: 'reverse_alphabetical' }]),
    ['spoofed', 'wolfed', 'yuppie']);
});
