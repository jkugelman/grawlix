'use strict';

import { reverseString } from './shared.js';

export default {
  name: 'Semordnilap', icon: '⬅️', category: 'palindrome',
  desc: 'Reverse to get a different word',
  example: 'stressed → desserts',
  params: [],
  kind: 'transform', inputHighlights: false, outputHighlights: false,
  glyph: () => '→',
  run(entry, params, wordlist) {
    // Bidirectional emit — a row whenever the reverse is also an entry, in
    // both directions. The post-executor `unify` pass collapses
    // the matched mirror pair into one row with a ↔ glyph; a downstream
    // transform breaks the symmetry and the two directions stay separate.
    // Palindromes are skipped — reversing them yields the same word.
    const reversed = reverseString(entry);
    if (reversed === entry) return [];
    if (!wordlist.byNorm.has(reversed)) return [];
    return [{ entry: reversed }];
  },
};
