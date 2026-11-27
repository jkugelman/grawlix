'use strict';

import { loadCmuDict, hasCmuDict } from '../phonetics.js';
import { hasUnigramCorpus } from '../segmenter.js';
import { buildSpacingTable, loadSpacingCorpus, spacingReader, SPACING_PASS } from '../space-out.js';
import { displayOf } from '../norm.js';
import { buildSearchPattern } from '../search.js';
import { makeScorer, prep, prepServices, configureRelation, configureRunModel, configureSwapTable } from '../twins.js';
import { makeWordTable } from '../twins-swap.js';
import { letterModel, letterCounts, mayShareRun } from '../twins-run.js';
import { rhymeMatch } from '../twins-sound.js';
import { letterFilter } from '../twins-filter.js';
import { wordnetAsset } from '../twins-wordnet.js';

const CUTOFF = 0.4;
let scorer = null;
const related = (q, e) => wordnetAsset.get()?.(q, e) ?? null;

// One query's hits, keyed by row object: the flat column and the highlight
// pass re-prepare through `replay`, and the result caches re-sort rows by the
// column without calling `run`, so a hit must outlive one `prepared`. Slots
// are filed under their merged corpus, so a replaced corpus is collected
// along with its slots. Six covers the shown query, the two pre-rolled 🎲
// entries and the roll being probed; the worker replays the kept three after
// each probe (keepRollsWarm) so the probes never push them out.
const SLOTS = 6;
const slotsByCorpus = new WeakMap();

// Every entry's rhyme keys by its display text, the content words word swaps
// match on, and the shared-run letter model, cached as one artifact: the
// model and the word table each build under the cache's admission floor and
// would be refused, rebuilding on every query.
const INDEX_KEY = 'twins/index';
const INDEX_PASS = { key: INDEX_KEY, weight: 18 };
const MODEL_PASS = { key: 'twins/model', artifact: INDEX_KEY, weight: 2 };
const MODEL_BYTES = 1e6;
// An edit moves the model's counts by one entry in hundreds of thousands, too
// little to retrain for; rhyme keys by display text never go stale.
const keep = () => {};

// A replay can run before prepare has loaded the assets; prepare rebuilds a
// slot made without them rather than keep its hits.
const assetsReady = () => hasCmuDict() && wordnetAsset.has() && hasUnigramCorpus();

// ─── Rhyme key store ─────────────────────────────────

// Rhyme keys by display text, packed into typed arrays: a Map of strings
// prices at 45 MB on a 743K-entry list, and with the spacing table overflows
// the cache pool, evicting the table on every query.
// Displays are found by a pair of 32-bit hashes, sorted for binary search;
// entries with the same keys share one run of characters.
const hash2 = (s) => {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15;
  }
  return [a >>> 0, b >>> 0];
};

function rhymeStoreBuilder() {
  const ha = [], hb = [], ids = [], idOf = new Map();
  let chars = new Uint16Array(1 << 16), end = 0;
  const starts = [0];
  return {
    add(display, keys) {
      let id = idOf.get(keys);
      if (id === undefined) {
        idOf.set(keys, (id = starts.length - 1));
        while (end + keys.length > chars.length) { const c = new Uint16Array(chars.length * 2); c.set(chars); chars = c; }
        for (let i = 0; i < keys.length; i++) chars[end++] = keys.charCodeAt(i);
        starts.push(end);
      }
      const [a, b] = hash2(display);
      ha.push(a); hb.push(b); ids.push(id);
    },
    finish() {
      const order = Uint32Array.from(ha.keys()).sort((i, j) => ha[i] - ha[j] || hb[i] - hb[j]);
      const store = {
        a: Uint32Array.from(order, (i) => ha[i]), b: Uint32Array.from(order, (i) => hb[i]),
        id: Uint32Array.from(order, (i) => ids[i]), starts: Uint32Array.from(starts), chars: chars.slice(0, end),
      };
      return rhymeStore(store);
    },
  };
}

// Entries an edit adds after the build go in `extra`, unpriced: a handful
// against the hundreds of thousands packed.
function rhymeStore({ a, b, id, starts, chars }) {
  const extra = new Map();
  const find = (display) => {
    const [x, y] = hash2(display);
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (a[mid] < x || (a[mid] === x && b[mid] < y)) lo = mid + 1; else hi = mid; }
    return lo < a.length && a[lo] === x && b[lo] === y ? id[lo] : -1;
  };
  return {
    bytes: a.byteLength + b.byteLength + id.byteLength + starts.byteLength + chars.byteLength,
    get(display) {
      const k = find(display);
      if (k < 0) return extra.get(display);
      return String.fromCharCode.apply(null, chars.subarray(starts[k], starts[k + 1]));
    },
    set: (display, keys) => { extra.set(display, keys); },
  };
}

// ─── Corpus index ────────────────────────────────────

async function corpusIndex(ctx, svc) {
  const cached = ctx.cache.get(INDEX_KEY);
  if (cached) return cached;
  const counts = letterCounts();
  await ctx.forEach([...ctx.vocab.norms], counts.add, MODEL_PASS);
  const model = counts.model();
  if (!hasCmuDict()) return { model, rhymes: null, words: null };
  const builder = rhymeStoreBuilder(), seen = new Set(), words = makeWordTable(w => svc.readWord(w));
  await ctx.forEach(ctx.wordlist.entries, wlEntry => {
    const display = displayOf(wlEntry);
    if (seen.has(display)) return;
    seen.add(display);
    builder.add(display, svc.rhymes(display) ?? '');
    svc.swap(display, words);
  }, INDEX_PASS);
  const rhymes = builder.finish();
  const index = { model, rhymes, words };
  ctx.cache.put(INDEX_KEY, index, MODEL_BYTES + rhymes.bytes + words.bytes, { patch: keep });
  return index;
}

