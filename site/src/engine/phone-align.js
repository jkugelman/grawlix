'use strict';

// ─── Letter–sound alignment ──────────────────────────────────────────────────
//
// Pairs each sound of a pronunciation with the letters that spell it, so a match
// found among the sounds can be marked on the letters: a cheapest-path search over
// (letters used, sounds used), stepping by known spellings.

const VOWEL_PHONES = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];

const SPELLINGS = {
  B: 'b bb bu',
  CH: 'ch tch t c cz ti',
  D: 'd dd ed ld t',
  DH: 'th the',
  F: 'f ff ph gh pph lf w v',
  G: 'g gg gu gh gue',
  HH: 'h wh j',
  JH: 'j g dg dge gg d ge gi di',
  K: 'k c ck ch q cc kh que cq cqu lk g',
  L: 'l ll le',
  M: 'm mm mb mn lm me',
  N: 'n nn kn gn pn ne mn',
  NG: 'ng n ngue',
  P: 'p pp',
  R: 'r rr wr rh',
  S: 's ss c sc ce se ps st sw z',
  SH: 'sh ch ti ci s ss si sch ce sci ssi xi t sz',
  T: 't tt ed pt th bt te d',
  TH: 'th',
  V: 'v vv f ve ph w',
  W: 'w wh u o',
  Y: 'y i j e',
  Z: 'z zz s ss x ze se ts',
  ZH: 's si g ge z ti j',
  'K S': 'x xc cc',
  'G Z': 'x',
  'K SH': 'x',
  'K W': 'qu q cqu',
  'HH W': 'wh',
  'T S': 'z zz tz c',
  'N Y': 'gn ni',
  'M AH K': 'mc',
  'M IH K': 'mc',
  'M AE K': 'mc',
  'W AH': 'o',
  'Y UW': 'u eu ew ue ui eau you ieu',
  'Y AH': 'u',
  'Y UH': 'u',
  'Y ER': 'u ur',
  'AH L': 'le',
  ER: 'er ir ur ear or ar our yr ere re eur r rr err urr irr',
  AA: 'a o ah al au aw',
  AE: 'a ai',
  AH: 'a e i o u ou oo io ia',
  AO: 'o a au aw ough augh al oa',
  AW: 'ou ow ough au',
  AY: 'i y ie igh ye ei ai uy eigh ay is',
  EH: 'e ea a ai ie ue ay',
  EY: 'a ai ay ei eigh ey ea et e aigh',
  IH: 'i y e ee ie ui u a',
  IY: 'e ee ea ie ei y i ey eo is',
  OW: 'o oa ow oe ough ew eau au ou',
  OY: 'oi oy',
  UH: 'oo u ou o',
  UW: 'oo u ou ew ue ui o oe ough wo',
};

const LETTER_NAMES = {
  a: 'EY', b: 'B IY', c: 'S IY', d: 'D IY', e: 'IY', f: 'EH F', g: 'JH IY', h: 'EY CH',
  i: 'AY', j: 'JH EY', k: 'K EY', l: 'EH L', m: 'EH M', n: 'EH N', o: 'OW', p: 'P IY',
  q: 'K Y UW', r: 'AA R', s: 'EH S', t: 'T IY', u: 'Y UW', v: 'V IY', w: 'D AH B AH L Y UW',
  x: 'EH K S', y: 'W AY', z: 'Z IY',
};
// Dearer than a vowel guess plus a plain spelling, or SERGEANT reads its r as AR.
const LETTER_NAME_COST = 3.5;

const SILENT_COST = { e: 1, x: 3, r: 3, j: 3, z: 3, h: 1.5, u: 2, w: 2.5, b: 2.5, k: 2.5, g: 2.5, t: 2.5, l: 3, p: 3, s: 3, a: 3, i: 3, o: 3, d: 3, n: 3, c: 3 };
const SILENT_DEFAULT = 4;
const SPELLED_COST = 1;

// A bare syllabic consonant (RHYTHM's m, PRISM's m). Priced so that spending it
// loses to giving the schwa a vowel letter of its own. Any cheaper and it pays for
// a spelling to eat that letter first: ABYSSINIAN's `ia` as one vowel, LEGEND's
// `ge` as JH with a silent e, and the highlight swallows the letter.
const SYLLABIC = { 'AH L': 'l', 'AH M': 'm', 'AH N': 'n' };
const SYLLABIC_COST = 2.25;
const VOWEL_GUESS_COST = 2;
const INSERT_SCHWA_COST = 2.5;   // RHYTHM, PRISM: a syllabic schwa no letter spells
const FALLBACK_COST = 6;

const isVowelLetter = c => 'aeiouy'.includes(c);

let spellingTable = null;   // letters → [{ phones: string[], cost }]
let maxSpelling = 0;

