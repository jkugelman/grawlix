'use strict';

import { esc } from '../core/util.js';

// ─── Search ───────────────────────────────────────────────────────────────────

export const CONSONANTS = 'bcdfghjklmnpqrstvwxyz';
export const VOWELS = 'aeiou';
export function escapeRegex(s)        { return s.replace(/[.+*?^${}()|[\]\\]/g, '\\$&'); }
export function escapeRegexClass(s)   { return s.replace(/[\]\\^-]/g, '\\$&'); }

// Wildcards buildSearchPattern recognizes — keep this list in sync with it.
export const SEARCH_WILDCARD_RE = /[*?#@[]/;
export function isLiteralQuery(query) { return query !== '' && !SEARCH_WILDCARD_RE.test(query); }

// Two arms: the regex runs against both the entry's norm (accents + separators
// stripped) and its verbatim display, matching if either does — norm forgives
// separators (`theirs` finds "the IRS"); display requires a typed space/accent.
export function buildSearchPattern(query, wholeWord = false) {
  const q = query.normalize('NFC').trim();
  if (!q) return null;

  function customClass(body) {
    const expanded = body.replace(/#/g, CONSONANTS).replace(/@/g, VOWELS);
    if (expanded.startsWith('^')) return `[^${escapeRegexClass(expanded.slice(1))}]`;
    return `[${escapeRegexClass(expanded)}]`;
  }

  const tokens = [];
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    if (ch === '*')      tokens.push({ kind: 'wild', re: '.*' });
    else if (ch === '?') tokens.push({ kind: 'wild', re: '\\S' });
    else if (ch === '#') tokens.push({ kind: 'wild', re: `[${CONSONANTS}]` });
    else if (ch === '@') tokens.push({ kind: 'wild', re: `[${VOWELS}]` });
    else if (ch === '[') {
      const end = q.indexOf(']', i);
      if (end === -1) tokens.push({ kind: 'literal', re: '\\[' });
      else { tokens.push({ kind: 'wild', re: customClass(q.slice(i + 1, end)) }); i = end; }
    }
    else tokens.push({ kind: 'literal', re: escapeRegex(ch) });
  }

  // hlPat wraps each maximal run of literal tokens in a capture group so only
  // the fixed text highlights, never what `?`/`*` swallowed.
  let pat = '', hlPat = '', runOpen = false;
  const closeRun = () => { if (runOpen) { hlPat += ')'; runOpen = false; } };
  for (const tok of tokens) {
    pat += tok.re;
    if (tok.kind === 'literal') { if (!runOpen) { hlPat += '('; runOpen = true; } }
    else closeRun();
    hlPat += tok.re;
  }
  closeRun();

  const anchor = p => wholeWord ? '^(?:' + p + ')$' : p;
  const filterRe = new RegExp(anchor(pat),   'iu');
  const hlRe     = new RegExp(anchor(hlPat), 'giud');
  const globalRe = new RegExp(anchor(pat),   'giud');

  const tag = (ranges, coord) => ranges.map(r => ({ ...r, coord }));
  return {
    test(wlEntry) {
      if (filterRe.test(wlEntry.norm)) return true;
      const d = wlEntry.display;
      return d != null && filterRe.test(d);
    },
    // Prefer the display arm's ranges (already in display coordinates); fall back
    // to the norm arm, whose coordinates projectRangesToDisplay maps at render.
    searchRanges(wlEntry) {
      const d = wlEntry.display;
      if (d != null) {
        const dispRanges = searchRangesFor(d, hlRe);
        if (dispRanges.length) return tag(dispRanges, 'display');
      }
      return tag(searchRangesFor(wlEntry.norm, hlRe), 'norm');
    },
    globalRe,
  };
}

export function searchRangesFor(text, hlRe) {
  hlRe.lastIndex = 0;
  const ranges = [];
  let m;
  while ((m = hlRe.exec(text)) !== null) {
    ranges.push(...groupSpansToRanges(m));
    if (m[0].length === 0) hlRe.lastIndex++;   // step past a zero-width match or loop forever
  }
  return ranges;
}

// Without the `d` (indices) flag on the regex, `m.indices` is absent and this
// silently yields no highlights — the caller must compile with `d`.
// Must equal the count of --hl0..N CSS vars / .search-match-N rules; a mismatch
// emits search:N kinds with no matching color.
export const HL_COLORS = 9;

export function groupSpansToRanges(m) {
  if (!m?.indices) return [];
  const ranges = [];
  let colorIdx = 0;
  for (let g = 1; g < m.indices.length; g++) {
    if (!m.indices[g]) continue;
    const [start, end] = m.indices[g];
    ranges.push({ start, end, kind: `search:${colorIdx % HL_COLORS}` });
    colorIdx++;
  }
  return ranges;
}

// Render a string with a set of highlight ranges. Each range is
// `{ start, end, kind }`; search hits use `search:N` (rendered as `<mark>`),
// tool-emitted highlights use one of the kinds in the registry below
// (rendered as `<span class="hl-<kind>">`). Overlapping ranges are resolved
// by skipping later ranges entirely — simple and predictable; the visual
// loss is bounded to the rare case where a tool highlight overlaps a search
// match exactly. Entry text is HTML-escaped: this output is interpolated into
// innerHTML and an entry's display can come from a wordlist imported or fetched
// from an untrusted URL, so an unescaped `<img onerror>` entry would be XSS.
export function renderHighlightedText(text, ranges) {
  if (!ranges || !ranges.length) return esc(text);
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = '';
  let pos = 0;
  for (const r of sorted) {
    if (r.start < pos || r.end <= r.start) continue;
    result += esc(text.slice(pos, r.start));
    const content = esc(text.slice(r.start, r.end));
    if (r.kind.startsWith('search:')) {
      result += `<mark class="search-match search-match-${r.kind.slice(7)}">${content}</mark>`;
    } else {
      result += `<span class="hl-${r.kind}">${content}</span>`;
    }
    pos = r.end;
  }
  return result + esc(text.slice(pos));
}
