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
  desc: 'Rhyming words and phrases',
  example: 'rhyme → climb, key lime',
  asset: 'cmudict',
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
  async prepare(params) {
    await ensureDict();
    const entry = (params.entry || '').trim();
    const mode = params.match || 'loose';
    return { targetParts: rhymingPartsOf(entry, mode), targetLastWord: lastWordKey(entry), mode };
  },
  run(display, prepared) {
    if (!hasCmuDict() || !prepared.targetParts.length) return false;
    // Same last word is a repeat, not a rhyme — "Agatha"/"Aunt Agatha", or a word with itself.
    if (lastWordKey(display) === prepared.targetLastWord) return false;
    for (const part of rhymingPartsOf(display, prepared.mode)) {
      if (prepared.targetParts.includes(part)) return true;
    }
    return false;
  },
  group: {
    async prepare(params) { await ensureDict(); return { mode: params.match || 'loose' }; },
    key: (display, prepared) => rhymingPartsOf(display, prepared.mode),
    // All one word ("Agatha"/"Aunt Agatha") is a repeat; a real family needs ≥2 distinct rhyming words.
    keepGroup: members => new Set(members.map(lastWordKey)).size >= 2,
  },
};
