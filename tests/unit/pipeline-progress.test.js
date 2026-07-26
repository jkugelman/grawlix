import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executePipeline, configureExecutorYield } from '../../site/src/engine/executor.js';
import { makeToolRow } from '../../site/src/engine/tools.js';
import { merged } from './tools/harness.js';

// The only in-engine driver of the ring today is bucketize's ctx.forEach over a
// grouped run's chains — no tool prepare sweeps the corpus yet — so this uses
// grouped Anagrams, not a flat tool.

test('a grouped sweep reports progress as a rising 0..1 fraction', async () => {
  configureExecutorYield({ intervalMs: 0, progressIntervalMs: 0 });
  try {
    const wl = merged(['lives', 'elvis', 'levis', 'evils', 'tops', 'pots', 'opt']);
    const fractions = [];
    await executePipeline(wl, [makeToolRow('anagrams', {}, true)], null, { onProgress: f => fractions.push(f) });

    assert.ok(fractions.length > 0, 'progress was reported during the bucketize sweep');
    assert.ok(fractions.every(f => f >= 0 && f <= 1), 'every fraction is within [0, 1]');
    assert.ok(fractions.some(f => f === 1), 'reaches 1 once the whole working set is bucketed');
    for (let i = 1; i < fractions.length; i++) {
      assert.ok(fractions[i] >= fractions[i - 1], 'fractions never decrease');
    }
  } finally {
    configureExecutorYield({ intervalMs: 6, progressIntervalMs: 120 });
  }
});

test('omitting the progress callback is a silent no-op', async () => {
  await executePipeline(merged(['lives', 'elvis']), [makeToolRow('anagrams', {}, true)], null);
});
