'use strict';

// ─── Test-only tools ─────────────────────────────────────────────────────────
//
// Installed by test hooks only: listing them in tools.js would put them in the gallery.

import { TOOLS } from './tools.js';

// Emits corpus entries out of norm order, the one way to drop a family anchor
// mid-stream (the seed `zzX` yields `X` under Z; `X` itself yields nothing, so it
// appears once). Make it norm-ordered and the anchor-repair spec tests nothing.
const late_twin = {
  name: 'Late twin', icon: '🧪', category: 'transform',
  desc: 'Test fixture', example: 'zzapple → apple',
  params: [{ key: 'mark' }],
  kind: 'transform', input: 'hidden',
  output: params => (params.mark ? 'highlight' : 'plain'),
  run(entry, params, wordlist) {
    const emit = e => [params.mark ? { entry: e, outputHighlights: [{ start: 0, end: 1, kind: 'search:0' }] } : { entry: e }];
    if (entry.startsWith('zz')) {
      const twin = entry.slice(2);
      return wordlist.norms.has(twin) ? emit(twin) : [];
    }
    if (wordlist.norms.has('zz' + entry)) return [];
    return emit(entry);
  },
};

export function installFixtureTools() {
  Object.assign(TOOLS, { late_twin });
}
