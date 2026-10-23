// Lists the wordlist tokens with no entry whose Phone search reading changed
// between REF's supplement and the working one, as batch input for the drift
// pass: token<TAB>old<TAB>new<TAB>examples. A reading is the token's phones,
// or `split: ...` for the pieces the segmenter reads it as. A new stem changes
// these silently: CARPE in the supplement turns CARPED from CARP + ED into
// CARPE + D. Excluded phrases and fragments are left out; a SPLIT token is
// listed, since the split it was judged on may be the one that changed.
//
//   node scripts/cmu-supplement/drift.mjs [REF=HEAD] > drift.tsv

import { parseCmuDict } from '../../site/src/engine/phonetics.js';
import { itemsOf, tableSplits } from '../../site/src/engine/phone-reading.js';
import {
  SUPPLEMENT, cmuText, examplesByToken, excluded, loadDicts, loadSegmenter, soundsOf, spacingOf,
  supplementAt, supplementKeys, vocabOf, wordlistRows, wordlistTokens,
} from './lib.mjs';

const ref = process.argv[2] ?? 'HEAD';
await loadSegmenter();
const rows = wordlistRows();
const vocab = vocabOf(rows);
const examples = examplesByToken(rows);
const listed = new Set([...parseCmuDict(await cmuText()).keys(), ...supplementKeys()].map(k => k.toLowerCase()));
const skip = excluded();
const tokens = new Set();
for (const { letters } of wordlistTokens(rows)) {
  if (!listed.has(letters) && skip.get(letters)?.kind !== 'PHRASE' && skip.get(letters)?.kind !== 'FRAGMENT') tokens.add(letters);
}

async function readings(supplement) {
  await loadDicts(supplement);
  const spacing = spacingOf(vocab);
  const out = new Map();
  for (const t of tokens) {
    const sounds = soundsOf(t);
    if (sounds) {
      out.set(t, [...new Set(sounds.filter(s => s.plain).map(s => s.phones.join(' ')))].join(' | '));
    } else {
      const { items } = itemsOf(t, tableSplits(spacing), soundsOf);
      out.set(t, `split: ${items.map(it => (it ? it.letters : '?')).join(' ')}`);
    }
  }
  return out;
}

const before = await readings(supplementAt(ref));
const after = await readings(SUPPLEMENT);
for (const [t, now] of after) {
  const was = before.get(t);
  if (was !== now) console.log(`${t}\t${was}\t${now}\t${examples.get(t).join(' | ')}`);
}
