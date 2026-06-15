import { test } from 'node:test';
import { visible, sameVisible } from './harness.js';

test('keeps entries with every letter unique', async () => {
  sameVisible(await visible(['dialogue', 'cyberpunk', 'hello', 'eccentric'],
    [{ tool: 'isograms' }]),
    ['cyberpunk', 'dialogue']);
});

test('non-letter characters in an entry are skipped, not counted as repeats', async () => {
  sameVisible(await visible(['jack-o', 'oo-la'], [{ tool: 'isograms' }]),
    ['jack-o']);
});
