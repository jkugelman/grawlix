'use strict';

// ─── Score colors ───────────────────────────────────────────────────────────

import { allSourcesHistogramLayout } from '../data/derived.js';
import { state } from '../data/state.js';
import { esc } from '../core/util.js';
import { makeTierLookup } from './scoring.js';

// t positions are hand-picked so that on the canonical 0–60 scale, scores
// 30/40/50/60 land directly on stops (orange/yellow/green/blue).
export const SCORE_COLOR_STOPS = [
  { t: 0,   bg: '--score-0-bg', fg: '--score-0-fg' },
  { t: 1/6, bg: '--score-0-bg', fg: '--score-0-fg' },
  { t: 1/3, bg: '--score-1-bg', fg: '--score-1-fg' },
  { t: 1/2, bg: '--score-2-bg', fg: '--score-2-fg' },
  { t: 2/3, bg: '--score-3-bg', fg: '--score-3-fg' },
  { t: 5/6, bg: '--score-4-bg', fg: '--score-4-fg' },
  { t: 1,   bg: '--score-5-bg', fg: '--score-5-fg' },
];

// Out-of-range scores clamp to the nearest endpoint. With no data loaded,
// falls back to the middle stop (a gradient is meaningless without a range).
export function scoreColor(score) {
  const { min, max } = allSourcesHistogramLayout();
  if (min == null || max == null || max <= min) {
    const s = SCORE_COLOR_STOPS[Math.floor(SCORE_COLOR_STOPS.length / 2)];
    return { bg: `var(${s.bg})`, fg: `var(${s.fg})` };
  }
  const t = Math.max(0, Math.min(1, (score - min) / (max - min)));
  let i = 0;
  while (i < SCORE_COLOR_STOPS.length - 1 && SCORE_COLOR_STOPS[i + 1].t < t) i++;
  const lo = SCORE_COLOR_STOPS[i];
  const hi = SCORE_COLOR_STOPS[i + 1];
  const localT = (t - lo.t) / (hi.t - lo.t);
  const pct = (localT * 100).toFixed(1);
  return {
    bg: `color-mix(in lch, var(${lo.bg}), var(${hi.bg}) ${pct}%)`,
    fg: `color-mix(in lch, var(${lo.fg}), var(${hi.fg}) ${pct}%)`,
  };
}

// Cache keyed on state.scoring identity — load-bearing only because tiers are
// always reassigned, never mutated in place; an in-place edit would stale this.
let _tierLookup = null, _tierLookupFor = null;
function tierLabelFor(score) {
  if (state.scoring !== _tierLookupFor) {
    _tierLookupFor = state.scoring;
    _tierLookup = makeTierLookup();
  }
  return _tierLookup(score);
}

export function buildScoreBadgeHTML(score) {
  const { bg, fg } = scoreColor(score);
  const tier = tierLabelFor(score);
  const title = tier ? ` title="${esc(tier)}"` : '';
  // The tier lives only in the title tooltip, which a screen reader ignores — name it.
  const aria = ` aria-label="score ${score}${tier ? ', ' + esc(tier) : ''}"`;
  return `<span class="score-badge"${title}${aria} style="--score-bg:${bg}; --score-fg:${fg}">${score}</span>`;
}

export function buildScoreCellHTML(wlEntry, preview) {
  if (preview && wlEntry.rawScore != null && wlEntry.rawScore !== wlEntry.score) {
    return `<span class="atom-score-raw">${wlEntry.rawScore}</span>`
      + `<span class="atom-score-arrow">→</span>`
      + buildScoreBadgeHTML(wlEntry.score);
  }
  return buildScoreBadgeHTML(wlEntry.score);
}
