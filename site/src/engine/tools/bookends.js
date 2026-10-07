'use strict';

import { toNorm } from '../norm.js';

export function bookendSplits(entry, word) {
  const w = word.length;
  if (entry.length <= w) return null;
  let lo = 0, hi = 0;
  for (let k = 1; k < w; k++) {
    if (entry.startsWith(word.slice(0, k)) && entry.endsWith(word.slice(k))) {
      if (!lo) lo = k;
      hi = k;
    }
  }
  return lo ? { lo, hi } : null;
}

export default {
  name: 'Bookends', icon: '📚', category: 'side',
  desc: 'Word split across both ends',
  example: 'book → Babadook',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', input: 'highlight', output: 'plain',
  isInert: params => toNorm((params && params.entry) || '').length < 2,
  prepare: params => toNorm(params.entry || ''),
  run(entry, word, wordlist) {
    const split = bookendSplits(entry, word);
    if (!split) return false;
    // The word whole at either end widens only the ambiguous span: as a split it would match the word itself.
    const lo = entry.endsWith(word) ? 0 : split.lo;
    const hi = entry.startsWith(word) ? word.length : split.hi;
    const L = entry.length, w = word.length;
    const ranges = [];
    if (lo) ranges.push({ start: 0, end: lo, kind: 'search:0' });
    if (hi < w) ranges.push({ start: L - (w - hi), end: L, kind: 'search:0' });
    if (hi > lo) {
      const endStart = L - (w - lo), endEnd = L - (w - hi);
      // Overlapping marks must merge: the renderer drops any range that starts inside another.
      if (endStart < hi) ranges.push({ start: lo, end: endEnd, kind: 'ambiguous' });
      else ranges.push({ start: lo, end: hi, kind: 'ambiguous' }, { start: endStart, end: endEnd, kind: 'ambiguous' });
    }
    return ranges;
  },
  column: {
    key: 'split', label: 'Split',
    value: (entry, word) => {
      const { hi } = bookendSplits(entry, word);
      return word.slice(0, hi) + '…' + word.slice(hi);
    },
    order: (entry, word) => bookendSplits(entry, word).hi,
    width: params => toNorm((params && params.entry) || '').length + 1,
  },
};
