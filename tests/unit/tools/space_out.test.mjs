import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { visible, sameVisible, run, rowByFirst, atomWord } from './harness.mjs';

const corpus = freqs => setUnigramCorpus(freqs);
const splitsOf = (rows, first) =>
  rows.filter(r => atomWord(r.atoms[0]) === first).map(r => atomWord(r.atoms[1]));

test('picks the highest-likelihood split among multiple valid alternatives', async () => {
  corpus({ wonder: -2, land: -2, won: -10, derland: -10 });
  const { rows } = await run(['wonderland', 'wonder', 'land', 'won', 'derland'],
    [{ tool: 'space_out' }]);
  assert.deepEqual(splitsOf(rows, 'wonderland'), ['wonder land']);
});

test('passes single-word entries through when no split improves on the whole word', async () => {
  corpus({ dog: -7, do: -5, d: -10 });
  const { rows } = await run(['dog'], [{ tool: 'space_out' }]);
  sameVisible(rows.map(r => atomWord(r.atoms[0])), ['dog']);
  assert.equal(splitsOf(rows, 'dog')[0], 'dog');
  assert.equal(rowByFirst(rows, 'dog').atoms.length, 2);
});

test('renders the synthetic split entry with the input entry score', async () => {
  corpus({ a: -3, barrel: -11, of: -3, laughs: -10, barr: -13, elo: -14, fla: -12 });
  const { rows } = await run(
    [{ entry: 'abarreloflaughs', score: 80 }, 'barrel', 'laughs'], [{ tool: 'space_out' }]);
  const out = rowByFirst(rows, 'abarreloflaughs').atoms[1];
  assert.equal(atomWord(out), 'a barrel of laughs');
  assert.equal(out.wlEntry.score, 80);
});

test('skips 3+ letter parts that are not in the merged wordlist', async () => {
  corpus({ abb: -3, arr: -3 });
  sameVisible(await visible(['abbarr'], [{ tool: 'space_out' }]), ['abbarr']);
});

test('rejects splits made of legit-but-low-frequency parts by score', async () => {
  corpus({ a: -3, barrel: -11, of: -3, laughs: -10, barr: -19, elo: -19, fla: -16, ughs: -19 });
  const { rows } = await run(
    ['abarreloflaughs', 'barrel', 'laughs', 'barr', 'elo', 'fla', 'ughs'], [{ tool: 'space_out' }]);
  assert.equal(atomWord(rowByFirst(rows, 'abarreloflaughs').atoms[1]), 'a barrel of laughs');
});

test('uses the real wordlist metadata when the split form is itself an entry', async () => {
  corpus({ ice: -7, cream: -7 });
  const { rows } = await run(
    [{ entry: 'ice cream', score: 60, comment: 'a frozen dessert' }, 'ice', 'cream'],
    [{ tool: 'space_out' }]);
  const out = rowByFirst(rows, 'ice cream').atoms[1].wlEntry;
  assert.equal(atomWord({ wlEntry: out }), 'ice cream');
  assert.equal(out.score, 60);
  assert.equal(out.comment, 'a frozen dessert');
});

test('a passthrough atom carries the real entry score and comment', async () => {
  corpus({ dog: -7, do: -5, d: -10 });
  const { rows } = await run([{ entry: 'dog', score: 45, comment: 'canid' }], [{ tool: 'space_out' }]);
  const out = rowByFirst(rows, 'dog').atoms[1].wlEntry;
  assert.equal(out.score, 45);
  assert.equal(out.comment, 'canid');
});

test('never splits in the middle of a digit run', async () => {
  corpus({ '99': -5, '9': -3, problems: -7 });
  const { rows } = await run(['99problems', 'problems'], [{ tool: 'space_out' }]);
  assert.deepEqual(splitsOf(rows, '99problems'), ['99 problems']);
});

test('Splits=One returns exactly the top result; Splits=Many surfaces near-tie alternates', async () => {
  corpus({ abc: -5, def: -5, abcd: -6, ef: -7 });
  const lib = ['abcdef', 'abc', 'def', 'abcd'];

  const one = await run(lib, [{ tool: 'space_out', params: { splits: 'one' } }]);
  assert.deepEqual(splitsOf(one.rows, 'abcdef'), ['abc def']);

  const many = await run(lib, [{ tool: 'space_out', params: { splits: 'many' } }]);
  assert.deepEqual([...new Set(splitsOf(many.rows, 'abcdef'))].sort(), ['abc def', 'abcd ef']);
});
