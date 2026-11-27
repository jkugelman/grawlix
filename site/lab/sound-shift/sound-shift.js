'use strict';

import { loadCmuDict, shiftReadingsOf } from '../../src/engine/phonetics.js';
import { itemsOf, soundsOrSpelled } from '../../src/engine/phone-reading.js';
import { displayOf, toNorm } from '../../src/engine/norm.js';
import {
  loadUnigramCorpus, hasUnigramCorpus, rankedSplits, SPACE_OUT_WINDOWS,
} from '../../src/engine/segmenter.js';
import { buildHelpHTML } from '../../src/core/util.js';

const VOWELS = [
  ['AA', 'father'], ['AE', 'cat'], ['AH', 'cup'], ['AO', 'four'], ['AW', 'cow'],
  ['AY', 'my'], ['EH', 'bed'], ['ER', 'bird'], ['EY', 'day'], ['IH', 'sit'],
  ['IY', 'see'], ['OW', 'go'], ['OY', 'toy'], ['UH', 'book'], ['UW', 'blue'],
];
const CONSONANTS = [
  ['B', 'bee'], ['CH', 'chin'], ['D', 'dog'], ['DH', 'this'], ['F', 'fun'],
  ['G', 'game'], ['HH', 'hat'], ['JH', 'joy'], ['K', 'key'], ['L', 'let'],
  ['M', 'man'], ['N', 'now'], ['NG', 'sing'], ['P', 'pen'], ['R', 'row'],
  ['S', 'sun'], ['SH', 'she'], ['T', 'top'], ['TH', 'thin'], ['V', 'van'],
  ['W', 'win'], ['Y', 'yes'], ['Z', 'zoo'], ['ZH', 'vision'],
];
const ARPABET = new Set([...VOWELS, ...CONSONANTS].map(([p]) => p));

const SOUND_HELP =
  '<div class="help-intro">Limit to moves of one sound. Blank moves any.</div>' +
  '<div class="help-section">Vowels</div>' + buildHelpHTML(VOWELS, { cols: 3 }) +
  '<div class="help-section">Consonants</div>' + buildHelpHTML(CONSONANTS, { cols: 3 });

const soundOf = params => (params.sound || '').trim().toUpperCase();

