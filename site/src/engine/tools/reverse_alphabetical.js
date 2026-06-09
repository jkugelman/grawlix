'use strict';

export default {
  name: 'Reverse alphabetical', icon: '📉', category: 'letters',
  desc: 'Letters in reverse alphabetical order',
  example: 'SPOOFED · YUPPIE',
  params: [],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  run(entry) {
    let prev = null;
    for (const ch of entry) {
      if (ch < 'a' || ch > 'z') continue;
      if (prev && ch > prev) return false;
      prev = ch;
    }
    return true;
  },
};
