// Lists the wordlist tokens Phone search reads only by splitting them into
// words, best-scored first, as batch input for the splits pass:
// token<TAB>split<TAB>examples. Tokens in excluded.tsv are skipped.
//
//   node scripts/cmu-supplement/splits.mjs [MIN_SCORE] > splits.tsv

import {
  examplesByToken, excluded, loadDicts, loadSegmenter, lookup, spacingOf, vocabOf, wordlistRows, wordlistTokens,
} from './lib.mjs';

const minScore = +(process.argv[2] ?? 0);
await loadDicts();
await loadSegmenter();
const rows = wordlistRows();
const spacing = spacingOf(vocabOf(rows));
const examples = examplesByToken(rows);
const skip = excluded();
const isPart = p => p.length > 1 || p === 'a' || p === 'i';

const best = new Map();
for (const { letters, written, score } of wordlistTokens(rows)) {
  if (score < minScore || skip.has(letters) || (best.get(letters)?.score ?? -Infinity) >= score) continue;
  if (lookup(letters, written)) continue;
  const guess = spacing.guess(letters);
  if (guess && guess.length > 1 && guess.every(p => isPart(p) && lookup(p))) best.set(letters, { score, split: guess.join(' ') });
}
for (const [token, { split }] of [...best].sort((a, b) => b[1].score - a[1].score)) {
  console.log(`${token}\t${split}\t${examples.get(token).join(' | ')}`);
}
