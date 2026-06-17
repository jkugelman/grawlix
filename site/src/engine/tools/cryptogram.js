'use strict';

export function patternKey(s) {
  if (!s) return '';
  const seen = new Map();
  let next = 0;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= '0' && c <= '9') { out += c; continue; }
    let sym = seen.get(c);
    if (sym === undefined) seen.set(c, sym = String.fromCharCode(97 + next++));
    out += sym;
  }
  return out;
}

export default {
  name: 'Cryptogram', icon: '🔐', category: 'cipher',
  desc: 'Same letter-pattern shape',
  example: 'level · rotor',
  params: [{ placeholder: 'entry' }],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  prepare(params) { return patternKey(params.entry); },
  run(entry, key, wordlist) {
    if (!key) return true;
    return patternKey(entry) === key;
  },
  group: {
    key: entry => patternKey(entry),
    columns: [
      { label: 'Letters', value: g => g.key.length },
    ],
  },
};
