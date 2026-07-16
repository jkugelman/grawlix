import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUmiaqQuery,
  matchPattern,
  matchesPattern,
  findTuples,
  variableRanges,
} from '../../site/src/engine/umiaq.js';
import { TOOLS } from '../../site/src/engine/tools.js';

function bindings(query, word) {
  const parsed = parseUmiaqQuery(query);
  assert.ok(parsed.ok, `query "${query}" should parse: ${parsed.error || ''}`);
  return matchPattern(word, parsed.bindings[0], parsed.constraints)
    .map(b => Object.fromEntries(Object.keys(b).sort().map(k => [k, b[k]])));
}

function matches(query, word) {
  const parsed = parseUmiaqQuery(query);
  assert.ok(parsed.ok, `query "${query}" should parse: ${parsed.error || ''}`);
  return matchesPattern(word, parsed.bindings[0], parsed.constraints);
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
  assert.deepEqual(p.bindings[0].tokens, [{ t: 'lit', s: 'cat' }]);
});

test('parse: arity is the pattern count, ignoring constraint clauses', () => {
  assert.equal(parseUmiaqQuery('AB;BA').arity, 2);
  assert.equal(parseUmiaqQuery('AB;BA;|A|=2;A!=B').arity, 2);
  assert.equal(parseUmiaqQuery('AA;|A|=3').arity, 1);
});

test('parse: collects variables across all bindings', () => {
  const p = parseUmiaqQuery('AxB;C~A');
  assert.deepEqual([...p.variables].sort(), ['A', 'B', 'C']);
});

test('parse: length and not-equal constraints', () => {
  const p = parseUmiaqQuery('ABC;|A|=2;A!=B;B!=C');
  assert.deepEqual(p.constraints.varBounds, { A: { min: 2, max: 2 } });
  assert.deepEqual(p.constraints.varNotEqualsVar.A, ['B']);
  assert.deepEqual(p.constraints.varNotEqualsVar.B.sort(), ['A', 'C']);
  assert.deepEqual(p.constraints.varNotEqualsVar.C, ['B']);
});

test('parse: token kinds', () => {
  const p = parseUmiaqQuery('a?b*~A[cd]#@');
  assert.deepEqual(p.bindings[0].tokens.map(t => t.t),
    ['lit', 'dot', 'lit', 'star', 'rev', 'class', 'class', 'class']);
});

test('parse: ? is the any-char token; . is not a wildcard', () => {
  assert.deepEqual(parseUmiaqQuery('a?b').bindings[0].tokens.map(t => t.t),
                   ['lit', 'dot', 'lit']);
  assert.match(parseUmiaqQuery('a.b').error, /unexpected character/);
});

test('parse: length comparison operators map to {min,max}', () => {
  const len = q => parseUmiaqQuery('A;' + q).constraints.varBounds.A;
  assert.deepEqual(len('|A|=3'),  { min: 3, max: 3 });
  assert.deepEqual(len('|A|>3'),  { min: 4, max: Infinity });
  assert.deepEqual(len('|A|>=3'), { min: 3, max: Infinity });
  assert.deepEqual(len('|A|<3'),  { min: 1, max: 2 });
  assert.deepEqual(len('|A|<=3'), { min: 1, max: 3 });
  assert.deepEqual(len('|A|>=2;|A|<=4'), { min: 2, max: 4 });
});

test('parse: zero-length is opt-in via an explicit lower bound', () => {
  const len = q => parseUmiaqQuery('A;' + q).constraints.varBounds.A;
  assert.deepEqual(len('|A|>=0'), { min: 0, max: Infinity });   // empty or longer
  assert.deepEqual(len('|A|=0'),  { min: 0, max: 0 });          // forced empty
  assert.deepEqual(len('|A|>=0;|A|<=3'), { min: 0, max: 3 });   // empty up to 3
  assert.deepEqual(len('|A|<=0'), { min: 0, max: 0 });          // ceiling 0 ⇒ empty
  assert.deepEqual(len('|A|<=5'), { min: 1, max: 5 });          // upper bound alone keeps floor 1
});

test('parse: a sub-pattern that starts at zero relaxes the floor too', () => {
  const len = q => parseUmiaqQuery('A;' + q).constraints.varBounds.A;
  assert.deepEqual(len('A=*'), { min: 0, max: Infinity });      // "zero or more" means it
  assert.deepEqual(len('A=0-6:*'), { min: 0, max: 6 });
  assert.deepEqual(len('A=?*'), { min: 1, max: Infinity });     // a ? floors it at one
  assert.deepEqual(len('A=#@#'), { min: 3, max: 3 });
  assert.deepEqual(len('|A|>=2;A=*'), { min: 2, max: Infinity });  // an explicit floor still wins
});

