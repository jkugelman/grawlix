'use strict';

// ─── Tool catalog & tool helpers ─────────────────────────────────────────────

import { SCORE_RANGE_HELP, LENGTH_HELP } from './range.js';
import { OUTPUT_HELP } from './rescore.js';
import anagrams from './tools/anagrams.js';
import hidden_anagram from './tools/hidden_anagram.js';
import letter_bank from './tools/letter_bank.js';
import restricted_alphabet from './tools/restricted_alphabet.js';
import scrabble from './tools/scrabble.js';
import caesar, { caesarKey, caesarShift } from './tools/caesar.js';
import cryptogram, { patternKey } from './tools/cryptogram.js';
import repeaters from './tools/repeaters.js';
import neckouts from './tools/neckouts.js';
import isograms from './tools/isograms.js';
import supervocalics from './tools/supervocalics.js';
import monovocalics from './tools/monovocalics.js';
import alphabetical from './tools/alphabetical.js';
import reverse_alphabetical from './tools/reverse_alphabetical.js';
import consonantcy, { consonantSkeleton } from './tools/consonantcy.js';
import vowelcy, { vowelSkeleton } from './tools/vowelcy.js';
import kangaroos from './tools/kangaroos.js';
import joeys from './tools/joeys.js';
import weave, { configureWeave } from './tools/weave.js';
import palindromes from './tools/palindromes.js';
import semordnilap from './tools/semordnilap.js';
import rhymes from './tools/rhymes.js';
import space_out from './tools/space_out.js';
import search from './tools/search.js';
import regex from './tools/regex.js';
import umiaq, { configureUmiaq } from './tools/umiaq.js';
import initialisms, { wordSplits } from './tools/initialisms.js';
import head_off from './tools/head_off.js';
import back_off from './tools/back_off.js';
import dead_center from './tools/dead_center.js';
import rebus from './tools/rebus.js';
import remove from './tools/remove.js';
import optional_letters from './tools/optional_letters.js';
import { reverseString, sortLetters } from './tools/shared.js';

export { reverseString, sortLetters, consonantSkeleton, vowelSkeleton, wordSplits, caesarKey, caesarShift, patternKey, configureUmiaq, configureWeave };

export const TOOL_CATEGORIES = [
  { id: 'anagram',    label: 'Anagram' },
  { id: 'bank',       label: 'Bank' },
  { id: 'cipher',     label: 'Cipher' },
  { id: 'halves',     label: 'Halves' },
  { id: 'letters',    label: 'Letters' },
  { id: 'optional',   label: 'Optional' },
  { id: 'pairs',      label: 'Pairs' },
  { id: 'palindrome', label: 'Palindrome' },
  { id: 'phonetic',   label: 'Phonetic' },
  { id: 'phrase',     label: 'Phrase' },
  { id: 'rebus',      label: 'Rebus' },
  { id: 'search',     label: 'Search' },
  { id: 'side',       label: 'Side' },
  { id: 'transform',  label: 'Transform' },
];

export const FEATURED_TOOLS = ['regex', 'umiaq', 'rebus', 'anagrams', 'initialisms', 'rhymes'];

export const TOOLS = {
  anagrams,
  hidden_anagram,
  letter_bank,
  restricted_alphabet,
  scrabble,
  caesar,
  cryptogram,
  repeaters,
  neckouts,
  isograms,
  supervocalics,
  monovocalics,
  alphabetical,
  reverse_alphabetical,
  consonantcy,
  vowelcy,
  kangaroos,
  joeys,
  weave,
  palindromes,
  semordnilap,
  rhymes,
  space_out,
  search,
  regex,
  umiaq,
  initialisms,
  head_off,
  back_off,
  dead_center,
  rebus,
  remove,
  optional_letters,
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
// Non-tool inputs share the same data-help mechanism; each key must match the
// `data-help` its input builder emits — the stats-bar score/length filters in
// buildScoreRangeInputHTML and buildLengthRangeInputHTML, the rescore/scoring rule
// fields in buildRulesListHTML.
PARAM_HELP['filter/score']  = SCORE_RANGE_HELP;
PARAM_HELP['filter/length'] = LENGTH_HELP;
PARAM_HELP['rule/score']    = SCORE_RANGE_HELP;
PARAM_HELP['rule/length']   = LENGTH_HELP;
PARAM_HELP['rule/output']   = OUTPUT_HELP;

// Normalize tool param strings: lowercase only. Same rule as wlEntry.norm —
// the executor runs this on every param before handing to `run`, so tools see
// canonical-lowercase input on both sides without per-call ceremony. A param
// flagged `raw` in the schema opts out — a regex pattern would have its `\D`
// classes and group names corrupted by lowercasing.
export function normalizeParams(params, schema) {
  const raw = new Set((schema || []).filter(p => p.raw).map(p => p.key));
  const lower = v => (typeof v === 'string' ? v.toLowerCase() : v);
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (Array.isArray(v)) out[k] = raw.has(k) ? v.slice() : v.map(lower);
    else out[k] = (typeof v === 'string' && !raw.has(k)) ? lower(v) : v;
  }
  return out;
}

export function makeToolRow(tool, params = {}, grouped = false, invert = false, reverse = false) {
  const def = TOOLS[tool];
  if (!grouped) {
    for (const p of def.params) {
      if (p.repeat) {
        if (!Array.isArray(params[p.key])) params[p.key] = [''];
      } else if (p.default !== undefined && params[p.key] === undefined) {
        params[p.key] = p.default;
      }
    }
  }
  const row = {
    tool, params, def, grouped, invert, reverse,
    kind() {
      // A function `kind` decides the all-mode (`*`) case itself, rather than
      // defaulting to group: Caesar's `*` is a transform when a shift is set.
      if (typeof def.kind === 'function') return def.kind(row.params, row.grouped);
      return row.grouped ? 'group' : def.kind;
    },
    // Read this, never `row.invert`: `?search=a&replace=b&not` sets the flag on a
    // non-filter row, where a reader skipping the kind test diverges from the stage.
    inverted() { return !!row.invert && row.kind() === 'filter' && !def.reversible; },   // a reversible filter's label hosts direction, not invert
    reversed() { return !!row.reverse && !!def.reversible; },
    // reversed() swaps which side highlights: the converse of a front-cut that marks
    // its INPUT is a front-grow that marks its OUTPUT. Read the wrong side and the
    // atom count reserves a slot on the wrong atom — rows overlap in the scroller, no error.
    inputSide()  { return (row.reversed() ? def.output : def.input) ?? 'plain'; },
    outputSide() { return (row.reversed() ? def.input : def.output) ?? 'plain'; },
    inputHi() { return row.inputSide() === 'highlight'; },
    outputHi() { return row.outputSide() === 'highlight'; },
    inputShown() { return row.inputSide() !== 'hidden'; },
    outputShown() { return row.outputSide() !== 'hidden'; },
    isInert() {
      if (row.grouped) return false;
      return def.isInert ? def.isInert(row.params) : false;
    },
    // Parse-time error, known synchronously from params — a separate channel
    // from the `_error` a tool throws mid-run (set async by the executor).
    error() {
      if (row.grouped) return null;
      return def.error ? def.error(row.params) : null;
    },
    glyph() {
      return def.glyph ? def.glyph(row.params) : null;
    },
    quickFix() {
      if (row.grouped) return null;
      return def.quickFix ? def.quickFix(row.params) : null;
    },
  };
  return row;
}
