// Candidate prefilter: a cheap pass over the corpus that throws out entries
// too different in letter or phone content to score under the cutoff, so
// the aligner runs on the survivors only. Computes the same measures as
// scripts/twins/filter/feats.mjs over packed typed arrays.
import { THRESHOLDS } from './twins-thresholds.js';

const CUTS = Object.keys(THRESHOLDS).map(Number).sort((a, b) => a - b);
const LB = 36 * 36, PB = 64 * 64;
const ch36 = (c) => (c <= 57 ? c - 48 + 26 : c - 97);

// Thresholds for the smallest calibrated cutoff at or above maxLoose; null
// above the largest, where the filter would let nearly everything through.
export function thresholdsFor(maxLoose) {
  const cut = CUTS.find((c) => c >= maxLoose - 1e-9);
  return cut === undefined ? null : THRESHOLDS[cut];
}

function letterIndex(c) {
  const codes = new Uint16Array(Math.max(0, c.length - 1));
  for (let i = 0; i + 1 < c.length; i++) codes[i] = ch36(c.charCodeAt(i)) * 36 + ch36(c.charCodeAt(i + 1));
  return codes;
}
function phoneIndex(p) {
  const codes = new Uint16Array(Math.max(0, p.length - 1));
  for (let i = 0; i + 1 < p.length; i++) codes[i] = p[i] * 64 + p[i + 1];
  return codes;
}

function pack(corpus) {
  const N = corpus.length;
  const n = new Uint16Array(N), m = new Uint16Array(N), hist = new Uint8Array(N * 36);
  const lOff = new Uint32Array(N + 1), rOff = new Uint32Array(N + 1);
  const lCodes = [], readings = [];
  for (let i = 0; i < N; i++) {
    const e = corpus[i];
    n[i] = e.norm.length; m[i] = e.c.length;
    for (let k = 0; k < 36; k++) hist[i * 36 + k] = e.hist[k];
    const lc = letterIndex(e.c);
    lOff[i + 1] = lOff[i] + lc.length;
    lCodes.push(lc);
    for (const { p } of e.sound?.vs ?? []) readings.push(p);
    rOff[i + 1] = readings.length;
  }
  const pOff = new Uint32Array(readings.length + 1);
  readings.forEach((p, r) => (pOff[r + 1] = pOff[r] + p.length));
  const phones = new Uint8Array(pOff[readings.length]);
  readings.forEach((p, r) => phones.set(p, pOff[r]));
  const lFlat = new Uint16Array(lOff[N]);
  lCodes.forEach((lc, i) => lFlat.set(lc, lOff[i]));
  return { N, n, m, hist, lOff, lFlat, rOff, pOff, phones };
}

const packs = new WeakMap();
const scratchL = new Uint8Array(LB), scratchP = new Uint16Array(PB), scratchH = new Uint8Array(64);

// Sum of min(query count, entry count) over the entry's codes, using
// `used` as a scratch tally that is reset before returning.
function common(qCount, codes, lo, hi, used) {
  let cm = 0;
  for (let k = lo; k < hi; k++) { const x = codes[k]; if (used[x] < qCount[x]) { used[x]++; cm++; } }
  for (let k = lo; k < hi; k++) used[codes[k]] = 0;
  return cm;
}

// Indices into `corpus` of the entries that might score under maxLoose,
// or null when no filter applies at that cutoff.
export function candidates(corpus, q, maxLoose, { phones: usePhones = true } = {}) {
  const th = thresholdsFor(maxLoose);
  if (!th) return null;
  const [la, lb, pc, pd] = th;
  let P = packs.get(corpus);
  if (!P) packs.set(corpus, (P = pack(corpus)));
  const { N, n, m, hist, lOff, lFlat, rOff, pOff, phones } = P;

  const qn = q.norm.length, qm = q.c.length, qh = q.hist;
  const qL = letterIndex(q.c), qLCount = new Uint8Array(LB);
  for (const x of qL) qLCount[x]++;
  const qR = (q.sound?.vs ?? []).map(({ p }) => {
    const codes = phoneIndex(p), count = new Uint8Array(PB), h = new Uint8Array(64);
    for (const x of codes) count[x]++;
    for (const x of p) h[x]++;
    return { p, codes, count, h };
  });

  const out = [];
  for (let i = 0; i < N; i++) {
    const L = Math.min(qn, n[i]);
    if (Math.abs(qm - m[i]) / L <= la) {
      let hd = 0;
      for (let k = 0, o = i * 36; k < 36; k++) { const d = qh[k] - hist[o + k]; hd += d < 0 ? -d : d; }
      if (hd / L <= la) {
        const cm = common(qLCount, lFlat, lOff[i], lOff[i + 1], scratchL);
        const miss = Math.max(qL.length - cm, lOff[i + 1] - lOff[i] - cm);
        if (miss / L <= lb) { out.push(i); continue; }
      }
    }
    if (!usePhones || !qR.length || rOff[i] === rOff[i + 1]) continue;
    let bestHd = Infinity, bestMiss = Infinity;
    for (const Q of qR) for (let r = rOff[i]; r < rOff[i + 1]; r++) {
      const lo = pOff[r], hi = pOff[r + 1], bn = hi - lo, Lr = Math.min(Q.p.length, bn);
      const sm = common(Q.h, phones, lo, hi, scratchH);
      bestHd = Math.min(bestHd, (Q.p.length + bn - 2 * sm) / Lr);
      let cm = 0;
      if (bn > 1) {
        for (let k = lo; k + 1 < hi; k++) { const x = phones[k] * 64 + phones[k + 1]; if (scratchP[x] < Q.count[x]) { scratchP[x]++; cm++; } }
        for (let k = lo; k + 1 < hi; k++) scratchP[phones[k] * 64 + phones[k + 1]] = 0;
      }
      bestMiss = Math.min(bestMiss, Math.max(Q.codes.length - cm, Math.max(0, bn - 1) - cm) / Lr);
    }
    if (bestHd <= pc && bestMiss <= pd) out.push(i);
  }
  return out;
}

// The letter half of `candidates`, one entry at a time from its norm, for a
// caller that sees the corpus a row at a time. Null when no filter applies.
export function letterFilter(q, maxLoose) {
  const th = thresholdsFor(maxLoose);
  if (!th) return null;
  const [la, lb] = th, qn = q.norm.length, qm = q.c.length, qh = q.hist;
  const qL = letterIndex(q.c), qLCount = new Uint8Array(LB);
  for (const x of qL) qLCount[x]++;
  const h = new Int8Array(36);
  return (norm) => {
    const c = norm.replace(/(.)\1+/g, '$1'), L = Math.min(qn, norm.length);
    if (Math.abs(qm - c.length) / L > la) return false;
    h.set(qh);
    for (let i = 0; i < c.length; i++) h[ch36(c.charCodeAt(i))]--;
    let hd = 0;
    for (let k = 0; k < 36; k++) hd += h[k] < 0 ? -h[k] : h[k];
    if (hd / L > la) return false;
    const codes = letterIndex(c), cm = common(qLCount, codes, 0, codes.length, scratchL);
    return Math.max(qL.length - cm, codes.length - cm) / L <= lb;
  };
}
