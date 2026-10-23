// Lists the supplement words that drop a reading Phone search gave them without
// the supplement, from CMU or the inflection fallback:
// word<TAB>old readings<TAB>entry readings.
// Readings are compared as Phone search hears them (stress stripped, cot–caught
// folded), so a difference it can't hear isn't listed.
//
//   node scripts/cmu-supplement/dropped.mjs > dropped.tsv

import { SUPPLEMENT, loadDicts, soundsOf, supplementKeys } from './lib.mjs';

const words = [...supplementKeys()].map(key => key.toLowerCase());
const readings = word => {
  const sounds = soundsOf(word);
  return sounds ? [...new Set(sounds.filter(s => s.plain).map(s => s.phones.join(' ')))] : null;
};
await loadDicts(null);
const before = new Map(words.map(word => [word, readings(word)]));
await loadDicts(SUPPLEMENT);
let dropped = 0;
for (const word of words) {
  const was = before.get(word);
  if (!was) continue;
  const now = readings(word);
  if (was.every(w => now.includes(w))) continue;
  dropped++;
  console.log(`${word}\t${was.join(' | ')}\t${now.join(' | ')}`);
}
console.error(`${dropped} words drop a fallback reading`);
