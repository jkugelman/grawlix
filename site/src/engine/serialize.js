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
// one whose score and comment survive — serializing unsorted silently ships the loser.
function sortedEntries(entries) {
  return [...entries].sort((a, b) =>
    a.norm.localeCompare(b.norm) ||
    b.score - a.score ||
    (b.comment ? 1 : 0) - (a.comment ? 1 : 0));
}

export function serializeEntries(entries, fmt = AS_IS_FORMAT) {
  const seen = new Set();
  const lines = [];
  for (const e of sortedEntries(entries)) {
    const text = formatEntryText(e, fmt);
    const line = (fmt.comments && e.comment) ? `${text};${e.score};${e.comment}` : `${text};${e.score}`;
    if (seen.has(line)) continue;   // only stripping can collide two entries onto one line
    seen.add(line);
    lines.push(line);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
