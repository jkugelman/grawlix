import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareValues, compareItems, columnSortAxes, nextSortForColumn,
  rowMinScore, rowMaxScore,
} from '../../site/src/ui/entries-table.js';

test('compareValues: numbers compare numerically (ascending), not lexically', () => {
  assert.ok(compareValues(2, 10) < 0);   // lexical would put "10" before "2"
  assert.ok(compareValues(10, 2) > 0);
  assert.equal(compareValues(5, 5), 0);
  assert.ok(compareValues(-3, 1) < 0);
});

test('compareValues: strings use localeCompare, NOT codepoint order', () => {
  // Codepoint puts 'Z' (90) before 'a' (97); localeCompare orders 'a' before 'Z'.
  // Get this wrong and the entries table silently sorts ASCII-cased, not alphabetical.
  assert.ok(compareValues('Z', 'a') > 0);
  assert.ok(compareValues('apple', 'banana') < 0);
  assert.ok(compareValues('banana', 'apple') > 0);
  assert.equal(compareValues('cat', 'cat'), 0);
});

test('compareValues: arrays compare element-by-element recursively', () => {
  assert.equal(compareValues([1, 2, 3], [1, 2, 3]), 0);
  assert.ok(compareValues([1, 2], [1, 3]) < 0);
  assert.ok(compareValues([2, 0], [1, 9]) > 0);
});

test('compareValues: a shorter array is a prefix that sorts before its extension', () => {
  assert.ok(compareValues([1, 2], [1, 2, 3]) < 0);
  assert.ok(compareValues([1, 2, 3], [1, 2]) > 0);
  assert.equal(compareValues([], []), 0);
  assert.ok(compareValues([], [1]) < 0);
});

test('compareValues: nested arrays recurse', () => {
  assert.ok(compareValues([[1, 1], [2]], [[1, 1], [3]]) < 0);
  assert.ok(compareValues([['a'], ['z']], [['a'], ['a']]) > 0);
});

test('compareValues: arrays of strings use the locale string compare on elements', () => {
  assert.ok(compareValues(['a', 'Z'], ['a', 'a']) > 0);
});

test('compareValues: null/undefined are NOT special-cased — they stringify and locale-compare', () => {
  // No null-first / null-last placement: the fallthrough stringifies, so
  // String(null)='null', String(undefined)='undefined', and 'null' < 'undefined'.
  // A guard that "moved nulls last" would silently reorder these.
  assert.ok(compareValues(null, undefined) < 0);
  assert.ok(compareValues(undefined, null) > 0);
  assert.equal(compareValues(null, null), 0);
  assert.equal(compareValues(undefined, undefined), 0);
});

test('compareValues: a number vs null falls to the string branch (stringified compare)', () => {
  // Not both numbers => String(5)='5' vs 'null'; '5' < 'null' under locale.
  assert.ok(compareValues(5, null) < 0);
  assert.ok(compareValues(null, 5) > 0);
});

// compareItems takes the axis as a param, so these hand-built axes (mirroring
// SORT_AXES shapes) exercise its contract directly without pulling SORT_AXES.
const item = (norm, len, score) => ({ norm, len, score });

const entryAxis = {   // ≈ SORT_AXES.single.entry: norm, then len desc, then score desc
  primary: r => r.norm,
  tiebreakers: [
    { project: r => r.len, dir: 'desc' },
    { project: r => r.score, dir: 'desc' },
  ],
};

test('compareItems: a differing primary key is decided at the primary, ignoring tiebreakers', () => {
  assert.ok(compareItems(item('apple', 5, 1), item('banana', 99, 99), entryAxis, 'asc') < 0);
  assert.ok(compareItems(item('banana', 1, 1), item('apple', 99, 99), entryAxis, 'asc') > 0);
});

test('compareItems: primaryDir flips ONLY the primary; tiebreakers keep their declared direction', () => {
  assert.ok(compareItems(item('apple', 5, 1), item('banana', 5, 1), entryAxis, 'desc') > 0);
  // Same norm => primary ties; the length tiebreaker stays desc in BOTH primary
  // directions, so the longer row leads its tie bucket regardless of asc/desc.
  const long = item('cat', 9, 1), short = item('cat', 3, 1);
  assert.ok(compareItems(long, short, entryAxis, 'asc') < 0);
  assert.ok(compareItems(long, short, entryAxis, 'desc') < 0);
});

test('compareItems: primary ties, first tiebreaker decides', () => {
  assert.ok(compareItems(item('cat', 8, 1), item('cat', 2, 1), entryAxis, 'asc') < 0);
  assert.ok(compareItems(item('cat', 2, 1), item('cat', 8, 1), entryAxis, 'asc') > 0);
});

test('compareItems: primary AND first tiebreaker tie, second tiebreaker decides', () => {
  assert.ok(compareItems(item('cat', 3, 9), item('cat', 3, 1), entryAxis, 'asc') < 0);
  assert.ok(compareItems(item('cat', 3, 1), item('cat', 3, 9), entryAxis, 'asc') > 0);
});

test('compareItems: when every tier ties, the result is 0', () => {
  assert.equal(compareItems(item('cat', 3, 5), item('cat', 3, 5), entryAxis, 'asc'), 0);
});

