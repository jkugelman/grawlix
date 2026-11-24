// Phone-level distance for Twins: a Gotoh (affine-gap) alignment over
// ARPABET phones with feature-weighted substitutions, normalized like the
// letter scorer (cost / shorter length). See scripts/twins/README.md § Findings.
import { CONSONANTS, VOWELS } from './phone-dialect.js';
import { flapsAt, isVowel, soundsOf, wholeEntryReadings } from './phonetics.js';
import { itemsOf, soundsOrSpelled, tokensOf } from './phone-reading.js';

export const PHONES = [...CONSONANTS, ...VOWELS];
const IDX = new Map(PHONES.map((p, i) => [p, i]));
const NP = PHONES.length;

// ─── Features ────────────────────────────────────────
const C = {
  P: [0, 'stop', 0], B: [0, 'stop', 1], M: [0, 'nasal', 1],
  F: [1, 'fric', 0], V: [1, 'fric', 1],
  TH: [2, 'fric', 0], DH: [2, 'fric', 1],
  T: [3, 'stop', 0], D: [3, 'stop', 1], S: [3, 'fric', 0], Z: [3, 'fric', 1], N: [3, 'nasal', 1], L: [3, 'liquid', 1],
  R: [3.5, 'liquid', 1],
  SH: [4, 'fric', 0], ZH: [4, 'fric', 1], CH: [4, 'aff', 0], JH: [4, 'aff', 1],
  Y: [5, 'glide', 1], W: [0.5, 'glide', 1],
  K: [6, 'stop', 0], G: [6, 'stop', 1], NG: [6, 'nasal', 1],
  HH: [7, 'fric', 0],
};
const MANNER = {
  'stop-aff': 0.2, 'aff-fric': 0.2, 'fric-stop': 0.4, 'aff-stop': 0.2, 'nasal-stop': 0.4,
  'fric-nasal': 0.7, 'liquid-nasal': 0.5, 'glide-liquid': 0.3, 'fric-glide': 0.6, 'fric-liquid': 0.7,
  'aff-nasal': 0.8, 'glide-stop': 0.8, 'glide-nasal': 0.6, 'liquid-stop': 0.8, 'aff-liquid': 0.9, 'aff-glide': 0.7,
};
const mannerDist = (a, b) => (a === b ? 0 : MANNER[`${a}-${b}`] ?? MANNER[`${b}-${a}`] ?? 1);

// Vowels: [height 0 (low)..4 (high), backness 0 (front)..2 (back), rounded]; a
// diphthong lists its start and end.
const V = {
  IY: [[4, 0, 0]], IH: [[3, 0.3, 0]], EY: [[3, 0, 0], [3.7, 0, 0]], EH: [[2, 0, 0]], AE: [[1, 0, 0]],
  AA: [[0, 2, 0]], AH: [[1.5, 1, 0]], AO: [[1, 2, 1]], OW: [[2, 2, 1], [3.5, 2, 1]], UH: [[3, 1.7, 1]], UW: [[4, 2, 1]],
  ER: [[2, 1, 0]], AY: [[0, 1, 0], [3.7, 0, 0]], AW: [[0, 1, 0], [3.7, 2, 1]], OY: [[1, 2, 1], [3.7, 0, 0]],
};
const vdist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], 0.5 * (p[2] - q[2]));
function vowelDist(a, b) {
  const A = V[a], B = V[b];
  const s = vdist(A[0], B[0]);
  const e = vdist(A.at(-1), B.at(-1));
  return A.length === 1 && B.length === 1 ? s : (s + e) / 2;
}

// ─── Knobs ───────────────────────────────────────────
export const DEFAULTS = {
  vowelBase: 0.2, vowelPer: 0.16, // vowel sub = vowelBase + vowelPer × distance, capped at subOther
  voice: 0.25, // consonants differing only in voicing
  place: 0.1, // per place step
  consFloor: 0, // added to every change of one consonant to another
  subOther: 1.0, // vowel vs consonant, and the cap
  glideVowel: 0.5, // Y~IY/IH, W~UW/UH, R~ER
  gapOpen: 0.3,
  extVowel: 0.35, extSchwa: 0.2, extCons: 0.55, extWeak: 0.4, // weak: HH Y W
  rMerge: 0.3, // a vowel + R against ER (SURE / SHER-): one op at this cost; Infinity disables
  moveBase: Infinity, // one phone deleted and reinserted elsewhere, or two neighbors swapped, costs this in place of its two edits; Infinity disables
  moveRest: 0, // …only while the alignment's other edits cost at most this
  minLen: 3, // phones in the shorter entry
};

