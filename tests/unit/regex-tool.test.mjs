import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './support/extract.mjs';
import { toNorm, projectRangesToDisplay } from '../../site/src/engine/norm.js';
import { HL_COLORS, groupSpansToRanges } from '../../site/src/engine/search.js';

const {
  analyzeRegexPattern, isCapturingGroup, matchingParen, wrapRuns,
  parseReplacement, kindForGroup, regexExecAll, runRegexReplace, runSearchReplace,
} = extract('regex-tool', [
  'analyzeRegexPattern', 'isCapturingGroup', 'matchingParen', 'wrapRuns',
  'parseReplacement', 'kindForGroup', 'regexExecAll', 'runRegexReplace', 'runSearchReplace',
], { toNorm, projectRangesToDisplay, HL_COLORS, groupSpansToRanges });

const corpus = keys => ({ byNorm: new Map(keys.map(k => [k, true])) });

test('analyzeRegexPattern: a fully-literal pattern is one run, no capture', () => {
  assert.deepEqual(analyzeRegexPattern('cat'), { capturing: false, runs: [[0, 3]] });
});

test('analyzeRegexPattern: a `.` wildcard splits the literal runs around it', () => {
  assert.deepEqual(analyzeRegexPattern('ca.t'), { capturing: false, runs: [[0, 2], [3, 4]] });
});

test('analyzeRegexPattern: a quantified literal is not part of a run', () => {
  assert.deepEqual(analyzeRegexPattern('a*b'), { capturing: false, runs: [[2, 3]] });
  assert.deepEqual(analyzeRegexPattern('abc*'), { capturing: false, runs: [[0, 2]] });
});

test('analyzeRegexPattern: a lazy `*?` consumes the trailing `?` as a modifier', () => {
  assert.deepEqual(analyzeRegexPattern('a*?b'), { capturing: false, runs: [[3, 4]] });
});

test('analyzeRegexPattern: anchors (^ $ and \\b) close the run and start no new one', () => {
  assert.deepEqual(analyzeRegexPattern('^cat$'), { capturing: false, runs: [[1, 4]] });
  assert.deepEqual(analyzeRegexPattern('\\bcat'), { capturing: false, runs: [[2, 5]] });
});

test('analyzeRegexPattern: alternation `|` splits runs', () => {
  assert.deepEqual(analyzeRegexPattern('a|b'), { capturing: false, runs: [[0, 1], [2, 3]] });
});

test('analyzeRegexPattern: escaped `\\.` is a literal run, class-escape `\\d` is not', () => {
  assert.deepEqual(analyzeRegexPattern('\\.'), { capturing: false, runs: [[0, 2]] });
  assert.deepEqual(analyzeRegexPattern('\\d'), { capturing: false, runs: [] });
});

test('analyzeRegexPattern: character classes are wildcards, never runs (incl. leading `]`)', () => {
  assert.deepEqual(analyzeRegexPattern('[abc]'), { capturing: false, runs: [] });
  assert.deepEqual(analyzeRegexPattern('[]a]'), { capturing: false, runs: [] });
});

test('analyzeRegexPattern: a valid {m,n} quantifier is consumed; an invalid {x} is literal', () => {
  assert.deepEqual(analyzeRegexPattern('a{2,3}'), { capturing: false, runs: [] });
  assert.deepEqual(analyzeRegexPattern('a{x}'), { capturing: false, runs: [[0, 4]] });
});

test('analyzeRegexPattern: a capturing group sets the flag and closes runs (even quantified)', () => {
  assert.deepEqual(analyzeRegexPattern('(cat)'), { capturing: true, runs: [] });
  assert.deepEqual(analyzeRegexPattern('ab(c)*d'), { capturing: true, runs: [[0, 2], [6, 7]] });
});

test('analyzeRegexPattern: non-capturing groups and lookarounds leave capturing false', () => {
  assert.deepEqual(analyzeRegexPattern('(?:cat)'), { capturing: false, runs: [] });
  assert.deepEqual(analyzeRegexPattern('(?=cat)'), { capturing: false, runs: [] });
});

test('isCapturingGroup: bare `(` and named `(?<name>` capture; others do not', () => {
  assert.equal(isCapturingGroup('(abc)', 0), true);
  assert.equal(isCapturingGroup('(?<name>x)', 0), true);
  assert.equal(isCapturingGroup('(?:x)', 0), false);
  assert.equal(isCapturingGroup('(?=x)', 0), false);
  assert.equal(isCapturingGroup('(?!x)', 0), false);
  assert.equal(isCapturingGroup('(?<=x)', 0), false);
  assert.equal(isCapturingGroup('(?<!x)', 0), false);
});

test('matchingParen: finds the matching close past a nested group (returns past-end index)', () => {
  assert.equal(matchingParen('(a(b)c)', 0), 7);
});

test('matchingParen: an escaped `\\(` does not raise depth', () => {
  assert.equal(matchingParen('(\\()', 0), 4);
});

test('matchingParen: a `)` inside a character class does not close the group', () => {
  assert.equal(matchingParen('(a[)]b)', 0), 7);
});

test('matchingParen: an unclosed group returns the string length (sentinel)', () => {
  assert.equal(matchingParen('(abc', 0), 4);
});

test('wrapRuns: parenthesizes each run, leaving the gaps verbatim', () => {
  assert.equal(wrapRuns('ca.t', [[0, 2], [3, 4]]), '(ca).(t)');
  assert.equal(wrapRuns('abc', [[0, 3]]), '(abc)');
  assert.equal(wrapRuns('a.b', []), 'a.b');
});

