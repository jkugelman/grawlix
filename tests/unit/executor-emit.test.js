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

  // Norm-sorted like the real corpus: the executor binary-searches entries to
  // resolve a transform output to every spelling of its norm (see harness.js).
  entries.sort((a, b) => a.norm < b.norm ? -1 : a.norm > b.norm ? 1
    : (a.display ?? '').localeCompare(b.display ?? ''));
  return { entries, norms: new Set(entries.map(e => e.norm)) };
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
    { emit: b => batches.push(b) },
  );

  assert.equal(result.laneKind, 'single', 'fixture must be a flat (ungrouped) run');
  assert.ok(batches.length >= 2, `expected >= 2 emit calls, got ${batches.length}`);

  const flat = batches.flat();
  assert.equal(new Set(flat).size, flat.length, 'a row was emitted in more than one batch');

  assert.deepEqual(flat.map(tailNorm), result.rows.map(tailNorm));
  assert.equal(flat.length, result.rows.length);
});

test('emit: a transform stack (head_off) streams its rows', async () => {
  forceDeterministicYields();

  // scat→cat, brat→rat, plice→lice head_off into corpus members. head_off produces no
  // mirror pairs, so the raw emitted rows union exactly to the unify'd result.
  const corpus = makeCorpus(['scat', 'cat', 'brat', 'rat', 'plice', 'lice']);
  const batches = [];
  const result = await executePipeline(
    corpus, [makeToolRow('head_off', { pattern: '?' })], null,
    { emit: b => batches.push(b) },
  );

  assert.ok(result.rows.length > 0, 'head_off fixture matched nothing');
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
    corpus, [makeToolRow('umiaq', { query: 'AB;BA' })], null,
    { emit: b => batches.push(b) },
  );

  assert.equal(result.laneKind, 'record', 'fixture must be a tuple run');
  assert.ok(batches.length >= 1, 'emit must fire for a tuple run');

  const emittedKeys = batches.flat().map(g => g.key);
  assert.equal(new Set(emittedKeys).size, emittedKeys.length, 'a tuple was emitted in more than one batch');
  assert.deepEqual([...emittedKeys].sort(), result.rows.map(g => g.key).sort());
});

test('streamPlan: a tuple run streams as a tuple, with a filter tail as downstream stages', () => {
  const umiaq = makeToolRow('umiaq', { query: 'AB;BA' });
  const filter = makeToolRow('search', { pattern: 'pea' });
  const transform = makeToolRow('head_off', { pattern: '?' });
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

  const flat = streamPlan([filter]);
  assert.equal(flat.tier, 'flat');
  assert.equal(flat.producer, filter);
});

test('streamPlan: filters and transforms stream as one pipeline from the first stage that runs', () => {
  const f1 = makeToolRow('search', { pattern: 'UN*ED' });
  const f2 = makeToolRow('search', { pattern: 'UN*1*ED' });
  const transform = makeToolRow('head_off', { pattern: '?' });
  const inert = makeToolRow('search', { pattern: '' });

  const filters = streamPlan([f1, inert, f2]);
  assert.equal(filters.tier, 'flat');
  assert.equal(filters.producer, f1, 'the first filter produces, not the last');
  assert.deepEqual(filters.downstream, [f2], 'an inert row is skipped');

  const resumed = streamPlan([f1, f2], 1);
  assert.equal(resumed.producer, f2, 'a stage before the resume point never runs, so it cannot produce');

  const mixed = streamPlan([transform, f1]);
  assert.equal(mixed.tier, 'transform');
  assert.equal(mixed.producer, transform);
  assert.deepEqual(mixed.downstream, [f1]);
  assert.equal(streamPlan([f1, transform]).producer, f1);

  const reader = { ...f2, def: { ...f2.def, prepare: (params, ctx, input) => input.length } };
  assert.equal(streamPlan([f1, reader]).producer, reader,
    'a stage whose prepare reads its input must see the whole input, so the pipeline starts there');
});

test('emit: a tuple run with a downstream filter streams ONLY the filtered tuples', async () => {
  forceDeterministicYields();

  const corpus = () => makeCorpus(['ape', 'pea', 'bro', 'rob', 'gaga']);
  const umiaq = () => makeToolRow('umiaq', { query: 'AB;BA' });

  const unfiltered = await executePipeline(corpus(), [umiaq()], null);
  const unfilteredKeys = new Set(unfiltered.rows.map(g => g.key));

  const batches = [];
  const result = await executePipeline(
    corpus(), [umiaq(), makeToolRow('search', { pattern: 'pea' })], null,
    { emit: b => batches.push(b) },
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
    corpus, [makeToolRow('umiaq', { query: 'AB;BA' }), makeToolRow('caesar', { entry: 'abc', shift: '1' })], null,
    { emit: b => batches.push(b) },
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
    { emit: b => batches.push(b) },
  );

  assert.equal(result.laneKind, 'set', 'fixture must be a grouped run');
  assert.equal(batches.length, 0, 'emit must not fire for a grouped run');
});

