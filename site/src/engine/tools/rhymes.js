'use strict';

import { loadCmuDict, hasCmuDict, rhymingPartsOf, lastWordKey } from '../phonetics.js';
import { buildSpacingTable, loadSpacingCorpus, SPACING_PASS } from '../space-out.js';
import { spacedReading, typedReading } from '../phone-reading.js';

async function ensureDict() {
  try {
    await loadCmuDict();
  } catch {
    throw new Error('Couldn’t load the pronunciation dictionary — check your connection.');
  }
}

export default {
  name: 'Rhymes', icon: '🎵', category: 'phonetic',
  desc: 'Rhyming words and phrases',
  example: 'rhyme → climb, key lime',
  assets: ['cmudict', 'cmuSupplement', 'unigrams'],
  passes: [SPACING_PASS],
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
    passes: [SPACING_PASS],
    weights: { keys: 4, groups: 3 },
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
