'use strict';

export default {
  name: 'Isograms', icon: '1️⃣', category: 'letters',
  desc: 'No repeated letters',
  example: 'cyberpunk · juxtapose',
  params: [],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  run(entry) {
    const seen = new Set();
    for (const ch of entry) {
      if (ch < 'a' || ch > 'z') continue;
      if (seen.has(ch)) return false;
      seen.add(ch);
    }
    return true;
  },
};