// ─── Canonical form ──────────────────────────────────
const BEFORE_R = { IY: 'IH', UW: 'UH', EY: 'EH' };
const WEAK = new Set(['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'UH']);

// Folds word by word, as phonetics.js does: an R opening the next word colors
// nothing before it, so SAW RED still merges cot–caught.
export function canon(words, reduce = true) {
  const t = words.flatMap((w) => foldToks(w, reduce));
  const p = new Uint8Array(t.length), s = new Uint8Array(t.length);
  t.forEach((tok, i) => {
    const bare = isVowel(tok) ? tok.slice(0, 2) : tok;
    p[i] = IDX.get(bare);
    s[i] = isVowel(tok) ? +tok.slice(2) || 0 : 0;
  });
  return { p, s };
}

function foldToks(toks, reduce) {
  // CMU writes the R after AY/AW as its own syllable or not on a whim.
  const sm = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'ER0' && /^A[YW]\d$/.test(toks[i - 1] ?? '')) sm.push('R');
    else sm.push(toks[i]);
  }
  return sm.map((tok, i) => {
    if (!isVowel(tok)) return reduce && (tok === 'T' || tok === 'D') && flapsAt(sm, i) ? 'D' : tok;
    let bare = tok.slice(0, 2);
    const stress = tok.slice(2);
    if (sm[i + 1] === 'R') {
      const next2 = sm[i + 2] ?? '-';
      if (reduce && bare in BEFORE_R && !(bare === 'EY' && isVowel(next2))) bare = BEFORE_R[bare];
    } else if (bare === 'AO') bare = 'AA';
    if (reduce && stress === '0' && WEAK.has(bare)) bare = 'AH';
    return bare + stress;
  });
}

