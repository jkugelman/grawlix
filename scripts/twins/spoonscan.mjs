// Exact spoonerisms across the list: entries whose two content words trade
// opening consonant sounds (FIGHTING A LIAR / LIGHTING A FIRE), scored by the
// tool's scorer. Writes loose, route, a, b.
//   node scripts/twins/spoonscan.mjs out.tsv
import fs from 'node:fs';
import { loadAll } from './readings.mjs';
import { makeScorer } from './lib.mjs';

const OUT = process.argv[2];
const { entries } = loadAll(40);
const scorer = makeScorer();
const FUNC = new Set(`a an the of and or nor but yet so for to too in on at by with from into onto upon off out up down over under as is it its be are was were not no if than then that this these those my your his her our their me him us them you he she we they who what all any some each both one very just do does did has have had can could will would shall should may might must`.split(/\s+/));
const isV = (t) => /^[AEIOU]/.test(t);
const bare = (w) => w.map((t) => t.replace(/\d/g, ''));
const byKey = new Map(), ents = [];
for (const e of entries) {
  const w = e.read?.variants?.[0]?.words;
  if (!w || !e.ownSpaced) continue;
  const tw = e.display.toLowerCase().normalize('NFD').replace(/[^a-z0-9' ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (tw.length !== w.length || tw.length > 6) continue;
  const ci = tw.map((x, k) => (!FUNC.has(x) ? k : -1)).filter((k) => k >= 0);
  if (ci.length !== 2) continue;
  const parts = ci.map((k) => { const p = bare(w[k]); const v = p.findIndex(isV); return v < 0 ? null : [p.slice(0, v).join(' '), p.slice(v).join(' ')]; });
  if (parts.includes(null)) continue;
  const frame = tw.map((x, k) => (ci.includes(k) ? '_' : x)).join(' ');
  const key = (a, b) => `${frame}|${a[0]}+${a[1]}|${b[0]}+${b[1]}`;
  const t = { e, parts, key: key(parts[0], parts[1]), swapped: key([parts[1][0], parts[0][1]], [parts[0][0], parts[1][1]]) };
  ents.push(t);
  let l = byKey.get(t.key); if (!l) byKey.set(t.key, (l = [])); l.push(t);
}
const seen = new Set(), out = [];
for (const A of ents) {
  if (A.parts[0][0] === A.parts[1][0]) continue;
  for (const B of byKey.get(A.swapped) ?? []) {
    const k = [A.e.norm, B.e.norm].sort().join('|');
    if (A.e.norm === B.e.norm || seen.has(k)) continue;
    seen.add(k);
    const h = scorer.score(A.e, B.e, 0.6), h2 = scorer.score(B.e, A.e, 0.6);
    const best = [h, h2].filter(Boolean).sort((x, y) => x.loose - y.loose)[0];
    const route = !best ? '-' : best.spoon ? 'spoon' : best.swap ? 'swap' : best.reorder ? 'reorder' : best.rhyme ? 'rhyme' : best.run ? 'run' : best.sound ? 'sound' : 'letters';
    out.push({ a: A.e.display, b: B.e.display, loose: best?.loose ?? Infinity, route, diff: best?.diff ?? '' });
  }
}
out.sort((x, y) => x.loose - y.loose);
console.error(`${ents.length} entries with two content words, ${out.length} spoonerism pairs`);
fs.writeFileSync(OUT, out.map((r) => `${r.loose === Infinity ? '-' : r.loose.toFixed(2)}\t${r.route}\t${r.a}\t${r.b}\t${r.diff}`).join('\n') + '\n');
