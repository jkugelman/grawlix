'use strict';

export function caesarShift(s, n) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // `+ 26` only matters for the negative n caesarKey passes; without it those
    // shifts go out of range and silently produce wrong letters.
    if (c >= 97 && c <= 122) out += String.fromCharCode((c - 97 + n % 26 + 26) % 26 + 97);
    else out += s[i];
  }
  return out;
}

// Two entries are Caesar shifts of each other iff this canonical form (every
// letter shifted so the first lands on 'a') matches — so the all-shifts modes
// compare keys instead of trying 25 shifts per entry.
export function caesarKey(s) {
  if (!s) return '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) return caesarShift(s, -(c - 97));
  }
  return s;
}

function fixedShift(params) {
  const n = parseInt(params.shift, 10);
  if (!Number.isFinite(n)) return null;
  const m = ((n % 26) + 26) % 26;
  return m === 0 ? null : m;
}

const seedOf = params => (params.entry || '').trim();

export default {
  name: 'Caesar shift', icon: '🥗', category: 'cipher',
  desc: 'Shift each letter by n',
  example: 'steeds → tuffet',
  params: [
    { placeholder: 'entry' },
    { label: 'Shift', type: 'number', placeholder: 'any' },
  ],
  kind: (params, all) => all ? (fixedShift(params) != null ? 'transform' : 'group') : 'filter',
  inputHighlights: false, outputHighlights: false,
  glyph: () => '→',
  isInert: params => !seedOf(params),
  prepare(params, ctx) {
    if (ctx.grouped) return { mode: 'rot', n: fixedShift(params) };
    const seed = seedOf(params);
    const n = fixedShift(params);
    return n == null ? { mode: 'class', key: caesarKey(seed), seed }
                     : { mode: 'target', target: caesarShift(seed, n) };
  },
  run(entry, p, wordlist) {
    switch (p.mode) {
      // Exclude the seed itself: shift 0 is the identity, outside the -13..+12
      // range the tool advertises.
      case 'class': return caesarKey(entry) === p.key && entry !== p.seed;
      case 'target': return entry === p.target;
      case 'rot': {
        const out = caesarShift(entry, p.n);
        if (out === entry) return [];
        return wordlist.byNorm.has(out) ? [{ entry: out }] : [];
      }
    }
  },
  group: {
    key: entry => caesarKey(entry),
    columns: [
      { label: 'Letters', value: g => g.key.length },
    ],
  },
};
