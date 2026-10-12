'use strict';

import { loadCmuDict, stressedSoundsOf, syllabify } from '../phonetics.js';
import { alignmentOf, lettersForPhones, canSpell } from '../phone-align.js';
import { itemsOf } from '../phone-reading.js';
import { buildSpacingTable, loadSpacingCorpus, spacingReader } from '../space-out.js';
import { toNorm, displayOf } from '../norm.js';

async function ensureDict() {
  try {
    await loadCmuDict();
  } catch {
    throw new Error('Couldn’t load the pronunciation dictionary — check your connection.');
  }
}

// ─── Readings ────────────────────────────────────────────────────────────────

const isVowel = ph => 'AEIOU'.includes(ph[0]);
const stressOf = ph => ph[ph.length - 1];
const bare = ph => ph.replace(/\d$/, '');

export function readingsOf(display, spacing) {
  const items = itemsOf(display, spacing, stressedSoundsOf);
  if (!items.length || items.includes(null)) return [];
  // A phrase takes each word's first pronunciation. Vary them and every phrase
  // becomes a group of itself: IS THIS IT stressed on each word in turn, ADVERSE
  // EFFECT four ways, IN EFFECT restating EFFECT.
  const picks = items.length > 1 ? [items.map(() => 0)] : items[0].sounds.map((_, s) => [s]);
  const readings = [];
  for (const pick of picks) {
    const phones = items.flatMap((item, k) => item.sounds[pick[k]].phones);
    const vowels = phones.filter(isVowel);
    const primary = [];
    vowels.forEach((v, i) => { if (stressOf(v) === '1') primary.push(i); });
    if (vowels.length < 2 || !primary.length) continue;
    readings.push({
      items, pick, vowels, primary,
      pron: phones.join(' '),
      skeleton: phones.map(ph => (isVowel(ph) ? '*' : ph)).join(' '),
    });
  }
  return readings;
}

// Narrower than Rhymes' schwa class: admitting EH0, OW0, and the rest marries EBAY
// to OBEY and DINO to DUNNO.
const REDUCED = new Set(['AH0', 'IH0']);

// The same consonants, and vowels that agree everywhere but one syllable, where a
// reduced vowel stands opposite a stressed one: that syllable's index, -1 when there
// is none, null when the readings don't match. Allow two and RAVEN meets RAVINE and
// MELON meets MALONE: the consonants line up, but nothing else sounds alike.
function swapOf(a, b) {
  if (a.skeleton !== b.skeleton) return null;
  let swap = -1;
  for (let i = 0; i < a.vowels.length; i++) {
    const v = a.vowels[i], w = b.vowels[i];
    if (bare(v) === bare(w)) continue;
    const rv = REDUCED.has(v), rw = REDUCED.has(w);
    if (rv && rw) continue;
    if (!(rv && stressOf(w) !== '0') && !(rw && stressOf(v) !== '0')) return null;
    if (swap >= 0) return null;
    swap = i;
  }
  return swap;
}

// A reduced vowel is a full one weakened, so it has to be spelled like the vowel it
// faces: the same first letter, and letters that can spell that vowel. ROCKET's `e`
// is ROCKETTE's EH, PROJECT's `o` its AA. CMU's AH0 alone can't tell a weakened
// vowel from one that was never that vowel: DUNDEE's `u` is no DANDY AE, RIVET's
// `e` no REVERT ER. The table alone would pass PERSONAL's `a` for PERSONNEL's EH;
// the first letter alone, RIVET's `e`.
//
// The stressed vowel must also be short, since a long or gliding one keeps its
// quality where the other reading's schwa doesn't: HUMAN and HUMANE, CARTON and
// CARTOON, CRITIC and CRITIQUE sound like different words. One entry's own readings
// may face a long vowel, since CMU listing both is evidence the schwa is that vowel
// weakened (PROtest, pruh-TEST; DEtail, dih-TAIL). Not a gliding one, though: that
// still splits FInance from fiNANCE and HOStile from hoSTILE.
const GLIDING = new Set(['AY', 'EY', 'OY', 'AW']);
const LONG = new Set([...GLIDING, 'IY', 'OW', 'UW']);

