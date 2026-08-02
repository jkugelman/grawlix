import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergedNormLowerBound, mergedRowsForNorm, resolveCorpus, mergeKey,
} from '../../site/src/engine/corpus.js';

test('mergeKey: joins norm and display with a NUL separator', () => {
  assert.equal(mergeKey('cat', 'Cat'), 'cat\0Cat');
});

test('mergeKey: a null or undefined display coalesces to the empty string', () => {
  assert.equal(mergeKey('cat', null), 'cat\0');
  assert.equal(mergeKey('cat', undefined), 'cat\0');
});

test('mergeKey: different displays under the same norm produce distinct keys', () => {
  // The NUL is what keeps 'cat'+'X' from colliding with 'catX'+'' — without the
  // separator the two would key identically and silently overwrite each other.
  assert.notEqual(mergeKey('cat', 'X'), mergeKey('catX', ''));
  assert.notEqual(mergeKey('cat', 'CAT'), mergeKey('cat', 'Cat'));
});

const sorted = (...norms) => norms.map(norm => ({ norm }));
const FIXTURE = sorted('ant', 'bee', 'bee', 'cat', 'dog');

test('mergedNormLowerBound: empty input returns 0', () => {
  assert.equal(mergedNormLowerBound([], 'anything'), 0);
});

test('mergedNormLowerBound: a target before all elements returns 0', () => {
  assert.equal(mergedNormLowerBound(FIXTURE, 'aardvark'), 0);
});

test('mergedNormLowerBound: a target after all elements returns length', () => {
  assert.equal(mergedNormLowerBound(FIXTURE, 'zebra'), FIXTURE.length);
  assert.equal(mergedNormLowerBound(FIXTURE, 'zebra'), 5);
});

test('mergedNormLowerBound: an exact match returns that element index', () => {
  assert.equal(mergedNormLowerBound(FIXTURE, 'ant'), 0);
  assert.equal(mergedNormLowerBound(FIXTURE, 'cat'), 3);
  assert.equal(mergedNormLowerBound(FIXTURE, 'dog'), 4);
});

test('mergedNormLowerBound: duplicates resolve to the FIRST occurrence', () => {
  // 'bee' sits at indices 1 and 2; lower-bound landing on 2 instead of 1 would
  // silently drop the first row of a multi-row norm — the span starts at lo.
  assert.equal(mergedNormLowerBound(FIXTURE, 'bee'), 1);
});

test('mergedNormLowerBound: a target between elements returns the insertion point', () => {
  assert.equal(mergedNormLowerBound(FIXTURE, 'box'), 3);
});

const merged = entries => ({ entries });

test('mergedRowsForNorm: a norm present once returns its single row', () => {
  const rows = mergedRowsForNorm(merged(FIXTURE), 'cat');
  assert.equal(rows.length, 1);
  assert.equal(rows[0], FIXTURE[3]);
});

test('mergedRowsForNorm: a norm present multiple times returns the full span', () => {
  const rows = mergedRowsForNorm(merged(FIXTURE), 'bee');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows, [FIXTURE[1], FIXTURE[2]]);
});

test('mergedRowsForNorm: an absent norm returns an empty array', () => {
  assert.deepEqual(mergedRowsForNorm(merged(FIXTURE), 'fox'), []);
  assert.deepEqual(mergedRowsForNorm(merged([]), 'cat'), []);
});

test('mergedRowsForNorm: a norm at the very end is still spanned', () => {
  assert.deepEqual(mergedRowsForNorm(merged(FIXTURE), 'dog'), [FIXTURE[4]]);
});

// resolveCorpus consumes the bucket Map the unfenced bucketContributors produces:
//   Map<norm, { contributors: [{ wordlist, score, rawScore, comment, display }], displays: Set }>
// Contributors are pushed in sourceList order, so the FIRST in a bucket is the
// highest-priority source — the fixtures below depend on that ordering contract,
// which isn't visible from resolveCorpus alone.
const contributor = (wordlist, { score = 0, rawScore = 0, comment = '', display = null } = {}) =>
  ({ wordlist, score, rawScore, comment, display });
const bucket = (...contributors) => {
  const displays = new Set();
  for (const c of contributors) if (c.display != null) displays.add(c.display);
  return { contributors, displays };
};

test('resolveCorpus: the highest-priority contributor wins, NOT the highest score', () => {
  // The fixture deliberately gives the higher-priority source the LOWER score so a
  // score-wins regression would flip the winner and fail loudly here.
  const hi = { name: 'hi' }, lo = { name: 'lo' };
  const buckets = new Map([
    ['cat', bucket(
      contributor(hi, { score: 5, rawScore: 1 }),
      contributor(lo, { score: 50, rawScore: 9 }),
    )],
  ]);
  const { entries } = resolveCorpus(buckets, [hi, lo]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].wordlist, hi);
  assert.equal(entries[0].score, 5);
  assert.equal(entries[0].rawScore, 1);
});

test('resolveCorpus: an empty winner comment falls through to a lower-priority comment', () => {
  // The winner (entry+score) and the commenter are resolved separately: an empty
  // winner comment doesn't blank the row, it borrows a lower-priority comment.
  const hi = { name: 'hi' }, lo = { name: 'lo' };
  const buckets = new Map([
    ['cat', bucket(
      contributor(hi, { score: 5, comment: '' }),
      contributor(lo, { score: 1, comment: 'from low' }),
    )],
  ]);
  const { entries } = resolveCorpus(buckets, [hi, lo]);
  assert.equal(entries[0].wordlist, hi);
  assert.equal(entries[0].comment, 'from low');
});

