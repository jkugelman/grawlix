'use strict';

import { CONSONANTS } from '../search.js';

const NON_CONSONANT = new RegExp(`[^${CONSONANTS}]`, 'g');
export const consonantSkeleton = s => (s || '').replace(NON_CONSONANT, '');

export default {
  name: 'Consonantcy', icon: '🅱️', category: 'letters',
  desc: 'Same consonants in order; vowels may differ',
  example: 'I said no → so done',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', input: 'plain', output: 'plain',
  prepare(params) { return consonantSkeleton(params.entry); },
  run(entry, skeleton, wordlist) {
    if (!skeleton) return true;
    return consonantSkeleton(entry) === skeleton;
  },
  group: {
    key: entry => consonantSkeleton(entry),
    columns: [
      { label: 'Consonants', value: g => g.key.length },
    ],
  },
};
