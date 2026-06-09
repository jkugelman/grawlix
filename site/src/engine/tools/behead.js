'use strict';

export default {
  name: 'Behead', icon: '🪓', category: 'side',
  desc: 'Remove the first N letters',
  example: 'SLING → LING',
  params: [{ label: 'Count', default: '1', type: 'number' }],
  kind: 'transform', inputHighlights: true, outputHighlights: false,
  glyph: () => '→',
  run(entry, params, wordlist) {
    const count = Math.max(1, parseInt(params.count, 10) || 1);
    if (entry.length <= count) return [];
    const beheaded = entry.slice(count);
    if (!wordlist.byNorm.has(beheaded)) return [];
    return [{ entry: beheaded, inputHighlights: [{ kind: 'removed', start: 0, end: count }] }];
  },
};
