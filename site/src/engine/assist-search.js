'use strict';

// ─── Search assist ────────────────────────────────────────────────────────────
// Reads a Search query for the helper panel (see assist.js), mirroring
// buildSearchPattern: an unclosed `[` and every other mark are literals, so the
// only error is a class the browser rejects, which otherwise leaves the query
// silently inert.

import { CONSONANTS, VOWELS, escapeRegexClass } from './search.js';
import { code, matchModeWhere, joinParts, reversedRange } from './assist.js';

export const SEARCH_CHEAT = [
  { code: '*', desc: 'any string', insert: '*' },
  { code: '?', desc: 'any letter or digit', insert: '?' },
  { code: '#', desc: 'any consonant', insert: '#' },
  { code: '@', desc: 'any vowel', insert: '@' },
  { code: '[abc]', desc: 'any of a, b, c', insert: '[]', caret: 1 },
  { code: '[^abc]', desc: 'none of a, b, c', insert: '[^]', caret: 2 },
  { code: '[a-m]', desc: 'character range', insert: '[-]', caret: 1 },
];

const REGEXY = /\.[*+]|^\^|\$$|\\[dwsb]|\{\d+(,\d*)?\}|\([^)]*\|[^)]*\)/;

export function analyzeSearch(text, { mode = '' } = {}) {
  const tokens = [], parts = [];
  let error = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '*') { tokens.push({ s: i, e: i + 1, kind: 'wild' }); parts.push('anything'); }
    else if (ch === '?') { tokens.push({ s: i, e: i + 1, kind: 'wild' }); parts.push('any letter'); }
    else if (ch === '#') { tokens.push({ s: i, e: i + 1, kind: 'wild' }); parts.push('a consonant'); }
    else if (ch === '@') { tokens.push({ s: i, e: i + 1, kind: 'wild' }); parts.push('a vowel'); }
    else if (ch === '[' && text.indexOf(']', i) >= 0) {
      const end = text.indexOf(']', i), body = text.slice(i + 1, end);
      const neg = body[0] === '^', inner = neg ? body.slice(1) : body;
      tokens.push({ s: i, e: end + 1, kind: 'class' });
      parts.push(neg ? `a letter other than ${code(inner)}` : `one of ${code(body)}`);
      const expanded = inner.replace(/#/g, CONSONANTS).replace(/@/g, VOWELS);
      let bad = false;
      try { new RegExp(`[${neg ? '^' : ''}${escapeRegexClass(expanded)}]`, 'u'); } catch { bad = true; }
      if (bad && !error) {
        const rr = reversedRange(inner);
        const at = rr ? i + 1 + (neg ? 1 : 0) + rr.at : i;
        error = rr
          ? { s: at, e: at + 3, msg: `The range ${code(rr.a + '-' + rr.b)} runs backwards, so nothing can match.`, fixes: [{ label: `Use ${rr.b}-${rr.a}`, s: at, e: at + 3, text: `${rr.b}-${rr.a}` }] }
          : { s: i, e: end + 1, msg: 'This class is invalid, so nothing can match.' };
      }
      i = end;
    }
    else {
      tokens.push({ s: i, e: i + 1, kind: 'lit' });
      parts.push({ lit: ch });
    }
  }
  const ok = !!text && !error;
  const hints = [];
  if (ok && REGEXY.test(text)) {
    hints.push({ msg: `This looks like a regular expression. Search reads only ${code('*')} ${code('?')} ${code('#')} ${code('@')} and ${code('[ ]')} as wildcards; everything else is matched as typed.`, fixes: [{ label: 'Use Regex', tool: 'regex', text }] });
  }
  return {
    tokens,
    error,
    reading: ok ? `Finds entries that ${matchModeWhere(mode)} ${joinParts(parts)}${mode ? '' : ' anywhere inside'}.` : null,
    hints,
  };
}
