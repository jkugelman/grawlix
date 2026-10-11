import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileQuery, formatQuery, classifyWords, entryKinds, ruleSubject } from '../../site/src/engine/rule-query.js';
import { rescoreEntry, ruleOutputError, compileRule, formatRuleOutput } from '../../site/src/engine/rescore.js';

const kinds = text => [...entryKinds(text, classifyWords(text))].sort();

function matches(query, { score = 50, norm, display = null }) {
  const c = compileQuery(query);
  assert.deepEqual(c.errors.map(e => e.msg), [], query);
  return c.match(ruleSubject(score, norm ?? (display ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''), display));
}

const firstError = query => compileQuery(query).errors[0]?.msg ?? null;

test('classifier: the design fixtures', () => {
  assert.deepEqual(kinds("I don't like to brag"), ['plain']);
  assert.deepEqual(kinds('Pius VII'), ['proper']);
  assert.deepEqual(kinds('CD'), ['initialism']);
  assert.deepEqual(kinds('XL'), ['initialism', 'roman numeral']);
  assert.deepEqual(kinds('XX'), ['roman numeral']);
  assert.deepEqual(kinds('Mt. Everest'), ['proper']);
  assert.deepEqual(kinds('iPhone'), ['proper']);
  assert.deepEqual(kinds('nasa'), ['plain']);               // Broda's NASA: display null, norm stands in
  assert.deepEqual(kinds('Bay of Pigs'), ['proper']);
  assert.deepEqual(kinds('U.S.'), ['initialism']);
  assert.deepEqual(kinds('MRIs'), ['initialism']);
  assert.deepEqual(kinds('pts.'), ['abbreviation']);
  assert.deepEqual(kinds('123'), ['digits']);
  assert.deepEqual(kinds('Plan B'), ['proper']);
});

test('ends with: a word category reads the last word', () => {
  assert.equal(matches('is: proper and ends with: roman numeral', { display: 'Pius VII' }), true);
  assert.equal(matches('ends with: roman numeral', { display: 'Act IV' }), true);
  assert.equal(matches('ends with: roman numeral', { display: 'IV bag' }), false);
});

test('text matches the norm or the display, like the search box', () => {
  assert.equal(matches('contains: theirs', { norm: 'theirs', display: 'the IRS' }), true);
  assert.equal(matches('ends with: " up"', { norm: 'giveup', display: 'give up' }), true);
  assert.equal(matches('ends with: " up"', { norm: 'buttercup', display: 'buttercup' }), false);
  assert.equal(matches('ends with: up', { norm: 'buttercup', display: 'buttercup' }), true);
  assert.equal(matches('contains: "digits"', { norm: 'digits' }), true);      // quoted is text, not the category
});

test('commas mean any of, in every field', () => {
  assert.equal(matches('score: 40, 60', { score: 60, norm: 'x' }), true);
  assert.equal(matches('score: 40, 60', { score: 50, norm: 'x' }), false);
  assert.equal(matches('pattern: *ing, *ed', { norm: 'walked' }), true);
  assert.equal(matches('is not: plain, proper', { display: 'NASA' }), true);
});

test('pattern is anchored to the whole entry; regex is not, and ignores case', () => {
  assert.equal(matches('pattern: ing', { norm: 'sing' }), false);
  assert.equal(matches('pattern: *ing', { norm: 'sing' }), true);
  assert.equal(matches('regex: ING', { norm: 'singer' }), true);
  assert.equal(matches('regex: "(.)\\1\\1"', { norm: 'brrr' }), true);   // backslashes reach RegExp as typed
});

test('and, or, not and parentheses combine clauses; side by side means and', () => {
  const e = { score: 60, norm: 'giveup', display: 'give up' };
  assert.equal(matches('(score: 50 or score: 60) and words: 2+', e), true);
  assert.equal(matches('score: 60 words: 3', e), false);
  assert.equal(matches('not is: plain', e), false);
  assert.equal(matches('is not: plain', e), false);
});

test('quoting: \\" and \\\\ are the only escapes, and curly quotes work', () => {
  assert.equal(matches('contains: "say \\"hi\\""', { norm: 'sayhi', display: 'say "hi"' }), true);
  assert.equal(matches('contains: “rock n”', { norm: 'rocknroll', display: 'rock n roll' }), true);
  assert.equal(firstError('contains: "open'), 'Close the quote.');
  assert.match(firstError('contains: "up"s'), /after the closing quote/);
});

