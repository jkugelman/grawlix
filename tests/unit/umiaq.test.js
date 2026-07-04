import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUmiaqQuery,
  matchPattern,
  matchesPattern,
  findTuples,
  variableRanges,
} from '../../site/src/engine/umiaq.js';

function bindings(query, word) {
  const parsed = parseUmiaqQuery(query);
  assert.ok(parsed.ok, `query "${query}" should parse: ${parsed.error || ''}`);
  return matchPattern(word, parsed.patterns[0], parsed.constraints)
    .map(b => Object.fromEntries(Object.keys(b).sort().map(k => [k, b[k]])));
}

const entry = (norm, score = 100) => ({ norm, score });

async function tupleNorms(query, norms, opts) {
  const parsed = parseUmiaqQuery(query);
  assert.ok(parsed.ok, `query "${query}" should parse: ${parsed.error || ''}`);
  const pool = norms.map((n, i) => entry(n, norms.length - i));
  const { tuples } = await findTuples(parsed, pool, opts);
  return tuples.map(t => t.map(l => l.entry.norm)).sort((a, b) => a.join().localeCompare(b.join()));
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

test('parse: blank or whitespace-only is inert, not an error', () => {
  for (const q of ['', '   ', '\t']) assert.deepEqual(parseUmiaqQuery(q), { ok: false, empty: true });
});

test('parse: a plain literal is arity 1 with no variables', () => {
  const p = parseUmiaqQuery('cat');
  assert.equal(p.ok, true);
  assert.equal(p.arity, 1);
  assert.equal(p.variables.size, 0);
  assert.deepEqual(p.patterns[0].tokens, [{ t: 'lit', s: 'cat' }]);
});

test('parse: arity is the pattern count, ignoring constraint clauses', () => {
  assert.equal(parseUmiaqQuery('AB;BA').arity, 2);
  assert.equal(parseUmiaqQuery('AB;BA;|A|=2;A!=B').arity, 2);
  assert.equal(parseUmiaqQuery('AA;|A|=3').arity, 1);
});

test('parse: collects variables across all patterns', () => {
  const p = parseUmiaqQuery('AxB;C~A');
  assert.deepEqual([...p.variables].sort(), ['A', 'B', 'C']);
});

test('parse: length and not-equal constraints', () => {
  const p = parseUmiaqQuery('ABC;|A|=2;A!=B;B!=C');
  assert.deepEqual(p.constraints.length, { A: { min: 2, max: 2 } });
  assert.deepEqual(p.constraints.notEqual.A, ['B']);
  assert.deepEqual(p.constraints.notEqual.B.sort(), ['A', 'C']);
  assert.deepEqual(p.constraints.notEqual.C, ['B']);
});

test('parse: token kinds', () => {
  const p = parseUmiaqQuery('a?b*~A[cd]#@');
  assert.deepEqual(p.patterns[0].tokens.map(t => t.t),
    ['lit', 'dot', 'lit', 'star', 'rev', 'class', 'class', 'class']);
});

test('parse: ? is the any-char token; . is not a wildcard', () => {
  assert.deepEqual(parseUmiaqQuery('a?b').patterns[0].tokens.map(t => t.t),
                   ['lit', 'dot', 'lit']);
  assert.match(parseUmiaqQuery('a.b').error, /unexpected character/);
});

test('parse: length comparison operators map to {min,max}', () => {
  const len = q => parseUmiaqQuery('A;' + q).constraints.length.A;
  assert.deepEqual(len('|A|=3'),  { min: 3, max: 3 });
  assert.deepEqual(len('|A|>3'),  { min: 4, max: Infinity });
  assert.deepEqual(len('|A|>=3'), { min: 3, max: Infinity });
  assert.deepEqual(len('|A|<3'),  { min: 1, max: 2 });
  assert.deepEqual(len('|A|<=3'), { min: 1, max: 3 });
  assert.deepEqual(len('|A|>=2;|A|<=4'), { min: 2, max: 4 });
});

test('parse: zero-length is opt-in via an explicit lower bound', () => {
  const len = q => parseUmiaqQuery('A;' + q).constraints.length.A;
  assert.deepEqual(len('|A|>=0'), { min: 0, max: Infinity });   // empty or longer
  assert.deepEqual(len('|A|=0'),  { min: 0, max: 0 });          // forced empty
  assert.deepEqual(len('|A|>=0;|A|<=3'), { min: 0, max: 3 });   // empty up to 3
  assert.deepEqual(len('|A|<=0'), { min: 0, max: 0 });          // ceiling 0 ⇒ empty
  assert.deepEqual(len('|A|<=5'), { min: 1, max: 5 });          // upper bound alone keeps floor 1
});

test('parse: errors', () => {
  assert.match(parseUmiaqQuery('A;|A|>=5;|A|<=3').error, /contradict/);
  assert.match(parseUmiaqQuery('a[bc').error, /unclosed/);
  assert.match(parseUmiaqQuery('~').error, /variable/);
  assert.match(parseUmiaqQuery('/abc').error, /anagram/);
  assert.match(parseUmiaqQuery('A=(3:a*)').error, /unsupported constraint/);
  assert.match(parseUmiaqQuery('a=b').error, /unsupported constraint/);
});

test('parse: a query of only constraints, or a trailing ;, is inert', () => {
  assert.deepEqual(parseUmiaqQuery('A!=B'), { ok: false, empty: true });
  assert.deepEqual(parseUmiaqQuery('AB;'), { ok: false, empty: true });
});

// ─── Matching ────────────────────────────────────────────────────────────────

test('match: a variable binds the same substring everywhere (AA)', () => {
  assert.deepEqual(bindings('AA', 'gaga'), [{ A: 'ga' }]);
  assert.deepEqual(bindings('AA', 'mama'), [{ A: 'ma' }]);
  assert.deepEqual(bindings('AA', 'aaaa'), [{ A: 'aa' }]);
  assert.deepEqual(bindings('AA', 'cat'), []);
});

test('match: ~A is the reverse of A (A~A finds palindromes)', () => {
  assert.deepEqual(bindings('A~A', 'abba'), [{ A: 'ab' }]);
  assert.deepEqual(bindings('A~A', 'noon'), [{ A: 'no' }]);
  assert.deepEqual(bindings('A~A', 'abca'), []);
});

test('match: enumerates every binding', () => {
  assert.deepEqual(bindings('ABA', 'radar'), [{ A: 'r', B: 'ada' }]);
  assert.deepEqual(bindings('AB', 'cat'), [{ A: 'c', B: 'at' }, { A: 'ca', B: 't' }]);
});

test('match: length constraint bounds a variable', () => {
  assert.deepEqual(bindings('AA;|A|=1', 'aa'), [{ A: 'a' }]);
  assert.deepEqual(bindings('AA;|A|=1', 'gaga'), []);
});

test('match: length comparison operators bound a variable', () => {
  assert.deepEqual(bindings('A;|A|>=3', 'cat'), [{ A: 'cat' }]);
  assert.deepEqual(bindings('A;|A|>=3', 'at'),  []);
  assert.deepEqual(bindings('A;|A|<=2', 'at'),  [{ A: 'at' }]);
  assert.deepEqual(bindings('A;|A|<=2', 'cat'), []);
  assert.deepEqual(bindings('A;|A|>=2;|A|<=3', 'at'),   [{ A: 'at' }]);
  assert.deepEqual(bindings('A;|A|>=2;|A|<=3', 'a'),    []);
  assert.deepEqual(bindings('A;|A|>=2;|A|<=3', 'cats'), []);
});

test('match: a variable is non-empty by default — no empty binding', () => {
  assert.deepEqual(bindings('AB', 'go'), [{ A: 'g', B: 'o' }]);
});

test('match: |A|>=0 lets a variable bind the empty string', () => {
  assert.deepEqual(bindings('AB;|A|>=0', 'go'),
    [{ A: '', B: 'go' }, { A: 'g', B: 'o' }]);
  assert.deepEqual(bindings('AB;|A|>=0;|B|>=0', 'go'),
    [{ A: '', B: 'go' }, { A: 'g', B: 'o' }, { A: 'go', B: '' }]);
});

test('match: |A|=0 forces a variable to the empty string', () => {
  assert.deepEqual(bindings('Aat;|A|=0', 'at'),  [{ A: '' }]);   // A empty before the literal 'at'
  assert.deepEqual(bindings('Aat;|A|=0', 'cat'), []);            // 'c' can't precede an empty A
});

test('match: not-equal forbids equal bindings', () => {
  assert.deepEqual(bindings('AB;A!=B', 'ab'), [{ A: 'a', B: 'b' }]);
  assert.deepEqual(bindings('AB;A!=B', 'aa'), []);
});

test('match: literals, dots and stars', () => {
  assert.deepEqual(bindings('c?t', 'cat'), [{}]);
  assert.equal(matchesPattern('cat', parseUmiaqQuery('c?t').patterns[0]), true);
  assert.equal(matchesPattern('coat', parseUmiaqQuery('c?t').patterns[0]), false);
  assert.equal(matchesPattern('cat', parseUmiaqQuery('c*t').patterns[0]), true);
  assert.equal(matchesPattern('ct', parseUmiaqQuery('c*t').patterns[0]), true);
});

test('match: character classes and ranges behave like Search', () => {
  const m = q => w => matchesPattern(w, parseUmiaqQuery(q).patterns[0]);
  assert.equal(m('[bc]at')('cat'), true);
  assert.equal(m('[bc]at')('hat'), false);
  assert.equal(m('[^bc]at')('hat'), true);
  assert.equal(m('[a-c]t')('bt'), true);
  assert.equal(m('[a-c]t')('dt'), false);
});

test('match: # is a consonant excluding Y, @ a vowel including Y', () => {
  const m = q => w => matchesPattern(w, parseUmiaqQuery(q).patterns[0]);
  assert.equal(m('#')('y'), false, '# rejects Y');
  assert.equal(m('@')('y'), true,  '@ matches Y');
  assert.equal(m('@')('a'), true);
  assert.equal(m('#')('a'), false);
  assert.equal(m('#')('b'), true);
});

// ─── Finding tuples ────────────────────────────────────────────────────────────

test('find: AB;BA finds swapped word pairs', async () => {
  const tuples = await tupleNorms('AB;BA', ['ape', 'pea', 'bro', 'rob']);
  assert.deepEqual(tuples, [
    ['ape', 'pea'], ['bro', 'rob'], ['pea', 'ape'], ['rob', 'bro'],
  ]);
});

test('find: a length constraint makes AB;BA directional', async () => {
  const tuples = await tupleNorms('AB;BA;|A|=1', ['ape', 'pea', 'bro', 'rob']);
  assert.deepEqual(tuples, [['ape', 'pea'], ['bro', 'rob']]);
});

test('find: shared variables across patterns must agree (AkB;AlB)', async () => {
  const tuples = await tupleNorms('AkB;AlB', ['sky', 'sly', 'bake', 'bale', 'skz']);
  assert.deepEqual(tuples, [['bake', 'bale'], ['sky', 'sly']]);
});

test('find: numResults caps output and flags capped', async () => {
  const parsed = parseUmiaqQuery('AB;BA');
  const pool = ['ape', 'pea', 'bro', 'rob'].map((n, i) => entry(n, 100 - i));
  const { tuples, capped } = await findTuples(parsed, pool, { numResults: 2 });
  assert.equal(tuples.length, 2);
  assert.equal(capped, true);
});

test('find: ABC;CBA finds reversed triples across the whole pool, exhaustively', async () => {
  const parsed = parseUmiaqQuery('ABC;CBA');
  const pool = ['tip', 'pit', 'cat', 'tac', 'dog', 'god'].map((n, i) => entry(n, 100 - i));
  const { tuples, truncated } = await findTuples(parsed, pool, { maxMatchesPerPattern: 1 });
  const got = tuples.map(t => t.map(l => l.entry.norm)).sort((a, b) => a.join().localeCompare(b.join()));
  assert.deepEqual(got, [
    ['cat', 'tac'], ['dog', 'god'], ['god', 'dog'], ['pit', 'tip'], ['tac', 'cat'], ['tip', 'pit'],
  ]);
  assert.equal(truncated, false);
});

test('find: ABC;CBA;A!=C drops palindromic self-joins, keeps cross pairs', async () => {
  const tuples = await tupleNorms('ABC;CBA;A!=C', ['tip', 'pit', 'nan', 'cat', 'tac']);
  assert.deepEqual(tuples, [['cat', 'tac'], ['pit', 'tip'], ['tac', 'cat'], ['tip', 'pit']]);
});

test('find: a free-variable query takes the bucket path and truncates at maxMatchesPerPattern', async () => {
  const parsed = parseUmiaqQuery('AB;CB');
  const pool = ['abc', 'dbc'].map(n => entry(n, 100));
  const { truncated } = await findTuples(parsed, pool, { maxMatchesPerPattern: 1 });
  assert.equal(truncated, true);
});

test('find: respects a pre-aborted signal', async () => {
  const parsed = parseUmiaqQuery('AB;BA');
  const pool = [entry('ape', 1)];
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => findTuples(parsed, pool, { signal: ac.signal }));
});

