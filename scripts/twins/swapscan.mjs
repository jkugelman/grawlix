// Phonetic word swaps across the list: entries with two content words x, y
// and entries with y', x', where x sounds like x' and y like y' (WILL FERRELL
// / PHARRELL WILLIAMS, FRESH MEAT / MEET IN THE FLESH). Function words may sit
// anywhere around the two. Writes tier, distance, a, b, framed, same-frame.
//   node scripts/twins/swapscan.mjs 0.3 out.tsv     0.3: the most each crosswise word pair may differ
import fs from 'node:fs';
import { loadAll } from './readings.mjs';
import { canon, makeSoundScorer, PHONES } from '../../site/src/engine/twins-sound.js';

const MAX = +(process.argv[2] ?? 0.3), OUT = process.argv[3];
const { entries } = loadAll(40);
const S = makeSoundScorer({ consFloor: 0.3 });
const isV = (p) => /^[AEIOU]/.test(PHONES[p]);

const FUNC = new Set(`a an the of and or nor but yet so for to too two in on at by with from into onto upon off out up down over under about above below across after before against along among around as is it its be been are was were am not no yes if than then that this these those there here my your his her our their me him us them you he she we they who whom whose what which how why when where all any some each both one ones very just do does did done has have had can could will would shall should may might must o n 'n s t ll re ve d m oh ah away back through thru like via per vs`.split(/\s+/));
const ents = [];
for (const e of entries) {
  const w = e.read?.variants?.[0]?.words;
  if (!w || !e.ownSpaced) continue;
  const tw = e.display.toLowerCase().normalize('NFD').replace(/[^a-z0-9' ]/g, ' ').trim().split(/\s+/).map((x) => x.replace(/^'+|'+$/g, '').replace(/'s$/, '')).filter(Boolean);
  if (tw.length !== w.length || tw.length > 6) continue;
  const ci = tw.map((x, k) => (x.length >= 3 && !FUNC.has(x) && !/^\d+$/.test(x) && !x.includes("'") ? k : -1)).filter((k) => k >= 0);
  if (ci.length !== 2) continue;
  const words = ci.map((k) => canon([w[k]]));
  if (words.some((x) => x.p.length < 2)) continue;
  const frame = tw.map((x, k) => (k === ci[0] ? '1' : k === ci[1] ? '2' : x)).join(' ');
  ents.push({ e, words, cw: ci.map((k) => tw[k]), frame, str: words.map((x) => String.fromCharCode(...x.p)) });
}
console.error(`${ents.length} readable entries with two content words`);

const skel = (x) => String.fromCharCode(...[...x.p].filter((p) => !isV(p)));
const keysOf = (x, s) => [s, 'K' + skel(x), 'P' + s.slice(0, 3)];
const byFirst = new Map();
ents.forEach((t, i) => { for (const k of keysOf(t.words[0], t.str[0])) { let l = byFirst.get(k); if (!l) byFirst.set(k, (l = [])); l.push(i); } });

// A prefix match must hold in spelling too: by sound alone STAY starts STAKE,
// which flooded the scan with AT STAKE / STAY AT.
function wd(a, b, sa, sb, ta, tb) {
  if (sa === sb) return 0;
  const [s, l] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  const [ts, tl] = sa.length <= sb.length ? [ta, tb] : [tb, ta];
  if (s.length >= 3 && l.startsWith(s) && tl.startsWith(ts)) return 0.05 * (l.length - s.length);
  const r = S.score({ vs: [a] }, { vs: [b] }, 0.5, false);
  return r ? r.loose : Infinity;
}

const SUF = ['', 's', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'y', 'ly', 'ies', 'ier', 'iest', 'n', 'en'];
const stem = (w) => w.replace(/(ies|es|s|ed|ing|ers|er|ly|y|d|n|en)$/, '');
const same = (x, y) => x === y || stem(x) === stem(y) || SUF.some((a) => SUF.some((b) => x + a === y + b || x.replace(/y$/, 'i') + a === y + b || x + a === y.replace(/y$/, 'i') + b || x.replace(/e$/, '') + a === y + b || x + a === y.replace(/e$/, '') + b));
const seen = new Set(), out = [];
ents.forEach((A, i) => {
  const cand = new Set();
  for (const k of keysOf(A.words[1], A.str[1])) { const l = byFirst.get(k); if (l && l.length < 3000) for (const j of l) cand.add(j); }
  for (const j of cand) {
    if (j === i) continue;
    const B = ents[j];
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    if (seen.has(key)) continue;
    const aw = A.cw, bw = B.cw;
    const d1 = wd(A.words[1], B.words[0], A.str[1], B.str[0], aw[1], bw[0]);
    if (d1 > MAX) continue;
    const d2 = wd(A.words[0], B.words[1], A.str[0], B.str[1], aw[0], bw[1]);
    if (d2 > MAX) continue;
    if (d1 === 0 && d2 === 0) continue;
    const s1 = wd(A.words[0], B.words[0], A.str[0], B.str[0], aw[0], bw[0]), s2 = wd(A.words[1], B.words[1], A.str[1], B.str[1], aw[1], bw[1]);
    if (s1 + s2 <= d1 + d2) continue;
    seen.add(key);
    const k1 = same(aw[1], bw[0]), k2 = same(aw[0], bw[1]);
    if (k1 && k2) continue;
    out.push({ a: A.e.display, b: B.e.display, d: d1 + d2, tier: k1 || k2 ? 2 : 1, framed: A.frame !== '1 2' || B.frame !== '1 2' ? 1 : 0, same: A.frame === B.frame ? 1 : 0 });
  }
});
out.sort((x, y) => x.d - y.d);
console.error(`${out.length} candidates`);
fs.writeFileSync(OUT, out.map((r) => `${r.tier}\t${r.d.toFixed(2)}\t${r.a}\t${r.b}\t${r.framed}\t${r.same}`).join('\n') + '\n');
