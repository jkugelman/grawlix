'use strict';

import { displayOf, normToDisplayMap } from '../norm.js';
import { bestRowForNorm } from '../corpus.js';

const CIRCLED = (() => {
  const m = { '0': '⓪' };
  for (let i = 0; i < 26; i++) m[String.fromCharCode(97 + i)] = String.fromCodePoint(0x24D0 + i);
  for (let i = 1; i <= 9; i++) m[String(i)] = String.fromCodePoint(0x245F + i);
  return m;
})();

export default {
  name: 'Optional letters', icon: '🎈', category: 'optional',
  desc: 'Letters that can be dropped to leave another entry',
  example: 'hart → haⓡt',
  params: [],
  kind: 'transform',
  matchOn: 'both',
  inputHighlights: true, outputHighlights: false,
  glyph: () => '→',
  run(wlEntry, prepared, wordlist) {
    const norm = wlEntry.norm;
    if (norm.length < 2) return [];
    const display = displayOf(wlEntry);
    const map = normToDisplayMap(wlEntry);

    const hits = [];
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === norm[i - 1]) continue;
      const reduced = norm.slice(0, i) + norm.slice(i + 1);
      if (!wordlist.norms.has(reduced)) continue;
      const d = map ? map[i] : i;
      // One display char can back several norm chars (æ → ae); half of it can't circle.
      if (map && (map[i - 1] === d || map[i + 1] === d)) continue;
      hits.push({ i, d, reduced });
    }
    if (!hits.length) return [];

    // Once per norm, not per spelling: a grid slot holds the letters either way.
    if (wlEntry.wordlist !== null && bestRowForNorm(wordlist, norm) !== wlEntry) return [];

    return hits.map(({ i, d, reduced }) => ({
      entry: [
        display.slice(0, d) + CIRCLED[norm[i]] + display.slice(d + 1),
        Math.min(wlEntry.score, bestRowForNorm(wordlist, reduced).score),
      ],
      inputHighlights: [{ start: i, end: i + 1, kind: 'removed' }],
    }));
  },
};
