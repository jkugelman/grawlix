import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('chains an entry with its reversed form, dropping entries with no reverse', async () => {
  sameVisible(await visible(
    [{ entry: 'star', score: 50 }, { entry: 'rats', score: 50 },
     { entry: 'devil', score: 70 }, { entry: 'lived', score: 60 },
     { entry: 'cat', score: 40 }, { entry: 'dog', score: 40 }],
    [{ tool: 'semordnilap' }]),
    [['devil', 'lived'], ['rats', 'star']]);
});

test('excludes palindromes — reversing them yields the same word', async () => {
  sameVisible(await visible(['racecar', 'kayak', 'level'], [{ tool: 'semordnilap' }]), []);
});
