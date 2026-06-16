'use strict';

import { loadCmuDict, hasCmuDict, rhymingPartsOf, lastWordKey } from '../phonetics.js';

async function ensureDict() {
  try {
    await loadCmuDict();
  } catch {
    throw new Error('Couldn’t load the pronunciation dictionary — check your connection.');
  }
}

export default {
  name: 'Rhymes', icon: '🎵', category: 'phonetic',
  desc: 'Words that rhyme',
  example: 'RHYME → CLIMB, KEYLIME',
  asset: 'cmudict',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  matchOn: 'display',
  isInert: params => !(params.entry || '').trim(),
  async prepare(params) {
    await ensureDict();
    const entry = (params.entry || '').trim();
    return { targetParts: rhymingPartsOf(entry), targetLastWord: lastWordKey(entry) };
  },
  run(display, prepared) {
    if (!hasCmuDict() || !prepared.targetParts.length) return false;
    // Same last word is a repeat, not a rhyme — "Agatha"/"Aunt Agatha", or a word with itself.
    if (lastWordKey(display) === prepared.targetLastWord) return false;
    for (const part of rhymingPartsOf(display)) {
      if (prepared.targetParts.includes(part)) return true;
    }
    return false;
  },
  group: {
    prepare: ensureDict,
    key: display => rhymingPartsOf(display),
    // All one word ("Agatha"/"Aunt Agatha") is a repeat; a real family needs ≥2 distinct rhyming words.
    keepGroup: members => new Set(members.map(lastWordKey)).size >= 2,
  },
};
