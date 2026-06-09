import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './support/extract.mjs';

const { threeWayMergeEdits } = extract('merge3', ['threeWayMergeEdits']);

const mk = (norm, score, comment = '') => ({ norm, score, comment });

test('a one-sided change applies without a conflict', () => {
  const base = [mk('a', 10), mk('b', 20)];
  const file = [mk('a', 99), mk('b', 20)];
  const idb  = [mk('a', 10), mk('b', 20)];
  const { resolved, conflicts } = threeWayMergeEdits(base, file, idb);
  assert.equal(resolved.get('a').score, 99);
  assert.equal(conflicts.length, 0);
});

test('both sides making the same change is not a conflict', () => {
  const base = [mk('a', 10)];
  const { resolved, conflicts } = threeWayMergeEdits(base, [mk('a', 50)], [mk('a', 50)]);
  assert.equal(resolved.get('a').score, 50);
  assert.equal(conflicts.length, 0);
});

test('a true conflict keeps the device (idb) side and records it', () => {
  const { resolved, conflicts } = threeWayMergeEdits([mk('a', 10)], [mk('a', 99)], [mk('a', 50)]);
  assert.equal(resolved.get('a').score, 50);
  assert.deepEqual(conflicts.map(c => c.norm), ['a']);
});

test('deletion does not resurrect: file deletes an entry idb left untouched', () => {
  const base = [mk('a', 10), mk('b', 20)];
  const file = [mk('b', 20)];
  const idb  = [mk('a', 10), mk('b', 20)];
  const { resolved } = threeWayMergeEdits(base, file, idb);
  assert.equal(resolved.has('a'), false);
  assert.equal(resolved.get('b').score, 20);
});

test('both sides deleting the same entry leaves it deleted, no conflict', () => {
  const { resolved, conflicts } = threeWayMergeEdits([mk('a', 10)], [], []);
  assert.equal(resolved.size, 0);
  assert.equal(conflicts.length, 0);
});
