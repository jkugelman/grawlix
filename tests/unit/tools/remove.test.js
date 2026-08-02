import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, atomWord, highlightTexts } from './harness.js';

const LIB = [
  { entry: 'meditate', score: 60 }, { entry: 'mediate', score: 50 },
  { entry: 'dogs', score: 50 }, { entry: 'dogss', score: 20 },
];

const ERS = [
  { entry: 'derrieres', score: 40 }, { entry: 'drieres', score: 30 }, { entry: 'dries', score: 55 },
];

const remove = (pattern, extra) => [{ tool: 'remove', params: { pattern, ...extra } }];
const add = (pattern, extra) => [{ tool: 'remove', params: { pattern, ...extra }, reverse: true }];
const one = { mode: 'one' }, all = { mode: 'all' };

test('an empty pattern is inert — the merged view passes through', async () => {
  sameVisible(await visible(LIB, [{ tool: 'remove' }]), ['meditate', 'mediate', 'dogs', 'dogss']);
});

test('the card and manual example holds in both directions, on the default All', async () => {
  const lib = [{ entry: 'Xbox One', score: 60 }, { entry: 'Boone', score: 50 }];
  sameVisible(await visible(lib, remove('x')), [['Xbox One', 'Boone']]);
  sameVisible(await visible(lib, add('x')), [['Boone', 'Xbox One']]);
});

test('takes out one occurrence, keeping only real remainders', async () => {
  sameVisible(await visible(LIB, remove('t', one)), [['meditate', 'mediate']]);
});

test('the removed span is marked on the input, not the output', async () => {
  const { rows } = await run(LIB, remove('t', one));
  const row = rowByFirst(rows, 'meditate');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['t']);
  assert.equal(row.atoms[0].highlights[0].kind, 'removed');
  assert.equal(row.atoms[1].highlights, null);
});

test('one at a time steps through a word that all occurrences jumps past', async () => {
  sameVisible(await visible(ERS, remove('er', one)),
    [['derrieres', 'drieres'], ['drieres', 'dries']]);
  sameVisible(await visible(ERS, remove('er', all)),
    [['derrieres', 'dries'], ['drieres', 'dries']]);
});

test('all occurrences is the default — an unset mode matches an explicit All', async () => {
  sameVisible(await visible(ERS, remove('er')), await visible(ERS, remove('er', all)));
  sameVisible(await visible(ERS, add('er')), await visible(ERS, add('er', all)));
});

test('all-mode marks every removed span', async () => {
  const { rows } = await run(ERS, remove('er', all));
  assert.deepEqual(highlightTexts(rowByFirst(rows, 'derrieres').atoms[0]), ['er', 'er']);
});

test('overlapping occurrences cut to different words, and both are found', async () => {
  const lib = [{ entry: 'ababa', score: 50 }, { entry: 'ba', score: 40 }, { entry: 'ab', score: 30 }];
  sameVisible(await visible(lib, remove('aba', one)), [['ababa', 'ba'], ['ababa', 'ab']]);
  sameVisible(await visible(lib, remove('aba', all)), [['ababa', 'ba']]);
});

test('occurrences that cut to the same word collapse to one row', async () => {
  sameVisible(await visible(LIB, remove('s', one)), [['dogss', 'dogs']]);
});

test('reversed, it grows the entry — the added span marks the output', async () => {
  sameVisible(await visible(LIB, add('t', one)), [['mediate', 'meditate']]);
  const { rows } = await run(LIB, add('t', one));
  const row = rowByFirst(rows, 'mediate');
  assert.equal(row.atoms[0].highlights, null);
  assert.deepEqual(highlightTexts(row.atoms[1]), ['t']);
  assert.equal(row.atoms[1].highlights[0].kind, 'search:0');
});

test('reversed all-mode puts every occurrence back at once', async () => {
  sameVisible(await visible(ERS, add('er', all)),
    [['dries', 'derrieres'], ['dries', 'drieres']]);
  const { rows } = await run(ERS, add('er', all));
  const row = rows.find(r => atomWord(r.atoms[1]) === 'derrieres');
  assert.deepEqual(highlightTexts(row.atoms[1]), ['er', 'er']);
});

test('reversed all-mode finds nothing for an entry still holding the pattern, since cutting takes every one', async () => {
  sameVisible(await visible(LIB, add('s', all)), []);
  sameVisible(await visible(LIB, add('s', one)), [['dogs', 'dogss']]);
});

test('the pattern is normalized, so case and spacing in the input do not matter', async () => {
  sameVisible(await visible(ERS, remove(' ER ', one)),
    [['derrieres', 'drieres'], ['drieres', 'dries']]);
});
