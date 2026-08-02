'use strict';

import { toNorm } from '../norm.js';

// stride 1 keeps overlapping occurrences, which cut to different strings —
// `aba` sits at 0 and 2 in `ababa`, leaving `ba` or `ab`.
function occurrences(word, pat, stride) {
  const out = [];
  for (let i = word.indexOf(pat); i !== -1; i = word.indexOf(pat, i + stride)) out.push(i);
  return out;
}

function removals(word, pat, all) {
  if (all) {
    const at = occurrences(word, pat, pat.length);
    if (!at.length) return [];
    let cut = '', pos = 0;
    for (const i of at) { cut += word.slice(pos, i); pos = i + pat.length; }
    return [{ word: cut + word.slice(pos), spans: at.map(i => [i, i + pat.length]) }];
  }
  const seen = new Set(), out = [];
  for (const i of occurrences(word, pat, 1)) {
    const cut = word.slice(0, i) + word.slice(i + pat.length);
    if (seen.has(cut)) continue;   // overlapping occurrences can cut to the same string
    seen.add(cut);
    out.push({ word: cut, spans: [[i, i + pat.length]] });
  }
  return out;
}

function push(map, key, val) {
  const arr = map.get(key);
  if (arr) arr.push(val); else map.set(key, [val]);
}

export default {
  name: 'Remove string', icon: '✂️', category: 'transform',
  desc: 'Remove a string from anywhere in an entry',
  example: 'Xbox One → Boone',
  reverseName: 'Add string', reverseSlug: 'add',
  params: [
    { key: 'pattern', placeholder: 'letters' },
    { key: 'mode', type: 'segmented', default: 'all', alwaysEncode: true,
      label: 'Occurrences', title: 'Take out every occurrence at once, or one at a time',
      choices: [{ value: 'all', label: 'All' }, { value: 'one', label: 'One' }] },
  ],
  kind: 'transform', reversible: true,
  inputHighlights: true, outputHighlights: false,   // forward = cut (marks the removed span); reversed() flips to grow
  glyph: () => '→',
  isInert: params => !toNorm((params && params.pattern) || ''),
  async prepare(params, ctx) {
    const pat = toNorm(params.pattern || '');
    if (!pat) return null;
    const all = params.mode !== 'one';
    if (!(ctx && ctx.reversed)) return { pat, all, reversed: false };
    const index = new Map();
    for (const w of ctx.wordlist.byNorm.keys()) {
      for (const r of removals(w, pat, all)) push(index, r.word, { word: w, spans: r.spans });
      if (ctx.due()) await ctx.yield();
    }
    return { index, reversed: true };
  },
  run(entry, prepared, wordlist) {
    if (!prepared) return [];
    if (prepared.reversed) {
      const hits = prepared.index.get(entry);
      return hits ? hits.map(h => ({
        entry: h.word,
        outputHighlights: h.spans.map(([s, e]) => ({ start: s, end: e, kind: 'search:0' })),
      })) : [];
    }
    const { pat, all } = prepared;
    const out = [];
    for (const r of removals(entry, pat, all)) {
      if (!wordlist.byNorm.has(r.word)) continue;
      out.push({ entry: r.word, inputHighlights: r.spans.map(([s, e]) => ({ start: s, end: e, kind: 'removed' })) });
    }
    return out;
  },
};
