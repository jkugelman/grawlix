'use strict';

import { hasUnigramCorpus, rankedSplits, SPACE_OUT_WINDOWS } from './segmenter.js';
import { isUnspaced, stripAccents, toNorm, WORD_BREAK_RE } from './norm.js';
import { hasPronunciation, soundsOf, spelledSoundsOf } from './phonetics.js';
import { spaceOutSplits } from './space-out.js';
import { wordKinds } from './rule-query.js';

// ─── Reading an entry aloud ──────────────────────────────────────────────────
// `lookup` answers null, never [], for an unknown word: an empty list passes as a
// word read with no sounds at all, and the segmenter is never asked to split it.
// A whole token's lookup also gets its letters as written, case and accents intact.

// Apostrophes join, or DON'T reads as DON plus a letter-name T. A digit makes the
// token unreadable: CMU has no numerals, and dropping them would read B52S as BS.
export function tokensOf(display) {
  const tokens = [];
  let cur = null, broke = false;
  const open = () => {
    cur ??= { letters: '', at: [], digits: false, wordStart: broke };
    broke = false;
  };
  const close = () => { if (cur) tokens.push(cur); cur = null; };
  for (let i = 0; i < display.length; i++) {
    const ch = display[i];
    if (ch === '\'' || ch === '’') continue;
    const folded = stripAccents(ch).toLowerCase();
    let letter = false;
    for (const c of folded) {
      if (c >= 'a' && c <= 'z') {
        open();
        cur.letters += c;
        cur.at.push(i);
        letter = true;
      } else if (c >= '0' && c <= '9') {
        open();
        cur.digits = true;
        letter = true;
      }
    }
    if (!letter) {
      close();
      if (WORD_BREAK_RE.test(ch)) broke = true;
    }
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

function unitsOf(token, splitsOf, lookup, display) {
  if (token.digits || !token.letters) return null;
  const sounds = lookup(token.letters, token.at.map(i => display[i]).join(''));
  if (sounds) return [{ letters: token.letters, at: token.at, sounds }];
  for (const parts of splitsOf(token.letters)) {
    const units = unitsOfParts(token, parts, lookup);
    if (units) return units;
  }
  return null;
}

// ─── Splitting a word CMU doesn't know ───────────────────────────────────────
// Generators, so the ranked walk below only runs when the table's guess can't be
// read, not for every word CMU doesn't know.

export const tableSplits = spacing => function* (letters) {
  const guess = spacing?.guess(letters);
  if (guess) yield guess;
};

// The typed input gets Rhymes' wider window: an input that can't be read is a
// dead end with nothing on screen to say why.
export const widerSplits = spacing => function* (letters) {
  yield* tableSplits(spacing)(letters);
  if (!hasUnigramCorpus()) return;
  for (const parts of rankedSplits(letters, SPACE_OUT_WINDOWS.many, spacing.vocab).slice(0, 20)) {
    if (parts.length > 1) yield parts;
  }
};

// ─── Spacing a whole entry ───────────────────────────────────────────────────
// Each clause silently corrupts the rhyme if dropped: CMU knowing the whole string
// settles it (NOTABLE must not read as NO TABLE), and a spaced entry is already spelled.
//
// Past those clauses the dictionary has already declined the glued string, so keeping
// it unsplit is worth exactly nothing — it yields no rhyme at all. That is what earns
// the reader's `guess` over its `best`, which may legitimately answer "already one
// word": RICKROLL is unrhymable until something splits it.
export function spacedReading(display, spacing) {
  if (!isUnspaced(display) || hasPronunciation(display)) return display;
  return spacing.guess(toNorm(display))?.join(' ') ?? display;
}

// The typed entry earns a wider search than the wordlist gets. At the default
// window the scorer prunes `time machine` outright, because wordfreq carries the
// glued `timemachine` as a token of its own and it outscores the split — so a user
// who pastes an unspaced entry gets nothing, with nothing on screen to say why.
// Widening for the whole wordlist instead is what costs: it rescues 4% of XWI but
// reads them as `orbs → or bs` and `not ate`.
export function typedReading(text, spacing) {
  const narrow = spacedReading(text, spacing);
  if (narrow !== text || !hasUnigramCorpus()) return narrow;
  if (!isUnspaced(text) || hasPronunciation(text)) return narrow;
  const wide = spaceOutSplits(toNorm(text), spacing.vocab, { window: SPACE_OUT_WINDOWS.many, limit: 20 })
    .find(parts => parts.length >= 2 && parts[parts.length - 1].length > 1);
  return wide ? wide.join(' ') : narrow;
}

// ─── Initialisms ─────────────────────────────────────────────────────────────

// Past five letters, the all-caps words CMU lacks are mostly said as words: CAPTCHA,
// README, QWERTY, CRISPR. Shorter ones are mostly spelled out, COVID aside.
const MAX_SPELLED = 5;

// After CMU, so NASA keeps its word reading; before the segmenter, which would read
// NCAA as anything but its letters.
export function soundsOrSpelled(letters, written) {
  const sounds = soundsOf(letters);
  if (sounds || !written || !wordKinds(written).includes('initialism')) return sounds;
  const plural = written.endsWith('s') && written !== written.toUpperCase();
  return letters.length - plural <= MAX_SPELLED ? spelledSoundsOf(letters, plural) : null;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

// One item per word read: { letters, at, sounds }, or null for a word that can't be.
// An item boundary isn't always a word break: tokens split at every punctuation mark
// so U.S.A. reads as three letters, but Whole word must agree with Search that U.S.A.
// is one word. starts[k] marks a WORD_BREAK_RE gap or a split inside a token.
export function itemsOf(display, splitsOf, lookup) {
  const items = [], starts = [];
  for (const token of tokensOf(display)) {
    const units = unitsOf(token, splitsOf, lookup, display) ?? [null];
    units.forEach((unit, i) => {
      items.push(unit);
      starts.push(i > 0 || token.wordStart);
    });
  }
  return { items, starts };
}
