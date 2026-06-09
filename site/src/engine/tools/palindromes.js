'use strict';

import { reverseString } from './shared.js';

export default {
  name: 'Palindromes', icon: '🪞', category: 'palindrome',
  desc: 'Read the same forwards and back',
  example: 'RACECAR · KAYAK',
  params: [],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  run(entry) { return entry === reverseString(entry); },
};