export function soundsAlike(a, b, sameEntry = false) {
  const i = swapOf(a, b);
  if (i === null) return false;
  if (i < 0) return true;
  const [weak, strong] = REDUCED.has(a.vowels[i]) ? [a, b] : [b, a];
  const vowel = bare(strong.vowels[i]);
  if ((sameEntry ? GLIDING : LONG).has(vowel)) return false;
  // A one-letter word, the article A above all, is spelled like half the vowels.
  return !weak.solo[i] && weak.letters[i][0] === strong.letters[i][0]
    && canSpell(weak.letters[i], vowel);
}

// Disjoint, not merely unequal: CMU marks some compounds' second stress as primary
// (LAWMAKERS once each way), and that is no shift.
export const stressShifts = (a, b) => !a.primary.some(i => b.primary.includes(i));

// ─── Highlighting ────────────────────────────────────────────────────────────

function vowelLetters(reading) {
  const letters = [], solo = [];
  reading.items.forEach((item, k) => {
    const phones = item.sounds[reading.pick[k]].phones;
    const steps = alignmentOf(item.letters, phones.map(bare));
    phones.forEach((ph, j) => {
      if (!isVowel(ph)) return;
      const [s, e] = lettersForPhones(steps, j, j + 1, item.letters.length);
      letters.push(item.letters.slice(s, e));
      solo.push(phones.length === 1);
    });
  });
  return { letters, solo };
}

// A reading's identity is per entry: whether it can face a stressed vowel depends
// on its letters (GRAY and GREY say one thing), and whether a long one is allowed on
// whose reading it is (CASHES says CACHES' short reading, without its exemption).
const withLetters = (reading, norm) => {
  const { letters, solo } = vowelLetters(reading);
  return { ...reading, norm, letters, solo, id: reading.pron + '#' + letters.join(',') + '#' + norm };
};

function stressRanges(reading) {
  const ranges = [];
  let syllable = 0;
  reading.items.forEach((item, k) => {
    const phones = item.sounds[reading.pick[k]].phones;
    let at = 0;
    for (const { onset, coda } of syllabify(phones.join(' '))) {
      const from = at;
      at += onset.length + 1 + coda.length;
      if (reading.primary.includes(syllable++)) {
        const steps = alignmentOf(item.letters, phones.map(bare));
        const [s, e] = lettersForPhones(steps, from, at, item.letters.length);
        ranges.push({ start: item.at[s], end: item.at[e - 1] + 1, kind: 'search:0' });
      }
    }
  });
  // The renderer drops a range starting inside another, and a syllable with no
  // letters of its own claims its whole word.
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
    else merged.push(r);
  }
  return merged;
}

// ─── Grouping ────────────────────────────────────────────────────────────────

const INDEX_KEY = 'stress-shift/index';
const BYTES_PER_INDEX_SLOT = 64;

// Maximal cliques, not connected components: chained, DETER links DAUGHTER, DEBTOR,
// and DIETER, which sound nothing like each other.
function cliquesOf(nodes) {
  const adj = nodes.map(() => new Set());
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (soundsAlike(nodes[i], nodes[j], nodes[i].norm === nodes[j].norm)) { adj[i].add(j); adj[j].add(i); }
    }
  }
  const cliques = [];
  const extend = (r, p, x) => {
    if (!p.length && !x.length) { if (r.length > 1) cliques.push(r); return; }
    const pivot = [...p, ...x].reduce((a, b) => (adj[b].size > adj[a].size ? b : a));
    for (const v of p.filter(v => !adj[pivot].has(v))) {
      extend([...r, v], p.filter(u => adj[v].has(u)), x.filter(u => adj[v].has(u)));
      p = p.filter(u => u !== v);
      x = [...x, v];
    }
  };
  extend([], nodes.map((_, i) => i), []);
  return cliques.map(c => c.map(i => nodes[i]));
}

// A group's key is its readings' ids, so a member's stressed syllables can be
// re-derived from its text and the key alone, as the render path requires.
const keyOf = clique => clique.map(r => r.id).sort().join('|');
const idsOf = key => new Set(key.split('|'));
const pronOf = id => id.slice(0, id.indexOf('#'));

