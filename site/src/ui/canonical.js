'use strict';

// ─── Entry canonical-form orchestration ──────────────────────────────────────
//
// Joins the segmenter spacing (worker) to the reference resolution (engine); the
// panel's rename hint and the lookup fallback both route here so one cache and
// one whole-word suppressor serve both.

import { toNorm } from '../engine/norm.js';
import { resolveReference } from '../engine/canonical.js';
import { fetchWorkerSpaceOut } from './pipeline-worker.js';

const cache = new Map();

function computeCanonical(display) {
  const norm = toNorm(display);
  if (!norm) return Promise.resolve(display);
  const hasSpace = /\s/.test(display);
  return (async () => {
    let fallback = display;
    let ref;
    if (hasSpace) {
      ref = await resolveReference(display, norm);
    } else {
      // A same-norm reference form for the bare, unsplit entry means it's a real
      // word — take it and never offer a split (the whole-word suppressor).
      ref = await resolveReference(display, norm);
      if (!ref) {
        fallback = (await fetchWorkerSpaceOut(norm)) || display;
        if (fallback !== display) ref = await resolveReference(fallback, norm);
      }
    }
    if (ref) return ref;
    // Plural fallback: a plural can't match its singular's reference form under the
    // exact-norm guard (DNA sequencer ≠ dnasequencers). Re-add the "s" and norm-check
    // the result, so the singular's casing/accents carry over while a wrong stem
    // still can't slip through.
    if (norm.length > 3 && display.endsWith('s')) {
      const stem = norm.slice(0, -1);
      // Short-circuit: the plural's own lookup may already hold the singular (a
      // full-text hit or a redirect); the fetches are memoized, so re-resolving
      // `fallback` against the singular norm reuses them at no network cost.
      const near = await resolveReference(fallback, stem);
      if (near && toNorm(near + 's') === norm) return near + 's';
      // Long path: the singular has a query of its own (a Wikipedia entity whose
      // plural isn't a redirect), so resolve it from scratch and re-inflect.
      const singular = await resolveEntryCanonical(display.slice(0, -1));
      if (toNorm(singular + 's') === norm) return singular + 's';
    }
    return fallback;
  })();
}

export function resolveEntryCanonical(display) {
  let p = cache.get(display);
  if (!p) { p = computeCanonical(display); cache.set(display, p); }
  return p;
}
