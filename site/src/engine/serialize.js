'use strict';

// ─── Serialize (My Edits / wordlist text output) ──────────────────────────────

import { stripAccents, stripDiacritics } from './norm.js';

export const AS_IS_FORMAT = { spaces: true, punctuation: true, diacritics: true, ascii: true, comments: true };

export function formatEntryText(e, fmt) {
  let s = e.display ?? e.norm;
  // NFKD both creates ASCII punctuation (℅ → c/o) and conjures spaces out of
  // lone diacritics (´ → space), so ascii must precede punctuation and spaces.
  if (!fmt.diacritics)  s = stripDiacritics(s);
  if (!fmt.ascii)       s = stripAccents(s).replace(/[^\x00-\x7f]/g, '');
  if (!fmt.punctuation) s = s.replace(/\p{P}/gu, '');
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
    if (!text) continue;
    const line = (fmt.comments && e.comment) ? `${text};${e.score};${e.comment}` : `${text};${e.score}`;
    if (seen.has(line)) continue;   // only stripping can collide two entries onto one line
    seen.add(line);
    lines.push(line);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
