'use strict';

import { loadCmuDict, hasCmuDict, rhymingPartsOf } from '../phonetics.js';

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
    return { targetParts: rhymingPartsOf((params.entry || '').trim()) };
  },
  run(display, prepared) {
    if (!hasCmuDict() || !prepared.targetParts.length) return false;
    for (const part of rhymingPartsOf(display)) {
      if (prepared.targetParts.includes(part)) return true;
    }
    return false;
  },
  group: {
    prepare: ensureDict,
    key: display => rhymingPartsOf(display),
  },
};
