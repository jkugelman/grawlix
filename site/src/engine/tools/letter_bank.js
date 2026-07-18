'use strict';

export default {
  name: 'Letter bank', icon: '🏦', category: 'bank',
  desc: 'Only the given letters, each at least once',
  example: 'spot → stoops, tops, postop',
  params: [{ placeholder: 'letters' }],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  isInert: params => !((params && params.letters || '').trim()),
  prepare(params) { return new Set(params.letters.trim()); },
  run(entry, alphabet, wordlist) {
    if (alphabet.size === 0) return true;
    const present = new Set();
    for (const ch of entry) {
      if (!alphabet.has(ch)) return false;
      present.add(ch);
    }
    return present.size === alphabet.size;
  },
  group: {
    key: entry => [...new Set(entry)].sort().join(''),
    columns: [
      { label: 'Letters', value: g => g.key.length },
    ],
  },
};
