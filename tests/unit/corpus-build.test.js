import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus, scopeSourceIds, mergedContributors } from '../../site/src/engine/corpus.js';
import { compileRescoreRules } from '../../site/src/engine/rescore.js';

// rawScore is absent from raw entries; bucketContributors carries it through, so
// it surfaces as `undefined` on rows that weren't rescored — the snapshots spell
// that out, and deepStrictEqual distinguishes it from a missing key.
const wlEntry = (norm, score, { display = null, comment = '' } = {}) =>
  ({ norm, display, score, comment });

// Snapshots assert winner identity via `wordlist.name`; the source objects
// themselves aren't deep-equalled.
const src = (name, rawEntries, { enabled = true, rescoreRules = [] } = {}) =>
  ({ name, dbKey: name, enabled, rescoreRules, rawEntries });

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

test('buildCorpus: one wordlist holding a bare entry and a spelled sibling keeps them separate', () => {
  // Same-list "theirs" + "the IRS" must NOT collapse: the bare entry's wildcard
  // null display only unifies across lists, not with a sibling that proves intent.
  const W = src('W', [
    wlEntry('theirs', 50),
    wlEntry('theirs', 60, { display: 'the IRS' }),
  ]);

  const { entries, byKey } = buildCorpus([W]);

  assert.deepStrictEqual(project(entries), [
    { norm: 'theirs', display: 'the IRS', score: 60, rawScore: undefined, comment: '', source: 'W' },
    { norm: 'theirs', display: 'theirs',  score: 50, rawScore: undefined, comment: '', source: 'W' },
  ]);
  assert.equal(byKey.size, 2);
});

test('buildCorpus: a bare entry in a plain list still unifies with another list\'s spelled variant', () => {
  // Flip side: across lists the bare entry IS a wildcard, so priority-winner
  // Plain lends its score (50) to Rich's spelling and they collapse to one row.
  const Plain = src('Plain', [wlEntry('theirs', 50)]);
  const Rich  = src('Rich',  [wlEntry('theirs', 60, { display: 'the IRS' })]);

  const { entries } = buildCorpus([Plain, Rich]);

  assert.deepStrictEqual(project(entries), [
    { norm: 'theirs', display: 'the IRS', score: 50, rawScore: undefined, comment: '', source: 'Plain' },
  ]);
});