// ─── Worked examples (Umiaq / Qat style) ─────────────────────────────────────
// Realistic queries, hand-computed. Kept to the supported subset — /anagram and
// =(…) subpatterns parse-error, so there's no worked example for them.

test('worked: A;~A finds semordnilaps — a word and its reversal', async () => {
  const tuples = await tupleNorms('A;~A', ['stop', 'pots', 'star', 'rats', 'time']);
  assert.deepEqual(tuples, [
    ['pots', 'stop'], ['rats', 'star'], ['star', 'rats'], ['stop', 'pots'],
  ]);
});

test('worked: A?~A matches odd-length palindromes (the middle is the free dot)', () => {
  assert.deepEqual(bindings('A?~A', 'radar'), [{ A: 'ra' }]);   // ra · d · ar
  assert.deepEqual(bindings('A?~A', 'level'), [{ A: 'le' }]);   // le · v · el
  assert.deepEqual(bindings('A?~A', 'hello'), []);              // not a palindrome
});

test('worked: ABC;BCA;CAB finds rotation triples (three vars, probe path)', async () => {
  const tuples = await tupleNorms('ABC;BCA;CAB', ['abc', 'bca', 'cab', 'xyz']);
  assert.deepEqual(tuples, [
    ['abc', 'bca', 'cab'], ['bca', 'cab', 'abc'], ['cab', 'abc', 'bca'],
  ]);
});

