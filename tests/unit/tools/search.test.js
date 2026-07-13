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

test('`#` matches any consonant and `@` matches any vowel (Y is a vowel)', async () => {
  const lib = ['bad', 'bed', 'bid', 'bod', 'bud', 'byd', 'bzd'];
  sameVisible(await visible(lib, search('b@d')), ['bad', 'bed', 'bid', 'bod', 'bud', 'byd']);
  sameVisible(await visible(lib, search('b#d')), ['bzd']);
});

test('`[abc]` matches any listed letter and `[^abc]` matches any unlisted letter', async () => {
  const lib = ['bat', 'cat', 'rat', 'hat', 'mat'];
  sameVisible(await visible(lib, search('[bcr]at')), ['bat', 'cat', 'rat']);
  sameVisible(await visible(lib, search('[^bcr]at')), ['hat', 'mat']);
});

test('mode=full anchors the query to the entry boundaries', async () => {
  sameVisible(await visible(LIB, search('cat')), ['cat', 'cats', 'scat']);
  sameVisible(await visible(LIB, search('cat', { mode: 'full' })), ['cat']);
});

test('`*` spans separators, so a prefix matches a multi-word entry even when mode=full', async () => {
  const lib = ['A Book from the Sky', 'abacus'];
  sameVisible(await visible(lib, search('abook*')), ['A Book from the Sky']);
  sameVisible(await visible(lib, search('abook*', { mode: 'full' })), ['A Book from the Sky']);
});

test('mode=full forgives separators at the entry edges, not just between letters', async () => {
  const lib = ['Yahoo!', 'U.S.A.', 'scat'];
  sameVisible(await visible(lib, search('yahoo', { mode: 'full' })), ['Yahoo!']);
  sameVisible(await visible(lib, search('usa', { mode: 'full' })), ['U.S.A.']);
});

test('mode=word keeps matches aligned to word boundaries', async () => {
  const lib = ['cat', 'cat food', 'copycat food', 'scat'];
  sameVisible(await visible(lib, search('cat', { mode: 'word' })), ['cat', 'cat food']);
});

test('mode=word may cover several complete words', async () => {
  const lib = ['cat food bowl', 'tomcat food bowl'];
  sameVisible(await visible(lib, search('catfood', { mode: 'word' })), ['cat food bowl']);
});

test('mode=span keeps only matches that cross a word break', async () => {
  const lib = ['tsar', "it's a rarity", 'satsang'];
  sameVisible(await visible(lib, search('tsa', { mode: 'span' })), ["it's a rarity"]);
});

test('mode=span rejects a break the match merely touches at its edge', async () => {
  const lib = ['the IRS', 'theirs'];
  sameVisible(await visible(lib, search('the', { mode: 'span' })), []);
  sameVisible(await visible(lib, search('heir', { mode: 'span' })), ['the IRS']);
});

test('a hyphen counts as a word break; an apostrophe does not', async () => {
  const lib = ['x-ray', "isn't"];
  sameVisible(await visible(lib, search('xr', { mode: 'span' })), ['x-ray']);
  sameVisible(await visible(lib, search('nt', { mode: 'span' })), []);
});

test('`?` fills exactly one non-whitespace character — letter or symbol — never a space or nothing', async () => {
  const lib = ['hisc', 'hi-c', 'hi c', 'hic'];
  sameVisible(await visible(lib, search('hi?c')), ['hisc', 'hi-c']);
});

test('mode=full matches an entry whose letters equal the query across its separators', async () => {
  const lib = ['the IRS', 'Theirs', 'theirsy'];
  sameVisible(await visible(lib, search('theirs', { mode: 'full' })), ['the IRS', 'Theirs']);
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

test('mode=full constrains a replacement to entries that match in full', async () => {
  sameVisible(await visible(REPLACE_LIB, search('cat', { replace: 'dog', mode: 'full' })),
    [['cat', 'dog']]);
});

test('mode=span constrains a replacement to break-crossing matches', async () => {
  // "heir" spans the break in "the IRS" but sits whole inside a word of
  // "to heir is human", so only the first entry is rewritten.
  const lib = ['the IRS', 'theirs', 'to heir is human'];
  sameVisible(await visible(lib, search('heir', { replace: 'x', unlisted: true, mode: 'span' })),
    [['the IRS', 'txS']]);
});

test('replace highlights the matched span in and the replacement out, same color', async () => {
  const { rows } = await run(REPLACE_LIB, search('cat', { replace: 'dog' }));
  const row = rowByFirst(rows, 'cats');
  assert.deepEqual(highlightTexts(row.atoms[0]), ['cat']);
  assert.deepEqual(highlightTexts(row.atoms[1]), ['dog']);
  assert.equal(row.atoms[0].highlights[0].kind, row.atoms[1].highlights[0].kind);
});
