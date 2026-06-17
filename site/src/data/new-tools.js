'use strict';

import { TOOLS } from '../engine/tools.js';
import { unseenToolSlugs } from '../engine/new-tools.js';
import { lsLoad, lsSave } from './storage.js';

const KEY = 'seenTools';

// The catalog frozen as of the release before the reveal shipped — deliberately
// a static list, NOT Object.keys(TOOLS) minus the new ones. Returning users who
// predate the feature baseline to exactly this; computing it live would fold any
// tool added before their next visit into the baseline and never reveal it.
export const RETURNING_BASELINE = [
  'anagrams', 'letter_bank', 'restricted_alphabet', 'scrabble',
  'repeaters', 'neckouts', 'isograms', 'supervocalics', 'monovocalics',
  'alphabetical', 'reverse_alphabetical', 'consonantcy', 'vowelcy',
  'kangaroos', 'joeys', 'palindromes', 'semordnilap', 'rhymes',
  'space_out', 'search', 'regex', 'initialisms', 'behead', 'curtail', 'rebus',
];

function readSeen() {
  try {
    const v = JSON.parse(lsLoad(KEY));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

export function pendingNewTools(isReturning) {
  const all = Object.keys(TOOLS);
  const seen = readSeen();
  // Seed on first boot; without it a brand-new visitor gets the whole catalog
  // dumped on them — a regression only first-time visitors would ever hit.
  if (seen === null) {
    const baseline = isReturning ? RETURNING_BASELINE : all;
    lsSave(KEY, JSON.stringify(baseline));
    return unseenToolSlugs(all, baseline);
  }
  return unseenToolSlugs(all, seen);
}

export function markToolsSeen(slugs) {
  const seen = readSeen() ?? [];
  lsSave(KEY, JSON.stringify([...new Set([...seen, ...slugs])]));
}
