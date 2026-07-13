import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst, highlightTexts } from './harness.js';

const LIB = ['cat', 'cats', 'scat', 'cot', 'dog', 'cog', 'bell', 'teen'];
const REPLACE_LIB = ['cat', 'cats', 'scat', 'dog', 'dogs', 'bell', 'bel', 'teen', 'ten'];
const regex = (pattern, p = {}) => [{ tool: 'regex', params: { pattern, ...p } }];
const kinds = atom => (atom.highlights || []).map(r => r.kind);

test('a pattern filters entries by regular expression', async () => {
  sameVisible(await visible(LIB, regex('^c.t$')), ['cat', 'cot']);
});

test('matching is case-insensitive', async () => {
  sameVisible(await visible(LIB, regex('^CAT$')), ['cat']);
});

test('the pattern is not lowercased — `\\D` survives as non-digit', async () => {
  assert.equal((await visible(LIB, regex('^\\D+$'))).length, 8);
});

test('the pattern matches against both the stripped norm and the verbatim display', async () => {
  const lib = ['the IRS', 'Theirs', 'Helen of Troy'];
  sameVisible(await visible(lib, regex('^theirs$')), ['the IRS', 'Theirs']);
  sameVisible(await visible(lib, regex(' of ')), ['Helen of Troy']);
});

test('mode=full anchors the pattern to the entry boundaries', async () => {
  sameVisible(await visible(LIB, regex('cat')), ['cat', 'cats', 'scat']);
  sameVisible(await visible(LIB, regex('cat', { mode: 'full' })), ['cat']);
});

test('mode=word keeps matches aligned to word boundaries', async () => {
  const lib = ['cat', 'cat food', 'copycat food', 'scat'];
  sameVisible(await visible(lib, regex('c.t', { mode: 'word' })), ['cat', 'cat food']);
});

test('mode=span keeps only matches that cross a word break', async () => {
  const lib = ['data table', 'database', 'the IRS'];
  sameVisible(await visible(lib, regex('at.', { mode: 'span' })), ['data table']);
});

test('an empty pattern is inert — the full merged view passes through', async () => {
  assert.equal((await visible(LIB, regex(''))).length, 8);
});

test('an invalid pattern is inert rather than matching nothing', async () => {
  assert.equal((await visible(LIB, regex('('))).length, 8);
});

test('a pattern with no match leaves the view empty', async () => {
  sameVisible(await visible(LIB, regex('zzz')), []);
});

test('a filled replacement rewrites matched entries; non-entry outputs drop', async () => {
  // `scat` matches but its output `sdog` is not a wordlist entry, so it drops.
  sameVisible(await visible(REPLACE_LIB, regex('cat', { replace: 'dog' })),
    [['cat', 'dog'], ['cats', 'dogs']]);
});

test('`$1` in the replacement backreferences a capture group', async () => {
  sameVisible(await visible(REPLACE_LIB, regex('(.)\\1', { replace: '$1' })),
    [['bell', 'bel'], ['teen', 'ten']]);
});

test('mode=full constrains a replacement to entries that match in full', async () => {
  sameVisible(await visible(REPLACE_LIB, regex('cat', { replace: 'dog', mode: 'full' })),
    [['cat', 'dog']]);
});

test('filter highlights each literal run of an auto-segmented pattern, splitting at a wildcard', async () => {
  const hl = ['united', 'unused', 'cot', 'cod'];
  const runs = await run(hl, regex('^un.+ed$'));
  assert.deepEqual(highlightTexts(rowByFirst(runs.rows, 'united').atoms[0]), ['un', 'ed']);

  const wild = await run(hl, regex('c.t'));
  assert.deepEqual(highlightTexts(rowByFirst(wild.rows, 'cot').atoms[0]), ['c', 't']);
});

test('every match in an entry is highlighted, not just the first', async () => {
  const { rows } = await run(['banana'], regex('na'));
  assert.deepEqual(highlightTexts(rowByFirst(rows, 'banana').atoms[0]), ['na', 'na']);
});

test("filter colors the user's own capture groups when the pattern has them", async () => {
  const { rows } = await run(['united', 'unused', 'cot', 'cod'], regex('^(c)o(d)$'));
  assert.deepEqual(highlightTexts(rowByFirst(rows, 'cod').atoms[0]), ['c', 'd']);
});

test('replace colors both capture groups on the input and their swapped echoes on the output', async () => {
  const { rows } = await run(['cats', 'cast', 'arc', 'car'], regex('(t)(s)$', { replace: '$2$1' }));
  const row = rowByFirst(rows, 'cats');
  assert.deepEqual([row.atoms[1].wlEntry.norm], ['cast']);
  assert.deepEqual(highlightTexts(row.atoms[0]), ['t', 's']);
  assert.deepEqual(highlightTexts(row.atoms[1]), ['s', 't']);
  assert.deepEqual(kinds(row.atoms[0]), ['search:0', 'search:1']);
  assert.deepEqual(kinds(row.atoms[1]), ['search:1', 'search:0']);
});
