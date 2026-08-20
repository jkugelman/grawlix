'use strict';

import { loadCmuDict, hasCmuDict, rhymingPartsOf, lastWordKey, hasPronunciation } from '../phonetics.js';
import { loadUnigramCorpus, hasUnigramCorpus, SPACE_OUT_WINDOWS } from '../segmenter.js';
import { bestSpaceOutSplit, spaceOutSplits } from '../space-out.js';
import { toNorm } from '../norm.js';

async function ensureDict() {
  try {
    await loadCmuDict();
  } catch {
    throw new Error('Couldn’t load the pronunciation dictionary — check your connection.');
  }
}

// Optional, unlike the dictionary: without the corpus every entry still rhymes on
// whatever CMU can read directly, so a failed fetch costs coverage, not the tool.
async function ensureSegmenter() {
  try {
    await loadUnigramCorpus();
  } catch { /* offline → unspaced entries stay unreadable, as before */ }
}

// Module-level, not per-run: a keystroke re-prepares the row, and re-spacing a 500k
// list costs seconds each time. Keyed on vocab identity because splits are scored
// against the wordlist's own norms — they go stale when the merge is rebuilt. Only
// entries that reach the segmenter are stored; caching the cheap paths would hold a
// string per entry for a lookup already cheaper than the Map.
let _splitVocab = null;
const _splitCache = new Map();

// Each clause silently corrupts the rhyme if dropped: CMU knowing the whole string
// settles it (NOTABLE must not read as NO TABLE), a spaced entry is already spelled,
// and a one-letter tail is rankedSplits' short-part escape hatch showing through
// (YOWLERS → YOWLER S), rhyming the entry on a bare letter.
function spacedReading(display, vocab) {
  if (!vocab || !hasUnigramCorpus() || /[\s-]/.test(display) || hasPronunciation(display)) return display;
  if (vocab !== _splitVocab) {
    _splitVocab = vocab;
    _splitCache.clear();
  }
  const hit = _splitCache.get(display);
  if (hit !== undefined) return hit;
  const parts = bestSpaceOutSplit(toNorm(display), vocab);
  const reading = parts && parts[parts.length - 1].length > 1 ? parts.join(' ') : display;
  _splitCache.set(display, reading);
  return reading;
}

// The typed entry earns a wider search than the wordlist gets. At the default
// window the scorer prunes `time machine` outright, because wordfreq carries the
// glued `timemachine` as a token of its own and it outscores the split — so a user
// who pastes an unspaced entry gets nothing, with nothing on screen to say why.
// Widening for the whole wordlist instead is what costs: it rescues 4% of XWI but
// reads them as `orbs → or bs` and `not ate`.
function typedReading(text, vocab) {
  const narrow = spacedReading(text, vocab);
  if (narrow !== text || !vocab || !hasUnigramCorpus()) return narrow;
  if (/[\s-]/.test(text) || hasPronunciation(text)) return narrow;
  const wide = spaceOutSplits(toNorm(text), vocab, { window: SPACE_OUT_WINDOWS.many, limit: 20 })
    .find(parts => parts.length >= 2 && parts[parts.length - 1].length > 1);
  return wide ? wide.join(' ') : narrow;
}

export default {
  name: 'Rhymes', icon: '🎵', category: 'phonetic',
  desc: 'Rhyming words and phrases',
  example: 'rhyme → climb, key lime',
  assets: ['cmudict', 'unigrams'],
  params: [
    { placeholder: 'entry' },
    { key: 'match', type: 'range', default: 'loose',
      choices: [
        { value: 'strict', label: 'Strict' },
        { value: 'loose', label: 'Loose' },
      ] },
  ],
  kind: 'filter', input: 'plain', output: 'plain',
  matchOn: 'display',
  isInert: params => !(params.entry || '').trim(),
  async prepare(params, ctx) {
    await ensureDict();
    await ensureSegmenter();
    const vocab = ctx?.vocab || null;
    const entry = typedReading((params.entry || '').trim(), vocab);
    const mode = params.match || 'loose';
    return { targetParts: rhymingPartsOf(entry, mode), targetLastWord: lastWordKey(entry), mode, vocab };
  },
  run(display, prepared) {
    if (!hasCmuDict() || !prepared.targetParts.length) return false;
    const reading = spacedReading(display, prepared.vocab);
    // Same last word is a repeat, not a rhyme — "Agatha"/"Aunt Agatha", or a word with itself.
    if (lastWordKey(reading) === prepared.targetLastWord) return false;
    for (const part of rhymingPartsOf(reading, prepared.mode)) {
      if (prepared.targetParts.includes(part)) return true;
    }
    return false;
  },
  group: {
    async prepare(params, ctx) {
      await ensureDict();
      await ensureSegmenter();
      return { mode: params.match || 'loose', vocab: ctx?.vocab || null };
    },
    key: (display, prepared) => rhymingPartsOf(spacedReading(display, prepared.vocab), prepared.mode),
    // All one word ("Agatha"/"Aunt Agatha") is a repeat; a real family needs ≥2 distinct
    // rhyming words. Read off the spaced form, so ROADRAGE and PARKINGRAGE count as one.
    keepGroup: (members, prepared) =>
      new Set(members.map(m => lastWordKey(spacedReading(m, prepared.vocab)))).size >= 2,
  },
};
