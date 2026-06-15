import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortGroups } from '../../site/src/engine/group-sort.js';
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
  const sorted = sortGroups([freshGroup()], 'entry', 'asc', GROUP_STACK);
  assert.deepEqual(norms(sorted[0]), ['apple', 'mango', 'zebra']);
});

// Regression: a filter must not leave the surviving chains in bucketize order. The
// designed within-group order holds whether or not a score range is active, so a
// filter-gated chain sort (the kind that reads the unfiltered bucketize order) is a
// silent reorder — invisible until a user filters a multi-chain group.
test('sortGroups: chains stay in the designed seed order under a score filter', () => {
  const filtered = applyScoreRangeToRows([freshGroup()], parseRange('40-100'), true);
  const sorted = sortGroups(filtered, 'entry', 'asc', GROUP_STACK);
  assert.deepEqual(norms(sorted[0]), ['mango', 'zebra']); // not ['zebra','mango']
});
