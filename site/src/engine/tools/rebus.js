'use strict';

import { buildSearchPattern, HL_COLORS } from '../search.js';
import { displayOf, projectRangesToDisplay } from '../norm.js';
import { SEARCH_HELP } from './shared.js';

function asArray(v) {
  return Array.isArray(v) ? v : (v == null ? [] : [v]);
}

function activePairs(params) {
  const strings = asArray(params.string);
  const symbols = asArray(params.symbol);
  const pairs = [];
  for (let i = 0; i < strings.length; i++) {
    const matcher = buildSearchPattern(strings[i] || '');
    const symbol = symbols[i] || '';
    if (matcher && symbol) pairs.push({ matcher, symbol, kind: `search:${pairs.length % HL_COLORS}` });
  }
  return pairs;
}

function hasActivePair(params) {
  const strings = asArray(params.string);
  const symbols = asArray(params.symbol);
  for (let i = 0; i < strings.length; i++) {
    if (strings[i] && symbols[i]) return true;
  }
  return false;
}

function matchSpans(globalRe, text) {
  globalRe.lastIndex = 0;
  const spans = [];
  let m;
  while ((m = globalRe.exec(text)) !== null) {
    if (m[0].length > 0) spans.push({ start: m.index, end: m.index + m[0].length });
    else globalRe.lastIndex++;   // step past a zero-width match or loop forever
  }
  return spans;
}

export default {
  name: 'Rebus', icon: '🚌', category: 'rebus',
  desc: 'Squeeze a letter string into one rebus cell',
  example: 'I\'m busy → I\'m Ⓑy',
  params: [
    { key: 'string', placeholder: 'string', repeat: true, help: SEARCH_HELP },
    { key: 'symbol', placeholder: 'symbol', repeat: true, raw: true },
  ],
  kind: 'transform',
  inputHighlights: true, outputHighlights: true,
  glyph: () => '→',
  isInert: params => !hasActivePair(params),
  matchOn: 'both',
  prepare(params) {
    return { pairs: activePairs(params) };
  },
  // Emits a synthetic entry — the symbol forms aren't looked up in any wordlist,
  // so (unlike Search/Regex replace) there is no byNorm existence check.
  run(wlEntry, prepared) {
    const display = displayOf(wlEntry);
    const spans = [];
    for (const { matcher, symbol, kind } of prepared.pairs) {
      const norm = projectRangesToDisplay(matchSpans(matcher.globalRe, wlEntry.norm), wlEntry);
      const disp = wlEntry.display != null ? matchSpans(matcher.globalRe, wlEntry.display) : [];
      for (const r of norm) spans.push({ start: r.start, end: r.end, symbol, kind });
      for (const r of disp) spans.push({ start: r.start, end: r.end, symbol, kind });
    }
    if (!spans.length) return [];
    spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    let out = '', pos = 0;
    const inputHighlights = [], outputHighlights = [];
    for (const s of spans) {
      if (s.start < pos) continue;
      out += display.slice(pos, s.start);
      inputHighlights.push({ start: s.start, end: s.end, kind: s.kind, coord: 'display' });
      outputHighlights.push({ start: out.length, end: out.length + s.symbol.length, kind: s.kind, coord: 'display' });
      out += s.symbol;
      pos = s.end;
    }
    out += display.slice(pos);
    return [{ entry: [out], inputHighlights, outputHighlights }];
  },
};
