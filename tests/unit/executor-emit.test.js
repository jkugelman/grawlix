import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeToolRow } from '../../site/src/engine/tools.js';
import { toNorm } from '../../site/src/engine/norm.js';
import {
  executePipeline,
  configureExecutorYield,
  rowLastEntry,
  streamPlan,
} from '../../site/src/engine/executor.js';

const wlEntry = s => {
  const norm = toNorm(s);
  return { norm, display: norm === s ? null : s, score: 0, comment: '' };
};

function makeCorpus(words) {
  const entries = words.map(wlEntry);
  const byNorm = new Map();
  for (const e of entries) if (!byNorm.has(e.norm)) byNorm.set(e.norm, e);
  return { entries, byNorm };
}

const MATCHING = Array.from({ length: 200 }, (_, i) => `un${String(i).padStart(4, '0')}ed`);

const projectRow = r => r.atoms.map(a => ({ norm: a.wlEntry.norm, highlights: a.highlights, glyph: a.glyph }));
const tailNorm = r => rowLastEntry(r).norm;

// intervalMs 0 makes every sampled yield gate due, so flushes fire across the
// scan instead of being collapsed into one tail batch by the real 6ms budget.
function forceDeterministicYields() {
  configureExecutorYield({ yieldImpl: () => Promise.resolve(), intervalMs: 0 });
}

// Executor yield config is module-global; restore the shipped defaults so a
// forced 0ms interval doesn't leak into later tests.
const defaultYield = () => new Promise(r => setTimeout(r, 0));
afterEach(() => {
  configureExecutorYield({ yieldImpl: defaultYield, intervalMs: 6 });
});

test('emit: a flat search streams disjoint batches that concatenate to the returned rows in order', async () => {
  forceDeterministicYields();

  const batches = [];
  const result = await executePipeline(
    makeCorpus(MATCHING), [makeToolRow('search', { pattern: 'UN*ED' })], null,
    b => batches.push(b),
  );

  assert.equal(result.laneKind, 'single', 'fixture must be a flat (ungrouped) run');
  assert.ok(batches.length >= 2, `expected >= 2 emit calls, got ${batches.length}`);

  const flat = batches.flat();
  assert.equal(new Set(flat).size, flat.length, 'a row was emitted in more than one batch');

  assert.deepEqual(flat.map(tailNorm), result.rows.map(tailNorm));
  assert.equal(flat.length, result.rows.length);
});

test('emit: a transform stack (behead) streams its rows', async () => {
  forceDeterministicYields();

  // scat→cat, brat→rat, plice→lice behead into corpus members. Behead produces no
  // mirror pairs, so the raw emitted rows union exactly to the unify'd result.
  const corpus = makeCorpus(['scat', 'cat', 'brat', 'rat', 'plice', 'lice']);
  const batches = [];
  const result = await executePipeline(
    corpus, [makeToolRow('behead', { count: '1' })], null,
    b => batches.push(b),
  );

  assert.ok(result.rows.length > 0, 'behead fixture matched nothing');
  assert.ok(result.rows.every(r => r.atoms && r.atoms.length >= 2), 'expected rich transform rows');
  assert.ok(batches.length >= 1, 'a transform run must stream');

  const emitted = batches.flat();
  assert.equal(new Set(emitted).size, emitted.length, 'a row was emitted in more than one batch');
  assert.deepEqual(emitted.map(tailNorm).sort(), result.rows.map(tailNorm).sort());
});

test('emit: a tuple run streams tuple-group batches that union to the returned groups', async () => {
  forceDeterministicYields();

  const corpus = makeCorpus(['ape', 'pea', 'bro', 'rob', 'sky', 'sly', 'gaga']);
  const batches = [];
  const result = await executePipeline(
    corpus, [makeToolRow('umiaq', { patterns: 'AB;BA' })], null,
    b => batches.push(b),
  );

  assert.equal(result.laneKind, 'record', 'fixture must be a tuple run');
  assert.ok(batches.length >= 1, 'emit must fire for a tuple run');

  const emittedKeys = batches.flat().map(g => g.key);
  assert.equal(new Set(emittedKeys).size, emittedKeys.length, 'a tuple was emitted in more than one batch');
  assert.deepEqual([...emittedKeys].sort(), result.rows.map(g => g.key).sort());
});