test('worked: @A;#A pairs a vowel-initial word with a consonant-initial one sharing a tail', async () => {
  // Guards class expansion in the probe path: #A expands the bound tail over every
  // consonant, the one tuple path the other worked examples don't reach.
  const tuples = await tupleNorms('@A;#A', ['oat', 'bat', 'cat', 'ear', 'bar']);
  assert.deepEqual(tuples, [['ear', 'bar'], ['oat', 'bat'], ['oat', 'cat']]);
});

test('worked: ?A;A finds beheadings — drop the first letter to reach another word', async () => {
  const tuples = await tupleNorms('?A;A', ['scat', 'cat', 'spot', 'pot', 'slot']);
  assert.deepEqual(tuples, [['scat', 'cat'], ['spot', 'pot']]);
});

test('worked: zero-length variables let the differing letter reach the word edge', async () => {
  // AaB;AeB with empty A,B admits AT/ET (A='' at the front) alongside BAD/BED —
  // the single-query answer to Qat's vowel-anywhere example.
  const tuples = await tupleNorms('AaB;AeB;|A|>=0;|B|>=0', ['at', 'et', 'bad', 'bed', 'zzz']);
  assert.deepEqual(tuples, [['at', 'et'], ['bad', 'bed']]);
});

test('worked: AB;BA over a multiply-divisible word enumerates every split and dedups', async () => {
  // The self-pairs aren't a bug: the ab·ab split sets A=B, so BA==AB and the word
  // is its own valid swap-partner — emitted absent an A!=B constraint to forbid it.
  const tuples = await tupleNorms('AB;BA', ['abab', 'baba']);
  assert.deepEqual(tuples, [
    ['abab', 'abab'], ['abab', 'baba'], ['baba', 'abab'], ['baba', 'baba'],
  ]);
});

