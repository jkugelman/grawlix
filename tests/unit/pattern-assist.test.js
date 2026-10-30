import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUmiaq } from '../../site/src/engine/assist-umiaq.js';
import { analyzeRegex } from '../../site/src/engine/assist-regex.js';
import { analyzeSearch } from '../../site/src/engine/assist-search.js';
import { errorVisible, tokenAt } from '../../site/src/engine/assist.js';
import { parseUmiaqQuery, variableColors } from '../../site/src/engine/umiaq.js';

const text = html => html.replace(/<[^>]+>/g, '');
const fixLabels = list => (list || []).map(f => f.label);

// ─── Umiaq ────────────────────────────────────────────────────────────────────

test('Umiaq variables carry the same colors the results use', () => {
  const q = 'ZAB;BAZ';
  const want = variableColors(parseUmiaqQuery(q).variables);
  for (const t of analyzeUmiaq(q).tokens.filter(t => t.kind === 'var')) assert.equal(t.color, want[t.v]);
});

test('Umiaq reads a tuple query back in plain English', () => {
  const r = analyzeUmiaq('AB;BA');
  assert.equal(text(r.reading), 'Finds pairs of entries. The first is a chunk A, then a chunk B. The second is B again, then A again. Each chunk is at least one letter.');
});

test('a dot in Umiaq is a positioned error with fixes, not a raw parser message', () => {
  const r = analyzeUmiaq('l.ve');
  assert.deepEqual([r.error.s, r.error.e], [1, 2]);
  assert.deepEqual(fixLabels(r.error.fixes), ['Use ?', 'Use \\.']);
});

test("Qat's [!…] negation offers the [^…] fix", () => {
  const r = analyzeUmiaq('AB;BA;A=[!aeiou]*');
  assert.deepEqual(fixLabels(r.error.fixes), ['Use [^']);
});

test('a semantic Umiaq error underlines the clause its message quotes', () => {
  const q = 'AB;|*|=3;|A|=5';
  const r = analyzeUmiaq(q);
  assert.ok(r.error);
  assert.ok(['|*|=3', '|A|=5'].includes(q.slice(r.error.s, r.error.e)));
});

test('the lexer never invents an error the parser accepts', () => {
  for (const q of ['A B;B A', 'u\\.s\\.', '\\Nasa', '7-9:A*', '/triangle', 'AB=boardroom;A;B', 'A;~A', '|A-C|>=0;ABC']) {
    assert.equal(analyzeUmiaq(q).error, null, q);
  }
});

test('an all-capitals word hints that capitals are variables', () => {
  const [h] = analyzeUmiaq('CAT').hints;
  assert.match(text(h.msg), /Capital letters are variables/);
  assert.deepEqual(h.fixes, [{ label: 'Search for cat', text: 'cat' }]);
  assert.equal(analyzeUmiaq('ABBA').hints.length, 0);
});

test('a tuple with a variable at an edge hints at |*|>=0, unless one may already be empty', () => {
  assert.deepEqual(analyzeUmiaq('AtenB;AB').hints[0].fixes, [{ label: 'Add |*|>=0', text: 'AtenB;AB;|*|>=0' }]);
  assert.equal(analyzeUmiaq('AtenB;AB;|*|>=0').hints.length, 0);
});

test('a constraint on a variable no pattern uses hints that it does nothing', () => {
  assert.match(text(analyzeUmiaq('A;|B|=3').hints[0].msg), /B isn't in any pattern/);
});

// ─── Regex ────────────────────────────────────────────────────────────────────

test('Regex reads the match mode into its sentence', () => {
  assert.equal(text(analyzeRegex('c.t').reading), 'Finds entries that contain C, then any character, then T anywhere inside.');
  assert.equal(text(analyzeRegex('c.t', { mode: 'full' }).reading), 'Finds entries that are exactly C, then any character, then T.');
  assert.equal(text(analyzeRegex('^(un|re).+ing$').reading), 'Finds entries that are exactly group 1 (either UN or RE), then at least one character, then ING.');
});

test('each Regex capture group is a region in the color its match gets', () => {
  assert.deepEqual(analyzeRegex('^(un|re)(?:x)(.)$').regions, [{ s: 1, e: 8, color: 0 }, { s: 13, e: 16, color: 1 }]);
  assert.deepEqual(analyzeRegex('c.t').regions, []);
});

test('a quantifier points at the atom it repeats, and a paren at its partner', () => {
  const r = analyzeRegex('(ab)+');
  const plus = tokenAt(r.tokens, 5);
  assert.deepEqual(plus.target, [0, 4]);
  assert.deepEqual(tokenAt(r.tokens, 1).pair, [3, 4]);
});

test('Search syntax typed into Regex gets a hint with both fixes', () => {
  const [h] = analyzeRegex('un*ed').hints;
  assert.match(text(h.msg), /any number of Ns/);
  assert.deepEqual(fixLabels(h.fixes), ['Use un.*ed', 'Use Search']);
});

test('an anchored regex Search can express offers to move it there', () => {
  const h = analyzeRegex('^c.t$').hints.find(x => x.tip);
  assert.deepEqual(h.fixes, [{ label: 'Use Search', tool: 'search', text: 'c?t', mode: 'full' }]);
  assert.equal(analyzeRegex('^c.+t$').hints.length, 0);
});

test('Regex errors only when the browser rejects the pattern', () => {
  assert.deepEqual([analyzeRegex('^(ab').error.s, analyzeRegex('^(ab').error.e], [1, 2]);
  assert.deepEqual(fixLabels(analyzeRegex('*ing').error.fixes), ['Use .*']);
  assert.equal(analyzeRegex('a{2,4}?').error, null);
});

// ─── Search ───────────────────────────────────────────────────────────────────

test('a backwards range in Search is an error with a swap fix', () => {
  const r = analyzeSearch('[z-a]*');
  assert.deepEqual([r.error.s, r.error.e], [1, 4]);
  assert.deepEqual(r.error.fixes, [{ label: 'Use a-z', s: 1, e: 4, text: 'a-z' }]);
});

test('punctuation and an unclosed [ stay literals in Search', () => {
  assert.equal(analyzeSearch('u.s.').error, null);
  assert.equal(analyzeSearch('u.s.').hints.length, 0);
  assert.equal(analyzeSearch('[ab').error, null);
});

test('regex-only constructs in Search hint at the Regex tool', () => {
  assert.deepEqual(fixLabels(analyzeSearch('^cat.*').hints[0].fixes), ['Use Regex']);
});

// ─── Shared ───────────────────────────────────────────────────────────────────

test('an unfinished construct at the end stays quiet while the caret is on it', () => {
  const r = analyzeRegex('^(ab');
  assert.equal(errorVisible(r.error, '^(ab', 4), false);
  assert.equal(errorVisible(r.error, '^(ab', -1), true);
  const dot = analyzeUmiaq('l.ve');
  assert.equal(errorVisible(dot.error, 'l.ve', 4), true);
});
