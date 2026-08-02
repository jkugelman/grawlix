import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRegexPattern, isCapturingGroup, matchingParen, wrapRuns,
  parseReplacement, kindForGroup, regexExecAll, runReplace,
} from '../../site/src/engine/regex.js';
import regexTool from '../../site/src/engine/tools/regex.js';

const corpus = keys => ({ norms: new Set(keys) });
const wl = (norm, display = null) => ({ norm, display });

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

test('runReplace: capture-group replacement rewrites and highlights both sides', () => {
  const prepared = { re: /(cat)/gid, hlRe: null, tokens: parseReplacement('$1z') };
  const out = runReplace(wl('cat'), prepared, corpus(['catz']));
  assert.deepEqual(out, [{
    entry: 'catz',
    inputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
    outputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
  }]);
});

test('runReplace: a groupless pattern draws its input highlights from the wrapped hlRe', () => {
  const prepared = { re: /cat/gid, hlRe: /(cat)/gid, tokens: parseReplacement('dog') };
  const out = runReplace(wl('cat'), prepared, corpus(['dog']));
  assert.deepEqual(out, [{
    entry: 'dog',
    inputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
    outputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
  }]);
});

test('runReplace: a result absent from the corpus is dropped', () => {
  const prepared = { re: /(cat)/gid, hlRe: null, tokens: parseReplacement('$1z') };
  assert.deepEqual(runReplace(wl('cat'), prepared, corpus([])), []);
});

test('runReplace: an output equal to the input is dropped even if in the corpus', () => {
  const prepared = { re: /cat/gid, hlRe: /(cat)/gid, tokens: parseReplacement('$&') };
  assert.deepEqual(runReplace(wl('cat'), prepared, corpus(['cat'])), []);
});

test('runReplace: allowUnlisted keeps an off-list result, array-wrapped for a synthetic score', () => {
  const prepared = { re: /(cat)/gid, hlRe: null, tokens: parseReplacement('$1z'), allowUnlisted: true };
  const out = runReplace(wl('cat'), prepared, corpus([]));
  assert.deepEqual(out, [{
    entry: ['catz'],
    inputHighlights: [{ start: 0, end: 3, kind: 'search:0' }],
    outputHighlights: [{ start: 0, end: 3, kind: 'search:0', coord: 'display' }],
  }]);
});

test('runReplace: allowUnlisted leaves an in-list result a plain string (keeps the real lookup)', () => {
  const prepared = { re: /(cat)/gid, hlRe: null, tokens: parseReplacement('$1z'), allowUnlisted: true };
  assert.equal(runReplace(wl('cat'), prepared, corpus(['catz']))[0].entry, 'catz');
});

test('runReplace: allowUnlisted still drops an output equal to the input', () => {
  const prepared = { re: /cat/gid, hlRe: /(cat)/gid, tokens: parseReplacement('$&'), allowUnlisted: true };
  assert.deepEqual(runReplace(wl('cat'), prepared, corpus([])), []);
});

test('runReplace: a synthetic result splices the replacement into the display', () => {
  const prepared = { re: /bonnie/gid, hlRe: /(bonnie)/gid, tokens: parseReplacement('xxx'), allowUnlisted: true };
  const entry = wl('03bonnieandclyde', "'03 Bonnie and Clyde");
  const out = runReplace(entry, prepared, corpus([]));
  assert.deepEqual(out, [{
    entry: ["'03 xxx and Clyde"],
    inputHighlights: [{ start: 2, end: 8, kind: 'search:0' }],
    outputHighlights: [{ start: 4, end: 7, kind: 'search:0', coord: 'display' }],
  }]);
});

test('runReplace: a group echo in a synthetic result takes its display slice', () => {
  const prepared = { re: /(03)(bonnie)/gid, hlRe: null, tokens: parseReplacement('$2$1'), allowUnlisted: true };
  const entry = wl('03bonnieandclyde', "'03 Bonnie and Clyde");
  const out = runReplace(entry, prepared, corpus([]));
  assert.deepEqual(out[0].entry, ["'Bonnie03 and Clyde"]);
  assert.deepEqual(out[0].outputHighlights, [
    { start: 1, end: 7, kind: 'search:1', coord: 'display' },
    { start: 7, end: 9, kind: 'search:0', coord: 'display' },
  ]);
});

test('runReplace: an in-list result stays in norm space for the executor lookup', () => {
  const prepared = { re: /bonnie/gid, hlRe: /(bonnie)/gid, tokens: parseReplacement('xxx') };
  const entry = wl('03bonnieandclyde', "'03 Bonnie and Clyde");
  const out = runReplace(entry, prepared, corpus(['03xxxandclyde']));
  assert.equal(out[0].entry, '03xxxandclyde');
  assert.deepEqual(out[0].outputHighlights, [{ start: 2, end: 5, kind: 'search:0' }]);
});

