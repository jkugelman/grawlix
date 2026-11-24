// Measures how the alignment's early-abort allowance trades speed for
// exactness, against filter/truth.mjs's hits.
//   node filter/slack.mjs truth.json
import fs from 'node:fs';
import { makeScorer } from '../lib.mjs';
import { loadAll } from '../readings.mjs';

const truth = JSON.parse(fs.readFileSync(process.argv[2]));
const C = loadAll(40);
const texts = Object.keys(truth).filter((_, k) => k % 24 === 0);
for (const abortSlack of [3, 2, 1.5, 1, 0.5]) {
  const s = makeScorer({ abortSlack, prefilter: false });
  let ms = 0, lost30 = 0, lost45 = 0, n30 = 0, n45 = 0;
  const eg = [];
  for (const text of texts) {
    const t = Date.now();
    const got = new Set(s.query(C.asEntry(text), { maxLoose: 0.45, corpus: C.entries }).map((h) => h.e.norm));
    ms += Date.now() - t;
    for (const [norm, loose] of truth[text].hits) {
      n45++; if (loose <= 0.3) n30++;
      if (got.has(norm)) continue;
      lost45++; if (loose <= 0.3) { lost30++; eg.push(`${text} → ${norm} ${loose}`); }
    }
  }
  console.log(`abortSlack ${abortSlack}: ${(ms / texts.length).toFixed(0)} ms/query, lost ${lost30}/${n30} hits under .30, ${lost45}/${n45} under .45  ${eg.slice(0, 3).join('; ')}`);
}