test('compareItems: the full chain yields a deterministic total order under Array.sort', () => {
  // The audit's key pin: equal-primary rows must still land in a fixed order or
  // they flicker. These three tie on norm; length-desc then score-desc total-order
  // them, so every input permutation must sort to the same sequence.
  const a = item('cat', 5, 1);   // longest len => first
  const b = item('cat', 3, 9);   // len 3, score 9 => before c
  const c = item('cat', 3, 2);   // len 3, score 2 => last
  assert.deepEqual([c, a, b].sort((x, y) => compareItems(x, y, entryAxis, 'asc')), [a, b, c]);
  assert.deepEqual([b, c, a].sort((x, y) => compareItems(x, y, entryAxis, 'asc')), [a, b, c]);
});

test('compareItems: an array-valued primary uses compareValues recursion (group entries shape)', () => {
  const groupAxis = {   // ≈ SORT_AXES.group.entry: primary is an array of entries
    primary: g => g.entries,
    tiebreakers: [{ project: g => g.count, dir: 'desc' }],
  };
  const g1 = { entries: ['a', 'b'], count: 1 };
  const g2 = { entries: ['a', 'c'], count: 9 };
  assert.ok(compareItems(g1, g2, groupAxis, 'asc') < 0);
  const g3 = { entries: ['a', 'b'], count: 9 };
  const g4 = { entries: ['a', 'b'], count: 1 };
  assert.ok(compareItems(g3, g4, groupAxis, 'asc') < 0);   // equal arrays => count-desc
});

test('columnSortAxes: returns candidate keys present in tierAxes, in candidate order', () => {
  assert.deepEqual(columnSortAxes('col-score', { 'min-score': 1, 'max-score': 1 }), ['min-score', 'max-score']);
  assert.deepEqual(columnSortAxes('col-score', { score: 1 }), ['score']);
  assert.deepEqual(columnSortAxes('col-entry', { entry: 1, length: 1 }), ['entry']);
  assert.deepEqual(columnSortAxes('col-len', { length: 1 }), ['length']);
});

test('columnSortAxes: a candidate absent from tierAxes is dropped', () => {
  assert.deepEqual(columnSortAxes('col-score', { entry: 1 }), []);
});

test('columnSortAxes: an unknown column kind yields no axes', () => {
  assert.deepEqual(columnSortAxes('col-nonexistent', { entry: 1, score: 1 }), []);
});

test('columnSortAxes: group-anchor maps to entry/length/score (whichever are live)', () => {
  assert.deepEqual(columnSortAxes('group-anchor', { entry: 1, length: 1, score: 1 }), ['entry', 'length', 'score']);
  assert.deepEqual(columnSortAxes('group-anchor', { length: 1 }), ['length']);
});

test('columnSortAxes: group-entries owns the cluster min/max-score axes', () => {
  assert.deepEqual(
    columnSortAxes('group-entries', { entry: 1, 'min-score': 1, 'max-score': 1 }),
    ['entry', 'min-score', 'max-score'],
  );
});

test('nextSortForColumn: clicking the currently-sorted axis toggles its direction', () => {
  assert.deepEqual(nextSortForColumn(['score'], 'score', 'asc'), { key: 'score', dir: 'desc' });
  assert.deepEqual(nextSortForColumn(['score'], 'score', 'desc'), { key: 'score', dir: 'asc' });
});

test('nextSortForColumn: a multi-axis column toggles whichever owned axis is current', () => {
  assert.deepEqual(
    nextSortForColumn(['score', 'min-score', 'max-score'], 'max-score', 'asc'),
    { key: 'max-score', dir: 'desc' },
  );
});

test('nextSortForColumn: clicking a DIFFERENT column resets to its first owned axis, ascending', () => {
  // curKey not owned here => jump to ownedAxes[0] at asc, discarding curDir.
  assert.deepEqual(nextSortForColumn(['entry'], 'score', 'desc'), { key: 'entry', dir: 'asc' });
  assert.deepEqual(nextSortForColumn(['score', 'min-score'], 'length', 'desc'), { key: 'score', dir: 'asc' });
});

const rowAtom = score => ({ wlEntry: { score } });
const row = (...scores) => ({ atoms: scores.map(rowAtom) });

test('rowMinScore / rowMaxScore: a multi-atom row reduces across every atom', () => {
  const r = row(5, -3, 20, 12);
  assert.equal(rowMinScore(r), -3);
  assert.equal(rowMaxScore(r), 20);
});

test('rowMinScore / rowMaxScore: a single-atom row returns that atom score for both', () => {
  const r = row(7);
  assert.equal(rowMinScore(r), 7);
  assert.equal(rowMaxScore(r), 7);
});

test('rowMinScore / rowMaxScore: an empty-atom row degenerates to the Math.min/max identities', () => {
  // Math.min()=+Infinity, Math.max()=-Infinity: the spread reduction has no
  // empty guard, so callers passing an atomless row get the identities, not 0.
  const r = { atoms: [] };
  assert.equal(rowMinScore(r), Infinity);
  assert.equal(rowMaxScore(r), -Infinity);
});
