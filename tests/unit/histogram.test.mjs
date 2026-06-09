import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './support/extract.mjs';

// getHistogramLayout reads a module-level `_layoutCache` Map; a fresh fake via
// `globals` (plus a unique cacheKey per call) keeps cache state from leaking
// between assertions.
const _layoutCache = new Map();
const {
  computeStatsRaw, getHistogramLayout, bucketCounts, slotIntersectsRange,
  HIST_DISCRETE_THRESHOLD, HIST_BINNED_BUCKETS,
} = extract('histogram', [
  'computeStatsRaw', 'getHistogramLayout', 'bucketCounts', 'slotIntersectsRange',
  'HIST_DISCRETE_THRESHOLD', 'HIST_BINNED_BUCKETS',
], { _layoutCache });

const scores = (...ns) => ns.map(score => ({ score }));
let keySeq = 0;
const layoutOf = scoreList => getHistogramLayout(scoreList, `t${keySeq++}`);

test('computeStatsRaw: empty input returns the all-zero sentinel shape', () => {
  assert.deepEqual(computeStatsRaw([]), { count: 0, min: 0, max: 0, distinctScores: [] });
});

test('computeStatsRaw: count, min, max, and sorted distinct scores over a set', () => {
  const out = computeStatsRaw(scores(30, 10, 30, 50, 10, 40));
  assert.equal(out.count, 6);
  assert.equal(out.min, 10);
  assert.equal(out.max, 50);
  assert.deepEqual(out.distinctScores, [10, 30, 40, 50]);
});

test('computeStatsRaw: distinctScores are numerically (not lexically) sorted', () => {
  // freq keys come back as strings; without the Number()+numeric sort, 100 would
  // sort before 9 — a silent ordering bug the histogram axis would inherit.
  const out = computeStatsRaw(scores(9, 100, 20));
  assert.deepEqual(out.distinctScores, [9, 20, 100]);
});

test('computeStatsRaw: a single repeated score collapses to one distinct value', () => {
  const out = computeStatsRaw(scores(42, 42, 42));
  assert.equal(out.count, 3);
  assert.equal(out.min, 42);
  assert.equal(out.max, 42);
  assert.deepEqual(out.distinctScores, [42]);
});

test('computeStatsRaw: negative scores order correctly', () => {
  const out = computeStatsRaw(scores(-5, 0, -10, 3));
  assert.equal(out.min, -10);
  assert.equal(out.max, 3);
  assert.deepEqual(out.distinctScores, [-10, -5, 0, 3]);
});

test('getHistogramLayout: the discrete/binned threshold constant is 12', () => {
  assert.equal(HIST_DISCRETE_THRESHOLD, 12);
  assert.equal(HIST_BINNED_BUCKETS, 11);
});

test('getHistogramLayout: no data yields an empty layout (null min/max)', () => {
  assert.deepEqual(layoutOf(scores()), { mode: 'empty', slots: [], min: null, max: null });
});

test('getHistogramLayout: exactly 12 distinct scores stays discrete (<= threshold)', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ score: i }));
  const layout = layoutOf(twelve);
  assert.equal(layout.mode, 'discrete');
  assert.equal(layout.slots.length, 12);
  assert.equal(layout.min, 0);
  assert.equal(layout.max, 11);
  assert.deepEqual(layout.slots[0], { score: 0, lo: 0, hi: 0, label: '0' });
  assert.deepEqual(layout.slots[11], { score: 11, lo: 11, hi: 11, label: '11' });
});

test('getHistogramLayout: 13 distinct scores crosses into binned (off-by-one boundary)', () => {
  const thirteen = Array.from({ length: 13 }, (_, i) => ({ score: i }));
  const layout = layoutOf(thirteen);
  assert.equal(layout.mode, 'binned');
  assert.equal(layout.min, 0);
  assert.equal(layout.max, 12);
  assert.deepEqual(layout.slots.map(s => s.label), ['0–1', '2–3', '4–5', '6–7', '8–9', '10–11', '12']);
  assert.equal(layout.slots.length, 7);
  assert.deepEqual(layout.slots[6], { lo: 12, hi: 12, label: '12' });
});

test('getHistogramLayout: a wide binned range fills all 11 buckets', () => {
  const twentyTwo = Array.from({ length: 22 }, (_, i) => ({ score: i }));
  const layout = layoutOf(twentyTwo);
  assert.equal(layout.mode, 'binned');
  assert.equal(layout.slots.length, 11);
  assert.deepEqual(layout.slots[0], { lo: 0, hi: 1, label: '0–1' });
  assert.deepEqual(layout.slots[10], { lo: 20, hi: 21, label: '20–21' });
});