test('resolveCorpus: a non-empty winner comment is kept (no fall-through)', () => {
  const hi = { name: 'hi' }, lo = { name: 'lo' };
  const buckets = new Map([
    ['cat', bucket(
      contributor(hi, { comment: 'mine' }),
      contributor(lo, { comment: 'theirs' }),
    )],
  ]);
  assert.equal(resolveCorpus(buckets, [hi, lo]).entries[0].comment, 'mine');
});

test('resolveCorpus: norms and byKey index the resolved row', () => {
  const a = { name: 'A' };
  const buckets = new Map([['cat', bucket(contributor(a, { display: 'Cat' }))]]);
  const { entries, norms, byKey } = resolveCorpus(buckets, [a]);
  assert.equal(norms.has('cat'), true);
  assert.equal(byKey.get(mergeKey('cat', 'Cat')), entries[0]);
});

test('resolveCorpus: sourceCounts credits only the winning source, once per won variant', () => {
  const hi = { name: 'hi' }, lo = { name: 'lo' };
  const buckets = new Map([
    ['cat', bucket(contributor(hi), contributor(lo))],
  ]);
  const { sourceCounts } = resolveCorpus(buckets, [hi, lo]);
  assert.deepEqual(
    sourceCounts.map(s => [s.wordlist.name, s.count]),
    [['hi', 1], ['lo', 0]],
  );
});

test('resolveCorpus: sourceCounts lists every source in sourceList order, even zero contributors', () => {
  const a = { name: 'A' }, b = { name: 'B' };
  const buckets = new Map([['cat', bucket(contributor(a))]]);
  const { sourceCounts } = resolveCorpus(buckets, [a, b]);
  assert.deepEqual(sourceCounts.map(s => [s.wordlist.name, s.count]), [['A', 1], ['B', 0]]);
});

test('resolveCorpus: each display variant resolves to its own independent winner', () => {
  const a = { name: 'A' }, b = { name: 'B' };
  const buckets = new Map([
    ['cat', bucket(
      contributor(a, { display: 'CAT' }),
      contributor(b, { display: 'Cat' }),
    )],
  ]);
  const { entries } = resolveCorpus(buckets, [a, b]);
  assert.equal(entries.length, 2);
  const byDisplay = Object.fromEntries(entries.map(e => [e.display, e.wordlist.name]));
  assert.deepEqual(byDisplay, { CAT: 'A', Cat: 'B' });
});

test('resolveCorpus: a null-display contributor is eligible for (and can win) any variant', () => {
  // The fixture's winner names no display while a lower-priority source supplies
  // the variant string — pinning that a null display matches every variant rather
  // than only the null one, which a stricter equality check would silently break.
  const a = { name: 'A' }, b = { name: 'B' };
  const buckets = new Map([
    ['cat', bucket(
      contributor(a, { score: 9, display: null }),
      contributor(b, { score: 1, display: 'Cat' }),
    )],
  ]);
  const { entries, sourceCounts } = resolveCorpus(buckets, [a, b]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].display, 'Cat');
  assert.equal(entries[0].wordlist, a);
  assert.deepEqual(sourceCounts.map(s => [s.wordlist.name, s.count]), [['A', 1], ['B', 0]]);
});

test('resolveCorpus: a null-display ambient winner takes every variant and inherits each variant\'s comment', () => {
  const plain = { name: 'Plain' }, rich = { name: 'Rich' };
  const buckets = new Map([
    ['theirs', bucket(
      contributor(plain, { score: 90, display: null,      comment: '' }),
      contributor(rich,  { score: 50, display: 'Theirs',  comment: 'pronoun' }),
      contributor(rich,  { score: 60, display: 'the IRS', comment: 'tax agency' }),
    )],
  ]);
  const { entries } = resolveCorpus(buckets, [plain, rich]);
  assert.equal(entries.length, 2);
  const byDisplay = Object.fromEntries(entries.map(e =>
    [e.display, { wordlist: e.wordlist.name, score: e.score, comment: e.comment }]));
  assert.deepEqual(byDisplay, {
    'Theirs':  { wordlist: 'Plain', score: 90, comment: 'pronoun' },
    'the IRS': { wordlist: 'Plain', score: 90, comment: 'tax agency' },
  });
});

test('resolveCorpus: entries are sorted by norm then display (localeCompare)', () => {
  const a = { name: 'A' };
  const buckets = new Map([
    ['dog', bucket(contributor(a))],
    ['ant', bucket(contributor(a))],
    ['cat', bucket(
      contributor(a, { display: 'CAT' }),
      contributor(a, { display: 'Cat' }),
    )],
  ]);
  const { entries } = resolveCorpus(buckets, [a]);
  // Within the 'cat' norm, 'Cat' sorting before 'CAT' is locale collation, not
  // ASCII (where uppercase precedes lowercase) — the comparator is localeCompare.
  assert.deepEqual(
    entries.map(e => [e.norm, e.display]),
    [['ant', null], ['cat', 'Cat'], ['cat', 'CAT'], ['dog', null]],
  );
});

test('resolveCorpus: an empty bucket Map yields an empty corpus with zeroed source counts', () => {
  const a = { name: 'A' };
  const { entries, norms, byKey, sourceCounts } = resolveCorpus(new Map(), [a]);
  assert.deepEqual(entries, []);
  assert.equal(norms.size, 0);
  assert.equal(byKey.size, 0);
  assert.deepEqual(sourceCounts.map(s => [s.wordlist.name, s.count]), [['A', 0]]);
});