test('match: an empty variable binds only where a clause declares a zero floor', () => {
  assert.deepEqual(bindings('AtenB', 'tenor'), []);                       // A can't vanish
  assert.deepEqual(bindings('AtenB;|A|>=0;|B|>=0', 'tenor'), [{ A: '', B: 'or' }]);
  assert.deepEqual(bindings('AtenB;A=*;B=*', 'mitten'), [{ A: 'mit', B: '' }]);
});

test('find: the non-empty floor is what keeps AB;BA off every word in the pool', async () => {
  const pool = ['ape', 'pea', 'ox'];
  assert.deepEqual(await tupleNorms('AB;BA', pool), [['ape', 'pea'], ['pea', 'ape']]);
  // Relaxed, every word W answers with the degenerate (W, W) — B empty makes both
  // bindings just `A`. That flood is the whole reason the floor is 1.
  const relaxed = await tupleNorms('AB;BA;|A|>=0;|B|>=0', pool);
  assert.ok(relaxed.some(t => t[0] === 'ox' && t[1] === 'ox'));
});

test('find: AtenB;AB reaches a leading and a trailing ten once emptiness is allowed', async () => {
  const pool = ['tenor', 'or', 'mitten', 'mit', 'tenant'];
  assert.deepEqual(await tupleNorms('AtenB;AB', pool), []);
  assert.deepEqual(await tupleNorms('AtenB;AB;|A|>=0;|B|>=0', pool),
                   [['mitten', 'mit'], ['tenor', 'or']]);
});

test('quickFix: names only the variables an added |V|>=0 would actually free', () => {
  const fix = q => TOOLS.umiaq.quickFix({ query: q });
  assert.deepEqual(fix('AtenB;AB').params, { query: 'AtenB;AB;|A|>=0;|B|>=0' });
  assert.equal(fix('AtenB;AB').label, 'Allow empty variables');
  assert.deepEqual(fix('AtenB;AB;|A|>=0').params, { query: 'AtenB;AB;|A|>=0;|B|>=0' });
  assert.equal(fix('AtenB;AB;|A|>=0;|B|>=0'), null);   // nothing left to free
  assert.equal(fix('AtenB;AB;A=*;B=*'), null);
  assert.equal(fix('ABBA;|A|>=2;B=#@#'), null);        // both are pinned above zero
  assert.equal(fix('cat'), null);                     // no variables
  assert.equal(fix('a[bc'), null);                    // doesn't parse
});

test('quickFix: the tooltip shows the clauses it is about to add', () => {
  const title = q => TOOLS.umiaq.quickFix({ query: q }).title;
  assert.equal(title('AtenB;AB'), "By default, variables can't be empty. Adds |A|>=0;|B|>=0.");
  assert.equal(title('A?B;|B|>=2'), "By default, variables can't be empty. Adds |A|>=0.");   // B is already pinned
  assert.equal(title('AxByC;ABC'), "By default, variables can't be empty. Adds |A|>=0;|B|>=0;|C|>=0.");
});

test('parse: errors', () => {
  assert.match(parseUmiaqQuery('A;|A|>=5;|A|<=3').error, /contradict/);
  assert.match(parseUmiaqQuery('a[bc').error, /unclosed/);
  assert.match(parseUmiaqQuery('~').error, /variable/);
  assert.match(parseUmiaqQuery('a/bc').error, /must start a binding/);
  assert.match(parseUmiaqQuery('//abc').error, /letter-bank anagram/);
  assert.match(parseUmiaqQuery('/(abc)').error, /subset anagram/);
  assert.match(parseUmiaqQuery('/a.c').error, /letters, digits/);
  assert.match(parseUmiaqQuery('a=b').error, /unsupported constraint/);
  assert.match(parseUmiaqQuery('A=B?').error, /cannot contain variables/);
  assert.match(parseUmiaqQuery('9-3:ab').error, /length prefix range is empty/);
  assert.match(parseUmiaqQuery('7-:ab').error, /invalid length prefix/);
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
  assert.equal(matchesPattern('cat', parseUmiaqQuery('c?t').bindings[0]), true);
  assert.equal(matchesPattern('coat', parseUmiaqQuery('c?t').bindings[0]), false);
  assert.equal(matchesPattern('cat', parseUmiaqQuery('c*t').bindings[0]), true);
  assert.equal(matchesPattern('ct', parseUmiaqQuery('c*t').bindings[0]), true);
});

test('match: character classes and ranges behave like Search', () => {
  const m = q => w => matchesPattern(w, parseUmiaqQuery(q).bindings[0]);
  assert.equal(m('[bc]at')('cat'), true);
  assert.equal(m('[bc]at')('hat'), false);
  assert.equal(m('[^bc]at')('hat'), true);
  assert.equal(m('[a-c]t')('bt'), true);
  assert.equal(m('[a-c]t')('dt'), false);
});