const wordsOf = text => text.toLowerCase().match(/[a-z']+/g) || [];

const SEGMENT_WINDOW = SPACE_OUT_WINDOWS.few;

async function ensureAssets() {
  try {
    await loadCmuDict();
  } catch {
    throw new Error('Couldn’t load the pronunciation dictionary — check your connection.');
  }
  // Unlike cmudict's, this failure is swallowed: unigrams only power the optional
  // compound fallback, so offline degrades coverage instead of breaking the tool.
  try {
    await loadUnigramCorpus();
  } catch { /* hasUnigramCorpus() guards the fallback */ }
}

// ─── Reading entries ─────────────────────────────────────────────────────────

// cmudict lists only whole headwords, so solid compounds ("firetruck") get no
// pronunciation — segmenting them into pronounceable words is what lifts coverage.
// Every ranked split, not just the spacing table's guess: a top split CMU can't
// read shouldn't hide a lower one it can.
const rankedSplitsIn = vocab => function* (letters) {
  if (hasUnigramCorpus()) yield* rankedSplits(letters, SEGMENT_WINDOW, vocab);
};

const MAX_READINGS = 4;

// Dropping word boundaries and stress is load-bearing, not tidying: "friar tuck"
// and "fire truck" are one phoneme apart only once the spaces stop counting, and
// a moved sound routinely lands on a differently stressed syllable. Restore
// either and sound-shift silently stops finding its motivating cases.
// Plain and folded readings are compared only with their own kind, as in Phone
// search: the folds see inside one word, so SEATER's T flaps to D while EASTER's
// stays T, and a plain-to-folded compare would lose them.
function readingsOf(display, splitsOf) {
  const { items } = itemsOf(display, splitsOf, soundsOrSpelled);
  if (!items.length || items.includes(null)) return [];
  return ['plain', 'folded'].flatMap(kind => productOf(items, kind).map(phones => ({ kind, phones })));
}

const shiftCache = new WeakMap();
function shiftReadings(sounds) {
  let found = shiftCache.get(sounds);
  if (found) return found;
  const distinct = kind => [...new Map(sounds.map(s => {
    const phones = shiftReadingsOf(s.toks)[kind];
    return [phones.join(' '), phones];
  })).values()];
  found = { plain: distinct('plain'), folded: distinct('folded') };
  shiftCache.set(sounds, found);
  return found;
}

function productOf(items, kind) {
  let readings = [[]];
  for (const item of items) {
    const next = [];
    outer:
    for (const sofar of readings) {
      for (const phones of shiftReadings(item.sounds)[kind]) {
        next.push(sofar.concat(phones));
        if (next.length >= MAX_READINGS) break outer;
      }
    }
    readings = next;
  }
  const seen = new Set();
  return readings.filter(phones => {
    const key = phones.join(' ');
    return !seen.has(key) && !!seen.add(key);
  });
}

// Relocating a[i] to j leaves the window between them rotated by one and
// everything outside untouched, so testing the two rotations of the differing
// window settles the relation in one pass, rather than trying every (from, to).
export function movedPhoneme(a, b) {
  if (a.length !== b.length) return null;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i === a.length) return null;
  let j = a.length - 1;
  while (j >= 0 && a[j] === b[j]) j--;
  let ok = true;
  for (let k = i; k < j; k++) if (b[k] !== a[k + 1]) { ok = false; break; }
  if (ok && b[j] === a[i]) return a[i];
  ok = b[i] === a[j];
  if (ok) for (let k = i + 1; k <= j; k++) if (b[k] !== a[k - 1]) { ok = false; break; }
  return ok ? a[j] : null;
}

// ─── Morphological-variant filter ────────────────────────────────────────────
// Same words re-inflected, reordered, or split elsewhere (billiard parlors /
// billiardsparlor) are not wordplay: cmudict's pronunciation variants let a plural
// or tense hop a word boundary and pose as a relocated phoneme. Those are dropped.

const INFL_SUFFIXES = ['s', 'es', 'ed', 'ing', "'s", "'"];

// Is `longer` an inflected form of `stem`? Inflectional endings only, never
// derivational — stripping -ance/-ness would collapse clearance and clearness onto
// one stem and delete a real find. Bare -d counts only after -e (love→loved), so
// for→ford and stan→stand aren't mistaken for inflection.
function inflectedFrom(stem, longer) {
  if (stem === longer) return true;
  for (const suf of INFL_SUFFIXES) if (stem + suf === longer) return true;
  if (stem.endsWith('e') && stem + 'd' === longer) return true;
  if (stem.endsWith('e') && stem.slice(0, -1) + 'ing' === longer) return true;   // bake → baking
  if (stem.endsWith('y')) {
    const base = stem.slice(0, -1);
    if (base + 'ies' === longer || base + 'ied' === longer) return true;         // hurry → hurried
  }
  const doubled = stem + stem[stem.length - 1];
  return doubled + 'ed' === longer || doubled + 'ing' === longer;                // stop → stopped
}

export const sameStem = (u, v) => u === v || (u.length <= v.length ? inflectedFrom(u, v) : inflectedFrom(v, u));

function sameWordBag(a, b) {
  if (a.length !== b.length || !a.length) return false;
  const used = new Array(b.length).fill(false);
  const match = i => {
    if (i === a.length) return true;
    for (let j = 0; j < b.length; j++) if (!used[j] && sameStem(a[i], b[j])) {
      used[j] = true;
      if (match(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return match(0);
}

// Order-preserving so a compound only matches its own phrasal form, never that
// phrase reversed — lessor decomposes to [less, or] but must not filter "or less".
const sameSequence = (a, b) => a.length === b.length && a.length > 0 && a.every((w, i) => sameStem(w, b[i]));

const SUFFIX_FRAGMENTS = new Set(['s', 'es', 'd', 'ed', 'ing', 'ies', 'ied', "'s", "'"]);
const DECOMPOSE_WINDOW = SPACE_OUT_WINDOWS.many;

// Decomposition (for the compound-vs-phrasal check) splits only into REAL words: a
// bare "s"/"ed" fragment is never a token, which keeps `spot` from posing as
// `s`+`pot` and wrongly filtering the genuine `dry pots` / `dry spot`.
export function makeMorphFilter(vocab) {
  const known = norm => vocab.norms.has(norm);

  const strip = w => {
    if (w.endsWith("'s")) w = w.slice(0, -2);
    else if (w.endsWith("'")) w = w.slice(0, -1);
    if (w.length >= 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length >= 4 && w.endsWith('ied')) return w.slice(0, -3) + 'y';
    if (w.length >= 5 && w.endsWith('ing')) { const s = w.slice(0, -3); return known(s) ? s : known(s + 'e') ? s + 'e' : s; }
    if (w.length >= 4 && w.endsWith('ed')) { const s = w.slice(0, -2); return known(s) ? s : known(s + 'e') ? s + 'e' : s; }
    if (w.length >= 4 && w.endsWith('es') && known(w.slice(0, -2))) return w.slice(0, -2);
    if (w.length >= 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    if (w.length >= 4 && w.endsWith('d') && w.slice(0, -1).endsWith('e') && known(w.slice(0, -1))) return w.slice(0, -1);
    return w;
  };

  const decompCache = new Map();
  const decompose = stem => {
    let best = decompCache.get(stem);
    if (best) return best;
    best = [stem];
    if (stem.length >= 4 && hasUnigramCorpus()) {
      for (const parts of rankedSplits(stem, DECOMPOSE_WINDOW, vocab)) {
        if (parts.length > best.length && parts.every(p => p.length >= 2 && known(p) && !SUFFIX_FRAGMENTS.has(p))) best = parts;
      }
    }
    decompCache.set(stem, best);
    return best;
  };

  const wordsCache = new Map();
  const segWords = display => {
    let words = wordsCache.get(display);
    if (words) return words;
    words = wordsOf(display);
    if (words.length < 2 && hasUnigramCorpus()) {   // solid token → recover its words
      const norm = toNorm(display);
      const top = norm && rankedSplits(norm, SEGMENT_WINDOW, vocab)[0];
      if (top) words = top;
    }
    wordsCache.set(display, words);
    return words;
  };

  const atomCache = new Map();
  const atoms = display => {
    let out = atomCache.get(display);
    if (out) return out;
    out = [];
    for (const w of segWords(display)) out.push(...decompose(strip(w)));
    atomCache.set(display, out);
    return out;
  };

  return (da, db) => sameWordBag(segWords(da), segWords(db)) || sameSequence(atoms(da), atoms(db));
}

const CACHE_KEY = 'sound_shift/pairs';
const BYTES_PER_PAIR = 80;   // two shared display refs + a phoneme string + wrapper
const estimatePairsBytes = pairs => pairs.length * BYTES_PER_PAIR;
const READ_PASS = { key: 'sound_shift/read', artifact: CACHE_KEY, weight: 62 };
const PAIR_PASS = { key: 'sound_shift/pair', artifact: CACHE_KEY, weight: 1 };

// Every pair one moved phoneme apart, tagged with that phoneme — pointedly NOT filtered
// by the Sound param (partnersForSound does that after), so this full sweep depends
// only on the corpus and caches across Sound changes. Bucketing on the sorted multiset
// loses none (a move permutes phonemes) and makes it a few compares per bucket.
async function computeAllPairs(ctx) {
  const buckets = new Map();
  const splitsOf = rankedSplitsIn(ctx.vocab);
  await ctx.forEach(ctx.wordlist.entries, entry => {
    const display = displayOf(entry);
    for (const { kind, phones } of readingsOf(display, splitsOf)) {
      const key = kind + ':' + [...phones].sort().join(' ');
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = []);
      bucket.push({ display, pron: phones });
    }
  }, READ_PASS);

  const isMorphVariant = makeMorphFilter(ctx.vocab);
  const pairs = [];
  const seen = new Set();   // the same pair can surface in more than one multiset bucket
  // One work item per bucket row, not per bucket: one pathological bucket would
  // otherwise run its whole O(n²) compare without ever yielding to cancel.
  const rows = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    for (let x = 0; x < members.length - 1; x++) rows.push([members, x]);
  }
  await ctx.forEach(rows, ([members, x]) => {
    for (let y = x + 1; y < members.length; y++) {
      const a = members[x], b = members[y];
      if (a.display === b.display) continue;
      const phoneme = movedPhoneme(a.pron, b.pron);
      if (!phoneme) continue;
      if (isMorphVariant(a.display, b.display)) continue;
      const lo = a.display < b.display ? a.display : b.display;
      const hi = a.display < b.display ? b.display : a.display;
      const k = lo + '\0' + hi + '\0' + phoneme;
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push({ a: a.display, b: b.display, phoneme });
    }
  }, PAIR_PASS);
  return pairs;
}

// Both directions link (as Semordnilap) so `unify` folds each pair to one ↔ row.
function partnersForSound(pairs, sound) {
  const partners = new Map();
  const link = (from, to) => {
    let set = partners.get(from);
    if (!set) partners.set(from, set = new Set());
    set.add(to);
  };
  for (const { a, b, phoneme } of pairs) {
    if (sound && phoneme !== sound) continue;
    link(a, b);
    link(b, a);
  }
  return partners;
}

export default {
  name: 'Sound shift', icon: '🎶', category: 'lab',
  desc: 'Move one sound to a new spot',
  example: 'friar tuck ↔ fire truck',
  assets: ['cmudict', 'cmuSupplement', 'unigrams'],
  passes: [READ_PASS, PAIR_PASS],
  params: [
    { label: 'Sound', placeholder: 'any', help: SOUND_HELP },
  ],
  // Emits both directions of each pair, as Semordnilap does, and leans on `unify`
  // to fold them into one ↔ row.
  kind: 'transform',
  inputHighlights: false, outputHighlights: false,
  matchOn: 'display',
  glyph: () => '→',
  error: params => {
    const sound = soundOf(params);
    return sound && !ARPABET.has(sound) ? `“${params.sound}” isn’t a phoneme` : null;
  },
  async prepare(params, ctx) {
    await ensureAssets();
    let pairs = ctx.cache.get(CACHE_KEY);
    if (!pairs) {
      pairs = await computeAllPairs(ctx);
      ctx.cache.put(CACHE_KEY, pairs, estimatePairsBytes(pairs));
    }
    return { partners: partnersForSound(pairs, soundOf(params)) };
  },
  run(display, prepared) {
    const found = prepared.partners.get(display);
    return found ? [...found].map(entry => ({ entry })) : [];
  },
};