test('streamPlan: a tuple run streams as a tuple, with a filter tail as downstream stages', () => {
  const umiaq = makeToolRow('umiaq', { patterns: 'AB;BA' });
  const filter = makeToolRow('search', { pattern: 'pea' });
  const transform = makeToolRow('behead', { count: '1' });
  const group = makeToolRow('cryptogram', {}, true);
  const caesar = makeToolRow('caesar', { entry: 'abc', shift: '1' });

  const withFilter = streamPlan([umiaq, filter]);
  assert.equal(withFilter.tier, 'tuple');
  assert.equal(withFilter.producer, umiaq, 'the tuple producer, not the filter, is the producer');
  assert.deepEqual(withFilter.downstream, [filter]);

  const withCaesar = streamPlan([umiaq, caesar]);
  assert.equal(withCaesar.tier, 'tuple', 'an arity-2 prepare (reads ctx, not the stage input) still streams');
  assert.deepEqual(withCaesar.downstream, [caesar]);

  const lastTuple = streamPlan([umiaq]);
  assert.equal(lastTuple.tier, 'tuple');
  assert.equal(lastTuple.producer, umiaq);
  assert.deepEqual(lastTuple.downstream, []);

  assert.equal(streamPlan([umiaq, transform]).tier, null, 'a transform after a tuple run is not streamed (v1)');
  assert.equal(streamPlan([umiaq, group]).tier, null, 'a group tail suppresses the stream');

  const lastTransform = streamPlan([transform]);
  assert.equal(lastTransform.tier, 'transform', 'a bare transform streams');
  assert.equal(lastTransform.producer, transform);
  assert.equal(streamPlan([filter, transform]).tier, 'transform', 'a transform after a filter streams');
  assert.equal(streamPlan([transform, filter]).tier, null, 'a filter after a transform is not streamed (v1)');

  const flat = streamPlan([filter]);
  assert.equal(flat.tier, 'flat');
  assert.equal(flat.producer, filter);
});

test('emit: a tuple run with a downstream filter streams ONLY the filtered tuples', async () => {
  forceDeterministicYields();

  const corpus = () => makeCorpus(['ape', 'pea', 'bro', 'rob', 'gaga']);
  const umiaq = () => makeToolRow('umiaq', { patterns: 'AB;BA' });

  const unfiltered = await executePipeline(corpus(), [umiaq()], null);
  const unfilteredKeys = new Set(unfiltered.rows.map(g => g.key));

  const batches = [];
  const result = await executePipeline(
    corpus(), [umiaq(), makeToolRow('search', { pattern: 'pea' })], null,
    b => batches.push(b),
  );

  assert.equal(result.laneKind, 'record', 'must be a tuple run');
  assert.ok(batches.length >= 1, 'a filtered tuple run must still stream');

  const finalKeys = result.rows.map(g => g.key);
  assert.ok(finalKeys.length > 0 && finalKeys.length < unfilteredKeys.size,
    'the filter must drop some tuples but keep some, else the test is vacuous');

  const emittedKeys = batches.flat().map(g => g.key);
  assert.equal(new Set(emittedKeys).size, emittedKeys.length, 'a tuple was emitted in more than one batch');
  assert.deepEqual([...new Set(emittedKeys)].sort(), [...finalKeys].sort(),
    'the streamed set must equal the final filtered set — no raw over-set, nothing dropped at completion');
});

test('emit: a ctx-reading filter (caesar) streams after a tuple run, matching the buffered result', async () => {
  forceDeterministicYields();

  const corpus = makeCorpus(['bcd', 'cdb', 'pqr', 'qrp']);
  const batches = [];
  const result = await executePipeline(
    corpus, [makeToolRow('umiaq', { patterns: 'AB;BA' }), makeToolRow('caesar', { entry: 'abc', shift: '1' })], null,
    b => batches.push(b),
  );

  assert.equal(result.laneKind, 'record', 'must be a tuple run');
  assert.ok(batches.length >= 1, 'a ctx-reading filter must still stream after a tuple run');
  assert.ok(result.rows.length > 0 && result.rows.every(g => g.chains.some(c => tailNorm(c) === 'bcd')),
    'every surviving tuple carries the target lane');

  const emittedKeys = batches.flat().map(g => g.key);
  assert.deepEqual([...new Set(emittedKeys)].sort(), result.rows.map(g => g.key).sort());
});

test('emit: a grouped stack is gated off — emit is never called', async () => {
  forceDeterministicYields();

  const corpus = makeCorpus(['scat', 'cat', 'brat', 'rat', 'plice', 'lice']);
  const batches = [];
  const result = await executePipeline(
    corpus, [makeToolRow('cryptogram', {}, true)], null,
    b => batches.push(b),
  );

  assert.equal(result.laneKind, 'set', 'fixture must be a grouped run');
  assert.equal(batches.length, 0, 'emit must not fire for a grouped run');
});

test('no-emit: the returned rows are identical to those of an emitting run (additive seam)', async () => {
  forceDeterministicYields();

  const stack = () => [makeToolRow('search', { pattern: 'UN*ED' })];

  const buffered = await executePipeline(makeCorpus(MATCHING), stack(), null);

  const streamed = await executePipeline(makeCorpus(MATCHING), stack(), null, () => {});

  assert.equal(buffered.rows.length, MATCHING.length, 'no-emit run must return the full flat result');
  assert.deepStrictEqual(streamed.rows.map(projectRow), buffered.rows.map(projectRow));
});