// ─── Scorer ──────────────────────────────────────────
export function makeSoundScorer(overrides = {}) {
  const K = { ...DEFAULTS, ...overrides };
  const SUB = new Float64Array(NP * NP);
  const isV = new Uint8Array(NP);
  PHONES.forEach((p, i) => { isV[i] = VOWELS.includes(p) ? 1 : 0; });
  const glide = { Y: ['IY', 'IH'], W: ['UW', 'UH'], R: ['ER'] };
  for (let i = 0; i < NP; i++) for (let j = 0; j < NP; j++) {
    const a = PHONES[i], b = PHONES[j];
    let c;
    if (i === j) c = 0;
    else if (isV[i] && isV[j]) c = Math.min(K.subOther, K.vowelBase + K.vowelPer * vowelDist(a, b));
    else if (!isV[i] && !isV[j]) {
      const [pa, ma, va] = C[a], [pb, mb, vb] = C[b];
      c = Math.min(K.subOther, K.consFloor + K.voice * (va !== vb ? 1 : 0) + K.place * Math.min(Math.abs(pa - pb), 4) + mannerDist(ma, mb));
    } else {
      const [cons, vow] = isV[i] ? [b, a] : [a, b];
      c = glide[cons]?.includes(vow) ? K.glideVowel : K.subOther;
    }
    SUB[i * NP + j] = c;
  }
  const extOf = (p, s) => {
    const name = PHONES[p];
    if (isV[p]) return name === 'AH' && s === 0 ? K.extSchwa : K.extVowel;
    return name === 'HH' || name === 'Y' || name === 'W' ? K.extWeak : K.extCons;
  };
  const O = K.gapOpen;
  const minExt = Math.min(K.extVowel, K.extSchwa, K.extCons, K.extWeak);
  let cap = 0, Mx, Xx, Yx, BM, BX, BY, MK;
  const ER = IDX.get('ER'), RR = IDX.get('R');
  const ensure = (n) => {
    if (n <= cap) return;
    cap = n * 2;
    Mx = new Float64Array(cap); Xx = new Float64Array(cap); Yx = new Float64Array(cap);
    BM = new Int8Array(cap); BX = new Int8Array(cap); BY = new Int8Array(cap); MK = new Int8Array(cap);
  };

  function align(a, b, limit = Infinity, keep = false) {
    const n = a.p.length, m = b.p.length, W = m + 1;
    ensure((n + 1) * W);
    const ea = Array.from(a.p, (p, i) => extOf(p, a.s[i])), eb = Array.from(b.p, (p, i) => extOf(p, b.s[i]));
    Mx[0] = 0; Xx[0] = Infinity; Yx[0] = Infinity;
    let acc = O;
    for (let i = 1; i <= n; i++) { const k = i * W; Mx[k] = Infinity; Yx[k] = Infinity; Xx[k] = acc += ea[i - 1]; BX[k] = 1; }
    acc = O;
    for (let j = 1; j <= m; j++) { Mx[j] = Infinity; Xx[j] = Infinity; Yx[j] = acc += eb[j - 1]; BY[j] = 2; }
    let prevMin = Infinity;
    for (let i = 1; i <= n; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= m; j++) {
        const k = i * W + j, d = k - W - 1, u = k - W, l = k - 1;
        const sub = SUB[a.p[i - 1] * NP + b.p[j - 1]];
        let best = Mx[d], from = 0;
        if (Xx[d] < best) { best = Xx[d]; from = 1; }
        if (Yx[d] < best) { best = Yx[d]; from = 2; }
        Mx[k] = sub + best; BM[k] = from; MK[k] = 0;
        if (K.rMerge !== Infinity) {
          if (i > 1 && b.p[j - 1] === ER && a.p[i - 1] === RR && isV[a.p[i - 2]]) {
            const s0 = k - 2 * W - 1, c = K.rMerge + Math.min(Mx[s0], Xx[s0], Yx[s0]);
            if (c < Mx[k]) { Mx[k] = c; BM[k] = Mx[s0] <= Xx[s0] && Mx[s0] <= Yx[s0] ? 0 : Xx[s0] <= Yx[s0] ? 1 : 2; MK[k] = 1; }
          }
          if (j > 1 && a.p[i - 1] === ER && b.p[j - 1] === RR && isV[b.p[j - 2]]) {
            const s0 = k - W - 2, c = K.rMerge + Math.min(Mx[s0], Xx[s0], Yx[s0]);
            if (c < Mx[k]) { Mx[k] = c; BM[k] = Mx[s0] <= Xx[s0] && Mx[s0] <= Yx[s0] ? 0 : Xx[s0] <= Yx[s0] ? 1 : 2; MK[k] = 2; }
          }
        }
        let x0 = Mx[u] + O, x1 = Xx[u], x2 = Yx[u] + O;
        let bx = x0, fx = 0;
        if (x1 < bx) { bx = x1; fx = 1; }
        if (x2 < bx) { bx = x2; fx = 2; }
        Xx[k] = ea[i - 1] + bx; BX[k] = fx;
        let y0 = Mx[l] + O, y1 = Yx[l], y2 = Xx[l] + O;
        let by = y0, fy = 0;
        if (y1 < by) { by = y1; fy = 2; }
        if (y2 < by) { by = y2; fy = 1; }
        Yx[k] = eb[j - 1] + by; BY[k] = fy;
        const lo = Math.min(Mx[k], Xx[k], Yx[k]);
        if (lo < rowMin) rowMin = lo;
      }
      if (!keep && rowMin > limit && prevMin > limit) return { cost: Infinity };
      prevMin = rowMin;
    }
    const k = n * W + m;
    const cost = Math.min(Mx[k], Xx[k], Yx[k]);
    if (!keep) return { cost };
    let i = n, j = m, st = Mx[k] <= Xx[k] && Mx[k] <= Yx[k] ? 0 : Xx[k] <= Yx[k] ? 1 : 2;
    const ops = [];
    while (i > 0 || j > 0) {
      const q = i * W + j;
      if (i === 0) { ops.push({ t: '+', j: j - 1 }); j--; continue; }
      if (j === 0) { ops.push({ t: '-', i: i - 1 }); i--; continue; }
      if (st === 0 && MK[q]) {
        if (MK[q] === 1) { ops.push({ t: '≈', i: i - 2, i2: i - 1, j: j - 1 }); i -= 2; j -= 1; }
        else { ops.push({ t: '≈', i: i - 1, j: j - 2, j2: j - 1 }); i -= 1; j -= 2; }
        st = BM[q];
      } else if (st === 0) {
        ops.push({ t: a.p[i - 1] === b.p[j - 1] ? '=' : '~', i: i - 1, j: j - 1 });
        st = BM[q]; i--; j--;
      } else if (st === 1) { ops.push({ t: '-', i: i - 1 }); st = BX[q]; i--; }
      else { ops.push({ t: '+', j: j - 1 }); st = BY[q]; j--; }
    }
    return { cost, ops: ops.reverse() };
  }

  // Moves are paired after a move-free alignment, so a move it doesn't leave
  // as two lone gaps goes unpriced.
  const moveSlack = 2 * (O + K.extCons) - K.moveBase;
  // R and ER pair as one moved sound: CMU folds the R of HIRE into the
  // syllable before it and writes HONOR's as a vowel, so HIRE ON / HIGH HONOR
  // would price as two edits.
  const RHOTIC = PHONES.map((p, i) => (p === 'ER' ? IDX.get('R') : i));
  function moveRefund({ cost, ops }, x, y) {
    const lone = (t) => ops.filter((o, k) => o.t === t && ops[k - 1]?.t !== t && ops[k + 1]?.t !== t);
    const ins = lone('+'), phone = (o) => RHOTIC[o.t === '-' ? x.p[o.i] : y.p[o.j]];
    let best = null;
    for (const d of lone('-')) for (const r of ins) {
      if (phone(d) !== phone(r)) continue;
      const gaps = O + extOf(x.p[d.i], x.s[d.i]) + O + extOf(y.p[r.j], y.s[r.j]);
      if (cost - gaps <= K.moveRest + 1e-9 && (!best || gaps > best.gaps)) best = { d, r, gaps };
    }
    for (let k = 0; k + 1 < ops.length; k++) {
      const o = ops[k], n = ops[k + 1];
      if (o.t !== '~' || n.t !== '~' || x.p[o.i] !== y.p[n.j] || x.p[n.i] !== y.p[o.j]) continue;
      const gaps = SUB[x.p[o.i] * NP + y.p[o.j]] + SUB[x.p[n.i] * NP + y.p[n.j]];
      if (cost - gaps <= K.moveRest + 1e-9 && (!best || gaps > best.gaps)) best = { d: o, r: n, gaps };
    }
    if (!best || best.gaps <= K.moveBase) return 0;
    best.d.move = best.r.move = true;
    return best.gaps - K.moveBase;
  }

  function score(a, b, maxLoose = Infinity, wantPath = true) {
    if (!a || !b) return null;
    let best = null, bestCost = Infinity, bestL = 1;
    for (const x of a.vs) for (const y of b.vs) {
      const L = Math.min(x.p.length, y.p.length);
      if (L < K.minLen) continue;
      const limit = Math.min(bestCost, maxLoose * L + 1e-9);
      const slack = K.moveBase === Infinity ? 0 : moveSlack;
      if (Math.abs(x.p.length - y.p.length) && O + minExt * Math.abs(x.p.length - y.p.length) > limit + slack) continue;
      let { cost } = align(x, y, limit + slack);
      if (slack && cost < Infinity) cost -= moveRefund(align(x, y, Infinity, true), x, y);
      if (cost < bestCost) { bestCost = cost; best = [x, y]; bestL = L; }
    }
    if (!best) return null;
    const loose = bestCost / bestL;
    if (loose > maxLoose) return null;
    const out = { cost: bestCost, loose, len: bestL };
    if (wantPath) {
      const al = align(best[0], best[1], Infinity, true), { ops } = al;
      if (K.moveBase !== Infinity) moveRefund(al, best[0], best[1]);
      out.path = ops;
      out.diff = diffText(ops, best[0], best[1]);
    }
    return out;
  }

  return { K, align, score };
}

