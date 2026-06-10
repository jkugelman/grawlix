import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries that read the same forwards and backwards', async () => {
  sameVisible(await visible(['racecar', 'kayak', 'noon', 'hello', 'test'],
    [{ tool: 'palindromes' }]),
    ['kayak', 'noon', 'racecar']);
});

test('even-length and odd-length palindromes both match', async () => {
  sameVisible(await visible(['abba', 'civic'], [{ tool: 'palindromes' }]),
    ['abba', 'civic']);
});
