'use strict';

// ─── Merge ──────────────────────────────────────────────────────────────────

import { MERGED_ID } from '../core/constants.js';
import { state } from './state.js';
import { buildCorpus, mergeKey, computeMergedBucket, mergedNormLowerBound } from '../engine/corpus.js';
import { invalidatePreSearchCache } from '../engine/executor.js';
import { invalidateHistogramLayout } from '../engine/histogram.js';
import { canonicalNormRow } from '../engine/snapshot.js';

export const _mergedStatsKey = {};

let _sourceCountsCache = null;
let _mergedWordlistCache = null;
const _scopedWordlistCache = new Map();

export function invalidateSourceCounts() {
  _sourceCountsCache = null;
  _mergedWordlistCache = null;
  _scopedWordlistCache.clear();
  invalidatePreSearchCache();
  invalidateHistogramLayout();
}

export function getSourceCounts() {
  if (!_sourceCountsCache) _sourceCountsCache = buildMergedWordlist().sourceCounts;
  return _sourceCountsCache;
}

// Peek without building — callers distinguishing "patched" from "rebuilt" must
// not trip the lazy build, which would defeat the distinction.
export function peekMergedCache() { return _mergedWordlistCache; }

export function dropScopedCorpus(scope) { _scopedWordlistCache.delete(scope); }

export function buildMergedWordlist() {
  if (_mergedWordlistCache) return _mergedWordlistCache;
  const enabled = state.sources.filter(wl => wl.enabled);
  _mergedWordlistCache = buildCorpus(enabled);
  return _mergedWordlistCache;
}

// Built independent of source.enabled so a disabled source stays viewable when
// it's the scope.
export function buildScopedCorpus(source) {
  const cached = _scopedWordlistCache.get(source);
  if (cached) return cached;
  const corpus = buildCorpus([source]);
  _scopedWordlistCache.set(source, corpus);
  return corpus;
}

export function getActiveCorpus() {
  return state.selected === MERGED_ID ? buildMergedWordlist() : buildScopedCorpus(state.selected);
}

// Must run BEFORE My Edits is mutated: patchMergedForNorms diffs these winners
// against the post-mutation ones, so a snapshot taken too late drifts the
// source counts with no error.
export function snapshotMergedBuckets(norms) {
  if (!_mergedWordlistCache) return null;
  const snap = new Map();
  for (const norm of norms) snap.set(norm, computeMergedBucket(norm, state.sources).winners);
  return snap;
}

// `_initialChains` is parallel to `entries`, so it must take the same splice —
// otherwise the pipeline keeps seeding from rows that no longer exist. Data owns
// the cache object; engine/executor.js's buildInitialChains defines the
// `_initialChains` field and the per-atom shape, so the atom literal spliced in
// below must stay in lockstep with that definition.
export function patchMergedForNorms(snap) {
  const cache = _mergedWordlistCache;
  if (!cache || !snap) return null;
  // In-place splice keeps the cache's identity, so the worker-snapshot trigger's
  // identity check can't see this edit — bump a version it watches too, else the
  // worker corpus silently diverges from main's after a My Edits change.
  cache._snapVersion = (cache._snapVersion ?? 0) + 1;
  const { entries, byNorm, byKey, sourceCounts } = cache;
  const chains = cache._initialChains;
  const countDelta = new Map();
  const patched = [];
  for (const [norm, beforeWinners] of snap) {
    const lo = mergedNormLowerBound(entries, norm);
    let hi = lo;
    while (hi < entries.length && entries[hi].norm === norm) hi++;
    for (let i = lo; i < hi; i++) byKey.delete(mergeKey(norm, entries[i].display));

    const { rows, winners } = computeMergedBucket(norm, state.sources);
    entries.splice(lo, hi - lo, ...rows);
    if (chains) chains.splice(lo, hi - lo, ...rows.map(r => ({ atoms: [{ wlEntry: r, highlights: null, glyph: null }] })));
    for (const r of rows) byKey.set(mergeKey(norm, r.display), r);
    if (rows.length) byNorm.set(norm, canonicalNormRow(rows)); else byNorm.delete(norm);

    patched.push({ norm, rows: rows.map(r => ({ norm: r.norm, display: r.display, score: r.score })) });

    for (const wl of beforeWinners) countDelta.set(wl, (countDelta.get(wl) || 0) - 1);
    for (const wl of winners)       countDelta.set(wl, (countDelta.get(wl) || 0) + 1);
  }
  for (const [wl, d] of countDelta) {
    if (!d) continue;
    const sc = sourceCounts.find(s => s.wordlist === wl);
    if (sc) sc.count += d;
    else sourceCounts.push({ wordlist: wl, count: d });
  }
  return { norms: patched };
}
