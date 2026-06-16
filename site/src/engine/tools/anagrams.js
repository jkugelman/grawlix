'use strict';

import { sortLetters } from './shared.js';

export default {
  name: 'Anagrams', icon: '🔀', category: 'anagram',
  desc: 'Same letters, rearranged',
  example: 'elvis → lives',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  prepare(params) { return sortLetters(params.entry); },
  run(entry, target, wordlist) {
    if (!target) return true;
    return sortLetters(entry) === target;
  },
  group: {
    key: entry => sortLetters(entry),
    columns: [
      { label: 'Letters', value: g => g.key.length },
    ],
  },
};
