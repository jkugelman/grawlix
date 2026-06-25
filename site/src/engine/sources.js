'use strict';

// ─── Per-source entry store: the materialization boundary ─────────────────────
//
// One accessor interface over a wordlist's per-source entries, read the same way
// whether a source is object-backed (My Edits) or columnar (every other source).
// It yields transient views the caller consumes and lets GC — retaining them
// would rebuild the per-source object pile this boundary exists to avoid.
//
// Bulk traversal yields per-NORM groups, not per-entry: the merge computes
// `isDistinguishing` once per same-norm group before mapping `concreteDisplay`
// over its members, so a per-entry callback couldn't reconstruct that whole-group
// property.

import { getRescoredEntries, getRescoredByNorm, groupEntries } from './rescore.js';

export function sourceAccessor(wl) {
  return wl._accessor ??= (wl.cols ? columnarAccessor(wl) : objectAccessor(wl));
}

// The columnar adapter closes over `wl.cols`; a column rebuild MUST clear this or
// the cached accessor silently keeps reading the pre-rebuild columns.
export function invalidateSourceAccessor(wl) {
  wl._accessor = null;
}

// Views ARE the objects getRescoredEntries already caches, so the merge sees the
// identical entries it always did — the indirection is behavior-free for objects.
function objectAccessor(wl) {
  return {
    get count() { return wl.rawEntries.length; },
    hasNorm: norm => getRescoredByNorm(wl).has(norm),
    rescoredForNorm(norm) {
      const g = getRescoredByNorm(wl).get(norm);
      return g === undefined ? undefined : groupEntries(g);
    },
    forEachGroup(cb) {
      for (const [norm, g] of getRescoredByNorm(wl)) cb(norm, groupEntries(g));
    },
    collectRescored: () => getRescoredEntries(wl),
    *scores() { for (const e of getRescoredEntries(wl)) yield e.score; },
    collectRaw: () => wl.rawEntries,
  };
}

function columnarAccessor(_wl) {
  throw new Error('columnar source accessor not yet implemented');
}
