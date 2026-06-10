import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries whose first and second halves are identical', async () => {
  sameVisible(await visible(['tartar', 'hotshots', 'bonbon', 'cocoa', 'hello'],
    [{ tool: 'repeaters' }]),
    ['bonbon', 'hotshots', 'tartar']);
});

test('odd-length entries are excluded — a repeater requires even length', async () => {
  sameVisible(await visible(['abcabc', 'ababa'], [{ tool: 'repeaters' }]),
    ['abcabc']);
});

test('an even-length non-repeater (halves differ) is dropped', async () => {
  sameVisible(await visible(['murder', 'tartar'], [{ tool: 'repeaters' }]),
    ['tartar']);
});
