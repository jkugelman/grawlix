'use strict';

import { toNorm } from '../norm.js';

export default {
  name: 'Remove suffix', icon: '➖', category: 'side',
  desc: 'Remove a string suffix',
  example: 'pet scan → pets',
  params: [{ placeholder: 'suffix' }],
  kind: 'transform', inputHighlights: true, outputHighlights: false,
  glyph: () => '→',
  isInert: params => !toNorm((params && params.suffix) || ''),
  prepare: params => toNorm(params.suffix || ''),
  run(entry, suffix, wordlist) {
    if (!suffix || entry.length <= suffix.length || !entry.endsWith(suffix)) return [];
    const out = entry.slice(0, -suffix.length);
    if (!wordlist.byNorm.has(out)) return [];
    return [{ entry: out, inputHighlights: [{ kind: 'removed', start: out.length, end: entry.length }] }];
  },
};
