// Twins scorer: a weighted letter alignment plus post-alignment
// features, every weight a knob in DEFAULTS. Tuned by the harness in
// scripts/twins/ (see its README.md), which imports this module.
import { familyKey, isDictWord } from './morphology.js';
import { spacingReader } from './space-out.js';
import { hasCmuDict } from './phonetics.js';
import { spacedReading, tableSplits, typedReading, widerSplits } from './phone-reading.js';
import { sharedRun, mayShareRun } from './twins-run.js';
import { makeSoundScorer, readEntry, prepReading, rhymeKeys, rhymeMatch, canon, PHONES } from './twins-sound.js';
import { contentOf, shareKey } from './twins-swap.js';
import { candidates, letterFilter } from './twins-filter.js';

// WordNet meaning links between two prepped entries, or null; the harness
// and the tool each supply their own reader.
let relationOf = () => null;
export function configureRelation(fn) { relationOf = fn; }
let runBits = null;
export function configureRunModel(fn) { runBits = fn; }
let swapTable = null;
export function configureSwapTable(table) { swapTable = table; }

const codeOf = (str, i, L) => { let c = 0; for (let k = 0; k < L; k++) c = c * 128 + str[i + k]; return c; };

// Each value was set against John's rated pairs and examples with
// scripts/twins/harness.mjs; its README's Findings record what each
// change moved and what was tried and dropped. Rerun eval before changing one.
export const DEFAULTS = {
  subVowel: 0.6,
  subSound1: 0.4, // c/k, k/q, c/q, c/s, s/z, i/y, f/v, g/j, x/z
  subSound2: 0.6, // b/p, d/t, g/k, m/n, w/v, p/h
  subLR: 0.7,
  subOther: 1.0,
  // Affine gaps: a run of k letters costs gapOpen + the sum of its letters' ext.
  gapOpen: 0.3,
  extVowel: 0.35,
  extCons: 0.55,
  extSoft: 0.4, // h l n r s t
  extHard: 0.75, // f j k q v w x z
  swap: 0.6, // two letters trading places up to swapWin apart (TOVE LO / LOVE TO), in place of two subs
  swapWin: 6,
  blockSwap: 0.9, // two blocks of 1-3 letters (not both single) trading places, up to blockGap apart
  blockGap: 3,
  blockCross: 0.2, // added when a swapped block spans a word break in either entry
  blockHist: 4, // most letter-count difference a pair can have and still try block swaps
  doubles: 0.1, // per difference in doubled-letter count
  copyBase: 0.3, // a gap run that repeats the run beside it (YO HO·HO) costs this…
  copyPer: 0.2, // …plus this per letter, in place of its gap cost; Infinity disables
  chunkBase: 0.5, // inserting or deleting a run of chunkMin..chunkMax letters found in the other entry costs this…
  chunkPer: 0.15, // …plus this per letter; Infinity disables
  chunkMin: 2,
  chunkMax: 4,
  moveBase: 0.9, // a deleted run reinserted elsewhere costs this…
  movePer: 0.4, // …plus this per letter, in place of its two gaps
  site: 0, // per edit site beyond the first
  edgeGap: 0, // per letter of a gap touching either end
  respace: 0, // per word break present in only one entry (negative = bonus)
  respaceCap: 2,
  shared: 0.4, // per shared content word
  sharedPer: 0, // per letter of shared content words
  affixPer: 0, // per letter of a shared prefix and suffix (see affixMin)
  sharedDilute: 1, // 0..1: fraction of shared words' letters taken out of len
  sharedFloor: 4, // …but never below this many letters
  siteSq: 0.25, // per site, times (edits in the site - 1)^2
  siteGap: 0.5, // edits a gap letter after the first adds to its site
  minLen: 3,
  affixMin: 3, // shortest shared affix affixDilute counts
  affixDilute: 1, // 0..1: fraction of a shared prefix's and suffix's letters taken out of len
  sound: 0.06, // penalty on the sound route's looseness (phon/); Infinity disables. entries need .sound
  soundConsFloor: 0.3, // the sound route's floor on a consonant change (twins-sound.js consFloor)
  soundMove: 0.4, soundMoveRest: 0.5, // the sound route's moveBase and moveRest (twins-sound.js)
  soundSiteSq: 0.25, // the sound route's siteSq: per run of phone edits, times (edits in it - 1)^2
  rhyme: 0.24, // a whole rhyme of rhymeMinSyl syllables (every syllable's vowel and coda match); Infinity disables. entries need .rhymes
  rhymeSyl: 0.04, // less per syllable past rhymeMinSyl, up to rhymeMaxSyl
  rhymeMinSyl: 2,
  rhymeFromStress: true, // a rhyme may skip unstressed opening syllables, as many on each side (CAREER FAIR / TAHRIR SQUARE)
  rhymeMaxSyl: 5,
  rhymeNear: 0.08, // added when one syllable's coda gains or loses a consonant
  rhymeStress: 2, // stressed syllables the rhyming readings need between two single words: one-stress words (CRAZING / BLAMING) rhyme by the hundred
  rhymeStressPhrase: 1, // …and when either entry is a phrase, which lands on the other's syllables (FAIREST / SWEAR IT)
  wordSwap: 0.12, // two entries' two content words matching crosswise by sound (FRESH MEAT / MEET IN THE FLESH); Infinity disables. needs configureSwapTable
  wordSwapPer: 0.5, // more per unit of the two word distances
  wordSwapWord: 0.3, // most either crosswise word pair may differ by sound
  wordSwapVowels: 0.08, // per changed word pair whose vowels differ: John rated swaps without assonance mostly OK or junk (PATTY-CAKE / TAKE PITY)
  wordSwapPrefix: 0.05, // per extra phone when one word starts the other in sound and spelling (WILL / WILLIAMS)
  spoon: 0.06, // two words trading their opening consonant sounds (PIE TIN / TIE PIN, BLOW YOUR NOSE / KNOW YOUR BLOWS); Infinity disables. entries need .sound and .rhymes
  spoonInner: 0.1, // a word's opening traded with a cluster inside a word (BUTTERFLY / FLUTTERBY)
  spoonPartial: 0.12, // a trade taking a run's front or back part, not all of it (the ST of STR)
  spoonSuffix: 0.1, // added when both entries end in -ING or -ED, the trade sitting in the stems
  toolCutoff: 0.4, // the tool's cutoff: the spoonerism and anagram routes score only pairs the tool's letter filter passes there (or that rhyme), as the tool does
  spoonLoose: 0.2, // a trade whose sound slides across a word break or remakes the same words (OFF KEY / COFFEE, NEW YOU / YOU KNEW)
  anagram: 0.38, // the same letters rearranged, at anagramMin letters, less anagramPer a letter more down to anagramFloor: long ones top the list, mid-length ones sit mid-list; Infinity disables
  anagramMin: 7,
  anagramPer: 0.04,
  anagramFloor: 0.08,
  anagramRare: 0.02, // less per bit of surprise per letter over the mean, up to anagramRareMax: rare letters (MARISA TOMEI's M, O) beat RSTLNE (NOISE ARTISTS)
  anagramRareMax: 0.04,
  anagramShared: 0.06, // more when the two share a word or glue the same words (COSMIC HORROR / HORROR COMICS)
  reversal: 0.04, // a letter reversal (DRACULA / ALUCARD) scores this much below an anagram of its length
  reversalMin: 6,
  rebreak: 0.06, // the same letters with written word breaks moved (CAT CHAIR / CATCH AIR); Infinity disables
  reorder: 0.22, // the same words in another order (TIME TRAVEL / TRAVEL TIME); Infinity disables
  reorderGlued: 0.12, // two words glued in the other order (HOUSE CAT / CATHOUSE), which mostly makes a new word; Infinity disables
  reorderDull: 0.3, // a reorder keeping its meaning: coordination or a verb phrase's compound adjective (HITTING HARD / HARD-HITTING)
  run: 0.36, // a single word's opening or closing letters recurring across a phrase's word break (twins-run.js); Infinity disables. needs configureRunModel
  runCover: 0.1, // less as the run covers more of the shorter entry, from 40% to all of it
  runBits: 3, // least surprise per letter, in bits, the run must carry under the letter model
  related: 1, // when WordNet links a word of one to a word of the other (configureRelation)
  affix: 1, // when the pair differs only by known prefixes or suffixes on a shared stem
  abortSlack: 3, // how far over the cutoff an alignment may run before giving up, for refunds that come after it
  prefilterPhones: false, // the prefilter also keeps entries whose phones alone are close; off spares the tool a reading of every entry
  prefilter: 'auto', // skip entries twins-filter.js rules out; 'auto' is on unless an override makes scoring looser (see STRICTER)
};

