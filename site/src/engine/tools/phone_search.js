'use strict';

import { loadCmuDict, hasCmuDict, soundsOf } from '../phonetics.js';
import { alignmentOf, lettersForPhones } from '../phone-align.js';
import { tokensOf, itemsOf as readItems } from '../phone-reading.js';
import { buildSpacingTable, loadSpacingCorpus, spacingReader, SPACING_PASS } from '../space-out.js';
import { toNorm, displayOf, buildNormToDisplay } from '../norm.js';
import { SEARCH_KINDS } from '../search.js';
import { candidates } from '../morphology.js';
import { MATCH_PARAM, matchModeOf, isReplacing } from './shared.js';

async function ensureDict() {
  try {
    await loadCmuDict();
  } catch {
    throw new Error('Couldn’t load the pronunciation dictionary — check your connection.');
  }
}

// ─── Reading an entry aloud ──────────────────────────────────────────────────

const itemsOf = (display, spacing, wide = false) => readItems(display, spacing, soundsOf, wide);

const MAX_READINGS = 16;

// An unreadable word reads as one code unit no sound matches, so a run of
// sounds can't be heard across it.
const HOLE = '\u0001';

// Every way to say an entry, one pronunciation per word: [{ code, picks }],
// where picks[k] is the index into items[k].sounds.
function readingsOf(items) {
  let readings = [{ code: '', picks: [] }];
  for (const item of items) {
    if (!item) {
      readings = readings.map(r => ({ code: r.code + HOLE, picks: [...r.picks, -1] }));
      continue;
    }
    const next = [];
    for (const r of readings) {
      for (let s = 0; s < item.sounds.length && next.length < MAX_READINGS; s++) {
        next.push({ code: r.code + item.sounds[s].code, picks: [...r.picks, s] });
      }
    }
    readings = next;
  }
  return readings;
}

const lengthOf = (items, reading, k) => (items[k] ? items[k].sounds[reading.picks[k]].phones.length : 1);

function breaksOf(items, reading) {
  const breaks = [0];
  let off = 0;
  for (let k = 0; k < items.length; k++) breaks.push(off += lengthOf(items, reading, k));
  return breaks;
}

// ─── Highlighting ────────────────────────────────────────────────────────────

function rangesForHit(items, reading, a, b) {
  const out = [];
  let off = 0;
  for (let k = 0; k < items.length && off < b; k++) {
    const item = items[k];
    const len = lengthOf(items, reading, k);
    const lo = Math.max(a, off) - off, hi = Math.min(b, off + len) - off;
    if (item && lo < hi) {
      const sound = item.sounds[reading.picks[k]];
      const [s, e] = lettersForPhones(alignmentOf(item.letters, sound.phones), lo, hi, item.letters.length);
      out.push({ start: item.at[s], end: item.at[e - 1] + 1 });
    }
    off += len;
  }
  return out;
}

function mergeRanges(ranges) {
  ranges.sort((x, y) => x.start - y.start || x.end - y.end);
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out.map(r => ({ ...r, kind: SEARCH_KINDS[0] }));
}

// ─── Matching ────────────────────────────────────────────────────────────────

function queryOf(text, spacing) {
  const items = itemsOf(text, spacing, true);
  if (!items.length || items.includes(null)) return null;
  return {
    codes: [...new Set(readingsOf(items).map(r => r.code))],
    words: items.map(item => item.letters),
  };
}

// The hit is the query's own words: it starts on a word, runs through whole words
// spelled as the query's, and ends inside one that is the last query word or an
// inflection of it (FIGURES, FIGURED). A split-out part counts as a word, so
// FIGURESKATING hides like FIGURE SKATING; CONFIGURE's match starts mid-word.
function isSearchWord(items, reading, a, b, words) {
  let off = 0, k = 0;
  while (k < items.length && off < a) off += lengthOf(items, reading, k++);
  if (off !== a || k + words.length > items.length) return false;
  for (let i = 0; i < words.length - 1; i++, k++) {
    if (items[k]?.letters !== words[i]) return false;
    off += lengthOf(items, reading, k);
  }
  return !!items[k] && b > off && b <= off + lengthOf(items, reading, k)
    && candidates(items[k].letters).has(words[words.length - 1]);
}

function modeAllows(items, reading, mode) {
  const len = reading.code.length;
  const breaks = mode === 'word' || mode === 'span' ? breaksOf(items, reading) : null;
  return ({ start, end }) => {
    switch (mode) {
      case 'full':  return start === 0 && end === len;
      case 'start': return start === 0;
      case 'end':   return end === len;
      case 'word':  return breaks.includes(start) && breaks.includes(end);
      case 'span':  return breaks.some(b => start < b && b < end);
      default:      return true;
    }
  };
}

// Replacing keeps the search words: rewriting KNIGHT in KNIGHT SHIFT isn't noise.
function occurrencesOf(query, items, reading, mode, replacing = false) {
  const allows = modeAllows(items, reading, mode);
  const out = [];
  for (const target of query.codes) {
    for (let at = reading.code.indexOf(target); at !== -1; at = reading.code.indexOf(target, at + 1)) {
      const occ = { start: at, end: at + target.length };
      if (allows(occ) && (replacing || !isSearchWord(items, reading, occ.start, occ.end, query.words))) out.push(occ);
    }
  }
  return out;
}

// ─── Replacing ───────────────────────────────────────────────────────────────

