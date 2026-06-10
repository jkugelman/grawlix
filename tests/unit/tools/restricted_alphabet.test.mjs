import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries whose letters all belong to the input alphabet', async () => {
  sameVisible(await visible(['pop', 'top', 'stoop', 'pear', 'cat'],
    [{ tool: 'restricted_alphabet', params: { letters: 'SPOT' } }]),
    ['pop', 'stoop', 'top']);
});

test('input duplicates are ignored — the alphabet is a set', async () => {
  sameVisible(await visible(['pop', 'poppy'],
    [{ tool: 'restricted_alphabet', params: { letters: 'OP' } }]),
    ['pop']);
});

test('empty letters is inert — the full merged view passes through', async () => {
  sameVisible(await visible(['cat', 'dog'],
    [{ tool: 'restricted_alphabet', params: { letters: '' } }]),
    ['cat', 'dog']);
});
