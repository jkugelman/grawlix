'use strict';

// ─── Column-width hints ───────────────────────────────────────────────────────
// One accumulator folds the per-column max widths whether a flat result is built
// whole (completion) or grown survivor by survivor (stream): a separate stream-only
// width calc would silently drift from completion's and reintroduce an end-of-stream
// column jump.

export function makeWidthHintAcc() {
  let maxDisplayLen = 0, maxScore = 0, hasNeg = false;
  return {
    add(e) {
      const dispLen = (e.display ?? e.norm).length;
      if (dispLen > maxDisplayLen) maxDisplayLen = dispLen;
      if (e.score < 0) hasNeg = true;
      const s = e.score < 0 ? -e.score : e.score;
      if (s > maxScore) maxScore = s;
    },
    hints: () => ({
      maxDisplayLen,
      maxLenDigits: maxDisplayLen > 0 ? String(maxDisplayLen).length : 1,
      maxScoreDigits: String(maxScore).length + (hasNeg ? 1 : 0),
    }),
  };
}

export function computeWidthHints(indices, runCorpus) {
  const acc = makeWidthHintAcc();
  for (let i = 0; i < indices.length; i++) acc.add(runCorpus.entries[indices[i]]);
  return acc.hints();
}

export function computeCorpusWidthBound(corpus) {
  const acc = makeWidthHintAcc();
  for (const e of corpus.entries) acc.add(e);
  return acc.hints();
}
