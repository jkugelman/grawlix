'use strict';

import { displayOf, normToDisplayMap, wordBreaks } from '../norm.js';
import { bestRowForNorm } from '../corpus.js';
import { loadSpacingCorpus, spacingReader } from '../space-out.js';
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

function pluralWordEnds(wlEntry, spacing) {
  const norm = wlEntry.norm;
  const ends = new Set();
  let start = 0;
  for (const end of [...wordBreaks(wlEntry, spacing), norm.length]) {
    const word = norm.slice(start, end);
    if (looksPlural(word) && !KEEP_S.has(word)) ends.add(end - 1);
    start = end;
  }
  return ends;
}

export default {
  name: 'Optional letters', icon: '🎈', category: 'optional',
  desc: 'Letters that can be dropped to leave another entry',
  example: 'hard ⓟass',
  params: [
    { key: 'plurals', type: 'checkbox', label: 'Include plurals',
      title: 'Also offer a trailing S that leaves the singular' },
  ],
  kind: 'transform',
  matchOn: 'both',
  input: 'hidden', output: 'plain',
  assets: params => (params.plurals ? [] : ['unigrams']),
  // Reads on demand rather than building the table, which costs seconds before the
  // first result: only an S whose removal leaves an entry needs its word read.
  async prepare(params, ctx) {
    if (params.plurals) return { plurals: true, spacing: null };
    await loadSpacingCorpus();
    return { plurals: false, spacing: spacingReader(ctx) };
  },
  run(wlEntry, prepared, wordlist) {
    const norm = wlEntry.norm;
    if (norm.length < 2) return [];
    const display = displayOf(wlEntry);
    const map = normToDisplayMap(wlEntry);
    let pluralS = null;

    const hits = [];
    // Doubled letters get a row each, not one: the circled cell crosses a different
    // entry, so hoⓛly and holⓛy are different fills despite the same reduction.
    for (let i = 0; i < norm.length; i++) {
      const reduced = norm.slice(0, i) + norm.slice(i + 1);
      if (!wordlist.norms.has(reduced)) continue;
      if (!prepared.plurals && norm[i] === 's'
          && (pluralS ??= pluralWordEnds(wlEntry, prepared.spacing)).has(i)) continue;
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
