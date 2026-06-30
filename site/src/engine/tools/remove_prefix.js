'use strict';

import { toNorm } from '../norm.js';

export default {
  name: 'Remove prefix', icon: '➖', category: 'side',
  desc: 'Remove a string prefix',
  example: 'cantata → tata',
  params: [{ placeholder: 'prefix' }],
  kind: 'transform', inputHighlights: true, outputHighlights: false,
  glyph: () => '→',
  isInert: params => !toNorm((params && params.prefix) || ''),
  prepare: params => toNorm(params.prefix || ''),
  run(entry, prefix, wordlist) {
    if (!prefix || entry.length <= prefix.length || !entry.startsWith(prefix)) return [];
    const out = entry.slice(prefix.length);
    if (!wordlist.byNorm.has(out)) return [];
    return [{ entry: out, inputHighlights: [{ kind: 'removed', start: 0, end: prefix.length }] }];
  },
};
