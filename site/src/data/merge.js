'use strict';

// ─── Merge ──────────────────────────────────────────────────────────────────
// The worker owns the merged/scoped corpus; main holds only the per-config
// summaries (source counts + merged total) the worker ships.

import { state, bumpConfigSummary } from './state.js';
import { invalidatePreSearchCache } from '../engine/executor.js';
import { invalidateHistogramLayout } from '../engine/histogram.js';

export const _mergedStatsKey = {};

export function invalidateSourceCounts() {
  invalidatePreSearchCache();
  invalidateHistogramLayout();
}

let _shippedSourceCounts = null, _shippedMergedCount = null, _shippedCountsVersion = -1;
export function setShippedConfigCounts(sourceCounts, mergedCount, version) {
  if (version === _shippedCountsVersion) return;
  _shippedSourceCounts = sourceCounts;
  _shippedMergedCount = mergedCount;
  _shippedCountsVersion = version;
  bumpConfigSummary();   // async-arriving counts repaint their displays
}
export function shippedConfigCountsVersion() { return _shippedCountsVersion; }

export function getSourceCounts() {
  if (!_shippedSourceCounts) return [];
  const byKey = new Map(state.sources.map(wl => [wl.dbKey, wl]));
  return _shippedSourceCounts
    .map(({ sourceId, count }) => ({ wordlist: byKey.get(sourceId), count }))
    .filter(s => s.wordlist);
}

export function mergedEntryCount() {
  return _shippedMergedCount ?? 0;
}
