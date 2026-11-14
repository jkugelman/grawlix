'use strict';

import { loadCmuDict, hasCmuDict, coalescedWithY } from '../phonetics.js';
import { alignmentOf, lettersForPhones } from '../phone-align.js';
import { itemsOf as readItems, tableSplits, soundsOrSpelled } from '../phone-reading.js';
import { buildSpacingTable, loadSpacingCorpus, spacingReader, SPACING_PASS } from '../space-out.js';
import { parsePhoneQuery, compileAlts, occurrencesIn, codeOf, codesOfName, sourceOf, HOLE, bucketKey, bucketOfSet, wholeSource } from '../phone-dialect.js';
import { translatePhoneQuery, queryWordReader, wordAtoms } from '../phone-query.js';
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

const itemsOf = (display, spacing) => readItems(display, tableSplits(spacing), soundsOrSpelled);

const MAX_READINGS = 16;

// CATCH YOU's "catchoo" reading belongs here, not in the query's sounds: it's how
// the entry is said, and a query fold for it would show on every query's line.
function readingsOf(items) {
  let readings = [{ code: '', sounds: [] }];
  for (const item of items) {
    if (!item) {
      readings = readings.map(r => ({ code: r.code + HOLE, sounds: [...r.sounds, null] }));
      continue;
    }
    const next = [];
    for (const r of readings) {
      for (const sound of item.sounds) {
        if (next.length < MAX_READINGS) next.push({ code: r.code + sound.code, sounds: [...r.sounds, sound] });
        const joined = joinedWithY(r, sound, item.letters);
        if (joined && next.length < MAX_READINGS) next.push(joined);
      }
    }
    readings = next;
  }
  return readings;
}

const soundOf = toks => ({ toks, phones: toks.map(t => t.replace(/\d$/, '')), code: toks.map(codeOf).join('') });

