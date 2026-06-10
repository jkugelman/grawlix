'use strict';

// ─── Scoring (tier labels) ──────────────────────────────────────────────────

import { DEFAULT_SCORING } from '../core/constants.js';
import { parseRange, matchesRange } from '../engine/range.js';
import { state } from '../data/state.js';
import {
  scoringRulesEqual, getWordlistDefaultRules, rescoreRulesEqual, compileRescoreRules,
} from '../data/rescoring.js';
import { invalidateWordlistCaches } from '../data/invalidate.js';
import { persistMeta, persistScoring, repaintAfterCacheChange } from '../data/persist.js';

export function updateScoringDirty() {
  state.scoringDirty = !scoringRulesEqual(state.scoring, DEFAULT_SCORING);
}

export function propagateDefaults() {
  if (!scoringRulesEqual(state.scoring, DEFAULT_SCORING) && !state.scoringDirty) {
    state.scoring = DEFAULT_SCORING.map(r => ({ ...r }));
    persistScoring();
  }
  let metaTouched = false;
  for (const wordlist of state.sources) {
    const defaults = getWordlistDefaultRules(wordlist);
    if (defaults === null) continue;
    if (!rescoreRulesEqual(wordlist.rescoreRules, defaults) && !wordlist.dirty) {
      wordlist.rescoreRules = defaults.map(r => ({ ...r }));
      compileRescoreRules(wordlist);
      invalidateWordlistCaches(wordlist);
      metaTouched = true;
    }
  }
  if (metaTouched) {
    persistMeta();
    repaintAfterCacheChange();
  }
}

export function makeScoringRowStub(input = '') { return { input, note: '' }; }

// Returns a `score → tier label` function. First matching rule wins; an
// empty note collapses to '' so callers can skip the tooltip entirely.
export function makeTierLookup() {
  const rules = state.scoring
    .map(r => ({ note: r.note || '', intervals: parseRange(r.input) }))
    .filter(r => r.intervals);
  return score => {
    for (const r of rules) if (matchesRange(score, r.intervals)) return r.note;
    return '';
  };
}
