'use strict';

import { hasUnigramCorpus, rankedSplits, SPACE_OUT_WINDOWS } from './segmenter.js';
import { stripAccents } from './norm.js';

// ─── Reading an entry aloud ──────────────────────────────────────────────────
// `lookup` answers null, never [], for an unknown word: an empty list passes as a
// word read with no sounds at all, and the segmenter is never asked to split it.

// Apostrophes join, or DON'T reads as DON plus a letter-name T. A digit makes the
// token unreadable: CMU has no numerals, and dropping them would read B52S as BS.
export function tokensOf(display) {
  const tokens = [];
  let cur = null;
  const close = () => { if (cur) tokens.push(cur); cur = null; };
  for (let i = 0; i < display.length; i++) {
    const ch = display[i];
    if (ch === '\'' || ch === '’') continue;
    const folded = stripAccents(ch).toLowerCase();
    let letter = false;
    for (const c of folded) {
      if (c >= 'a' && c <= 'z') {
        cur ??= { letters: '', at: [], digits: false };
        cur.letters += c;
        cur.at.push(i);
        letter = true;
      } else if (c >= '0' && c <= '9') {
        cur ??= { letters: '', at: [], digits: false };
        cur.digits = true;
        letter = true;
      }
    }
    if (!letter) close();
  }
  close();
  return tokens;
}

// A lone letter from a split is the segmenter's escape hatch, not a word: CMU
// would read DEFOGGERS → DEFOGGE R S's R as its letter name and hear ARE in it.
const isWordPart = part => part.length > 1 || part === 'a' || part === 'i';

function unitsOfParts(token, parts, lookup) {
  const units = [];
  let off = 0;
  for (const part of parts) {
    if (!isWordPart(part)) return null;
    const sounds = lookup(part);
    if (!sounds) return null;
    units.push({ letters: part, at: token.at.slice(off, off + part.length), sounds });
    off += part.length;
  }
  return units;
}

function unitsOf(token, spacing, lookup, wide) {
  if (token.digits || !token.letters) return null;
  const sounds = lookup(token.letters);
  if (sounds) return [{ letters: token.letters, at: token.at, sounds }];
  const guess = spacing?.guess(token.letters);
  const units = guess && unitsOfParts(token, guess, lookup);
  if (units || !wide || !hasUnigramCorpus()) return units;
  // The typed input gets Rhymes' wider window: an input that can't be read is a
  // dead end with nothing on screen to say why.
  for (const parts of rankedSplits(token.letters, SPACE_OUT_WINDOWS.many, spacing.vocab).slice(0, 20)) {
    if (parts.length < 2) continue;
    const found = unitsOfParts(token, parts, lookup);
    if (found) return found;
  }
  return null;
}

// One item per word read: { letters, at, sounds }, or null for a word that can't be.
export function itemsOf(display, spacing, lookup, wide = false) {
  const items = [];
  for (const token of tokensOf(display)) items.push(...(unitsOf(token, spacing, lookup, wide) ?? [null]));
  return items;
}
