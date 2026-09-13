import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldDisplay, foldedDisplayOf, normLen, displayOf } from '../../site/src/engine/norm.js';
import { parseUmiaqQuery, matchPattern, findTuples, variableHighlights, caseOK } from '../../site/src/engine/umiaq.js';
import { compareKeys } from '../../site/src/engine/sort.js';
import { PackedRecordJoin } from '../../site/src/engine/packed-join.js';
import umiaqTool from '../../site/src/engine/tools/umiaq.js';

// ─── Folding and length helpers ──────────────────────────────────────────────

test('foldDisplay lowercases without changing length', () => {
  assert.equal(foldDisplay('The IRS'), 'the irs');
  assert.equal(foldDisplay('Éclair'), 'éclair');
  assert.equal(foldDisplay('İstanbul'), 'İstanbul');
  assert.equal(foldDisplay('straße'), 'straße');
  assert.equal(foldDisplay('ABC 3-D!'), 'abc 3-d!');
  for (const s of ['The IRS', 'Éclair', 'İstanbul', 'straße', 'ÀÉÎÕÜ']) assert.equal(foldDisplay(s).length, s.length);
});

test('foldedDisplayOf folds the display when present, returns norm otherwise, and caches', () => {
  const e = { norm: 'theirs', display: 'the IRS' };
  assert.equal(foldedDisplayOf(e), 'the irs');
  assert.equal(e._fold, 'the irs');
  assert.equal(foldedDisplayOf(e), 'the irs');
  assert.equal(foldedDisplayOf({ norm: 'theirs', display: null }), 'theirs');
  assert.equal(foldedDisplayOf({ norm: 'theirs' }), 'theirs');
});

test('normLen counts letters and digits the way the Length column does', () => {
  assert.equal(normLen('the irs'), 6);
  assert.equal(normLen('3-d'), 2);
  assert.equal(normLen('straße'), 7);
  assert.equal(normLen('café'), 4);
  assert.equal(normLen(' '), 0);
  assert.equal(normLen(''), 0);
  assert.equal(normLen("don't"), 4);
});

// ─── Parsing: spaces, escapes, arm selection ─────────────────────────────────

const parseOk = q => { const p = parseUmiaqQuery(q); assert.ok(p.ok, `${JSON.stringify(q)} should parse: ${p.error}`); return p; };
const parseErr = q => {
  const p = parseUmiaqQuery(q);
  assert.equal(p.ok, false, `${JSON.stringify(q)} should fail`);
  assert.ok(p.error, `${JSON.stringify(q)} should carry an error, not be inert`);
  return p.error;
};
const lits = p => p.bindings[0].tokens.filter(t => t.t === 'lit').map(t => t.s);

test('parse: a query without spelling characters stays on the norm arm', () => {
  for (const q of ['AB;BA', 'AB; BA', 'AB ;BA', ' ABBA ', 'A;|A|=3', 'cat', '/act', 'A;A=#@#', 'A;B;AB=boardroom']) {
    const p = parseOk(q);
    assert.equal(p.arm, 'norm', q);
    assert.equal(p.constraints.arm, 'norm', q);
    assert.equal(p.caseSensitive, false, q);
  }
});

test('parse: a space inside a binding is a literal and selects the display arm', () => {
  const p = parseOk('A B');
  assert.equal(p.arm, 'display');
  assert.equal(p.constraints.arm, 'display');
  assert.deepEqual(p.bindings[0].tokens.map(t => t.t), ['var', 'lit', 'var']);
  assert.deepEqual(lits(p), [' ']);
  assert.equal(parseOk('* *').arm, 'display');
  assert.equal(parseOk('A B C').arm, 'display');
  assert.deepEqual(lits(parseOk('the irs')), ['the irs']);
});

test('parse: a space in a sub-pattern or term target selects the display arm too', () => {
  assert.equal(parseOk('A;A=* *').arm, 'display');
  assert.equal(parseOk('A;A!=* *').arm, 'display');
  const te = parseOk('A;B;AB=board room');
  assert.equal(te.arm, 'display');
  assert.equal(te.constraints.termEquals.length, 1);
});

