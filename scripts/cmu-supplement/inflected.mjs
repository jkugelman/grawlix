// Lists the wordlist tokens only the inflection fallback reads, as batch input
// for the inflections pass: token<TAB>reading<TAB>examples. Excluded phrases
// are left out; they stay on the fallback.
//
//   node scripts/cmu-supplement/inflected.mjs > inflected.tsv

import { parseCmuDict } from '../../site/src/engine/phonetics.js';
import {
  cmuText, examplesByToken, excluded, loadDicts, soundsOf, supplementKeys, wordlistRows, wordlistTokens,
} from './lib.mjs';

await loadDicts();
const listed = new Set([...parseCmuDict(await cmuText()).keys(), ...supplementKeys()].map(k => k.toLowerCase()));
const skip = excluded();
const rows = wordlistRows();
const examples = examplesByToken(rows);
const stressed = s => s.phones.map((p, i) => (/\d/.test(s.stress[i]) ? p + s.stress[i] : p)).join(' ');

const seen = new Set();
for (const { letters } of wordlistTokens(rows)) {
  if (seen.has(letters) || listed.has(letters) || skip.has(letters)) continue;
  seen.add(letters);
  const sounds = soundsOf(letters);
  if (!sounds) continue;
  const readings = [...new Set(sounds.filter(s => s.plain).map(stressed))];
  console.log(`${letters}\t${readings.join(' | ')}\t${examples.get(letters).join(' | ')}`);
}
