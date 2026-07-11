import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUmiaqQuery, findTuples } from '../../site/src/engine/umiaq.js';

// The affix path (a driver that lacks a variable, chained to prefix-affix bindings)
// must be SET-IDENTICAL to the exhaustive bucket join — that parity is the whole
// point. `strategy: 'bucket'` forces the general path for the same query so the two
// can be compared directly; both are run uncapped and untruncated.

const entry = (norm, score = 100) => ({ norm, score });
const sortKey = ts => ts.map(t => t.map(l => l.entry.norm).join(',')).sort();

async function affixSet(query, norms) {
  const parsed = parseUmiaqQuery(query);
  assert.ok(parsed.ok, `query "${query}" should parse: ${parsed.error || ''}`);
  const pool = norms.map((n, i) => entry(n, norms.length - i));
  const { tuples } = await findTuples(parsed, pool, { numResults: 1e6, maxMatchesPerPattern: 1e9 });
  return { tuples, set: sortKey(tuples) };
}

async function bucketSet(query, norms) {
  const parsed = parseUmiaqQuery(query);
  const pool = norms.map((n, i) => entry(n, norms.length - i));
  const { tuples } = await findTuples(parsed, pool, { numResults: 1e6, maxMatchesPerPattern: 1e9, strategy: 'bucket' });
  return sortKey(tuples);
}

// The chained-affix family the affix path exists for: a driver binds A,B; a prefix
// binding grounds X off A; O(1) lookups verify X and XB. AandB is the motivating case.
const AFFIX_QUERIES = [
  'AandB;X;AX;XB',            // the motivating query
  'AandB;AX;XB;X',           // clause reorder — same solution set
  'AB;X;AX',                 // shorter chain: driver AB, prefix AX
  'AandB;X;AX;XB;A!=B',      // inequality across driver vars
  'AandB;X;AX;XB;|X|>=3',    // length floor on the grounded var
  'AandB;X;AX;XB;|X|<=3',    // length ceiling
  'AandB;X;AX;XB;X=#@#',     // sub-pattern on the grounded var
  'AandB;X;AX;XB;X!=A',      // grounded var unequal to a driver var
  'AandB;X;A~X;XB',          // reversed free var in the prefix binding
  'AandB;X;7:AX;XB',         // binding-level wordLen on the scanned (enumerator) binding
  'AandB;X;AX;7:XB',         // binding-level wordLen on a verifier (probe) binding
  'AandB;X;AX;XB;|AB|>=6',   // cross-binding sumLen over driver vars
  'AinB;X;AX;XB',            // a different literal infix in the driver
  'catX;X;dogX',             // literal-prefix driver, no free driver var chain
];

const CORPUS = [
  'cockandbull', 'pit', 'cockpit', 'pitbull',
  'armcandy', 'hair', 'armchair', 'hairy',
  'ratandmouse', 'race', 'ratrace', 'racemouse',
  'and', 'cock', 'bull', 'candy', 'chair', 'mouse',
  'catnap', 'nap', 'dognap', 'catfish', 'fish', 'dogfish',
  'catin', 'inbox', 'box', 'catbox', 'inandout', 'out', 'inout',
  'ab', 'abc', 'bc', 'c', 'xy', 'xyz',
];

for (const q of AFFIX_QUERIES) {
  test(`affix parity: ${q} matches the bucket join`, async () => {
    const { tuples } = await affixSet(q, CORPUS);
    const affix = sortKey(tuples);
    const bucket = await bucketSet(q, CORPUS);
    assert.deepEqual(affix, bucket, `affix and bucket sets differ for "${q}"`);
  });
}

test('affix: the motivating query finds cock-and-bull', async () => {
  const { set } = await affixSet('AandB;X;AX;XB', CORPUS);
  assert.ok(set.includes('cockandbull,pit,cockpit,pitbull'),
    'expected cock and bull | pit | cockpit | pitbull');
  assert.ok(set.includes('armcandy,hair,armchair,hairy'));
  assert.ok(set.includes('ratandmouse,race,ratrace,racemouse'));
});

test('affix: lanes restore user binding order, not solver order', async () => {
  // Solver order drives AandB, then grounds X off AX, then probes XB and X — but the
  // emitted tuple must read in the query's clause order: [AandB, X, AX, XB].
  const { tuples } = await affixSet('AandB;X;AX;XB', CORPUS);
  const t = tuples.find(t => t[0].entry.norm === 'cockandbull');
  assert.ok(t);
  assert.deepEqual(t.map(l => l.entry.norm), ['cockandbull', 'pit', 'cockpit', 'pitbull']);
});

test('affix: tuples carry per-variable highlights', async () => {
  const { tuples } = await affixSet('AandB;X;AX;XB', CORPUS);
  const t = tuples.find(t => t[0].entry.norm === 'cockandbull');
  assert.ok(t[1].highlights && t[1].highlights.length, 'X lane highlighted');
  assert.ok(t[2].highlights && t[2].highlights.length, 'AX lane highlighted');
});

test('affix: best-first driver order surfaces the highest-score tuple first under a cap', async () => {
  // cockandbull is the top-scored driver word, so a cap of 1 keeps its tuple and drops
  // the lower-scored armcandy/ratandmouse ones — the anti-truncation guarantee.
  const parsed = parseUmiaqQuery('AandB;X;AX;XB');
  const pool = CORPUS.map((n, i) => entry(n, CORPUS.length - i));   // cockandbull scores highest
  const { tuples, capped } = await findTuples(parsed, pool, { numResults: 1 });
  assert.equal(tuples.length, 1);
  assert.equal(capped, true);
  assert.equal(tuples[0][0].entry.norm, 'cockandbull');
});

