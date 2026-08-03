import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvCell, exportFilenameSegment, exportFilename,
  flatCopyLines, buildCopyResults, chainContentEntries, buildWordlistText, buildTupleCSV,
  exportCountPhrase,
} from '../../site/src/app/actions.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

// display null means "render norm.toUpperCase()" in copy paths but "render norm
// verbatim" in the wordlist path (displayOf) — the two paths diverge, and several
// pins below turn on that difference.
const wl = (norm, { display = null, score = 0, comment = '' } = {}) => ({ norm, display, score, comment });
const atom = (norm, { display = null, score = 0, glyph = null } = {}) => ({ wlEntry: wl(norm, { display, score }), glyph });
const chain = (...atoms) => ({ atoms });

// A minimal exportFilename stack row. No state, no catalog: shipped makeToolRow
// reads TOOLS, so it can't be fenced — this stubs only the members read here.
const row = ({ tool = 'search', inert = false, grouped = false, inverted = false, reversed = false, reverseSlug, params = {}, paramDefs = [] } = {}) => ({
  tool,
  isInert: () => inert,
  grouped,
  inverted: () => inverted,
  reversed: () => reversed,
  def: { params: paramDefs, reverseSlug },
  params,
});

// ─── csvCell — RFC-4180 quoting ──────────────────────────────────────────────

test('csvCell: a plain cell passes through unquoted', () => {
  assert.equal(csvCell('plain'), 'plain');
});

test('csvCell: a cell containing a comma is wrapped in double quotes', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
});

test('csvCell: a cell containing a double quote has its quotes doubled and the whole wrapped', () => {
  // RFC-4180: each " doubles to "", and the presence of a quote also wraps the field.
  assert.equal(csvCell('she said "hi"'), '"she said ""hi"""');
  assert.equal(csvCell('a"b'), '"a""b"');
});

test('csvCell: a cell containing a newline is quoted', () => {
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
});

test('csvCell: a carriage return also forces quoting', () => {
  assert.equal(csvCell('a\rb'), '"a\rb"');
});

test('csvCell: an empty string stays empty (no special chars)', () => {
  assert.equal(csvCell(''), '');
});

