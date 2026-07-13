'use strict';

import { toNorm, matchSpansWords } from '../norm.js';
import { SPAN_PARAM, matchModeOf } from './shared.js';

export default {
  name: 'Hidden anagram', icon: '🫥', category: 'anagram',
  desc: 'Anagrams hidden inside longer words',
  example: 'inside → windiest',
  params: [{ placeholder: 'entry' }, SPAN_PARAM],
  kind: 'filter', inputHighlights: true, outputHighlights: false,
  matchOn: 'both',
  isInert: params => !toNorm((params && params.entry) || ''),
  prepare(params) {
    const needle = toNorm(params.entry || '');
    if (!needle) return null;
    const need = new Map();
    for (const ch of needle) need.set(ch, (need.get(ch) || 0) + 1);
    return { needle, need, len: needle.length, spansWords: matchModeOf(params) === 'span' };
  },
  run(wlEntry, target, wordlist) {
    if (!target) return true;
    const { needle, need, len, spansWords } = target;
    const entry = wlEntry.norm;
    if (entry.length <= len) return false;   // hidden inside a *longer* word — a whole-word anagram is the Anagrams tool
    if (spansWords && wlEntry.display == null) return false;

    // A window covering every required letter (deficit 0) can hold no stray one —
    // it's the needle's length — so containment alone is a full anagram test.
    const have = new Map();
    let deficit = len;
    for (let i = 0; i < entry.length; i++) {
      const add = entry[i], na = need.get(add);
      if (na !== undefined) {
        const h = have.get(add) || 0;
        if (h < na) deficit--;
        have.set(add, h + 1);
      }
      if (i >= len) {
        const drop = entry[i - len], nd = need.get(drop);
        if (nd !== undefined) {
          const h = have.get(drop);
          have.set(drop, h - 1);
          if (h - 1 < nd) deficit++;
        }
      }
      if (i >= len - 1 && deficit === 0) {
        const start = i - len + 1;
        // Require a real rearrangement: the input spelled straight is containment, not an anagram.
        if (entry.slice(start, start + len) !== needle
            && (!spansWords || matchSpansWords(wlEntry, start, start + len)))
          return [{ start, end: start + len, kind: 'search:0' }];
      }
    }
    return false;
  },
};