// The prefilter's thresholds are fit to DEFAULTS, so an override that lowers
// a cost would silently lose hits to it. Moving these knobs this way only
// raises looseness, which the filter tolerates.
const STRICTER = {
  up: 'subVowel subSound1 subSound2 subLR subOther gapOpen extVowel extCons extSoft extHard swap blockSwap blockCross doubles copyBase copyPer chunkBase chunkPer moveBase movePer site edgeGap respace shared sharedPer affixPer sharedDilute affixDilute siteSq siteGap sound soundConsFloor soundMove soundSiteSq related affix abortSlack'.split(' '),
  down: ['sharedFloor', 'soundMoveRest'],
};
export const prefilterHolds = (overrides) => Object.entries(overrides).every(([k, v]) =>
  k === 'prefilter' || k === 'prefilterPhones' || k.startsWith('rhyme') || k.startsWith('run') || k.startsWith('wordSwap') || k.startsWith('spoon') || k.startsWith('anagram') || k.startsWith('reorder') || k.startsWith('reversal') || k === 'toolCutoff' || v === DEFAULTS[k] || (STRICTER.up.includes(k) && v >= DEFAULTS[k]) || (STRICTER.down.includes(k) && v <= DEFAULTS[k]));

// ─── Corpus ──────────────────────────────────────────
export const normOf = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
export const collapse = (s) => s.replace(/(.)\1+/g, '$1');
const STOP = new Set('a an the and of in on to for at by or is it as with from'.split(' '));
const tokensOf = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean);

// Prep's services over `wordlist` (the merged corpus: { norms, vocab }),
// segmenting with the spacing table's first tier. Its compound fallback
// invents splits of real words (PRESENTER → PRE SENTER), which would read
// as moved word breaks.
export function prepServices(wordlist, spacing = spacingReader({ cache: { get: () => null }, vocab: wordlist })) {
  return {
    segment: (norm) => { const parts = spacing.best(norm); return parts && parts[parts.length - 1].length > 1 ? parts : null; },
    vocab: wordlist.vocab,
    isWord: isDictWord,
    // Read as Phone search and Rhymes read, not through `segment`: their splits
    // are what make an unspaced entry CMU lacks (FLOWERBED) readable at all.
    read: (display, typed = false) => readEntry(display, (typed ? widerSplits : tableSplits)(spacing)),
    sound(display, typed = false) { return hasCmuDict() ? prepReading(this.read(display, typed)) : null; },
    rhymes: (display, typed = false) => (hasCmuDict() ? rhymeKeys((typed ? typedReading : spacedReading)(display, spacing)) : null),
    // One reader for every content word, typed or listed, so the word table
    // and the scorer never see two readings of one word.
    readWord(text) {
      const r = hasCmuDict() ? readEntry(text, tableSplits(spacing)) : null;
      return r ? canon(r.variants[0].words) : null;
    },
    swap(display, table) {
      const c = table && contentOf(display);
      if (!c) return null;
      const words = c.map((t) => table.add(t));
      if (words.includes(null)) return null;
      for (const w of words) w.same ??= sameKey(w.text, wordlist.vocab);
      return { words };
    },
  };
}

// `svc`: segment(norm) → word parts or null, vocab (collectRowVocab) for
// family keys, isWord(norm) for dictionary words.
export function prep(e, svc) {
  const norm = e.norm ?? normOf(e.display);
  const c = collapse(norm);
  const { spaced, ownSpaced, isWord } = spacedOf(norm, e.display, svc);
  const codes = Uint8Array.from(c, (ch) => ch.charCodeAt(0));
  const tokens = tokensOf(spaced);
  const content = tokens.filter((w) => !STOP.has(w)).map((w) => (svc.vocab ? familyKey(w, svc.vocab) : w));
  const fam = svc.vocab ? familyKey(spaced, svc.vocab) : norm;
  const hist = new Int8Array(36);
  for (const ch of c) hist[ch <= '9' ? ch.charCodeAt(0) - 48 + 26 : ch.charCodeAt(0) - 97]++;
  const word = !ownSpaced && isWord;
  const words = tokens.length > 1 ? [...tokens].sort().join(' ') : null;
  return { ...e, norm, c, codes, content, words, fam, word, ownSpaced, variant: variantKey(norm), hist, spaced, breaks: breaksOf(spaced), dbl: norm.length - c.length };
}

export function spacedOf(norm, display, svc) {
  const ownSpaced = /[\s\-\/&]/.test(display.trim());
  const isWord = svc.isWord(norm);
  const parts = svc.segment && !ownSpaced && norm.length >= 5 && !isWord ? svc.segment(norm) : null;
  return { spaced: parts ? parts.join(' ') : display, ownSpaced, isWord };
}

// Word-break positions as indices into the collapsed norm.
function breaksOf(display) {
  const out = [];
  let prev = '', idx = 0, pendingBreak = false;
  for (const ch of display.toLowerCase().normalize('NFD')) {
    if (/[a-z0-9]/.test(ch)) {
      if (ch !== prev) {
        if (pendingBreak && idx > 0) out.push(idx);
        idx++;
      }
      prev = ch;
      pendingBreak = false;
    } else if (/[\s\-\/&]/.test(ch)) pendingBreak = true;
  }
  return out;
}

