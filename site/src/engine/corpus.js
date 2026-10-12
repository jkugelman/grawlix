'use strict';

// ─── Corpus ──────────────────────────────────────────────────────────────────

import { sourceAccessor } from './sources.js';
import { displayOf } from './norm.js';
import { familyKey, collectVocab } from './morphology.js';

// A null display is a cross-wordlist wildcard (bare THEIRS unifies with another
// list's spelled "the IRS"). But one list holding both the bare entry and a
// spelled sibling distinguishes them on purpose — concretize the bare one or it
// silently absorbs the sibling's spelling and they collapse to a single row.
export function isDistinguishing(group) {
  return Array.isArray(group) && group.length > 1 && group.some(e => e.display != null);
}

export function concreteDisplay(wlE, norm, distinguishing) {
  // Trust the stored display; bare-vs-rich is decided at the source, not here.
  // Re-baring display === norm silently swallows a file's deliberate
  // off-convention spelling into another list's row.
  return wlE.display ?? (distinguishing ? norm : null);
}

const newBucket = () => ({ contributors: [], displays: new Set() });

function addGroup(bucket, wordlist, norm, group) {
  const distinguishing = isDistinguishing(group);
  for (const wlE of group) {
    const display = concreteDisplay(wlE, norm, distinguishing);
    bucket.contributors.push({ wordlist, score: wlE.score, rawScore: wlE.rawScore, comment: wlE.comment || '', display });
    if (display != null) bucket.displays.add(display);
  }
}

// `sourceList[0]` is highest priority; winner resolution depends on it.
export function bucketContributors(sourceList) {
  const buckets = new Map();
  for (const wordlist of sourceList) {
    sourceAccessor(wordlist).forEachGroup((norm, group) => {
      let b = buckets.get(norm);
      if (!b) buckets.set(norm, b = newBucket());
      addGroup(b, wordlist, norm, group);
    });
  }
  return buckets;
}

// Contributors must arrive in priority order: ties go to the first.
// My Edits wins whenever it's eligible, in every mode: a score mode would otherwise
// stop an edit from lowering (or raising) a score, and the edit planner's
// trash-score rows only hide a foreign spelling if they win.
export function pickWinner(contributors, eligible, mode) {
  let winner = null;
  for (const c of contributors) {
    if (!eligible(c)) continue;
    if (c.wordlist.type === 'edits') return c;
    if (!winner
      || (mode === 'highest' && c.score > winner.score)
      || (mode === 'lowest' && c.score < winner.score)) winner = c;
  }
  return winner;
}

// A row passes its winning list only on that contributor's first win: a bare entry
// winning several spellings counts once, or a list's count can exceed its size.
function resolveBucket(norm, { contributors, displays }, mode, emit) {
  // The common case skips the variant scan; it must resolve exactly as the general
  // path does, or single-contributor norms silently diverge.
  if (contributors.length === 1) {
    const c = contributors[0];
    // `_i` (the worker's index into ownedCorpus.entries) is declared in the literal,
    // not added later, so V8 keeps it in-object; a post-construction add spills one
    // PropertyArray per row (~13 MB at ~660K rows). The worker overwrites the -1.
    emit({ norm, display: c.display, score: c.score, rawScore: c.rawScore, comment: c.comment, wordlist: c.wordlist, family: '', _i: -1 }, c.wordlist);
    return;
  }
  const variants = displays.size > 0 ? [...displays].sort() : [null];
  const counted = new Set();
  for (const variant of variants) {
    const eligible = c => c.display === variant || c.display === null;
    const winner = pickWinner(contributors, eligible, mode);
    if (!winner) continue;
    const commenter = contributors.find(c => eligible(c) && c.comment) ?? winner;
    const first = !counted.has(winner);
    counted.add(winner);
    emit({ norm, display: variant, score: winner.score, rawScore: winner.rawScore, comment: commenter.comment, wordlist: winner.wordlist, family: '', _i: -1 }, first ? winner.wordlist : null);
  }
}

