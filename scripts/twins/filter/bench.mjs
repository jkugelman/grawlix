// Compares candidate filters against filter/truth.mjs's exact hits.
//   node filter/bench.mjs truth.json
import fs from 'node:fs';
import { loadAll } from '../readings.mjs';
import { normOf } from '../lib.mjs';
import { letterSig, phoneSigs, letterPair, phonePair } from './feats.mjs';

const truth = JSON.parse(fs.readFileSync(process.argv[2]));
const C = loadAll(40);
const byNorm = C.byNorm;
let t0 = Date.now();
const LS = C.entries.map(letterSig), PS = C.entries.map(phoneSigs);
const idx = new Map(C.entries.map((e, i) => [e.norm, i]));
console.log(`signatures: ${Date.now() - t0} ms for ${C.entries.length} entries`);

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const queries = Object.entries(truth).map(([text, { ms, hits }]) => {
  const q = C.asEntry(text);
  return { text, q, ls: letterSig(q), ps: phoneSigs(q), ms, hits, calib: hash(text) % 2 === 0 };
});

// ─── Measures on the true hits ──────────────────────
const rows = [];
for (const Q of queries) for (const [norm, loose, route] of Q.hits) {
  const i = idx.get(norm);
  if (i === undefined) continue;
  const lp = letterPair(Q.ls, LS[i]), pp = phonePair(Q.ps, PS[i]);
  rows.push({ Q, norm, loose, route, lhd: lp.hd / lp.L, lmiss: lp.miss / lp.L, lhdRaw: lp.hd, L: lp.L, phd: pp?.hd ?? null, pmiss: pp?.miss ?? null });
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
for (const cut of [0.3, 0.45]) {
  console.log(`\nhits under ${cut}:`);
  for (const route of ['L', 'B', 'S']) {
    const rs = rows.filter((r) => r.loose <= cut && r.route === route);
    if (!rs.length) continue;
    const f = (k) => [0.5, 0.9, 0.99, 1].map((p) => q(rs.map((r) => r[k]).filter((x) => x !== null), p).toFixed(2)).join('/');
    console.log(`  ${route} n=${rs.length}  letter hd/L ${f('lhd')}  letter miss/L ${f('lmiss')}  phone hd/L ${f('phd')}  phone miss/L ${f('pmiss')}   (median/90/99/max)`);
  }
}

// ─── Filters ─────────────────────────────────────────
const FILTERS = {
  'none': () => true,
  'lossless letters only': (lp, pp, cut) => 0.2 * lp.hd / lp.L <= cut || pp !== null,
};
for (const [a, b, c, d] of [[1.0, 1.0, 1.0, 1.0], [1.2, 1.1, 1.0, 1.0], [1.0, 0.9, 0.8, 0.8], [0.9, 0.9, 0.7, 0.7], [1.2, 1.2, 0.9, 0.9]])
  FILTERS[`letters hd≤${a}·L miss≤${b}·L | phones hd≤${c}·L miss≤${d}·L`] = (lp, pp) =>
    (lp.hd / lp.L <= a && lp.miss / lp.L <= b) || (pp !== null && pp.hd <= c && pp.miss <= d);

const sample = queries.filter((_, k) => k % 12 === 0);
console.log(`\nfilter results; false rejections are true hits thrown out (calibration half / test half); survivors measured on ${sample.length} queries`);
for (const [name, fn] of Object.entries(FILTERS)) {
  const fr = {};
  for (const cut of [0.3, 0.45]) {
    const rs = rows.filter((r) => r.loose <= cut);
    const rej = (calib) => rs.filter((r) => r.Q.calib === calib && !fn({ hd: r.lhdRaw, L: r.L, miss: r.lmiss * r.L }, r.phd === null ? null : { hd: r.phd, miss: r.pmiss }, cut));
    fr[cut] = [rej(true), rej(false)];
  }
  let surv = 0;
  t0 = Date.now();
  for (const Q of sample) for (let i = 0; i < LS.length; i++) {
    const lp = letterPair(Q.ls, LS[i]);
    if (lp.L < 3) continue;
    if (fn(lp, phonePair(Q.ps, PS[i]), 0.45)) surv++;
  }
  const ms = (Date.now() - t0) / sample.length;
  console.log(`${name}\n   false rejects @.30 ${fr[0.3][0].length}/${fr[0.3][1].length}  @.45 ${fr[0.45][0].length}/${fr[0.45][1].length}  survivors ${(100 * surv / sample.length / LS.length).toFixed(1)}%  scan ${ms.toFixed(0)} ms/query`);
  for (const r of [...fr[0.3][0], ...fr[0.3][1]].slice(0, 4)) console.log(`     e.g. ${r.Q.text} → ${C.entries[idx.get(r.norm)].display} ${r.loose} ${r.route}`);
}
