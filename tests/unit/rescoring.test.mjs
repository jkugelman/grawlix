import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './support/extract.mjs';

const {
  parseRange, parseRuleOutput, compileRescoreRules, rescoreEntry,
  rescoreRulesEqual, scoringRulesEqual, compareRescoreRulesForPriority,
  rangeSpan, getRuleMaxScore, outputSortKey, matchesRange,
} = extract('rescoring', [
  'parseRange', 'parseRuleOutput', 'compileRescoreRules', 'rescoreEntry',
  'rescoreRulesEqual', 'scoringRulesEqual', 'compareRescoreRulesForPriority',
  'rangeSpan', 'getRuleMaxScore', 'outputSortKey', 'matchesRange',
]);

const rule = (input, output, length = '') => ({ input, length, output, note: '' });
const ruleN = (input, output = '', length = '', note = '') => ({ input, length, output, note });
const entry = (score, norm = 'xxxxx') => ({ score, norm });
const sign = n => (n < 0 ? -1 : n > 0 ? 1 : 0);

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

test('rangeSpan: blank/junk/open-ended are Infinity, exact is 0, bounded is its width', () => {
  assert.equal(rangeSpan(''), Infinity);
  assert.equal(rangeSpan('   '), Infinity);
  assert.equal(rangeSpan('abc'), Infinity);
  assert.equal(rangeSpan('50+'), Infinity);
  assert.equal(rangeSpan('50'), 0);
  assert.equal(rangeSpan('40-60'), 20);
});

test('getRuleMaxScore: exact/range read the upper bound, N+ is Infinity, junk is -1', () => {
  assert.equal(getRuleMaxScore(ruleN('50')), 50);
  assert.equal(getRuleMaxScore(ruleN('40-60')), 60);
  assert.equal(getRuleMaxScore(ruleN('50+')), Infinity);
  assert.equal(getRuleMaxScore(ruleN('')), -1);
  assert.equal(getRuleMaxScore(ruleN('abc')), -1);
});

test('outputSortKey: number is itself, bounded range is its midpoint, N+ is its min', () => {
  assert.equal(outputSortKey(ruleN('50', '90')), 90);
  assert.equal(outputSortKey(ruleN('50', '0-100')), 50);
  assert.equal(outputSortKey(ruleN('50', '40-60')), 50);
  assert.equal(outputSortKey(ruleN('50', '70+')), 70);
});

test('outputSortKey: a blank (unchanged) output sorts by the input range max', () => {
  assert.equal(outputSortKey(ruleN('40-60', '')), 60);
  assert.equal(outputSortKey(ruleN('50', '')), 50);
});

test('matchesRange: bounded membership is inclusive of both endpoints', () => {
  const iv = [{ min: 40, max: 60 }];
  assert.equal(matchesRange(40, iv), true);
  assert.equal(matchesRange(60, iv), true);
  assert.equal(matchesRange(50, iv), true);
  assert.equal(matchesRange(39, iv), false);
  assert.equal(matchesRange(61, iv), false);
});

test('matchesRange: an open-ended (null max) interval has no upper bound', () => {
  const iv = [{ min: 50, max: null }];
  assert.equal(matchesRange(50, iv), true);
  assert.equal(matchesRange(1000, iv), true);
  assert.equal(matchesRange(49, iv), false);
});

test('matchesRange: any one matching interval suffices', () => {
  const iv = [{ min: 40, max: 60 }, { min: 0, max: 10 }];
  assert.equal(matchesRange(5, iv), true);
  assert.equal(matchesRange(50, iv), true);
  assert.equal(matchesRange(25, iv), false);
  assert.equal(matchesRange(5, []), false);
});

test('compare tier 1: a higher input-range max sorts first', () => {
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('40-60'), ruleN('50'))), -1);
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('50'), ruleN('40-60'))), 1);
});

test('compare tier 2: at equal max, the narrower input range sorts first', () => {
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('50'), ruleN('40-50'))), -1);
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('40-50'), ruleN('50'))), 1);
});