// ─── Scorer ──────────────────────────────────────────
export function makeScorer(overrides = {}) {
  const K = { ...DEFAULTS, ...overrides };
  if (K.prefilter === 'auto') K.prefilter = prefilterHolds(overrides);
  const VOW = new Uint8Array(128);
  for (const ch of 'aeiouy') VOW[ch.charCodeAt(0)] = 1;
  const SUB = new Float64Array(128 * 128).fill(K.subOther);
  const set = (cost, ...groups) => {
    for (const g of groups) for (const x of g) for (const y of g)
      if (x !== y) SUB[x.charCodeAt(0) * 128 + y.charCodeAt(0)] = cost;
  };
  for (let x = 0; x < 128; x++) for (let y = 0; y < 128; y++) {
    if (x === y) SUB[x * 128 + y] = 0;
    else if (VOW[x] && VOW[y]) SUB[x * 128 + y] = K.subVowel;
  }
  set(K.subSound2, 'bp', 'dt', 'gk', 'mn', 'wv', 'ph');
  set(K.subLR, 'lr');
  set(K.subSound1, 'ck', 'kq', 'cq', 'cs', 'sz', 'iy', 'fv', 'gj', 'xz');
  const EXT = new Float64Array(128);
  const SOFT = new Uint8Array(128), HARD = new Uint8Array(128);
  for (const ch of 'hlnrst') SOFT[ch.charCodeAt(0)] = 1;
  for (const ch of 'fjkqvwxz') HARD[ch.charCodeAt(0)] = 1;
  const extClass = (x) => VOW[x] ? 'extVowel' : SOFT[x] ? 'extSoft' : HARD[x] ? 'extHard' : 'extCons';
  for (let x = 0; x < 128; x++) EXT[x] = K[extClass(x)];
  const O = K.gapOpen;

  let cap = 0, M, X, Y;
  const CHUNK = K.chunkBase !== Infinity;
  const chunkCost = (L) => K.chunkBase + K.chunkPer * L;
  let CH = new Int8Array(0);
  // Chunks of the query, built once per query string: code → start positions.
  let chunkA = null, chunkMapA = null, inB = new Uint8Array(0);
  const chunksOf = (a) => {
    if (a === chunkA) return chunkMapA;
    const map = new Map();
    for (let L = K.chunkMin; L <= K.chunkMax; L++)
      for (let i = 0; i + L <= a.length; i++) {
        const c = codeOf(a, i, L);
        let xs = map.get(c);
        if (!xs) map.set(c, (xs = []));
        xs.push(i * 8 + L);
      }
    chunkA = a; chunkMapA = map;
    return map;
  };
  const ensure = (n) => {
    if (n <= cap) return;
    cap = n;
    M = new Float64Array(n); X = new Float64Array(n); Y = new Float64Array(n);
  };

  function align(a, b, limit, keep = false) {
    const n = a.length, m = b.length, W = m + 1;
    ensure((n + 1) * W);
    let subA = null;
    if (CHUNK) {
      subA = chunksOf(a);
      // inB[i * 8 + L]: a's chunk at i of length L also occurs in b.
      if (inB.length < (n + 1) * 8) inB = new Uint8Array((n + 1) * 16);
      inB.fill(0, 0, (n + 1) * 8);
      for (let L = K.chunkMin; L <= K.chunkMax; L++)
        for (let j = 0; j + L <= m; j++) {
          const xs = subA.get(codeOf(b, j, L));
          if (xs) for (const x of xs) inB[x] = 1;
        }
      if (CH.length < (n + 1) * W) CH = new Int8Array((n + 1) * W * 2);
      CH.fill(0, 0, (n + 1) * W);
    }
    M[0] = 0; X[0] = Infinity; Y[0] = Infinity;
    let acc = O;
    for (let i = 1; i <= n; i++) { const k = i * W; M[k] = Infinity; Y[k] = Infinity; X[k] = acc += EXT[a[i - 1]]; }
    acc = O;
    for (let j = 1; j <= m; j++) { M[j] = Infinity; X[j] = Infinity; Y[j] = acc += EXT[b[j - 1]]; }
    for (let i = 1; i <= n; i++) {
      const ai = a[i - 1], ea = EXT[ai], row = ai * 128;
      let rowMin = Infinity;
      for (let j = 1; j <= m; j++) {
        const k = i * W + j, d = k - W - 1, u = k - W, l = k - 1;
        let mm = SUB[row + b[j - 1]] + Math.min(M[d], X[d], Y[d]);
        if (CHUNK) {
          for (let L = K.chunkMin; L <= K.chunkMax && L <= j; L++) {
            if (!subA.has(codeOf(b, j - L, L))) continue;
            const src = k - L, c = chunkCost(L) + Math.min(M[src], X[src], Y[src]);
            if (c < mm) { mm = c; CH[k] = L; }
          }
          for (let L = K.chunkMin; L <= K.chunkMax && L <= i; L++) {
            if (!inB[(i - L) * 8 + L]) continue;
            const src = k - L * W, c = chunkCost(L) + Math.min(M[src], X[src], Y[src]);
            if (c < mm) { mm = c; CH[k] = -L; }
          }
        }
        const xx = ea + Math.min(M[u] + O, X[u], Y[u] + O);
        const yy = EXT[b[j - 1]] + Math.min(M[l] + O, Y[l], X[l] + O);
        M[k] = mm; X[k] = xx; Y[k] = yy;
        const lo = mm < xx ? (mm < yy ? mm : yy) : (xx < yy ? xx : yy);
        if (lo < rowMin) rowMin = lo;
      }
      if (!keep && rowMin > limit) return Infinity;
    }
    const k = n * W + m;
    return Math.min(M[k], X[k], Y[k]);
  }

  // Ops after a keep=true align: '=' match, '~' sub, '-' a only, '+' b only, 'C-'/'C+' a chunk.
  function traceback(a, b) {
    const n = a.length, m = b.length, W = m + 1;
    let i = n, j = m, k = i * W + j;
    let st = M[k] <= X[k] && M[k] <= Y[k] ? 'M' : X[k] <= Y[k] ? 'X' : 'Y';
    const ops = [];
    const eq = (p, q) => Math.abs(p - q) < 1e-9;
    while (i > 0 || j > 0) {
      k = i * W + j;
      if (i === 0) { ops.push(['+', j - 1]); j--; continue; }
      if (j === 0) { ops.push(['-', i - 1]); i--; continue; }
      if (st === 'M' && CHUNK && CH[k]) {
        const L = Math.abs(CH[k]), ins = CH[k] > 0, src = ins ? k - L : k - L * W, base = M[k] - chunkCost(L);
        for (let t = 1; t <= L; t++) ops.push(ins ? ['C+', j - t] : ['C-', i - t]);
        st = eq(base, M[src]) ? 'M' : eq(base, X[src]) ? 'X' : 'Y';
        if (ins) j -= L; else i -= L;
      } else if (st === 'M') {
        const d = k - W - 1, base = M[k] - SUB[a[i - 1] * 128 + b[j - 1]];
        ops.push([a[i - 1] === b[j - 1] ? '=' : '~', i - 1, j - 1]);
        st = eq(base, M[d]) ? 'M' : eq(base, X[d]) ? 'X' : 'Y';
        i--; j--;
      } else if (st === 'X') {
        const u = k - W, base = X[k] - EXT[a[i - 1]];
        ops.push(['-', i - 1]);
        st = eq(base, X[u]) ? 'X' : eq(base, M[u] + O) ? 'M' : 'Y';
        i--;
      } else {
        const l = k - 1, base = Y[k] - EXT[b[j - 1]];
        ops.push(['+', j - 1]);
        st = eq(base, Y[l]) ? 'Y' : eq(base, M[l] + O) ? 'M' : 'X';
        j--;
      }
    }
    return ops.reverse();
  }

  const lenOf = (p, q) => {
    const x = p.norm.length, y = q.norm.length;
    return Math.min(x, y);
  };
  const gapCost = (s) => O + [...s].reduce((t, ch) => t + EXT[ch.charCodeAt(0)], 0);

  // Upper bound on how far features can lower a cost; the early abort
  // must not cut off a pair that features would bring under the cap.
  const slack = Math.max(0, -K.respace * K.respaceCap) + K.abortSlack;

  const sharedOf = (q, e) => [...new Set(q.content)].filter((w) => e.content.includes(w));
  function dilutedLen(q, e, L, sharedWords = sharedOf(q, e)) {
    if (K.affixDilute && !realRespace(q, e)) {
      const n = sharedAffixLen(q.norm, e.norm, K.affixMin);
      if (n > 0) L = Math.max(L * 0.25, L - K.affixDilute * n);
    }
    if (K.sharedDilute && sharedWords.length) {
      const chars = sharedWords.reduce((t, w) => t + collapse(w).length, 0);
      L = Math.max(L * 0.25, Math.min(L, K.sharedFloor), L - K.sharedDilute * chars);
    }
    return L;
  }

  // Sound looseness must use the letters' diluted length, or shared words
  // would count as resemblance on the sound route only.
  const SOUND = K.sound !== Infinity ? makeSoundScorer({ consFloor: K.soundConsFloor, moveBase: K.soundMove, moveRest: K.soundMoveRest }) : null;
  function soundRoute(q, e, h, maxLoose) {
    if (!SOUND || !q.sound || !e.sound) return h;
    const Lraw = lenOf(q, e), frac = dilutedLen(q, e, Lraw) / Lraw;
    let rel;
    const relTerm = () => {
      if (rel === undefined) rel = K.related ? relationOf(q, e) : null;
      return rel ? K.related / (Lraw * frac) : 0;
    };
    let best = h;
    const tryReading = (qs, extra, tag) => {
      const bar = Math.min(maxLoose, best ? best.loose : Infinity) - K.sound;
      if (!(bar > 0)) return;
      const r = SOUND.score(qs, e.sound, bar * frac, false);
      if (!r) return;
      const loose0 = (r.cost + extra) / (r.len * frac) + K.sound + relTerm();
      if ((best && best.loose <= loose0) || loose0 > maxLoose) return;
      const full = SOUND.score(qs, e.sound, Infinity, true);
      let sq = 0, run = 0, gap = '';
      for (const o of [...full.path, { t: '=' }]) {
        if (o.t === '=') { if (run) sq += (run - 1) ** 2; run = 0; gap = ''; continue; }
        run += (o.t === '-' || o.t === '+') && gap === o.t ? K.siteGap : 1;
        gap = o.t === '-' || o.t === '+' ? o.t : '';
      }
      const loose = loose0 + K.soundSiteSq * sq / (r.len * frac);
      if ((best && best.loose <= loose) || loose > maxLoose) return;
      best = { e, cost: loose * Lraw, loose, sound: true, letters: h?.loose ?? null, rel, diff: '♪ ' + tag + full.diff };
    };
    tryReading(q.sound, 0, '');
    return best;
  }

  // Rhyme pairs mostly fail the letter prefilter, so a caller that scores
  // only prefiltered rows loses them silently; query and the tool's hitFor
  // pass rhyme candidates around it.
  function rhymeRoute(q, e, h, maxLoose) {
    if (K.rhyme === Infinity || !q.rhymes?.length || !e.rhymes?.length || sharedOf(q, e).length) return h;
    const m = rhymeMatch(q.rhymes, e.rhymes, K.rhymeFromStress);
    const phrase = /\s/.test(q.spaced.trim()) || /\s/.test(e.spaced.trim());
    if (!m || m.syl < K.rhymeMinSyl || m.stress < (phrase ? K.rhymeStressPhrase : K.rhymeStress)) return h;
    const loose = K.rhyme - K.rhymeSyl * (Math.min(m.syl, K.rhymeMaxSyl) - K.rhymeMinSyl) + (m.near ? K.rhymeNear : 0);
    if (loose > maxLoose || (h && h.loose <= loose) || (K.related && relationOf(q, e))) return h;
    return { e, cost: loose * lenOf(q, e), loose, rhyme: m, letters: h?.loose ?? null, diff: `♫ ${m.near ? 'near ' : ''}${m.syl}-syllable rhyme` };
  }

  function wordDist(a, b) {
    if (a.str === b.str) return 0;
    const [s, l] = a.str.length <= b.str.length ? [a, b] : [b, a];
    if (s.str.length >= 3 && l.str.startsWith(s.str) && l.text.startsWith(s.text)) return K.wordSwapPrefix * (l.str.length - s.str.length);
    const r = SOUND.score({ vs: [a] }, { vs: [b] }, K.wordSwapWord + 1e-9, false);
    return r ? r.loose : Infinity;
  }
  const sameWord = (a, b) => a.same === b.same || inflects(...(a.same.length <= b.same.length ? [a.same, b.same] : [b.same, a.same])) || affixed(a.same, b.same);

  function swapRoute(q, e, h, maxLoose) {
    if (K.wordSwap === Infinity || !SOUND || !q.swap || !e.swap) return h;
    const [x, y] = q.swap.words, [y2, x2] = e.swap.words;
    if (!shareKey(y, y2) || !shareKey(x, x2)) return h;
    const d1 = wordDist(y, y2);
    if (d1 > K.wordSwapWord) return h;
    const d2 = wordDist(x, x2);
    if (d2 > K.wordSwapWord || wordDist(x, y2) + wordDist(y, x2) <= d1 + d2) return h;
    const k1 = sameWord(y, y2), k2 = sameWord(x, x2);
    if (k1 && k2) return h;
    const offKey = (!k1 && y.vowels !== y2.vowels) + (!k2 && x.vowels !== x2.vowels);
    const loose = K.wordSwap + K.wordSwapPer * (d1 + d2) + K.wordSwapVowels * offKey;
    if (loose > maxLoose || (h && h.loose <= loose) || (K.related && relationOf(q, e))) return h;
    return { e, cost: loose * lenOf(q, e), loose, swap: true, letters: h?.loose ?? null, diff: `⇄ ${x.text}~${x2.text}, ${y.text}~${y2.text}` };
  }

  // Reads no row's sounds: the tool runs it on every row.
  function swapFinder(q) {
    if (K.wordSwap === Infinity || !SOUND || !swapTable || !q.swap) return null;
    const [x, y] = q.swap.words;
    const X = swapTable.alike(x, wordDist, K.wordSwapWord), Y = swapTable.alike(y, wordDist, K.wordSwapWord);
    // An edit's new word is missing from the cached table until a query
    // meets it; reading it here files it for later queries too.
    const near = (set, w, t) => {
      if (set.has(t)) return true;
      if (swapTable.has(t)) return false;
      const v = swapTable.add(t);
      return !!v && shareKey(w, v) && wordDist(w, v) <= K.wordSwapWord;
    };
    return (display) => {
      const c = contentOf(display);
      return !!c && near(Y, y, c[0]) && near(X, x, c[1]);
    };
  }

  const SPOONS = new WeakMap();
  const isVowelPhone = (p) => /^[AEIOU]/.test(PHONES[p]);
  const spoonKey = (p) => String.fromCharCode(...p);
  // A shared -ING or -ED leaves the play to the stems: John rated none of
  // those good (LEAPING / PEALING), while pairs sharing -ER, -S or -Y rated
  // about as well as the rest.
  const BORING_SUFFIX = /...(ings?|ed)$/;
  // An R leaving or reaching a vowel recolors it, as does a nasal beside AE:
  // KEERY / RICKEY, ARDOR / RODDER and NAPPER / PANNER were rated junk.
  const [R_, AE_] = ['R', 'AE'].map((x) => PHONES.indexOf(x)), NASAL = new Set(['M', 'N', 'NG'].map((x) => PHONES.indexOf(x)));
  const colors = (piece, prev) => piece.length > 0 && prev != null && ((piece[0] === R_ && isVowelPhone(prev)) || (NASAL.has(piece[0]) && prev === AE_));
  // Keyed by phones alone, so word breaks may move (TREE POSE / PETE ROSE).
  function spoonsOf(q) {
    let out = SPOONS.get(q);
    if (out) return out;
    out = new Map();
    const keep = (key, tier) => { if (tier !== Infinity && !(out.get(key) <= tier)) out.set(key, tier); };
    for (const v of q.sound.vs) {
      const p = [...v.full], word = [], starts = [];
      for (let k = 0, at = 0; k < v.wl.length; at += v.wl[k++]) { starts.push(at); for (let x = 0; x < v.wl[k]; x++) word.push(k); }
      const runs = [];
      for (let k = 0; k < v.wl.length; k++) {
        const end = starts[k] + v.wl[k];
        for (let x = starts[k]; x < end;) {
          let y = x;
          while (y < end && !isVowelPhone(p[y])) y++;
          if (y < end && (y > x || x === starts[k])) runs.push({ s: x, e: y, initial: x === starts[k] });
          x = y + 1;
        }
      }
      const before = (k) => (k > 0 && word[k - 1] === word[k] ? p[k - 1] : null);
      const pieces = (r) => {
        const out = [[r.s, r.e, true]];
        for (let k = 1; k < r.e - r.s; k++) out.push([r.s, r.s + k, false], [r.e - k, r.e, false]);
        return out;
      };
      const bag = (wl, q) => { const w = []; for (let k = 0, at = 0; k < wl.length; at += wl[k++]) w.push(q.slice(at, at + wl[k]).join()); return w.sort().join('|'); };
      const orig = bag(v.wl, p);
      for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
        const ri = runs[i], rj = runs[j];
        if (!ri.initial && !rj.initial) continue;
        for (const [as, ae, af] of pieces(ri)) for (const [bs, be, bf] of pieces(rj)) {
          const A = p.slice(as, ae), B = p.slice(bs, be);
          if (A.join() === B.join()) continue;
          const landA = bs > ae ? before(bs) : B.length ? B[B.length - 1] : before(as);
          if (colors(A, before(as)) || colors(B, before(bs)) || colors(B, before(as)) || colors(A, landA)) continue;
          const t = [...p.slice(0, as), ...B, ...p.slice(ae, bs), ...A, ...p.slice(be)];
          const wl = [...v.wl];
          wl[word[as]] += B.length - A.length;
          wl[word[bs]] += A.length - B.length;
          let tier;
          const inner = !ri.initial || !rj.initial || word[as] === word[bs];
          if (bag(wl, t) === orig) tier = K.spoonLoose;
          else if (!af || !bf) tier = K.spoonPartial;
          else if (inner) tier = K.spoonInner;
          else if (!A.length || !B.length) tier = K.spoonLoose;
          else tier = K.spoon;
          keep(spoonKey(t), tier);
        }
      }
    }
    SPOONS.set(q, out);
    return out;
  }
  // Gated on a rhyme or the letter filter at the tool's cutoff,
  // both of which the tool passes on to scoring: the tool surfaces every pair
  // this scores. Spoonerisms skip the shared-word and WordNet checks that keep
  // other routes' pairs out: traded onsets make new words, and the old ones
  // are often related (GETTING LOW / LETTING GO, BRIGHT LIGHT / LITE-BRITE).
  const LETTERS = new WeakMap();
  const toolSees = (q, e) => {
    if (!LETTERS.has(q)) LETTERS.set(q, letterFilter(q, K.toolCutoff));
    return !!LETTERS.get(q)?.(e.norm);
  };
  const spoonGate = (q, e) => (q.rhymes?.length && e.rhymes?.length && rhymeMatch(q.rhymes, e.rhymes, K.rhymeFromStress)) || toolSees(q, e);

  // ─── Reorders ────────────────────────────────────────
  // Reorders that keep their meaning (FORK AND KNIFE, HITTING HARD / HARD-HITTING).
  const COORD = new Set(['and', 'or', 'nor', 'n', 'to', 'vs', 'versus']);
  const dullReorder = (q, e) => {
    const t = tokensOf(q.display ?? q.norm);
    if (t.some((w) => COORD.has(w))) return true;
    const joined = [q, e].some((x) => /-/.test(x.display ?? '') || !x.words);
    return joined && t.some((w) => w.length >= 5 && /(ing|ed)$/.test(w));
  };
  // The letter route scores these by luck, from 0.15 to 0.42.
  const gluedOf = (q, e) => {
    const [s, g] = q.words && !e.words ? [q, e] : e.words && !q.words ? [e, q] : [];
    if (!s) return null;
    const t = tokensOf(s.display ?? s.norm).map(normOf);
    return t.length === 2 && g.norm === t[1] + t[0] && g.norm !== t[0] + t[1] ? (dullReorder(s, g) ? 'dull' : 'glued') : null;
  };
  function gluedRoute(q, e, h, maxLoose) {
    if (K.reorderGlued === Infinity || gluedOf(q, e) !== 'glued') return h;
    const loose = K.reorderGlued;
    if (loose > maxLoose || (h && h.loose <= loose) || !toolSees(q, e)) return h;
    return { e, cost: loose * lenOf(q, e), loose, reorder: true, letters: h?.loose ?? null, diff: '⇄ words glued reordered' };
  }

  // ─── Anagrams and reversals ───────────────────────────
  // Bits of surprise per letter over the wordlists' letters; the mean is 4.24.
  const LETTER_BITS = { a: 3.6, b: 5.6, c: 4.7, d: 4.8, e: 3.2, f: 5.8, g: 5.1, h: 5.0, i: 3.7, j: 8.4, k: 6.2, l: 4.3, m: 5.2, n: 3.9, o: 3.8, p: 5.2, q: 9.4, r: 3.9, s: 3.7, t: 3.8, u: 5.0, v: 6.7, w: 6.2, x: 8.6, y: 5.9, z: 8.4 };
  const sortedOf = (e) => (e.sorted ??= [...e.norm].sort().join(''));
  const reversedOf = (e) => (e.reversed ??= [...e.norm].reverse().join(''));
  // Every content word of one inside the other's letters: the same words
  // glued in another order (FIGHTING WORDS / SWORDFIGHTING).
  const glued = (a, b) => {
    const ws = (a.words?.split(' ') ?? []).map(normOf).filter((w) => w.length >= 3);
    return ws.length > 1 && ws.every((w) => b.norm.includes(w)) && ws.reduce((t, w) => t + w.length, 0) >= 0.7 * a.norm.length;
  };
  function anagramRoute(q, e, h, maxLoose) {
    if (K.anagram === Infinity || q.norm.length !== e.norm.length || (h && h.loose <= K.anagramFloor)) return h;
    const L = q.norm.length, reversal = q.norm === reversedOf(e);
    if (L < (reversal ? K.reversalMin : K.anagramMin) || (!reversal && sortedOf(q) !== sortedOf(e))) return h;
    const bits = [...q.norm].reduce((t, c) => t + (LETTER_BITS[c] ?? 4.24), 0) / L;
    let loose = K.anagram - K.anagramPer * (L - K.anagramMin) - (reversal ? K.reversal : 0);
    loose = Math.max(K.anagramFloor, loose - Math.max(-K.anagramRareMax, Math.min(K.anagramRareMax, K.anagramRare * (bits - 4.24))));
    if (sharedOf(q, e).length || glued(q, e) || glued(e, q)) loose += K.anagramShared;
    if (loose > maxLoose || (h && h.loose <= loose) || !toolSees(q, e) || (K.related && relationOf(q, e))) return h;
    return { e, cost: loose * lenOf(q, e), loose, anagram: true, letters: h?.loose ?? null, diff: reversal ? '⇆ reversal' : '⇆ anagram' };
  }
  function spoonRoute(q, e, h, maxLoose) {
    if (K.spoon === Infinity || K.spoon > maxLoose || (h && h.loose <= K.spoon) || !q.sound || !e.sound) return h;
    // Trades are symmetric, so test from whichever side is cached: score
    // caches the query's, sparing a trade list and a letter filter per row.
    const [x, y] = SPOONS.has(e) && !SPOONS.has(q) ? [e, q] : [q, e];
    const spoons = spoonsOf(x);
    let loose = Infinity;
    for (const v of y.sound.vs) loose = Math.min(loose, spoons.get(v.key ??= spoonKey(v.full)) ?? Infinity);
    if (loose === Infinity || !spoonGate(x, y)) return h;
    if (loose > K.spoon && (q.sound.spelled || e.sound.spelled)) return h;
    const suffix = q.norm.match(BORING_SUFFIX)?.[1];
    if (suffix && suffix === e.norm.match(BORING_SUFFIX)?.[1]) loose += K.spoonSuffix;
    if (loose > maxLoose || (h && h.loose <= loose)) return h;
    const kind = loose === K.spoon ? '' : loose === K.spoonLoose ? 'loose ' : loose === K.spoonPartial ? 'partial ' : 'inner ';
    return { e, cost: loose * lenOf(q, e), loose, spoon: true, letters: h?.loose ?? null, diff: `⇄ ${kind}spoonerism` };
  }

  const runServices = { normOf, isWord: isDictWord, wordOf: (x) => !/\s/.test(x.spaced.trim()) };
  function runRoute(q, e, h, maxLoose) {
    if (K.run === Infinity || !runBits || !mayShareRun(q.norm, e.norm) || sharedOf(q, e).length) return h;
    const r = sharedRun(q, e, runServices);
    if (!r || runBits(r.run, r.atStart) < K.runBits) return h;
    const loose = K.run - K.runCover * (r.cover - 0.4) / 0.6;
    if (loose > maxLoose || (h && h.loose <= loose) || (K.related && relationOf(q, e))) return h;
    return { e, cost: loose * lenOf(q, e), loose, run: r, letters: h?.loose ?? null, diff: `⋯ shares ${r.atStart ? 'opening' : 'ending'} ${r.run.toUpperCase()}` };
  }

  // Swaps keep letter counts; the count gate keeps this off most pairs, which
  // would otherwise each run dozens of alignments.
  const spans = (breaks, i, n) => breaks.some((p) => p > i && p < i + n);
  const wordInside = (e, s) => {
    for (let k = e.c.indexOf(s); k >= 0; k = e.c.indexOf(s, k + 1)) if (!spans(e.breaks, k, s.length)) return true;
    return false;
  };
  function blockSwapRoute(q, e, h, maxLoose) {
    const a = q.c, b = e.c;
    if (Math.abs(a.length - b.length) > 2) return h;
    let hd = 0;
    for (let k = 0; k < 36; k++) hd += Math.abs(q.hist[k] - e.hist[k]);
    if (hd > K.blockHist) return h;
    const Ld = dilutedLen(q, e, lenOf(q, e));
    let best = h, tried = new Set();
    for (let i = 0; i < a.length; i++) for (let lu = 1; lu <= 3 && i + lu <= a.length; lu++) {
      const u = a.slice(i, i + lu);
      if (!b.includes(u)) continue;
      for (let g = 0; g <= K.blockGap; g++) for (let lv = 1; lv <= 3; lv++) {
        const j = i + lu + g;
        if (j + lv > a.length) break;
        const v = a.slice(j, j + lv);
        if (u === v || (lu === 1 && lv === 1) || !b.includes(v)) continue;
        const cross = K.blockCross && (spans(q.breaks, i, lu) || spans(q.breaks, j, lv) || !wordInside(e, u) || !wordInside(e, v)) ? K.blockCross : 0;
        if (cross === Infinity) continue;
        const c = a.slice(0, i) + v + a.slice(i + lu, j) + u + a.slice(j + lv);
        if (tried.has(c)) continue;
        tried.add(c);
        const q2 = { ...q, c, codes: Uint8Array.from(c, (ch) => ch.charCodeAt(0)) };
        const bar = (best ? Math.min(best.loose, maxLoose) : maxLoose) * Ld - K.blockSwap - cross;
        if (bar <= 0 || align(q2.codes, e.codes, bar + slack) === Infinity) continue;
        const h2 = detail(q2, e);
        const loose = (h2.cost + K.blockSwap + cross) / Ld;
        if (loose <= maxLoose && (!best || loose < best.loose))
          best = { ...h2, cost: h2.cost + K.blockSwap + cross, loose, blockSwap: [u, v], diff: `⇆${u}|${v} ${h2.diff}` };
      }
    }
    return best;
  }

  // The alignment's tie-breaks and the sound route's readings depend on
  // which side is which, and searching from either end must find the same
  // score: so the pair is scored in a fixed order, and a hit also the other
  // way, keeping the better. Only hits pay for the second pass.
  function score(q, e, maxLoose) {
    if (K.spoon !== Infinity && q.sound && !SPOONS.has(q)) spoonsOf(q);
    const [a, b] = e.norm < q.norm ? [e, q] : [q, e];
    let h = scoreOrdered(a, b, maxLoose);
    if (h) {
      const r = scoreOrdered(b, a, maxLoose);
      if (r && r.loose < h.loose) h = r;
    }
    return h && h.e !== e ? { ...h, e } : h;
  }

  // Both breaks must be written: the segmenter's guesses moved them in junk
  // pairs (HOYEON read as HOY EON). Breaks only added or dropped are mostly
  // spellings of one phrase (BAND CAMP / BANDCAMP), so they don't count.
  function rebreakRoute(q, e, maxLoose) {
    if (K.rebreak > maxLoose || !q.ownSpaced || !e.ownSpaced) return null;
    const moved = (a, b) => a.some((i) => !b.includes(i));
    if (!moved(q.breaks, e.breaks) || !moved(e.breaks, q.breaks)) return null;
    return { e, cost: K.rebreak * lenOf(q, e), loose: K.rebreak, rebreak: true, diff: '␣ word breaks moved' };
  }

  function scoreOrdered(q, e, maxLoose) {
    if (q.norm === e.norm) return rebreakRoute(q, e, maxLoose);
    if (Math.min(q.norm.length, e.norm.length) < K.minLen) return null;
    // Before `boring`, whose content-word test drops every reorder.
    // A glued reorder keeping its meaning takes the dull score whatever the
    // letters say (MAKING MONEY / MONEYMAKING scored 0.19 by letters).
    const glued = K.reorderGlued !== Infinity && gluedOf(q, e);
    if ((q.words && q.words === e.words) || glued === 'dull') {
      const loose = glued === 'dull' || dullReorder(q, e) ? K.reorderDull : K.reorder;
      return loose <= maxLoose ? { e, cost: loose * lenOf(q, e), loose, reorder: true, diff: '⇄ same words reordered' } : null;
    }
    const dull = boring(q, e);
    if (dull) return dull === 'words' ? spoonRoute(q, e, null, maxLoose) : null;
    const L = lenOf(q, e);
    const limit = maxLoose * L + slack;
    const dl = Math.abs(q.codes.length - e.codes.length);
    if (dl && O + K.extVowel * dl > limit + K.subOther * 4) return null;
    const base = align(q.codes, e.codes, limit);
    let h = base === Infinity || (base - 4) / L > maxLoose + 1 ? null : detail(q, e, base, L);
    if (h && h.loose > maxLoose) h = null;
    if (K.blockSwap !== Infinity && base !== Infinity && (!h || h.loose > 0.1)) {
      h = blockSwapRoute(q, e, h, maxLoose);
      if (!h || h.loose > 0.1) h = blockSwapRoute(e, q, h, maxLoose);
    }
    h = soundRoute(q, e, h, maxLoose);
    h = rhymeRoute(q, e, h, maxLoose);
    h = runRoute(q, e, h, maxLoose);
    h = swapRoute(q, e, h, maxLoose);
    h = spoonRoute(q, e, h, maxLoose);
    h = anagramRoute(q, e, h, maxLoose);
    h = gluedRoute(q, e, h, maxLoose);
    return h;
  }

  function detail(q, e, base, L) {
    if (base === undefined) { L = lenOf(q, e); base = align(q.codes, e.codes, Infinity, true); }
    else align(q.codes, e.codes, Infinity, true);
    const ops = traceback(q.codes, e.codes);
    const a = q.c, b = e.c;
    const runs = [];
    for (const op of ops) {
      const t = op[0];
      const ch = t === '+' || t === 'C+' ? b[op[1]] : a[op[1]];
      const last = runs[runs.length - 1];
      if (last && last.t === t && (t === '-' || t === '+' || t === 'C+' || t === 'C-')) { last.s += ch; last.end = op; }
      else runs.push({ t, s: ch, other: t === '~' ? b[op[2]] : '', start: op, end: op });
    }
    let moveRefund = 0;
    const ins = runs.filter((r) => r.t === '+');
    for (const d of runs.filter((r) => r.t === '-')) {
      const k = ins.findIndex((r) => r.s === d.s);
      if (k < 0) continue;
      const r = ins.splice(k, 1)[0];
      const refund = 2 * gapCost(d.s) - (K.moveBase + K.movePer * d.s.length);
      if (refund > 0) { moveRefund += refund; d.move = r.move = true; }
    }
    let copyRefund = 0;
    if (K.copyBase !== Infinity) {
      for (const r of runs) {
        if ((r.t !== '-' && r.t !== '+') || r.move) continue;
        const str = r.t === '+' ? b : a, p = r.start[1], L = r.s.length;
        let tandem = false;
        for (let t = 0; t <= L && !tandem; t++)
          tandem = p - t >= 0 && str.slice(p - t, p - t + L) === str.slice(p - t + L, p - t + 2 * L) && p - t + 2 * L <= str.length;
        if (!tandem) continue;
        const refund = gapCost(r.s) - (K.copyBase + K.copyPer * L);
        if (refund > 0) { copyRefund += refund; r.copy = true; }
      }
    }
    let swapRefund = 0;
    if (K.swap !== Infinity) {
      const subs = runs.filter((r) => r.t === '~');
      for (let x = 0; x < subs.length; x++) {
        const r1 = subs[x];
        if (r1.swap) continue;
        for (let y = x + 1; y < subs.length; y++) {
          const r2 = subs[y];
          if (r2.swap || r2.start[1] - r1.start[1] > K.swapWin || r1.s !== r2.other || r1.other !== r2.s) continue;
          const refund = SUB[r1.s.charCodeAt(0) * 128 + r1.other.charCodeAt(0)] + SUB[r2.s.charCodeAt(0) * 128 + r2.other.charCodeAt(0)] - K.swap;
          if (refund > 0) { swapRefund += refund; r1.swap = r2.swap = true; }
          break;
        }
      }
    }
    let sites = 0, inSite = false, siteLen = 0, siteSq = 0;
    for (const r of runs) {
      const edit = r.t !== '=';
      if (edit && !inSite) { sites++; siteLen = 0; }
      if (edit) siteLen += r.t === '~' ? 1 : 1 + K.siteGap * (r.s.length - 1);
      else if (inSite) siteSq += (siteLen - 1) ** 2;
      inSite = edit;
    }
    if (inSite) siteSq += (siteLen - 1) ** 2;
    let edge = 0;
    const first = runs[0], last = runs[runs.length - 1];
    if (first && (first.t === '-' || first.t === '+')) edge += first.s.length;
    if (last && last !== first && (last.t === '-' || last.t === '+')) edge += last.s.length;
    const map = new Int32Array(a.length + 1).fill(-1);
    for (const op of ops) if (op.length === 3) map[op[1]] = op[2];
    map[a.length] = b.length;
    const eb = new Set(e.breaks), qbMapped = new Set();
    let respace = 0;
    for (const p of q.breaks) {
      let j = -1;
      for (let i = p; i <= a.length && j < 0; i++) j = map[i];
      qbMapped.add(j);
      if (!eb.has(j)) respace++;
    }
    for (const p of e.breaks) if (!qbMapped.has(p)) respace++;
    const sharedWords = sharedOf(q, e);
    const shared = sharedWords.length;
    L = dilutedLen(q, e, L, sharedWords);

    const rel = K.related ? relationOf(q, e) : null;
    const cost = base - moveRefund - copyRefund - swapRefund
      + K.doubles * Math.abs(q.dbl - e.dbl)
      + K.site * Math.max(0, sites - 1)
      + K.edgeGap * edge
      + K.respace * Math.min(respace, K.respaceCap)
      + K.shared * shared
      + K.siteSq * siteSq
      + K.sharedPer * sharedWords.reduce((t, w) => t + collapse(w).length, 0)
      + (K.affixPer && !realRespace(q, e) ? K.affixPer * sharedAffixLen(q.norm, e.norm, K.affixMin) : 0)
      + (K.affix && !realRespace(q, e) && affixed(q.variant, e.variant) ? K.affix : 0)
      + (rel ? K.related : 0);
    const capped = Math.max(0, cost);
    return { e, cost: capped, loose: capped / L, rel, diff: diffText(runs) };
  }

  function query(q, { maxLoose = 0.45, corpus }) {
    const hits = [];
    const idx = K.prefilter ? candidates(corpus, q, maxLoose, { phones: K.prefilterPhones }) : null;
    let pool = idx ? idx.map((i) => corpus[i]) : corpus;
    if (idx) {
      const rhymes = K.rhyme !== Infinity && q.rhymes?.length, runs = K.run !== Infinity && runBits, swaps = swapFinder(q);
      const spoons = K.spoon !== Infinity && q.sound && spoonsOf(q), anagrams = K.anagram !== Infinity && q.norm.length >= Math.min(K.anagramMin, K.reversalMin);
      const kept = new Set(pool);
      pool = pool.concat(corpus.filter((e) => !kept.has(e)
        && ((rhymes && e.rhymes?.length && rhymeMatch(q.rhymes, e.rhymes, K.rhymeFromStress)) || (runs && mayShareRun(q.norm, e.norm)) || (swaps && swaps(e.display))
          || (spoons && e.sound?.vs.some((v) => spoons.has(v.key ??= spoonKey(v.full))) && spoonGate(q, e))
          || (anagrams && e.norm.length === q.norm.length && (sortedOf(e) === sortedOf(q) || e.norm === reversedOf(q))))));
    }
    for (const e of pool) {
      const h = score(q, e, maxLoose);
      if (h && h.loose <= maxLoose) hits.push(h);
    }
    return hits.sort((x, y) => x.loose - y.loose || (x.e.norm < y.e.norm ? -1 : 1));
  }

  return { K, score, detail, query, swapFinder };
}

