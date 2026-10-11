'use strict';

// ─── Rescoring ────────────────────────────────────────────────────────────────

import { buildHelpHTML, scoreQuery } from '../core/util.js';
import { compileQuery, ruleSubject } from './rule-query.js';

export const OUTPUT_HELP = buildHelpHTML([
  ['blank', 'unchanged', { ghost: true }],
  ['50', 'new score'],
], { cols: 1 });

// Order-sensitive: rules evaluate first-match-wins in their stored order (the
// user owns it via drag), so a reorder is a real change — it must flip dirty
// and survive default propagation.
export function rescoreRulesEqual(a, b) {
  const au = a || [], bu = b || [];
  if (au.length !== bu.length) return false;
  return au.every((r, i) => {
    const o = bu[i];
    return (r.query || '').trim() === (o.query || '').trim()
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

// On fetch/import of a custom wordlist (no publisherId) with empty rescore
// rules and ≤10 distinct scores, seed one inert row per distinct score —
// blank output, so scores pass through unchanged. Lays the source's scale
// out as concrete rows next to All Wordlists' tier scale; the user can fill in
// output mappings if they want to translate into the unified scale.
// See docs/wordlists.md § Rescore rules.
const AUTO_SEED_SCORE_LIMIT = 10;

export function makeRescoreRuleStub(query = '') { return { query, output: '', note: '' }; }

// Takes the entries explicitly (not wordlist.rawEntries): main doesn't retain a
// non-Edits source's rawEntries, so the caller passes its transient parse.
export function maybeAutoSeedRescoreRules(wordlist, entries) {
  if (wordlist.publisherId) return;
  if (wordlist.rescoreRules?.length) return;
  const scores = [...new Set(entries.map(e => e.score))];
  if (!scores.length || scores.length > AUTO_SEED_SCORE_LIMIT) return;
  scores.sort((a, b) => a - b);
  wordlist.rescoreRules = scores.map(s => makeRescoreRuleStub(scoreQuery(String(s))));
}

export function compileRescoreRules(wordlist) {
  wordlist.rescoreRules.forEach(compileRule);
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
  const { match, errors, scoreInterval } = compileQuery(rule.query);
  rule._match = match;
  rule._errors = errors;
  rule._scoreInterval = scoreInterval;
  rule._output = parseRuleOutput(rule.output);
  rule._outputError = ruleOutputError(rule);
}

export function ruleOutputError(rule) {
  const out = rule._output;
  if (out === null) return 'Use a score like 50, or leave it blank to keep the score.';
  if (!out || typeof out !== 'object') return null;
  const iv = rule._scoreInterval;
  if (out.max === null) {
    if (!iv || iv.max !== null) return 'A score like 60+ needs the condition to have one score like 50+.';
  } else if (!iv || iv.max === null || iv.min === iv.max) {
    return 'A score like 20-39 needs the condition to have one score range like 30-49.';
  }
  return null;
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

// norm → the rescored entries for that norm — every display variant a wordlist
// holds, so a faithful single-norm merged rebuild sees them all, not just the last.
//
// The value is a BARE entry for the ~99.99% of norms with one rescored entry, and
// an entry[] ONLY for the rare norm carrying display variants (e.g. one list with
// both "the IRS" and "THEIRS"). A wrapper array per norm cost ~44 MB resident on
// the worker heap at ~1.2M norms — fatal on iOS's shared budget; the scalar shape
// removes it. Read through `groupEntries`, which normalizes both shapes.
export function getRescoredByNorm(wordlist) {
  if (wordlist._rescoredByNorm) return wordlist._rescoredByNorm;
  const map = new Map();
  for (const e of getRescoredEntries(wordlist)) {
    const cur = map.get(e.norm);
    if (cur === undefined) map.set(e.norm, e);
    else if (Array.isArray(cur)) cur.push(e);
    else map.set(e.norm, [cur, e]);
  }
  return wordlist._rescoredByNorm = map;
}

// The entries at one norm, scalar-or-array transparent. The scalar's wrapper is
// transient — never retained, so it can't reconstitute the array pile.
export function groupEntries(group) {
  if (group === undefined) return [];
  return Array.isArray(group) ? group : [group];
}

export function rescoreEntry(wlEntry, rules) {
  return rescoreFields(wlEntry.score, wlEntry.norm, wlEntry.display, rules);
}

export function rescoreFields(score, norm, display, rules) {
  const subject = ruleSubject(score, norm, display);
  for (const rule of rules) {
    if (rule._match === undefined) compileRule(rule);
    if (!rule._match || rule._outputError || !rule._match(subject)) continue;
    const s = rule._output;
    if (s === 'unchanged') return score;
    if (typeof s === 'object') {
      const iv = rule._scoreInterval;
      if (s.max === null) return score + (s.min - iv.min);
      const t = (score - iv.min) / (iv.max - iv.min);
      return Math.round(s.min + t * (s.max - s.min));
    }
    return s; // first matching rule wins
  }
  return score;
}