test('affix: stays exhaustive under a cap that truncates the bucket path', async () => {
  const parsed = parseUmiaqQuery('AandB;X;AX;XB');
  const pool = CORPUS.map((n, i) => entry(n, CORPUS.length - i));
  // A cap of 50 is far above the handful of "X and Y" driver words but well below the
  // whole-corpus matches a free-affix binding (AX, XB) produces on the bucket path.
  const opts = { numResults: 1e6, maxMatchesPerPattern: 50 };
  assert.equal((await findTuples(parsed, pool, opts)).truncated, false, 'affix exhaustive');
  assert.equal((await findTuples(parsed, pool, { ...opts, strategy: 'bucket' })).truncated, true, 'bucket truncates');
});

test('affix: a zero-length driver var degrades but stays correct', async () => {
  // |A|>=0 lets A be empty; the prefix scan for AX then degenerates to the whole
  // corpus but must still find every valid tuple (parity with the bucket join).
  const norms = ['and', 'x', 'x', 'andx', 'xand', 'z'];
  const uniq = ['and', 'x', 'andx', 'xand', 'z'];
  const { tuples } = await affixSet('AandB;X;AX;XB;|A|>=0;|B|>=0', uniq);
  const affix = sortKey(tuples);
  const bucket = await bucketSet('AandB;X;AX;XB;|A|>=0;|B|>=0', uniq);
  assert.deepEqual(affix, bucket);
});

test('affix: a query with no incremental grounding falls back to the bucket path', async () => {
  // Disjoint variable sets — C,D are reachable from neither A nor B by any affix — so no
  // affix plan exists and this declines to the (truncating) bucket path.
  const parsed = parseUmiaqQuery('AB;CD');
  const pool = ['abc', 'dbc'].map(n => entry(n, 100));
  const { truncated } = await findTuples(parsed, pool, { maxMatchesPerPattern: 1 });
  assert.equal(truncated, true);
});

// B1b: a free variable reachable only as a suffix (`XB`, X leading, B ground) is grounded
// by a suffix scan over the reversed-norm index. AB;CB is the design's documented hard
// case (design.md § the tuple tier) — under-constrained, it exploded the bucket path.
const SUFFIX_QUERIES = [
  'AB;CB',                   // shared-suffix pairs — the documented hard case
  'AandB;X;XB;AX',           // XB reordered before AX: X grounds via suffix B
  'AandB;X;XB;AX;|X|>=3',    // length floor on the suffix-grounded var
  'AandB;X;XB;AX;X!=A',      // suffix-grounded var unequal to a driver var
  'AandB;X;~XB;AX',          // reversed free var leading a suffix binding
  'AandB;X;9:XB;AX',         // binding-level wordLen on the suffix binding
];

for (const q of SUFFIX_QUERIES) {
  test(`affix parity (suffix): ${q} matches the bucket join`, async () => {
    const { tuples } = await affixSet(q, CORPUS);
    assert.deepEqual(sortKey(tuples), await bucketSet(q, CORPUS), `sets differ for "${q}"`);
  });
}

test('affix: AB;CB (the documented hard case) no longer explodes — CB is index-resolved', async () => {
  // On the bucket path CB matched the whole corpus in every split and truncated. Here CB
  // is a suffix scan, so on a bounded pool the run is exhaustive (a full corpus can still
  // overflow the non-selective AB driver — that's inherent under-constraint, not explosion).
  const parsed = parseUmiaqQuery('AB;CB');
  const pool = ['batman', 'catman', 'man', 'batboy', 'catboy', 'boy', 'xyz'].map((n, i) => entry(n, 100 - i));
  const { tuples, truncated } = await findTuples(parsed, pool, { numResults: 1e6, maxMatchesPerPattern: 1e9 });
  assert.equal(truncated, false, 'exhaustive on this bounded pool — no per-pattern explosion');
  const set = sortKey(tuples);
  assert.ok(set.includes('batman,catman'), 'bat+man / cat+man share the "man" suffix');
  assert.ok(set.includes('batboy,catboy'), 'bat+boy / cat+boy share the "boy" suffix');
});

test('affix: the selective side is scanned when a var has both a prefix and a suffix introducer', async () => {
  // AandB;X;AX;XB grounds X via AX (prefix A) OR XB (suffix B); both give the same set.
  // A short A (broad prefix) vs a long B (narrow suffix) must not change the result.
  const { tuples } = await affixSet('AandB;X;AX;XB', CORPUS);
  assert.deepEqual(sortKey(tuples), await bucketSet('AandB;X;AX;XB', CORPUS));
});

test('affix: streamed batches equal the buffered result', async () => {
  // Streaming authority: the onBatch stream must be byte-identical to the buffered
  // tuples (same emission order, same set) — the terminal only adopts the stream.
  const parsed = parseUmiaqQuery('AandB;X;AX;XB');
  const pool = CORPUS.map((n, i) => entry(n, CORPUS.length - i));
  const streamed = [];
  const { tuples } = await findTuples(parsed, pool, { numResults: 1e6, onBatch: async batch => { streamed.push(...batch); } });
  assert.deepEqual(
    streamed.map(t => t.map(l => l.entry.norm)),
    tuples.map(t => t.map(l => l.entry.norm)),
  );
});
