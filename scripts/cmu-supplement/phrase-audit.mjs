// Lists the supplement keys added since REF that the segmenter can split into
// words it reads, as batch input for the word-or-phrase pass:
// token<TAB>split<TAB>examples. These are the likeliest run-together phrases a
// pass pronounced as one word.
//
//   node scripts/cmu-supplement/phrase-audit.mjs [REF=HEAD] > audit.tsv

import {
  examplesByToken, loadDicts, loadSegmenter, segmenter, soundsOf, supplementAt, supplementKeys,
  vocabOf, wordlistRows,
} from './lib.mjs';

const ref = process.argv[2] ?? 'HEAD';
const beforePath = supplementAt(ref);
const before = beforePath ? supplementKeys(beforePath) : new Set();
const added = [...supplementKeys()].filter(k => !before.has(k)).map(k => k.toLowerCase());
await loadDicts();
await loadSegmenter();
const rows = wordlistRows();
const vocab = vocabOf(rows);
const examples = examplesByToken(rows);
const isPart = p => p.length > 1 || p === 'a' || p === 'i';

for (const token of added) {
  if (token.length < 6) continue;
  const split = segmenter.rankedSplits(token, segmenter.SPACE_OUT_WINDOWS.many, vocab)
    .find(parts => parts.length > 1 && parts.every(p => isPart(p) && soundsOf(p)));
  if (split) console.log(`${token}\t${split.join(' ')}\t${(examples.get(token) ?? []).join(' | ')}`);
}
