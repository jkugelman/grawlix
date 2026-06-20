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

export function serializeEntries(entries, fmt = AS_IS_FORMAT) {
  const transforming = !fmt.spaces || !fmt.punctuation || !fmt.accents;
  let lines;
  if (transforming) {
    // formatEntryText is many-to-one under stripping (café/cafe, the IRS/theirs);
    // collapse or the output file gets duplicate, conflicting entry lines.
    const byText = new Map();
    for (const e of entries) {
      const text = formatEntryText(e, fmt);
      const cur = byText.get(text);
      if (!cur) byText.set(text, { text, score: e.score, comments: e.comment ? [{ comment: e.comment, score: e.score }] : [] });
      else {
        cur.score = Math.max(cur.score, e.score);
        if (e.comment) cur.comments.push({ comment: e.comment, score: e.score });
      }
    }
    lines = [...byText.values()].map(({ text, score, comments }) => {
      if (!fmt.comments || !comments.length) return `${text};${score}`;
      const combined = [...new Set(comments.sort((a, b) => b.score - a.score).map(c => c.comment))].join(' / ');
      return `${text};${score};${combined}`;
    });
  } else {
    lines = entries.map(e => {
      const head = e.display ?? e.norm;
      return (fmt.comments && e.comment) ? `${head};${e.score};${e.comment}` : `${head};${e.score}`;
    });
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

export function sortedEntries(entries) {
  // Within a norm group, highest score first: downstream consumers (e.g. Ingrid)
  // keep the first entry for a given norm, so the best-scored variant must lead.
  return [...entries].sort((a, b) => a.norm.localeCompare(b.norm) || b.score - a.score);
}