test('match: # is a consonant excluding Y, @ a vowel including Y', () => {
  const m = q => w => matchesPattern(w, parseUmiaqQuery(q).bindings[0]);
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

test('find: shared variables across bindings must agree (AkB;AlB)', async () => {
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

test('find: a query with no incremental grounding takes the bucket path and truncates', async () => {
  // Disjoint variable sets: the driver AB can't ground C or D by any affix, so no probe
  // or affix plan exists and the free-variable bucket path (which truncates) is the only
  // strategy. (AB;CB, once the affix path's hard case, is now solved — see umiaq-affix.)
  const parsed = parseUmiaqQuery('AB;CD');
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
// Realistic queries, hand-computed. Kept to the supported subset — parenthesized
// sub-patterns (=(…)) and subset/bank anagram (/(…), //…) parse-error, so there's
// no worked example for them.

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
  variableRanges(word, parseUmiaqQuery(query).bindings[0], binds);

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

test('variableRanges: two stars resolve via regex placement (leftmost)', () => {
  assert.deepEqual(rangesFor('*A*', 'banana', { A: 'an' }), [{ name: 'A', start: 1, len: 2 }]);
  assert.deepEqual(rangesFor('*ABCDAB*', 'xxabcdabyy', { A: 'a', B: 'b', C: 'c', D: 'd' }), [
    { name: 'A', start: 2, len: 1 }, { name: 'B', start: 3, len: 1 },
    { name: 'C', start: 4, len: 1 }, { name: 'D', start: 5, len: 1 },
    { name: 'A', start: 6, len: 1 }, { name: 'B', start: 7, len: 1 },
  ]);
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

// ─── Length prefix, sum-length, and variable sub-patterns ────────────────────

test('parse: a length prefix reads the score-range syntax into wordLen', () => {
  const wl = q => parseUmiaqQuery(q).bindings[0].wordLen;
  assert.deepEqual(wl('7:a*'),   { min: 7,  max: 7 });
  assert.deepEqual(wl('7-9:a*'), { min: 7,  max: 9 });
  assert.deepEqual(wl('0-6:a*'), { min: 0,  max: 6 });
  assert.deepEqual(wl('10+:a*'), { min: 10, max: null });
  assert.equal(wl('a*'), null);
});

test('match: a length prefix bounds the whole matched word', () => {
  assert.deepEqual(bindings('4:A~A', 'abba'), [{ A: 'ab' }]);
  assert.deepEqual(bindings('5:A~A', 'abba'), []);            // right shape, wrong length
  assert.equal(matches('3-4:a*', 'abc'),   true);
  assert.equal(matches('3-4:a*', 'abcde'), false);
  assert.equal(matches('4+:a*',  'abcd'),  true);
  assert.equal(matches('4+:a*',  'abc'),   false);
  assert.equal(matches('0-1:a*', 'a'),     true);
});

test('find: a length prefix filters a probe-path partner lane by length', async () => {
  // 4: drops the 3-letter tea/eat swap, keeps the 4-letter stop/tops.
  const got = await tupleNorms('AB;4:BA', ['tea', 'eat', 'stop', 'tops']);
  assert.deepEqual(got, [['stop', 'tops'], ['tops', 'stop']]);
});

test('parse: a multi-variable length constraint parses into sumLen', () => {
  assert.deepEqual(parseUmiaqQuery('AB;|AB|=9').constraints.sumLen,  [{ vars: ['A', 'B'], lit: 0, min: 9, max: 9 }]);
  assert.deepEqual(parseUmiaqQuery('AB;|AB|>=5').constraints.sumLen, [{ vars: ['A', 'B'], lit: 0, min: 5, max: Infinity }]);
  assert.deepEqual(parseUmiaqQuery('AB;|AB|<=5').constraints.sumLen, [{ vars: ['A', 'B'], lit: 0, min: 0, max: 5 }]);
  assert.deepEqual(parseUmiaqQuery('AB;|A|=9').constraints.sumLen, []);   // single var stays off sumLen
  assert.deepEqual(parseUmiaqQuery('AB;|A|=9').constraints.varBounds, { A: { min: 9, max: 9 } });
});

test('parse: a length term may mix variables and literals in any arrangement', () => {
  assert.deepEqual(parseUmiaqQuery('AxB;|AxB|=9').constraints.sumLen, [{ vars: ['A', 'B'], lit: 1, min: 9, max: 9 }]);
  assert.deepEqual(parseUmiaqQuery('A;|Afoo|=8').constraints.sumLen, [{ vars: ['A'], lit: 3, min: 8, max: 8 }]);
  assert.deepEqual(parseUmiaqQuery('B;|barB|<=6').constraints.sumLen, [{ vars: ['B'], lit: 3, min: 0, max: 6 }]);
  assert.deepEqual(parseUmiaqQuery('A;B;C;|fooAbarBbazCquux|=20').constraints.sumLen,
    [{ vars: ['A', 'B', 'C'], lit: 13, min: 20, max: 20 }]);
  // A single var *with* literals rides the sumLen join, not the per-var pruning path.
  assert.deepEqual(parseUmiaqQuery('A;|Afoo|=8').constraints.varBounds, {});
  assert.match(parseUmiaqQuery('A;|A*|=4').error, /variables and literals/);
  assert.match(parseUmiaqQuery('A;|A#B|=4').error, /variables and literals/);
});

test('match: a length term counts its literals', () => {
  assert.deepEqual(bindings('AxB;|AxB|=5', 'aaxbb'), [{ A: 'aa', B: 'bb' }]);   // 2 + x + 2
  assert.deepEqual(bindings('AxB;|AxB|=4', 'aaxbb'), []);                       // 5 ≠ 4
  assert.deepEqual(bindings('A;|Afoo|=6', 'cat'), [{ A: 'cat' }]);              // 3 + 3
  assert.deepEqual(bindings('A;|Afoo|=6', 'at'),  []);                          // 2 + 3 ≠ 6
  assert.deepEqual(bindings('B;|barB|=5', 'be'),  [{ B: 'be' }]);               // 3 + 2
  assert.deepEqual(bindings('B;|barB|=5', 'bee'), []);                          // 3 + 3 ≠ 5
});

test('find: a mixed length term filters cross-binding tuples by combined length', async () => {
  const got = await tupleNorms('A;B;|xAyB|=5', ['ab', 'cat', 'dog', 'x']);      // len(A) + len(B) + 2 = 5
  assert.deepEqual(got, [['ab', 'x'], ['x', 'ab']]);
});

test('find: a sum-length constraint filters tuples by combined length', async () => {
  // A and B sit in different bindings, so |AB| is only whole at the join (the fail-open path).
  const got = await tupleNorms('A;B;|AB|=5', ['ab', 'cat', 'dog', 'x']);
  assert.deepEqual(got, [['ab', 'cat'], ['ab', 'dog'], ['cat', 'ab'], ['dog', 'ab']]);
});

test('parse: a relational length constraint parses into lenCompare', () => {
  assert.deepEqual(parseUmiaqQuery('AB;|A|=|B|').constraints.lenCompare,
    [{ left: { vars: ['A'], lit: 0 }, op: '=', right: { vars: ['B'], lit: 0 }, src: '|A|=|B|' }]);
  for (const op of ['<', '<=', '>', '>=', '!=']) {
    assert.deepEqual(parseUmiaqQuery(`AB;|A|${op}|B|`).constraints.lenCompare[0].op, op);
  }
  assert.deepEqual(parseUmiaqQuery('AB;CD;|xAB|>=|Cy|').constraints.lenCompare,   // literals sum like a length term
    [{ left: { vars: ['A', 'B'], lit: 1 }, op: '>=', right: { vars: ['C'], lit: 1 }, src: '|xAB|>=|Cy|' }]);
  assert.deepEqual(parseUmiaqQuery('AB;|A|=|B|').constraints.varBounds, {});   // never a per-var window
  assert.deepEqual(parseUmiaqQuery('AB;|A|=|B|').constraints.sumLen, []);      // nor the sumLen join
});

test('parse: |A|!=n is a numeric length filter, not a search window', () => {
  assert.deepEqual(parseUmiaqQuery('A;|A|!=3').constraints.lenCompare,
    [{ left: { vars: ['A'], lit: 0 }, op: '!=', right: { vars: [], lit: 3 }, src: '|A|!=3' }]);
  assert.deepEqual(parseUmiaqQuery('A;|A|!=3').constraints.varBounds, {});   // a hole is not a window
  assert.deepEqual(parseUmiaqQuery('A;|A|=3').constraints.lenCompare, []);                    // ordered ops keep
  assert.deepEqual(parseUmiaqQuery('A;|A|=3').constraints.varBounds, { A: { min: 3, max: 3 } });  // their fast path
});

test('parse: a relational length term rejects wildcards and non-term right sides', () => {
  assert.match(parseUmiaqQuery('A;B;|A*|=|B|').error, /variables and literals/);
  assert.match(parseUmiaqQuery('A;B;|A|=|B#|').error, /variables and literals/);
  assert.match(parseUmiaqQuery('A;B;|A|=B').error, /unsupported constraint/);   // bare variable RHS is not a length
});

test('match: a relational length constraint filters within one binding', () => {
  assert.deepEqual(bindings('AB;|A|=|B|', 'abcd'), [{ A: 'ab', B: 'cd' }]);        // equal halves
  assert.deepEqual(bindings('AB;|A|=|B|', 'abcde'), []);                           // no equal split
  assert.deepEqual(bindings('AB;|A|<|B|', 'abcd'), [{ A: 'a', B: 'bcd' }]);
  assert.deepEqual(bindings('AB;|A|!=|B|', 'abcd'), [{ A: 'a', B: 'bcd' }, { A: 'abc', B: 'd' }]);
  assert.deepEqual(bindings('A;|A|!=3', 'at'),  [{ A: 'at' }]);
  assert.deepEqual(bindings('A;|A|!=3', 'cat'), []);
});

test('find: a relational length constraint filters cross-binding tuples', async () => {
  assert.deepEqual(await tupleNorms('A;B;|A|=|B|', ['ab', 'yz', 'cat', 'x']),   // whole only at the join
    [['ab', 'ab'], ['ab', 'yz'], ['cat', 'cat'], ['x', 'x'], ['yz', 'ab'], ['yz', 'yz']]);
  assert.deepEqual(await tupleNorms('A;B;|A|<|B|', ['x', 'ab', 'cat']),
    [['ab', 'cat'], ['x', 'ab'], ['x', 'cat']]);
});

test('parse: a variable sub-pattern compiles into varPattern', () => {
  const vp = parseUmiaqQuery('A;A=#@#').constraints.varEqualsPattern.A;
  assert.deepEqual([vp.min, vp.max], [3, 3]);
  assert.ok(vp.test('cat'));
  assert.ok(!vp.test('aaa'));
  const vp2 = parseUmiaqQuery('A;A=2-4:*').constraints.varEqualsPattern.A;
  assert.deepEqual([vp2.min, vp2.max], [2, 4]);
});

test('match: a variable sub-pattern constrains the binding', () => {
  assert.deepEqual(bindings('AA;A=#@#', 'catcat'), [{ A: 'cat' }]);   // 'cat' is consonant-vowel-consonant
  assert.deepEqual(bindings('AA;A=#@#', 'gaga'), []);                 // 'ga' is not
  assert.deepEqual(bindings('A;A=??s', 'bus'), [{ A: 'bus' }]);       // ends in s
  assert.deepEqual(bindings('A;A=??s', 'bun'), []);
  assert.deepEqual(bindings('A;A=2-4:*', 'ok'), [{ A: 'ok' }]);
  assert.deepEqual(bindings('A;A=2-4:*', 'a'), []);                   // shorter than the sub-pattern allows
});

test('parse: A!=sub-pattern is a negation; A!=B stays variable inequality', () => {
  const p = parseUmiaqQuery('A;A!=#@#');
  assert.equal(p.constraints.varNotEqualsPattern.A.length, 1);
  assert.ok(p.constraints.varNotEqualsPattern.A[0].test('cat'));
  const q = parseUmiaqQuery('AB;BA;A!=B');
  assert.deepEqual(q.constraints.varNotEqualsPattern, {});
  assert.deepEqual(q.constraints.varNotEqualsVar.A, ['B']);
});

test('match: a negated sub-pattern rejects bindings that fit it', () => {
  assert.deepEqual(bindings('A;A!=#@#', 'cat'), []);                  // 'cat' is consonant-vowel-consonant
  assert.deepEqual(bindings('A;A!=#@#', 'ai'),  [{ A: 'ai' }]);       // not, so kept
  assert.deepEqual(bindings('A;A=*s;A!=???', 'buns'), [{ A: 'buns' }]);   // ends in s, 4 letters → kept
  assert.deepEqual(bindings('A;A=*s;A!=???', 'bus'),  []);               // ends in s but exactly 3 → rejected
});

// ─── Term equals / not-equals ────────────────────────────────────────────────

test('parse: AB=word compiles into constraints.termEquals', () => {
  const p = parseUmiaqQuery('A;B;AB=boardroom');
  assert.equal(p.constraints.termEquals.length, 1);
  assert.equal(p.constraints.termNotEquals.length, 0);
  const tc = p.constraints.termEquals[0];
  assert.deepEqual(tc.vars, ['A', 'B']);
  assert.deepEqual(tc.rhsEntries.map(e => e.norm), ['boardroom']);   // a literal target → one string
});

test('parse: = expands a synthetic pool; != lands in termNotEquals and never drives', () => {
  assert.equal(parseUmiaqQuery('A;B;AB=bo?').constraints.termEquals[0].rhsEntries.length, 36);
  const p = parseUmiaqQuery('AB;BA;AB!=stop');
  assert.equal(p.constraints.termEquals.length, 0);
  assert.equal(p.constraints.termNotEquals.length, 1);
  assert.equal(p.constraints.termNotEquals[0].rhsEntries, null);
});

test('parse: term-clause errors', () => {
  assert.match(parseUmiaqQuery('A;AB=boardroom').error, /B must appear in a binding/);
  assert.match(parseUmiaqQuery('A;B;AB=bo*m').error, /\* on the right side/);
  assert.match(parseUmiaqQuery('A;B;AB=C').error, /comparing two terms/);
  assert.match(parseUmiaqQuery('A;B;AB=????????????????').error, /too broad/);
});

test('match: AB=word filters a single binding to words that spell the target', () => {
  assert.equal(matches('AB;AB=boardroom', 'boardroom'), true);
  assert.equal(matches('AB;AB=boardroom', 'board'),      false);
  assert.equal(matches('ABC;AB=boardroom', 'boardrooms'), true);    // A+B = boardroom, C = s
  assert.equal(matches('ABC;AB=boardroom', 'boardroom'),  false);   // C would have to be empty
});

test('match: AB!=word drops words that spell the target', () => {
  assert.equal(matches('AB;AB!=boardroom', 'boardroom'), false);
  assert.equal(matches('AB;AB!=boardroom', 'boardgame'), true);
});

test('find: AB=word splits its target across bindings (probe path)', async () => {
  const got = await tupleNorms('A;B;AB=boardroom', ['board', 'room', 'boa', 'rdroom', 'bo', 'ardroom', 'x']);
  assert.deepEqual(got, [['bo', 'ardroom'], ['boa', 'rdroom'], ['board', 'room']]);
});

test('find: a term-equals constrains a cross-binding tuple (bucket path)', async () => {
  // C is free, so the driver lacks a variable and the join can't probe — exercises buckets.
  const got = await tupleNorms('A;B;C;AB=boardroom', ['board', 'room', 'x']);
  assert.deepEqual(got, [['board', 'room', 'board'], ['board', 'room', 'room'], ['board', 'room', 'x']]);
});

test('find: a fixed-width RHS matches every expansion of the target', async () => {
  const got = await tupleNorms('A;B;AB=b?ard?oom', ['bo', 'be', 'ardroom', 'board', 'room']);
  assert.deepEqual(got, [['be', 'ardroom'], ['bo', 'ardroom'], ['board', 'room']]);
});

test('find: a length constraint narrows a term-equals split', async () => {
  const got = await tupleNorms('A;B;AB=boardroom;|A|=5', ['board', 'room', 'bo', 'ardroom']);
  assert.deepEqual(got, [['board', 'room']]);
});

test('find: AB!=word drops the tuple whose term spells the target', async () => {
  const pool = ['abc', 'bca', 'xy', 'yx'];
  assert.deepEqual(await tupleNorms('AB;BA', pool),
    [['abc', 'bca'], ['bca', 'abc'], ['xy', 'yx'], ['yx', 'xy']]);
  assert.deepEqual(await tupleNorms('AB;BA;AB!=abc', pool),   // AB-lane "abc" tuple removed
    [['bca', 'abc'], ['xy', 'yx'], ['yx', 'xy']]);
});

// ─── Anagram ─────────────────────────────────────────────────────────────────

test('parse: an anagram binding compiles to a single anagram token', () => {
  const p = parseUmiaqQuery('/triangle');
  assert.equal(p.arity, 1);
  const t = p.bindings[0].tokens;
  assert.equal(t.length, 1);
  assert.equal(t[0].t, 'anagram');
  assert.deepEqual([t[0].min, t[0].max], [8, 8]);
});

test('match: /letters matches any rearrangement, extras and gaps rejected', () => {
  assert.equal(matches('/act', 'cat'),  true);
  assert.equal(matches('/act', 'act'),  true);
  assert.equal(matches('/act', 'cot'),  false);   // wrong letter
  assert.equal(matches('/act', 'ac'),   false);   // missing a letter
  assert.equal(matches('/act', 'cats'), false);   // an extra letter, no wildcard
  assert.equal(matches('/less', 'sels'), true);    // repeated letters counted (s twice)
  assert.equal(matches('/less', 'seal'), false);   // only one s
  assert.deepEqual(bindings('/act', 'cat'), [{}]);   // an anagram binds no variables
});

test('match: ? adds a wildcard slot, * an open-ended run', () => {
  assert.equal(matches('/act?', 'acts'), true);    // act + one more
  assert.equal(matches('/act?', 'cart'), true);
  assert.equal(matches('/act?', 'act'),  false);   // one short
  assert.equal(matches('/act?', 'catty'), false);  // one too many
  assert.equal(matches('/act*', 'act'),    true);
  assert.equal(matches('/act*', 'cats'),   true);
  assert.equal(matches('/act*', 'tactic'), true);  // contains a, c, t
  assert.equal(matches('/act*', 'at'),     false); // missing c
});

test('match: a length prefix caps an anagram binding', () => {
  assert.equal(matches('4:/act*', 'acts'),   true);
  assert.equal(matches('4:/act*', 'act'),    false);   // 3 letters, under the prefix
  assert.equal(matches('4:/act*', 'tactic'), false);   // 6 letters, over the prefix
});

test('match: a sub-pattern anagram constrains a bound variable', () => {
  assert.deepEqual(bindings('A;A=/act', 'cat'),  [{ A: 'cat' }]);
  assert.deepEqual(bindings('A;A=/act', 'act'),  [{ A: 'act' }]);
  assert.deepEqual(bindings('A;A=/act', 'cats'), []);          // not an anagram of act
  assert.deepEqual(bindings('A;A=/act', 'dog'),  []);
  assert.deepEqual(bindings('A;A=/ac*', 'cab'),  [{ A: 'cab' }]);   // contains a and c
  assert.deepEqual(bindings('A;A=/ac*', 'dab'),  []);              // no c
});

test('find: anagram bindings cross-join in a tuple (bucket path)', async () => {
  const got = await tupleNorms('/act;/dog', ['cat', 'act', 'god', 'dog', 'x']);
  assert.deepEqual(got, [['act', 'dog'], ['act', 'god'], ['cat', 'dog'], ['cat', 'god']]);
});

test('parse: a clean anagram term-equals plans an index solve; an exotic one expands', () => {
  const clean = parseUmiaqQuery('A;B;AB=/random');
  assert.ok(clean.anagramSolve);                                    // routed to the index solver
  assert.equal(clean.constraints.termEquals[0].rhsEntries, undefined);   // no permutation pool built
  const exotic = parseUmiaqQuery('A;B;C;AB=/random');   // an extra binding → not the clean form
  assert.equal(exotic.anagramSolve, null);
  const eq = exotic.constraints.termEquals[0];
  const key = s => [...s].sort().join('');
  assert.equal(eq.rhsEntries.length, 720);   // 6 distinct letters → 6!
  assert.ok(eq.rhsEntries.every(e => key(e.norm) === key('random')));
  assert.equal(parseUmiaqQuery('A;B;C;AB=/level').constraints.termEquals[0].rhsEntries.length, 30);   // l,e ×2 → 5!/(2!2!)
});

test('match: an anagram term-equals keeps words that rearrange to the target', () => {
  assert.equal(matches('AB;AB=/random', 'random'),  true);
  assert.equal(matches('AB;AB=/random', 'nomdar'),  true);    // an anagram of random
  assert.equal(matches('AB;AB=/random', 'rando'),   false);   // missing a letter
  assert.equal(matches('AB;AB=/random', 'randoms'), false);   // an extra letter
  assert.equal(matches('AB;AB!=/random', 'random'), false);   // negated: the anagram is dropped
  assert.equal(matches('AB;AB!=/random', 'attend'), true);
});

test('find: an anagram term-equals splits an anagram of the target across bindings', async () => {
  const pool = ['ran', 'dom', 'mad', 'nor', 'or', 'damn', 'road', 'man'];
  assert.deepEqual(await tupleNorms('A;B;AB=/random', pool),
    [['damn', 'or'], ['dom', 'ran'], ['mad', 'nor'], ['nor', 'mad'], ['or', 'damn'], ['ran', 'dom']]);
  assert.deepEqual(await tupleNorms('A;B;AB=/random;|A|=3', pool),   // a length constraint composes
    [['dom', 'ran'], ['mad', 'nor'], ['nor', 'mad'], ['ran', 'dom']]);
});

test('parse: anagram term-equals errors', () => {
  assert.match(parseUmiaqQuery('A;B;AB=/rand?m').error, /aren't supported in an anagram target/);
  assert.match(parseUmiaqQuery('A;B;AB=/rand*').error,  /aren't supported in an anagram target/);
  assert.match(parseUmiaqQuery('A;B;AB=/[rn]ando').error, /aren't supported in an anagram target/);   // class slot in target
  assert.match(parseUmiaqQuery('A;B;C;AB=/abcdefghij').error, /too many letters/);   // exotic → capped fallback
  assert.match(parseUmiaqQuery('A;B;AB=//random').error, /letter-bank anagram/);
});

test('parse: a class slot in an anagram bag counts toward the length', () => {
  const t = parseUmiaqQuery('/[abcd]efg').bindings[0].tokens[0];
  assert.equal(t.t, 'anagram');
  assert.deepEqual([t.min, t.max], [4, 4]);   // e,f,g + one class slot
  assert.equal(t.classes.length, 1);
  assert.deepEqual([parseUmiaqQuery('/ab#@*').bindings[0].tokens[0].min,
                    parseUmiaqQuery('/ab#@*').bindings[0].tokens[0].max], [4, Infinity]);   // a,b + #,@ + open
});

test('match: a character class fills one anagram slot', () => {
  assert.equal(matches('/[abcd]efg', 'cefg'), true);    // c ∈ [abcd]
  assert.equal(matches('/[abcd]efg', 'gfea'), true);    // any order, a ∈ [abcd]
  assert.equal(matches('/[abcd]efg', 'zefg'), false);   // z ∉ [abcd]
  assert.equal(matches('/[abcd]efg', 'efg'),  false);   // slot unfilled
  assert.equal(matches('/[abcd]efg', 'aefgh'), false);  // an extra letter, no wildcard
  assert.equal(matches('/[^abc]xy', 'zxy'), true);      // negated class
  assert.equal(matches('/[^abc]xy', 'axy'), false);
  assert.equal(matches('/[l-p]xy', 'nxy'), true);       // range
  assert.equal(matches('/[l-p]xy', 'qxy'), false);
});

test('match: # and @ are consonant/vowel anagram slots', () => {
  assert.equal(matches('/#at', 'cat'), true);
  assert.equal(matches('/#at', 'oat'), false);   // o is a vowel
  assert.equal(matches('/@bt', 'bat'), true);
  assert.equal(matches('/@bt', 'bbt'), false);   // b is a consonant
});

test('match: class slots compose with fixed letters, ? and *', () => {
  assert.equal(matches('/[st]ea?', 'seat'), true);    // s slot, ea, ? → t
  assert.equal(matches('/[st]ea*', 'teasers'), true); // t slot, ea, * absorbs rest
  assert.equal(matches('/[st]ea*', 'earl'), false);   // no s or t
});

test('match: overlapping class slots need a matching, not a greedy claim', () => {
  assert.equal(matches('/[ab][bc]', 'bc'), true);   // [ab]→b, [bc]→c (greedy [ab]→b then [bc]→b would fail)
  assert.equal(matches('/[ab][bc]', 'cb'), true);   // [ab]→b, [bc]→c
  assert.equal(matches('/[ab][bc]', 'ab'), true);   // [ab]→a, [bc]→b
  assert.equal(matches('/[ab][bc]', 'bb'), true);   // two b's, one each
  assert.equal(matches('/[ab][bc]', 'aa'), false);  // [bc] has nothing to claim
  assert.equal(matches('/[ab][ab]', 'ba'), true);
});

test('match: a sub-pattern anagram takes a class slot', () => {
  assert.deepEqual(bindings('A;A=/[abcd]efg', 'cefg'), [{ A: 'cefg' }]);
  assert.deepEqual(bindings('A;A=/[abcd]efg', 'zefg'), []);
});

test('find: class-slot anagram bindings cross-join in a tuple', async () => {
  const got = await tupleNorms('/[cd]at;/[gh]od', ['cat', 'bat', 'god', 'rod']);
  assert.deepEqual(got, [['cat', 'god']]);
});

test('find: the index solver splits a long target the permutation cap rejected', async () => {
  // TRIANGLE — 8 distinct letters — overflows the permutation cap; the index solver handles it.
  const got = await tupleNorms('A;B;AB=/triangle', ['gnat', 'rile', 'ring', 'tale', 'gait', 'x']);
  assert.deepEqual(got, [['gnat', 'rile'], ['rile', 'gnat'], ['ring', 'tale'], ['tale', 'ring']]);
});

test('find: the index solver handles 3-way splits and composes with |A|', async () => {
  const pool = ['ran', 'do', 'm', 'and', 'or', 'nd', 'rom', 'a', 'r', 'x'];
  const key = s => [...s].sort().join('');
  const three = await tupleNorms('A;B;C;ABC=/random', pool);
  assert.ok(three.length > 0);
  assert.ok(three.every(t => t.length === 3 && key(t.join('')) === key('random')));
  const bounded = await tupleNorms('A;B;C;ABC=/random;|A|=3', pool);
  assert.ok(bounded.length > 0);
  assert.ok(bounded.every(t => t[0].length === 3));
});

test('find: a sub-pattern and A!=B filter anagram-split lanes', async () => {
  // A must be consonant-vowel-consonant (ran, dom, rom all qualify; and does not).
  assert.deepEqual(await tupleNorms('A;B;AB=/random;A=#@#', ['ran', 'dom', 'rom', 'and']),
    [['dom', 'ran'], ['ran', 'dom'], ['rom', 'and']]);
  const all = await tupleNorms('A;B;AB=/aabb', ['ab', 'ba', 'aa', 'bb']);
  assert.ok(all.some(([a, b]) => a === b));                          // ab+ab, ba+ba present
  assert.ok((await tupleNorms('A;B;AB=/aabb;A!=B', ['ab', 'ba', 'aa', 'bb'])).every(([a, b]) => a !== b));
});
