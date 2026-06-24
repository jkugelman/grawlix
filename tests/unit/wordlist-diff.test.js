import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWordlistEntries } from '../../site/src/engine/corpus.js';

const e = (norm, score, display = null, comment = '') => ({ norm, display, score, comment });
const clone = list => list.map(x => ({ ...x }));

test('identical lists with duplicate-norm/distinct-display entries report no changes', () => {
  const list = [
    e('pgs', 40),
    e('pgs', 20, 'PGs'),
    e('anaisnin', 50, 'Anaïs Nin'),
    e('anaisnin', 0, 'Anais Nin'),
  ];
  const { added, deleted, rescored } = diffWordlistEntries(list, clone(list));
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(deleted, []);
  assert.deepStrictEqual(rescored, []);
});

test('a real score change surfaces as one correctly-directed rescore', () => {
  const before = [e('pgs', 20, 'PGs'), e('cat', 50)];
  const after  = [e('pgs', 20, 'PGs'), e('cat', 70)];
  const { added, deleted, rescored } = diffWordlistEntries(before, after);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(deleted, []);
  assert.equal(rescored.length, 1);
  assert.equal(rescored[0].entry.norm, 'cat');
  assert.equal(rescored[0].oldScore, 50);
  assert.equal(rescored[0].score, 70);
});

test('a distinct-display sibling of an existing norm is an addition, not a rescore', () => {
  const before = [e('pgs', 40)];
  const after  = [e('pgs', 40), e('pgs', 20, 'PGs')];
  const { added, deleted, rescored } = diffWordlistEntries(before, after);
  assert.equal(added.length, 1);
  assert.equal(added[0].display, 'PGs');
  assert.deepStrictEqual(deleted, []);
  assert.deepStrictEqual(rescored, []);
});

test('identical-key duplicates (same norm and display) do not phantom-rescore', () => {
  const list = [e('foo', 40), e('foo', 60)];
  const { added, deleted, rescored } = diffWordlistEntries(list, clone(list));
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(deleted, []);
  assert.deepStrictEqual(rescored, []);
});

test('a deleted entry surfaces in deleted, not as a rescore', () => {
  const before = [e('pgs', 20, 'PGs'), e('cat', 50)];
  const after  = [e('cat', 50)];
  const { added, deleted, rescored } = diffWordlistEntries(before, after);
  assert.deepStrictEqual(added, []);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].display, 'PGs');
  assert.deepStrictEqual(rescored, []);
});

test('affectedNorms covers added, deleted, and rescored norms', () => {
  const before = [e('cat', 50), e('dog', 30)];
  const after  = [e('cat', 70), e('owl', 10)];   // cat rescored, dog deleted, owl added
  const { affectedNorms } = diffWordlistEntries(before, after);
  assert.deepStrictEqual([...affectedNorms].sort(), ['cat', 'dog', 'owl']);
});

test('a comment-only change is in affectedNorms but not rescored', () => {
  const before = [e('cat', 50, null, 'old note')];
  const after  = [e('cat', 50, null, 'new note')];
  const { added, deleted, rescored, affectedNorms } = diffWordlistEntries(before, after);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(deleted, []);
  assert.deepStrictEqual(rescored, []);
  assert.deepStrictEqual(affectedNorms, ['cat']);
});

test('an unchanged entry (same score and comment) is not affected', () => {
  const list = [e('cat', 50, null, 'note'), e('dog', 30)];
  const { affectedNorms } = diffWordlistEntries(list, clone(list));
  assert.deepStrictEqual(affectedNorms, []);
});
