import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortGroups, composeSortAxis, compareItems, sortAxes, chainRowComparator, chainSortTier } from '../../site/src/engine/sort.js';
import { applyScoreRangeToRows, cacheGroupStats } from '../../site/src/engine/executor.js';
import { parseRange } from '../../site/src/engine/range.js';

const GROUP_STACK = [{
  kind: () => 'group', isInert: () => false,
  def: { group: { columns: [], anchorLabel: null } },
}];
const chain = (norm, score) => ({ atoms: [{ wlEntry: { norm, display: norm, score } }] });
const norms = g => g.chains.map(c => c.atoms[0].wlEntry.norm);

const transformRow = (input = 'plain', output = 'plain') => ({
  kind: () => 'transform', isInert: () => false, def: {},
  inputShown:  () => input  !== 'hidden',
  outputShown: () => output !== 'hidden',
  inputHi:  () => input  === 'highlight',
  outputHi: () => output === 'highlight',
});
const searchRow = () => ({
  kind: () => 'filter', isInert: () => false,
  inputHi: () => true, inverted: () => false, outputHi: () => false,
});

// Chains seeded in the executor's bucketize order (tail-score desc), which differs
// from the designed Entry order (seed-norm asc) so the two are distinguishable.
function freshGroup() {
  const g = { key: 'X', anchor: null, chains: [chain('zebra', 90), chain('mango', 50), chain('apple', 10)] };
  cacheGroupStats(g);
  return g;
}

// The transform tier streams an incremental merge, which equals a from-scratch sort
// only if the comparator is total. Two rows can tie on every chain axis (same first
// display, same tail) yet be distinct — here only the first atom's norm differs — so
// the joined-atom-norm tiebreak must give a stable, input-order-independent order.
test('chainRowComparator: ties on the chain axes break to a total, stable order', () => {
  const TX_STACK = [transformRow()];
  const row = (n0, d0, n1) => ({ atoms: [
    { wlEntry: { norm: n0, display: d0, score: 5 } },
    { wlEntry: { norm: n1, display: n1, score: 5 } },
  ] });
  const cmp = chainRowComparator([{ key: 'entry', dir: 'asc' }], TX_STACK);
  const A = row('cat', 'cat', 'x');
  const B = row('kat', 'cat', 'x');
  assert.notEqual(cmp(A, B), 0);
  assert.equal(Math.sign(cmp(A, B)), -Math.sign(cmp(B, A)));
  assert.deepEqual([A, B].sort(cmp), [B, A].sort(cmp));   // order independent of input order
});

test('sortGroups: within-group chains take the designed Entry seed order (norm asc)', () => {
  const sorted = sortGroups([freshGroup()], [{ key: 'entry', dir: 'asc' }], GROUP_STACK);
  assert.deepEqual(norms(sorted[0]), ['apple', 'mango', 'zebra']);
});

// Regression: a filter must not leave the surviving chains in bucketize order. The
// designed within-group order holds whether or not a score range is active, so a
// filter-gated chain sort (the kind that reads the unfiltered bucketize order) is a
// silent reorder — invisible until a user filters a multi-chain group.
test('sortGroups: chains stay in the designed seed order under a score filter', () => {
  const filtered = applyScoreRangeToRows([freshGroup()], parseRange('40-100'), 'set');
  const sorted = sortGroups(filtered, [{ key: 'entry', dir: 'asc' }], GROUP_STACK);
  assert.deepEqual(norms(sorted[0]), ['mango', 'zebra']); // not ['zebra','mango']
});

// The two clusters' min- and max-length disagree, so min-length and max-length
// sorts order them oppositely. A same-spread fixture would pass even if both axes
// read the same aggregate, or if _minLength/_maxLength never reached the group.
function lengthGroups() {
  const wide = { key: 'wide', anchor: null, chains: [chain('ab', 50), chain('abcde', 50)] };  // len 2..5
  const mid  = { key: 'mid',  anchor: null, chains: [chain('abc', 50), chain('abcd', 50)] };   // len 3..4
  cacheGroupStats(wide);
  cacheGroupStats(mid);
  return [wide, mid];
}

test('sortGroups: Min length and Max length read the cluster length spread independently', () => {
  const keys = groups => groups.map(g => g.key);
  const byMin = sortGroups(lengthGroups(), [{ key: 'min-length', dir: 'asc' }], GROUP_STACK);
  assert.deepEqual(keys(byMin), ['wide', 'mid']);   // min 2 < min 3
  const byMax = sortGroups(lengthGroups(), [{ key: 'max-length', dir: 'asc' }], GROUP_STACK);
  assert.deepEqual(keys(byMax), ['mid', 'wide']);   // max 4 < max 5
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

test('single Entry desc reverses members within a family, not just the cluster order', () => {
  const e = (display, family) => ({ norm: display, display, score: 50, family });
  const rows = [e('cat', 'cat'), e('cats', 'cat'), e('dog', 'dog'), e('dogs', 'dog')];
  const axis = composeSortAxis([{ key: 'entry', dir: 'asc' }], sortAxes('single', null));
  const asc  = rows.slice().sort((a, b) => compareItems(a, b, axis, 'asc')).map(r => r.display);
  const desc = rows.slice().sort((a, b) => compareItems(a, b, axis, 'desc')).map(r => r.display);
  assert.deepEqual(asc,  ['cat', 'cats', 'dog', 'dogs']);
  // Without `follow` on the display tiebreaker this regresses to ['dog','dogs','cat','cats'].
  assert.deepEqual(desc, ['dogs', 'dog', 'cats', 'cat']);
});

test('multi Entry desc mirrors a transform output branch too, down to the chain tail', () => {
  const seed = { wlEntry: { norm: 'least', display: 'least', score: 50, family: 'least' } };
  const row = out => ({ atoms: [seed, { wlEntry: { norm: out, display: out, score: 50 } }] });
  const rows = [row('slate'), row('stale'), row('steal')];
  const tail = r => r.atoms[1].wlEntry.norm;
  const axis = composeSortAxis([{ key: 'entry', dir: 'asc' }], sortAxes('multi', null));
  const asc  = rows.slice().sort((a, b) => compareItems(a, b, axis, 'asc')).map(tail);
  const desc = rows.slice().sort((a, b) => compareItems(a, b, axis, 'desc')).map(tail);
  assert.deepEqual(asc,  ['slate', 'stale', 'steal']);
  // The branches share an input, so they tie down to the chain tail — which must
  // ride the toggle, else desc leaves them ['slate','stale','steal'] mid-mirror.
  assert.deepEqual(desc, ['steal', 'stale', 'slate']);
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

test('chainSortTier: a transform showing both sides earns the multi-atom axes', () => {
  const stack = [transformRow()];
  assert.equal(chainSortTier(stack), 'multi');
  assert.ok('min-length' in sortAxes('multi', stack));
});

test('chainSortTier: a transform hiding its input stays single -- min/max would be one number', () => {
  const stack = [transformRow('hidden')];
  assert.equal(chainSortTier(stack), 'single');
  assert.deepEqual(Object.keys(sortAxes('single', stack)), ['entry', 'length', 'score', 'comment']);
});

test('chainSortTier: repeat highlight atoms still do not promote a filter-only chain', () => {
  assert.equal(chainSortTier([searchRow(), searchRow()]), 'single');
});
