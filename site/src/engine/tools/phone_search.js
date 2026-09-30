'use strict';

import { loadCmuDict, hasCmuDict, soundsOf } from '../phonetics.js';
import { alignWord, lettersForPhones } from '../phone-align.js';
import { hasUnigramCorpus, rankedSplits, SPACE_OUT_WINDOWS } from '../segmenter.js';
import { buildSpacingTable, loadSpacingCorpus, spacingReader } from '../space-out.js';
import { stripAccents } from '../norm.js';
import { SEARCH_KINDS } from '../search.js';
import { candidates } from '../morphology.js';

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

// An unreadable token ends the run: joining its neighbors would hear sounds
// across a gap the entry doesn't close.
function segmentsOf(display, spacing, wide = false) {
  const segments = [];
  let cur = [];
  for (const token of tokensOf(display)) {
    const units = unitsOf(token, spacing, wide);
    if (units) { cur.push(...units); continue; }
    if (cur.length) segments.push(cur);
    cur = [];
  }
  if (cur.length) segments.push(cur);
  return segments;
}

const MAX_READINGS = 16;

// Every way to say a segment, one pronunciation per word: [{ code, picks }],
// where picks[k] is the index into units[k].sounds.
function readingsOf(units) {
  let readings = [{ code: '', picks: [] }];
  for (const unit of units) {
    const next = [];
    for (const r of readings) {
      for (let s = 0; s < unit.sounds.length && next.length < MAX_READINGS; s++) {
        next.push({ code: r.code + unit.sounds[s].code, picks: [...r.picks, s] });
      }
    }
    readings = next;
  }
  return readings;
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

function rangesForHit(units, reading, a, b) {
  const out = [];
  let off = 0;
  for (let k = 0; k < units.length && off < b; k++) {
    const unit = units[k];
    const sound = unit.sounds[reading.picks[k]];
    const len = sound.phones.length;
    const lo = Math.max(a, off) - off, hi = Math.min(b, off + len) - off;
    if (lo < hi) {
      const span = lettersForPhones(alignmentOf(unit.letters, sound), lo, hi, unit.letters.length);
      if (span) out.push({ start: unit.at[span[0]], end: unit.at[span[1] - 1] + 1 });
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

// ─── Tool ────────────────────────────────────────────────────────────────────

function queryOf(text, spacing) {
  const segments = segmentsOf(text, spacing, true);
  if (segments.length !== 1) return { targets: [], words: [] };
  return {
    targets: [...new Set(readingsOf(segments[0]).map(r => r.code))],
    words: segments[0].map(unit => unit.letters),
  };
}

// The hit is the query's own words: it starts on a word, runs through whole words
// spelled as the query's, and ends inside one that is the last query word or an
// inflection of it (FIGURES, FIGURED). A split-out part counts as a word, so
// FIGURESKATING hides like FIGURE SKATING; CONFIGURE's match starts mid-word.
function isSearchWord(units, reading, a, b, words) {
  const len = k => units[k].sounds[reading.picks[k]].phones.length;
  let off = 0, k = 0;
  while (k < units.length && off < a) off += len(k++);
  if (off !== a || k + words.length > units.length) return false;
  for (let i = 0; i < words.length - 1; i++, k++) {
    if (units[k].letters !== words[i]) return false;
    off += len(k);
  }
  return b > off && b <= off + len(k) && candidates(units[k].letters).has(words[words.length - 1]);
}

const build = (params, spacing) => ({ ...queryOf((params.entry || '').trim(), spacing), hideSearch: !!params.hide, spacing });

export default {
  name: 'Phone search', icon: '📱', category: 'phonetic',
  desc: 'Entries that contain the sounds of the input',
  example: 'knee → honey, neon',
  assets: ['cmudict', 'unigrams'],
  params: [
    { placeholder: 'entry' },
    { key: 'hide', type: 'checkbox', label: 'Hide search words',
      title: "Don't show matches with the search term" },
  ],
  kind: 'filter', input: 'highlight', output: 'plain',
  matchOn: 'display',
  isInert: params => !(params.entry || '').trim(),
  async prepare(params, ctx) {
    await ensureDict();
    await loadSpacingCorpus();
    return build(params, await buildSpacingTable(ctx));
  },
  replay: (params, ctx) => build(params, spacingReader(ctx)),
  run(display, prepared) {
    if (!hasCmuDict() || !prepared.targets.length) return false;
    const ranges = [];
    let matched = false;
    for (const units of segmentsOf(display, prepared.spacing)) {
      for (const reading of readingsOf(units)) {
        for (const target of prepared.targets) {
          for (let at = reading.code.indexOf(target); at !== -1; at = reading.code.indexOf(target, at + 1)) {
            if (prepared.hideSearch && isSearchWord(units, reading, at, at + target.length, prepared.words)) continue;
            matched = true;
            ranges.push(...rangesForHit(units, reading, at, at + target.length));
          }
        }
      }
    }
    if (!matched) return false;
    return ranges.length ? mergeRanges(ranges) : true;
  },
};