function diffText(runs) {
  return runs.map((r) => {
    const mv = r.move ? '↷' : r.copy ? '⧉' : '';
    if (r.t === '=') return r.s;
    if (r.t === '~') return `[${r.s}${r.swap ? '⇄' : '→'}${r.other}]`;
    if (r.t === 'C+') return `(+⧉${r.s})`;
    if (r.t === 'C-') return `(-⧉${r.s})`;
    return r.t === '-' ? `(-${mv}${r.s})` : `(+${mv}${r.s})`;
  }).join('');
}

// Without the respellings, FIBER-OPTIC / OPTICAL FIBRE and DRUMMER / DRUM
// pass as swaps of different words.
const sameKey = (text, vocab) => variantKey(collapse(vocab ? familyKey(text, vocab) : text)).replace(/([^aeiou])re$/, '$1er');

const SUFFIXES = ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'ly', 'y'];
function inflects(short, long) {
  if (long === short + 'n' && short.endsWith('a')) return true;
  for (const suf of SUFFIXES) {
    if (!long.endsWith(suf)) continue;
    const stem = long.slice(0, -suf.length);
    if (stem === short || stem + 'e' === short || stem.slice(0, -1) === short && /(.)\1$/.test(stem)
        || (suf !== 'y' && stem.endsWith('i') && stem.slice(0, -1) + 'y' === short)) return true;
  }
  return false;
}