// ─── Whole rhymes ────────────────────────────────────

// Each distinct syllable key gets a number, and an entry's readings are one
// string of them, a character per syllable and READING_SEP between readings:
// a list's worth of readings held as arrays of key strings ran to 240 MB.
// Each reading leads with characters for its stressed-syllable count and its
// unstressed opening syllables.
const SYLLABLE_ID = new Map(), SYLLABLES = [];
const syllableId = (k) => {
  let id = SYLLABLE_ID.get(k);
  if (id === undefined) { id = SYLLABLES.length; SYLLABLES.push(k); SYLLABLE_ID.set(k, id); }
  return id;
};
const READING_SEP = '\uffff';
export const rhymeKeys = (spaced) => [...wholeEntryReadings(spaced)]
  .map(([k, { stressed, lead }]) => String.fromCharCode(stressed, lead, ...k.split(' | ').map(syllableId))).join(READING_SEP);

// Syllable keys carry no onsets (phonetics.js syllableKeys), which is what
// leaves onsets free here.
// `stress` is the stressed-syllable count of the more stressed of the two
// readings that rhyme, never of another reading: ETA's spelled-out E-T-A has
// three, which let one-stress CRAZING / ETA through.
export function rhymeMatch(aKeys, bKeys, fromStress = false) {
  if (!aKeys || !bKeys) return null;
  let best = null;
  for (const ra of aKeys.split(READING_SEP)) for (const rb of bKeys.split(READING_SEP)) {
    const a = ra.slice(2), b = rb.slice(2), stress = Math.max(ra.charCodeAt(0), rb.charCodeAt(0));
    if (a.length !== b.length) continue;
    let m = syllablesMatch(a, b);
    // Only the unstressed opening may differ, both entries opening alike in
    // length: skipping openings of different lengths rhymed POETES MAUDITS
    // with RECIPE, LET IT BE and dozens more.
    if (!m && fromStress && ra.charCodeAt(1) === rb.charCodeAt(1)) m = syllablesMatch(a.slice(ra.charCodeAt(1)), b.slice(rb.charCodeAt(1)));
    if (m && (!best || (best.near && !m.near) || (best.near === m.near && stress > best.stress))) best = { ...m, stress };
  }
  return best;
}

