'use strict';

// ─── Serialize (My Edits / wordlist text output) ──────────────────────────────

import { stripDiacritics } from './norm.js';

export const AS_IS_FORMAT = { spaces: true, digits: true, diacritics: true, punctuation: true, symbols: true, comments: true };

// ─── Symbols axis ─────────────────────────────────────────────────────────────

// & % # @ ‰ are punctuation to Unicode, but each stands for a word, so they sit
// with the symbols: stripping one ships a different entry (A&W → AW, 100% → 100).
const SPOKEN_RE = /[\p{S}&%#@‰]/u;
const SILENT_PUNCT_RE = /[^\P{P}&%#@‰]/gu;
const NON_ASCII_RE = /[^\x00-\x7f]/;

// null leaves the whole entry out; '' deletes only the character.
function plainChar(c) {
  if (!NON_ASCII_RE.test(c)) return SPOKEN_RE.test(c) ? null : c;
  if (/[\s\p{Z}]/u.test(c)) return ' ';
  // Punctuation's and Diacritics' to strip, not this axis's: ¡ – é ø ß.
  if (c !== '‰' && /[\p{P}\p{M}]/u.test(c)) return c;
  if (!NON_ASCII_RE.test(stripDiacritics(c))) return c;
  return /[\p{Lm}\p{C}]/u.test(c) ? '' : null;
}

function plainSymbols(s) {
  if (!NON_ASCII_RE.test(s)) return SPOKEN_RE.test(s) ? null : s;
  let out = '';
  for (const c of s) {
    const p = plainChar(c);
    if (p === null) return null;
    out += p;
  }
  return out;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

// null when the format leaves the entry out whole: R2D2 without its digits, or
// A+ without its plus, is a different entry.
export function formatEntryText(e, fmt) {
  // The norm, not the display: a consumer folds x² and ① to digits, so they count.
  if (!fmt.digits && /[0-9]/.test(e.norm)) return null;
  let s = e.display ?? e.norm;
  if (!fmt.symbols && (s = plainSymbols(s)) === null) return null;
  if (!fmt.diacritics)  s = stripDiacritics(s);
  if (!fmt.punctuation) s = s.replace(SILENT_PUNCT_RE, '');
  if (!fmt.spaces)      s = s.replace(/\s+/g, '');
  return s;
}

// Consumers (e.g. Ingrid) keep the first entry for a given norm, so the leader is the
// one whose score survives — serializing unsorted silently ships the loser. Tiebreak on
// the formatted text, not the display: stripping collapses two variants onto one text,
// and the comment rank — unreachable under as-is — is what leads with the annotated one.
function sortedEntries(entries, fmt) {
  return entries
    .map(e => ({ e, text: formatEntryText(e, fmt) }))
    .filter(({ text }) => text)   // left out by the format, or stripped to nothing
    .sort((a, b) =>
      a.e.norm.localeCompare(b.e.norm) ||
      b.e.score - a.e.score ||
      a.text.localeCompare(b.text) ||
      (b.e.comment ? 1 : 0) - (a.e.comment ? 1 : 0));
}

export function serializeEntries(entries, fmt = AS_IS_FORMAT) {
  const seen = new Set();
  const lines = [];
  for (const { e, text } of sortedEntries(entries, fmt)) {
    const line = (fmt.comments && e.comment) ? `${text};${e.score};${e.comment}` : `${text};${e.score}`;
    if (seen.has(line)) continue;   // only stripping can collide two entries onto one line
    seen.add(line);
    lines.push(line);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
