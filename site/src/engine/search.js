'use strict';

import { esc } from '../core/util.js';

// ─── Search ───────────────────────────────────────────────────────────────────

// Y is a vowel (matching Umiaq, OneLook, Ingrid). One shared definition backs
// both the `#`/`@` search classes and the Vowelcy/Consonantcy tools, so flipping
// it can't leave the two disagreeing on Y — the drift copyqat has.
export const CONSONANTS = 'bcdfghjklmnpqrstvwxz';
export const VOWELS = 'aeiouy';
export function escapeRegex(s)        { return s.replace(/[.+*?^${}()|[\]\\]/g, '\\$&'); }
// Omitting `-` is load-bearing: it's what makes `[a-m]`/`[0-9]` ranges work.
// Re-adding it (it reads as an oversight) silently kills every range.
export function escapeRegexClass(s)   { return s.replace(/[\]\\^]/g, '\\$&'); }

// Wildcards buildSearchPattern recognizes — keep this list in sync with it.
export const SEARCH_WILDCARD_RE = /[*?#@[]/;
export function isLiteralQuery(query) { return query !== '' && !SEARCH_WILDCARD_RE.test(query); }

// Two arms: the regex runs against both the entry's norm (accents + separators
// stripped) and its verbatim display, matching if either does — norm forgives
// separators (`theirs` finds "the IRS"); display requires a typed space/accent.
// `literal` treats the query as plain text (no wildcards) so Ctrl-F can share
// this exact matcher and stay in agreement with Search on what matches.
export function buildSearchPattern(query, wholeWord = false, literal = false) {
  // Don't trim: a typed space is a literal that anchors to a word boundary in
  // the display arm. Re-adding `.trim()` reads as an oversight but silently
  // kills that — even an all-whitespace query is a real space search.
  const q = query.normalize('NFC');
  if (!q) return null;

  function customClass(body) {
    const expanded = body.replace(/#/g, CONSONANTS).replace(/@/g, VOWELS);
    if (expanded.startsWith('^')) return `[^${escapeRegexClass(expanded.slice(1))}]`;
    return `[${escapeRegexClass(expanded)}]`;
  }

  const tokens = [];
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    if (literal)         tokens.push({ kind: 'literal', re: escapeRegex(ch) });
    else if (ch === '*') tokens.push({ kind: 'wild', re: '.*' });
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
  let filterRe, hlRe, globalRe;
  try {
    filterRe = new RegExp(anchor(pat),   'iu');
    hlRe     = new RegExp(anchor(hlPat), 'giud');
    globalRe = new RegExp(anchor(pat),   'giud');
  } catch {
    return null;   // invalid class (e.g. reversed range `[m-a]`) — no usable pattern
  }

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
  // On a tie, a find hit wins the slot over a co-starting search mark (current
  // match first), so a find never navigates to a row whose highlight is masked.
  const sorted = [...ranges].sort((a, b) => a.start - b.start || findRank(a) - findRank(b));
  let result = '';
  let pos = 0;
  for (const r of sorted) {
    if (r.start < pos || r.end <= r.start) continue;
    result += esc(text.slice(pos, r.start));
    const content = esc(text.slice(r.start, r.end));
    if (r.kind === 'find' || r.kind === 'find-current') {
      result += `<mark class="find-hit${r.kind === 'find-current' ? ' find-current' : ''}">${content}</mark>`;
    } else if (r.kind.startsWith('search:')) {
      result += `<mark class="search-match search-match-${r.kind.slice(7)}">${content}</mark>`;
    } else {
      result += `<span class="hl-${r.kind}">${content}</span>`;
    }
    pos = r.end;
  }
  return result + esc(text.slice(pos));
}

function findRank(r) {
  return r.kind === 'find-current' ? 0 : r.kind === 'find' ? 1 : 2;
}
