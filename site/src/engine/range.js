'use strict';

import { buildHelpHTML } from '../core/util.js';

export function parseRange(str) {
  str = (str || '').trim();
  if (!str) return null;
  const mPlus  = str.match(/^(\d+)\+$/);        if (mPlus)  return [{ min: +mPlus[1],  max: null }];
  const mRange = str.match(/^(\d+)[-–](\d+)$/); if (mRange) return [{ min: +mRange[1], max: +mRange[2] }];
  const mExact = str.match(/^(\d+)$/);          if (mExact) return [{ min: +mExact[1], max: +mExact[1] }];
  return null;
}

export const SCORE_RANGE_HELP = buildHelpHTML([
  ['50', 'exact score'],
  ['30+', 'minimum score'],
  ['30-50', 'score range'],
], { cols: 1 });

export const LENGTH_HELP = buildHelpHTML([
  ['blank', 'any length', { ghost: true }],
  ['7', 'exact length'],
  ['5+', 'minimum length'],
  ['5-7', 'length range'],
], { cols: 1 });

export function matchesRange(value, intervals) {
  for (const { min, max } of intervals) {
    if ((min === null || value >= min) && (max === null || value <= max)) return true;
  }
  return false;
}

// Null when neither range is set — every caller keys its unfiltered fast path and
// its shipped `filtered` flag off that null, so returning an empty object instead
// silently marks unfiltered results filtered.
export function parseViewFilter({ scoreRange, lengthRange }) {
  const score  = scoreRange  ? parseRange(scoreRange)  : null;
  const length = lengthRange ? parseRange(lengthRange) : null;
  return (score || length) ? { score, length } : null;
}

export function rangeSpan(str) {
  if (!str || !str.trim()) return Infinity;
  const intervals = parseRange(str);
  if (!intervals) return Infinity;
  let total = 0;
  for (const { min, max } of intervals) {
    if (max === null) return Infinity;
    total += max - min;
  }
  return total;
}