function joinedWithY(reading, sound, word) {
  const before = reading.sounds[reading.sounds.length - 1];
  const merged = before && sound.toks[0] === 'Y' && sound.toks.length > 1 && coalescedWithY(before.toks.at(-1), word);
  if (!merged) return null;
  const joinedBefore = soundOf([...before.toks.slice(0, -1), merged]);
  const rest = soundOf(sound.toks.slice(1));
  const sounds = [...reading.sounds.slice(0, -1), joinedBefore, rest];
  return { code: reading.code.slice(0, -before.code.length) + joinedBefore.code + rest.code, sounds };
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

// The query is translated to the sound dialect and only that text is compiled, so
// what the assist panel shows is exactly what runs.
function queryOf(text, spacing) {
  const reader = queryWordReader(spacing);
  const translated = translatePhoneQuery(text, reader);
  if (translated.error || !translated.text) return null;
  return { matchers: compileAlts(parsePhoneQuery(translated.text).alts), text: translated.text, words: typedWords(text, reader) };
}

// The words of each alternative typed as words alone, for hiding the query's own
// words. Not for sounds: there's no word to hide, which makes this the one way a
// pasted translation searches differently from the words it came from.
function typedWords(text, reader) {
  return parsePhoneQuery(text).alts
    .filter(({ before, body, after }) => !before.length && !after.length && body.length === 1 && body[0].type === 'word')
    .map(({ body }) => reader(body[0].text).items.map(item => item.letters));
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

function modeEnds(read, reading, mode) {
  const len = reading.code.length;
  if (mode === 'full' || mode === 'end') return () => [len];
  if (mode !== 'word') return () => [];
  const desc = breaksOf(read, reading).reverse();
  return () => desc;
}

// A sound search that returns the typed word is noise, and under Whole entry hiding
// it is what turns the search into a homophone finder. Replacing keeps it:
// rewriting KNIGHT in KNIGHT SHIFT isn't noise.
function occurrencesOf(query, read, reading, mode, hide = false) {
  const found = occurrencesIn(query.matchers, reading.code, modeAllows(read, reading, mode), modeEnds(read, reading, mode));
  if (!hide || !query.words.length) return found;
  return found.filter(o => !query.words.some(words => isSearchWord(read.items, reading, o.start, o.end, words)));
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

const atomCodes = new Map();
const codesOfAtom = atom => {
  let codes = atomCodes.get(atom);
  if (!codes) atomCodes.set(atom, codes = parsePhoneQuery(atom).alts[0].body[0].codes);
  return codes;
};

// The untouched rest of the entry is heard the way a typed word is, or ARE → blank
// would leave ARBITER's unstressed -biter unable to meet BITTER.
// `cotFinal` marks a word's last AA or AO, heard as [AA AO]: the merger stops before
// an R, and once spliced, an R can land right after it.
const heardSets = reading => reading.sounds.flatMap(sound => wordAtoms(sound.toks).map((atom, k) => ({
  codes: codesOfAtom(atom),
  cotFinal: k === sound.toks.length - 1 && /^A[AO]\d$/.test(sound.toks[k]),
})));

const R_CODES = codesOfName('R'), AO_CODES = codesOfName('AO');
const isR = codes => codes.size === 1 && R_CODES.has([...codes][0]);

function spliceSets(heard, picks, rep) {
  const parts = [], spans = [];
  let at = 0, count = 0;
  const pushSets = list => { for (const it of list) { parts.push({ ...it }); count++; } };
  for (const m of picks) {
    pushSets(heard.slice(at, m.start));
    if (rep.before) parts.push({ look: rep.before });
    spans.push([count, count + rep.sets.length]);
    pushSets(rep.sets.map(codes => ({ codes })));
    if (rep.after) parts.push({ look: rep.after });
    at = m.end;
  }
  pushSets(heard.slice(at));
  const sets = parts.filter(it => it.codes);
  sets.forEach((it, i) => {
    if (it.cotFinal && sets[i + 1] && isR(sets[i + 1].codes)) it.codes = new Set([...it.codes].filter(c => !AO_CODES.has(c)));
  });
  return { parts, sets: sets.map(it => it.codes), spans };
}

// The replacement's alternatives: { sets, before, after }, its contexts as
// lookaround sources for the spliced pattern.
function replacementsOf(text, spacing) {
  if (!text.trim()) return [{ sets: [], before: '', after: '' }];
  const translated = translatePhoneQuery(text, queryWordReader(spacing), { replacement: true });
  if (translated.error || !translated.text) return null;
  return parsePhoneQuery(translated.text, { replacement: true }).alts.map(alt => ({
    sets: alt.body.map(el => el.codes),
    before: alt.before.length ? `(?<${alt.beforeNot ? '!' : '='}${sourceOf(alt.before)})` : '',
    after: alt.after.length ? `(?${alt.afterNot ? '!' : '='}${sourceOf(alt.after)})` : '',
  }));
}

const INDEX_KEY = 'phone-search/index';
const INDEX_PASS = { key: INDEX_KEY, weight: 12 };
const BYTES_PER_INDEX_SLOT = 96;

// Whole-entry readings keyed coarsely (bucketKey), so a spliced pattern whose sets
// each sit in one bucket looks up its candidates; any other pattern scans the
// readings of its length. Candidates are always checked against the pattern.
async function soundIndex(ctx, spacing) {
  const cached = ctx.cache.get(INDEX_KEY);
  if (cached) return cached;
  const byKey = new Map(), byLength = new Map();
  let bytes = 0;
  await ctx.forEach(ctx.wordlist.entries, wlEntry => {
    const display = displayOf(wlEntry);
    const { items } = itemsOf(display, spacing);
    if (!items.length || items.includes(null)) return;
    const seen = new Set();
    for (const { code } of readingsOf(items)) {
      if (seen.has(code)) continue;
      seen.add(code);
      const slot = { display, code };
      const key = bucketKey(code);
      const list = byKey.get(key);
      if (list) list.push(slot); else byKey.set(key, [slot]);
      const sameLength = byLength.get(code.length);
      if (sameLength) sameLength.push(slot); else byLength.set(code.length, [slot]);
      bytes += BYTES_PER_INDEX_SLOT + 2 * code.length;
    }
  }, INDEX_PASS);
  const index = { byKey, byLength };
  ctx.cache.put(INDEX_KEY, index, bytes);
  return index;
}

function candidatesFor(index, sets) {
  const buckets = sets.map(bucketOfSet);
  if (buckets.every(b => b !== null)) return index.byKey.get(buckets.join('|')) ?? [];
  return index.byLength.get(sets.length) ?? [];
}

// Norm coordinates: the executor emits every spelling of the norm, and display
// marks would land misplaced on a differently spaced one (THEIRS / THE IRS).
function toNormRanges(display, ranges) {
  const map = buildNormToDisplay(display);
  const at = x => { let i = 0; while (i < map.length && map.charCodeAt(i) < x) i++; return i; };
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
  if (!items.length || items.includes(null)) return [];
  const self = toNorm(display);
  const outs = new Map();
  for (const reading of readingsOf(items)) {
    const picks = pickMatches(occurrencesOf(query, read, reading, mode));
    if (!picks.length) continue;
    const heard = heardSets(reading);
    let inputHighlights = null;
    for (const rep of reps) {
      const { parts, sets, spans } = spliceSets(heard, picks, rep);
      if (!sets.length) continue;
      const pattern = new RegExp(wholeSource(parts));
      for (const { display: target, code } of candidatesFor(index, sets)) {
        const norm = toNorm(target);
        if (norm === self || outs.has(norm) || !pattern.test(code)) continue;
        inputHighlights ??= mergeRanges(picks.flatMap(m => rangesForHit(items, reading, m.start, m.end)));
        outs.set(norm, { entry: target, inputHighlights, outputHighlights: rep.sets.length ? outputMarks(target, code, spans, spacing) : [] });
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
  assets: ['cmudict', 'cmuSupplement', 'unigrams'],
  passes: params => (isReplacing(params) ? [SPACING_PASS, INDEX_PASS] : [SPACING_PASS]),
  findReplace: true, replaceName: 'Phone replace',
  params: [
    { key: 'entry', placeholder: 'words', assist: 'phone', raw: true },
    { key: 'replace', placeholder: 'replace', encodeEmpty: true, assist: 'phone-replace', raw: true },
    MATCH_PARAM,
  ],
  kind: params => (isReplacing(params) ? 'transform' : 'filter'),
  input: 'highlight',
  output: params => ((params.replace || '').trim() ? 'highlight' : 'plain'),
  glyph: params => (isReplacing(params) ? '→' : null),
  matchOn: 'display',
  isInert: params => {
    const text = (params.entry || '').trim();
    return !text || !!parsePhoneQuery(text).error
      || (isReplacing(params) && !!parsePhoneQuery(params.replace, { replacement: true }).error);
  },
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
      for (const hit of occurrencesOf(prepared.query, read, reading, prepared.mode, true)) {
        ranges.push(...rangesForHit(items, reading, hit.start, hit.end));
      }
    }
    return ranges.length ? mergeRanges(ranges) : false;
  },
};
