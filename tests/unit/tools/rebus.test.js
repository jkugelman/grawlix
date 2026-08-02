import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, visible, sameVisible, rowByFirst, atomWord, highlightTexts } from './harness.js';

const rebus = (strings, symbols) => [{ tool: 'rebus', params: { string: strings, symbol: symbols } }];

test('splices the glyph and emits a synthetic entry, inheriting the input score', async () => {
  const { rows } = await run([{ entry: 'barstool', score: 70 }], rebus(['tool'], ['Ⓣ']));
  const out = rowByFirst(rows, 'barsⓉ').atoms.at(-1).wlEntry;
  assert.equal(atomWord({ wlEntry: out }), 'barsⓉ');
  assert.equal(out.score, 70);
  assert.equal(out.comment, '');     // comment is NOT inherited
  assert.equal(out.wordlist, null);  // synthetic, not a real entry
});

test('the synthetic output score tracks the source entry live, not a frozen copy', async () => {
  const { rows, wordlist } = await run([{ entry: 'barstool', score: 70 }], rebus(['tool'], ['Ⓣ']));
  const out = rowByFirst(rows, 'barsⓉ').atoms.at(-1).wlEntry;
  assert.equal(out.score, 70);
  // The worker's in-place score edit mutates the corpus entry object; a frozen copy
  // would strand a kept pre-search cache on the old value, so the output must follow.
  wordlist.entries.find(e => e.norm === 'barstool').score = 5;
  assert.equal(out.score, 5);
});

test('emits even when the result is absent from the corpus (no existence check)', async () => {
  const { rows, wordlist } = await run([{ entry: 'barstool', score: 70 }], rebus(['tool'], ['Ⓣ']));
  assert.equal(wordlist.norms.has('bars'), false);
  assert.equal(atomWord(rowByFirst(rows, 'barsⓉ').atoms.at(-1)), 'barsⓉ');
});

test('preserves the entry display form — case and spacing', async () => {
  const { rows } = await run([{ entry: 'Tool Box', score: 50 }], rebus(['tool'], ['Ⓣ']));
  assert.equal(atomWord(rowByFirst(rows, 'Ⓣ Box').atoms.at(-1)), 'Ⓣ Box');
});

test('matches on norm, so a find can span word boundaries (spanned separator is consumed)', async () => {
  const { rows } = await run([{ entry: 'too late now', score: 50 }], rebus(['tool'], ['Ⓣ']));
  assert.equal(atomWord(rowByFirst(rows, 'Ⓣate now').atoms.at(-1)), 'Ⓣate now');
});

test('replaces every occurrence in one entry', async () => {
  const { rows } = await run([{ entry: 'voodoo', score: 40 }], rebus(['oo'], ['Ⓞ']));
  assert.equal(atomWord(rowByFirst(rows, 'vⓄdⓄ').atoms.at(-1)), 'vⓄdⓄ');
});

test('the find is a literal — a wildcard normalizes away instead of matching', async () => {
  // Wildcards were removed deliberately: they let the replaced letters vary per
  // entry, and with the input atom hidden nothing says which letters the symbol
  // stands for. toNorm drops the `?`, so `too?` is the literal `too` -- the same
  // rule Remove string follows, where a typed separator is normalized off too.
  const lib = [{ entry: 'tool', score: 1 }, { entry: 'toot', score: 1 }];
  sameVisible(await visible(lib, rebus(['too?'], ['Ⓣ'])), ['Ⓣl', 'Ⓣt']);
});

test('a separator in the find is normalized away, matching the entry either way', async () => {
  // toNorm strips the hyphen from both sides, so a-b and ab find each other.
  for (const typed of ['a-b', 'ab']) {
    const { rows } = await run([{ entry: 'a-b', score: 10 }], rebus([typed], ['Ⓧ']));
    assert.equal(atomWord(rowByFirst(rows, 'Ⓧ').atoms.at(-1)), 'Ⓧ', typed);
  }
});

test('applies all pairs simultaneously — one output carrying every glyph', async () => {
  const { rows } = await run([{ entry: 'toolstar', score: 80 }], rebus(['tool', 'star'], ['Ⓣ', '★']));
  assert.equal(rows.length, 1);
  const out = rowByFirst(rows, 'Ⓣ★').atoms.at(-1).wlEntry;
  assert.equal(atomWord({ wlEntry: out }), 'Ⓣ★');
  assert.equal(out.score, 80);
});

test('overlapping finds resolve leftmost, longer-first', async () => {
  const { rows } = await run([{ entry: 'tool', score: 1 }], rebus(['too', 'tool'], ['②', '④']));
  assert.equal(atomWord(rowByFirst(rows, '④').atoms.at(-1)), '④');
});

test('an incomplete pair (blank find or glyph) is skipped', async () => {
  const a = await visible([{ entry: 'barstool', score: 1 }], rebus(['tool', ''], ['Ⓣ', '★']));
  sameVisible(a, ['barsⓉ']);
  const b = await visible([{ entry: 'barstool', score: 1 }], rebus(['tool'], ['Ⓣ', '★']));
  sameVisible(b, ['barsⓉ']);
});

test('a row with no complete pair is inert — the merged view passes through', async () => {
  const out = await visible(['cat', 'dog'], rebus([''], ['']));
  sameVisible(out, ['cat', 'dog']);
});

test('the row is the output alone, with the glyph highlighted', async () => {
  const { rows } = await run([{ entry: 'barstool', score: 1 }], rebus(['tool'], ['Ⓣ']));
  const atoms = rowByFirst(rows, 'barsⓉ').atoms;
  assert.equal(atoms.length, 1);
  assert.deepEqual(highlightTexts(atoms[0]), ['Ⓣ']);
});