export function resolveCorpus(buckets, sourceList, mode = 'first') {
  const entries = [];
  const byKey = new Map();
  const sourceCountMap = new Map();
  const emit = (row, winner) => {
    entries.push(row);
    byKey.set(mergeKey(row.norm, row.display), row);
    if (winner) sourceCountMap.set(winner, (sourceCountMap.get(winner) || 0) + 1);
  };
  for (const [norm, bucket] of buckets) resolveBucket(norm, bucket, mode, emit);

  // Equivalence to localeCompare holds only because norm is strictly [a-z0-9];
  // widen toNorm's alphabet and this silently mis-orders. The display tie-break must
  // stay localeCompare to match computeBucket, whose rows the splice writes
  // positionally — diverge and its identity check drops cache tiles.
  entries.sort((a, b) => a.norm < b.norm ? -1 : a.norm > b.norm ? 1
    : (a.display ?? '').localeCompare(b.display ?? ''));

  const sourceCounts = sourceList.map(wl => ({ wordlist: wl, count: sourceCountMap.get(wl) || 0 }));

  return { entries, sourceCounts, norms: new Set(entries.map(e => e.norm)), byKey };
}

export function buildCorpus(sourceList, mode = 'first') {
  return resolveCorpus(bucketContributors(sourceList), sourceList, mode);
}

// Assigned after resolution, not in the row literal: the key anchors against the
// whole list's vocabulary, which isn't known until every entry exists.
export function assignFamilies(corpus) {
  const vocab = collectVocab(corpus.entries.map(displayOf));
  corpus.vocab = vocab;
  for (const e of corpus.entries) e.family = familyKey(displayOf(e), vocab);
}

// The Sources-matrix contributor set per row. Call these per *shipped* row, never
// over the whole corpus: eagerly attaching to every entry made load O(corpus).

// Scoped: norm-level, like the provenance panel — matching on (norm,display) would
// silently drop a list that spells the word its own way.
export function scopeSourceIds(norm, built, scopeKey) {
  const ids = [];
  for (const wl of built) {
    if ((wl.enabled || wl.dbKey === scopeKey) && sourceAccessor(wl).hasNorm(norm)) ids.push(wl.dbKey);
  }
  return ids;
}

// Merged: display-aware, kept in lockstep with resolveCorpus's `eligible` (drift and
// the matrix silently mis-lists). `activeIds` are the lists *sourcing* a shown value —
// the score winner (the merge mode's pick), the displayed spelling and the comment, the
// last two each the ONE highest-priority holder, so a duplicate with the same value is
// muted. Spelling source and winner differ
// only when a bare winner takes the score while a richer list supplies the spelling.
export function mergedContributors(norm, display, built, mode) {
  const sourceIds = [];
  const eligibles = [];
  let commentWl = null, displayWl = null;
  for (const wl of built) {
    if (!wl.enabled) continue;
    const group = sourceAccessor(wl).rescoredForNorm(norm);
    if (group === undefined) continue;
    const distinguishing = isDistinguishing(group);
    let eligibleEntry = null;
    for (const e of group) {
      const d = concreteDisplay(e, norm, distinguishing);
      if (d !== display && d !== null) continue;
      eligibleEntry = e;
      if (!displayWl && display !== null && d === display) displayWl = wl;
      if (!commentWl && e.comment) commentWl = wl;
    }
    if (eligibleEntry) {
      sourceIds.push(wl.dbKey);
      eligibles.push({ wordlist: wl, score: eligibleEntry.score });
    }
  }
  const winner = pickWinner(eligibles, () => true, mode)?.wordlist;
  const active = new Set([winner, displayWl, commentWl].filter(Boolean).map(wl => wl.dbKey));
  const activeIds = sourceIds.filter(id => active.has(id));
  return { sourceIds, activeIds };
}

// Matching a merged row by list alone is sound only because a list has at most one
// entry eligible for a spelling (isDistinguishing concretizes a bare beside a sibling).
export function winsMergedRow(rows, wordlist, d, targetDisplay) {
  return rows.some(r => r.wordlist === wordlist
    && (targetDisplay == null || r.display === targetDisplay)
    && (d === null || d === r.display));
}

export function mergeKey(norm, display) {
  return norm + '\0' + (display ?? '');
}

