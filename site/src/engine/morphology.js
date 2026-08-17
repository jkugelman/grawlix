'use strict';

// Maps each entry to a "family key" so inflectional relatives (cat/cats,
// eat/ate/eaten) share a key and sort adjacent. Anchored against the wordlist's
// own vocabulary, not a fixed dictionary, so out-of-dictionary crossword fill
// still reduces to a base that actually appears in the list.

import { toNorm } from './norm.js';
import { WORDNET_IRREGULARS } from './irregulars-data.js';

// ─── Irregulars ──────────────────────────────────────────────────────────────
const IRREGULARS = new Map();
const IRREGULARS_REVERSE = new Map();
function addIrregular(form, base) {
  IRREGULARS.set(form, base);
  let forms = IRREGULARS_REVERSE.get(base);
  if (!forms) IRREGULARS_REVERSE.set(base, forms = new Set([base]));
  forms.add(form);
}
for (const line of WORDNET_IRREGULARS.trim().split('\n')) {
  const sp = line.indexOf(' ');
  addIrregular(line.slice(0, sp), line.slice(sp + 1));
}
// Forms WordNet's exception lists omit: the suppletions it models as separate
// lemmas (people, women) and a couple of irregular plurals it lacks. Without
// these they silently split from their singulars. being/doing look regular, but
// the -ing rule's silent-e restoration outranks the bare stem on length: bee, doe.
for (const [base, forms] of Object.entries({
  woman: ['women'], person: ['people'], die: ['dice'], bacterium: ['bacteria'],
  be: ['being'], do: ['doing'],
})) {
  for (const form of forms) addIrregular(form, base);
}

// Injected by the worker (the only place families are computed) rather than
// imported, so the ~80 KB word list rides the worker bundle alone and not the
// main bundle, which pulls morphology transitively but never reduces a token.
let commonWords = new Set();
export function configureCommonWords(raw) {
  commonWords = new Set(raw.trim().split('\n'));
}

const ARTICLES = new Set(['a', 'an', 'the']);

// ─── Reduction ───────────────────────────────────────────────────────────────

function undouble(s) {
  return /([bcdfghjklmnpqrstvwxz])\1$/.test(s) ? s.slice(0, -1) : s;
}

function candidates(word) {
  const set = new Set([word]);
  const add = s => { if (s && s.length >= 2) set.add(s); };
  if (word.endsWith('ies') && word.length > 4) { add(word.slice(0, -3) + 'y'); add(word.slice(0, -2)); }
  if (word.endsWith('ied') && word.length > 4) add(word.slice(0, -3) + 'y');
  if (word.endsWith('es') && word.length > 3) { add(word.slice(0, -2)); add(word.slice(0, -1)); }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) add(word.slice(0, -1));
  if (word.endsWith('ed') && word.length > 3) { add(word.slice(0, -2)); add(word.slice(0, -1)); add(undouble(word.slice(0, -2))); }
  if (word.endsWith('ing') && word.length > 4) { add(word.slice(0, -3)); add(word.slice(0, -3) + 'e'); add(undouble(word.slice(0, -3))); }
  return set;
}