test('no-emit: the returned rows are identical to those of an emitting run (additive seam)', async () => {
  forceDeterministicYields();

  const stack = () => [makeToolRow('search', { pattern: 'UN*ED' })];

  const buffered = await executePipeline(makeCorpus(MATCHING), stack(), null);

  const streamed = await executePipeline(makeCorpus(MATCHING), stack(), null, { emit: () => {} });

  assert.equal(buffered.rows.length, MATCHING.length, 'no-emit run must return the full flat result');
  assert.deepStrictEqual(streamed.rows.map(projectRow), buffered.rows.map(projectRow));
});

test('emit: a reverse transform (head on) streams each row exactly once', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(['catcall', 'all', 'cat cows', 'ows', 'cat cow', 'ow']);
  const batches = [];
  const result = await executePipeline(
    corpus, [makeToolRow('head_off', { pattern: 'catc' }, false, false, true)], null,
    { emit: b => batches.push(b) },
  );
  const flat = batches.flat();
  assert.equal(new Set(flat).size, flat.length, 'a row was emitted in more than one batch');
  assert.deepEqual([...flat.map(tailNorm)].sort(), [...result.rows.map(tailNorm)].sort());
  assert.equal(flat.length, result.rows.length);
});

// ─── Pipelined streaming ──────────────────────────────

function counted(row) {
  const counter = { calls: 0 };
  const run = row.def.run;
  row.def = { ...row.def, run: (...args) => { counter.calls++; return run(...args); } };
  return counter;
}

test('pipeline: a filter after a filter streams the filtered rows while the producer scans', async () => {
  forceDeterministicYields();

  const second = makeToolRow('search', { pattern: 'UN*1*ED' });
  const calls = counted(second);
  const batches = [];
  const result = await executePipeline(
    makeCorpus(MATCHING), [makeToolRow('search', { pattern: 'UN*ED' }), second], null,
    { emit: b => batches.push(b) },
  );

  assert.ok(batches.length >= 2, `expected >= 2 emit calls, got ${batches.length}`);
  const flat = batches.flat();
  assert.ok(flat.every(r => tailNorm(r).includes('1')), 'only rows past the second filter are emitted');
  assert.deepEqual(flat.map(tailNorm), result.rows.map(tailNorm));
  assert.equal(calls.calls, MATCHING.length, 'the downstream filter runs once per row, not again at the end');
});

test('pipeline: a filter after a transform streams, matching a buffered run', async () => {
  forceDeterministicYields();

  const corpus = () => makeCorpus(['scat', 'cat', 'brat', 'rat', 'plice', 'lice']);
  const stack = () => [makeToolRow('head_off', { pattern: '?' }), makeToolRow('search', { pattern: '?AT' })];
  const buffered = await executePipeline(corpus(), stack(), null);
  const batches = [];
  const streamed = await executePipeline(corpus(), stack(), null, { emit: b => batches.push(b) });

  assert.ok(buffered.rows.length > 0, 'fixture matched nothing');
  assert.ok(batches.length >= 1, 'a filter after a transform must stream');
  assert.deepEqual(batches.flat().map(tailNorm).sort(), streamed.rows.map(tailNorm).sort());
  assert.deepStrictEqual(streamed.rows.map(projectRow), buffered.rows.map(projectRow));
});

test('pipeline: a run resumed past the first stage streams from the stage it resumes at', async () => {
  forceDeterministicYields();

  const corpus = makeCorpus(MATCHING);
  const stack = () => [makeToolRow('search', { pattern: 'UN*ED' }), makeToolRow('search', { pattern: 'UN*1*ED' })];
  const offers = [];
  const cold = await executePipeline(corpus, stack(), null,
    { resume: { floorMs: 0, offer: (prefixLen, state) => offers.push({ prefixLen, state }) } });
  const tile = offers.find(o => o.prefixLen === 1);
  assert.ok(tile, 'the first stage must be offered as a tile');

  const batches = [];
  const resumed = await executePipeline(corpus, stack(), null,
    { emit: b => batches.push(b), resume: { seedState: tile.state, seedFrom: 1 } });
  assert.ok(batches.length >= 1, 'a resumed run must still stream');
  assert.deepEqual(batches.flat().map(tailNorm), resumed.rows.map(tailNorm));
  assert.deepStrictEqual(resumed.rows.map(projectRow), cold.rows.map(projectRow));
});