test('errors: unknown fields suggest the nearest, and the parser is strict', () => {
  assert.equal(firstError('scroe: 50'), 'There\'s no “scroe” field. Did you mean “score”?');
  assert.match(firstError('score: 50 60'), /isn't a field/);
  assert.equal(firstError('score:'), 'Pick a value for “score”.');
  assert.match(firstError('score: 60-50'), /runs backward/);
  assert.match(firstError('starts with: spaces'), /only works with contains/);
  assert.match(firstError('contains: plain'), /only works with is/);
  assert.match(firstError('is: shouty'), /isn't a choice/);
  assert.match(firstError('regex: "("'), /doesn't work/);
  assert.match(firstError('score: 50 and'), /after “and”/);
});

test('an empty or broken query is inactive and matches nothing', () => {
  assert.equal(compileQuery('').match, null);
  assert.equal(compileQuery('   ').match, null);
  assert.equal(compileQuery('scroe: 50').match, null);
  const rules = [{ query: '', output: '0' }, { query: 'score: 50', output: '30' }];
  assert.equal(rescoreEntry({ score: 50, norm: 'x' }, rules), 30);   // the blank rule above shadows nothing
});

test('a range output needs one top-level score clause with a single range', () => {
  const err = (query, output) => { const r = { query, output }; compileRule(r); return ruleOutputError(r); };
  assert.equal(err('score: 50+', '60+'), null);
  assert.equal(err('score: 50+ and is: proper', '60+'), null);
  assert.equal(err('score: 30-49', '20-39'), null);
  assert.notEqual(err('score: 50', '60+'), null);
  assert.notEqual(err('score: 30, 40', '20-39'), null);
  assert.notEqual(err('score: 30-49 or is: proper', '20-39'), null);
  assert.notEqual(err('is: proper', '60+'), null);
  assert.notEqual(err('score: 30', '20-39'), null);                  // degenerate input interval
});

test('rescoreEntry reads the display through query rules', () => {
  const rules = [
    { query: 'is: proper and score: 40', output: '50' },
    { query: 'score: 50+', output: '60+' },
    { query: 'score: 30-49', output: '20-39' },
  ];
  assert.equal(rescoreEntry({ score: 40, norm: 'obama', display: 'Obama' }, rules), 50);
  assert.equal(rescoreEntry({ score: 40, norm: 'chafeat', display: 'chafe at' }, rules), 30);
  assert.equal(rescoreEntry({ score: 55, norm: 'x', display: null }, rules), 65);
});

test('formatQuery writes a valid query one way, keeping what it matches', () => {
  const cases = [
    ['Score:50   AND  IS:Proper', 'score: 50 and is: proper'],
    ['score:050,30–49 is: proper', 'score: 50, 30-49 and is: proper'],
    ['not is: proper and NOT is not: plain', 'is not: proper and is: plain'],
    ['( score: 50 OR score: 40 ) not contains: x', '(score: 50 or score: 40) and not contains: "x"'],
    ['starts   with: “AB”  ends with: "digits"', 'starts with: "ab" and ends with: "digits"'],
    ['contains: " x ", "a,b", Digits, Roman  Numeral', 'contains: " x ", "a,b", digits, roman numeral'],
    ['regex: ^A\\d', 'regex: "^A\\d"'],
    ['pattern: *ing', 'pattern: "*ing"'],
    ['contains: "a\\"b\\\\"', 'contains: "a\\"b\\\\"'],
    ['pattern: "a b"', 'pattern: "a b"'],
  ];
  const subjects = [
    { norm: 'abc', display: 'AB 12' }, { score: 40, norm: 'xyz', display: 'Pius VII' },
    { norm: 'theirs', display: 'the IRS' }, { score: 30, norm: 'ab', display: 'a,b' },
  ];
  for (const [typed, clean] of cases) {
    assert.equal(formatQuery(typed), clean, typed);
    assert.equal(formatQuery(clean), clean, clean);
    for (const s of subjects) assert.equal(matches(clean, s), matches(typed, s), `${typed} on ${s.norm}`);
  }
});

test('formatQuery leaves a query with an error as typed', () => {
  assert.equal(formatQuery('Score:50  AND'), 'Score:50  AND');
  assert.equal(formatQuery('scor: 50'), 'scor: 50');
  assert.equal(formatQuery('  '), '  ');
});

test('formatRuleOutput writes a valid score one way', () => {
  assert.equal(formatRuleOutput(' 060+ '), '60+');
  assert.equal(formatRuleOutput('50–60'), '50-60');
  assert.equal(formatRuleOutput('  '), '');
  assert.equal(formatRuleOutput('60 +'), '60 +');
});