test('parse: a term-equals left side may carry a space', () => {
  const p = parseOk('A;B;A B=peanut butter');
  assert.equal(p.arm, 'display');
  assert.equal(p.constraints.termEquals.length, 1);
  assert.deepEqual(p.constraints.termEquals[0].term.tokens.map(t => t.t), ['var', 'lit', 'var']);
});

test('parse: spaces inside constraints and length prefixes are errors, never ignored', () => {
  for (const q of ['A;|A| >= 3', 'A;|A|>= 3', 'A;A = #@#', 'AB;BA;|A| = |B|', '7 : A*', '7: A*', '7 :A*', 'A;| * |>=0', 'ABCD;| A-C |>=0', 'AB;|A B|=6']) {
    parseErr(q);
  }
});

test('parse: backslash escapes every syntax character into a literal', () => {
  const p = parseOk('\\?\\*\\#\\@\\[\\]\\~\\;\\|\\=\\!\\<\\>\\:\\/\\-\\\\');
  assert.equal(p.arity, 1);
  assert.equal(p.arm, 'display');
  assert.deepEqual(lits(p), ['?*#@[]~;|=!<>:/-\\']);
  assert.equal(parseOk('a\\;b').arity, 1);
  assert.equal(parseOk('e\\=mc2').arity, 1);
  assert.equal(parseOk('a\\:b').bindings[0].wordLen, null);
  assert.deepEqual(lits(parseOk('u\\.s\\.')), ['u.s.']);
  assert.deepEqual(lits(parseOk('A\\ B')), [' ']);
  assert.deepEqual(lits(parseOk('rock\\-n\\-roll')), ['rock-n-roll']);
  assert.deepEqual(lits(parseOk('\\’')), ['’']);
  assert.deepEqual(lits(parseOk('\\\u{1F642}')), ['\u{1F642}']);
});

test('parse: an escaped capital is a case-sensitive literal, folded for matching', () => {
  const p = parseOk('\\N\\A\\S\\A');
  assert.equal(p.arm, 'display');
  assert.equal(p.caseSensitive, true);
  assert.deepEqual(p.bindings[0].tokens, [{ t: 'lit', s: 'NASA', f: 'nasa' }]);
  const mixed = parseOk('the \\I\\R\\S');
  assert.deepEqual(mixed.bindings[0].tokens, [{ t: 'lit', s: 'the IRS', f: 'the irs' }]);
  assert.equal(parseOk('A B').caseSensitive, false);
});

test('parse: a capital literal is allowed only in a binding', () => {
  assert.match(parseErr('A;A=\\B*'), /binding/);
  assert.match(parseErr('A;A!=\\B*'), /binding/);
  assert.match(parseErr('A;B;AB=bo\\Ard'), /binding/);
  assert.match(parseErr('AB;|A\\B|=3'), /binding|space/);
});

test('parse: reserved escapes are errors, so pasted regex escapes fail loudly', () => {
  for (const q of ['\\s', '\\d', '\\b', '\\w', 'a\\n', '\\1', '\\é', '\\Ω']) assert.match(parseErr(q), /reserved/, q);
  assert.match(parseErr('ab\\'), /trailing/);
  assert.match(parseErr('A;A=ab\\'), /trailing/);
});

test('parse: bare punctuation outside the syntax errors with an escape hint', () => {
  assert.match(parseErr('x&y'), /\\&/);
  assert.match(parseErr('don’t'), /\\’/);
  assert.match(parseErr('a.b'), /\\\./);
  assert.match(parseErr('\u{1F642}'), /\\\u{1F642}/u);
  assert.match(parseErr('a,b'), /\\,/);
});

