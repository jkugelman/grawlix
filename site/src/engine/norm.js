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

export function stripDiacritics(s) {
  if (!/[^\x00-\x7f]/.test(s)) return s;
  return s.replace(FOLD_RE, c => FOLD_MAP[c])
          .normalize('NFD')
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

// Lowercases a code unit only when its lowercase is one code unit (İ → i̇ is two),
// so a match position in the folded string is a display coordinate as-is.
export function foldDisplay(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= 'A' && c <= 'Z') out += c.toLowerCase();
    else if (c > '\x7f') { const l = c.toLowerCase(); out += l.length === 1 ? l : c; }
    else out += c;
  }
  return out;
}

export function foldedDisplayOf(wlEntry) {
  if (wlEntry.display == null) return wlEntry.norm;
  return wlEntry._fold ??= foldDisplay(wlEntry.display);
}

export function normLen(s) {
  if (/[^\x00-\x7f]/.test(s)) return toNorm(s).length;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) n++;
  }
  return n;
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

// ─── Word breaks ─────────────────────────────────────────────────────────────

// Deliberately whitespace + hyphen, not all punctuation: ISNT inside "isn't"
// is one word, not a spanning match. Widening this silently changes what the
// Whole-word and Spans-words gates keep.
export const WORD_BREAK_RE = /[\s-]/;
export const isUnspaced = display => !WORD_BREAK_RE.test(display);

const NO_BREAKS = Object.freeze([]);

// Norm offsets strictly inside the norm. A display carrying a break is never
// re-read: the reader's guess can disagree with authored spacing, and a gate
// built on the guess would silently contradict the spacing shown on the row.
export function wordBreaks(wlEntry, reader = null) {
  const display = wlEntry.display;
  if (display != null && WORD_BREAK_RE.test(display)) return wlEntry._breaks ??= displayBreaks(wlEntry);
  if (!reader) return NO_BREAKS;
  const parts = reader.best(wlEntry.norm);
  return parts ? partBreaks(parts) : NO_BREAKS;
}

function displayBreaks(wlEntry) {
  const map = normToDisplayMap(wlEntry), display = wlEntry.display;
  const breaks = [];
  for (let i = 1; i < map.length; i++) {
    if (map[i] - map[i - 1] > 1 && WORD_BREAK_RE.test(display.slice(map[i - 1] + 1, map[i]))) breaks.push(i);
  }
  return breaks;
}

export function partBreaks(parts) {
  const breaks = [];
  let at = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    at += normLen(parts[i]);
    breaks.push(at);
  }
  return breaks;
}

export function spansWords(breaks, start, end) {
  for (let i = 0; i < breaks.length; i++) {
    if (breaks[i] > start && breaks[i] < end) return true;
  }
  return false;
}

// Deliberately allows the window to cover *several* complete words, not just
// one — tightening it to a single word silently stops norm-arm queries from
// matching exact multi-word phrases, with no error to show for it.
export function isWholeWords(breaks, normLen, start, end) {
  if (end <= start) return false;
  return (start === 0 || breaks.includes(start)) && (end === normLen || breaks.includes(end));
}

// Counting letters drops a separator at either edge, which is load-bearing: a
// regex `\s` can extend a one-word match onto a space, and without the drop
// that match silently counts as spanning.
export function displayRangeToNorm(wlEntry, start, end) {
  const map = normToDisplayMap(wlEntry);
  if (!map) return [start, end];
  let ns = 0;
  while (ns < map.length && map[ns] < start) ns++;
  let ne = ns;
  while (ne < map.length && map[ne] < end) ne++;
  return [ns, ne];
}

// ─── Wordlist lines ──────────────────────────────────────────────────────────

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
export function synthWlEntry(text, source, coined = false) {
  const norm = toNorm(text);
  const display = text === norm ? null : text;
  const wlEntry = { norm, display, comment: '', wordlist: null, get score() { return source.score; } };
  if (coined) wlEntry.coined = true;
  return wlEntry;
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
