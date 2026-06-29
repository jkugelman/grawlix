import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWidthHintAcc, computeWidthHints, computeCorpusWidthBound } from '../../site/src/engine/width-hints.js';

const e = (display, score, rawScore) => ({ display, norm: display, score, rawScore });

test('cumulative hints across batches converge to the whole-set hints (no end-of-stream jump)', () => {
  const corpus = { entries: [
    e('CAT', 50),
    e('DOG', 8),
    e('ELEPHANTINE', 120),   // widest entry + highest score, arrives in a later batch
    e('OX', 3),
  ] };
  const whole = computeWidthHints([0, 1, 2, 3], corpus);

  const acc = makeWidthHintAcc();
  [0, 1].forEach(i => acc.add(corpus.entries[i]));
  const afterBatch1 = acc.hints();
  [2, 3].forEach(i => acc.add(corpus.entries[i]));
  const afterFinalBatch = acc.hints();

  assert.ok(afterBatch1.maxDisplayLen < whole.maxDisplayLen);   // batch 1 underestimates
  assert.deepStrictEqual(afterFinalBatch, whole);               // ...the last batch matches exactly
});

test('whole-set hints are independent of survivor order', () => {
  const corpus = { entries: [e('A', 1), e('BBBB', 9), e('CC', 40)] };
  assert.deepStrictEqual(
    computeWidthHints([0, 1, 2], corpus),
    computeWidthHints([2, 1, 0], corpus),
  );
});

test('an empty result yields the zero-width floor', () => {
  assert.deepStrictEqual(computeWidthHints([], { entries: [] }), {
    maxDisplayLen: 0, maxLenDigits: 1, maxScoreDigits: 1, maxRawDigits: 0,
  });
});

test('a negative score widens the score column by its sign digit', () => {
  assert.strictEqual(computeWidthHints([0], { entries: [e('X', -25)] }).maxScoreDigits, 3);
});

test('maxRawDigits tracks only entries whose raw score differs from the rescored score', () => {
  const corpus = { entries: [e('X', 5, 1234), e('Y', 7, 7)] };
  assert.strictEqual(computeWidthHints([0, 1], corpus).maxRawDigits, 4);
});

test('display length falls back to norm when an entry has no display', () => {
  const corpus = { entries: [{ norm: 'LONGISHNORM', score: 5 }] };
  assert.strictEqual(computeWidthHints([0], corpus).maxDisplayLen, 'LONGISHNORM'.length);
});

test('computeCorpusWidthBound takes the maxes over every corpus entry', () => {
  const corpus = { entries: [
    e('CAT', 50),
    e('ELEPHANTINE', 120),
    e('OX', 3),
  ] };
  assert.deepStrictEqual(computeCorpusWidthBound(corpus), {
    maxDisplayLen: 11,   // ELEPHANTINE
    maxLenDigits: 2,     // 11 → two digits
    maxScoreDigits: 3,   // 120
    maxRawDigits: 0,
  });
});

test('computeCorpusWidthBound equals the per-result hints over the full corpus (the floor is a true upper bound for any subset)', () => {
  const corpus = { entries: [e('A', 1), e('BBBB', 9, 9999), e('CC', 40)] };
  assert.deepStrictEqual(
    computeCorpusWidthBound(corpus),
    computeWidthHints([0, 1, 2], corpus),
  );
});
