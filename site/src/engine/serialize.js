'use strict';

// ─── Serialize (My Edits / wordlist text output) ──────────────────────────────

import { stripAccents } from './norm.js';

export const AS_IS_FORMAT = { spaces: true, punctuation: true, accents: true, comments: true };

export function formatEntryText(e, fmt) {
  let s = e.display ?? e.norm;
  if (!fmt.accents)     s = stripAccents(s);
  if (!fmt.spaces)      s = s.replace(/\s+/g, '');
  if (!fmt.punctuation) s = s.replace(/[^\p{L}\p{N}\s]/gu, '');
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
    const line = (fmt.comments && e.comment) ? `${text};${e.score};${e.comment}` : `${text};${e.score}`;
    if (seen.has(line)) continue;   // only stripping can collide two entries onto one line
    seen.add(line);
    lines.push(line);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
