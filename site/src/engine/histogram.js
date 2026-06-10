'use strict';

export const HIST_DISCRETE_THRESHOLD = 12;
export const HIST_BINNED_BUCKETS = 11;

// Keyed, not a single slot: two distinct axes coexist — the scope-aware stats
// histogram and the scope-stable all-sources badge-color gradient. A shared
// slot would let the selected scope silently leak into the badge colors.
const _layoutCache = new Map();
export function invalidateHistogramLayout() { _layoutCache.clear(); }

// Accepts rich rows OR a raw numeric scores array: the flat tier feeds the
// latter so a million-entry histogram pass scans an Int32Array rather than
// allocating a `{ score }` object per entry.
const scoreOf = e => typeof e === 'number' ? e : e.score;

export function getHistogramLayout(scoreSource, cacheKey) {
  const cached = _layoutCache.get(cacheKey);
  if (cached) return cached;
  const distinct = new Set();
  let min = Infinity, max = -Infinity;
  for (const e of scoreSource) {
    const score = scoreOf(e);
    distinct.add(score);
    if (score < min) min = score;
    if (score > max) max = score;
  }
  if (!distinct.size) {
    // No data → empty layout. Don't cache: as soon as data arrives, the next
    // call should recompute. (Caching here would also burn the cache if
    // anything calls into the layout before sources finish loading.)
    return { mode: 'empty', slots: [], min: null, max: null };
  }
  const distinctScores = [...distinct].sort((a, b) => a - b);
  let layout;
  if (distinctScores.length <= HIST_DISCRETE_THRESHOLD) {
    layout = {
      mode: 'discrete',
      slots: distinctScores.map(s => ({ score: s, lo: s, hi: s, label: String(s) })),
      min, max,
    };
  } else {
    const N = HIST_BINNED_BUCKETS;
    const bucketSize = Math.max(1, Math.ceil((max - min + 1) / N));
    const slots = [];
    for (let i = 0; i < N; i++) {
      const lo = min + i * bucketSize;
      if (lo > max) break;
      const hi = Math.min(max, lo + bucketSize - 1);
      slots.push({ lo, hi, label: lo === hi ? String(lo) : `${lo}–${hi}` });
    }
    layout = { mode: 'binned', slots, min, max };
  }
  _layoutCache.set(cacheKey, layout);
  return layout;
}

export function bucketCounts(entries, layout) {
  const counts = layout.slots.map(() => 0);
  if (layout.mode === 'discrete') {
    const idxByScore = new Map(layout.slots.map((s, i) => [s.score, i]));
    for (const e of entries) {
      const idx = idxByScore.get(scoreOf(e));
      if (idx !== undefined) counts[idx]++;
    }
  } else if (layout.slots.length) {
    const min0 = layout.slots[0].lo;
    const bs = layout.slots[0].hi - layout.slots[0].lo + 1;
    const last = layout.slots.length - 1;
    for (const e of entries) {
      const idx = Math.min(last, Math.max(0, Math.floor((scoreOf(e) - min0) / bs)));
      counts[idx]++;
    }
  }
  return counts;
}

export function slotIntersectsRange(lo, hi, intervals) {
  for (const { min, max } of intervals) {
    const m = max === null ? Infinity : max;
    const n = min === null ? -Infinity : min;
    if (lo <= m && hi >= n) return true;
  }
  return false;
}
