import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyKey, collectVocab, familyTokens, inflectForms, generateRelativeNorms, configureCommonWords } from '../../site/src/engine/morphology.js';
import { COMMON_WORDS } from '../../site/src/engine/common-words-data.js';

configureCommonWords(COMMON_WORDS);

const GROUPS = [
  ['eat', 'eats', 'eating', 'ate', 'eaten'],
  ['do', 'does', 'doing', 'did', 'done'],
  ['go', 'goes', 'going', 'went', 'gone'],
  ['run', 'runs', 'running', 'ran'],
  ['cat', 'cats'],
  ['party', 'parties'],
  ['child', 'children'],
  ['knife', 'knives'],
  ['have a go at', 'has a go at', 'had a go at', 'having a go at'],
  ['eat up', 'ate up', 'eats up', 'eating up'],
  ['best', 'the best'],
  ['bit', 'a bit'],
  ['octopus', 'octopi', 'octopuses'],
  ['focus', 'foci', 'focused', 'focusing'],
  ['cherub', 'cherubim'],
  ['alumnus', 'alumni'],
  ['brother', 'brethren'],
  ['seraph', 'seraphim'],
  ['passerby', 'passersby'],
  ['man-at-arms', 'men-at-arms'],
  ['aide-de-camp', 'aides-de-camp'],
];
const vocab = collectVocab(GROUPS.flat());

for (const group of GROUPS) {
  test(`one family key for: ${group.join(' / ')}`, () => {
    const keys = new Set(group.map(e => familyKey(e, vocab)));
    assert.equal(keys.size, 1, `expected one key, got: ${[...keys].join(', ')}`);
  });
}

test('ambiguous plurals reduce to the noun, not the homographic verb', () => {
  const v = collectVocab(['leaf', 'leaves', 'basis', 'bases']);
  assert.equal(familyKey('leaves', v), 'leaf');
  assert.equal(familyKey('bases', v), 'basis');
});

test('suppletive plurals group via the curated overrides', () => {
  const v = collectVocab(['person', 'people', 'woman', 'women', 'die', 'dice']);
  assert.equal(familyKey('people', v), familyKey('person', v));
  assert.equal(familyKey('women', v), familyKey('woman', v));
  assert.equal(familyKey('dice', v), familyKey('die', v));
});

test('adjective degree forms stay distinct (no adj/adv exceptions shipped)', () => {
  const v = collectVocab(['good', 'better', 'best', 'dry', 'drier', 'driest']);
  assert.notEqual(familyKey('better', v), familyKey('good', v));
  assert.notEqual(familyKey('drier', v), familyKey('dry', v));
});

test('derivation is not collapsed (red / redness / redden stay distinct)', () => {
  const v = collectVocab(['red', 'redness', 'redden']);
  const keys = new Set(['red', 'redness', 'redden'].map(e => familyKey(e, v)));
  assert.equal(keys.size, 3);
});

test('leading articles strip; internal articles stay', () => {
  const v = collectVocab(['best', 'the best', 'have a go at', 'had a go at']);
  assert.equal(familyKey('the best', v), familyKey('best', v));
  assert.equal(familyKey('had a go at', v), familyKey('have a go at', v));
  assert.equal(familyKey('have a go at', v), 'have a go at');
});

test('familyTokens strips a leading article but keeps a lone article', () => {
  assert.deepEqual(familyTokens('the best'), ['best']);
  assert.deepEqual(familyTokens('a'), ['a']);
});

test('accents fold into the key (café groups with cafe)', () => {
  const v = collectVocab(['cafe', 'cafes']);
  assert.equal(familyKey('café', v), familyKey('cafe', v));
});

test('an irreducible word keys to itself, not an over-stripped fragment', () => {
  const v = collectVocab(['news', 'bus', 'red']);
  assert.equal(familyKey('bus', v), 'bus');
  assert.equal(familyKey('red', v), 'red');
});

test('a spurious longer stem in the list does not split a common base off its inflections', () => {
  const v = collectVocab(['call', 'calls', 'called', 'calling', 'calle']);
  const keys = new Set(['call', 'calls', 'called', 'calling'].map(e => familyKey(e, v)));
  assert.equal(keys.size, 1, `expected one key, got: ${[...keys].join(', ')}`);
  assert.equal(familyKey('called', v), 'call');
  assert.notEqual(familyKey('calle', v), familyKey('call', v));
});

test('a silent-e verb keeps its -e base even when the consonant stem is in the list', () => {
  const v = collectVocab(['hope', 'hopes', 'hoped', 'hoping', 'hop', 'hops']);
  const keys = new Set(['hope', 'hopes', 'hoped', 'hoping'].map(e => familyKey(e, v)));
  assert.equal(keys.size, 1, `expected one key, got: ${[...keys].join(', ')}`);
  assert.equal(familyKey('hoped', v), 'hope');
});

test('with no common candidate, reduction falls back to the longest in-vocab stem', () => {
  const v = collectVocab(['zorf', 'zorfs', 'zorfed', 'zorfing']);
  const keys = new Set(['zorf', 'zorfs', 'zorfed', 'zorfing'].map(e => familyKey(e, v)));
  assert.equal(keys.size, 1, `expected one key, got: ${[...keys].join(', ')}`);
  assert.equal(familyKey('zorfed', v), 'zorf');
});

// ─── Inflection generation (Related-entries widening) ──────────────────────────

test('inflectForms expands a regular paradigm both ways', () => {
  const bills = new Set(inflectForms('bills'));
  for (const f of ['bill', 'bills', 'billed', 'billing']) assert.ok(bills.has(f), `missing ${f}`);
  const bill = new Set(inflectForms('bill'));
  for (const f of ['bills', 'billed', 'billing']) assert.ok(bill.has(f), `missing ${f}`);
});

test('inflectForms carries an irregular through its whole paradigm', () => {
  const took = new Set(inflectForms('took'));
  for (const f of ['take', 'takes', 'taking', 'took']) assert.ok(took.has(f), `missing ${f}`);
});

test('inflectForms handles consonant-y plurals', () => {
  assert.ok(new Set(inflectForms('party')).has('parties'));
  assert.ok(new Set(inflectForms('parties')).has('party'));
});

test('generateRelativeNorms bridges spacing: a phrase and its glued spelling generate each other', () => {
  assert.ok(generateRelativeNorms('electric bill').has('electricbills'));
  assert.ok(generateRelativeNorms('electricbills').has('electricbill'));
});

test('generateRelativeNorms reaches a tail inflection buried in a glued entry', () => {
  assert.ok(generateRelativeNorms('notarizedstatement').has('notarizedstatements'));
  assert.ok(generateRelativeNorms('notarized statements').has('notarizedstatement'));
});

test('generateRelativeNorms inflects an irregular verb across a phrase', () => {
  assert.ok(generateRelativeNorms('took out of context').has('takeoutofcontext'));
});

test('generateRelativeNorms varies at most two words by default', () => {
  const s = generateRelativeNorms('cat dog bird');   // each pluralizes independently
  assert.ok(s.has('catsdogbird'), 'one-word change present');
  assert.ok(s.has('catsdogsbird'), 'two-word change present');
  assert.ok(!s.has('catsdogsbirds'), 'three-word change must be excluded');
  assert.ok(generateRelativeNorms('cat dog bird', { maxChanged: 3 }).has('catsdogsbirds'));
});

test('generateRelativeNorms drops the query itself and respects the cap', () => {
  assert.ok(!generateRelativeNorms('electric bill').has('electricbill'), 'self excluded');
  assert.ok(generateRelativeNorms('a b c d e f g h', { cap: 100 }).size <= 100);
});
