import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, groups } from './tools/harness.js';
import { installFixtureTools } from '../../site/src/engine/fixture-tools.js';

// `prefix_group` keys an entry by its norm minus trailing digits: ab0/ab1 cluster
// under "ab", and digit-less entries join no group.
installFixtureTools();
const GROUP = { tool: 'prefix_group', grouped: true };

test('grouped: a chained search keeps the whole cluster when one member matches', async () => {
  const gs = await groups(['ab0', 'ab1', 'cat', 'dog'], [GROUP, { tool: 'search', params: { pattern: 'ab0' } }]);
  assert.equal(gs.length, 1);
  assert.equal(gs[0].count, 2);
  assert.deepEqual(gs[0].chains.map(c => c[0]).sort(), ['ab0', 'ab1']);
});

test('grouped: a search no member matches drops the cluster', async () => {
  const gs = await groups(['ab0', 'ab1', 'cat', 'dog'], [GROUP, { tool: 'search', params: { pattern: 'zzzz' } }]);
  assert.equal(gs.length, 0);
});

test('grouped: only the matching member carries highlight ranges; the rest get an empty slot', async () => {
  const { rows } = await run(['ab0', 'ab1'], [GROUP, { tool: 'search', params: { pattern: 'ab0' } }]);
  assert.equal(rows.length, 1);
  const hl = Object.fromEntries(rows[0].chains.map(c => {
    const tail = c.atoms[c.atoms.length - 1];
    return [tail.wlEntry.norm, tail.highlights];
  }));
  assert.ok(Array.isArray(hl.ab0) && hl.ab0.length > 0);
  assert.ok(Array.isArray(hl.ab1) && hl.ab1.length === 0);
});

test('grouped: a non-highlighting filter also keeps the whole cluster, untouched', async () => {
  const { rows } = await run(['ab0', 'ab1', 'cat', 'dog'], [GROUP, { tool: 'anagrams', params: { entry: 'ab0' } }]);
  const ab = rows.find(g => g.chains.some(c => c.atoms[0].wlEntry.norm === 'ab0'));
  assert.equal(ab.chains.length, 2);
  for (const c of ab.chains) assert.equal(c.atoms.length, 1);
});

test('grouped: members are tagged matched/unmatched for the score gate, surviving unify', async () => {
  const { rows } = await run(['ab0', 'ab1'], [GROUP, { tool: 'search', params: { pattern: 'ab0' } }]);
  const tag = Object.fromEntries(rows[0].chains.map(c => [c.atoms[0].wlEntry.norm, c.matched]));
  assert.equal(tag.ab0, true);
  assert.equal(tag.ab1, false);
});
