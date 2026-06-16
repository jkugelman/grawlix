'use strict';

import { sortLetters } from './shared.js';

export default {
  name: 'Neckouts', icon: '🦒', category: 'halves',
  desc: 'Left and right halves are anagrams',
  example: 'stuck one\'s neck out',
  params: [],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  run(entry) {
    const n = entry.length;
    if (n < 2 || n % 2 !== 0) return false;
    const half = n / 2;
    const left = entry.slice(0, half);
    const right = entry.slice(half);
    if (left === right) return false;
    return sortLetters(left) === sortLetters(right);
  },
};