test('pipeline: tiles offered from a streamed run match a buffered run\'s', async () => {
  forceDeterministicYields();

  const corpus = makeCorpus(MATCHING);
  const stack = () => [
    makeToolRow('search', { pattern: 'UN*ED' }),
    makeToolRow('search', { pattern: 'UN*1*ED' }),
    makeToolRow('search', { pattern: 'UN*0*ED' }),
  ];
  const tiles = async emit => {
    const offers = [];
    await executePipeline(corpus, stack(), null,
      { emit, resume: { floorMs: 0, offer: (prefixLen, state) => offers.push({ prefixLen, rows: state.groups[0].chains.map(tailNorm) }) } });
    return offers;
  };
  const buffered = await tiles(null);
  assert.deepEqual(buffered.map(o => o.prefixLen), [1, 2]);
  assert.deepStrictEqual(await tiles(() => {}), buffered);
});

const leading = (pattern, lead) => {
  const row = makeToolRow('search', { pattern });
  row.def = { ...row.def, lead: () => lead };
  return row;
};

test('pipeline: the first stage\'s lead streams its rows first, as in a buffered run', async () => {
  forceDeterministicYields();

  const lead = 'un0150ed';
  const stack = () => [leading('UN*ED', lead), makeToolRow('search', { pattern: 'UN*1*ED' })];
  const buffered = await executePipeline(makeCorpus(MATCHING), stack(), null);
  const batches = [];
  const streamed = await executePipeline(makeCorpus(MATCHING), stack(), null, { emit: b => batches.push(b) });

  assert.equal(tailNorm(batches[0][0]), lead, 'the lead row streams first');
  assert.deepEqual(batches.flat().map(tailNorm), buffered.rows.map(tailNorm));
  assert.deepStrictEqual(streamed.rows.map(projectRow), buffered.rows.map(projectRow));
});

test('pipeline: a later stage\'s lead changes no order, tiles included', async () => {
  forceDeterministicYields();

  const stack = () => [makeToolRow('search', { pattern: 'UN*ED' }), leading('UN*ED', 'un0150ed'), makeToolRow('search', { pattern: 'UN*ED' })];
  const run = async emit => {
    const tiles = [];
    const out = await executePipeline(makeCorpus(MATCHING), stack(), null,
      { emit, resume: { floorMs: 0, offer: (prefixLen, state) => tiles.push({ prefixLen, rows: state.groups[0].chains.map(tailNorm) }) } });
    return { tiles, rows: out.rows.map(tailNorm) };
  };
  const buffered = await run(null);
  assert.deepEqual(buffered.rows, MATCHING, 'the lead is ignored away from the first stage');
  assert.deepStrictEqual(await run(() => {}), buffered);
});

test('pipeline: a lead after a transform orders a resumed run as a cold one', async () => {
  forceDeterministicYields();

  const words = ['scat', 'cat', 'brat', 'rat', 'plice', 'lice', 'xrat'];
  const stack = () => [makeToolRow('head_off', { pattern: '?' }), leading('?AT', 'rat'), makeToolRow('search', { pattern: '' })];
  const chains = out => out.rows.map(r => r.atoms.map(a => a.wlEntry.norm).join('>'));
  const offers = [];
  const cold = await executePipeline(makeCorpus(words), stack(), null,
    { emit: () => {}, resume: { floorMs: 0, offer: (prefixLen, state) => offers.push({ prefixLen, state }) } });
  const tile = offers.find(o => o.prefixLen === 1);
  const resumed = await executePipeline(makeCorpus(words), stack(), null,
    { emit: () => {}, resume: { seedState: tile.state, seedFrom: 1 } });
  const buffered = await executePipeline(makeCorpus(words), stack(), null);

  assert.ok(chains(cold).length > 1, 'fixture matched too little');
  assert.deepEqual(chains(resumed), chains(cold));
  assert.deepEqual(chains(buffered), chains(cold));
});

test('pipeline: a failing downstream stage marks its own row', async () => {
  forceDeterministicYields();

  const first = makeToolRow('search', { pattern: 'UN*ED' });
  const second = makeToolRow('search', { pattern: 'UN*ED' });
  second.def = { ...second.def, run: () => { throw new Error('boom'); } };
  const quiet = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      executePipeline(makeCorpus(MATCHING), [first, second], null, { emit: () => {} }),
      e => e.stackRow === second,
    );
  } finally {
    console.error = quiet;
  }
  assert.equal(first._error, null, 'the producer is not blamed');
  assert.equal(second._error, 'boom');
});
