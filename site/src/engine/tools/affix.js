'use strict';

import { buildSearchPattern, patternLengthRange, isLiteralQuery } from '../search.js';
import { SEARCH_HELP } from './shared.js';

function affixSpec(pattern) {
  const m = buildSearchPattern(pattern || '', 'full');   // ^(?:pat)$ — full-segment test
  if (!m) return null;
  const { min, max } = patternLengthRange(pattern || '');
  return { matches: seg => m.test({ norm: seg, display: null }), min: Math.max(1, min), max };
}

function push(map, key, val) {
  const arr = map.get(key);
  if (arr) arr.push(val); else map.set(key, [val]);
}

export function makeAffixTool({ name, icon, reverseName, reverseSlug, category, desc, example, side }) {
  const front = side === 'front';
  return {
    name, icon, category, desc, example, reverseName, reverseSlug,
    params: [{ key: 'pattern', placeholder: 'letters or ???', help: SEARCH_HELP }],
    kind: 'transform', reversible: true,
    inputHighlights: true, outputHighlights: false,   // forward = cut (marks removed span); reversed() flips to grow
    glyph: () => '→',
    // Legacy ?behead=3 was an integer count; decode digits to N wildcards so old
    // links keep working now that bare integers are literals in the input.
    decodeFirstParam: v => /^\d+$/.test(v) ? '?'.repeat(+v) : v,
    isInert: params => !buildSearchPattern((params && params.pattern) || ''),
    async prepare(params, ctx) {
      const spec = affixSpec(params.pattern || '');
      if (!spec) return null;
      if (!(ctx && ctx.reversed)) {
        return { spec, reversed: false, pluralSkip: !front && !isLiteralQuery(params.pattern || '') };
      }
      const index = new Map();
      const norms = ctx.wordlist.norms;
      for (const w of norms) {
        const hi = Math.min(spec.max, w.length - 1);
        for (let k = spec.min; k <= hi; k++) {
          if (front) {
            const suf = w.slice(k);
            if (norms.has(suf) && spec.matches(w.slice(0, k))) push(index, suf, { word: w, s: 0, e: k });
          } else {
            const pre = w.slice(0, w.length - k);
            if (norms.has(pre) && spec.matches(w.slice(w.length - k))) push(index, pre, { word: w, s: w.length - k, e: w.length });
          }
        }
        if (ctx.due()) await ctx.yield();
      }
      return { index, reversed: true };
    },
    run(entry, prepared, wordlist) {
      if (!prepared) return [];
      if (prepared.reversed) {
        const hits = prepared.index.get(entry);
        return hits ? hits.map(h => ({ entry: h.word, outputHighlights: [{ start: h.s, end: h.e, kind: 'search:0' }] })) : [];
      }
      const { spec, pluralSkip } = prepared;
      // deliberate: the plural→singular skip (a wildcard cut of a lone -s).
      if (pluralSkip && entry.endsWith('s') && !entry.endsWith('ss')) return [];
      const out = [];
      const hi = Math.min(spec.max, entry.length - 1);
      for (let k = spec.min; k <= hi; k++) {
        const seg = front ? entry.slice(0, k) : entry.slice(entry.length - k);
        if (!spec.matches(seg)) continue;
        const rem = front ? entry.slice(k) : entry.slice(0, entry.length - k);
        if (wordlist.norms.has(rem)) {
          const s = front ? 0 : entry.length - k;
          const e = front ? k : entry.length;
          out.push({ entry: rem, inputHighlights: [{ start: s, end: e, kind: 'removed' }] });
        }
      }
      return out;
    },
  };
}