function table() {
  if (spellingTable) return spellingTable;
  spellingTable = new Map();
  const add = (letters, phones, cost) => {
    let list = spellingTable.get(letters);
    if (!list) spellingTable.set(letters, list = []);
    const key = phones.join(' ');
    const prior = list.find(e => e.phones.join(' ') === key);
    if (prior) prior.cost = Math.min(prior.cost, cost);
    else list.push({ phones, cost });
    maxSpelling = Math.max(maxSpelling, letters.length);
  };
  for (const [sounds, spellings] of Object.entries(SPELLINGS)) {
    for (const letters of spellings.split(' ')) add(letters, sounds.split(' '), SPELLED_COST);
  }
  for (const [sounds, letters] of Object.entries(SYLLABIC)) add(letters, sounds.split(' '), SYLLABIC_COST);
  for (const [letters, list] of [...spellingTable]) {
    if (letters.length !== 1 || isVowelLetter(letters)) continue;
    for (const e of list) add(letters + letters, e.phones, e.cost);
  }
  for (const [letter, name] of Object.entries(LETTER_NAMES)) add(letter, name.split(' '), LETTER_NAME_COST);
  return spellingTable;
}

function vowelRun(word, i) {
  let j = i;
  while (j < word.length && j - i < 3 && isVowelLetter(word[j])) j++;
  return j - i;
}

// `word` is lowercase letters; `phones` are stress-stripped. Steps run in order,
// each { from, to, phoneFrom, phoneTo, cost }; a silent letter has no phones.
export function alignWord(word, phones) {
  const tbl = table();
  const n = word.length, m = phones.length;
  const W = m + 1;
  const cost = new Float64Array((n + 1) * W).fill(Infinity);
  const back = new Int32Array((n + 1) * W * 2).fill(-1);
  const stepCost = new Float64Array((n + 1) * W);
  cost[0] = 0;
  const relax = (i, j, i2, j2, c) => {
    const at = i2 * W + j2;
    const total = cost[i * W + j] + c;
    if (total < cost[at]) {
      cost[at] = total;
      back[at * 2] = i;
      back[at * 2 + 1] = j;
      stepCost[at] = c;
    }
  };
  const phonesMatch = (j, seq) => {
    if (j + seq.length > m) return false;
    for (let k = 0; k < seq.length; k++) if (phones[j + k] !== seq[k]) return false;
    return true;
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (cost[i * W + j] === Infinity) continue;
      for (let len = 1; len <= maxSpelling && i + len <= n; len++) {
        const list = tbl.get(word.slice(i, i + len));
        if (!list) continue;
        for (const e of list) if (phonesMatch(j, e.phones)) relax(i, j, i + len, j + e.phones.length, e.cost);
      }
      if (j < m && VOWEL_PHONES.includes(phones[j])) {
        const run = vowelRun(word, i);
        for (let len = 1; len <= run; len++) relax(i, j, i + len, j + 1, VOWEL_GUESS_COST);
      }
      if (i < n) relax(i, j, i + 1, j, SILENT_COST[word[i]] ?? SILENT_DEFAULT);
      if (j < m) relax(i, j, i, j + 1, phones[j] === 'AH' ? INSERT_SCHWA_COST : FALLBACK_COST);
      if (i < n && j < m) relax(i, j, i + 1, j + 1, FALLBACK_COST);
    }
  }
  const steps = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const at = i * W + j;
    const pi = back[at * 2], pj = back[at * 2 + 1];
    steps.push({ from: pi, to: i, phoneFrom: pj, phoneTo: j, cost: stepCost[at] });
    i = pi; j = pj;
  }
  steps.reverse();
  return { steps, cost: cost[n * W + m] };
}

// The letters spelling sounds [a, b) of the word, or null when those sounds have
// no letters of their own (an inserted schwa). Silent letters at the word's start
// (KNIGHT) or end (PHONE) ride along with the neighbor they sit against.
export function lettersForPhones(steps, a, b, wordLength) {
  let start = Infinity, end = -Infinity;
  for (const s of steps) {
    if (s.phoneTo <= a || s.phoneFrom >= b || s.phoneFrom === s.phoneTo || s.from === s.to) continue;
    start = Math.min(start, s.from);
    end = Math.max(end, s.to);
  }
  if (start === Infinity) return null;
  const silent = s => s.phoneFrom === s.phoneTo;
  const first = steps.findIndex(s => s.from === start);
  let k = first - 1;
  while (k >= 0 && silent(steps[k])) k--;
  if (k < 0) start = 0;
  const last = steps.findIndex(s => s.to === end);
  k = last + 1;
  while (k < steps.length && silent(steps[k])) k++;
  if (k === steps.length) end = wordLength;
  return [start, end];
}

// Every step but a guess is priced under SILENT_DEFAULT. Price a real spelling at
// or above it and CMU's ordinary pronunciations start failing citationProns.
export function spellsOut(word, phones) {
  return alignWord(word, phones).steps.every(s => s.cost < SILENT_DEFAULT);
}
