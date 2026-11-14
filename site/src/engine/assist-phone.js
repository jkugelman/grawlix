'use strict';

// ─── Phone search assist ─────────────────────────────────────────────────────
// Reads a Phone search box for the helper panel (see assist.js). Coloring and the
// dialect's own errors are local; the "Searching for" lines need the
// pronunciation dictionary, so the worker translates them (fetchPhoneQuery).

import { parsePhoneQuery, codesOfName } from './phone-dialect.js';
import { code } from './assist.js';

const SOUNDS = [
  ['AA', 'odd'], ['AE', 'at'], ['AH', 'hut'], ['AO', 'ought'], ['AW', 'cow'], ['AY', 'hide'],
  ['EH', 'Ed'], ['ER', 'hurt'], ['EY', 'ate'], ['IH', 'it'], ['IY', 'eat'], ['OW', 'oat'],
  ['OY', 'toy'], ['UH', 'hood'], ['UW', 'two'], ['AX', 'sofa’s a'],
  ['B', 'be'], ['CH', 'cheese'], ['D', 'dee'], ['DH', 'thee'], ['F', 'fee'], ['G', 'green'],
  ['HH', 'he'], ['JH', 'gee'], ['K', 'key'], ['L', 'lee'], ['M', 'me'], ['N', 'knee'],
  ['NG', 'ping'], ['P', 'pee'], ['R', 'read'], ['S', 'sea'], ['SH', 'she'], ['T', 'tea'],
  ['TH', 'theta'], ['V', 'vee'], ['W', 'we'], ['Y', 'yield'], ['Z', 'zee'], ['ZH', 'seizure'],
];

export const PHONE_CHEAT = [
  { code: 'knee', desc: 'a word: finds honey, neon' },
  { code: 'S no', desc: 'capitals are sounds' },
  { code: '@', desc: 'any vowel sound', insert: '@', spaced: true },
  { code: '#', desc: 'any consonant sound', insert: '#', spaced: true },
  { code: '?', desc: 'any sound', insert: '?', spaced: true },
  { code: '*', desc: 'any run of sounds', insert: '*', spaced: true },
  { code: '[AA AO]', desc: 'one of these', insert: '[]', caret: 1, spaced: true },
  { code: '[^ R]', desc: 'none of these', insert: '[^ ]', caret: 3, spaced: true },
  { code: '(NG)', desc: 'must follow, unmarked', insert: '()', caret: 1, spaced: true },
  { code: '(^ R)', desc: 'mustn\u2019t follow', insert: '(^ )', caret: 3, spaced: true },
  { code: 'A, B', desc: 'either one', insert: ', ' },
  { code: 'AA1', desc: 'stress: 0, 1 or 2' },
  ...SOUNDS.map(([name, word]) => ({ code: name, desc: word, insert: name, spaced: true, dense: true })),
];

export function analyzePhone(text, { replacement = false } = {}) {
  const { tokens, alts, error } = parsePhoneQuery(text, { replacement });
  const hints = [];
  for (const alt of alts) {
    for (const el of [...alt.before, ...alt.body, ...alt.after]) {
      if (el.type !== 'word') continue;
      const letter = el.text.trim();
      if (/^[b-hj-z]$/.test(letter) && codesOfName(letter.toUpperCase())) {
        hints.push({
          msg: `${code(letter)} is read as a word, the letter's name. For the sound alone, write it in capitals.`,
          fixes: [{ label: `Use ${letter.toUpperCase()}`, s: el.s, e: el.e, text: letter.toUpperCase() }],
        });
      }
    }
  }
  return { tokens, error, reading: null, hints };
}
