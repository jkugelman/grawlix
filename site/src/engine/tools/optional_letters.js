'use strict';

import { displayOf, normToDisplayMap, toNorm } from '../norm.js';
import { bestRowForNorm } from '../corpus.js';
import { looksPlural } from './shared.js';

const CIRCLED = (() => {
  const m = { '0': '⓪' };
  for (let i = 0; i < 26; i++) m[String.fromCharCode(97 + i)] = String.fromCodePoint(0x24D0 + i);
  for (let i = 1; i <= 9; i++) m[String(i)] = String.fromCodePoint(0x245F + i);
  return m;
})();

// Not in looksPlural: that answers "is this a plural", while this answers "is the
// mark worth a row". yours/theirs/its are not plurals either and stay skipped --
// a hidden possessive S is as dull as a hidden plural one.
const KEEP_S = new Set(['his', 'as', 'is', 'has', 'yes', 'does', 'news']);

// Each plural-looking word's last norm index. Offsets simply accumulate: the norm
// is the words' norms run together, so a space costs no index.
function pluralWordEnds(display) {
  const ends = new Set();
  let off = 0;
  for (const word of display.split(/\s+/)) {
    const wordNorm = toNorm(word);
    if (!wordNorm) continue;
    off += wordNorm.length;
    if (looksPlural(wordNorm) && !KEEP_S.has(wordNorm)) ends.add(off - 1);
  }
  return ends;
}

export default {
  name: 'Optional letters', icon: '🎈', category: 'optional',
  desc: 'Letters that can be dropped to leave another entry',
  example: 'hart → haⓡt',
  params: [
    { key: 'plurals', type: 'checkbox', label: 'Include plurals',
      title: 'Also offer a trailing S that leaves the singular' },
  ],
  kind: 'transform',
  matchOn: 'both',
  input: 'hidden', output: 'plain',
  run(wlEntry, prepared, wordlist) {
    const norm = wlEntry.norm;
    if (norm.length < 2) return [];
    const display = displayOf(wlEntry);
    const map = normToDisplayMap(wlEntry);
    const pluralS = prepared.plurals ? null : pluralWordEnds(display);

    const hits = [];
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === norm[i - 1]) continue;
      if (pluralS && pluralS.has(i)) continue;
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
