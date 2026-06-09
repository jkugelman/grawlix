'use strict';

export default {
  name: 'Curtail', icon: '✂️', category: 'side',
  desc: 'Remove the last N letters',
  example: 'PARTY → PART',
  params: [{ label: 'Count', default: '1', type: 'number' }],
  kind: 'transform', inputHighlights: true, outputHighlights: false,
  glyph: () => '→',
  run(entry, params, wordlist) {
    const count = Math.max(1, parseInt(params.count, 10) || 1);
    if (entry.length <= count) return [];
    // Skip plural → singular.
    if (entry.endsWith('s') && !entry.endsWith('ss')) return [];
    const curtailed = entry.slice(0, -count);
    if (!wordlist.byNorm.has(curtailed)) return [];
    return [{ entry: curtailed, inputHighlights: [{ kind: 'removed', start: entry.length - count, end: entry.length }] }];
  },
};
