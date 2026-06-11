'use strict';

// ─── Merge ──────────────────────────────────────────────────────────────────

import { MERGED_ID } from '../core/constants.js';
import { state } from './state.js';
import { getRescoredEntries, getRescoredByNorm } from './rescoring.js';
import { invalidatePreSearchCache } from '../engine/executor.js';
import { invalidateHistogramLayout } from '../engine/histogram.js';
import { buildByNorm, canonicalNormRow } from '../engine/snapshot.js';

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

// `sourceList[0]` is highest priority; winner resolution depends on it.
export function bucketContributors(sourceList) {
  const buckets = new Map();
  for (const wordlist of sourceList) {
    for (const wlE of getRescoredEntries(wordlist)) {
      let b = buckets.get(wlE.norm);
      if (!b) buckets.set(wlE.norm, b = { contributors: [], displays: new Set() });
      b.contributors.push({ wordlist, score: wlE.score, rawScore: wlE.rawScore, comment: wlE.comment || '', display: wlE.display });
      if (wlE.display != null) b.displays.add(wlE.display);
    }
  }
  return buckets;
}

export function resolveCorpus(buckets, sourceList) {
  const entries = [];
  const byKey = new Map();
  const sourceCountMap = new Map();
  for (const [norm, { contributors, displays }] of buckets) {
    const variants = displays.size > 0 ? [...displays].sort() : [null];
    const countedContributors = new Set();
    for (const variant of variants) {
      const eligible = c => c.display === variant || c.display === null;
      const winner = contributors.find(eligible);
      if (!winner) continue;
      const commenter = contributors.find(c => eligible(c) && c.comment) ?? winner;
      const row = { norm, display: variant, score: winner.score, rawScore: winner.rawScore, comment: commenter.comment, wordlist: winner.wordlist };
      entries.push(row);
      byKey.set(mergeKey(norm, variant), row);
      if (!countedContributors.has(winner)) {
        countedContributors.add(winner);
        sourceCountMap.set(winner.wordlist, (sourceCountMap.get(winner.wordlist) || 0) + 1);
      }
    }
  }

  entries.sort((a, b) => a.norm.localeCompare(b.norm)
    || (a.display ?? '').localeCompare(b.display ?? ''));

  const sourceCounts = sourceList.map(wl => ({ wordlist: wl, count: sourceCountMap.get(wl) || 0 }));

  return { entries, sourceCounts, byNorm: buildByNorm(entries), byKey };
}

export function buildMergedWordlist() {
  if (_mergedWordlistCache) return _mergedWordlistCache;
  const enabled = state.sources.filter(wl => wl.enabled);
  _mergedWordlistCache = resolveCorpus(bucketContributors(enabled), enabled);
  return _mergedWordlistCache;
}

// Built independent of source.enabled so a disabled source stays viewable when
// it's the scope.
export function buildScopedCorpus(source) {
  const cached = _scopedWordlistCache.get(source);
  if (cached) return cached;
  const corpus = resolveCorpus(bucketContributors([source]), [source]);
  _scopedWordlistCache.set(source, corpus);
  return corpus;
}

export function getActiveCorpus() {
  return state.selected === MERGED_ID ? buildMergedWordlist() : buildScopedCorpus(state.selected);
}

export function mergeKey(norm, display) {
  return norm + '\0' + (display ?? '');
}

// Must reproduce buildMergedWordlist's per-bucket logic exactly — including
// deduping winners by contributor, not wordlist — or the merged cache drifts
// silently on the next edit.
export function computeMergedBucket(norm) {
  const contributors = [];
  const displays = new Set();
  for (const wl of state.sources) {
    if (!wl.enabled) continue;
    const arr = getRescoredByNorm(wl).get(norm);
    if (!arr) continue;
    for (const e of arr) {
      contributors.push({ wordlist: wl, score: e.score, comment: e.comment || '', display: e.display });
      if (e.display != null) displays.add(e.display);
    }
  }
  const rows = [];
  const winners = [];
  const counted = new Set();
  const variants = displays.size > 0 ? [...displays].sort() : [null];
  for (const variant of variants) {
    const eligible = c => c.display === variant || c.display === null;
    const winner = contributors.find(eligible);
    if (!winner) continue;
    const commenter = contributors.find(c => eligible(c) && c.comment) ?? winner;
    rows.push({ norm, display: variant, score: winner.score, comment: commenter.comment, wordlist: winner.wordlist });
    if (!counted.has(winner)) { counted.add(winner); winners.push(winner.wordlist); }
  }
  rows.sort((a, b) => (a.display ?? '').localeCompare(b.display ?? ''));
  return { rows, winners };
}

export function mergedNormLowerBound(entries, norm) {
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].norm.localeCompare(norm) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function mergedRowsForNorm(merged, norm) {
  const { entries } = merged;
  const rows = [];
  for (let i = mergedNormLowerBound(entries, norm); i < entries.length && entries[i].norm === norm; i++) {
    rows.push(entries[i]);
  }
  return rows;
}

// Must run BEFORE My Edits is mutated: patchMergedForNorms diffs these winners
// against the post-mutation ones, so a snapshot taken too late drifts the
// source counts with no error.
export function snapshotMergedBuckets(norms) {
  if (!_mergedWordlistCache) return null;
  const snap = new Map();
  for (const norm of norms) snap.set(norm, computeMergedBucket(norm).winners);
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

    const { rows, winners } = computeMergedBucket(norm);
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
