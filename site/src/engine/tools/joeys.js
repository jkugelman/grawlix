'use strict';

export default {
  name: 'Joeys', icon: '🍼', category: 'pairs',
  desc: 'Words contained in the input spread out',
  example: 'MAJORKEY → JOEY',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  isInert: params => !((params && params.entry || '').trim()),
  prepare(params) { return params.entry.trim(); },
  run(entry, kangaroo, wordlist) {
    if (!kangaroo) return true;
    if (entry.length >= kangaroo.length) return false;
    let i = 0;
    for (let j = 0; j < kangaroo.length && i < entry.length; j++) {
      if (kangaroo[j] === entry[i]) i++;
    }
    return i === entry.length;
  },
};
