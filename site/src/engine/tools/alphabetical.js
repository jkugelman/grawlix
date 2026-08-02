'use strict';

export default {
  name: 'Alphabetical', icon: '📈', category: 'letters',
  desc: 'Letters in alphabetical order',
  example: 'chintz · knotty',
  params: [],
  kind: 'filter', input: 'plain', output: 'plain',
  run(entry) {
    let prev = null;
    for (const ch of entry) {
      if (ch < 'a' || ch > 'z') continue;
      if (prev && ch < prev) return false;
      prev = ch;
    }
    return true;
  },
};
