'use strict';

// ─── Rescoring ────────────────────────────────────────────────────────────────

import { parseRange, matchesRange, rangeSpan } from '../engine/range.js';
import { invalidateHistogramLayout } from '../engine/histogram.js';
import { state } from './state.js';
import { getPublisher } from './publishers.js';
import { DEFAULT_SCORING } from '../core/constants.js';

export function scoresToRangeStr(scores) {
  if (!scores.length) return '';
  const sorted = [...scores].sort((a, b) => a - b);
  const min = sorted[0], max = sorted[sorted.length - 1];
  return min === max ? `${min}` : `${min}-${max}`;
}

export function getRuleMaxScore(rule) {
  const intervals = parseRange(rule.input);
  if (!intervals) return -1;
  let max = -Infinity;
  for (const { max: imax } of intervals) {
    const m = imax === null ? Infinity : imax;
    if (m > max) max = m;
  }
  return max;
}

export function outputSortKey(rule) {
  const s = parseRuleOutput(rule.output);
  if (typeof s === 'number') return s;
  if (s && typeof s === 'object') return s.max === null ? s.min : (s.min + s.max) / 2;
  return getRuleMaxScore(rule); // 'unchanged' sorts by input score
}

// Equality for rule arrays. Drives the dirty flag and the boot-time silent
// propagation of dev-shipped default updates.
export function rescoreRulesEqual(a, b) {
  const au = [...(a || [])].sort(compareRescoreRulesForPriority);
  const bu = [...(b || [])].sort(compareRescoreRulesForPriority);
  if (au.length !== bu.length) return false;
  return au.every((r, i) => {
    const o = bu[i];
    return r.input === o.input
      && (r.length || '') === (o.length || '')
      && (r.output || '') === (o.output || '')
      && (r.note   || '') === (o.note   || '');
  });
}

export function scoringRulesEqual(a, b) {
  const au = a || [];
  const bu = b || [];
  if (au.length !== bu.length) return false;
  return au.every((r, i) => {
    const o = bu[i];
    return r.input === o.input && (r.note || '') === (o.note || '');
  });
}

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

// On fetch/import of a custom wordlist (no publisherId) with empty rescore
// rules and ≤10 distinct scores, seed one inert row per distinct score —
// blank output, so scores pass through unchanged. Lays the source's scale
// out as concrete rows next to All Wordlists' tier scale; the user can fill in
// output mappings if they want to translate into the unified scale.
// See docs/design.md § Rescore rules.
const AUTO_SEED_SCORE_LIMIT = 10;

export function makeRescoreRuleStub(input = '') { return { input, length: '', output: '', note: '' }; }

export function maybeAutoSeedRescoreRules(wordlist) {
  if (wordlist.publisherId) return;
  if (wordlist.rescoreRules?.length) return;
  const scores = [...new Set(wordlist.rawEntries.map(e => e.score))];
  if (!scores.length || scores.length > AUTO_SEED_SCORE_LIMIT) return;
  scores.sort((a, b) => a - b);
  wordlist.rescoreRules = scores.map(s => makeRescoreRuleStub(String(s)));
}

// A pristine tier legend mislabels a foreign-scaled import, so a misaligned
// import discards it and auto-seeds the actual scale instead.
export function reconcileEditsRulesAfterImport(edits) {
  if (edits.dirty) return;
  const tierIntervals = editsLegend().map(r => parseRange(r.input)).filter(Boolean);
  const aligned = edits.rawEntries.every(e => tierIntervals.some(iv => matchesRange(e.score, iv)));
  if (aligned) return;
  edits.rescoreRules = [];
  maybeAutoSeedRescoreRules(edits);
  updateWordlistDirty(edits);
}

// First-match-wins: narrower rules must precede broader supersets or never fire.
export function compareRescoreRulesForPriority(a, b) {
  const am = getRuleMaxScore(a), bm = getRuleMaxScore(b);
  if (am !== bm) return bm - am;
  const ais = rangeSpan(a.input), bis = rangeSpan(b.input);
  if (ais !== bis) return ais - bis;
  const aLF = !!(a.length && a.length.trim()), bLF = !!(b.length && b.length.trim());
  if (aLF !== bLF) return aLF ? -1 : 1;
  if (aLF) {
    const als = rangeSpan(a.length), bls = rangeSpan(b.length);
    if (als !== bls) return als - bls;
  }
  return outputSortKey(b) - outputSortKey(a);
}

