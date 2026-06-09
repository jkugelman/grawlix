'use strict';

export default {
  name: 'Repeaters', icon: '🔂', category: 'halves',
  desc: 'Left and right halves are the same',
  example: 'TARTAR · HOTSHOTS',
  params: [],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  run(entry) {
    const n = entry.length;
    if (n < 2 || n % 2 !== 0) return false;
    const half = n / 2;
    return entry.slice(0, half) === entry.slice(half);
  },
};
