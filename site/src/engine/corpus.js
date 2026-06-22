'use strict';

// ─── Corpus ──────────────────────────────────────────────────────────────────

import { getRescoredByNorm } from './rescore.js';
import { buildByNorm } from './snapshot.js';

// A null display is a cross-wordlist wildcard (bare THEIRS unifies with another
// list's spelled "the IRS"). But one list holding both the bare entry and a
// spelled sibling distinguishes them on purpose — concretize the bare one or it
// silently absorbs the sibling's spelling and they collapse to a single row.
export function isDistinguishing(group) {
  return group.length > 1 && group.some(e => e.display != null);
}

export function concreteDisplay(wlE, norm, distinguishing) {
  // Trust the stored display; bare-vs-rich is decided at the source, not here.
  // Re-baring display === norm silently swallows a file's deliberate
  // off-convention spelling into another list's row.
  return wlE.display ?? (distinguishing ? norm : null);
}

// `sourceList[0]` is highest priority; winner resolution depends on it.
export function bucketContributors(sourceList) {
  const buckets = new Map();
  for (const wordlist of sourceList) {
    for (const [norm, group] of getRescoredByNorm(wordlist)) {
      const distinguishing = isDistinguishing(group);
      let b = buckets.get(norm);
      if (!b) buckets.set(norm, b = { contributors: [], displays: new Set() });
      for (const wlE of group) {
        const display = concreteDisplay(wlE, norm, distinguishing);
        b.contributors.push({ wordlist, score: wlE.score, rawScore: wlE.rawScore, comment: wlE.comment || '', display });
        if (display != null) b.displays.add(display);
      }
    }
  }
  return buckets;
}

export function resolveCorpus(buckets, sourceList) {
  const entries = [];
  const byKey = new Map();
  const sourceCountMap = new Map();
  const bumpCount = wl => sourceCountMap.set(wl, (sourceCountMap.get(wl) || 0) + 1);
  for (const [norm, { contributors, displays }] of buckets) {
    // Single-contributor buckets (the common case) resolve to exactly that
    // contributor on its display — must mirror the general path below, or these
    // norms silently diverge from multi-contributor ones.
    if (contributors.length === 1) {
      const c = contributors[0];
      const row = { norm, display: c.display, score: c.score, rawScore: c.rawScore, comment: c.comment, wordlist: c.wordlist };
      entries.push(row);
      byKey.set(mergeKey(norm, c.display), row);
      bumpCount(c.wordlist);
      continue;
    }
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
        bumpCount(winner.wordlist);
      }
    }
  }

  // Equivalence to localeCompare holds only because norm is strictly [a-z0-9];
  // widen toNorm's alphabet and this silently mis-orders. The display tie-break
  // must stay localeCompare — buildByNorm's canonical-row pick depends on it.
  entries.sort((a, b) => a.norm < b.norm ? -1 : a.norm > b.norm ? 1
    : (a.display ?? '').localeCompare(b.display ?? ''));

  const sourceCounts = sourceList.map(wl => ({ wordlist: wl, count: sourceCountMap.get(wl) || 0 }));

  return { entries, sourceCounts, byNorm: buildByNorm(entries), byKey };
}

export function buildCorpus(sourceList) {
  return resolveCorpus(bucketContributors(sourceList), sourceList);
}

export function mergeKey(norm, display) {
  return norm + '\0' + (display ?? '');
}

// Keyed by mergeKey, not bare norm: entries sharing a norm but differing in
// display ("pgs"/"PGs") are distinct. Norm-keying collapses them last-wins and
// fabricates phantom rescores — fails silently, only visible in the update dialog.
export function diffWordlistEntries(oldEntries, newEntries) {
  const keyer = entries => {
    const m = new Map();
    for (const e of entries) m.set(mergeKey(e.norm, e.display), e);
    return m;
  };
  const oldByKey = keyer(oldEntries);
  const newByKey = keyer(newEntries);

  const byNorm = (a, b) => a.norm.localeCompare(b.norm);
  const added = [], rescored = [];
  for (const [key, e] of newByKey) {
    const prev = oldByKey.get(key);
    if (!prev) added.push(e);
    else if (prev.score !== e.score) rescored.push({ entry: e, oldScore: prev.score, score: e.score });
  }
  const deleted = [...oldByKey].filter(([key]) => !newByKey.has(key)).map(([, e]) => e);

  added.sort(byNorm);
  deleted.sort(byNorm);
  rescored.sort((a, b) => byNorm(a.entry, b.entry));
  return { added, deleted, rescored };
}

// Must reproduce buildCorpus's per-bucket logic exactly — including deduping
// winners by contributor, not wordlist — or the worker's in-place owned-corpus
// splice (which calls this per affected norm) drifts from a full rebuild.
export function computeMergedBucket(norm, sources) {
  const contributors = [];
  const displays = new Set();
  for (const wl of sources) {
    if (!wl.enabled) continue;
    const arr = getRescoredByNorm(wl).get(norm);
    if (!arr) continue;
    const distinguishing = isDistinguishing(arr);
    for (const e of arr) {
      const display = concreteDisplay(e, norm, distinguishing);
      contributors.push({ wordlist: wl, score: e.score, comment: e.comment || '', display });
      if (display != null) displays.add(display);
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

// Shared by main (resolveSeed) and the worker (fetchEditSeed); never inline this
// resolution on one side or the two threads silently drift on the merge winner.
// Returns null when the norm is absent from the merge — the caller must supply
// the clicked-atom fallback (reachable only from a disabled-list scope).
export function resolveEditSeedWinner(merged, norm, display) {
  let row = merged.byKey.get(mergeKey(norm, display));
  // A bare click with no bare merged row edits the first-alphabetical spelled
  // variant — deterministic but arbitrary; don't "fix" the ordering.
  if (!row && display == null) {
    const variants = mergedRowsForNorm(merged, norm).filter(r => r.display != null);
    variants.sort((a, b) => a.display.localeCompare(b.display));
    row = variants[0] || merged.byNorm.get(norm) || null;
  }
  return row ?? null;
}
