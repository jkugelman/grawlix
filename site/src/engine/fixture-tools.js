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
  params: [],
  kind: 'transform', input: 'hidden', output: 'plain',
  run(entry, params, wordlist) {
    if (entry.startsWith('zz')) {
      const twin = entry.slice(2);
      return wordlist.norms.has(twin) ? [{ entry: twin }] : [];
    }
    if (wordlist.norms.has('zz' + entry)) return [];
    return [{ entry }];
  },
};

export function installFixtureTools() {
  Object.assign(TOOLS, { late_twin });
}
