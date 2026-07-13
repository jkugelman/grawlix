'use strict';

// ─── Parsing ─────────────────────────────────────────────────────────────────

export const FOLD_MAP = {
  'ß': 'ss',
  'ø': 'o',  'Ø': 'O',
  'æ': 'ae', 'Æ': 'AE',
  'œ': 'oe', 'Œ': 'OE',
  'þ': 'th', 'Þ': 'TH',
  'ð': 'd',  'Ð': 'D',
  'ł': 'l',  'Ł': 'L',
  'đ': 'd',  'Đ': 'D',
  'ı': 'i',  'İ': 'I',
};
export const FOLD_RE = new RegExp(`[${Object.keys(FOLD_MAP).join('')}]`, 'g');

export function stripAccents(s) {
  // ASCII is untouched by all three steps below — fold chars and combining marks
  // are all > U+007F, and ASCII has no NFKD decomposition — so skip them. Getting
  // this equivalence wrong silently corrupts every norm it shortcuts.
  if (!/[^\x00-\x7f]/.test(s)) return s;
  return s.replace(FOLD_RE, c => FOLD_MAP[c])
          .normalize('NFKD')
          .replace(/\p{M}/gu, '');
}

export function toNorm(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildNormToDisplay(display) {
  if (display == null) return null;
  const map = [];
  for (let i = 0; i < display.length; i++) {
    const stripped = stripAccents(display[i]).toLowerCase();
    for (const c of stripped) {
      if (c >= 'a' && c <= 'z' || c >= '0' && c <= '9') map.push(i);
    }
  }
  return new Uint16Array(map);
}

export function normToDisplayMap(wlEntry) {
  if (wlEntry.display == null) return null;
  return wlEntry._normMap ??= buildNormToDisplay(wlEntry.display);
}

export function displayOf(wlEntry) {
  return wlEntry.display ?? wlEntry.norm;
}

export function projectRangesToDisplay(ranges, wlEntry) {
  if (!ranges?.length) return ranges;
  const map = normToDisplayMap(wlEntry);
  if (!map) return ranges;
  const display = wlEntry.display;
  return ranges.map(r => {
    if (r.coord === 'display') return r;
    if (r.start >= map.length) return { ...r, start: display.length, end: display.length };
    const start = map[r.start];
    const endIdx = Math.min(r.end - 1, map.length - 1);
    const end = endIdx >= 0 ? map[endIdx] + 1 : start;
    return { ...r, start, end };
  });
}

// Deliberately whitespace + hyphen, not all punctuation: ISNT inside "isn't"
// is one word, not a spanning match. Widening this silently changes what the
// Spans-words filter keeps.
export const WORD_BREAK_RE = /[\s-]/;

function hasNormChar(ch) {
  return /[a-z0-9]/.test(stripAccents(ch).toLowerCase());
}

// The edge trim is load-bearing: a display-coord match can start or end on a
// separator (a regex `\s` at its edge), and without the trim such a one-word
// match silently counts as spanning.
export function matchSpansWords(wlEntry, start, end, coord = 'norm') {
  const display = wlEntry.display;
  if (display == null || end <= start) return false;
  if (coord === 'display') {
    let s = start, e = end;
    while (s < e && !hasNormChar(display[s])) s++;
    while (e > s && !hasNormChar(display[e - 1])) e--;
    return WORD_BREAK_RE.test(display.slice(s, e));
  }
  const map = normToDisplayMap(wlEntry);
  if (!map || !map.length || start >= map.length) return false;
  const last = Math.min(end, map.length) - 1;
  return WORD_BREAK_RE.test(display.slice(map[start], map[last] + 1));
}

// Deliberately allows the window to cover *several* complete words, not just
// one — tightening it to a single word silently stops norm-arm queries from
// matching exact multi-word phrases, with no error to show for it.
export function matchIsWholeWords(wlEntry, start, end, coord = 'norm') {
  if (end <= start) return false;
  const display = wlEntry.display;
  if (display == null) return start === 0 && end === wlEntry.norm.length;
  if (coord === 'display') {
    let s = start, e = end;
    while (s < e && !hasNormChar(display[s])) s++;
    while (e > s && !hasNormChar(display[e - 1])) e--;
    if (s === e) return false;
    return boundaryBefore(display, s) && boundaryAfter(display, e);
  }
  const map = normToDisplayMap(wlEntry);
  if (!map || !map.length || start >= map.length || end > map.length) return false;
  const startOk = start === 0 || WORD_BREAK_RE.test(display.slice(map[start - 1] + 1, map[start]));
  const endOk = end === map.length || WORD_BREAK_RE.test(display.slice(map[end - 1] + 1, map[end]));
  return startOk && endOk;
}

function boundaryBefore(display, pos) {
  for (let i = pos - 1; i >= 0; i--) {
    if (hasNormChar(display[i])) return false;
    if (WORD_BREAK_RE.test(display[i])) return true;
  }
  return true;
}

function boundaryAfter(display, pos) {
  for (let i = pos; i < display.length; i++) {
    if (hasNormChar(display[i])) return false;
    if (WORD_BREAK_RE.test(display[i])) return true;
  }
  return true;
}

export function parseWordlistLine(line) {
  if (!line) return null;
  const semi = line.indexOf(';');
  if (semi === -1) return null;
  const raw = line.slice(0, semi).trim();
  if (!raw || raw.includes(';')) return null;
  const rest = line.slice(semi + 1);
  const semi2 = rest.indexOf(';');
  const score = parseInt(semi2 === -1 ? rest : rest.slice(0, semi2), 10);
  if (isNaN(score)) return null;
  const comment = semi2 === -1 ? '' : rest.slice(semi2 + 1).trim();
  return { raw, score, comment };
}

// Thresholds pinned to real wordlists — of cased entries Broda is 100%
// uppercase, XWI 0%, Nediger ~1% (1,277 acronyms); see docs/design.md.
export const UPPER_ABSOLUTE_MAX = 10000;
export const UPPER_RATIO_MAX = 0.80;
export const UPPER_RATIO_THRESHOLD = 1000;

export function caseOfRaw(raw) {
  const hasUpper = /[A-Z]/.test(raw), hasLower = /[a-z]/.test(raw);
  return hasUpper && hasLower ? 'mixed' : hasUpper ? 'upper' : hasLower ? 'lower' : 'none';
}

export function caseFromCounts(upper, lower, mixed) {
  if (upper > UPPER_ABSOLUTE_MAX) return 'upper';
  if (upper > UPPER_RATIO_THRESHOLD && upper / (upper + lower + mixed) > UPPER_RATIO_MAX) return 'upper';
  return 'lower';
}

export function detectCase(rawEntries) {
  let upper = 0, lower = 0, mixed = 0;
  for (const { raw } of rawEntries) {
    const c = caseOfRaw(raw);
    if (c === 'mixed') mixed++;
    else if (c === 'upper') upper++;
    else if (c === 'lower') lower++;
  }
  return caseFromCounts(upper, lower, mixed);
}

export function parseWordlist(text) {
  const rawEntries = [];
  for (const line of text.split('\n')) {
    const parsed = parseWordlistLine(line);
    if (parsed) rawEntries.push(parsed);
  }
  const fileCase = detectCase(rawEntries);
  // Drop repeats of an exact (norm, display) entry, keeping the first. Keying on
  // norm alone would silently collapse case/spelling variants meant to coexist
  // (eta/ETA, hic/Hi-C) — the display must be in the key.
  const seen = new Set();
  const entries = [];
  for (const { raw, score, comment } of rawEntries) {
    const e = buildWlEntry(raw, score, comment, fileCase);
    const key = e.norm + '\0' + (e.display ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(e);
  }
  return entries;
}

// display is null only for bare letter-runs already in the file's convention
// case — those render as lowercase norm. Anything carrying extra information
// (spaces, accents, punctuation, or an off-convention case like an FBI in a
// lowercase file) keeps its display verbatim.
export function displayForRaw(raw, fileCase) {
  const letterOnly = /^[A-Za-z0-9]+$/.test(raw);
  const offCase = fileCase === 'upper' ? /[a-z]/.test(raw) : /[A-Z]/.test(raw);
  return letterOnly && !offCase ? null : raw;
}

export function buildWlEntry(raw, score, comment, fileCase) {
  return { norm: toNorm(raw), display: displayForRaw(raw, fileCase), score, comment };
}

export function buildUserWlEntry(raw, score, comment) {
  const trimmed = raw.trim();
  return { norm: toNorm(trimmed), display: trimmed, score, comment };
}

// `score` is a live getter onto `source` (the entry this output was transformed
// from), not a copy: a synthetic output carries its own display but borrows the
// input's score, so an in-place score edit shows through a kept prefix tile
// instead of a frozen value. `source` is any object exposing `.score`.
export function synthWlEntry(text, source) {
  const norm = toNorm(text);
  const display = text === norm ? null : text;
  return { norm, display, comment: '', wordlist: null, get score() { return source.score; } };
}

// Validates a chunk from a Range GET. Drops the last line (may be truncated
// at the Range boundary); skips semicolon-less lines as comments/headers.
export function validateWordlistChunk(text) {
  const lines = text.split('\n').slice(0, -1).filter(l => l.length > 0);
  if (!lines.length) return false;
  const dataLines = lines.filter(l => l.includes(';'));
  if (!dataLines.length) return false;
  return dataLines.every(l => parseWordlistLine(l) !== null);
}
