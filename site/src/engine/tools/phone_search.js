'use strict';

import { loadCmuDict, hasCmuDict, soundsOf } from '../phonetics.js';
import { alignWord, lettersForPhones } from '../phone-align.js';
import { hasUnigramCorpus, rankedSplits, SPACE_OUT_WINDOWS } from '../segmenter.js';
import { buildSpacingTable, loadSpacingCorpus, spacingReader } from '../space-out.js';
import { stripAccents, toNorm, displayOf, buildNormToDisplay } from '../norm.js';
import { SEARCH_KINDS } from '../search.js';
import { candidates } from '../morphology.js';
import { buildHelpHTML } from '../../core/util.js';
import { MATCH_PARAM, matchModeOf, isReplacing } from './shared.js';

async function ensureDict() {
  try {
    await loadCmuDict();
  } catch {
    throw new Error('Couldn’t load the pronunciation dictionary — check your connection.');
  }
}

// ─── Reading an entry aloud ──────────────────────────────────────────────────

// Apostrophes join, or DON'T reads as DON plus a letter-name T. A digit makes the
// token unreadable: CMU has no numerals, and dropping them would read B52S as BS.
function tokensOf(display) {
  const tokens = [];
  let cur = null;
  const close = () => { if (cur) tokens.push(cur); cur = null; };
  for (let i = 0; i < display.length; i++) {
    const ch = display[i];
    if (ch === '\'' || ch === '’') continue;
    const folded = stripAccents(ch).toLowerCase();
    let letter = false;
    for (const c of folded) {
      if (c >= 'a' && c <= 'z') {
        cur ??= { letters: '', at: [], digits: false };
        cur.letters += c;
        cur.at.push(i);
        letter = true;
      } else if (c >= '0' && c <= '9') {
        cur ??= { letters: '', at: [], digits: false };
        cur.digits = true;
        letter = true;
      }
    }
    if (!letter) close();
  }
  close();
  return tokens;
}

// A lone letter from a split is the segmenter's escape hatch, not a word: CMU
// would read DEFOGGERS → DEFOGGE R S's R as its letter name and hear ARE in it.
const isWordPart = part => part.length > 1 || part === 'a' || part === 'i';

function unitsOfParts(token, parts) {
  const units = [];
  let off = 0;
  for (const part of parts) {
    if (!isWordPart(part)) return null;
    const sounds = soundsOf(part);
    if (!sounds) return null;
    units.push({ letters: part, at: token.at.slice(off, off + part.length), sounds });
    off += part.length;
  }
  return units;
}

function unitsOf(token, spacing, wide) {
  if (token.digits || !token.letters) return null;
  const sounds = soundsOf(token.letters);
  if (sounds) return [{ letters: token.letters, at: token.at, sounds }];
  const guess = spacing?.guess(token.letters);
  const units = guess && unitsOfParts(token, guess);
  if (units || !wide || !hasUnigramCorpus()) return units;
  // The typed input gets Rhymes' wider window: an input that can't be read is a
  // dead end with nothing on screen to say why.
  for (const parts of rankedSplits(token.letters, SPACE_OUT_WINDOWS.many, spacing.vocab).slice(0, 20)) {
    if (parts.length < 2) continue;
    const found = unitsOfParts(token, parts);
    if (found) return found;
  }
  return null;
}

function itemsOf(display, spacing, wide = false) {
  const items = [];
  for (const token of tokensOf(display)) items.push(...(unitsOf(token, spacing, wide) ?? [null]));
  return items;
}

const MAX_READINGS = 16;

// An unreadable word reads as one code unit no sound matches: a run of sounds
// can't be heard across it, but a `*` can step over it.
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

let alignCache = new Map();
const ALIGN_CACHE_MAX = 20_000;

function alignmentOf(letters, sound) {
  const key = letters + ' ' + sound.code;
  let steps = alignCache.get(key);
  if (!steps) {
    if (alignCache.size > ALIGN_CACHE_MAX) alignCache = new Map();
    steps = alignWord(letters, sound.phones).steps;
    alignCache.set(key, steps);
  }
  return steps;
}

