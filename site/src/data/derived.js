'use strict';

// ─── Derived layouts ──────────────────────────────────────────────────────────

import { MERGED_ID } from '../core/constants.js';
import { state, syncKey } from './state.js';
import { getRescoredEntries } from './rescoring.js';
import { getActiveCorpus } from './merge.js';
import { getHistogramLayout } from '../engine/histogram.js';

export function* allSourcesScores() {
  for (const wl of state.sources) yield* getRescoredEntries(wl);
}

export function scopedHistogramLayout() {
  const scoreSource = state.selected === MERGED_ID ? allSourcesScores() : getActiveCorpus().entries;
  return getHistogramLayout(scoreSource, 'scoped:' + syncKey(state.selected));
}

// A fixed all-sources axis, used by scoreColor's badge gradient: pointing it at
// the scoped axis would shift badge colors on every scope change, a
// regression no error would surface.
export function allSourcesHistogramLayout() {
  return getHistogramLayout(allSourcesScores(), 'all');
}
