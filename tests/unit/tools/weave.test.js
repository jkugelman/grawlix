import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeToolRow } from '../../../site/src/engine/tools.js';
import { executePipeline } from '../../../site/src/engine/executor.js';
import { configureWeave } from '../../../site/src/engine/tools/weave.js';
import { merged, run, rowWords } from './harness.js';

// `retainLimit` is module-global, so every streaming test sets it rather than
// inheriting whatever the previous one left behind.
async function streamWeave(specs, retainLimit) {
  configureWeave({ retainLimit });
  const batches = [];
  const out = await executePipeline(merged(specs), [makeToolRow('weave', {})], null,
    { emit: b => batches.push(b) });
  return { out, batches };
}

async function weaves(specs, params = {}) {
  const res = await run(specs, [{ tool: 'weave', params }]);
  assert.equal(res.laneKind, 'record');
  return res.rows.map(g => g.chains.map(rowWords).join(' = '))
    .sort((a, b) => a.localeCompare(b));
}

test('Weave finds an entry that splits into two interwoven entries', async () => {
  assert.deepEqual(await weaves(['wallsockets', 'wallet', 'socks', 'unrelated']),
    ['wallsockets = wallet = socks']);
});

test('a plain concatenation is not a weave — both halves stay contiguous', async () => {
  assert.deepEqual(await weaves(['birdfish', 'bird', 'fish']), []);
});

test('an insertion is not a weave — one part must not stay in one piece', async () => {
  // been = be|en wrapped around a contiguous ring: three runs, so it is Nested, not woven.
  assert.deepEqual(await weaves(['beringen', 'been', 'ring']), []);
});

test('runs are counted by the FEWEST an assignment achieves, not the most', async () => {
  // abababab is abab+abab end to end (2 runs), but repeated letters also admit a
  // 4-run reading. Scoring by the best-looking assignment would let it through.
  assert.deepEqual(await weaves(['abababab', 'abab']), []);
});

test('entries that are prefixes of other entries do not derail the descent', async () => {
  // wall/wallet and sock/socks: the shorter entry sits inside the longer one's
  // prefix range. A full merge is full of these; a fixture without one lets a
  // broken range search pass, then miss or crash on real data.
  assert.deepEqual(await weaves(['wallsockets', 'wallet', 'socks', 'wall', 'sock', 'wallets']),
    ['wallsockets = wallet = socks']);
});

test('a weave is reported once, not again with its two parts swapped', async () => {
  const rows = await weaves(['wallsockets', 'wallet', 'socks']);
  assert.equal(rows.length, 1);
});

test('parts shorter than the minimum are not woven', async () => {
  // asp + wit interleave to "awsipt", but both fall under the 4-letter floor.
  assert.deepEqual(await weaves(['awsipt', 'asp', 'wit']), []);
});

test('an entry parameter pins one side of the weave', async () => {
  const specs = ['wallsockets', 'wallet', 'socks', 'speedofsound', 'speedos', 'found'];
  assert.deepEqual(await weaves(specs, { entry: 'socks' }),
    ['wallsockets = wallet = socks']);
  assert.deepEqual(await weaves(specs, { entry: 'found' }),
    ['speedofsound = speedos = found']);
});

test('an entry parameter absent from the wordlist yields nothing', async () => {
  assert.deepEqual(await weaves(['wallsockets', 'wallet', 'socks'], { entry: 'zzzz' }), []);
});

test('a blank entry parameter scans the whole pool rather than going inert', async () => {
  assert.deepEqual(await weaves(['wallsockets', 'wallet', 'socks'], { entry: '' }),
    ['wallsockets = wallet = socks']);
});

test('the target lane is highlighted in two alternating colors covering every letter', async () => {
  const res = await run(['wallsockets', 'wallet', 'socks'], [{ tool: 'weave', params: {} }]);
  const target = res.rows[0].chains[0].atoms[0];
  const hl = target.highlights;
  assert.equal(hl.at(-1).end, 'wallsockets'.length);
  assert.equal(hl[0].start, 0);
  for (let i = 1; i < hl.length; i++) {
    assert.equal(hl[i].start, hl[i - 1].end, 'highlights must tile the entry with no gaps');
    assert.notEqual(hl[i].kind, hl[i - 1].kind, 'adjacent runs must alternate color');
  }
  assert.ok(hl.length >= 4, 'a weave has at least four alternating runs');
  assert.deepEqual([...new Set(hl.map(r => r.kind))].sort(), ['search:0', 'search:1']);
});

test('past the retain limit the stream is the only copy — terminal rows are empty', async () => {
  const { out, batches } = await streamWeave(['wallsockets', 'wallet', 'socks'], 0);
  assert.equal(out.laneKind, 'record');
  assert.equal(out.rows.length, 0, 'the tuple set must not be built a second time');
  assert.deepEqual(batches.flat().map(g => g.key), ['wallsockets wallet socks']);
});

test('under the retain limit rows survive, so the run stays prefix-cacheable', async () => {
  const { out, batches } = await streamWeave(['wallsockets', 'wallet', 'socks'], 50_000);
  assert.equal(out.rows.length, 1);
  assert.deepEqual(out.rows.map(g => g.key), batches.flat().map(g => g.key));
});

test('the two parts are carried as their own lanes so the score range can gate them', async () => {
  const res = await run([{ entry: 'wallsockets', score: 60 }, { entry: 'wallet', score: 50 },
    { entry: 'socks', score: 50 }], [{ tool: 'weave', params: {} }]);
  assert.equal(res.rows[0].chains.length, 3);
  assert.deepEqual(res.rows[0].chains.map(c => c.atoms[0].wlEntry.score), [60, 50, 50]);
});
