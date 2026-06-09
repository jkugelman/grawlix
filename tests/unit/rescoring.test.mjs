import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './support/extract.mjs';

const { parseRange, parseRuleOutput, compileRescoreRules, rescoreEntry } =
  extract('rescoring', ['parseRange', 'parseRuleOutput', 'compileRescoreRules', 'rescoreEntry']);

const rule = (input, output, length = '') => ({ input, length, output, note: '' });
const entry = (score, norm = 'xxxxx') => ({ score, norm });

test('parseRange reads exact, range, N+, and rejects junk', () => {
  assert.deepEqual(parseRange('50'), [{ min: 50, max: 50 }]);
  assert.deepEqual(parseRange('40-60'), [{ min: 40, max: 60 }]);
  assert.deepEqual(parseRange('50+'), [{ min: 50, max: null }]);
  assert.equal(parseRange(''), null);
  assert.equal(parseRange('abc'), null);
});

test('parseRuleOutput: blank is unchanged, number is exact, range/N+ are intervals, junk is null', () => {
  assert.equal(parseRuleOutput(''), 'unchanged');
  assert.equal(parseRuleOutput('50'), 50);
  assert.deepEqual(parseRuleOutput('0-100'), { min: 0, max: 100 });
  assert.deepEqual(parseRuleOutput('50+'), { min: 50, max: null });
  assert.equal(parseRuleOutput('abc'), null);
});

test('rescoreEntry: exact output, blank passes through, no match passes through', () => {
  assert.equal(rescoreEntry(entry(50), [rule('50', '25')]), 25);
  assert.equal(rescoreEntry(entry(50), [rule('50', '')]), 50);
  assert.equal(rescoreEntry(entry(50), [rule('80', '10')]), 50);
});

test('rescoreEntry linearly scales a bounded range output', () => {
  assert.equal(rescoreEntry(entry(25), [rule('0-100', '50-90')]), 60);
  assert.equal(rescoreEntry(entry(0), [rule('0-100', '50-90')]), 50);
  assert.equal(rescoreEntry(entry(100), [rule('0-100', '50-90')]), 90);
});

test('rescoreEntry shifts an open-ended N+ output by the interval delta', () => {
  assert.equal(rescoreEntry(entry(60), [rule('50+', '70+')]), 80);
});

test('rescoreEntry skips a degenerate range output (exact input maps to a range) and passes through', () => {
  assert.equal(rescoreEntry(entry(50), [rule('50', '0-100')]), 50);
});

test('compileRescoreRules orders a narrow rule ahead of a broad superset so it fires first', () => {
  const wl = { rescoreRules: [rule('0-100', '10'), rule('40-100', '90')] };
  compileRescoreRules(wl);
  assert.deepEqual(wl.rescoreRules.map(r => r.input), ['40-100', '0-100']);
  assert.equal(rescoreEntry(entry(50), wl.rescoreRules), 90);
  assert.equal(rescoreEntry(entry(20), wl.rescoreRules), 10);
});

test('a length-filtered rule sorts ahead of an unfiltered rule at the same score', () => {
  const wl = { rescoreRules: [rule('50', '10'), rule('50', '90', '5')] };
  compileRescoreRules(wl);
  assert.deepEqual(wl.rescoreRules.map(r => r.output), ['90', '10']);
  assert.equal(rescoreEntry(entry(50, 'abcde'), wl.rescoreRules), 90);
  assert.equal(rescoreEntry(entry(50, 'abc'), wl.rescoreRules), 10);
});
