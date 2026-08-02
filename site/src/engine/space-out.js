'use strict';

import { mergeKey, bestRowForNorm } from './corpus.js';
import { SPACE_OUT_WINDOWS, rankedSplits } from './segmenter.js';

// ─── Wordlist-aware spacing ──────────────────────────────────────────────────
//
// rankedSplits ranks bare norms; this layer turns them into something displayable.
// The entry panel's rename hint and the Space out tool both route through here, so
// one entry spaces out identically wherever it is shown.

// Not a result count. The re-rank can only reorder splits the enumeration already
// produced, so a caller keeping only the top answer must still enumerate wide —
// matching the window to the keep-count silently mutes bigrams.
const MIN_WINDOW = SPACE_OUT_WINDOWS.few;

export function casePart(part, wordlist) {
  // An explicit all-lowercase row is the wordlist vouching for lowercase. Without
  // this, every ordinary word takes the code-unit-minimum display below and shouts.
  if (wordlist.byKey.has(mergeKey(part, part))) return part;
  const display = bestRowForNorm(wordlist, part)?.display;
  // A spaced display would re-split the very part it is meant to spell.
  return display && !/\s/.test(display) ? display : part;
}

export function spaceOutSplits(norm, wordlist, { window = MIN_WINDOW, limit = Infinity } = {}) {
  const splits = rankedSplits(norm, Math.max(window, MIN_WINDOW), wordlist);
  return splits.slice(0, limit).map(parts => parts.map(p => casePart(p, wordlist)));
}

export function bestSpaceOutSplit(norm, wordlist) {
  const [parts] = spaceOutSplits(norm, wordlist, { limit: 1 });
  return parts?.length >= 2 ? parts : null;
}
