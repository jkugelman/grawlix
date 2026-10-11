import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, visibleErrors, readsDisplay } from '../../site/src/engine/rule-suggest.js';
import { compileQuery } from '../../site/src/engine/rule-query.js';

const ctx = { tiers: [{ score: 60, note: 'Good' }, { score: 50, note: 'Average' }] };
const groups = (s, c = s.length) => suggest(s, c, c, ctx).groups.filter(g => g.items.length);
const labels = (s, c) => groups(s, c).map(g => [g.label, g.items.map(i => i.label)]);
const accept = (s, item) => s.slice(0, item.rs) + item.insert + s.slice(item.re);

test('an empty condition offers every field, then not and (', () => {
  const [fields, ops] = labels('');
  assert.equal(fields[0], 'Fields');
  assert.deepEqual(fields[1].slice(0, 3), ['score', 'length', 'words']);
  assert.deepEqual(ops, ['Operators', ['not', '(']]);
});

test('accepting a field inserts its colon and a space, and offers its values', () => {
  const item = groups('sc')[0].items[0];
  assert.equal(item.label, 'score');
  assert.equal(accept('sc', item), 'score: ');
  assert.equal(item.caret, 7);
  const [[label, values]] = labels('score: ');
  assert.equal(label, 'Values for score');
  assert.deepEqual(values, ['60', '50', '50+', '30-49']);
});

test('with the caret inside or just before a token, the top pick keeps the whole token', () => {
  const cases = [
    ['score: 30', 8, '30'],
    ['score: 50, 30', 12, '30'],
    ['contains: abcd', 12, '"abcd"', 'contains: "abcd"'],
    ['length: 5', 0, 'length'],
    ['starts with: up', 3, 'starts with'],
    ['score: 50', 6, '50'],
    ['is: proper, plain', 11, 'plain'],
  ];
  for (const [s, c, label, after = s] of cases) {
    const top = groups(s, c)[0].items[0];
    assert.equal(top.label, label, `${s} @${c}`);
    assert.equal(accept(s, top).trim(), after, `${s} @${c}`);
  }
});

test('a typed value is offered first, with its minimum', () => {
  assert.deepEqual(labels('score: 5')[0][1].slice(0, 2), ['5', '5+']);
});

test('values carry a probe for their standalone count', () => {
  const values = groups('is: ')[0].items;
  assert.equal(values.find(v => v.label === 'proper').probe, 'is: proper');
});

test('after a complete clause: join, add another value, or add a condition', () => {
  const g = labels('is: proper ');
  assert.deepEqual(g.map(([l]) => l), ['Join with', 'Add to is', 'Or add another condition']);
  assert.ok(!g[1][1].includes('proper'));
  const add = groups('is: proper ')[1].items[0];
  assert.equal(accept('is: proper ', add), 'is: proper, plain ');
});

test('inside a group, ) joins too', () => {
  assert.deepEqual(labels('(score: 50 ')[0], ['Join with', ['and', 'or', ')']]);
});

test('position text offers the substring and, at an end, the quoted word', () => {
  assert.deepEqual(labels('ends with: up')[0][1], ['"up"', '" up"']);
  assert.deepEqual(labels('starts with: up')[0][1], ['"up"', '"up "']);
  assert.deepEqual(labels('contains: up')[0][1], ['"up"']);
  assert.deepEqual(labels('contains: "digits')[0][1], ['"digits"']);
  assert.deepEqual(labels('regex: ing')[0][1], ['"ing"', '"ing$"']);
  for (const item of groups('ends with: up')[0].items) {
    assert.deepEqual(compileQuery(accept('ends with: up', item)).errors, []);
  }
});

test('an error at the caret stays hidden until the caret moves on', () => {
  assert.deepEqual(visibleErrors('score: ', 7), []);
  assert.equal(visibleErrors('score: ').length, 1);
  assert.match(visibleErrors('scor: 50', 8)[0].msg, /Did you mean “score”/);
});

test('readsDisplay names the conditions a bare list cannot answer', () => {
  assert.equal(readsDisplay('is: proper'), true);
  assert.equal(readsDisplay('words: 2'), true);
  assert.equal(readsDisplay('ends with: roman numeral'), true);
  assert.equal(readsDisplay('contains: spaces'), true);
  assert.equal(readsDisplay('contains: digits'), false);
  assert.equal(readsDisplay('ends with: "proper"'), false);
  assert.equal(readsDisplay('score: 50 and length: 3'), false);
});
