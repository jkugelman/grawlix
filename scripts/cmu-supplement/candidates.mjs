// Lists the wordlist words Phone search can't read through CMU, the supplement,
// its fallbacks or the segmenter, best-scored first, as batch input:
// word<TAB>examples. Tokens in excluded.tsv are skipped, but the words inside its
// phrases are asked for when nothing reads them.
//
//   node scripts/cmu-supplement/candidates.mjs [MIN_SCORE] > candidates.tsv

import {
  excluded, loadDicts, loadSegmenter, lookup, spacingOf, tokensOf, vocabOf, wordlistRows, wordlistTokens,
} from './lib.mjs';

const minScore = +(process.argv[2] ?? 0);
await loadDicts();
await loadSegmenter();
const rows = wordlistRows();
const vocab = vocabOf(rows);
const spacing = spacingOf(vocab);
const skip = excluded();

const ROMAN = /^(?=[ivxlcdm])m*(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$/;
const isWordPart = p => p.length > 1 || p === 'a' || p === 'i';

const found = new Map();
const note = (word, score, entry) => {
  let c = found.get(word);
  if (!c) found.set(word, c = { max: -Infinity, examples: [] });
  c.max = Math.max(c.max, score);
  if (c.examples.length < 3 && !c.examples.includes(entry)) c.examples.push(entry);
};
// The words a token needs, or none when it reads. A split whose only unreadable
// parts are words the wordlists use asks for those words, not the whole token.
function needed(letters, written) {
  if (lookup(letters, written)) return [];
  const guess = spacing.guess(letters);
  if (guess && guess.length > 1 && guess.every(p => isWordPart(p) && lookup(p))) return [];
  const unknown = guess && guess.length > 1 ? guess.filter(p => !lookup(p)) : [];
  const parts = unknown.length && unknown.every(p => p.length >= 3 && vocab.norms.has(p)) ? unknown : [letters];
  return parts.filter(word => !ROMAN.test(word) && !skip.has(word));
}

const memo = new Map();
for (const { letters, written, entry, score } of wordlistTokens(rows)) {
  if (score < minScore || skip.has(letters)) continue;
  const key = `${letters}\t${written}`;
  if (!memo.has(key)) memo.set(key, needed(letters, written));
  for (const word of memo.get(key)) note(word, score, entry);
}
for (const [token, { kind, spaced }] of skip) {
  if (kind !== 'PHRASE') continue;
  for (const t of tokensOf(spaced)) {
    if (t.digits || !t.letters) continue;
    const written = t.at.map(i => spaced[i]).join('');
    if (!lookup(t.letters, written) && !skip.has(t.letters)) note(t.letters, -1, spaced || token);
  }
}
const out = [...found].sort((a, b) => b[1].max - a[1].max);
for (const [word, c] of out) console.log(`${word}\t${c.examples.join(' | ')}`);
console.error(`${out.length} candidates`);
