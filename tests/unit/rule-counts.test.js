import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countRules } from '../../site/src/engine/rule-counts.js';
import { parseWordlistColumns } from '../../site/src/engine/sources.js';
import { parseWordlist } from '../../site/src/engine/norm.js';
import { rescoreFields } from '../../site/src/engine/rescore.js';
import { FactsCache } from '../../site/src/engine/rule-query.js';

const TEXT = ['Pius VII;50', 'ocean;50', 'NASA;40', 'Bay of Pigs;50', 'tide;40', 'pick up;30'].join('\n');
const columnar = () => ({ cols: parseWordlistColumns(TEXT, []) });
const objects = () => ({ rawEntries: parseWordlist(TEXT) });

const RULES = [
  { query: 'is: proper', output: '40' },
  { query: 'score: 50', output: '60' },
  { query: 'score: 40+', output: '' },
  { query: 'scor: 1', output: '10' },
  { query: '', output: '' },
];

for (const [kind, make] of [['columnar', columnar], ['object-backed', objects]]) {
  test(`${kind}: wins and unmatched`, () => {
    const r = countRules(make(), RULES);
    assert.equal(r.total, 6);
    assert.deepEqual(r.rules.map(c => c && c.wins), [2, 1, 2, null, null]);
    assert.equal(r.unmatched, 1);
    assert.equal(r.bare, false);
  });

  test(`${kind}: samples spread across a rule's wins`, () => {
    const r = countRules(make(), RULES);
    assert.deepEqual(r.rules[1].samples, [{ norm: 'ocean', display: null }]);
    assert.deepEqual(r.rules[0].samples.map(e => e.display).sort(), ['Bay of Pigs', 'Pius VII']);
  });

  test(`${kind}: probes count alone, and a broken probe is null`, () => {
    const r = countRules(make(), [], { probes: ['is: initialism', 'contains: spaces', 'is: nope'] });
    assert.deepEqual(r.probes, [1, 3, null]);
  });
}

test('a list with no displays is bare', () => {
  assert.equal(countRules({ cols: parseWordlistColumns('ocean;50\ntide;40', []) }, []).bare, true);
});

test('cached facts answer exactly as uncached ones', () => {
  const entries = parseWordlist(TEXT);
  const rules = ['is: proper', 'ends with: roman numeral', 'words: 2+', 'contains: spaces', 'starts with: punctuation', 'is not: plain']
    .map(query => ({ query, output: '1' }));
  for (const rule of rules) {
    const cache = new FactsCache(entries.length);
    for (let pass = 0; pass < 2; pass++) {
      entries.forEach((e, i) => assert.equal(
        rescoreFields(e.score, e.norm, e.display, [rule], cache, i),
        rescoreFields(e.score, e.norm, e.display, [rule]),
        `${rule.query} on ${e.display ?? e.norm}, pass ${pass}`));
    }
  }
});
