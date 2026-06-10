import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries spelled from any subset of the input tiles', async () => {
  sameVisible(await visible(['plane', 'rent', 'pear', 'tiger'],
    [{ tool: 'scrabble', params: { tiles: 'PARENTAL' } }]),
    ['pear', 'plane', 'rent']);
});

test('a tile is consumed at the frequency it appears in the input', async () => {
  sameVisible(await visible(['pool', 'pop', 'pol'],
    [{ tool: 'scrabble', params: { tiles: 'POL' } }]),
    ['pol']);
});

test('empty tiles param is inert — the full merged view passes through', async () => {
  sameVisible(await visible(['cat', 'dog'],
    [{ tool: 'scrabble', params: { tiles: '' } }]),
    ['cat', 'dog']);
});

test('the param is matched case-insensitively', async () => {
  sameVisible(await visible(['cat', 'dog'],
    [{ tool: 'scrabble', params: { tiles: 'aCt' } }]),
    ['cat']);
});
