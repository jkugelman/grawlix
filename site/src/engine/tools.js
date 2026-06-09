'use strict';

// ─── Tool catalog & tool helpers ─────────────────────────────────────────────

import { toNorm, displayOf } from './norm.js';
import { buildSearchPattern } from './search.js';
import {
  analyzeRegexPattern, wrapRuns, parseReplacement,
  regexExecAll, runRegexReplace, runSearchReplace,
} from './regex.js';
import {
  SPACE_OUT_WINDOWS, loadUnigramCorpus, rankedSplits, hasUnigramCorpus,
} from './segmenter.js';
import { buildHelpHTML } from '../core/util.js';

export const TOOL_CATEGORIES = [
  { id: 'anagram',    label: 'Anagram' },
  { id: 'bank',       label: 'Bank' },
  { id: 'halves',     label: 'Halves' },
  { id: 'letters',    label: 'Letters' },
  { id: 'pairs',      label: 'Pairs' },
  { id: 'palindrome', label: 'Palindrome' },
  { id: 'phrase',     label: 'Phrase' },
  { id: 'search',     label: 'Search' },
  { id: 'side',       label: 'Side' },
];

export const FEATURED_TOOLS = ['regex', 'anagrams', 'letter_bank', 'palindromes', 'initialisms', 'behead'];

export const WHOLE_WORD_PARAM = { key: 'whole-word', type: 'checkbox', label: 'Whole word', title: 'Whole word (Alt-W)' };

