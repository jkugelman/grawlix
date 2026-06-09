'use strict';

export default {
  name: 'Kangaroos', icon: '🦘', category: 'pairs',
  desc: 'Words containing the input spread out',
  example: 'KANGA → MILKANDSUGAR',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', inputHighlights: true, outputHighlights: false,
  isInert: params => !((params && params.entry || '').trim()),
  prepare(params) { return params.entry.trim(); },
  run(entry, joey, wordlist) {
    if (!joey) return true;
    if (entry.length <= joey.length) return false;
    const ranges = [];
    let i = 0;
    for (let j = 0; j < entry.length && i < joey.length; j++) {
      if (entry[j] === joey[i]) {
        ranges.push({ start: j, end: j + 1, kind: 'search:0' });
        i++;
      }
    }
    return i === joey.length ? ranges : false;
  },
};
