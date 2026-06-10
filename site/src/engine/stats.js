'use strict';

const _statsCache = new WeakMap();
const _mergedStatsKey = {};

export function invalidateStatsCache(key) { _statsCache.delete(key); }

// Accepts rich rows OR a raw numeric scores array: the flat tier feeds the
// latter so a million-entry stats refresh scans an Int32Array rather than
// allocating a `{ score }` object per entry.
const scoreOf = e => typeof e === 'number' ? e : e.score;

export function computeStatsRaw(entries) {
  // Empty state: return an all-zero shape so buildStatsBarHTML can render the
  // bar with dashes and an empty histogram.
  if (!entries.length) {
    return { count: 0, min: 0, max: 0, distinctScores: [] };
  }
  let min = Infinity, max = -Infinity;
  const freq = {};
  for (const e of entries) {
    const score = scoreOf(e);
    if (score < min) min = score;
    if (score > max) max = score;
    freq[score] = (freq[score] || 0) + 1;
  }
  const distinctScores = Object.keys(freq).map(Number).sort((a, b) => a - b);
  return { count: entries.length, min, max, distinctScores };
}

export function computeStats(key, entries) {
  if (_statsCache.has(key)) return _statsCache.get(key);
  const result = computeStatsRaw(entries);
  _statsCache.set(key, result);
  return result;
}