function syllablesMatch(a, b) {
  if (!a.length) return null;
  if (a === b) return { syl: a.length, near: false };
  let diff = -1;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (diff >= 0) return null; diff = i; }
  return codaOneOff(SYLLABLES[a.charCodeAt(diff)], SYLLABLES[b.charCodeAt(diff)]) ? { syl: a.length, near: true } : null;
}

function codaOneOff(x, y) {
  const a = x.split(' '), b = y.split(' ');
  if (a[0] !== b[0] || Math.abs(a.length - b.length) !== 1) return false;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 1; i < l.length; i++) if ([...l.slice(0, i), ...l.slice(i + 1)].join(' ') === s.join(' ')) return true;
  return false;
}

function diffText(ops, x, y) {
  const nm = (v, i) => PHONES[v.p[i]];
  const out = [];
  for (const o of ops) {
    if (o.t === '=') out.push(nm(x, o.i));
    else if (o.t === '~') out.push(o.move ? `[${nm(x, o.i)}⇄${nm(y, o.j)}]` : `[${nm(x, o.i)}→${nm(y, o.j)}]`);
    else if (o.t === '≈') out.push(o.i2 !== undefined ? `[${nm(x, o.i)} ${nm(x, o.i2)}→${nm(y, o.j)}]` : `[${nm(x, o.i)}→${nm(y, o.j)} ${nm(y, o.j2)}]`);
    else if (o.t === '-') out.push(`(-${o.move ? '↷' : ''}${nm(x, o.i)})`);
    else out.push(`(+${o.move ? '↷' : ''}${nm(y, o.j)})`);
  }
  return out.join(' ');
}

export function prepReading(read) {
  if (!read) return null;
  // Spoonerisms match on `full`, without reductions, flaps or vowels folded
  // before R: else WADE IN matches DAY ONE, COTTAGE matches DOCKAGE and
  // PEERING matches RIPPING, all of which John rated down.
  return { vs: read.variants.map((v) => ({ ...canon(v.words), full: canon(v.words, false).p, wl: v.words.map((w) => w.length) })), spelled: !!read.spelled };
}

// ─── Reading ─────────────────────────────────────────

const MAX_VARIANTS = 6;

// Reads an entry as Phone search does, `splits` splitting a word CMU lacks
// (phone-reading.js tableSplits, or widerSplits for typed text). Returns null
// when any word is unreadable; else { variants: [{ toks, words }], nWords, split,
// spelled }: the cartesian product of each word's pronunciations (capped, the
// first-listed ones first), whether a token was split, and whether a word was
// spelled out.
export function readEntry(text, splits) {
  const { items } = itemsOf(text, splits, soundsOrSpelled);
  if (!items.length || items.includes(null)) return null;
  let combos = [[]];
  for (const item of items) {
    const next = [];
    for (const c of combos) for (const s of item.sounds) {
      if (next.length < MAX_VARIANTS * 3) next.push([...c, s.toks]);
    }
    combos = next;
  }
  const variants = combos.slice(0, MAX_VARIANTS).map((words) => ({ toks: words.flat(), words }));
  return {
    variants, nWords: items.length,
    split: items.length > tokensOf(text).length,
    spelled: items.some((it) => !soundsOf(it.letters)),
  };
}