test('runReplace: a whole-entry match on a formatted entry keeps boundary punctuation', () => {
  const prepared = { re: /^(?:cat)$/gid, hlRe: null, tokens: parseReplacement('dog'), allowUnlisted: true };
  assert.deepEqual(runReplace(wl('cat', '"CAT!"'), prepared, corpus([]))[0].entry, ['"dog!"']);
});

test('runReplace: a search-shaped literal token rewrites and highlights both sides', () => {
  const prepared = { re: /a/gd, hlRe: /(a)/gd, tokens: [{ lit: 'o' }] };
  const out = runReplace(wl('cat'), prepared, corpus(['cot']));
  assert.deepEqual(out, [{
    entry: 'cot',
    inputHighlights: [{ start: 1, end: 2, kind: 'search:0' }],
    outputHighlights: [{ start: 1, end: 2, kind: 'search:0' }],
  }]);
});

test('runReplace: a norm-only match reaches across display separators (search norm arm)', () => {
  const prepared = { re: /noft/gd, hlRe: /(noft)/gd, tokens: [{ lit: 'X' }], allowUnlisted: true };
  const out = runReplace(wl('helenoftroy', 'Helen of Troy'), prepared, corpus([]));
  assert.deepEqual(out[0].entry, ['HeleXroy']);
});

test('runReplace: both arms matching prefers the norm arm', () => {
  const prepared = { re: /a./gid, hlRe: null, tokens: [{ lit: 'x' }], allowUnlisted: true };
  // Norm arm: `a.` spans the whole norm "aa" → "x". The display arm would have
  // matched only "a-" and produced "xa".
  const out = runReplace(wl('aa', 'a-a'), prepared, corpus([]));
  assert.deepEqual(out[0].entry, ['x']);
});

test('runReplace: a display-only pattern falls back to the display arm', () => {
  const prepared = { re: /\s/gd, hlRe: null, tokens: [{ lit: '-' }], allowUnlisted: true };
  const out = runReplace(wl('helenoftroy', 'Helen of Troy'), prepared, corpus([]));
  assert.deepEqual(out, [{
    entry: ['Helen-of-Troy'],
    inputHighlights: [],
    outputHighlights: [
      { start: 5, end: 6, kind: 'search:0', coord: 'display' },
      { start: 8, end: 9, kind: 'search:0', coord: 'display' },
    ],
  }]);
});

test('runReplace: a display-arm in-list result converts to norm space for the executor lookup', () => {
  const prepared = { re: /of\s/gd, hlRe: null, tokens: [{ lit: 'X' }] };
  const out = runReplace(wl('helenoftroy', 'Helen of Troy'), prepared, corpus(['helenxtroy']));
  assert.equal(out[0].entry, 'helenxtroy');
  assert.deepEqual(out[0].outputHighlights, [{ start: 5, end: 6, kind: 'search:0' }]);
});

test('runReplace: a norm-preserving rewrite coins a synthetic form under allowUnlisted', () => {
  const prepared = { re: /a/gd, hlRe: /(a)/gd, tokens: [{ lit: 'A' }], allowUnlisted: true };
  assert.deepEqual(runReplace(wl('cat'), prepared, corpus([]))[0].entry, ['cAt']);
});

test('runReplace: a norm-preserving rewrite is dropped without allowUnlisted', () => {
  // Never resolved in-list either: the lookup could only re-emit the input row.
  const prepared = { re: /a/gd, hlRe: /(a)/gd, tokens: [{ lit: 'A' }] };
  assert.deepEqual(runReplace(wl('cat'), prepared, corpus(['cat'])), []);
});

test('runReplace: a zero-width matcher terminates (advance guard)', () => {
  // Reaching the assertion at all proves the guard advances lastIndex; a runaway
  // empty-match loop would hang the test.
  const prepared = { re: /b*/gd, hlRe: null, tokens: [{ lit: '-' }] };
  assert.deepEqual(runReplace(wl('ca'), prepared, corpus(['ca'])), []);
});

test('error: an invalid pattern reports the reason, stripped of V8 boilerplate', () => {
  const msg = regexTool.error({ pattern: 'a(b' });
  assert.match(msg, /group/i);
  assert.doesNotMatch(msg, /Invalid regular expression/);
  assert.equal(regexTool.error({ pattern: '[' }).includes('/'), false);
  assert.equal(regexTool.error({ pattern: 'abc' }), null);
  assert.equal(regexTool.error({ pattern: '' }), null);
});