test('buildCorpus: a deliberate lowercase entry (display === norm) keeps its own row, not re-bared', () => {
  // An UPPER-convention file's off-convention lowercase 'ebay' parses rich
  // (display === norm). The resolver must trust that display and never re-bare it,
  // or the entry collapses into another list's 'eBay' and loses its own row.
  const Caps  = src('Caps',  [wlEntry('ebay', 20, { display: 'ebay' })]);
  const Mixed = src('Mixed', [wlEntry('ebay', 40, { display: 'eBay' })]);

  const { entries, byKey } = buildCorpus([Caps, Mixed]);

  assert.deepStrictEqual(project(entries), [
    { norm: 'ebay', display: 'ebay', score: 20, rawScore: undefined, comment: '', source: 'Caps' },
    { norm: 'ebay', display: 'eBay', score: 40, rawScore: undefined, comment: '', source: 'Mixed' },
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

test('buildCorpus: a scoped single source mixes rescored (rawScore kept) and unmatched (rawScore undefined) rows, displays and comments preserved', () => {
  const G = src('Golden', [
    wlEntry('crane', 90, { display: 'CRANE', comment: 'corvid' }),
    wlEntry('delta', 50, { display: 'DELTA' }),
    wlEntry('eagle', 50, { display: 'EAGLE', comment: 'raptor' }),
  ], { rescoreRules: [{ input: '50', length: '', output: '75', note: '' }] });
  compileRescoreRules(G);

  const { entries } = buildCorpus([G]);

  assert.deepStrictEqual(project(entries), [
    { norm: 'crane', display: 'CRANE', score: 90, rawScore: undefined, comment: 'corvid', source: 'Golden' },
    { norm: 'delta', display: 'DELTA', score: 75, rawScore: 50,        comment: '',       source: 'Golden' },
    { norm: 'eagle', display: 'EAGLE', score: 75, rawScore: 50,        comment: 'raptor', source: 'Golden' },
  ]);
});

test('mergedContributors: sourceIds lists every enabled contributing source, priority order', () => {
  const A = src('A', [wlEntry('able', 30), wlEntry('crane', 10)]);
  const B = src('B', [wlEntry('crane', 88), wlEntry('delta', 20)]);
  const built = [A, B];

  assert.deepStrictEqual(mergedContributors('crane', null, built).sourceIds, ['A', 'B']);
  assert.deepStrictEqual(mergedContributors('able', null, built).sourceIds, ['A']);
  assert.deepStrictEqual(mergedContributors('delta', null, built).sourceIds, ['B']);
});

test('mergedContributors: sourceIds is display-aware — a spelled variant lists only the lists that spell it that way', () => {
  const C = src('C', [wlEntry('eagle', 50, { display: 'EAGLE' })]);
  const D = src('D', [
    wlEntry('eagle', 60, { display: 'Eagle' }),
    wlEntry('eagle', 70, { display: 'EAGLE' }),
  ]);
  const built = [C, D];

  assert.deepStrictEqual(mergedContributors('eagle', 'Eagle', built).sourceIds, ['D']);
  assert.deepStrictEqual(mergedContributors('eagle', 'EAGLE', built).sourceIds, ['C', 'D']);
});

test('mergedContributors: a bare ambient contributor still counts toward a spelled row', () => {
  const Plain = src('Plain', [wlEntry('theirs', 50)]);
  const Rich  = src('Rich',  [wlEntry('theirs', 60, { display: 'the IRS' })]);

  assert.deepStrictEqual(mergedContributors('theirs', 'the IRS', [Plain, Rich]).sourceIds, ['Plain', 'Rich']);
});

test('mergedContributors: a disabled source never contributes', () => {
  const A = src('A', [wlEntry('crane', 10)]);
  const B = src('B', [wlEntry('crane', 20)], { enabled: false });

  assert.deepStrictEqual(mergedContributors('crane', null, [A, B]).sourceIds, ['A']);
});

test('mergedContributors: activeIds is the winner alone when it supplies the comment', () => {
  const A = src('A', [wlEntry('crane', 10, { comment: 'a-crane' })]);
  const B = src('B', [wlEntry('crane', 88, { comment: 'b-crane' })]);

  const { sourceIds, activeIds } = mergedContributors('crane', null, [A, B]);
  assert.deepStrictEqual(sourceIds, ['A', 'B']);
  assert.deepStrictEqual(activeIds, ['A']);
});

test('mergedContributors: activeIds adds the comment fall-through source when the winner has none', () => {
  const A = src('A', [wlEntry('crane', 10)]);
  const B = src('B', [wlEntry('crane', 88, { comment: 'b-crane' })]);

  const { sourceIds, activeIds } = mergedContributors('crane', null, [A, B]);
  assert.deepStrictEqual(sourceIds, ['A', 'B']);
  assert.deepStrictEqual(activeIds, ['A', 'B']);
});

test('mergedContributors: a list supplying the shown spelling lights up alongside a bare winner', () => {
  const JK = src('JK', [wlEntry('willnediger', 60)]);                              // bare → score winner
  const WN = src('WN', [wlEntry('willnediger', 50, { display: 'Will Nediger' })]); // supplies the spelling

  const { sourceIds, activeIds } = mergedContributors('willnediger', 'Will Nediger', [JK, WN]);
  assert.deepStrictEqual(sourceIds, ['JK', 'WN']);
  assert.deepStrictEqual(activeIds, ['JK', 'WN']);
});

test('mergedContributors: a bare lower-priority duplicate shows nothing and stays muted', () => {
  const WN = src('WN', [wlEntry('willnediger', 60, { display: 'Will Nediger' })]); // winner + spelling
  const JK = src('JK', [wlEntry('willnediger', 50)]);                              // bare, loses

  const { sourceIds, activeIds } = mergedContributors('willnediger', 'Will Nediger', [WN, JK]);
  assert.deepStrictEqual(sourceIds, ['WN', 'JK']);
  assert.deepStrictEqual(activeIds, ['WN']);
});

test('mergedContributors: a lower-priority list spelling the entry the same way stays muted', () => {
  const ME = src('ME', [wlEntry('bonnieclyde', 50, { display: "'03 Bonnie & Clyde", comment: '2002 Jay-Z song' })]);
  const JK = src('JK', [wlEntry('bonnieclyde', 60, { display: "'03 Bonnie & Clyde", comment: '2002 Jay-Z song' })]);

  const { sourceIds, activeIds } = mergedContributors('bonnieclyde', "'03 Bonnie & Clyde", [ME, JK]);
  assert.deepStrictEqual(sourceIds, ['ME', 'JK']);
  assert.deepStrictEqual(activeIds, ['ME']);
});

test('scopeSourceIds: norm-level cross-list set — enabled lists plus the scoped source, never disabled others', () => {
  const A = src('A', [wlEntry('crane', 10), wlEntry('apple', 5)]);
  const B = src('B', [wlEntry('crane', 20)]);
  const C = src('C', [wlEntry('crane', 30), wlEntry('apple', 9)], { enabled: false });
  const built = [A, B, C];

  assert.deepStrictEqual(scopeSourceIds('crane', built, 'A'), ['A', 'B']);
  assert.deepStrictEqual(scopeSourceIds('apple', built, 'A'), ['A']);

  assert.deepStrictEqual(scopeSourceIds('crane', built, 'C'), ['A', 'B', 'C']);
  assert.deepStrictEqual(scopeSourceIds('apple', built, 'C'), ['A', 'C']);
});

test('buildCorpus: an empty source list yields an empty corpus', () => {
  const { entries, sourceCounts, byNorm, byKey } = buildCorpus([]);
  assert.deepStrictEqual(entries, []);
  assert.deepStrictEqual(sourceCounts, []);
  assert.equal(byNorm.size, 0);
  assert.equal(byKey.size, 0);
});
