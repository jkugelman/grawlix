'use strict';

// ─── Rescoring ────────────────────────────────────────────────────────────────

import { parseRange, matchesRange } from '../engine/range.js';
import { rescoreRulesEqual, maybeAutoSeedRescoreRules } from '../engine/rescore.js';
import { invalidateHistogramLayout } from '../engine/histogram.js';
import { state } from './state.js';
import { getPublisher } from './publishers.js';

// The My Edits legend: an inert mirror of All Wordlists' tier scale, one blank-output row
// per tier. Sourced from the live tiers (state.scoring), not frozen
// DEFAULT_SCORING — otherwise customizing All Wordlists' tiers would silently desync the
// legend My Edits shows. Outputs stay blank (scoring rows carry none), so
// propagateDefaults can push it onto a non-dirty My Edits without re-grading.
export function editsLegend() {
  return state.scoring.map(({ input, note }) => ({ input, length: '', output: '', note }));
}

export function getWordlistDefaultRules(wordlist) {
  if (wordlist.type === 'edits') return editsLegend();
  const publisher = getPublisher(wordlist);
  return publisher?.defaultRules ?? null;
}

// Recompute the dirty flag after a rule mutation. Custom wordlists (no
// defaults) keep `dirty` undefined and don't participate in propagation.
export function updateWordlistDirty(wordlist) {
  const defaults = getWordlistDefaultRules(wordlist);
  if (defaults === null) return;
  wordlist.dirty = !rescoreRulesEqual(wordlist.rescoreRules, defaults);
}

// A pristine tier legend mislabels a foreign-scaled import, so a misaligned
// import discards it and auto-seeds the actual scale instead.
export function reconcileEditsRulesAfterImport(edits) {
  if (edits.dirty) return;
  const tierIntervals = editsLegend().map(r => parseRange(r.input)).filter(Boolean);
  const aligned = edits.rawEntries.every(e => tierIntervals.some(iv => matchesRange(e.score, iv)));
  if (aligned) return;
  edits.rescoreRules = [];
  maybeAutoSeedRescoreRules(edits, edits.rawEntries);   // My Edits' entries are resident
  updateWordlistDirty(edits);
}

export function invalidateRescoredCache(wordlist) {
  wordlist._rescored = null;
  wordlist._rescoredByNorm = null;
  invalidateHistogramLayout();
}