test('csvCell: null and undefined collapse to the empty cell', () => {
  // The == null guard fires before String() would have produced the literal 'null'.
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('csvCell: a number is stringified and passes through unquoted', () => {
  assert.equal(csvCell(42), '42');
  assert.equal(csvCell(0), '0');
});

test('csvCell: leading/trailing spaces alone do not trigger quoting', () => {
  // Whitespace is not in [",\r\n], so it is preserved verbatim and unquoted.
  assert.equal(csvCell('  hi  '), '  hi  ');
});

// ─── exportFilenameSegment — piece sanitizer ─────────────────────────────────

test('exportFilenameSegment: lowercases and turns spaces into a single dash', () => {
  assert.equal(exportFilenameSegment('Hello World'), 'hello-world');
});

test('exportFilenameSegment: strips reserved/illegal filename chars outright', () => {
  // The first replace deletes *?#@[]/\:|"<> entirely (no dash left behind).
  assert.equal(exportFilenameSegment('a*b?c'), 'abc');
  assert.equal(exportFilenameSegment('*EARNING'), 'earning');
  assert.equal(exportFilenameSegment('x:y|z'), 'xyz');
});

test('exportFilenameSegment: other non-[a-z0-9_.-] runs collapse to one dash, then trim', () => {
  assert.equal(exportFilenameSegment('  spaced  '), 'spaced');
  assert.equal(exportFilenameSegment('a   b'), 'a-b');
  assert.equal(exportFilenameSegment('foo!!!bar'), 'foo-bar');
});

test('exportFilenameSegment: preserves the allowed punctuation set _ . -', () => {
  assert.equal(exportFilenameSegment('upper_lower.dot-dash'), 'upper_lower.dot-dash');
});

test('exportFilenameSegment: empty and nullish inputs return the empty string', () => {
  assert.equal(exportFilenameSegment(''), '');
  assert.equal(exportFilenameSegment(null), '');
  assert.equal(exportFilenameSegment(undefined), '');
});

test('exportFilenameSegment: does NOT cap length — only exportFilename truncates', () => {
  // The cap lives in exportFilename (100 chars on the assembled name), not here:
  // the segment is returned at full length.
  const long = 'a'.repeat(250);
  assert.equal(exportFilenameSegment(long), long);
});

// ─── exportFilename — full download name assembly ────────────────────────────

test('exportFilename: an empty stack yields the all-results fallback', () => {
  // parts === ['grawlix'] (length 1) => push 'all'.
  assert.equal(exportFilename([], 'txt'), 'grawlix-all.txt');
});

test('exportFilename: a representative search row + first text param', () => {
  const stack = [row({ tool: 'search', paramDefs: [{ key: 'pattern', type: 'text' }], params: { pattern: '*EARNING' } })];
  assert.equal(exportFilename(stack, 'txt'), 'grawlix-search-earning.txt');
});

test('exportFilename: a grouped row inserts an "all" segment after the tool', () => {
  const stack = [row({ tool: 'anagram', grouped: true, paramDefs: [], params: {} })];
  assert.equal(exportFilename(stack, 'csv'), 'grawlix-anagram-all.csv');
});

test('exportFilename: an inverted row inserts a "not" segment before the param', () => {
  const stack = [row({ tool: 'search', inverted: true, paramDefs: [{ key: 'pattern', type: 'text' }], params: { pattern: 'cat' } })];
  assert.equal(exportFilename(stack, 'txt'), 'grawlix-search-not-cat.txt');
});

test('exportFilename: the first truthy non-checkbox param is appended; checkbox params are ignored', () => {
  const stack = [row({
    tool: 'regex',
    paramDefs: [{ key: 'whole', type: 'checkbox' }, { key: 'pat', type: 'text' }],
    params: { whole: true, pat: 'CA.E' },
  })];
  // 'whole' is a checkbox => skipped by the find; 'pat' is the first eligible.
  assert.equal(exportFilename(stack, 'json'), 'grawlix-regex-ca.e.json');
});

test('exportFilename: a trailing INERT search bar is dropped (the isBar guard)', () => {
  // Last row, tool === 'search', isInert() => skipped; nothing else => 'all'.
  const stack = [row({ tool: 'search', inert: true })];
  assert.equal(exportFilename(stack, 'txt'), 'grawlix-all.txt');
});

test('exportFilename: a non-trailing inert row is NOT skipped (isBar only guards the last search)', () => {
  // The inert search is at index 0, not the last row, so isBar is false and it
  // contributes its segment despite being inert.
  const stack = [
    row({ tool: 'search', inert: true, paramDefs: [{ key: 'pattern', type: 'text' }], params: { pattern: 'CAT' } }),
    row({ tool: 'reverse' }),
  ];
  assert.equal(exportFilename(stack, 'txt'), 'grawlix-search-cat-reverse.txt');
});

test('exportFilename: multiple rows chain their segments with dashes', () => {
  const stack = [
    row({ tool: 'search', paramDefs: [{ key: 'pattern', type: 'text' }], params: { pattern: 'A*' } }),
    row({ tool: 'reverse' }),
  ];
  assert.equal(exportFilename(stack, 'txt'), 'grawlix-search-a-reverse.txt');
});

test('exportFilename: a reversed row names its reverse slug, not the tool key', () => {
  const stack = [row({ tool: 'head_off', reversed: true, reverseSlug: 'head_on', paramDefs: [{ key: 'pattern', type: 'text' }], params: { pattern: 'can' } })];
  assert.equal(exportFilename(stack, 'txt'), 'grawlix-head_on-can.txt');
});

test('exportFilename: an over-long assembled name is truncated to 100 chars before the extension', () => {
  const stack = [row({ tool: 'search', paramDefs: [{ key: 'pattern', type: 'text' }], params: { pattern: 'a'.repeat(200) } })];
  const out = exportFilename(stack, 'txt');
  const stem = out.slice(0, -'.txt'.length);
  assert.equal(stem.length, 100);
  assert.equal(out, 'grawlix-search-' + 'a'.repeat(100 - 'grawlix-search-'.length) + '.txt');
});

// ─── chainContentEntries — consecutive-norm dedup ────────────────────────────

test('chainContentEntries: a single atom yields its wlEntry', () => {
  const a = atom('cat');
  assert.deepEqual(chainContentEntries(chain(a)), [a.wlEntry]);
});

test('chainContentEntries: consecutive same-norm atoms collapse to the FIRST occurrence', () => {
  const first = atom('cat', { score: 1 });
  const dup = atom('cat', { score: 99 });
  const dog = atom('dog');
  const out = chainContentEntries(chain(first, dup, dog));
  assert.equal(out.length, 2);
  assert.equal(out[0], first.wlEntry);   // first wins; the score-99 dup is dropped
  assert.equal(out[1], dog.wlEntry);
});

test('chainContentEntries: a non-consecutive repeat is NOT deduped (dedup is only adjacent)', () => {
  const out = chainContentEntries(chain(atom('cat'), atom('dog'), atom('cat')));
  assert.deepEqual(out.map(e => e.norm), ['cat', 'dog', 'cat']);
});

test('chainContentEntries: an empty chain yields no entries', () => {
  assert.deepEqual(chainContentEntries(chain()), []);
});

// ─── flatCopyLines — column-aligned copy text ────────────────────────────────

test('flatCopyLines: single-column lines are "<len> <ENTRY>" with no trailing pad', () => {
  // The last (and here only) column is never padded — display null => uppercased.
  const out = flatCopyLines([chain(atom('cat')), chain(atom('elephant'))]);
  assert.deepEqual(out, ['3 CAT', '8 ELEPHANT']);
});

test('flatCopyLines: a display value is uppercased (sharing convention)', () => {
  const out = flatCopyLines([chain(atom('mcjob', { display: 'McJob' }))]);
  assert.deepEqual(out, ['5 MCJOB']);
});

test('flatCopyLines: non-last columns pad the entry to the column width; the last column does not', () => {
  // Two two-atom chains; col 0 entries CAT(3)/OX(2) pad to width 3, col 1 is last.
  // The atom glyph rides in front of its piece.
  const c1 = chain(atom('cat'), atom('cats', { glyph: '→' }));
  const c2 = chain(atom('ox'), atom('oxen', { glyph: '→' }));
  const out = flatCopyLines([c1, c2]);
  assert.deepEqual(out, [
    '3 CAT → 4 CATS',
    '2 OX  → 4 OXEN',   // 'OX ' padded to width 3, then a space join before the glyph piece
  ]);
});

test('flatCopyLines: the length number is right-aligned (padStart) across the column', () => {
  // norm lengths 3 and 12 => lenW[0] = 2, so '3' becomes ' 3'.
  const out = flatCopyLines([
    chain(atom('cat')),
    chain(atom('abcdefghijkl')),   // 12 chars
  ]);
  assert.deepEqual(out, [' 3 CAT', '12 ABCDEFGHIJKL']);
});

test('flatCopyLines: a glyph-less first atom emits no leading glyph token', () => {
  const out = flatCopyLines([chain(atom('cat'), atom('act', { glyph: '↔' }))]);
  assert.deepEqual(out, ['3 CAT ↔ 3 ACT']);
});

test('flatCopyLines: consecutive same-norm atoms (multi-search row) collapse to one piece', () => {
  // Two same-word search atoms fold (prevNorm guard), so the line is single-column.
  const out = flatCopyLines([chain(atom('cat'), atom('cat'))]);
  assert.deepEqual(out, ['3 CAT']);
});

test('flatCopyLines: an empty chain list returns no lines', () => {
  assert.deepEqual(flatCopyLines([]), []);
});

// 200k because spreading into a call (Math.max, push) only breaks above ~125k args
// in V8 — shrink this and the pins silently stop testing anything.
const CORPUS_SCALE = 200_000;
const manyChains = () =>
  Array.from({ length: CORPUS_SCALE }, (_, i) => chain(atom('e' + String(i).padStart(6, '0'))));

test('flatCopyLines: a corpus-sized result formats without a call-arity RangeError', () => {
  const out = flatCopyLines(manyChains());
  assert.equal(out.length, CORPUS_SCALE);
  assert.equal(out[0], '7 E000000');
});

test('buildCopyResults: a corpus-sized flat result joins without a call-arity RangeError', () => {
  const text = buildCopyResults(manyChains(), false);
  assert.equal(text.split('\n').length, CORPUS_SCALE);
});

// ─── exportCountPhrase — toast count by tier ─────────────────────────────────

const group = (...chains) => ({ chains });

test('exportCountPhrase: flat counts one entry per row', () => {
  const rows = [chain(atom('cat')), chain(atom('dog')), chain(atom('emu'))];
  assert.equal(exportCountPhrase(rows, 'flat'), '3 entries');
});

test('exportCountPhrase: group counts member entries across all groups', () => {
  const rows = [
    group(chain(atom('a')), chain(atom('b'))),
    group(chain(atom('c')), chain(atom('d')), chain(atom('e'))),
  ];
  assert.equal(exportCountPhrase(rows, 'group'), '5 entries');
});

test('exportCountPhrase: tuple counts one result per row, not its lanes', () => {
  // Each 4-lane tuple is ONE result; summing lanes here is the Umiaq ×4 over-count.
  const tuple4 = () => group(chain(atom('a')), chain(atom('b')), chain(atom('c')), chain(atom('d')));
  assert.equal(exportCountPhrase([tuple4(), tuple4()], 'tuple'), '2 results');
});

test('exportCountPhrase: a single result/entry is singular', () => {
  assert.equal(exportCountPhrase([chain(atom('cat'))], 'flat'), '1 entry');
  assert.equal(exportCountPhrase([group(chain(atom('a')), chain(atom('b')))], 'tuple'), '1 result');
});

// ─── buildWordlistText — ENTRY;SCORE serialization ───────────────────────────

// iterDisplayChains(rows, false) treats rows as a flat chain array; grouped=true
// expects rows to be groups with a .chains array.

test('buildWordlistText: single-atom chains serialize to sorted "entry;score" lines, newline-terminated', () => {
  const rows = [chain(atom('dog', { score: 30 })), chain(atom('cat', { score: 50 }))];
  const { text, count, skipped } = buildWordlistText(rows, false);
  // displayOf uses display ?? norm — NOT uppercased — so entries are lowercase.
  // Keys sort ascending: cat before dog.
  assert.equal(text, 'cat;50\ndog;30\n');
  assert.equal(count, 2);
  assert.equal(skipped, 0);
});

test('buildWordlistText: the tail entry is the key; the score is the chain-wide MIN', () => {
  // A transform chain cat(50) -> cats(20): keyed on the tail 'cats', scored at min.
  const rows = [chain(atom('cat', { score: 50 }), atom('cats', { score: 20 }))];
  const { text, count } = buildWordlistText(rows, false);
  assert.equal(text, 'cats;20\n');
  assert.equal(count, 1);
});

test('buildWordlistText: a display value is emitted verbatim (no uppercasing)', () => {
  const rows = [chain(atom('mcjob', { display: 'McJob', score: 7 }))];
  assert.equal(buildWordlistText(rows, false).text, 'McJob;7\n');
});

test('buildWordlistText: duplicate tails keep the LARGER of the per-chain minimums', () => {
  // Two chains both tail 'cat': first min 10, second min 40 => 40 wins.
  const rows = [chain(atom('cat', { score: 10 })), chain(atom('cat', { score: 40 }))];
  const { text, count } = buildWordlistText(rows, false);
  assert.equal(text, 'cat;40\n');
  assert.equal(count, 1);
});

test('buildWordlistText: a tail entry containing a semicolon is skipped and counted', () => {
  // The format is ENTRY;SCORE, so a ';' in the entry would corrupt the line.
  const rows = [
    chain(atom('semibad', { display: 'A;B', score: 5 })),
    chain(atom('ok', { score: 9 })),
  ];
  const { text, count, skipped } = buildWordlistText(rows, false);
  assert.equal(text, 'ok;9\n');
  assert.equal(count, 1);
  assert.equal(skipped, 1);
});

test('buildWordlistText: an empty row set yields empty text, zero count, zero skipped', () => {
  assert.deepEqual(buildWordlistText([], false), { text: '', count: 0, skipped: 0, emptied: 0 });
});

test('buildWordlistText: an empty chain (no content) is silently ignored', () => {
  const rows = [chain(), chain(atom('cat', { score: 1 }))];
  const { text, count, skipped } = buildWordlistText(rows, false);
  assert.equal(text, 'cat;1\n');
  assert.equal(count, 1);
  assert.equal(skipped, 0);
});

test('buildWordlistText: the output format strips the entry text', () => {
  const rows = [chain(atom('cafe', { display: 'café', score: 50 }))];
  const fmt = { spaces: true, punctuation: true, diacritics: false, unicode: true, comments: true };
  assert.equal(buildWordlistText(rows, false, fmt).text, 'cafe;50\n');
});

test('buildWordlistText: a comment rides along only when the format keeps comments', () => {
  const rows = [chain({ wlEntry: wl('cat', { score: 50, comment: 'feline' }), glyph: null })];
  const keep = { spaces: true, punctuation: true, diacritics: true, unicode: true, comments: true };
  const drop = { spaces: true, punctuation: true, diacritics: true, unicode: true, comments: false };
  assert.equal(buildWordlistText(rows, false, keep).text, 'cat;50;feline\n');
  assert.equal(buildWordlistText(rows, false, drop).text, 'cat;50\n');
});

test('buildWordlistText: stripping punctuation rescues an entry that would be skipped for its semicolon', () => {
  const rows = [chain(atom('semibad', { display: 'A;B', score: 5 }))];
  const stripped = { spaces: false, punctuation: false, diacritics: false, unicode: true, comments: true };
  const { text, count, skipped } = buildWordlistText(rows, false, stripped);
  assert.equal(text, 'AB;5\n');
  assert.equal(count, 1);
  assert.equal(skipped, 0);
});

test('buildWordlistText: two entries stripped onto one line count once, best score first', () => {
  const rows = [
    chain(atom('cafe', { display: 'café', score: 60 })),
    chain(atom('cafe', { display: 'cafe', score: 30 })),
  ];
  const fmt = { spaces: true, punctuation: true, diacritics: false, unicode: true, comments: true };
  const { text, count } = buildWordlistText(rows, false, fmt);
  assert.equal(text, 'cafe;60\ncafe;30\n');
  assert.equal(count, 2);
});

test('buildWordlistText (grouped): fans out across each group\'s chains', () => {
  const groups = [
    { key: 'a', chains: [chain(atom('ant', { score: 4 })), chain(atom('ape', { score: 8 }))] },
    { key: 'b', chains: [chain(atom('bat', { score: 6 }))] },
  ];
  const { text, count } = buildWordlistText(groups, true);
  assert.equal(text, 'ant;4\nape;8\nbat;6\n');
  assert.equal(count, 3);
});

// ─── Tuple CSV (Umiaq results) ───────────────────────────────────────────────

test('buildTupleCSV: one row per tuple, lanes spread into per-lane columns', () => {
  const tup = (...lanes) => ({ chains: lanes.map(([n, s]) => chain(atom(n, { score: s }))) });
  const rows = [tup(['ape', 60], ['pea', 50]), tup(['bro', 40], ['rob', 30])];
  const lines = buildTupleCSV(rows).trim().split('\r\n');
  assert.equal(lines[0], 'entry_1,length_1,score_1,comment_1,source_1,entry_2,length_2,score_2,comment_2,source_2');
  assert.equal(lines[1], 'ape,3,60,,,pea,3,50,,');
  assert.equal(lines[2], 'bro,3,40,,,rob,3,30,,');
  assert.equal(lines.length, 3);
});
