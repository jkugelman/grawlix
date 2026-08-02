'use strict';

import { VOWELS } from '../search.js';

const NON_VOWEL = new RegExp(`[^${VOWELS}]`, 'g');
export const vowelSkeleton = s => (s || '').replace(NON_VOWEL, '');

export default {
  name: 'Vowelcy', icon: '🅰️', category: 'letters',
  desc: 'Same vowels in order; consonants may differ',
  example: 'outhouse → out of use',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', input: 'plain', output: 'plain',
  prepare(params) { return vowelSkeleton(params.entry); },
  run(entry, skeleton, wordlist) {
    if (!skeleton) return true;
    return vowelSkeleton(entry) === skeleton;
  },
  group: {
    key: entry => vowelSkeleton(entry),
    columns: [
      { label: 'Vowels', value: g => g.key.length },
    ],
  },
};