test('getHistogramLayout: caches per cacheKey; the empty layout is not cached', () => {
  const cache = new Map();
  const local = extract('histogram', ['getHistogramLayout'], { _layoutCache: cache }).getHistogramLayout;
  // Empty source must NOT cache: the layout has to recompute once data arrives,
  // and caching an empty result would freeze the histogram blank.
  local(scores(), 'k');
  assert.equal(cache.has('k'), false);
  const first = local(scores(1, 2, 3), 'k');
  assert.equal(cache.get('k'), first);
  // The key, not the data, is the cache identity: a different source under the
  // same key returns the stale layout.
  const second = local(scores(100, 200, 300), 'k');
  assert.equal(second, first);
  assert.equal(second.max, 3);
});

test('bucketCounts: discrete layout tallies each distinct score into its slot', () => {
  const layout = layoutOf(scores(10, 20, 30));
  assert.equal(layout.mode, 'discrete');
  const counts = bucketCounts(scores(10, 10, 20, 30, 30, 30), layout);
  assert.deepEqual(counts, [2, 1, 3]);
});

test('bucketCounts: discrete layout ignores scores absent from the layout', () => {
  const layout = layoutOf(scores(10, 20));
  const counts = bucketCounts(scores(10, 15, 20, 99), layout);
  assert.deepEqual(counts, [1, 1]);
});

test('bucketCounts: binned floor-division places the min in bucket 0 and the max in the last bucket', () => {
  // The max score is the classic overflow trap: floor((12-0)/2) = 6 happens to
  // equal the last index here, but the Math.min(last, …) clamp is what
  // guarantees a score at the exact max never indexes past the final bucket.
  const layout = layoutOf(Array.from({ length: 13 }, (_, i) => ({ score: i })));
  assert.equal(layout.mode, 'binned');
  const counts = bucketCounts(scores(0, 12), layout);
  assert.equal(counts.length, 7);
  assert.equal(counts[0], 1);
  assert.equal(counts[6], 1);
  assert.equal(counts.reduce((a, b) => a + b, 0), 2);
});

test('bucketCounts: binned width-2 buckets group adjacent scores', () => {
  // Bins: [0–1][2–3][4–5][6–7][8–9][10–11][12]
  const layout = layoutOf(Array.from({ length: 13 }, (_, i) => ({ score: i })));
  const counts = bucketCounts(scores(0, 1, 2, 3, 4, 11), layout);
  assert.deepEqual(counts, [2, 2, 1, 0, 0, 1, 0]);
});

test('bucketCounts: out-of-range scores clamp to the end buckets, never overflow', () => {
  const layout = layoutOf(Array.from({ length: 13 }, (_, i) => ({ score: i })));
  const counts = bucketCounts(scores(-100, 9999), layout);
  assert.equal(counts[0], 1);
  assert.equal(counts[6], 1);
  assert.equal(counts.reduce((a, b) => a + b, 0), 2);
});

test('bucketCounts: an empty-mode layout yields no counts', () => {
  const layout = layoutOf(scores());
  assert.deepEqual(bucketCounts(scores(1, 2, 3), layout), []);
});

test('slotIntersectsRange: a slot fully inside a closed range overlaps', () => {
  assert.equal(slotIntersectsRange(10, 20, [{ min: 0, max: 50 }]), true);
});

test('slotIntersectsRange: a slot fully outside a closed range does not overlap', () => {
  assert.equal(slotIntersectsRange(10, 20, [{ min: 30, max: 40 }]), false);
  assert.equal(slotIntersectsRange(50, 60, [{ min: 30, max: 40 }]), false);
});

test('slotIntersectsRange: edge touch is inclusive (slot lo === range max overlaps)', () => {
  assert.equal(slotIntersectsRange(40, 50, [{ min: 0, max: 40 }]), true);   // touches at 40
  assert.equal(slotIntersectsRange(0, 10, [{ min: 10, max: 99 }]), true);   // touches at 10
  assert.equal(slotIntersectsRange(41, 50, [{ min: 0, max: 40 }]), false);  // one past the edge
});

test('slotIntersectsRange: a null max is an open upper bound (+Infinity)', () => {
  assert.equal(slotIntersectsRange(1000, 2000, [{ min: 50, max: null }]), true);
  assert.equal(slotIntersectsRange(1000, 2000, [{ min: 5000, max: null }]), false);
});

test('slotIntersectsRange: a null min is an open lower bound (-Infinity)', () => {
  assert.equal(slotIntersectsRange(-1000, -500, [{ min: null, max: 0 }]), true);
  assert.equal(slotIntersectsRange(-1000, -500, [{ min: null, max: -5000 }]), false);
});

test('slotIntersectsRange: a fully-open range (null/null) always overlaps', () => {
  assert.equal(slotIntersectsRange(7, 7, [{ min: null, max: null }]), true);
});

test('slotIntersectsRange: overlap with ANY interval in the list returns true', () => {
  const intervals = [{ min: 0, max: 5 }, { min: 90, max: 100 }];
  assert.equal(slotIntersectsRange(95, 99, intervals), true);
  assert.equal(slotIntersectsRange(50, 60, intervals), false);
});

test('slotIntersectsRange: an empty interval list never overlaps', () => {
  assert.equal(slotIntersectsRange(10, 20, []), false);
});
