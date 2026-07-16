'use strict';

import { buildHelpHTML } from '../../core/util.js';

// ─── Cross-tool helpers ──────────────────────────────────────────────────────
// Only helpers used by 2+ tools belong here; single-use helpers live in their
// tool's own file.

export const MATCH_PARAM = {
  key: 'mode', type: 'match', label: 'Match mode', title: 'Match mode (Alt-W)',
  menuDefault: 'full',
  choices: [
    { value: 'full', label: 'Whole entry' },
    { value: 'word', label: 'Whole word' },
    { value: 'span', label: 'Spans words' },
  ],
};

export function matchModeOf(params) {
  const v = params && params.mode;
  return v === 'full' || v === 'word' || v === 'span' ? v : '';
}

// `value` (not a boolean checkbox) so the URL reads mode=span like Search and
// Regex — the key can grow into the full mode menu without breaking links.
export const SPAN_PARAM = { key: 'mode', type: 'checkbox', value: 'span', label: 'Spans words', title: 'The match must cross a word break' };
export const ALLOW_UNLISTED_PARAM = { key: 'unlisted', type: 'checkbox', replaceScoped: true, label: 'Allow unlisted', title: "Keep replacements that aren't in the wordlist" };

export const SEARCH_HELP = buildHelpHTML([
  ['*', 'any string'],
  ['?', 'any letter or digit'],
  ['#', 'any consonant'],
  ['@', 'any vowel'],
  ['[abc]', 'any of a, b, c'],
  ['[^abc]', 'none of a, b, c'],
  ['[a-m]', 'character range'],
]);

export function reverseString(s) {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += s[i];
  return out;
}

// Sort the letters of an already-canonical string. Tools that need letter-bank
// equivalence call this on `entry` (and on user-supplied params, which the
// runtime normalizes the same way before passing in). Non-letters survive and
// participate in the comparison — for letter-only wordlists they're a no-op,
// for the rare punctuation-bearing entry they make the match stricter.
export function sortLetters(s) {
  if (!s) return '';
  return s.split('').sort().join('');
}
