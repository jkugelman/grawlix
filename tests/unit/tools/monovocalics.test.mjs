import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries whose vowels are all the same letter', async () => {
  sameVisible(await visible(['toocoolforschool', 'strengths', 'banana', 'hello'],
    [{ tool: 'monovocalics' }]),
    ['banana', 'strengths', 'toocoolforschool']);
});

test('Y at the start of a word is a consonant — YOLK is O-monovocalic', async () => {
  sameVisible(await visible(['yolk', 'yelp', 'yacht', 'year'],
    [{ tool: 'monovocalics' }]),
    ['yacht', 'yelp', 'yolk']);
});

test('Y anywhere else is a vowel — it counts as a second vowel in an AEIOU word', async () => {
  sameVisible(await visible(['boytoy', 'baby', 'kayak', 'syrup', 'larynx'],
    [{ tool: 'monovocalics' }]),
    []);
});

test('a Y-only entry matches as Y-monovocalic; a vowel-less entry drops', async () => {
  sameVisible(await visible(['rhythm', 'gypsy', 'why', 'shhh'],
    [{ tool: 'monovocalics' }]),
    ['gypsy', 'rhythm', 'why']);
});