// ─── Variable highlighting ───────────────────────────────────────────────────

const rangesFor = (query, word, binds) =>
  variableRanges(word, parseUmiaqQuery(query).patterns[0], binds);

test('variableRanges: locates each variable occurrence', () => {
  // ape = A('a') + B('pe')
  assert.deepEqual(rangesFor('AB', 'ape', { A: 'a', B: 'pe' }),
    [{ name: 'A', start: 0, len: 1 }, { name: 'B', start: 1, len: 2 }]);
});

test('variableRanges: a literal and a single star offset the variable', () => {
  // c + A('at') = cat; the literal 'c' pushes A to offset 1
  assert.deepEqual(rangesFor('cA', 'cat', { A: 'at' }), [{ name: 'A', start: 1, len: 2 }]);
  // A('he') + * (consuming 'llo') — the star takes the slack
  assert.deepEqual(rangesFor('A*', 'hello', { A: 'he' }), [{ name: 'A', start: 0, len: 2 }]);
});

test('variableRanges: more than one star is ambiguous — no ranges', () => {
  assert.deepEqual(rangesFor('*A*', 'banana', { A: 'an' }), []);
});

test('find: tuples carry per-variable highlight ranges, stable color per variable', async () => {
  const parsed = parseUmiaqQuery('AB;BA');
  const pool = ['ape', 'pea'].map((n, i) => entry(n, 100 - i));
  const { tuples } = await findTuples(parsed, pool);
  const apePea = tuples.find(t => t.map(l => l.entry.norm).join() === 'ape,pea');
  assert.ok(apePea, 'expected the ape/pea tuple');

  // ape = A('a') + B('pe'); pea = B('pe') + A('a'). The SAME variable must carry
  // the SAME color kind across both lanes, or the coloring conveys nothing.
  const kindAt = (lane, start) => lane.highlights.find(h => h.start === start)?.kind;
  const [ape, pea] = apePea;
  const aColor = kindAt(ape, 0);          // A in 'ape'
  const bColor = kindAt(ape, 1);          // B in 'ape'
  assert.ok(aColor && bColor && aColor !== bColor, 'A and B get distinct colors');
  assert.equal(kindAt(pea, 2), aColor, 'A is the same color in both lanes');   // 'a' at end of pea
  assert.equal(kindAt(pea, 0), bColor, 'B is the same color in both lanes');   // 'pe' at start of pea
});
