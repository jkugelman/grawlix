import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyViewFilterToRows, entryPredicate } from '../../site/src/engine/executor.js';
import { parseViewFilter } from '../../site/src/engine/range.js';

// ─── Length half of the view filter ──────────────────────────────────────────
//
// Score judges every atom in a chain; length judges the last one. The asymmetry is
// the whole point (see chainPredicate), so these lock it in against a "make them
// consistent" simplification that silently empties every length-changing tool.

const wl = (norm, score = 0) => ({ norm, display: null, score, comment: '' });
const atom = (norm, score = 0) => ({ wlEntry: wl(norm, score), highlights: null, glyph: null });
const chain = (...atoms) => ({ atoms });
const range = (min, max) => [{ min, max }];
const lengthFilter = (min, max) => ({ score: null, length: range(min, max) });

test('length judges the LAST atom, not every atom', () => {
  // Head off: swing (5) → wing (4). A length-4 filter must keep it.
  const headOff = chain(atom('swing'), atom('wing'));
  assert.deepEqual(applyViewFilterToRows([headOff], lengthFilter(4, 4), 'single'), [headOff]);
});

test('a chain whose last atom misses the length drops', () => {
  const headOff = chain(atom('swing'), atom('wing'));
  assert.deepEqual(applyViewFilterToRows([headOff], lengthFilter(5, 5), 'single'), []);
});

test('score and length both apply, each by its own rule', () => {
  // Both end at a length-4 atom; only the seed's score differs.
  const goodSeed = chain(atom('swing', 60), atom('wing', 60));
  const badSeed  = chain(atom('sting', 10), atom('ting', 60));
  const filter = { score: range(30, 99), length: range(4, 4) };
  assert.deepEqual(applyViewFilterToRows([goodSeed, badSeed], filter, 'single'), [goodSeed]);
});

test('grouped: length trims members and drops a cluster left under 2', () => {
  const g = { key: 'a', anchor: null, chains: [
    chain(atom('isaidno')),   // 7
    chain(atom('sodone')),    // 6 — trimmed
  ] };
  assert.equal(applyViewFilterToRows([g], lengthFilter(7, 7), 'set').length, 0);
});

test('grouped: a cluster keeping 2+ in-length members survives, trimmed', () => {
  const g = { key: 'a', anchor: null, chains: [
    chain(atom('isaidno')), chain(atom('seaside')), chain(atom('sodone')),
  ] };
  const out = applyViewFilterToRows([g], lengthFilter(7, 7), 'set');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].chains.map(c => c.atoms[0].wlEntry.norm), ['isaidno', 'seaside']);
});

test('grouped: the anchor gates on score but never on length', () => {
  // The anchor is the seed the cluster was found from, not a candidate answer, so
  // its own length must not decide the cluster's fate.
  const g = { key: 'a', anchor: wl('ab', 50), chains: [
    chain(atom('isaidno')), chain(atom('seaside')),
  ] };
  assert.equal(applyViewFilterToRows([g], lengthFilter(7, 7), 'set').length, 1);
});

test('grouped: an out-of-score anchor still drops the cluster', () => {
  const g = { key: 'a', anchor: wl('ab', 999), chains: [
    chain(atom('isaidno', 50)), chain(atom('seaside', 50)),
  ] };
  const filter = { score: range(0, 60), length: null };
  assert.equal(applyViewFilterToRows([g], filter, 'set').length, 0);
});

test('entryPredicate applies both halves to a bare entry', () => {
  const ok = entryPredicate({ score: range(30, 99), length: range(4, 6) });
  assert.equal(ok(wl('wing', 60)), true);
  assert.equal(ok(wl('wing', 10)), false);    // score out
  assert.equal(ok(wl('wingding', 60)), false); // length out
});

// ─── parseViewFilter ─────────────────────────────────────────────────────────
//
// The null return is a contract: callers key their unfiltered fast path and their
// shipped `filtered` flag off it, so an empty object here marks results filtered.

test('parseViewFilter returns null when neither range is set', () => {
  assert.equal(parseViewFilter({}), null);
  assert.equal(parseViewFilter({ scoreRange: '', lengthRange: '' }), null);
  assert.equal(parseViewFilter({ scoreRange: null, lengthRange: null }), null);
});

test('parseViewFilter returns null when both ranges are unparseable', () => {
  assert.equal(parseViewFilter({ scoreRange: 'junk', lengthRange: 'junk' }), null);
});

test('parseViewFilter parses each half independently', () => {
  assert.deepEqual(parseViewFilter({ lengthRange: '7' }), { score: null, length: range(7, 7) });
  assert.deepEqual(parseViewFilter({ scoreRange: '30+' }), { score: [{ min: 30, max: null }], length: null });
  assert.deepEqual(parseViewFilter({ scoreRange: '30-50', lengthRange: '5-7' }),
    { score: range(30, 50), length: range(5, 7) });
});
