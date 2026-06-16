'use strict';

export const vowelSkeleton = s => (s || '').replace(/[^aeiou]/g, '');

export default {
  name: 'Vowelcy', icon: '🅰️', category: 'letters',
  desc: 'Same vowels in order; consonants may differ',
  example: 'outhouse → out of use',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
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
