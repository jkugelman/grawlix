import { test } from 'node:test';
import { visible, sameVisible } from './harness.js';

test('* cuts any leading run, emitting every remainder that is a real word', async () => {
  sameVisible(await visible(['abcd', 'bcd', 'cd'],
    [{ tool: 'head_off', params: { pattern: '*' } }]),
    [['abcd', 'bcd'], ['abcd', 'cd'], ['bcd', 'cd']]);
});

test('a class token cuts one letter drawn from the set (@ = any vowel)', async () => {
  sameVisible(await visible(['acorn', 'corn', 'scorn'],
    [{ tool: 'head_off', params: { pattern: '@' } }]),
    [['acorn', 'corn']]);
});

test('a mixed literal + wildcard pattern cuts a matching prefix', async () => {
  sameVisible(await visible(['coat', 'at', 'dog'],
    [{ tool: 'head_off', params: { pattern: 'c?' } }]),
    [['coat', 'at']]);
});

test('cut then grow the same pattern round-trips back to the original', async () => {
  sameVisible(await visible(['cantata', 'tata'], [
    { tool: 'head_off', params: { pattern: 'can' } },
    { tool: 'head_off', params: { pattern: 'can' }, reverse: true },
  ]),
    [['cantata', 'tata', 'cantata']]);
});

test('grow is multivalued — a count adds any matching letters that land on a real word', async () => {
  sameVisible(await visible(['at', 'cat', 'bat', 'oat'],
    [{ tool: 'head_off', params: { pattern: '?' }, reverse: true }]),
    [['at', 'cat'], ['at', 'bat'], ['at', 'oat']]);
});

test('cut and grow enumerate spellings symmetrically — each grow row is a cut row reversed', async () => {
  const lib = ['a wing', 'awing', 'wing', 'w ing'];   // 2 spellings of norm 'awing', 2 of 'wing'
  const cut = await visible(lib, [{ tool: 'head_off', params: { pattern: '?' } }]);
  const grow = await visible(lib, [{ tool: 'head_off', params: { pattern: '?' }, reverse: true }]);
  sameVisible(cut,
    [['a wing', 'wing'], ['a wing', 'w ing'], ['awing', 'wing'], ['awing', 'w ing']]);
  sameVisible(grow, cut.map(([input, output]) => [output, input]));
});
