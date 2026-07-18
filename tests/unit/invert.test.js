import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, groups, wlEntry } from './tools/harness.js';
import { makeToolRow } from '../../site/src/engine/tools.js';
import { currentAtomCount } from '../../site/src/engine/executor.js';
import { compileFlatHighlighters, materializeFlatRow } from '../../site/src/engine/flat-highlight.js';

const norms = rows => rows.map(r => (r.atoms ? r.atoms[r.atoms.length - 1].wlEntry : r).norm).sort();

// ─── Flat filters ────────────────────────────────────────────────────────────

test('an inverted filter keeps exactly what the plain one drops', async () => {
  const words = ['cat', 'cot', 'dog', 'cut'];
  const plain = await run(words, [{ tool: 'search', params: { pattern: 'c?t' } }]);
  const not = await run(words, [{ tool: 'search', params: { pattern: 'c?t' }, invert: true }]);
  assert.deepEqual(norms(plain.rows), ['cat', 'cot', 'cut']);
  assert.deepEqual(norms(not.rows), ['dog']);
});

test('inverting a param-less filter negates its verdict', async () => {
  const { rows } = await run(['cyberpunk', 'level', 'juxtapose'],
    [{ tool: 'isograms', invert: true }]);
  assert.deepEqual(norms(rows), ['level']);
});

// The trap the design flagged: search declares inputHighlights, but a non-match has
// no ranges. If the stage opened a slot anyway the row would carry an atom
// currentAtomCount never reserved, and the scroller's stride math would overlap rows.
test('an inverted highlighting filter opens no highlight slot', async () => {
  const { rows, atomCount } = await run(['cat', 'dog'],
    [{ tool: 'search', params: { pattern: 'c?t' }, invert: true }]);
  assert.equal(atomCount, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].atoms, undefined, 'stays a bare corpus entry, undecorated');
});

test('an inverted empty search is inert, not a filter that matches nothing', async () => {
  const { rows } = await run(['cat', 'dog'],
    [{ tool: 'search', params: { pattern: '' }, invert: true }]);
  assert.deepEqual(norms(rows), ['cat', 'dog']);
});

test('invert composes downstream of a transform', async () => {
  const { rows } = await run(['swing', 'wing', 'sting', 'ting'], [
    { tool: 'behead', params: { count: '1' } },
    { tool: 'search', params: { pattern: 'w*' }, invert: true },
  ]);
  assert.deepEqual(norms(rows), ['ting']);
});

// ─── Flat-tier re-materialization ────────────────────────────────────────────
// The harness's buffered run() never calls materializeFlatRow, so this agreement
// with currentAtomCount is the flat re-materialization path's only guard.

const materializedAtoms = (probe, ...rows) =>
  materializeFlatRow(wlEntry(probe), compileFlatHighlighters(rows)).atoms.length;

test('materializeFlatRow reserves currentAtomCount lines through an inverted filter', () => {
  const cases = [
    ['regex then inverted search', 'dog',
      makeToolRow('regex', { pattern: 'd.g' }), makeToolRow('search', { pattern: 'c?t' }, false, true)],
    ['search then inverted search', 'dog',
      makeToolRow('search', { pattern: 'd*' }), makeToolRow('search', { pattern: 'c?t' }, false, true)],
    ['regex then inverted regex', 'dog',
      makeToolRow('regex', { pattern: 'd.g' }), makeToolRow('regex', { pattern: 'c.t' }, false, true)],
    ['inverted search alone', 'dog',
      makeToolRow('search', { pattern: 'c?t' }, false, true)],
  ];
  for (const [name, probe, ...rows] of cases) {
    assert.equal(materializedAtoms(probe, ...rows), currentAtomCount(rows), name);
  }
});

// ─── Grouped filters: the !any quantifier ────────────────────────────────────

test('an inverted grouped filter drops every cluster the pattern touched', async () => {
  const gs = await groups(['level', 'rotor', 'ape', 'pea'], [
    { tool: 'cryptogram', grouped: true },
    { tool: 'search', params: { pattern: 'level' }, invert: true },
  ]);
  assert.equal(gs.length, 1);
  assert.deepEqual(gs[0].chains.map(c => c[0]).sort(), ['ape', 'pea']);
});

// `any(!match)` — negating per-member as the flat path does — would keep this
// cluster, since `rotor` doesn't match. The stage negates as a whole instead.
test('a cluster survives only when NO member matches, not when some member misses', async () => {
  const gs = await groups(['level', 'rotor'], [
    { tool: 'cryptogram', grouped: true },
    { tool: 'search', params: { pattern: 'level' }, invert: true },
  ]);
  assert.equal(gs.length, 0);
});

test('inverted grouped members are tagged matched so the score gate keeps them', async () => {
  const { rows } = await run(['level', 'rotor', 'ape', 'pea'], [
    { tool: 'cryptogram', grouped: true },
    { tool: 'search', params: { pattern: 'level' }, invert: true },
  ]);
  assert.equal(rows.length, 1);
  for (const c of rows[0].chains) assert.equal(c.matched, true);
});

// ─── The filter-kind gate ────────────────────────────────────────────────────

test('inverted() ignores the flag on a row whose params make it a transform', () => {
  const row = makeToolRow('search', { pattern: 'cat', replace: 'dog' }, false, true);
  assert.equal(row.kind(), 'transform');
  assert.equal(row.invert, true, 'the raw flag is untouched');
  assert.equal(row.inverted(), false, 'but no reader honors it');
});

test('inverted() ignores the flag on an all-mode group row', () => {
  const row = makeToolRow('cryptogram', {}, true, true);
  assert.equal(row.kind(), 'group');
  assert.equal(row.inverted(), false);
});

test('a stray invert on a transform row leaves the transform running', async () => {
  const { rows } = await run(['swing', 'wing'],
    [{ tool: 'behead', params: { count: '1' }, invert: true }]);
  assert.deepEqual(norms(rows), ['wing']);
});