export function compileRescoreRules(wordlist) {
  const rules = wordlist.rescoreRules;
  rules.sort(compareRescoreRulesForPriority);
  rules.forEach(compileRule);
}

export function parseRuleOutput(str) {
  str = (str || '').trim().toLowerCase();
  if (!str) return 'unchanged';
  const mRange = str.match(/^(\d+)[-–](\d+)$/);
  if (mRange) return { min: +mRange[1], max: +mRange[2] };
  const mPlus  = str.match(/^(\d+)\+$/);
  if (mPlus)  return { min: +mPlus[1], max: null };
  const mExact = str.match(/^(\d+)$/);
  return mExact ? +mExact[1] : null;
}

export function compileRule(rule) {
  rule._scoreIntervals = parseRange(rule.input);
  rule._lenIntervals   = (rule.length && rule.length.trim()) ? parseRange(rule.length) : null;
  rule._output         = parseRuleOutput(rule.output);
}

export function applyRescoring(entries, rules) {
  return entries.map(e => {
    const score = rescoreEntry(e, rules);
    return score !== e.score ? { ...e, score, rawScore: e.score } : e;
  });
}

export function getRescoredEntries(wordlist) {
  return wordlist._rescored ??= applyRescoring(wordlist.rawEntries, wordlist.rescoreRules);
}

export function getRescoredMap(wordlist) {
  if (wordlist._rescoredMap) return wordlist._rescoredMap;
  const map = new Map();
  for (const e of getRescoredEntries(wordlist)) map.set(e.norm, e);
  wordlist._rescoredMap = map;
  return map;
}

// norm → all rescored entries for that norm. Distinct from `getRescoredMap`,
// which keeps one entry per norm: a faithful single-norm merged rebuild must
// see every display variant a wordlist holds, not just the last.
export function getRescoredByNorm(wordlist) {
  if (wordlist._rescoredByNorm) return wordlist._rescoredByNorm;
  const map = new Map();
  for (const e of getRescoredEntries(wordlist)) {
    let arr = map.get(e.norm);
    if (!arr) map.set(e.norm, arr = []);
    arr.push(e);
  }
  return wordlist._rescoredByNorm = map;
}

export function rescoreEntry(wlEntry, rules) {
  for (const rule of rules) {
    const scoreIntervals = rule._scoreIntervals !== undefined ? rule._scoreIntervals : parseRange(rule.input);
    if (!scoreIntervals || !matchesRange(wlEntry.score, scoreIntervals)) continue;
    if (rule.length && rule.length.trim()) {
      const lenIntervals = rule._lenIntervals !== undefined ? rule._lenIntervals : parseRange(rule.length);
      if (!lenIntervals || !matchesRange(wlEntry.norm.length, lenIntervals)) continue;
    }
    const s = rule._output !== undefined ? rule._output : parseRuleOutput(rule.output);
    if (s === null) continue;
    if (s === 'unchanged') return wlEntry.score;
    if (s && typeof s === 'object') {
      const iv = scoreIntervals[0];
      if (iv.max === null && s.max === null) {
        // Both N+: shift by the difference
        return wlEntry.score + (s.min - iv.min);
      }
      // Bounded range: linearly scale; skip if shapes don't match or input is degenerate
      if (iv.min === null || iv.max === null || s.max === null || iv.min === iv.max) continue;
      const t = (wlEntry.score - iv.min) / (iv.max - iv.min);
      return Math.round(s.min + t * (s.max - s.min));
    }
    return s; // first matching rule wins
  }
  return wlEntry.score;
}

export function invalidateRescoredCache(wordlist) {
  wordlist._rescored = null;
  wordlist._rescoredMap = null;
  wordlist._rescoredByNorm = null;
  invalidateHistogramLayout();
}
