'use strict';

import { buildHelpHTML } from '../../core/util.js';

// ─── Cross-tool helpers ──────────────────────────────────────────────────────
// Only helpers used by 2+ tools belong here; single-use helpers live in their
// tool's own file.

export const WHOLE_WORD_PARAM = { key: 'whole-word', type: 'checkbox', label: 'Whole word', title: 'Whole word (Alt-W)' };

export const SEARCH_HELP = buildHelpHTML([
  ['*', 'any string'],
  ['?', 'any character'],
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
