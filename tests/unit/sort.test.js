import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortGroups, composeSortAxis, compareItems, sortAxes } from '../../site/src/engine/sort.js';
import { applyScoreRangeToRows, cacheGroupStats } from '../../site/src/engine/executor.js';
import { parseRange } from '../../site/src/engine/range.js';

const GROUP_STACK = [{
  kind: () => 'group', isInert: () => false,
  def: { group: { columns: [], anchorLabel: null } },
}];
const chain = (norm, score) => ({ atoms: [{ wlEntry: { norm, display: norm, score } }] });
const norms = g => g.chains.map(c => c.atoms[0].wlEntry.norm);

// Chains seeded in the executor's bucketize order (tail-score desc), which differs
// from the designed Entry order (seed-norm asc) so the two are distinguishable.
function freshGroup() {
  const g = { key: 'X', anchor: null, chains: [chain('zebra', 90), chain('mango', 50), chain('apple', 10)] };
  cacheGroupStats(g);
  return g;
}

test('sortGroups: within-group chains take the designed Entry seed order (norm asc)', () => {
  const sorted = sortGroups([freshGroup()], [{ key: 'entry', dir: 'asc' }], GROUP_STACK);
  assert.deepEqual(norms(sorted[0]), ['apple', 'mango', 'zebra']);
});

// Regression: a filter must not leave the surviving chains in bucketize order. The
// designed within-group order holds whether or not a score range is active, so a
// filter-gated chain sort (the kind that reads the unfiltered bucketize order) is a
// silent reorder — invisible until a user filters a multi-chain group.
test('sortGroups: chains stay in the designed seed order under a score filter', () => {
  const filtered = applyScoreRangeToRows([freshGroup()], parseRange('40-100'), true);
  const sorted = sortGroups(filtered, [{ key: 'entry', dir: 'asc' }], GROUP_STACK);
  assert.deepEqual(norms(sorted[0]), ['mango', 'zebra']); // not ['zebra','mango']
});

test('single Entry sort: a multi-word base leads its inflections, collated on display not stripped norm', () => {
  // Regression: norm "latherup" collates after "lathersup", burying the base at
  // the family tail; the display's space sorts ahead of any letter, so it leads.
  const e = display => ({ norm: display.replace(/[^a-z]/g, ''), display, score: 50, family: 'lather up' });
  const rows = [e('lathers up'), e('lathering up'), e('lather up'), e('lathered up')];
  const axis = composeSortAxis([{ key: 'entry', dir: 'asc' }], sortAxes('single', null));
  const out = rows.slice().sort((a, b) => compareItems(a, b, axis, 'asc')).map(r => r.display);
  assert.deepEqual(out, ['lather up', 'lathered up', 'lathering up', 'lathers up']);
});

const AXES = {
  count:  { primary: x => x.count, tiebreakers: [{ project: x => x.k, dir: 'asc' }] },
  letters:{ primary: x => x.letters, tiebreakers: [{ project: x => x.count, dir: 'desc' }] },
};

test('composeSortAxis: a single-entry list reproduces the bare axis', () => {
  const axis = composeSortAxis([{ key: 'count', dir: 'desc' }], AXES);
  assert.equal(axis.primary, AXES.count.primary);
  assert.deepEqual(axis.tiebreakers, AXES.count.tiebreakers);
});

test('composeSortAxis: later picks ride as fixed-direction tiebreakers before the primary built-ins', () => {
  const axis = composeSortAxis([{ key: 'count', dir: 'desc' }, { key: 'letters', dir: 'asc' }], AXES);
  assert.equal(axis.primary, AXES.count.primary);
  assert.equal(axis.tiebreakers[0].dir, 'asc');
  assert.equal(axis.tiebreakers[0].project, AXES.letters.primary);
  assert.deepEqual(axis.tiebreakers.slice(1), AXES.count.tiebreakers);
});

test('composeSortAxis: Count desc → Letters asc orders a tied-count cluster by letters', () => {
  const rows = [
    { count: 5, letters: 'zzz', k: 'a' },
    { count: 9, letters: 'aaa', k: 'b' },
    { count: 5, letters: 'aaa', k: 'c' },
  ];
  const axis = composeSortAxis([{ key: 'count', dir: 'desc' }, { key: 'letters', dir: 'asc' }], AXES);
  const out = rows.slice().sort((a, b) => compareItems(a, b, axis, 'desc')).map(r => r.k);
  assert.deepEqual(out, ['b', 'c', 'a']); // count 9 first, then count-5 by letters asc (aaa<zzz)
});

test('composeSortAxis: unknown keys are dropped; an all-unknown list is null', () => {
  const axis = composeSortAxis([{ key: 'nope', dir: 'asc' }, { key: 'count', dir: 'asc' }], AXES);
  assert.equal(axis.primary, AXES.count.primary); // 'nope' filtered, count promoted to primary
  assert.equal(composeSortAxis([{ key: 'nope', dir: 'asc' }], AXES), null);
  assert.equal(composeSortAxis([], AXES), null);
});
