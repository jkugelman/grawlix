import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus } from '../../site/src/engine/corpus.js';
import { compileRescoreRules } from '../../site/src/engine/rescore.js';

// rawScore is absent from raw entries; bucketContributors carries it through, so
// it surfaces as `undefined` on rows that weren't rescored — the snapshots spell
// that out, and deepStrictEqual distinguishes it from a missing key.
const wlEntry = (norm, score, { display = null, comment = '' } = {}) =>
  ({ norm, display, score, comment });

// Snapshots assert winner identity via `wordlist.name`; the source objects
// themselves aren't deep-equalled.
const src = (name, rawEntries, { enabled = true, rescoreRules = [] } = {}) =>
  ({ name, enabled, rescoreRules, rawEntries });

const project = entries => entries.map(e => ({
  norm: e.norm, display: e.display, score: e.score,
  rawScore: e.rawScore, comment: e.comment, source: e.wordlist.name,
}));

const counts = sourceCounts => sourceCounts.map(s => [s.wordlist.name, s.count]);

test('buildCorpus: multi-source priority, dedup, sort, and source counts', () => {
  // 'crane' gives higher-priority A the LOWER score (10 vs B's 88) so a
  // score-wins regression flips the winner; A's 'bird' is deliberately
  // comment-less so the row must borrow B's comment.
  const A = src('A', [
    wlEntry('able', 30),
    wlEntry('bird', 40),
    wlEntry('crane', 10, { comment: 'a-crane' }),
  ]);
  const B = src('B', [
    wlEntry('bird', 99, { comment: 'b-bird' }),
    wlEntry('delta', 20),
    wlEntry('crane', 88),
  ]);

  const { entries, sourceCounts, byNorm, byKey } = buildCorpus([A, B]);

  assert.deepStrictEqual(project(entries), [
    { norm: 'able',  display: null, score: 30, rawScore: undefined, comment: '',        source: 'A' },
    { norm: 'bird',  display: null, score: 40, rawScore: undefined, comment: 'b-bird',  source: 'A' },
    { norm: 'crane', display: null, score: 10, rawScore: undefined, comment: 'a-crane', source: 'A' },
    { norm: 'delta', display: null, score: 20, rawScore: undefined, comment: '',        source: 'B' },
  ]);

  // Winner-deduped: A contributes 3 winning rows, B only the lone 'delta'.
  assert.deepStrictEqual(counts(sourceCounts), [['A', 3], ['B', 1]]);

  assert.equal(byNorm.size, 4);
  assert.equal(byKey.size, 4);
  assert.equal(byNorm.get('bird'), entries[1]);
});

test('buildCorpus: a scoped single source still builds even when disabled', () => {
  const G = src('G', [
    wlEntry('zebra', 12),
    wlEntry('apple', 7, { comment: 'fruit' }),
  ], { enabled: false });

  const { entries, sourceCounts } = buildCorpus([G]);

  assert.deepStrictEqual(project(entries), [
    { norm: 'apple', display: null, score: 7,  rawScore: undefined, comment: 'fruit', source: 'G' },
    { norm: 'zebra', display: null, score: 12, rawScore: undefined, comment: '',      source: 'G' },
  ]);
  assert.deepStrictEqual(counts(sourceCounts), [['G', 2]]);
});

test('buildCorpus: two display variants of one norm survive as separate rows', () => {
  // 'Eagle' sorts before 'EAGLE' under localeCompare (collation), the reverse of
  // code-unit order — the snapshot's row order looks wrong without this.
  const C = src('C', [wlEntry('eagle', 50, { display: 'EAGLE', comment: 'caps' })]);
  const D = src('D', [
    wlEntry('eagle', 60, { display: 'Eagle' }),
    wlEntry('eagle', 70, { display: 'EAGLE', comment: 'd-caps' }),
  ]);

  const { entries, byKey } = buildCorpus([C, D]);

  assert.deepStrictEqual(project(entries), [
    { norm: 'eagle', display: 'Eagle', score: 60, rawScore: undefined, comment: '',     source: 'D' },
    { norm: 'eagle', display: 'EAGLE', score: 50, rawScore: undefined, comment: 'caps', source: 'C' },
  ]);
  assert.equal(byKey.size, 2);
});

test('buildCorpus: a rescored score feeds the merge and wins; rawScore keeps the original', () => {
  const E = src('E', [wlEntry('delta', 5)], { rescoreRules: [{ input: '0-9', output: '80' }] });
  compileRescoreRules(E);
  const F = src('F', [wlEntry('delta', 50)]);

  const { entries, sourceCounts } = buildCorpus([E, F]);

  assert.deepStrictEqual(project(entries), [
    { norm: 'delta', display: null, score: 80, rawScore: 5, comment: '', source: 'E' },
  ]);
  assert.deepStrictEqual(counts(sourceCounts), [['E', 1], ['F', 0]]);
});

test('buildCorpus: an empty source list yields an empty corpus', () => {
  const { entries, sourceCounts, byNorm, byKey } = buildCorpus([]);
  assert.deepStrictEqual(entries, []);
  assert.deepStrictEqual(sourceCounts, []);
  assert.equal(byNorm.size, 0);
  assert.equal(byKey.size, 0);
});
