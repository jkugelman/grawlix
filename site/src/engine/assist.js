'use strict';

// ─── Pattern assist ───────────────────────────────────────────────────────────
// Shared pieces of the per-dialect analyzers (assist-umiaq.js, assist-regex.js,
// assist-search.js) behind the helper panel of the Umiaq, Regex and Search
// boxes. Each analyzer turns a query into
//   { tokens, regions?, error, reading, hints }
// where a token is { s, e, kind, color?, pair?, target? } over the raw
// text, a region { s, e, color } is a span shaded in a result color (Regex's
// capture groups), `error` is { s, e, msg, fixes? } or null, `reading` is the whole query
// in plain English (HTML), and each hint is { msg, fixes, tip? }.
// A fix is { label, text } (replace the box), { label, s, e, text } (replace a
// span), or { label, tool, text } (move the query to another tool).
// See docs/design.md § Pattern assist.

import { esc } from '../core/util.js';

export const code = s => `<code>${esc(s)}</code>`;
export const shout = s => `<b>${esc(s.toUpperCase())}</b>`;
export const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

export function rangeText(min, max) {
  if (min === max) return `${min}`;
  if (max === Infinity || max == null) return `${min} or more`;
  if (min === 0) return `up to ${max}`;
  return `${min} to ${max}`;
}

export const letters = n => (n === 1 ? 'letter' : 'letters');

export function joinParts(parts) {
  const out = [];
  let run = '';
  const flush = () => { if (run) { out.push(shout(run)); run = ''; } };
  for (const p of parts) {
    if (typeof p === 'object' && p.lit === ' ') { flush(); out.push('a space'); continue; }
    if (typeof p === 'object' && p.lit != null) { run += p.lit; continue; }
    flush();
    out.push(p);
  }
  flush();
  return out.join(', then ');
}

export function tokenAt(tokens, caret) {
  return tokens.find(t => t.s < caret && caret < t.e)
    || tokens.find(t => t.e === caret)
    || tokens.find(t => t.s === caret)
    || null;
}

// Error timing tags; a wrong one makes an error nag mid-keystroke or wait when
// it needn't. PENDING: unfinished, like `^(ab`. FINAL: no further typing can
// fix it, like Umiaq's `.`. Untagged: typing on might, like `A!` becoming `A!=`.
export const PENDING = { pending: true }, FINAL = { final: true };

// An error is quiet while it's still being typed: a pending one until the
// caret leaves the end, and an untagged one while the caret sits right after
// it at the end of the text. A final one shows at once.
export function errorVisible(err, text, caret) {
  if (!err) return false;
  if (caret < 0 || err.final) return true;
  const atEnd = text.slice(caret).trim() === '';
  if (err.pending && atEnd) return false;
  return !(atEnd && caret >= err.s && text.slice(err.e, caret).trim() === '');
}

export const matchModeWhere = mode => ({
  full: 'are exactly',
  start: 'start with',
  end: 'end with',
  word: 'have a whole word that is',
  span: 'have, across a word break,',
}[mode] || 'contain');

const SWAP_RE = /([a-z0-9])-([a-z0-9])/g;
export function reversedRange(body) {
  for (const m of body.matchAll(SWAP_RE)) if (m[2] < m[1]) return { at: m.index, a: m[1], b: m[2] };
  return null;
}