function slotFor(text, ctx, spacing, index, fresh = false) {
  const wordlist = ctx.vocab;
  let slots = slotsByCorpus.get(wordlist);
  if (!slots) slotsByCorpus.set(wordlist, slots = new Map());
  let slot = slots.get(text);
  if (slot && fresh && !slot.ready) slot = null;
  slots.delete(text);
  if (!slot) slot = makeSlot(text, ctx, spacing, index);
  slots.set(text, slot);
  while (slots.size > SLOTS) slots.delete(slots.keys().next().value);
  return slot;
}

function makeSlot(text, ctx, spacing, index) {
  const { model, rhymes, words } = index ?? { model: letterModel(ctx.vocab.norms), rhymes: null, words: null };
  scorer ??= makeScorer();
  configureRelation(related);
  configureRunModel(model);
  configureSwapTable(words);
  const svc = prepServices(ctx.vocab, spacing);
  const q = prep({ display: text }, svc);
  q.sound = svc.sound(text, true);
  q.rhymes = svc.rhymes(text, true);
  q.swap = svc.swap(text, words);
  const passes = letterFilter(q, CUTOFF), swaps = scorer.swapFinder(q);
  const typed = buildSearchPattern(text, 'full', { literal: true });
  const ready = assetsReady() && !!rhymes;
  const rhymesOf = (display) => {
    let keys = rhymes?.get(display);
    if (keys === undefined) {
      keys = svc.rhymes(display);
      if (keys != null && ready) rhymes.set(display, keys);
    }
    return keys;
  };
  const hits = new WeakMap();
  return {
    ready,
    norm: q.norm,
    hitFor(wlEntry) {
      // Only hits are kept: the column and highlights ask about kept rows
      // alone, and a miss per row would hold an entry for the whole corpus.
      let hit = hits.get(wlEntry);
      if (hit) return hit;
      hit = null;
      const display = displayOf(wlEntry);
      if (typed?.test(wlEntry)) hit = SELF;
      else if (!passes || passes(wlEntry.norm) || mayShareRun(q.norm, wlEntry.norm)
        || (q.rhymes && rhymeMatch(q.rhymes, rhymesOf(display), scorer.K.rhymeFromStress)) || swaps?.(display)) {
        const e = prep({ norm: wlEntry.norm, display }, svc);
        e.sound = svc.sound(display);
        e.rhymes = rhymesOf(display);
        e.swap = svc.swap(display, words);
        const h = scorer.score(q, e, CUTOFF);
        if (h && h.loose <= CUTOFF) hit = { loose: h.loose };
      }
      if (hit) hits.set(wlEntry, hit);
      return hit;
    },
  };
}

const SELF = { loose: -1, self: true };

// Looseness as a 1–8 meter. Nineteen in twenty hits score 0.25 or more, so
// the low steps spread across that crowded end, while the top bars stay rare,
// as good twins are.
const LEVELS = [0.07, 0.14, 0.2, 0.25, 0.3, 0.35, 0.38];
const similarityLevel = loose => (loose == null ? 0 : 8 - LEVELS.filter(t => loose >= t).length);

export default {
  name: 'Twins', icon: '👯', category: 'pairs',
  desc: 'Curiously similar entries',
  tagline: 'Come and play with us',
  example: 'jacuzzi → j\'accuse',
  assets: ['cmudict', 'cmuSupplement', 'unigrams', 'twinsWordnet'],
  passes: [SPACING_PASS, MODEL_PASS, INDEX_PASS],
  dice: 'entry',
  diceStrong: 7,
  params: [{ placeholder: 'entry' }],
  kind: 'filter', input: 'highlight', output: 'plain',
  matchOn: 'both',
  isInert: params => !(params.entry || '').trim(),
  async prepare(params, ctx) {
    await loadCmuDict().catch(() => {});
    await wordnetAsset.load().catch(() => {});
    await loadSpacingCorpus();
    const spacing = await buildSpacingTable(ctx);
    const index = await corpusIndex(ctx, prepServices(ctx.vocab, spacing));
    return { slot: slotFor(params.entry.trim(), ctx, spacing, index, true) };
  },
  // A stream compiles its column before prepare loads the assets, so the
  // column follows the slot prepare leaves rather than keep the bare one.
  replay(params, ctx) {
    const text = (params.entry || '').trim();
    let slot = slotFor(text, ctx, spacingReader(ctx), ctx.cache.get(INDEX_KEY));
    return { get slot() { return (slot = slotsByCorpus.get(ctx.vocab)?.get(text) ?? slot); } };
  },
  run: (wlEntry, { slot }) => (slot.hitFor(wlEntry) ? [] : false),
  lead: ({ slot }) => slot.norm,
  column: {
    key: 'similarity', label: 'Similarity', defaultSort: 'desc', meter: 8,
    value: (wlEntry, { slot }) => { const hit = slot.hitFor(wlEntry); return hit?.self ? 'the typed entry' : similarityLevel(hit?.loose); },
    order: (wlEntry, { slot }) => -(slot.hitFor(wlEntry)?.loose ?? 9),
    width: () => 9,
  },
};