const PREFIXES = new Set(['', 'un', 're', 'non', 'de', 'dis', 'in', 'im', 'mis', 'over', 'under', 'pre', 'anti', 'sub', 'super']);
const AFFIX_SUFFIXES = new Set(['', 's', 'es', 'ed', 'ing', 'er', 'ers', 'ly', 'ness', 'ment', 'ments', 'ism', 'isms', 'ist', 'ists',
  'ian', 'ial', 'al', 'ize', 'ise', 'ized', 'ised', 'izes', 'ises', 'ation', 'ations', 'ity', 'ive', 'able', 'ably', 'ous', 'ously', 'ic', 'ical']);
const AFFIX_STEM = 4;

const DILUTE_PREFIXES = ['under', 'super', 'over', 'anti', 'non', 'dis', 'mis', 'pre', 'sub', 'un', 're', 'de', 'in', 'im'];
const DILUTE_SUFFIXES = ['ations', 'ation', 'ments', 'ment', 'liest', 'iest', 'ness', 'ings', 'ists', 'izes', 'ises', 'ized', 'ised', 'ions', 'able', 'ible',
  'ing', 'ers', 'est', 'ion', 'ity', 'ism', 'ist', 'ous', 'ive', 'ize', 'ise', 'ial', 'ed', 'er', 'es', 'ly', 'al', 's'];
