'use strict';

export default {
  name: 'Scrabble', icon: '🧱', category: 'bank',
  desc: 'Can be spelled with the given tiles',
  example: 'parental → plane, rent',
  params: [{ key: 'tiles', placeholder: 'tiles' }],
  kind: 'filter', input: 'plain', output: 'plain',
  isInert: params => !((params && params.tiles || '').trim()),
  prepare(params) {
    const bank = new Map();
    for (const ch of params.tiles.trim()) bank.set(ch, (bank.get(ch) || 0) + 1);
    return bank;
  },
  run(entry, bank, wordlist) {
    const used = new Map();
    for (const ch of entry) {
      const n = (used.get(ch) || 0) + 1;
      if (n > (bank.get(ch) || 0)) return false;
      used.set(ch, n);
    }
    return true;
  },
};