// Keyed by mergeKey, not bare norm: entries sharing a norm but differing in
// display ("pgs"/"PGs") are distinct. Norm-keying collapses them last-wins and
// fabricates phantom rescores — fails silently, only visible in the update dialog.
//
// A comment-only change joins `affectedNorms` (the worker re-splices it so the
// shown comment updates) but NOT `rescored` (which counts score changes only —
// the dialog's notion); dropping either silently corrupts one consumer.
export function diffWordlistEntries(oldEntries, newEntries) {
  const keyer = entries => {
    const m = new Map();
    for (const e of entries) m.set(mergeKey(e.norm, e.display), e);
    return m;
  };
  const oldByKey = keyer(oldEntries);
  const newByKey = keyer(newEntries);

  const byNorm = (a, b) => a.norm.localeCompare(b.norm);
  const added = [], rescored = [], affected = new Set();
  for (const [key, e] of newByKey) {
    const prev = oldByKey.get(key);
    if (!prev) { added.push(e); affected.add(e.norm); }
    else {
      const scoreChanged = prev.score !== e.score;
      if (scoreChanged) rescored.push({ entry: e, oldScore: prev.score, score: e.score });
      if (scoreChanged || (prev.comment || '') !== (e.comment || '')) affected.add(e.norm);
    }
  }
  const deleted = [];
  for (const [key, e] of oldByKey) {
    if (!newByKey.has(key)) { deleted.push(e); affected.add(e.norm); }
  }

  added.sort(byNorm);
  deleted.sort(byNorm);
  rescored.sort((a, b) => byNorm(a.entry, b.entry));
  return { added, deleted, rescored, affectedNorms: [...affected] };
}

// The worker's in-place splice writes these rows over a built corpus, so they must
// match buildCorpus(sources, mode) exactly or the view silently drifts from a
// rebuild. No enabled filter: a scoped corpus shows its list even when disabled.
export function computeBucket(norm, sources, mode = 'first') {
  const bucket = newBucket();
  for (const wl of sources) {
    const group = sourceAccessor(wl).rescoredForNorm(norm);
    if (group !== undefined) addGroup(bucket, wl, norm, group);
  }
  const rows = [];
  const winners = [];
  resolveBucket(norm, bucket, mode, (row, winner) => {
    rows.push(row);
    if (winner) winners.push(winner);
  });
  rows.sort((a, b) => (a.display ?? '').localeCompare(b.display ?? ''));
  return { rows, winners };
}

export function computeMergedBucket(norm, sources, mode = 'first') {
  return computeBucket(norm, sources.filter(wl => wl.enabled), mode);
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

// Last tiebreak is code-unit order, not localeCompare: it ranks capitals above
// lowercase, which the rename hint's casing is tuned against.
export function preferRow(row, best) {
  const a = row.display ?? '', b = best.display ?? '';
  if (row.score !== best.score) return row.score > best.score;
  if (a.length !== b.length) return a.length < b.length;
  return a < b;
}

export function bestRowForNorm(merged, norm) {
  let best = null;
  for (const row of mergedRowsForNorm(merged, norm)) {
    if (!best || preferRow(row, best)) best = row;
  }
  return best;
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
// `bareFallback` lets a spelling that isn't in the merge fall through to the norm's
// rows instead of resolving to nothing. Deep links only: `?entry=BAGEL` against a
// corpus that spells it `bagel` is a hit a human means, whereas a click names a row
// that exists — and a batch rescore that silently retargeted a *different* spelling
// would write scores to the wrong entries.
export function resolveEditSeedWinner(merged, norm, display, bareFallback = false) {
  let row = merged.byKey.get(mergeKey(norm, display));
  // A bare click with no bare merged row edits the first-alphabetical spelled
  // variant — deterministic but arbitrary; don't "fix" the ordering.
  if (!row && (display == null || bareFallback)) {
    const variants = mergedRowsForNorm(merged, norm).filter(r => r.display != null);
    variants.sort((a, b) => a.display.localeCompare(b.display));
    row = variants[0] || bestRowForNorm(merged, norm);
  }
  return row ?? null;
}