export function sharedAffixLen(a, b, min = 1) {
  const pre = DILUTE_PREFIXES.find((x) => x.length >= min && a.startsWith(x) && b.startsWith(x)) ?? '';
  const suf = DILUTE_SUFFIXES.find((x) => x.length >= min && a.endsWith(x) && b.endsWith(x)) ?? '';
  return Math.min(pre.length + suf.length, Math.min(a.length, b.length) - 2);
}

export function affixed(a, b) {
  for (let k = Math.min(a.length, b.length); k >= AFFIX_STEM; k--)
    if (a.slice(0, k) === b.slice(0, k) && AFFIX_SUFFIXES.has(a.slice(k)) && AFFIX_SUFFIXES.has(b.slice(k))) return true;
  for (let k = Math.min(a.length, b.length); k >= AFFIX_STEM; k--)
    if (a.slice(-k) === b.slice(-k) && PREFIXES.has(a.slice(0, -k)) && PREFIXES.has(b.slice(0, -k))) return true;
  return false;
}

const normBreaks = (e) => {
  const out = new Set();
  let n = 0;
  for (const w of e.spaced.split(/[\s\-\/&]+/)) { n += normOf(w).length; out.add(n); }
  out.delete(n);
  return out;
};
// A pair whose word breaks sit at different places inside the shorter
// side is a pun on spacing, not an inflection: SEETHING / SEE THINGS.
const realRespace = (q, e) => {
  if ((q.word && e.ownSpaced) || (e.word && q.ownSpaced)) return true;
  const [s, l] = q.norm.length <= e.norm.length ? [q, e] : [e, q];
  if (!l.norm.startsWith(s.norm)) return false;
  const bs = normBreaks(s), bl = normBreaks(l);
  for (const b of bl) if (b < s.norm.length && !bs.has(b)) return true;
  for (const b of bs) if (!bl.has(b)) return true;
  return false;
};

function variantKey(s) {
  return s.replace(/is(e|ed|es|ing|ation)/g, 'iz$1').replace(/ys(e|ed|es|ing)/g, 'yz$1')
    .replace(/our/g, 'or').replace(/tre(s?)$/, 'ter$1').replace(/ogue/g, 'og');
}

// 'forms' when the two are one entry in other forms; 'words' when one's
// content words all appear in the other, which a spoonerism survives, since
// its trade makes different words (TOO TRUE / TRUE TO, TO being a stop word).
function boring(q, e) {
  if (q.fam === e.fam || q.variant === e.variant) return 'forms';
  if (q.norm.replace(/[0-9]+/g, '#') === e.norm.replace(/[0-9]+/g, '#')) return 'forms';
  const infl = (s, l) => inflects(s.norm, l.norm) || inflects(s.variant, l.variant);
  if (!realRespace(q, e) && (q.norm.length <= e.norm.length && infl(q, e) || e.norm.length <= q.norm.length && infl(e, q))) return 'forms';
  const A = q.content, B = e.content;
  if (!A.length || !B.length) return false;
  return A.every((w) => B.includes(w)) || B.every((w) => A.includes(w)) ? 'words' : false;
}
