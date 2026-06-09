'use strict';

export default {
  name: 'Restricted alphabet', icon: '🔡', category: 'bank',
  desc: 'Uses only the given letters',
  example: 'SPOT → STOOP, TOP, POP',
  params: [{ placeholder: 'letters' }],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  isInert: params => !((params && params.letters || '').trim()),
  prepare(params) { return new Set(params.letters.trim()); },
  run(entry, alphabet, wordlist) {
    for (const ch of entry) if (!alphabet.has(ch)) return false;
    return true;
  },
};