// Search's replace-all semantics, or the two tools rewrite the same entry differently:
// leftmost first, longest at each start, none overlapping.
function pickMatches(matches) {
  matches.sort((x, y) => x.start - y.start || y.end - x.end);
  const picks = [];
  for (const m of matches) if (!picks.length || m.start >= picks[picks.length - 1].end) picks.push(m);
  return picks;
}

function splice(code, picks, rep) {
  let out = '', at = 0;
  const spans = [];
  for (const m of picks) {
    out += code.slice(at, m.start);
    spans.push([out.length, out.length + rep.length]);
    out += rep;
    at = m.end;
  }
  return { code: out + code.slice(at), spans };
}

function replacementsOf(text, spacing) {
  const items = itemsOf(text, spacing, true);
  if (!items.length) return [''];
  if (items.includes(null)) return null;
  return [...new Set(readingsOf(items).map(r => r.code))];
}

const INDEX_KEY = 'phone-search/index';
const INDEX_PASS = { key: INDEX_KEY, weight: 12 };
const BYTES_PER_INDEX_SLOT = 64;

async function soundIndex(ctx, spacing) {
  const cached = ctx.cache.get(INDEX_KEY);
  if (cached) return cached;
  const index = new Map();
  let bytes = 0;
  await ctx.forEach(ctx.wordlist.entries, wlEntry => {
    const display = displayOf(wlEntry);
    const items = itemsOf(display, spacing);
    if (!items.length || items.includes(null)) return;
    for (const { code } of readingsOf(items)) {
      const list = index.get(code);
      if (!list) index.set(code, [display]);
      else if (list[list.length - 1] !== display) list.push(display);
      else continue;
      bytes += BYTES_PER_INDEX_SLOT + 2 * code.length;
    }
  }, INDEX_PASS);
  ctx.cache.put(INDEX_KEY, index, bytes);
  return index;
}

// Norm coordinates: the executor emits every spelling of the norm, and display
// marks would land misplaced on a differently spaced one (THEIRS / THE IRS).
function toNormRanges(display, ranges) {
  const map = buildNormToDisplay(display);
  const at = x => { let i = 0; while (i < map.length && map[i] < x) i++; return i; };
  return ranges
    .map(r => ({ ...r, start: at(r.start), end: at(r.end), coord: 'norm' }))
    .filter(r => r.start < r.end);
}

function outputMarks(display, code, spans, spacing) {
  const items = itemsOf(display, spacing);
  const reading = readingsOf(items).find(r => r.code === code);
  if (!reading) return [];
  return toNormRanges(display, mergeRanges(spans.flatMap(([a, b]) => rangesForHit(items, reading, a, b))));
}

function runReplace(display, prepared) {
  const { query, mode, spacing, reps, index } = prepared;
  if (!reps) return [];
  const items = itemsOf(display, spacing);
  if (!items.some(Boolean)) return [];
  const self = toNorm(display);
  const outs = new Map();
  for (const reading of readingsOf(items)) {
    const picks = pickMatches(occurrencesOf(query, items, reading, mode, true));
    if (!picks.length) continue;
    let inputHighlights = null;
    for (const rep of reps) {
      const { code, spans } = splice(reading.code, picks, rep);
      for (const target of index.get(code) ?? []) {
        const norm = toNorm(target);
        if (norm === self || outs.has(norm)) continue;
        inputHighlights ??= mergeRanges(picks.flatMap(m => rangesForHit(items, reading, m.start, m.end)));
        outs.set(norm, { entry: target, inputHighlights, outputHighlights: rep ? outputMarks(target, code, spans, spacing) : [] });
      }
    }
  }
  return [...outs.values()];
}

// ─── Tool ────────────────────────────────────────────────────────────────────

const build = (params, spacing) => ({ query: queryOf(params.entry || '', spacing), mode: matchModeOf(params), spacing });

export default {
  name: 'Phone search', icon: '📱', category: 'phonetic',
  desc: 'Search (and replace) by sound',
  example: 'knee → honey, neon',
  assets: ['cmudict', 'unigrams'],
  passes: params => (isReplacing(params) ? [SPACING_PASS, INDEX_PASS] : [SPACING_PASS]),
  findReplace: true, replaceName: 'Phone replace',
  params: [
    { placeholder: 'entry' },
    { key: 'replace', placeholder: 'replace', encodeEmpty: true },
    MATCH_PARAM,
  ],
  kind: params => (isReplacing(params) ? 'transform' : 'filter'),
  input: 'highlight',
  output: params => (tokensOf(params.replace || '').length ? 'highlight' : 'plain'),
  glyph: params => (isReplacing(params) ? '→' : null),
  matchOn: 'display',
  isInert: params => !tokensOf(params.entry || '').length,
  async prepare(params, ctx) {
    await ensureDict();
    await loadSpacingCorpus();
    const spacing = await buildSpacingTable(ctx);
    const prepared = build(params, spacing);
    if (!isReplacing(params) || !prepared.query) return prepared;
    return { ...prepared, reps: replacementsOf(params.replace, spacing), index: await soundIndex(ctx, spacing) };
  },
  replay: (params, ctx) => build(params, spacingReader(ctx)),
  run(display, prepared) {
    if (!hasCmuDict() || !prepared.query) return false;
    if (prepared.index) return runReplace(display, prepared);
    const items = itemsOf(display, prepared.spacing);
    if (!items.some(Boolean)) return false;
    const ranges = [];
    for (const reading of readingsOf(items)) {
      for (const hit of occurrencesOf(prepared.query, items, reading, prepared.mode)) {
        ranges.push(...rangesForHit(items, reading, hit.start, hit.end));
      }
    }
    return ranges.length ? mergeRanges(ranges) : false;
  },
};
