'use strict';

import { toNorm } from '../norm.js';

export default {
  name: 'Add suffix', icon: '➕', category: 'side',
  desc: 'Add a string suffix',
  example: 'pets → pet scan',
  params: [{ placeholder: 'suffix' }],
  kind: 'transform', inputHighlights: false, outputHighlights: true,
  glyph: () => '→',
  isInert: params => !toNorm((params && params.suffix) || ''),
  prepare: params => toNorm(params.suffix || ''),
  run(entry, suffix, wordlist) {
    if (!suffix) return [];
    const out = entry + suffix;
    if (!wordlist.byNorm.has(out)) return [];
    return [{ entry: out, outputHighlights: [{ kind: 'search:0', start: entry.length, end: out.length }] }];
  },
};