test('compare tier 3: at equal max and span, a length-filtered rule sorts first', () => {
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('50', '', '5'), ruleN('50'))), -1);
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('50'), ruleN('50', '', '5'))), 1);
});

test('compare tier 4: when both are length-filtered, the narrower length range sorts first', () => {
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('50', '', '5'), ruleN('50', '', '4-6'))), -1);
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('50', '', '4-6'), ruleN('50', '', '5'))), 1);
});

test('compare tier 5: all else equal, the higher output sort key sorts first', () => {
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('50', '90'), ruleN('50', '10'))), -1);
  assert.equal(sign(compareRescoreRulesForPriority(ruleN('50', '10'), ruleN('50', '90'))), 1);
});

test('compare: two fully-identical rules compare equal (stable order)', () => {
  assert.equal(compareRescoreRulesForPriority(ruleN('50', '90', '5', 'n'), ruleN('50', '90', '5', 'n')), 0);
});

test('rescoreRulesEqual: identical arrays are equal; differing length is not', () => {
  assert.equal(rescoreRulesEqual([ruleN('50', '90')], [ruleN('50', '90')]), true);
  assert.equal(rescoreRulesEqual([ruleN('50', '90'), ruleN('80', '10')], [ruleN('50', '90')]), false);
});

test('rescoreRulesEqual: any one differing field (input/length/output/note) breaks equality', () => {
  assert.equal(rescoreRulesEqual([ruleN('50', '90')], [ruleN('51', '90')]), false);
  assert.equal(rescoreRulesEqual([ruleN('50', '90', '5')], [ruleN('50', '90', '6')]), false);
  assert.equal(rescoreRulesEqual([ruleN('50', '90')], [ruleN('50', '91')]), false);
  assert.equal(rescoreRulesEqual([ruleN('50', '90', '', 'n1')], [ruleN('50', '90', '', 'n2')]), false);
});

test('rescoreRulesEqual is order-insensitive: it sorts both sides before comparing', () => {
  const a = ruleN('50', '90'), b = ruleN('80', '10');
  assert.equal(rescoreRulesEqual([a, b], [b, a]), true);
});

test('rescoreRulesEqual normalizes missing length/output/note to empty string', () => {
  assert.equal(rescoreRulesEqual([{ input: '50' }], [ruleN('50')]), true);
});

test('rescoreRulesEqual treats null/undefined as an empty array', () => {
  assert.equal(rescoreRulesEqual(null, []), true);
  assert.equal(rescoreRulesEqual(undefined, []), true);
  assert.equal(rescoreRulesEqual(null, [ruleN('50', '90')]), false);
});

test('scoringRulesEqual: identical rows are equal; differing length is not', () => {
  const a = { input: '50', note: 'x' }, b = { input: '80', note: 'y' };
  assert.equal(scoringRulesEqual([a, b], [a, b]), true);
  assert.equal(scoringRulesEqual([a, b], [a]), false);
});

test('scoringRulesEqual compares only input and note (ignores output) and breaks on either', () => {
  assert.equal(scoringRulesEqual([{ input: '50', note: 'a' }], [{ input: '51', note: 'a' }]), false);
  assert.equal(scoringRulesEqual([{ input: '50', note: 'a' }], [{ input: '50', note: 'b' }]), false);
  assert.equal(
    scoringRulesEqual([{ input: '50', note: 'a', output: '90' }], [{ input: '50', note: 'a', output: '10' }]),
    true,
  );
});

test('scoringRulesEqual is order-sensitive: it does not sort before comparing', () => {
  const a = { input: '50', note: 'a' }, b = { input: '80', note: 'b' };
  assert.equal(scoringRulesEqual([a, b], [b, a]), false);
});

test('scoringRulesEqual treats null/undefined as an empty array', () => {
  assert.equal(scoringRulesEqual(null, []), true);
  assert.equal(scoringRulesEqual(undefined, []), true);
});
