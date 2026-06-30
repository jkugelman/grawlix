'use strict';

import { toNorm } from '../norm.js';

export default {
  name: 'Add prefix', icon: '➕', category: 'side',
  desc: 'Add a string prefix',
  example: 'tata → cantata',
  params: [{ placeholder: 'prefix' }],
  kind: 'transform', inputHighlights: false, outputHighlights: true,
  glyph: () => '→',
  isInert: params => !toNorm((params && params.prefix) || ''),
  prepare: params => toNorm(params.prefix || ''),
  run(entry, prefix, wordlist) {
    if (!prefix) return [];
    const out = prefix + entry;
    if (!wordlist.byNorm.has(out)) return [];
    return [{ entry: out, outputHighlights: [{ kind: 'search:0', start: 0, end: prefix.length }] }];
  },
};
