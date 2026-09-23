'use strict';

import { toNorm, wordBreaks, spansWords } from '../norm.js';
import { loadSpacingCorpus } from '../space-out.js';
import { SPAN_PARAM, matchModeOf, matchModeReadsWords, matchModeAssets, matchModeSpacingLazy } from './shared.js';

function build(params, spacing) {
  const needle = toNorm(params.entry || '');
  if (!needle) return null;
  const need = new Map();
  for (const ch of needle) need.set(ch, (need.get(ch) || 0) + 1);
  return { needle, need, len: needle.length, spanning: matchModeOf(params) === 'span', spacing };
}

export default {
  name: 'Hidden anagram', icon: '🫥', category: 'anagram',
  desc: 'Anagrams hidden inside longer words',
  example: 'inside → windiest',
  params: [{ placeholder: 'entry' }, SPAN_PARAM],
  kind: 'filter', input: 'highlight', output: 'plain',
  matchOn: 'both',
  isInert: params => !toNorm((params && params.entry) || ''),
  assets: matchModeAssets,
  // Reads on demand rather than building the table: the anagram window leaves so
  // few candidates that building would make the first keystroke the slowest.
  async prepare(params, ctx) {
    if (matchModeReadsWords(params)) await loadSpacingCorpus();
    return build(params, matchModeSpacingLazy(params, ctx));
  },
  replay: (params, ctx) => build(params, matchModeSpacingLazy(params, ctx)),
  run(wlEntry, target, wordlist) {
    if (!target) return true;
    const { needle, need, len, spanning, spacing } = target;
    const entry = wlEntry.norm;
    if (entry.length <= len) return false;   // hidden inside a *longer* word — a whole-word anagram is the Anagrams tool
    let breaks = null;

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
            && (!spanning || spansWords(breaks ??= wordBreaks(wlEntry, spacing), start, start + len)))
          return [{ start, end: start + len, kind: 'search:0' }];
      }
    }
    return false;
  },
};
