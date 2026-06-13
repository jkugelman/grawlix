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

export function detectCase(rawEntries) {
  let upper = 0, lower = 0, mixed = 0;
  for (const { raw } of rawEntries) {
    const hasUpper = /[A-Z]/.test(raw), hasLower = /[a-z]/.test(raw);
    if (hasUpper && hasLower) mixed++;
    else if (hasUpper) upper++;
    else if (hasLower) lower++;
  }
  if (upper > UPPER_ABSOLUTE_MAX) return 'upper';
  if (upper > UPPER_RATIO_THRESHOLD && upper / (upper + lower + mixed) > UPPER_RATIO_MAX) return 'upper';
  return 'lower';
}

export function parseWordlist(text) {
  const rawEntries = [];
  for (const line of text.split('\n')) {
    const parsed = parseWordlistLine(line);
    if (parsed) rawEntries.push(parsed);
  }
  const fileCase = detectCase(rawEntries);
  return rawEntries.map(({ raw, score, comment }) => buildWlEntry(raw, score, comment, fileCase));
}

// display is null only for bare letter-runs already in the file's convention
// case — those render as lowercase norm. Anything carrying extra information
// (spaces, accents, punctuation, or an off-convention case like an FBI in a
// lowercase file) keeps its display verbatim.
export function buildWlEntry(raw, score, comment, fileCase) {
  const norm = toNorm(raw);
  const letterOnly = /^[A-Za-z0-9]+$/.test(raw);
  const offCase = fileCase === 'upper' ? /[a-z]/.test(raw) : /[A-Z]/.test(raw);
  const display = letterOnly && !offCase ? null : raw;
  return { norm, display, score, comment };
}

export function buildUserWlEntry(raw, score, comment) {
  const trimmed = raw.trim();
  return { norm: toNorm(trimmed), display: trimmed, score, comment };
}

export function synthWlEntry(text, score) {
  const norm = toNorm(text);
  const display = text === norm ? null : text;
  return { norm, display, score, comment: '', wordlist: null };
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
