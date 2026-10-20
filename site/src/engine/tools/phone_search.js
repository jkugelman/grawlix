'use strict';

import { loadCmuDict, hasCmuDict, soundsOf, spelledSoundsOf, phoneCode, looseVowelsOf, coalescedWithY } from '../phonetics.js';
import { wordKinds } from '../rule-query.js';
import { alignmentOf, lettersForPhones } from '../phone-align.js';
import { tokensOf, itemsOf as readItems, tableSplits, widerSplits } from '../phone-reading.js';
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

const itemsOf = (display, spacing, wide = false) =>
  readItems(display, (wide ? widerSplits : tableSplits)(spacing), lookup);

// Past five letters, the all-caps words CMU lacks are mostly said as words: CAPTCHA,
// README, QWERTY, CRISPR. Shorter ones are mostly spelled out, COVID aside.
const MAX_SPELLED = 5;

// After CMU, so NASA keeps its word reading; before the segmenter, which would read
// NCAA as anything but its letters.
function lookup(letters, written) {
  const sounds = soundsOf(letters);
  if (sounds || !written || !wordKinds(written).includes('initialism')) return sounds;
  const plural = written.endsWith('s') && written !== written.toUpperCase();
  return letters.length - plural <= MAX_SPELLED ? spelledSoundsOf(letters, plural) : null;
}

const MAX_READINGS = 16;

// An unreadable word reads as one code unit no sound matches, so a run of
// sounds can't be heard across it.
const HOLE = '\u0001';

// Every way to say an entry, one pronunciation per word: [{ code, sounds }], where
// sounds[k] is how items[k] is said, null for a hole. The plain readings come
// first and are capped on their own, so the folded ones never crowd out a
// reading that matched before the folds existed.
function readingsOf(items) {
  const plain = productOf(items, sound => sound.plain);
  const codes = new Set(plain.map(r => r.code));
  return [...plain, ...foldedOf(items).filter(r => !codes.has(r.code))];
}

const foldedOf = items => productOf(items, sound => sound.folded, true);

function productOf(items, keep, connected = false) {
  let readings = [{ code: '', sounds: [] }];
  for (const item of items) {
    if (!item) {
      readings = readings.map(r => ({ code: r.code + HOLE, sounds: [...r.sounds, null] }));
      continue;
    }
    const next = [];
    for (const r of readings) {
      for (const sound of item.sounds) {
        if (!keep(sound)) continue;
        if (next.length < MAX_READINGS) next.push({ code: r.code + sound.code, sounds: [...r.sounds, sound] });
        const joined = connected && joinedWithY(r, sound, item.letters);
        if (joined && next.length < MAX_READINGS) next.push(joined);
      }
    }
    readings = next;
  }
  return readings;
}

function joinedWithY(reading, sound, word) {
  const before = reading.sounds[reading.sounds.length - 1];
  const merged = before && sound.phones[0] === 'Y' && sound.phones.length > 1
    && coalescedWithY(before.phones[before.phones.length - 1], word);
  if (!merged) return null;
  const end = phoneCode(merged);
  const joinedBefore = { ...before, phones: [...before.phones.slice(0, -1), merged], code: before.code.slice(0, -1) + end };
  const rest = { ...sound, phones: sound.phones.slice(1), code: sound.code.slice(1), stress: sound.stress.slice(1) };
  return { code: reading.code.slice(0, -1) + end + rest.code, sounds: [...reading.sounds.slice(0, -1), joinedBefore, rest] };
}

const lengthOf = (reading, k) => reading.sounds[k]?.phones.length ?? 1;

function breaksOf({ items, starts }, reading) {
  const breaks = [0];
  let off = 0;
  for (let k = 0; k < items.length; k++) {
    off += lengthOf(reading, k);
    if (k === items.length - 1 || starts[k + 1]) breaks.push(off);
  }
  return breaks;
}

// ─── Highlighting ────────────────────────────────────────────────────────────

