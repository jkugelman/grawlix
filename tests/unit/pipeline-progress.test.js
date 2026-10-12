import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executePipeline, configureExecutorYield, makeRunProgress, plannedPasses } from '../../site/src/engine/executor.js';
import { makeToolRow } from '../../site/src/engine/tools.js';
import { setCmuDict } from '../../site/src/engine/phonetics.js';
import { setUnigramCorpus, invalidateUnigramCorpus } from '../../site/src/engine/segmenter.js';
import { merged } from './tools/harness.js';

const unthrottled = async fn => {
  configureExecutorYield({ intervalMs: 0, progressIntervalMs: 0 });
  try { return await fn(); } finally { configureExecutorYield({ intervalMs: 6, progressIntervalMs: 120 }); }
};

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('a grouped sweep reports progress as a rising 0..1 fraction', () => unthrottled(async () => {
  const wl = merged(['lives', 'elvis', 'levis', 'evils', 'tops', 'pots', 'opt']);
  const fractions = [];
  await executePipeline(wl, [makeToolRow('anagrams', {}, true)], null, { onProgress: f => fractions.push(f) });

  assert.ok(fractions.length > 0, 'progress was reported during the bucketize sweep');
  assert.ok(fractions.every(f => f >= 0 && f <= 1), 'every fraction is within [0, 1]');
  assert.ok(fractions.some(f => near(f, 0.5)), 'reaches the end of the key sweep, half the planned weight');
  for (let i = 1; i < fractions.length; i++) {
    assert.ok(fractions[i] >= fractions[i - 1], 'fractions never decrease');
  }
}));

test('omitting the progress callback is a silent no-op', async () => {
  await executePipeline(merged(['lives', 'elvis']), [makeToolRow('anagrams', {}, true)], null);
});

// ─── One ring per run ─────────────────────────────────────────────────────────

const A = { key: 'a', weight: 6 }, B = { key: 'b', weight: 2 }, C = { key: 'c', weight: 1 };

test('each pass fills its weighted slice of one run-wide ring', () => unthrottled(() => {
  const shown = [];
  const run = makeRunProgress(f => shown.push(f));
  run.plan([A, B, C]);
  run.progress(A, 0.5);
  run.passDone(A, true);
  run.progress(B, 0.5);
  run.passDone(B, true);
  run.progress(C, 1);
  run.passDone(C, true);
  const expected = [3 / 9, 6 / 9, 7 / 9, 8 / 9, 1, 1];
  assert.equal(shown.length, expected.length);
  shown.forEach((f, i) => assert.ok(near(f, expected[i]), `${f} ≈ ${expected[i]}`));
}));

test('a pass that never yielded stays silent but still counts toward later slices', () => unthrottled(() => {
  const shown = [];
  const run = makeRunProgress(f => shown.push(f));
  run.plan([A, B, C]);
  run.passDone(A, false);
  assert.deepEqual(shown, []);
  run.progress(B, 0.5);
  assert.ok(near(shown[0], 7 / 9));
}));

test('an unplanned pass never slides the ring back', () => unthrottled(() => {
  const shown = [];
  const run = makeRunProgress(f => shown.push(f));
  run.plan([A]);
  run.progress(A, 0.5);
  run.progress(B, 0);   // widens the total to 8: (0 + 0) / 8 would read lower than 3/6
  assert.deepEqual(shown, [0.5, 0.5]);
}));

// ─── Planning ─────────────────────────────────────────────────────────────────

function memoryCache() {
  const store = new Map();
  const puts = [];
  return {
    puts,
    get: key => store.get(key) ?? null,
    peek: key => store.get(key) ?? null,
    take(key) { const v = store.get(key) ?? null; store.delete(key); return v; },
    put(key, value) { store.set(key, value); puts.push(key); },
  };
}

const seedPhonetics = () => {
  setCmuDict({
    CAT: ['K AE1 T'], BAT: ['B AE1 T'], DOG: ['D AO1 G'], HOT: ['HH AA1 T'], DOT: ['D AA1 T'],
    DESERT: ['D EH1 Z ER0 T', 'D IH0 Z ER1 T'], DESSERT: ['D IH0 Z ER1 T'],
  });
  setUnigramCorpus({ hot: -3, dog: -3, cat: -3, bat: -4 });
};

const WORDS = ['cat', 'bat', 'dog', 'hotdog', 'catbat', 'desert', 'dessert', 'hot dog'];

// Every artifact a run builds is a pass it planned, and every planned artifact
// pass is built: a mismatch either restarts the ring or leaves a slice unfilled.
const SWEEPERS = [
  ['search, whole word', 'search', { pattern: 'dog', mode: 'word' }, false],
  ['regex, whole word', 'regex', { pattern: 'dog', mode: 'word' }, false],
  ['rhymes', 'rhymes', { entry: 'hat' }, false],
  ['rhymes ✱', 'rhymes', {}, true],
  ['initialisms ✱', 'initialisms', {}, true],
  ['phone search', 'phone_search', { entry: 'dog' }, false],
  ['phone search, replace', 'phone_search', { entry: 'dog', replace: 'cat' }, false],
  ['stress shift', 'stress_shift', {}, true],
];

for (const [label, tool, params, grouped] of SWEEPERS) {
  test(`${label}: the artifacts it builds are exactly the passes it plans`, async () => {
    seedPhonetics();
    try {
      const cache = memoryCache();
      const stack = [makeToolRow(tool, params, grouped)];
      const planned = new Set(plannedPasses(stack, 0, cache).map(p => p.artifact ?? p.key).filter(k => typeof k === 'string'));
      await executePipeline(merged(WORDS), stack, null, { prepareCache: cache });
      assert.deepEqual([...new Set(cache.puts)].sort(), [...planned].sort());
    } finally {
      invalidateUnigramCorpus();
    }
  });
}

test('a built artifact drops out of the next run’s plan', async () => {
  seedPhonetics();
  try {
    const cache = memoryCache();
    const stack = [makeToolRow('stress_shift', {}, true)];
    assert.equal(plannedPasses(stack, 0, cache).length, 5);
    await executePipeline(merged(WORDS), stack, null, { prepareCache: cache });
    const again = plannedPasses(stack, 0, cache);
    assert.ok(again.length === 2 && again.every(p => typeof p.key === 'symbol'), 'only the bucketize passes are left');
  } finally {
    invalidateUnigramCorpus();
  }
});

test('rows a resumed prefix covers plan no passes', () => {
  seedPhonetics();
  try {
    const stack = [makeToolRow('rhymes', { entry: 'hat' }), makeToolRow('anagrams', {}, true)];
    const passes = plannedPasses(stack, 1, memoryCache());
    assert.ok(passes.length === 2 && passes.every(p => typeof p.key === 'symbol'));
  } finally {
    invalidateUnigramCorpus();
  }
});
