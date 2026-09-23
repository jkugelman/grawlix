'use strict';

import { mergeKey, bestRowForNorm } from './corpus.js';
import { displayOf, toNorm, isUnspaced } from './norm.js';
import { SPACE_OUT_WINDOWS, rankedSplits, bestCompoundSplit, hasUnigramCorpus, loadUnigramCorpus } from './segmenter.js';

// ─── Wordlist-aware spacing ──────────────────────────────────────────────────
//
// rankedSplits ranks bare norms; this layer turns them into something displayable.
// The entry panel's rename hint and the Space out tool both route through here, so
// one entry spaces out identically wherever it is shown.

// Not a result count. The re-rank can only reorder splits the enumeration already
// produced, so a caller keeping only the top answer must still enumerate wide —
// matching the window to the keep-count silently mutes bigrams.
const MIN_WINDOW = SPACE_OUT_WINDOWS.few;

export function casePart(part, wordlist) {
  // An explicit all-lowercase row is the wordlist vouching for lowercase. Without
  // this, every ordinary word takes the code-unit-minimum display below and shouts.
  if (wordlist.byKey.has(mergeKey(part, part))) return part;
  const display = bestRowForNorm(wordlist, part)?.display;
  // A spaced display would re-split the very part it is meant to spell.
  return display && !/\s/.test(display) ? display : part;
}

export function spaceOutSplits(norm, wordlist, { window = MIN_WINDOW, limit = Infinity } = {}) {
  const splits = rankedSplits(norm, Math.max(window, MIN_WINDOW), wordlist);
  return splits.slice(0, limit).map(parts => parts.map(p => casePart(p, wordlist)));
}

export function bestSpaceOutSplit(norm, wordlist) {
  const [parts] = spaceOutSplits(norm, wordlist, { limit: 1 });
  return parts?.length >= 2 ? parts : null;
}

// ─── Spacing table ───────────────────────────────────────────────────────────
//
// Every unspaced norm's reading, kept per wordlist in the prepare cache and shared by
// the tools that read entries as words. `best` holds the top-ranked split, or the norm
// itself for a one-word entry, so absence means unread, never one word. `compound`
// holds bestCompoundSplit's guess only where `best` has no usable reading and it found one.

const SPACING_TABLE_KEY = 'space-out/readings';
const BYTES_PER_TABLE_SLOT = 24;
const BYTES_PER_STRING_HEADER = 16;

const hasUsableTail = parts => toNorm(parts[parts.length - 1]).length > 1;

function priceOf(table) {
  let bytes = (table.best.size + table.compound.size) * BYTES_PER_TABLE_SLOT;
  for (const [norm, reading] of table.best) if (reading !== norm) bytes += BYTES_PER_STRING_HEADER + reading.length;
  for (const reading of table.compound.values()) bytes += BYTES_PER_STRING_HEADER + reading.length;
  return bytes;
}

// A reading changes only when a word it could be built from enters or leaves the
// vocab. The compound tier vets parts down to two letters, and splits a stem whose
// dropped e/y it restores (BAKESALING reads through SALE), so both count as contained.
function dropStaleReadings(table, flippedNorms) {
  const needles = [];
  for (const norm of flippedNorms) {
    if (norm.length < 2) continue;
    needles.push(norm);
    if (norm.length > 2 && /[ey]$/.test(norm)) needles.push(norm.slice(0, -1));
  }
  if (!needles.length) return;
  for (const norm of table.best.keys()) {
    if (!needles.some(needle => norm.includes(needle))) continue;
    table.best.delete(norm);
    table.compound.delete(norm);
  }
}

class SpacingReader {
  constructor(table, vocab) {
    this.table = table;
    this.vocab = vocab;
  }

  // Both tiers at once, so a norm present in `best` always has its compound settled.
  read(norm) {
    if (this.table.best.has(norm) || !hasUnigramCorpus()) return;
    const [parts] = rankedSplits(norm, MIN_WINDOW, this.vocab);
    const split = parts?.length >= 2 ? parts : null;
    this.table.best.set(norm, split ? split.join(' ') : norm);
    if (split && hasUsableTail(split)) return;
    const compound = bestCompoundSplit(norm, this.vocab);
    if (compound) this.table.compound.set(norm, compound.join(' '));
  }

  best(norm) {
    this.read(norm);
    const reading = this.table.best.get(norm);
    return reading === undefined || reading === norm ? null : reading.split(' ');
  }

  // For a caller with no use for "already one word". A one-letter tail is rankedSplits'
  // short-part escape hatch showing through (YOWLERS → YOWLER S), not a word to read.
  guess(norm) {
    const best = this.best(norm);
    if (best && hasUsableTail(best)) return best;
    return this.table.compound.get(norm)?.split(' ') ?? null;
  }
}

const emptyTable = () => ({ best: new Map(), compound: new Map() });

// For a tool that works without readings: a failed fetch costs it coverage, not the run.
export async function loadSpacingCorpus() {
  try {
    await loadUnigramCorpus();
  } catch { /* offline → unspaced entries stay unread */ }
}

// Never builds: a tool that rules most entries out first reads the few it needs.
export function spacingReader(ctx) {
  return new SpacingReader(ctx.cache.get(SPACING_TABLE_KEY) ?? emptyTable(), ctx.vocab);
}

export async function buildSpacingTable(ctx) {
  const cached = ctx.cache.get(SPACING_TABLE_KEY);
  if (cached) return new SpacingReader(cached, ctx.vocab);
  const reader = new SpacingReader(emptyTable(), ctx.vocab);
  if (!hasUnigramCorpus()) return reader;
  await ctx.forEach(ctx.wordlist.entries, wlEntry => {
    if (isUnspaced(displayOf(wlEntry))) reader.read(wlEntry.norm);
  });
  ctx.cache.put(SPACING_TABLE_KEY, reader.table, priceOf(reader.table), { patch: dropStaleReadings });
  return reader;
}