test('parse: letters and digits from any script are bare literals on the display arm', () => {
  const p = parseOk('café');
  assert.equal(p.arm, 'display');
  assert.deepEqual(p.bindings[0].tokens, [{ t: 'lit', s: 'café', f: 'café' }]);
  assert.deepEqual(parseOk('CAFÉ').bindings[0].tokens.at(-1), { t: 'lit', s: 'É', f: 'é' });
  assert.equal(parseOk('É').caseSensitive, false);
  assert.deepEqual(lits(parseOk('İstanbul')), ['İstanbul']);
  assert.equal(parseOk('İstanbul').bindings[0].tokens[0].f, 'İstanbul');
});

test('parse: anagram bags stay letters and digits only', () => {
  assert.match(parseErr('/tri angle'), /letters, digits/);
  assert.match(parseErr('/tri\\-angle'), /letters, digits/);
  assert.match(parseErr('/café'), /letters, digits/);
});

test('parse: a character class body takes only letters, digits, #, @, a leading ^, and a range dash', () => {
  for (const q of ['[a b]', '[a\\]b]', '[!abc]', '[a.b]', '[é]', '[A]']) assert.match(parseErr(q), /invalid \[ character class/, q);
  for (const q of ['[abc]', '[^abc]', '[l-p]', '[#@]', '[^l-p0-9]']) parseOk(q);
  assert.equal(parseOk('[abc] x').arm, 'display');
});

test('parse: a plain literal token carries its folded text', () => {
  assert.deepEqual(parseOk('cat').bindings[0].tokens, [{ t: 'lit', s: 'cat', f: 'cat' }]);
});

// ─── Matching on the display arm ─────────────────────────────────────────────

const canon = a => Object.fromEntries(Object.keys(a).sort().map(k => [k, a[k]]));
const bind = (q, word) => { const p = parseOk(q); return matchPattern(word, p.bindings[0], p.constraints).map(canon); };

test('display arm: a literal space matches only a spelled space', () => {
  assert.ok(bind('* *', 'the irs').length > 0);
  assert.equal(bind('* *', 'theirs').length, 0);
  assert.deepEqual(bind('A B', 'the irs'), [{ A: 'the', B: 'irs' }]);
  assert.deepEqual(bind('the irs', 'the irs'), [{}]);
  assert.equal(bind('the irs', 'theirs').length, 0);
  assert.equal(bind('rock\\-n\\-roll', 'rock-n-roll').length, 1);
  assert.equal(bind('rock\\-n\\-roll', 'rock n roll').length, 0);
  assert.equal(bind('u\\.s\\.', 'u.s.').length, 1);
  assert.equal(bind('u\\.s\\.', 'us').length, 0);
});

test('display arm: ? # @ and classes take a letter or digit, never a separator; * and variables span anything', () => {
  assert.equal(bind('A;A=???????;A!=\\.*', 'the irs').length, 0);
  assert.equal(bind('A;A=??? ???;A!=\\.*', 'the irs').length, 1);
  assert.equal(bind('??? ???', 'the irs').length, 1);
  assert.equal(bind('[^x] *', 'a b').length, 1);
  assert.equal(bind('*[^x]* *', '- - -').length, 0);
  assert.equal(bind('*[^x]* *', 'a - b').length, 1);
  assert.equal(bind('#@# *', 'cat nap').length, 1);
  assert.equal(bind('*@* *', '- - -').length, 0);
  assert.equal(bind('3\\-?', '3-d').length, 1);
  assert.equal(bind('3\\-?', '3--').length, 0);
  assert.ok(bind('AB;A!=\\.*', 'the irs').some(a => a.A === 'the ' && a.B === 'irs'));
  assert.ok(bind('A*;A!=\\.*', 'the irs').some(a => a.A === 'the irs'));
});

test('display arm: ? and classes take an accented letter; # and @ stay the a-z sets; a spelled accent matches only itself', () => {
  assert.equal(bind('caf? *', 'café au lait').length, 1);
  assert.equal(bind('? *', 'é b').length, 1);
  assert.equal(bind('[^x] *', 'é b').length, 1);
  assert.equal(bind('[abc] *', 'é b').length, 0);
  assert.equal(bind('@ *', 'é b').length, 0);
  assert.equal(bind('# *', 'ñ b').length, 0);
  assert.equal(bind('café *', 'café au lait').length, 1);
  assert.equal(bind('cafe *', 'café au lait').length, 0);
  assert.equal(bind('A *', 'café au lait').length, 2);
  assert.equal(bind('É *', 'école x').length, 0);
  assert.equal(bind('É*', 'école').length, 1);
  assert.equal(bind('A;A=?;A!=\\.*', 'ß').length, 1);
});

test('display arm: lengths count letters and digits, not characters', () => {
  assert.equal(bind('A B;|A|=3;|B|=3', 'the irs').length, 1);
  assert.equal(bind('A B;|AB|=6', 'the irs').length, 1);
  assert.equal(bind('A B;|AB|=7', 'the irs').length, 0);
  assert.equal(bind('6:A B', 'the irs').length, 1);
  assert.equal(bind('7:A B', 'the irs').length, 0);
  assert.equal(bind('A B;|A|=|B|', 'the irs').length, 1);
  assert.equal(bind('A B;|A|<|B|', 'the irs').length, 0);
  assert.equal(bind('A B;|A|!=3', 'the irs').length, 0);
  assert.equal(bind('A B;A=3:*', 'the irs').length, 1);
  assert.equal(bind('A B;A=2:*', 'the irs').length, 0);
  assert.equal(bind('A B;|A|=2', '3-d tv').length, 1);
  assert.equal(bind('A;|A|=2;A=* *', 'æ x').length, 0);
  assert.equal(bind('A;|A|=3;A=* *', 'æ x').length, 1);
  assert.equal(bind('A;A=u\\.s\\.', 'u.s.').length, 1);
  assert.equal(bind('A;|A-A|=3;A=* *', 'ab c').length, 1);
  assert.equal(bind('A B;|*|=3', 'the irs').length, 1);
});

test('display arm: repeated variables and reversals compare folded spelling', () => {
  assert.deepEqual(bind('A A', 'bye bye'), [{ A: 'bye' }]);
  assert.deepEqual(bind('A ~A', 'ab ba'), [{ A: 'ab' }]);
  assert.equal(bind('A A', 'bye bye bye').length, 0);
});

test('display arm: a single-binding term-equals or comparison spells the space', () => {
  assert.ok(bind('AB;AB=the irs', 'the irs').length > 0);
  assert.equal(bind('AB;AB=the irs', 'theirs').length, 0);
  assert.equal(bind('AB;AB!=the irs', 'the irs').length, 0);
  assert.deepEqual(bind('A B;A=B', 'bye bye'), [{ A: 'bye', B: 'bye' }]);
  assert.equal(bind('A B;A!=B', 'bye bye').length, 0);
});

test('display arm: an anagram bag holds letters and digits, so a spaced spelling never rearranges into it', () => {
  assert.equal(bind('A B;A=/lilac', 'lilac x').length, 1);
  assert.equal(bind('A B;A=/lilac', 'li lac x').length, 0);
  assert.equal(bind('A B;A=/lilac', 'lila x').length, 0);
  assert.equal(bind('AB;AB=/lilac;A!=\\.*', 'lilac').length, 4);
  assert.equal(bind('AB;AB=/lilac;A!=\\.*', 'li lac').length, 0);
});

test('display arm: a zero floor still applies with spaces present', () => {
  assert.deepEqual(bind('AtenB;|*|>=0;A=* *', 'in tent'), [{ A: 'in ', B: 't' }]);
  assert.equal(bind('AtenB;A=* *', 'in tent').length, 1);
  assert.equal(bind('AtenB;A=* *', 'in ten').length, 0);
  assert.equal(bind('AtenB;|*|>=0;A=* *', 'in ten').length, 1);
  assert.ok(bind('A B;|*|>=0', 'a b').length > 0);
});

test('caseOK verifies escaped capitals against the spelling', () => {
  const p = parseOk('\\I\\R\\S');
  const [m] = matchPattern('irs', p.bindings[0], p.constraints);
  assert.ok(m);
  assert.equal(caseOK('IRS', p.bindings[0], m), true);
  assert.equal(caseOK('irs', p.bindings[0], m), false);
  assert.equal(caseOK('Irs', p.bindings[0], m), false);
  const q = parseOk('*\\A*');
  const [n] = matchPattern('aa', q.bindings[0], q.constraints);
  assert.equal(caseOK('aA', q.bindings[0], n), true);
  assert.equal(caseOK('Aa', q.bindings[0], n), true);
  assert.equal(caseOK('aa', q.bindings[0], n), false);
  const r = parseOk('the \\I\\R\\S');
  const [o] = matchPattern('the irs', r.bindings[0], r.constraints);
  assert.equal(caseOK('the IRS', r.bindings[0], o), true);
  assert.equal(caseOK('The IRS', r.bindings[0], o), true);
  assert.equal(caseOK('the irs', r.bindings[0], o), false);
  const c = parseOk('[^x]\\B');
  const [k] = matchPattern('ab', c.bindings[0], c.constraints);
  assert.equal(caseOK('aB', c.bindings[0], k), true);
  assert.equal(caseOK('AB', c.bindings[0], k), true);
  assert.equal(caseOK('ab', c.bindings[0], k), false);
  const v = parseOk('A\\B~A');
  const [w] = matchPattern('xybyx', v.bindings[0], v.constraints);
  assert.equal(caseOK('XyBYx', v.bindings[0], w), true);
  assert.equal(caseOK('xybyx', v.bindings[0], w), false);
});

test('variableHighlights tags display coordinates when asked, and stays untagged otherwise', () => {
  const p = parseOk('A B');
  const [m] = matchPattern('the irs', p.bindings[0], p.constraints);
  const hl = variableHighlights('the irs', p.bindings[0], m, { A: 0, B: 1 }, 'display');
  assert.deepEqual(hl.map(h => [h.start, h.end, h.coord]), [[0, 3, 'display'], [4, 7, 'display']]);
  const q = parseOk('AB');
  const [n] = matchPattern('theirs', q.bindings[0], q.constraints);
  const hn = variableHighlights('theirs', q.bindings[0], n, { A: 0, B: 1 });
  assert.equal('coord' in hn[0], false);
});

test('variableHighlights locates variables through two stars and an escaped capital', () => {
  const p = parseOk('*\\A*A');
  const word = 'xaya';
  const matches = matchPattern(word, p.bindings[0], p.constraints);
  const m = matches.find(a => a.A === 'a');
  assert.ok(m);
  const hl = variableHighlights(word, p.bindings[0], m, { A: 0 }, 'display');
  assert.deepEqual(hl.map(h => [h.start, h.end]), [[3, 4]]);
  const n = matches.find(a => a.A === 'ya');
  assert.deepEqual(variableHighlights(word, p.bindings[0], n, { A: 0 }, 'display').map(h => [h.start, h.end]), [[2, 4]]);
});

// ─── Tuples on the display arm ───────────────────────────────────────────────

const D = (norm, display, score = 50) => ({ norm, display, score });
async function tuplesOf(q, pool, opts) {
  const p = parseOk(q);
  const { tuples } = await findTuples(p, pool, opts);
  return tuples.map(t => t.map(l => displayOf(l.entry))).sort((a, b) => (a.join('|') < b.join('|') ? -1 : a.join('|') > b.join('|') ? 1 : 0));
}

test('display arm tuples: two-word swaps', async () => {
  const pool = [D('peanutbutter', 'peanut butter'), D('butterpeanut', 'butter peanut'), D('peanut', null), D('butter', null)];
  assert.deepEqual(await tuplesOf('A B;B A', pool), [['butter peanut', 'peanut butter'], ['peanut butter', 'butter peanut']]);
});

test('display arm tuples: a phrase and its run-together spelling', async () => {
  const pool = [D('theirs', 'the IRS', 40), D('theirs', null, 60), D('the', null), D('irs', 'IRS')];
  assert.deepEqual(await tuplesOf('A B;AB', pool), [['the IRS', 'theirs']]);
});

test('display arm tuples: spellings that differ beyond case stay distinct; case variants collapse to the preferred one', async () => {
  const pool = [D('theirs', 'the IRS', 40), D('theirs', 'the irs', 30), D('theirs', 'the-irs', 20), D('theirs', null, 60)];
  assert.deepEqual(await tuplesOf('A B;AB', pool), [['the IRS', 'theirs']]);
  assert.deepEqual(await tuplesOf('A\\-B;AB', pool), [['the-irs', 'theirs']]);
  assert.deepEqual(await tuplesOf('A B;A\\-B', pool), [['the IRS', 'the-irs']]);
  const flipped = [D('theirs', 'the IRS', 30), D('theirs', 'the irs', 40), D('theirs', null, 60)];
  assert.deepEqual(await tuplesOf('A B;AB', flipped), [['the irs', 'theirs']]);
});

test('display arm tuples: a term-equals with a space splits a spelled target', async () => {
  const pool = [D('peanut', null), D('butter', null), D('peanutbutter', 'peanut butter')];
  assert.deepEqual(await tuplesOf('A;B;A B=peanut butter', pool), [['peanut', 'butter']]);
  assert.deepEqual(await tuplesOf('A;B;AB=peanut butter', pool), []);
  assert.deepEqual(await tuplesOf('A;B;AB=peanutbutter;A=* *', pool), []);
});

test('display arm tuples: lanes emit the real entries', async () => {
  const e1 = { ...D('peanutbutter', 'peanut butter'), _i: 7, wordlist: { dbKey: 'x' } };
  const e2 = { ...D('butterpeanut', 'butter peanut'), _i: 8, wordlist: { dbKey: 'x' } };
  const { tuples } = await findTuples(parseOk('A B;B A'), [e1, e2]);
  for (const t of tuples) for (const l of t) assert.ok(l.entry === e1 || l.entry === e2);
});

test('display arm tuples: an escaped capital gates the tuple, whichever spelling scores higher', async () => {
  for (const [hi, lo] of [[40, 30], [30, 40]]) {
    const pool = [D('theirs', 'the IRS', hi), D('theirs', 'the irs', lo), D('the', null)];
    assert.deepEqual(await tuplesOf('A \\I\\R\\S;A', pool), [['the IRS', 'the']]);
  }
  const pool = [D('nasa', 'NASA', 30), D('nasa', null, 40), D('nasal', 'NASAl', 20), D('nasal', null, 50)];
  assert.deepEqual(await tuplesOf('\\N\\A\\S\\A;\\N\\A\\S\\A?', pool), [['NASA', 'NASAl']]);
});

test('display arm tuples: lane highlights are display coordinates', async () => {
  const pool = [D('peanutbutter', 'peanut butter'), D('butterpeanut', 'butter peanut')];
  const { tuples } = await findTuples(parseOk('A B;B A'), pool);
  const lane = tuples.find(t => t[0].entry.display === 'peanut butter')[0];
  assert.ok(lane.highlights.every(h => h.coord === 'display'));
  assert.deepEqual(lane.highlights.map(h => [h.start, h.end]).sort(), [[0, 6], [7, 13]]);
});

test('display arm tuples: every strategy agrees', async () => {
  const pool = [
    D('peanutbutter', 'peanut butter'), D('butterpeanut', 'butter peanut'), D('peanut', null), D('butter', null),
    D('theirs', 'the IRS'), D('theirs', null), D('the', null), D('irs', 'IRS'),
    D('cockandbull', 'cock and bull'), D('cockpit', 'cock pit'), D('pitbull', 'pit bull'), D('pit', null), D('cock', null), D('bull', null),
    D('lilac', null), D('lilac', 'li lac'), D('cafe', 'caf e'), D('cafe', 'café'), D('cafe', null),
  ];
  for (const q of ['A B;B A', 'A B;AB', 'A B;A;B', 'A and B;X;A X;X B', 'A B;X;A X', '/lilac;A B', 'A B;B A;|A|=|B|', 'A B;A?', 'A B;A[^x]']) {
    const auto = await tuplesOf(q, pool, { strategy: 'auto' });
    const bucket = await tuplesOf(q, pool, { strategy: 'bucket' });
    assert.deepEqual(auto, bucket, q);
    assert.ok(auto.length > 0, `${q} should find something`);
  }
  const accented = await tuplesOf('A B;A?', pool);
  assert.ok(accented.some(t => t[0] === 'caf e' && t[1] === 'café'), 'a ? partner reaches the accented spelling');
  assert.ok(accented.some(t => t[0] === 'caf e' && t[1] === 'cafe'));
});

test('display arm tuples: the anagram term-equals takes the permutation path and stays spelling-exact', async () => {
  const pool = [D('norm', null), D('ad', null), D('dorm', null), D('an', null), D('ad', 'a d', 90)];
  const got = await tuplesOf('A;B;AB=/random;A!=\\.*', pool);
  assert.deepEqual(got, [['ad', 'norm'], ['an', 'dorm'], ['dorm', 'an'], ['norm', 'ad']]);
  assert.ok(!got.flat().includes('a d'));
});

// ─── Norm arm stays byte-identical ───────────────────────────────────────────

const POOL = [
  'cat', 'act', 'tac', 'ape', 'pea', 'bro', 'rob', 'abba', 'noon', 'deed', 'level', 'mama', 'tutu',
  'tenor', 'mitten', 'ten', 'pun', 'spun', 'abc', 'bca', 'cab', 'bake', 'bale', 'make', 'male',
  'board', 'room', 'boardroom', 'norm', 'ad', 'dorm', 'an', 'cockandbull', 'pit', 'cockpit', 'pitbull',
  'xax', 'xbx', 'yay', 'yby', 'eta', 'ate', 'tea', 'the', 'irs', 'theirs', 'r2d2', 'lilac',
];
const TUPLE_QUERIES = ['AB;BA', 'ABC;CBA', 'A;~A', '?A;A', 'AkB;AlB', 'A;B;AB=boardroom', 'AandB;X;AX;XB', 'xAx;yBy;A!=B', 'A;B;AB=/random', 'AB;CB;|B|=2', 'A@;A#'];
const SINGLE_QUERIES = ['ABBA', 'A~A', 'AB;|A|=|B|', 'A;A=#@#', 'xAx;|A|>=0', '5:A*', 'AB;AB=cat', 'A;A=/act', 'c?t', '[l-p]*', '#@#', 'A;|A|=2-3', 'AB;A!=B', 'r?d?'];

test('norm arm: ordinary queries parse on the norm arm with every literal folding to itself', () => {
  for (const q of [...SINGLE_QUERIES, ...TUPLE_QUERIES]) {
    const p = parseOk(q);
    assert.equal(p.arm, 'norm', q);
    assert.equal(p.caseSensitive, false, q);
    for (const b of p.bindings) for (const t of b.tokens) if (t.t === 'lit') assert.equal(t.f, t.s, q);
  }
});

test('a spelling-only no-op constraint flips the arm without changing results on a spelling-free pool', async () => {
  const pool = POOL.map((n, i) => ({ norm: n, display: null, score: 200 - i }));
  const opts = { numResults: 1e6, maxMatchesPerPattern: 1e7 };
  for (const q of TUPLE_QUERIES) {
    const flipped = q + ';A!=\\.*';
    assert.equal(parseOk(flipped).arm, 'display', flipped);
    const base = await tuplesOf(q, pool, opts);
    assert.ok(base.length > 0, `${q} should find something`);
    assert.deepEqual(await tuplesOf(flipped, pool, opts), base, q);
    assert.deepEqual(await tuplesOf(flipped, pool, { ...opts, strategy: 'bucket' }), base, `${q} (bucket)`);
  }
  for (const q of SINGLE_QUERIES) {
    const flipped = q + ';A!=\\.*';
    assert.equal(parseOk(flipped).arm, 'display', flipped);
    let hits = 0;
    for (const w of POOL) { const b = bind(q, w); hits += b.length; assert.deepEqual(bind(flipped, w), b, `${q} on ${w}`); }
    assert.ok(hits > 0, `${q} should match something`);
  }
});

// ─── Tool wiring, packed join, keys ──────────────────────────────────────────

test('tool run: a norm-arm query receives the entry and matches norm', () => {
  const prepared = umiaqTool.prepare({ query: 'ABBA' });
  assert.equal(umiaqTool.matchOn, 'both');
  const hl = umiaqTool.run({ norm: 'noon', display: null }, prepared);
  assert.ok(Array.isArray(hl) && hl.every(h => !('coord' in h)));
  assert.equal(umiaqTool.run({ norm: 'cat', display: null }, prepared), false);
  assert.ok(Array.isArray(umiaqTool.run({ norm: 'theirs', display: 'the IRS' }, umiaqTool.prepare({ query: 'AB' }))));
});

test('tool run: a display-arm query matches the spelling and tags display coordinates', () => {
  const prepared = umiaqTool.prepare({ query: 'A B' });
  const hl = umiaqTool.run({ norm: 'theirs', display: 'the IRS' }, prepared);
  assert.ok(Array.isArray(hl) && hl.length === 2 && hl.every(h => h.coord === 'display'));
  assert.deepEqual(hl.map(h => [h.start, h.end]).sort(), [[0, 3], [4, 7]]);
  assert.equal(umiaqTool.run({ norm: 'theirs', display: null }, prepared), false);
});

test('tool run: an escaped capital matches only the capitalized spelling', () => {
  const prepared = umiaqTool.prepare({ query: '\\N\\A\\S\\A' });
  assert.ok(umiaqTool.run({ norm: 'nasa', display: 'NASA' }, prepared));
  assert.equal(umiaqTool.run({ norm: 'nasa', display: null }, prepared), false);
  assert.equal(umiaqTool.run({ norm: 'nasa', display: 'Nasa' }, prepared), false);
  const lower = umiaqTool.prepare({ query: 'nasa *' });
  assert.ok(umiaqTool.run({ norm: 'nasax', display: 'NASA x' }, lower));
});

test('tool def: the new errors surface through error() and isInert()', () => {
  for (const q of ['\\s', 'x&y', 'A;|A| >= 3', '7: A*']) {
    assert.ok(umiaqTool.error({ query: q }), q);
    assert.equal(umiaqTool.isInert({ query: q }), true, q);
  }
  assert.equal(umiaqTool.error({ query: 'A B;B A' }), null);
});

test('PackedRecordJoin round-trips a display coordinate and keys lanes by spelling', () => {
  const e1 = { norm: 'peanutbutter', display: 'peanut butter', score: 50, _i: 0 };
  const e2 = { norm: 'butterpeanut', display: null, score: 40, _i: 1 };
  const join = new PackedRecordJoin();
  join.appendGroups([{ key: 'k', chains: [
    { atoms: [{ wlEntry: e1, highlights: [{ start: 0, end: 6, kind: 'umiaq-var-0', coord: 'display' }], glyph: null }] },
    { atoms: [{ wlEntry: e2, highlights: [{ start: 0, end: 6, kind: 'umiaq-var-1' }], glyph: null }] },
  ] }]);
  assert.deepEqual(join.highlightsOf(0, 0), [{ start: 0, end: 6, kind: 'umiaq-var-0', coord: 'display' }]);
  assert.deepEqual(join.highlightsOf(0, 1), [{ start: 0, end: 6, kind: 'umiaq-var-1' }]);
  assert.equal(join.keyOf({ entries: [e1, e2] }, 0), 'peanut butter\0butterpeanut');
});

test('compareKeys is total over \\0-joined keys', () => {
  assert.notEqual(compareKeys('a\0bc', 'ab\0c'), 0);
  assert.equal(compareKeys('a\0bc', 'ab\0c'), -compareKeys('ab\0c', 'a\0bc'));
  assert.equal(compareKeys('x', 'x'), 0);
  assert.equal(compareKeys('ape\0pea', 'pea\0ape'), -1);
});
