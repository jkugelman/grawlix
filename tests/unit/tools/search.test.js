import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.js';

const LIB = ['untested', 'united', 'retested', 'cat', 'cot', 'cart', 'cats', 'scat'];
const search = (pattern, p = {}) => [{ tool: 'search', params: { pattern, ...p } }];

test('a literal query matches anywhere in the entry', async () => {
  sameVisible(await visible(LIB, search('test')), ['retested', 'untested']);
});

test('`*` matches any run of characters', async () => {
  sameVisible(await visible(LIB, search('un*ed')), ['united', 'untested']);
});

test('`?` matches exactly one character', async () => {
  sameVisible(await visible(LIB, search('c?t')), ['cat', 'cats', 'cot', 'scat']);
});

test('`#` matches any consonant and `@` matches any vowel', async () => {
  const lib = ['bad', 'bed', 'bid', 'bod', 'bud', 'byd'];
  sameVisible(await visible(lib, search('b@d')), ['bad', 'bed', 'bid', 'bod', 'bud']);
  sameVisible(await visible(lib, search('b#d')), ['byd']);
});

test('`[abc]` matches any listed letter and `[^abc]` matches any unlisted letter', async () => {
  const lib = ['bat', 'cat', 'rat', 'hat', 'mat'];
  sameVisible(await visible(lib, search('[bcr]at')), ['bat', 'cat', 'rat']);
  sameVisible(await visible(lib, search('[^bcr]at')), ['hat', 'mat']);
});

test('whole-word anchors the query to the entry boundaries', async () => {
  sameVisible(await visible(LIB, search('cat')), ['cat', 'cats', 'scat']);
  sameVisible(await visible(LIB, search('cat', { 'whole-word': true })), ['cat']);
});

test('`*` spans separators, so a prefix matches a multi-word entry even when whole-word', async () => {
  const lib = ['A Book from the Sky', 'abacus'];
  sameVisible(await visible(lib, search('abook*')), ['A Book from the Sky']);
  sameVisible(await visible(lib, search('abook*', { 'whole-word': true })), ['A Book from the Sky']);
});

test('whole-word forgives separators at the entry edges, not just between letters', async () => {
  const lib = ['Yahoo!', 'U.S.A.', 'scat'];
  sameVisible(await visible(lib, search('yahoo', { 'whole-word': true })), ['Yahoo!']);
  sameVisible(await visible(lib, search('usa', { 'whole-word': true })), ['U.S.A.']);
});

test('`?` fills exactly one non-whitespace character — letter or symbol — never a space or nothing', async () => {
  const lib = ['hisc', 'hi-c', 'hi c', 'hic'];
  sameVisible(await visible(lib, search('hi?c')), ['hisc', 'hi-c']);
});

test('whole-word matches an entry whose letters equal the query across its separators', async () => {
  const lib = ['the IRS', 'Theirs', 'theirsy'];
  sameVisible(await visible(lib, search('theirs', { 'whole-word': true })), ['the IRS', 'Theirs']);
});

test('an empty query is inert — the full merged view passes through', async () => {
  assert.equal((await visible(LIB, search(''))).length, 8);
});

test('a query with no match leaves the view empty', async () => {
  sameVisible(await visible(LIB, search('zzz')), []);
});

test('the matched span carries a highlight range, split at wildcard boundaries', async () => {
  const { rows } = await run(LIB, search('test'));
  assert.deepEqual(highlightTexts(rowByFirst(rows, 'untested').atoms[0]), ['test']);

  const wild = await run(LIB, search('c?t'));
  assert.deepEqual(highlightTexts(rowByFirst(wild.rows, 'cot').atoms[0]), ['c', 't']);
});

// Search-replace needs the output words present too — the transform keeps a
// rewritten entry only when it is itself a wordlist entry.
const REPLACE_LIB = ['cat', 'cats', 'scat', 'dog', 'dogs'];

test('a filled replacement rewrites matched entries as a transform; non-entry outputs drop', async () => {
  // `scat` matches but its output `sdog` is not a wordlist entry, so it drops.
  sameVisible(await visible(REPLACE_LIB, search('cat', { replace: 'dog' })),
    [['cat', 'dog'], ['cats', 'dogs']]);
});

test('whole-word constrains a replacement to entries that match in full', async () => {
  sameVisible(await visible(REPLACE_LIB, search('cat', { replace: 'dog', 'whole-word': true })),
    [['cat', 'dog']]);
});

test('replace highlights the matched span in and the replacement out, same color', async () => {
  const { rows } = await run(REPLACE_LIB, search('cat', { replace: 'dog' }));
  const row = rowByFirst(rows, 'cats');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['cat']);
  assert.deepEqual(highlightTexts(row.atoms[1]), ['dog']);
  assert.equal(row.atoms[0].highlights[0].kind, row.atoms[1].highlights[0].kind);
});