// Gates the irregulars lookup only: that table is keyed on whole words, and the
// strip can forge one ("we're" → were → be). Suffix reduction stays open to
// contractions — it only ever shortens, and is gated on the list's own vocab.
const ELIDING_APOSTROPHE = /['’](?=\p{L})/u;

// Irregulars resolve to base first; without that, men/ate have no shorter
// candidate and silently split from man/eat.
function reduceToken(word, vocab, raw = word) {
  const base = ELIDING_APOSTROPHE.test(raw) ? undefined : IRREGULARS.get(word);
  if (base !== undefined) return base;
  // A common candidate outranks a longer one, else a spurious longer stem in the
  // list (French `calle` for `called`) beats the true base `call` on length and
  // silently splits the paradigm. An all-uncommon set falls back to longest, so
  // out-of-dictionary fill still anchors against the list's own vocabulary.
  let best = null, bestCommon = false;
  for (const cand of candidates(word)) {
    if (cand === word || cand.length >= word.length || !vocab.has(cand)) continue;
    const common = commonWords.has(cand);
    if (best === null || (common && !bestCommon) || (common === bestCommon && cand.length > best.length)) {
      best = cand;
      bestCommon = common;
    }
  }
  return best;
}

// ─── Family key ──────────────────────────────────────────────────────────────

function tokenize(text) {
  return text.split(/\s+/).map(toNorm).filter(Boolean);
}

function familyWords(text) {
  const words = text.split(/\s+/).map(raw => ({ raw, norm: toNorm(raw) })).filter(w => w.norm);
  while (words.length > 1 && ARTICLES.has(words[0].norm)) words.shift();
  return words;
}

export function familyTokens(text) {
  return familyWords(text).map(w => w.norm);
}

export function familyKey(text, vocab) {
  const words = familyWords(text);
  if (!words.length) return text.toLowerCase();
  return words.map(w => reduceToken(w.norm, vocab, w.raw) ?? w.norm).join(' ');
}

// ─── Name relatives ──────────────────────────────────────────────────────────
//
// Links an entry to the fuller names that contain it (Menchú ↔ Rigoberta Menchú,
// Medicine Hat ↔ Medicine Hat, Alberta). Purely structural: the caller supplies
// the proper-noun judgement, since corpus.js imports this module and reaching
// back for casePart would close an import cycle.

// What the collapsed list shows per anchor, not a section total: a name anchors on
// each of its parts independently, so a three-part name may show this many via each.
// Matches past it are flagged, not dropped — they wait behind the panel's "+N more".
export const NAME_RELATIVE_CAP = 3;

// Deliberately only i/v/x. Admitting m/d/l/c matches ordinary words — `mix` is
// M+IX, and so are `dim`, `lid`, `mimi`, `dix` — silently costing real names,
// while regnal numerals past XXXIX never appear.
const ROMAN_NUMERAL = /^(?=[ivx]+$)(xx{0,2}|x?)(ix|iv|v?i{0,3})$/;

// Always capitalized by grammar rather than by naming anything, so they would
// otherwise anchor hundreds of links apiece.
const NON_NAMES = new Set(['im', 'ive', 'id', 'mr', 'mrs', 'ms', 'dr', 'tv']);

const canAnchor = t => t.length > 1 && !ROMAN_NUMERAL.test(t) && !NON_NAMES.has(t);

// Each word paired with its norm token, dropping the same slots from both so the
// two stay index-aligned (`Rock & Roll` norms to two tokens, not three). The word
// is kept because toNorm discards the case the relation is judged on.
//
// Plain words — not familyTokens, whose leading-article strip would collapse the
// band `The The` back to a lone `the`, and not familyKey, whose lemma reduction
// would let `Williams` stand in for `William`.
export function nameParts(text) {
  const parts = [];
  for (const word of String(text ?? '').split(/\s+/)) {
    const token = toNorm(word);
    if (token) parts.push({ token, word });
  }
  return parts;
}

const capitalized = word => {
  for (const ch of word) {
    if (/\p{L}/u.test(ch)) return /\p{Lu}/u.test(ch);
  }
  return null;                                  // no letters — neither capitalized nor not
};

// A run reads as a name only where it is written as one. Judging the run in the
// LONGER entry too is what separates Rigoberta Menchú from `iced tea`: both hold
// their anchor as a whole word, but only one capitalizes it. A bare row's display
// is its lowercase norm (`displayForRaw`), so all-uppercase wordlists contribute
// no capitals here and cannot flood the list.
function readsAsName(parts) {
  let sawLetter = false;
  for (const { word } of parts) {
    const c = capitalized(word);
    if (c === false) return false;
    if (c === true) sawLetter = true;
  }
  return sawLetter;
}

// The shorter side's tokens when it occurs as a CONTIGUOUS run inside the longer,
// else null. Contiguity is load-bearing: under mere token containment the band
// `The The` matches every title that says "the" twice — 15K relatives from one row.
export function nameAnchorRun(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= long.length || !short.length) return null;
  if (!short.every(p => canAnchor(p.token)) || !readsAsName(short)) return null;
  for (let i = 0; i <= long.length - short.length; i++) {
    let hit = true;
    for (let j = 0; j < short.length; j++) {
      if (long[i + j].token !== short[j].token) { hit = false; break; }
    }
    if (hit && readsAsName(long.slice(i, i + short.length))) return short.map(p => p.token);
  }
  return null;
}

