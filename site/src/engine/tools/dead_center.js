'use strict';

import { toNorm } from '../norm.js';

// Step by 2: a centered core's length matches the word's parity, so stepping by
// 1 would emit off-center substrings that still pass downstream as dead-center.
export function centeredCores(s) {
  const cores = [];
  for (let k = s.length - 2; k >= 1; k -= 2) {
    const pad = (s.length - k) / 2;
    cores.push(s.slice(pad, pad + k));
  }
  return cores;
}

export default {
  name: 'Dead center', icon: '🎯', category: 'side',
  desc: 'Input sits at the exact center of a longer word',
  example: 'abe → alphabetize',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', inputHighlights: true, outputHighlights: false,
  isInert: params => !toNorm((params && params.entry) || ''),
  prepare: params => toNorm(params.entry || ''),
  run(entry, core, wordlist) {
    if (!core) return true;
    const pad = entry.length - core.length;
    if (pad < 2 || pad % 2 !== 0) return false;
    const start = pad / 2;
    if (entry.slice(start, start + core.length) !== core) return false;
    return [{ start, end: start + core.length, kind: 'search:0' }];
  },
  group: {
    key: entry => centeredCores(entry),
    anchor: (key, wordlist) => wordlist.byNorm.get(key) || null,
    anchorLabel: 'Center',
  },
};