function rangesForHit(items, reading, a, b) {
  const out = [];
  let off = 0;
  for (let k = 0; k < items.length && off < b; k++) {
    const item = items[k];
    const len = lengthOf(items, reading, k);
    const lo = Math.max(a, off) - off, hi = Math.min(b, off + len) - off;
    if (item && lo < hi) {
      const sound = item.sounds[reading.picks[k]];
      const [s, e] = lettersForPhones(alignmentOf(item.letters, sound), lo, hi, item.letters.length);
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

// The query splits on `*` into pieces, each read as whole words: `pho*` is the
// word PHO and a gap. A gap at either end frees that end from the match mode's
// anchor, so `knee*` on Whole entry finds entries that start with the sound.
function queryOf(text, spacing) {
  const parts = text.split('*');
  const pieces = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const items = itemsOf(part, spacing, true);
    if (!items.length || items.includes(null)) return null;
    pieces.push({
      codes: [...new Set(readingsOf(items).map(r => r.code))],
      words: items.map(item => item.letters),
    });
  }
  if (!pieces.length) return null;
  return { pieces, leading: !parts[0].trim(), trailing: !parts[parts.length - 1].trim() };
}

// The hit is the piece's own words: it starts on a word, runs through whole words
// spelled as the piece's, and ends inside one that is the last piece word or an
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

// Replacing keeps the search words: rewriting KNIGHT in KNIGHT SHIFT isn't noise.
function occurrencesOf(piece, items, reading, replacing) {
  const out = [];
  for (const target of piece.codes) {
    for (let at = reading.code.indexOf(target); at !== -1; at = reading.code.indexOf(target, at + 1)) {
      const end = at + target.length;
      if (replacing || !isSearchWord(items, reading, at, end, piece.words)) out.push({ start: at, end });
    }
  }
  return out;
}

function anchorsOf(items, reading, mode) {
  const len = reading.code.length;
  const breaks = mode === 'word' || mode === 'span' ? breaksOf(items, reading) : null;
  return {
    startsOK: x => (mode === 'full' ? x === 0 : mode === 'word' ? breaks.includes(x) : true),
    endsOK: x => (mode === 'full' ? x === len : mode === 'word' ? breaks.includes(x) : true),
    spansOK: (s, e) => mode !== 'span' || breaks.some(b => s < b && b < e),
  };
}

function occurrencesPerPiece(items, reading, query, replacing = false) {
  const occs = [];
  for (const piece of query.pieces) {
    const found = occurrencesOf(piece, items, reading, replacing);
    if (!found.length) return null;
    occs.push(found);
  }
  return occs;
}

// Every piece occurrence that lies on some complete match. A forward pass finds
// the earliest start a chain of pieces can reach each occurrence from, and a
// backward pass the latest end it can go on to. Spans words needs a break
// between the two, and the widest start and end give it the most room.
function hitsIn(items, reading, query, mode) {
  const occs = occurrencesPerPiece(items, reading, query);
  if (!occs) return [];
  const len = reading.code.length;
  const { startsOK, endsOK, spansOK } = anchorsOf(items, reading, mode);
  const last = occs.length - 1;

  const from = occs.map(o => o.map(() => Infinity));
  occs[0].forEach((o, j) => {
    if (query.leading) from[0][j] = 0;
    else if (startsOK(o.start)) from[0][j] = o.start;
  });
  for (let i = 1; i <= last; i++) {
    occs[i].forEach((o, j) => occs[i - 1].forEach((p, q) => {
      if (p.end <= o.start) from[i][j] = Math.min(from[i][j], from[i - 1][q]);
    }));
  }

  const to = occs.map(o => o.map(() => -Infinity));
  occs[last].forEach((o, j) => {
    if (query.trailing) to[last][j] = len;
    else if (endsOK(o.end)) to[last][j] = o.end;
  });
  for (let i = last - 1; i >= 0; i--) {
    occs[i].forEach((o, j) => occs[i + 1].forEach((n, q) => {
      if (n.start >= o.end) to[i][j] = Math.max(to[i][j], to[i + 1][q]);
    }));
  }

  const hits = [];
  occs.forEach((o, i) => o.forEach((occ, j) => {
    const s = from[i][j], e = to[i][j];
    if (s === Infinity || e === -Infinity || !spansOK(s, e)) return;
    hits.push(occ);
  }));
  return hits;
}

// ─── Replacing ───────────────────────────────────────────────────────────────

const MAX_MATCHES = 64;

function matchesIn(items, reading, query, mode) {
  const occs = occurrencesPerPiece(items, reading, query, true);
  if (!occs) return [];
  const len = reading.code.length;
  const { startsOK, endsOK, spansOK } = anchorsOf(items, reading, mode);
  const matches = [];
  const extend = chain => {
    if (matches.length >= MAX_MATCHES) return;
    if (chain.length === occs.length) {
      const start = query.leading ? 0 : chain[0].start;
      const end = query.trailing ? len : chain[chain.length - 1].end;
      if (startsOK(start) && endsOK(end) && spansOK(start, end)) matches.push({ start, end, occs: chain });
      return;
    }
    const prev = chain[chain.length - 1];
    for (const o of occs[chain.length]) if (!prev || o.start >= prev.end) extend([...chain, o]);
  };
  extend([]);
  return matches;
}

// Search's replace-all semantics, or the two tools rewrite the same entry differently:
// leftmost first, longest at each start (a greedy `*`), none overlapping.
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
  });
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
    const picks = pickMatches(matchesIn(items, reading, query, mode));
    if (!picks.length) continue;
    let inputHighlights = null;
    for (const rep of reps) {
      const { code, spans } = splice(reading.code, picks, rep);
      for (const target of index.get(code) ?? []) {
        const norm = toNorm(target);
        if (norm === self || outs.has(norm)) continue;
        inputHighlights ??= mergeRanges(picks.flatMap(m => m.occs.flatMap(o => rangesForHit(items, reading, o.start, o.end))));
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
  findReplace: true, replaceName: 'Phone replace',
  params: [
    { placeholder: 'entry', help: buildHelpHTML([['*', 'any sounds']]) },
    { key: 'replace', placeholder: 'replace', encodeEmpty: true },
    MATCH_PARAM,
  ],
  kind: params => (isReplacing(params) ? 'transform' : 'filter'),
  input: 'highlight',
  output: params => (tokensOf(params.replace || '').length ? 'highlight' : 'plain'),
  glyph: params => (isReplacing(params) ? '→' : null),
  matchOn: 'display',
  isInert: params => !/[^\s*]/.test(params.entry || ''),
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
      for (const hit of hitsIn(items, reading, prepared.query, prepared.mode)) {
        ranges.push(...rangesForHit(items, reading, hit.start, hit.end));
      }
    }
    return ranges.length ? mergeRanges(ranges) : false;
  },
};