export function collectVocab(texts) {
  const vocab = new Set();
  for (const text of texts) {
    for (const token of tokenize(text)) vocab.add(token);
  }
  return vocab;
}

// ─── Inflection generation ─────────────────────────────────────────────────────

const isVowel = c => 'aeiou'.includes(c ?? '');

function suffixReduce(word) {
  const out = [];
  const add = s => { if (s && s.length >= 2) out.push(s); };
  if (word.endsWith('ies') && word.length > 4) { add(word.slice(0, -3) + 'y'); add(word.slice(0, -2)); }
  if (word.endsWith('ied') && word.length > 4) add(word.slice(0, -3) + 'y');
  if (word.endsWith('es') && word.length > 3) { add(word.slice(0, -2)); add(word.slice(0, -1)); }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) add(word.slice(0, -1));
  if (word.endsWith('ed') && word.length > 3) { add(word.slice(0, -2)); add(word.slice(0, -1)); add(undouble(word.slice(0, -2))); }
  if (word.endsWith('ing') && word.length > 4) { add(word.slice(0, -3)); add(word.slice(0, -3) + 'e'); add(undouble(word.slice(0, -3))); }
  return out;
}

function suffixExpand(stem) {
  const out = [stem + 's', stem + 'es', stem + 'ed', stem + 'ing'];
  if (stem.endsWith('e')) out.push(stem.slice(0, -1) + 'ed', stem.slice(0, -1) + 'ing', stem + 'd');
  if (stem.endsWith('y') && !isVowel(stem.at(-2))) out.push(stem.slice(0, -1) + 'ies', stem.slice(0, -1) + 'ied');
  return out;
}

export function inflectForms(word) {
  const forms = new Set([word]);
  const stems = new Set([word]);
  const irBase = IRREGULARS.get(word);
  if (irBase) stems.add(irBase);
  for (const s of suffixReduce(word)) stems.add(s);
  for (const stem of stems) {
    forms.add(stem);
    for (const f of IRREGULARS_REVERSE.get(stem) ?? []) forms.add(f);
    for (const f of suffixExpand(stem)) forms.add(f);
  }
  return [...forms];
}

export function generateRelativeNorms(text, { maxChanged = 2, cap = 5000 } = {}) {
  const words = text.split(/\s+/).map(w => w.toLowerCase()).filter(Boolean);
  const norms = new Set();
  if (!words.length) return norms;
  const variants = words.map(inflectForms);
  const selfNorm = toNorm(text);
  let count = 0, overCap = false;
  const walk = (i, changed, acc) => {
    if (overCap) return;
    if (i === words.length) {
      if (++count > cap) { overCap = true; return; }
      const n = toNorm(acc.join(''));
      if (n && n !== selfNorm) norms.add(n);
      return;
    }
    acc.push(words[i]); walk(i + 1, changed, acc); acc.pop();
    if (changed < maxChanged) {
      for (const f of variants[i]) {
        if (f === words[i]) continue;
        acc.push(f); walk(i + 1, changed + 1, acc); acc.pop();
      }
    }
  };
  walk(0, 0, []);
  return norms;
}
