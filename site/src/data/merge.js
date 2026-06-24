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
let _shippedSourceTotals = null;   // Map(dbKey → per-source total entry count)
export function setShippedConfigCounts(sourceCounts, sourceTotals, mergedCount, version) {
  if (version === _shippedCountsVersion) return;
  _shippedSourceCounts = sourceCounts;
  _shippedMergedCount = mergedCount;
  // A build-failure ack ships null totals; keep the last-good map rather than
  // blanking every count display until the next successful build.
  if (sourceTotals) _shippedSourceTotals = new Map(sourceTotals.map(s => [s.sourceId, s.total]));
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

// A source's total entry count. My Edits stays on its live length, NOT the shipped
// total: it's main-owned and mutates optimistically per edit, so the shipped total
// would lag every edit by a worker round-trip. Others read the worker total.
export function sourceTotal(wordlist) {
  if (wordlist.type === 'edits') return wordlist.rawEntries.length;
  if (!_shippedSourceTotals) return null;
  return _shippedSourceTotals.get(wordlist.dbKey) ?? null;
}

// Distinct (rawScore, normLength) pairs per source, for the local bake gate. NOT
// version-gated like the counts: it rides only full-content events (selfReady /
// fetchApplied), never the per-edit editAck, so "update when present" can't be a
// stale overwrite — and an editAck omitting it must keep the last-good map.
let _shippedRescoreInputs = null;   // Map(dbKey → [[score, len], …])
export function setShippedRescoreInputs(inputs) {
  if (inputs) _shippedRescoreInputs = new Map(inputs.map(s => [s.sourceId, s.pairs]));
}
export function sourceRescoreInputs(wordlist) {
  return _shippedRescoreInputs?.get(wordlist.dbKey) ?? null;
}

export function mergedEntryCount() {
  return _shippedMergedCount ?? 0;
}
