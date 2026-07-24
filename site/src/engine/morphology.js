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
// these they silently split from their singulars.
for (const [base, forms] of Object.entries({
  woman: ['women'], person: ['people'], die: ['dice'], bacterium: ['bacteria'],
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

// Irregulars resolve to base first; without that, men/ate have no shorter
// candidate and silently split from man/eat.
function reduceToken(word, vocab) {
  const base = IRREGULARS.get(word);
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

export function familyTokens(text) {
  const tokens = tokenize(text);
  while (tokens.length > 1 && ARTICLES.has(tokens[0])) tokens.shift();
  return tokens;
}

export function familyKey(text, vocab) {
  const tokens = familyTokens(text);
  if (!tokens.length) return text.toLowerCase();
  return tokens.map(t => reduceToken(t, vocab) ?? t).join(' ');
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
