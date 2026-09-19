'use strict';

import { loadCmuDict, hasCmuDict, rhymingPartsOf, lastWordKey, hasPronunciation } from '../phonetics.js';
import { hasUnigramCorpus, SPACE_OUT_WINDOWS } from '../segmenter.js';
import { buildSpacingTable, loadSpacingCorpus, isUnspaced, spaceOutSplits } from '../space-out.js';
import { toNorm } from '../norm.js';

async function ensureDict() {
  try {
    await loadCmuDict();
  } catch {
    throw new Error('Couldn’t load the pronunciation dictionary — check your connection.');
  }
}

// Each clause silently corrupts the rhyme if dropped: CMU knowing the whole string
// settles it (NOTABLE must not read as NO TABLE), and a spaced entry is already spelled.
//
// Past those clauses the dictionary has already declined the glued string, so keeping
// it unsplit is worth exactly nothing — it yields no rhyme at all. That is what earns
// the reader's `guess` over its `best`, which may legitimately answer "already one
// word": RICKROLL is unrhymable until something splits it.
function spacedReading(display, spacing) {
  if (!isUnspaced(display) || hasPronunciation(display)) return display;
  return spacing.guess(toNorm(display))?.join(' ') ?? display;
}

// The typed entry earns a wider search than the wordlist gets. At the default
// window the scorer prunes `time machine` outright, because wordfreq carries the
// glued `timemachine` as a token of its own and it outscores the split — so a user
// who pastes an unspaced entry gets nothing, with nothing on screen to say why.
// Widening for the whole wordlist instead is what costs: it rescues 4% of XWI but
// reads them as `orbs → or bs` and `not ate`.
function typedReading(text, spacing) {
  const narrow = spacedReading(text, spacing);
  if (narrow !== text || !hasUnigramCorpus()) return narrow;
  if (!isUnspaced(text) || hasPronunciation(text)) return narrow;
  const wide = spaceOutSplits(toNorm(text), spacing.vocab, { window: SPACE_OUT_WINDOWS.many, limit: 20 })
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
        { value: 'whole', label: 'Whole' },
        { value: 'strict', label: 'Strict' },
        { value: 'loose', label: 'Loose' },
      ] },
  ],
  kind: 'filter', input: 'plain', output: 'plain',
  matchOn: 'display',
  isInert: params => !(params.entry || '').trim(),
  async prepare(params, ctx) {
    await ensureDict();
    await loadSpacingCorpus();
    const spacing = await buildSpacingTable(ctx);
    const entry = typedReading((params.entry || '').trim(), spacing);
    const mode = params.match || 'loose';
    return { targetParts: rhymingPartsOf(entry, mode), targetLastWord: lastWordKey(entry), mode, spacing };
  },
  run(display, prepared) {
    if (!hasCmuDict() || !prepared.targetParts.length) return false;
    const reading = spacedReading(display, prepared.spacing);
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
      await loadSpacingCorpus();
      return { mode: params.match || 'loose', spacing: await buildSpacingTable(ctx) };
    },
    key: (display, prepared) => rhymingPartsOf(spacedReading(display, prepared.spacing), prepared.mode),
    // All one word ("Agatha"/"Aunt Agatha") is a repeat; a real family needs ≥2 distinct
    // rhyming words. Read off the spaced form, so ROADRAGE and PARKINGRAGE count as one.
    keepGroup: (members, prepared) =>
      new Set(members.map(m => lastWordKey(spacedReading(m, prepared.spacing)))).size >= 2,
  },
};
