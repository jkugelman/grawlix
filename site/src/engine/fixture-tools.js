'use strict';

// ─── Test-only tools ─────────────────────────────────────────────────────────
//
// Installed by test hooks only: listing them in tools.js would put them in the gallery.

import { TOOLS } from './tools.js';
import { bestRowForNorm } from './corpus.js';

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

// Shows its input and emits it back (plus its reverse when listed). Must stay
// glyph-less, which no shipped input-showing transform is, or the atom-count spec
// tests nothing.
const echo = {
  name: 'Echo', icon: '🧪', category: 'transform',
  desc: 'Test fixture', example: 'stop → stop, pots',
  params: [],
  kind: 'transform', input: 'plain', output: 'plain',
  run(entry, params, wordlist) {
    const rev = [...entry].reverse().join('');
    return rev !== entry && wordlist.norms.has(rev) ? [{ entry }, { entry: rev }] : [{ entry }];
  },
};

// Group by the norm minus its trailing digits (`ab042` → `ab`), so a spec sizes and
// orders its groups with a plain loop instead of fitting a real tool's key.
// Digit-less entries join no group.
const groupKey = entry => /\d$/.test(entry) ? entry.replace(/\d+$/, '') : null;

const prefix_group = {
  name: 'Prefix group', icon: '🧪', category: 'transform',
  desc: 'Test fixture', example: 'ab001, ab002 → ab',
  params: [],
  kind: 'filter', input: 'plain', output: 'plain',
  run: entry => groupKey(entry) !== null,
  group: { key: groupKey },
};

// The same, anchored: a group survives only when its key is itself an entry.
const prefix_group_anchored = {
  ...prefix_group,
  name: 'Anchored prefix group',
  group: { key: groupKey, anchor: (key, wordlist) => bestRowForNorm(wordlist, key), anchorLabel: 'Prefix' },
};

// A transform whose outputs the spec lists: `pairs: 'spark>park devil>lived'` maps
// each seed to its listed outputs that are corpus entries. `input: 'highlight'`
// marks the whole input word, for an input-marked shape.
const parsePairs = text => {
  const map = new Map();
  for (const pair of (text || '').split(/[\s,]+/).filter(Boolean)) {
    const [from, to] = pair.split('>');
    if (!map.has(from)) map.set(from, []);
    map.get(from).push(to);
  }
  return map;
};

const pair_map = {
  name: 'Pair map', icon: '🧪', category: 'transform',
  desc: 'Test fixture', example: 'spark>park',
  params: [{ key: 'pairs' }, { key: 'input' }],
  kind: 'transform', glyph: () => '→',
  input: params => params.input || 'plain', output: 'plain',
  isInert: params => !(params && params.pairs),
  prepare: params => ({ map: parsePairs(params.pairs), markInput: params.input === 'highlight' }),
  run(entry, { map, markInput }, wordlist) {
    return (map.get(entry) || []).filter(to => wordlist.norms.has(to)).map(to => markInput
      ? { entry: to, inputHighlights: [{ start: 0, end: entry.length, kind: 'search:0' }] }
      : { entry: to });
  },
};

// A filter that throws from the stage `at` names (`run` or `prepare`) and passes
// everything otherwise, so a spec "fixes" it by clearing the param.
const THROWS_MESSAGE = 'deliberate test failure';
const throws = {
  name: 'Throws', icon: '🧪', category: 'transform',
  desc: 'Test fixture', example: 'at: run',
  params: [{ key: 'at' }],
  kind: 'filter', input: 'plain', output: 'plain',
  prepare(params) {
    if (params.at === 'prepare') throw new Error(THROWS_MESSAGE);
    return params;
  },
  run(entry, params) {
    if (params.at === 'run') throw new Error(THROWS_MESSAGE);
    return true;
  },
};

export function installFixtureTools() {
  Object.assign(TOOLS, { late_twin, echo, prefix_group, prefix_group_anchored, pair_map, throws });
}