test('parseReplacement: `$$` is a literal dollar', () => {
  assert.deepEqual(parseReplacement('$$'), [{ lit: '$' }]);
});

test('parseReplacement: `$&` is the whole-match group 0', () => {
  assert.deepEqual(parseReplacement('$&'), [{ group: 0 }]);
});

test('parseReplacement: `$N` references group N, greedily taking two digits', () => {
  assert.deepEqual(parseReplacement('$1'), [{ group: 1 }]);
  assert.deepEqual(parseReplacement('$12'), [{ group: 12 }]);
  assert.deepEqual(parseReplacement('$0'), [{ group: 0 }]);
});

test('parseReplacement: a non-special `$x` and a trailing `$` are literal', () => {
  assert.deepEqual(parseReplacement('$x'), [{ lit: '$x' }]);
  assert.deepEqual(parseReplacement('$'), [{ lit: '$' }]);
});

test('parseReplacement: interleaved literals and groups tokenize in order', () => {
  assert.deepEqual(parseReplacement('a$1b'), [{ lit: 'a' }, { group: 1 }, { lit: 'b' }]);
});

test('kindForGroup: group 0 and below map to color 0; later groups cycle by HL_COLORS', () => {
  assert.equal(kindForGroup(0), 'search:0');
  assert.equal(kindForGroup(-1), 'search:0');
  assert.equal(kindForGroup(1), 'search:0');
  assert.equal(kindForGroup(2), 'search:1');
  assert.equal(kindForGroup(10), 'search:0');   // (10-1) % 9 === 0
});

test('regexExecAll: collects each match group span as a range', () => {
  const out = regexExecAll(/(a)/gd, 'banana');
  assert.equal(out.hit, true);
  assert.deepEqual(out.ranges, [
    { start: 1, end: 2, kind: 'search:0' },
    { start: 3, end: 4, kind: 'search:0' },
    { start: 5, end: 6, kind: 'search:0' },
  ]);
});

test('regexExecAll: no match reports hit=false and no ranges', () => {
  assert.deepEqual(regexExecAll(/x/gd, 'abc'), { hit: false, ranges: [] });
});

test('regexExecAll: a zero-width pattern terminates (advance guard) and still reports a hit', () => {
  // Without the lastIndex++ guard, exec would re-match the empty string at the
  // same index forever; reaching the assertions proves the guard advances it.
  const out = regexExecAll(/a*/gd, 'baa');
  assert.equal(out.hit, true);
  assert.deepEqual(out.ranges, []);
});

test('regexExecAll: a zero-width lookahead with a capture still advances and collects spans', () => {
  const out = regexExecAll(/(?=(b))/gd, 'abab');
  assert.equal(out.hit, true);
  assert.deepEqual(out.ranges, [
    { start: 1, end: 2, kind: 'search:0' },
    { start: 3, end: 4, kind: 'search:0' },
  ]);
});

test('runRegexReplace: capture-group replacement rewrites and highlights both sides', () => {
  const prepared = { re: /(cat)/gid, hlRe: null, tokens: parseReplacement('$1z') };
  const out = runRegexReplace('cat', prepared, corpus(['catz']));
  assert.deepEqual(out, [{
    entry: 'catz',
    inputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
    outputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
  }]);
});

test('runRegexReplace: a groupless pattern draws its input highlights from the wrapped hlRe', () => {
  const prepared = { re: /cat/gid, hlRe: /(cat)/gid, tokens: parseReplacement('dog') };
  const out = runRegexReplace('cat', prepared, corpus(['dog']));
  assert.deepEqual(out, [{
    entry: 'dog',
    inputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
    outputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
  }]);
});

test('runRegexReplace: a result absent from the corpus is dropped', () => {
  const prepared = { re: /(cat)/gid, hlRe: null, tokens: parseReplacement('$1z') };
  assert.deepEqual(runRegexReplace('cat', prepared, corpus([])), []);
});

test('runRegexReplace: an output equal to the input is dropped even if in the corpus', () => {
  const prepared = { re: /cat/gid, hlRe: /(cat)/gid, tokens: parseReplacement('$&') };
  assert.deepEqual(runRegexReplace('cat', prepared, corpus(['cat'])), []);
});

test('runSearchReplace: rewrites a literal match and highlights with display coords', () => {
  const prepared = { matcher: { globalRe: /a/gd }, replacement: 'o' };
  const out = runSearchReplace('cat', prepared, corpus(['cot']));
  assert.deepEqual(out, [{
    entry: 'cot',
    inputHighlights: [{ start: 1, end: 2, kind: 'search:0', coord: 'display' }],
    outputHighlights: [{ start: 1, end: 2, kind: 'search:0', coord: 'display' }],
  }]);
});

test('runSearchReplace: drops a result whose norm is absent from the corpus', () => {
  const prepared = { matcher: { globalRe: /a/gd }, replacement: 'o' };
  assert.deepEqual(runSearchReplace('cat', prepared, corpus([])), []);
});

test('runSearchReplace: drops a result that norms back to the input', () => {
  const prepared = { matcher: { globalRe: /a/gd }, replacement: 'A' };
  assert.deepEqual(runSearchReplace('cat', prepared, corpus(['cat'])), []);
});

test('runSearchReplace: a zero-width matcher terminates (advance guard)', () => {
  // Reaching the assertion at all proves the guard advances lastIndex; a runaway
  // empty-match loop would hang the test. (Output is dropped: "-c-a-" norms to "ca".)
  const prepared = { matcher: { globalRe: /b*/gd }, replacement: '-' };
  assert.deepEqual(runSearchReplace('ca', prepared, corpus(['ca'])), []);
});
