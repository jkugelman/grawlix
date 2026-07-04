import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executePipeline, rowLastEntry } from '../../site/src/engine/executor.js';
import umiaqTool from '../../site/src/engine/tools/umiaq.js';

function toolRow(def, params) {
  return {
    tool: 'umiaq', def, params, grouped: false,
    kind: () => (typeof def.kind === 'function' ? def.kind(params, false) : def.kind),
    isInert: () => (def.isInert ? def.isInert(params) : false),
    glyph: () => (def.glyph ? def.glyph(params) : null),
  };
}

const inertSearch = {
  tool: 'search', def: { inputHighlights: true }, params: {}, grouped: false,
  kind: () => 'filter', isInert: () => true, glyph: () => null,
};

function mergedWordlist(norms) {
  const entries = norms.map((n, i) => ({ norm: n, display: null, score: 100 - i, comment: '', _i: i }));
  return { entries, byNorm: new Map(entries.map(e => [e.norm, e])) };
}

async function run(query, norms) {
  const wl = mergedWordlist(norms);
  return executePipeline(wl, [toolRow(umiaqTool, { query: query }), inertSearch], null, null);
}

test('pipeline: a single-pattern query is an arity-1 filter', async () => {
  const res = await run('c?t', ['cat', 'cot', 'dog', 'cut']);
  assert.equal(res.laneKind, 'single');
  assert.equal(res.atomCount, 1);
  assert.deepEqual(res.rows.map(r => rowLastEntry(r).norm).sort(), ['cat', 'cot', 'cut']);
});

test('pipeline: a single variable pattern filters per word', async () => {
  const res = await run('AA', ['gaga', 'mama', 'cat', 'tutu']);
  assert.equal(res.laneKind, 'single');
  assert.deepEqual(res.rows.map(r => rowLastEntry(r).norm).sort(), ['gaga', 'mama', 'tutu']);
});

test('pipeline: a multi-pattern query produces arity-N tuples', async () => {
  const res = await run('AB;BA', ['ape', 'pea', 'bro', 'rob', 'dog']);
  assert.equal(res.laneKind, 'record');
  assert.equal(res.atomCount, 1);
  const tuples = res.rows.map(g => g.chains.map(c => rowLastEntry(c).norm))
    .sort((a, b) => a.join().localeCompare(b.join()));
  assert.deepEqual(tuples, [['ape', 'pea'], ['bro', 'rob'], ['pea', 'ape'], ['rob', 'bro']]);
});

test('pipeline: each tuple is a multi-lane row, one single-atom chain per lane', async () => {
  const res = await run('AB;BA;|A|=1', ['ape', 'pea']);
  assert.equal(res.rows.length, 1);
  const tuple = res.rows[0];
  assert.equal(tuple.chains.length, 2);
  for (const chain of tuple.chains) assert.equal(chain.atoms.length, 1);
  assert.equal(tuple._count, 2);
});

test('pipeline: an empty or invalid query is inert (transparent)', async () => {
  for (const q of ['', '/abc']) {
    const res = await run(q, ['cat', 'dog']);
    assert.equal(res.laneKind, 'single');
    assert.deepEqual(res.rows.map(r => rowLastEntry(r).norm).sort(), ['cat', 'dog']);
  }
});

test('pipeline: a non-capped tuple run reports capped false', async () => {
  const res = await run('AB;BA', ['ape', 'pea', 'bro', 'rob']);
  assert.equal(res.capped, false);
});

test('pipeline: a tuple run that hit its ceiling propagates capped through the result', async () => {
  const wl = mergedWordlist(['ape', 'pea']);
  const stubTupleTool = {
    kind: () => 'tuple', isInert: () => false,
    prepare: p => p, findTuples: () => ({ tuples: [], capped: true }),
  };
  const res = await executePipeline(wl, [toolRow(stubTupleTool, {}), inertSearch], null, null);
  assert.equal(res.capped, true);
});

test('error: a broken query reports its message; a valid or half-typed one is silent', () => {
  assert.match(umiaqTool.error({ query: 'a.b' }), /unexpected character/);
  assert.match(umiaqTool.error({ query: 'a[bc' }), /unclosed/);
  assert.equal(umiaqTool.error({ query: 'AB' }), null);
  assert.equal(umiaqTool.error({ query: '' }), null);
  assert.equal(umiaqTool.error({ query: 'AB;' }), null);
});