export const TOOLS = {
  anagrams: {
    name: 'Anagrams', icon: '🔀', category: 'anagram',
    desc: 'Same letters, rearranged',
    example: 'ELVIS → LIVES',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    prepare(params) { return sortLetters(params.entry); },
    run(entry, target, wordlist) {
      if (!target) return true;
      return sortLetters(entry) === target;
    },
    group: {
      key: entry => sortLetters(entry),
      columns: [
        { label: 'Letters', value: g => g.key.length },
      ],
    },
  },
  letter_bank: {
    name: 'Letter bank', icon: '🏦', category: 'bank',
    desc: 'Uses every letter at least once',
    example: 'SPOT → STOOPS, TOPS, POSTOP',
    params: [{ placeholder: 'letters' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    isInert: params => !((params && params.letters || '').trim()),
    prepare(params) { return new Set(params.letters.trim()); },
    run(entry, alphabet, wordlist) {
      if (alphabet.size === 0) return true;
      const present = new Set();
      for (const ch of entry) {
        if (!alphabet.has(ch)) return false;
        present.add(ch);
      }
      return present.size === alphabet.size;
    },
    group: {
      key: entry => [...new Set(entry)].sort().join(''),
      columns: [
        { label: 'Letters', value: g => g.key.length },
      ],
    },
  },
  restricted_alphabet: {
    name: 'Restricted alphabet', icon: '🔡', category: 'bank',
    desc: 'Uses only the given letters',
    example: 'SPOT → STOOP, TOP, POP',
    params: [{ placeholder: 'letters' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    isInert: params => !((params && params.letters || '').trim()),
    prepare(params) { return new Set(params.letters.trim()); },
    run(entry, alphabet, wordlist) {
      for (const ch of entry) if (!alphabet.has(ch)) return false;
      return true;
    },
  },
  scrabble: {
    name: 'Scrabble', icon: '🧱', category: 'bank',
    desc: 'Can be spelled with the given tiles',
    example: 'PARENTAL → PLANE, RENT',
    params: [{ key: 'tiles', placeholder: 'tiles' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    isInert: params => !((params && params.tiles || '').trim()),
    prepare(params) {
      const bank = new Map();
      for (const ch of params.tiles.trim()) bank.set(ch, (bank.get(ch) || 0) + 1);
      return bank;
    },
    run(entry, bank, wordlist) {
      const used = new Map();
      for (const ch of entry) {
        const n = (used.get(ch) || 0) + 1;
        if (n > (bank.get(ch) || 0)) return false;
        used.set(ch, n);
      }
      return true;
    },
  },
  repeaters: {
    name: 'Repeaters', icon: '🔂', category: 'halves',
    desc: 'Left and right halves are the same',
    example: 'TARTAR · HOTSHOTS',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      const n = entry.length;
      if (n < 2 || n % 2 !== 0) return false;
      const half = n / 2;
      return entry.slice(0, half) === entry.slice(half);
    },
  },
  neckouts: {
    name: 'Neckouts', icon: '🦒', category: 'halves',
    desc: 'Left and right halves are anagrams',
    example: 'STUCKONESNECKOUT',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      const n = entry.length;
      if (n < 2 || n % 2 !== 0) return false;
      const half = n / 2;
      const left = entry.slice(0, half);
      const right = entry.slice(half);
      if (left === right) return false;
      return sortLetters(left) === sortLetters(right);
    },
  },
  isograms: {
    name: 'Isograms', icon: '1️⃣', category: 'letters',
    desc: 'No repeated letter',
    example: 'CYBERPUNK · JUXTAPOSE',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      const seen = new Set();
      for (const ch of entry) {
        if (ch < 'a' || ch > 'z') continue;
        if (seen.has(ch)) return false;
        seen.add(ch);
      }
      return true;
    },
  },
  supervocalics: {
    name: 'Supervocalics', icon: '🌈', category: 'letters',
    desc: 'Each of A E I O U exactly once',
    example: 'AIRQUOTE · EUPHORIA',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      let a = 0, e = 0, i = 0, o = 0, u = 0;
      for (const ch of entry) {
        if (ch === 'a') a++;
        else if (ch === 'e') e++;
        else if (ch === 'i') i++;
        else if (ch === 'o') o++;
        else if (ch === 'u') u++;
      }
      return a === 1 && e === 1 && i === 1 && o === 1 && u === 1;
    },
  },
  monovocalics: {
    name: 'Monovocalics', icon: '👩‍🎤', category: 'letters',
    desc: 'Only one distinct vowel',
    example: 'TOOCOOLFORSCHOOL',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      let vowel = '';
      let prevWasLetter = false;
      for (const ch of entry) {
        if (ch < 'a' || ch > 'z') { prevWasLetter = false; continue; }
        let v = '';
        if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u') v = ch;
        else if (ch === 'y' && prevWasLetter) v = 'y';
        if (v) {
          if (!vowel) vowel = v;
          else if (v !== vowel) return false;
        }
        prevWasLetter = true;
      }
      return !!vowel;
    },
  },
  alphabetical: {
    name: 'Alphabetical', icon: '📈', category: 'letters',
    desc: 'Letters in alphabetical order',
    example: 'CHINTZ · KNOTTY',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      let prev = null;
      for (const ch of entry) {
        if (ch < 'a' || ch > 'z') continue;
        if (prev && ch < prev) return false;
        prev = ch;
      }
      return true;
    },
  },
  reverse_alphabetical: {
    name: 'Reverse alphabetical', icon: '📉', category: 'letters',
    desc: 'Letters in reverse alphabetical order',
    example: 'SPOOFED · YUPPIE',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      let prev = null;
      for (const ch of entry) {
        if (ch < 'a' || ch > 'z') continue;
        if (prev && ch > prev) return false;
        prev = ch;
      }
      return true;
    },
  },
  consonantcy: {
    name: 'Consonantcy', icon: '🦴', category: 'letters',
    desc: 'Same consonants in order; vowels may differ',
    example: 'ISAIDNO → SODONE',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    prepare(params) { return consonantSkeleton(params.entry); },
    run(entry, skeleton, wordlist) {
      if (!skeleton) return true;
      return consonantSkeleton(entry) === skeleton;
    },
    group: {
      key: entry => consonantSkeleton(entry),
      columns: [
        { label: 'Consonants', value: g => g.key.length },
      ],
    },
  },
  vowelcy: {
    name: 'Vowelcy', icon: '🅰️', category: 'letters',
    desc: 'Same vowels in order; consonants may differ',
    example: 'OUTHOUSE → OUTOFUSE',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    prepare(params) { return vowelSkeleton(params.entry); },
    run(entry, skeleton, wordlist) {
      if (!skeleton) return true;
      return vowelSkeleton(entry) === skeleton;
    },
    group: {
      key: entry => vowelSkeleton(entry),
      columns: [
        { label: 'Vowels', value: g => g.key.length },
      ],
    },
  },
  kangaroos: {
    name: 'Kangaroos', icon: '🦘', category: 'pairs',
    desc: 'Words containing the input spread out',
    example: 'KANGA → MILKANDSUGAR',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: true, outputHighlights: false,
    isInert: params => !((params && params.entry || '').trim()),
    prepare(params) { return params.entry.trim(); },
    run(entry, joey, wordlist) {
      if (!joey) return true;
      if (entry.length <= joey.length) return false;
      const ranges = [];
      let i = 0;
      for (let j = 0; j < entry.length && i < joey.length; j++) {
        if (entry[j] === joey[i]) {
          ranges.push({ start: j, end: j + 1, kind: 'search:0' });
          i++;
        }
      }
      return i === joey.length ? ranges : false;
    },
  },
  joeys: {
    name: 'Joeys', icon: '🍼', category: 'pairs',
    desc: 'Words contained in the input spread out',
    example: 'MAJORKEY → JOEY',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    isInert: params => !((params && params.entry || '').trim()),
    prepare(params) { return params.entry.trim(); },
    run(entry, kangaroo, wordlist) {
      if (!kangaroo) return true;
      if (entry.length >= kangaroo.length) return false;
      let i = 0;
      for (let j = 0; j < kangaroo.length && i < entry.length; j++) {
        if (kangaroo[j] === entry[i]) i++;
      }
      return i === entry.length;
    },
  },
  palindromes: {
    name: 'Palindromes', icon: '🪞', category: 'palindrome',
    desc: 'Read the same forwards and back',
    example: 'RACECAR · KAYAK',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) { return entry === reverseString(entry); },
  },
  semordnilap: {
    name: 'Semordnilap', icon: '⬅️', category: 'palindrome',
    desc: 'Reverse to get a different word',
    example: 'STRESSED → DESSERTS',
    params: [],
    kind: 'transform', inputHighlights: false, outputHighlights: false,
    glyph: () => '→',
    run(entry, params, wordlist) {
      // Bidirectional emit — a row whenever the reverse is also an entry, in
      // both directions. The post-executor `unify` pass collapses
      // the matched mirror pair into one row with a ↔ glyph; a downstream
      // transform breaks the symmetry and the two directions stay separate.
      // Palindromes are skipped — reversing them yields the same word.
      const reversed = reverseString(entry);
      if (reversed === entry) return [];
      if (!wordlist.byNorm.has(reversed)) return [];
      return [{ entry: reversed }];
    },
  },
  space_out: {
    name: 'Space out', icon: '🌌', category: 'phrase',
    desc: 'Guess at where spaces go in multi-word entries',
    example: 'SPACEOUT → SPACE OUT',
    params: [
      { key: 'splits', label: 'Splits', type: 'range', default: 'few',
        choices: [
          { value: 'one',  label: 'One'  },
          { value: 'few',  label: 'Few'  },
          { value: 'many', label: 'Many' },
        ] },
    ],
    kind: 'transform', inputHighlights: false, outputHighlights: false,
    glyph: () => '→',
    async prepare(params) {
      await loadUnigramCorpus();
      const choice = params.splits || 'few';
      return { window: SPACE_OUT_WINDOWS[choice] ?? SPACE_OUT_WINDOWS.few, onlyTop: choice === 'one' };
    },
    run(entry, prepared, wordlist) {
      if (!hasUnigramCorpus()) return [];
      const existing = wordlist.byNorm.get(entry);
      if (existing && displayOf(existing).includes(' ')) return [{ entry }];
      const splits = rankedSplits(entry, prepared.window, wordlist);
      if (splits.length === 0) return [];
      const inputScore = existing?.score ?? 0;
      const picks = prepared.onlyTop ? splits.slice(0, 1) : splits;
      return picks.map(parts => {
        const joined = parts.join(' ');
        if (joined === entry) return { entry };
        const hit = wordlist.byNorm.get(toNorm(joined));
        const hitIsJoined = hit && (hit.display || '').toLowerCase() === joined;
        return { entry: hitIsJoined ? hit.norm : [joined, inputScore] };
      });
    },
  },
  search: {
    name: 'Search', icon: '<svg width="16" height="16" aria-hidden="true"><use href="#icon-search"/></svg>', category: 'search',
    desc: 'Search (and replace) with wildcards',
    example: 'UN*ED · C?T',
    findReplace: true,
    params: [
      { placeholder: 'pattern', help: buildHelpHTML([
        ['*', 'any string'],
        ['?', 'any character'],
        ['#', 'any consonant'],
        ['@', 'any vowel'],
        ['[abc]', 'any of a, b, c'],
        ['[^abc]', 'none of a, b, c'],
        ['[a-m]', 'letter range'],
      ]) },
      { key: 'replace', placeholder: 'replace', raw: true },
      WHOLE_WORD_PARAM,
    ],
    kind: params => (params.replace ? 'transform' : 'filter'),
    inputHighlights: true, outputHighlights: true,
    glyph: params => (params.replace ? '→' : null),
    // An empty query is a no-op: the row is transparent — no filtering, no
    // lens — so an empty permanent search bar costs nothing.
    isInert: params => !((params && params.pattern || '').trim()),
    matchOn: 'both',
    prepare(params) {
      const matcher = buildSearchPattern((params.pattern || '').trim(), !!params['whole-word']);
      if (!matcher) return null;
      const replacement = params.replace || '';
      return replacement ? { mode: 'replace', matcher, replacement } : { mode: 'filter', matcher };
    },
    run(wlEntry, prepared, wordlist) {
      if (!prepared) return true;
      if (prepared.mode === 'replace') return runSearchReplace(displayOf(wlEntry), prepared, wordlist);
      const { matcher } = prepared;
      if (!matcher.test(wlEntry)) return null;
      const ranges = matcher.searchRanges(wlEntry);
      return ranges.length ? ranges : true;
    },
  },
  regex: {
    name: 'Regex', icon: '🪄', category: 'search',
    desc: 'Search (and replace) with regular expressions',
    example: 'UN.+ED · C.{2,4}T',
    findReplace: true,
    params: [
      { key: 'pattern', raw: true, placeholder: 'pattern', help: buildHelpHTML([
        ['.*', 'any string'],
        ['.', 'any character'],
        ['[abc]', 'any of a, b, c'],
        ['[^abc]', 'none of a, b, c'],
        ['a*', 'zero or more'],
        ['a+', 'one or more'],
        ['a?', 'optional'],
        ['a{2,4}', '2 to 4 times'],
        ['a|b', 'either a or b'],
        ['(…)', 'capture group'],
      ], { link: { url: 'https://regexone.com/', text: 'Learn regex at regexone.com →' } }) },
      { key: 'replace', placeholder: 'replace', raw: true, help: buildHelpHTML([
        ['$1', 'first capture group'],
        ['$2', 'second group, etc.'],
        ['$&', 'the whole match'],
        ['$$', 'a literal $'],
      ], { cols: 1, link: { url: 'https://regexone.com/', text: 'Learn regex at regexone.com →' } }) },
      WHOLE_WORD_PARAM,
    ],
    // Blank replacement reads as filter mode, not "delete the match" — a blank
    // field is indistinguishable from one that was never touched.
    kind: params => (params.replace ? 'transform' : 'filter'),
    inputHighlights: true, outputHighlights: true,
    glyph: params => (params.replace ? '→' : null),
    // A half-typed, invalid pattern is inert like an empty one, so the view
    // neither blanks nor churns mid-keystroke.
    isInert(params) {
      const pattern = (params && params.pattern || '').trim();
      if (!pattern) return true;
      try { new RegExp(pattern); return false; } catch { return true; }
    },
    matchOn: 'both',
    prepare(params) {
      const replacement = params.replace || '';
      const body = params.pattern.trim();
      // Flags `gid`: `i` lets a raw (un-lowercased, so `\D \S \B` survive)
      // pattern match case-insensitively; `d` exposes match indices for
      // highlighting. The pattern runs against both norm and display (see run),
      // so `\s`, `-`, or an accent can match the punctuation display carries but
      // norm strips. The whole-word wrap is non-capturing so `$N` backrefs keep
      // their group numbers.
      const wrap = src => params['whole-word'] ? '^(?:' + src + ')$' : src;
      const { capturing, runs } = analyzeRegexPattern(body);
      if (replacement) {
        // The functional `re` can't be wrapped for highlighting — synthetic
        // groups would renumber the user's `$N`; `hlRe` is the wrapped copy.
        const hlRe = capturing ? null : new RegExp(wrap(wrapRuns(body, runs)), 'gid');
        return { mode: 'replace', re: new RegExp(wrap(body), 'gid'), hlRe, tokens: parseReplacement(replacement) };
      }
      return { mode: 'filter', re: new RegExp(wrap(capturing ? body : wrapRuns(body, runs)), 'gid') };
    },
    run(wlEntry, prepared, wordlist) {
      if (prepared.mode === 'filter') {
        const { re } = prepared;
        const normRes = regexExecAll(re, wlEntry.norm);
        const d = wlEntry.display;
        const dispRes = d != null ? regexExecAll(re, d) : null;
        if (!normRes.hit && !dispRes?.hit) return null;
        if (dispRes?.ranges.length) return dispRes.ranges.map(r => ({ ...r, coord: 'display' }));
        if (normRes.ranges.length) return normRes.ranges.map(r => ({ ...r, coord: 'norm' }));
        return true;
      }
      return runRegexReplace(wlEntry.norm, prepared, wordlist);
    },
  },
  initialisms: {
    name: 'Initialisms', icon: '🔠', category: 'phrase',
    desc: 'Starting letters spell a word',
    example: 'HOT → Helen of Troy',
    params: [{ placeholder: 'word' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    matchOn: 'display',
    isInert: params => !((params && params['word'] || '').trim()),
    prepare(params) { return (params['word'] || '').trim().toLowerCase(); },
    run(displayText, target, wordlist) {
      if (!target) return true;
      for (const split of wordSplits(displayText)) {
        if (split.length !== target.length) continue;
        let ok = true;
        for (let i = 0; i < split.length; i++) {
          if (split[i][0].toLowerCase() !== target[i]) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    },
    group: {
      key: displayText => {
        const words = displayText.split(/[ ]+/).filter(Boolean);
        if (words.length < 2) return null;
        let initialism = '';
        for (const w of words) initialism += w[0].toLowerCase();
        return initialism;
      },
      anchor: (key, wordlist) => wordlist.byNorm.get(key) || null,
      anchorLabel: 'Initialism',
    },
  },
  behead: {
    name: 'Behead', icon: '🪓', category: 'side',
    desc: 'Remove the first N letters',
    example: 'SLING → LING',
    params: [{ label: 'Count', default: '1', type: 'number' }],
    kind: 'transform', inputHighlights: true, outputHighlights: false,
    glyph: () => '→',
    run(entry, params, wordlist) {
      const count = Math.max(1, parseInt(params.count, 10) || 1);
      if (entry.length <= count) return [];
      const beheaded = entry.slice(count);
      if (!wordlist.byNorm.has(beheaded)) return [];
      return [{ entry: beheaded, inputHighlights: [{ kind: 'removed', start: 0, end: count }] }];
    },
  },
  curtail: {
    name: 'Curtail', icon: '✂️', category: 'side',
    desc: 'Remove the last N letters',
    example: 'PARTY → PART',
    params: [{ label: 'Count', default: '1', type: 'number' }],
    kind: 'transform', inputHighlights: true, outputHighlights: false,
    glyph: () => '→',
    run(entry, params, wordlist) {
      const count = Math.max(1, parseInt(params.count, 10) || 1);
      if (entry.length <= count) return [];
      // Skip plural → singular.
      if (entry.endsWith('s') && !entry.endsWith('ss')) return [];
      const curtailed = entry.slice(0, -count);
      if (!wordlist.byNorm.has(curtailed)) return [];
      return [{ entry: curtailed, inputHighlights: [{ kind: 'removed', start: entry.length - count, end: entry.length }] }];
    },
  },
};

// A param's `key` defaults to a slug of its label (or placeholder); declare
// `key` explicitly only when the internal name should differ from that text.
for (const tool of Object.values(TOOLS)) {
  for (const p of tool.params) {
    if (!p.key) p.key = (p.label || p.placeholder || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
}

for (const col of Object.values(TOOLS).flatMap(t => t.group?.columns || [])) {
  if (!col.key) col.key = col.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// Pure: gather the group-column keys across the catalog and build the CSS that
// sizes each `.group-col`. main.js's mountGroupColumnStyle injects the result.
export function groupColumnCSS() {
  const keys = new Set();
  for (const tool of Object.values(TOOLS)) {
    for (const col of tool.group?.columns || []) keys.add(col.key);
  }
  if (!keys.size) return '';
  return [...keys].map(k =>
    `.group-col[data-col="${k}"] { min-width: var(--group-col-${k}-w, 2ch); }`
  ).join('\n');
}

// Keyed `toolKey/paramKey` to match the `data-help` attribute that input
// builders emit — attachHelpPopups joins the two. Keep the formats in sync.
export const PARAM_HELP = {};
for (const [toolKey, tool] of Object.entries(TOOLS)) {
  for (const p of tool.params) {
    if (p.help) PARAM_HELP[`${toolKey}/${p.key}`] = p.help;
  }
}

export function reverseString(s) {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += s[i];
  return out;
}

// Sort the letters of an already-canonical string. Tools that need letter-bank
// equivalence call this on `entry` (and on user-supplied params, which the
// runtime normalizes the same way before passing in). Non-letters survive and
// participate in the comparison — for letter-only wordlists they're a no-op,
// for the rare punctuation-bearing entry they make the match stricter.
export function sortLetters(s) {
  if (!s) return '';
  return s.split('').sort().join('');
}

export const consonantSkeleton = s => (s || '').replace(/[^bcdfghjklmnpqrstvwxyz]/g, '');
export const vowelSkeleton     = s => (s || '').replace(/[^aeiou]/g, '');

export function wordSplits(display) {
  const stripped = display.split(/[ ]+/).filter(Boolean);
  const splits = [stripped];
  if (stripped.some(w => w.includes('-'))) {
    splits.push(stripped.flatMap(w => w.split(/-+/).filter(Boolean)));
  }
  return splits;
}

// Normalize tool param strings: lowercase only. Same rule as wlEntry.norm —
// the executor runs this on every param before handing to `run`, so tools see
// canonical-lowercase input on both sides without per-call ceremony. A param
// flagged `raw` in the schema opts out — a regex pattern would have its `\D`
// classes and group names corrupted by lowercasing.
export function normalizeParams(params, schema) {
  const raw = new Set((schema || []).filter(p => p.raw).map(p => p.key));
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    out[k] = (typeof v === 'string' && !raw.has(k)) ? v.toLowerCase() : v;
  }
  return out;
}

export function makeToolRow(tool, params = {}, grouped = false) {
  const def = TOOLS[tool];
  if (!grouped) {
    for (const p of def.params) {
      if (p.default !== undefined && params[p.key] === undefined) params[p.key] = p.default;
    }
  }
  const row = {
    tool, params, def, grouped,
    kind() {
      if (row.grouped) return 'group';
      return typeof def.kind === 'function' ? def.kind(row.params) : def.kind;
    },
    isInert() {
      if (row.grouped) return false;
      return def.isInert ? def.isInert(row.params) : false;
    },
    glyph() {
      return def.glyph ? def.glyph(row.params) : null;
    },
  };
  return row;
}
