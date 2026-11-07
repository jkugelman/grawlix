'use strict';

import { buildHelpHTML } from '../core/util.js';

export function parseRange(str) {
  const m = (str || '').trim().match(/^(\d+)(?:(\+)|[-–](\d+))?$/);
  if (!m) return null;
  const min = +m[1], max = m[2] ? null : m[3] !== undefined ? +m[3] : min;
  return max !== null && max < min ? null : { min, max };
}

// A trailing comma passes so the filter doesn't clear while `13, 15` is typed.
export function parseRanges(str) {
  const out = [];
  for (const item of (str || '').trim().replace(/,\s*$/, '').split(',')) {
    const r = parseRange(item);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

export const SCORE_RANGE_HELP = buildHelpHTML([
  ['50', 'exact score'],
  ['30+', 'minimum score'],
  ['30-50', 'score range'],
  ['30-40,60+', 'any of these'],
], { cols: 1 });

export const TIER_RANGE_HELP = buildHelpHTML([
  ['50', 'exact score'],
  ['30+', 'minimum score'],
  ['30-50', 'score range'],
], { cols: 1 });

export const LENGTH_HELP = buildHelpHTML([
  ['blank', 'any length', { ghost: true }],
  ['7', 'exact length'],
  ['5+', 'minimum length'],
  ['5-7', 'length range'],
  ['13,15', 'any of these'],
], { cols: 1 });

export function inRange(value, { min, max }) {
  return value >= min && (max === null || value <= max);
}

export function matchesRange(value, ranges) {
  for (const r of ranges) if (inRange(value, r)) return true;
  return false;
}

// Null when neither range is set — every caller keys its unfiltered fast path and
// its shipped `filtered` flag off that null, so returning an empty object instead
// silently marks unfiltered results filtered.
export function parseViewFilter({ scoreRange, lengthRange }) {
  const score  = scoreRange  ? parseRanges(scoreRange)  : null;
  const length = lengthRange ? parseRanges(lengthRange) : null;
  return (score || length) ? { score, length } : null;
}