function rangesForHit(items, reading, a, b) {
  const out = [];
  let off = 0;
  for (let k = 0; k < items.length && off < b; k++) {
    const item = items[k];
    const len = lengthOf(reading, k);
    const lo = Math.max(a, off) - off, hi = Math.min(b, off + len) - off;
    if (item && lo < hi) {
      const [s, e] = lettersForPhones(alignmentOf(item.letters, reading.sounds[k].phones), lo, hi, item.letters.length);
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

// CMU ends TABBY on IY but has the vowel of STABBING and BLACK INK as IH, which
// many speakers say as IY before NG. Only there: elsewhere IH is short, and
// MONEY would match FEMINIST. Not before NG G in one word either, where it stays
// short: TOUGHIE isn't heard in LIFT A FINGER.
function ingCodesOf(readings) {
  const IY = phoneCode('IY'), IH = phoneCode('IH');
  return readings.flatMap(({ code, sounds }) =>
    (code.endsWith(IY) && sounds[sounds.length - 1].stress.endsWith('0') ? [code.slice(0, -1) + IH] : []));
}

const literal = code => [...code].map(ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');

// Only the folded readings hear the query's secondary vowels loosely (looseVowelsOf), so
// they're built on their own: readingsOf drops a folded reading spelled like a plain
// one, and ACHOO's would go.
function looseSourceOf({ code, sounds }) {
  let src = '', at = 0;
  sounds.forEach(({ phones, stress }) => {
    phones.forEach((phone, i) => {
      const heard = looseVowelsOf(phone, stress[i]);
      src += heard ? `[${heard.map(p => literal(phoneCode(p))).join('')}]` : literal(code[at]);
      at++;
    });
  });
  return src;
}

const compile = sources => [...new Set(sources)].map(src => new RegExp(src, 'g'));

function queryOf(text, spacing) {
  const { items } = itemsOf(text, spacing, true);
  if (!items.length || items.includes(null)) return null;
  const readings = readingsOf(items);
  return {
    patterns: compile([
      ...productOf(items, sound => sound.plain).map(r => literal(r.code)),
      ...foldedOf(items).map(looseSourceOf),
    ]),
    ingPatterns: compile(ingCodesOf(readings).map(literal)),
    words: items.map(item => item.letters),
  };
}

// The hit is the query's own words: it starts on a word, runs through whole words
// spelled as the query's, and ends inside one that is the last query word or an
// inflection of it (FIGURES, FIGURED). A split-out part counts as a word, so
// FIGURESKATING hides like FIGURE SKATING; CONFIGURE's match starts mid-word.
function isSearchWord(items, reading, a, b, words) {
  let off = 0, k = 0;
  while (k < items.length && off < a) off += lengthOf(reading, k++);
  if (off !== a || k + words.length > items.length) return false;
  for (let i = 0; i < words.length - 1; i++, k++) {
    if (items[k]?.letters !== words[i]) return false;
    off += lengthOf(reading, k);
  }
  return !!items[k] && b > off && b <= off + lengthOf(reading, k)
    && candidates(items[k].letters).has(words[words.length - 1]);
}

function modeAllows(read, reading, mode) {
  const len = reading.code.length;
  const breaks = mode === 'word' || mode === 'span' ? breaksOf(read, reading) : null;
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
function occurrencesOf(query, read, reading, mode, replacing = false) {
  const { items } = read;
  const allows = modeAllows(read, reading, mode);
  const NG = phoneCode('NG'), G = phoneCode('G');
  const out = [];
  const scan = (patterns, fits) => {
    for (const re of patterns) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(reading.code)); re.lastIndex = m.index + 1) {
        const occ = { start: m.index, end: m.index + m[0].length };
        if (fits(occ) && allows(occ) && (replacing || !isSearchWord(items, reading, occ.start, occ.end, query.words))) out.push(occ);
      }
    }
  };
  scan(query.patterns, () => true);
  scan(query.ingPatterns, ({ end }) => reading.code[end] === NG
    && (reading.code[end + 1] !== G || breaksOf(read, reading).includes(end + 1)));
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
  const { items } = itemsOf(text, spacing, true);
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
    const { items } = itemsOf(display, spacing);
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
  const { items } = itemsOf(display, spacing);
  const reading = readingsOf(items).find(r => r.code === code);
  if (!reading) return [];
  return toNormRanges(display, mergeRanges(spans.flatMap(([a, b]) => rangesForHit(items, reading, a, b))));
}

function runReplace(display, prepared) {
  const { query, mode, spacing, reps, index } = prepared;
  if (!reps) return [];
  const read = itemsOf(display, spacing);
  const { items } = read;
  if (!items.some(Boolean)) return [];
  const self = toNorm(display);
  const outs = new Map();
  for (const reading of readingsOf(items)) {
    const picks = pickMatches(occurrencesOf(query, read, reading, mode, true));
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
    const read = itemsOf(display, prepared.spacing);
    const { items } = read;
    if (!items.some(Boolean)) return false;
    const ranges = [];
    for (const reading of readingsOf(items)) {
      for (const hit of occurrencesOf(prepared.query, read, reading, prepared.mode)) {
        ranges.push(...rangesForHit(items, reading, hit.start, hit.end));
      }
    }
    return ranges.length ? mergeRanges(ranges) : false;
  },
};
