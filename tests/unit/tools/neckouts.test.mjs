import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries whose halves are anagrams of each other', async () => {
  sameVisible(await visible(['stuckonesneckout', 'intestines', 'hello', 'cards'],
    [{ tool: 'neckouts' }]),
    ['intestines', 'stuckonesneckout']);
});

test('a repeater (halves identical) is excluded — that is a different tool', async () => {
  sameVisible(await visible(['tartar', 'intestines'], [{ tool: 'neckouts' }]),
    ['intestines']);
});

test('odd-length entries are excluded — a neckout requires even length', async () => {
  sameVisible(await visible(['hello', 'intestines'], [{ tool: 'neckouts' }]),
    ['intestines']);
});

test('halves with different letter multisets are dropped', async () => {
  sameVisible(await visible(['murder', 'intestines'], [{ tool: 'neckouts' }]),
    ['intestines']);
});