// Aligning letters costs too much for every reading in the wordlist, so readings are
// first bucketed by pronunciation, and only a bucket where some pair could shift is
// re-read with its letters.
async function shiftIndex(ctx, spacing) {
  const cached = ctx.cache.get(INDEX_KEY);
  if (cached) return cached;
  const byPron = new Map();
  await ctx.forEach(ctx.wordlist.entries, wlEntry => {
    const display = displayOf(wlEntry);
    for (const reading of readingsOf(display, spacing)) {
      const node = byPron.get(reading.pron);
      if (node) node.displays.push(display);
      else byPron.set(reading.pron, { ...reading, items: null, displays: [display] });
    }
  });
  const buckets = new Map();
  for (const node of byPron.values()) {
    const bucket = buckets.get(node.skeleton);
    if (bucket) bucket.push(node);
    else buckets.set(node.skeleton, [node]);
  }
  const index = new Map();
  let bytes = 0;
  for (const bucket of buckets.values()) {
    if (!bucket.some(a => bucket.some(b => stressShifts(a, b) && swapOf(a, b) !== null))) continue;
    const nodes = new Map();
    for (const { pron, displays } of bucket) {
      for (const display of displays) {
        const reading = readingsOf(display, spacing).find(r => r.pron === pron);
        const node = withLetters(reading, toNorm(display));
        if (!nodes.has(node.id)) nodes.set(node.id, node);
      }
    }
    for (const clique of cliquesOf([...nodes.values()])) {
      if (!clique.some(a => clique.some(b => stressShifts(a, b)))) continue;
      const key = keyOf(clique);
      for (const { id } of clique) {
        const keys = index.get(id);
        if (keys) keys.push(key);
        else index.set(id, [key]);
        bytes += BYTES_PER_INDEX_SLOT + 2 * key.length;
      }
    }
    if (ctx.due()) await ctx.yield();
  }
  const value = { index, prons: new Set([...index.keys()].map(pronOf)) };
  ctx.cache.put(INDEX_KEY, value, bytes);
  return value;
}

function readingsIn(display, key, spacing) {
  const ids = idsOf(key);
  const prons = new Set([...ids].map(pronOf));
  return readingsOf(display, spacing)
    .filter(r => prons.has(r.pron))
    .map(r => withLetters(r, toNorm(display)))
    .filter(r => ids.has(r.id));
}

const within = (a, b) => a.primary.length < b.primary.length && a.primary.every(i => b.primary.includes(i));

function memberReadings(display, key, spacing) {
  const readings = readingsIn(display, key, spacing);
  const seen = new Set();
  const out = [];
  for (const reading of readings) {
    // CMU lists some words with a stress doubled (PREDATE as preDATE and PREDATE),
    // and the doubled one only restates the other.
    if (readings.some(r => within(r, reading))) continue;
    const ranges = stressRanges(reading);
    const sig = ranges.map(r => r.start + '-' + r.end).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(ranges);
  }
  return out.sort((a, b) => (a[0]?.start ?? 0) - (b[0]?.start ?? 0));
}

// ─── Tool ────────────────────────────────────────────────────────────────────

// By norm: IN SIGHT and INSIGHT are one entry said two ways, a heteronym pair.
function shows(show, a, b) {
  return stressShifts(a, b) && (show === 'heteronyms') === (a.norm === b.norm);
}

export default {
  name: 'Stress shift', icon: '😅', category: 'phonetic',
  desc: 'Same sounds, stress on another syllable',
  example: 'desert · dessert',
  assets: ['cmudict', 'unigrams'],
  params: [
    { key: 'show', type: 'segmented', default: 'homophones', label: 'Show',
      title: 'Homophones pair different entries; heteronyms are one entry said two ways',
      choices: [
        { value: 'homophones', label: 'Homophones' },
        { value: 'heteronyms', label: 'Heteronyms' },
      ] },
  ],
  kind: 'group',
  matchOn: 'display',
  group: {
    async prepare(params, ctx) {
      await ensureDict();
      await loadSpacingCorpus();
      const spacing = await buildSpacingTable(ctx);
      return { spacing, show: params.show || 'homophones', ...await shiftIndex(ctx, spacing) };
    },
    key(display, { spacing, index, prons }) {
      const keys = new Set();
      for (const reading of readingsOf(display, spacing)) {
        if (!prons.has(reading.pron)) continue;
        for (const key of index.get(withLetters(reading, toNorm(display)).id) ?? []) keys.add(key);
      }
      return [...keys];
    },
    memberReadings: (display, key, ctx) => memberReadings(display, key, spacingReader(ctx)),
    // Rechecked per group, not settled by the index: an upstream filter can thin a
    // group down to members that all stress alike.
    keepGroup(members, { spacing, show }, key) {
      const readings = members.flatMap(m => readingsIn(m, key, spacing));
      return readings.some(a => readings.some(b => shows(show, a, b)));
    },
  },
};
