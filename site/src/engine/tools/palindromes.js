'use strict';

import { reverseString } from './shared.js';

export default {
  name: 'Palindromes', icon: '🪞', category: 'palindrome',
  desc: 'Read the same forwards and back',
  example: 'racecar · kayak',
  params: [],
  kind: 'filter', input: 'plain', output: 'plain',
  run(entry) { return entry === reverseString(entry); },
};
