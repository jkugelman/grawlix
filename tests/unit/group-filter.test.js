import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, groups } from './tools/harness.js';

test('grouped: a chained search keeps the whole cluster when one member matches', async () => {
  const gs = await groups(['level', 'rotor', 'cat', 'dog'], [
    { tool: 'cryptogram', grouped: true },
    { tool: 'search', params: { pattern: 'level' } },
  ]);
  assert.equal(gs.length, 1);
  assert.equal(gs[0].count, 2);
  assert.deepEqual(gs[0].chains.map(c => c[0]).sort(), ['level', 'rotor']);
});

test('grouped: a search no member matches drops the cluster', async () => {
  const gs = await groups(['level', 'rotor', 'cat', 'dog'], [
    { tool: 'cryptogram', grouped: true },
    { tool: 'search', params: { pattern: 'zzzz' } },
  ]);
  assert.equal(gs.length, 0);
});

test('grouped: only the matching member carries highlight ranges; the rest get an empty slot', async () => {
  const { rows } = await run(['level', 'rotor'], [
    { tool: 'cryptogram', grouped: true },
    { tool: 'search', params: { pattern: 'level' } },
  ]);
  assert.equal(rows.length, 1);
  const hl = Object.fromEntries(rows[0].chains.map(c => {
    const tail = c.atoms[c.atoms.length - 1];
    return [tail.wlEntry.norm, tail.highlights];
  }));
  assert.ok(Array.isArray(hl.level) && hl.level.length > 0);
  assert.ok(Array.isArray(hl.rotor) && hl.rotor.length === 0);
});

test('grouped: a non-highlighting filter also keeps the whole cluster, untouched', async () => {
  const { rows } = await run(['level', 'rotor', 'cat', 'dog'], [
    { tool: 'cryptogram', grouped: true },
    { tool: 'anagrams', params: { entry: 'level' } },
  ]);
  const abcba = rows.find(g => g.chains.some(c => c.atoms[0].wlEntry.norm === 'level'));
  assert.equal(abcba.chains.length, 2);
  for (const c of abcba.chains) assert.equal(c.atoms.length, 1);
});

test('grouped: members are tagged matched/unmatched for the score gate, surviving unify', async () => {
  const { rows } = await run(['level', 'rotor'], [
    { tool: 'cryptogram', grouped: true },
    { tool: 'search', params: { pattern: 'level' } },
  ]);
  const tag = Object.fromEntries(rows[0].chains.map(c => [c.atoms[0].wlEntry.norm, c.matched]));
  assert.equal(tag.level, true);
  assert.equal(tag.rotor, false);
});
