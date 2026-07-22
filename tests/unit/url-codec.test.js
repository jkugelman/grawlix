import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRow, decodeRows } from '../../site/src/app/url-codec.js';
import { makeToolRow, TOOLS } from '../../site/src/engine/tools.js';

const query = row => encodeRow(row).join('&');
const decode = qs => decodeRows(new URLSearchParams(qs));
const enc = encodeURIComponent;

test('repeatable params: one pair rides the tool key + its own `symbol` key', () => {
  const row = makeToolRow('rebus', { string: ['tool'], symbol: ['Ⓣ'] });
  assert.equal(query(row), 'rebus=tool&symbol=' + enc('Ⓣ'));
});

test('repeatable params: each additional pair is a string/symbol group', () => {
  const row = makeToolRow('rebus', { string: ['tool', 'bar'], symbol: ['Ⓣ', '🅑'] });
  assert.equal(query(row),
    ['rebus=tool', 'symbol=' + enc('Ⓣ'), 'string=bar', 'symbol=' + enc('🅑')].join('&'));
});

test('repeatable params round-trip into parallel arrays', () => {
  const { rows } = decode('rebus=tool&symbol=' + enc('Ⓣ') + '&string=bar&symbol=' + enc('🅑'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool, 'rebus');
  assert.deepEqual(rows[0].params.string, ['tool', 'bar']);
  assert.deepEqual(rows[0].params.symbol, ['Ⓣ', '🅑']);
});

test('an empty pair survives the round-trip', () => {
  assert.equal(query(makeToolRow('rebus', { string: [''], symbol: [''] })), 'rebus=&symbol=');
  const { rows } = decode('rebus=&symbol=');
  assert.deepEqual(rows[0].params.string, ['']);
  assert.deepEqual(rows[0].params.symbol, ['']);
});

test('encode∘decode is idempotent for a multi-pair row', () => {
  const qs = query(makeToolRow('rebus', { string: ['a', 'b'], symbol: ['x', 'y'] }));
  assert.equal(query(decode(qs).rows[0]), qs);
});

test('scalar tools still round-trip (regression)', () => {
  const qs = query(makeToolRow('search', { pattern: 'c?t', replace: 'dog', mode: 'full' }));
  assert.equal(qs, 'search=' + enc('c?t') + '&replace=dog&mode=full');
  const { rows } = decode(qs);
  assert.equal(rows[0].params.pattern, 'c?t');
  assert.equal(rows[0].params.replace, 'dog');
  assert.equal(rows[0].params.mode, 'full');
});

test('legacy whole-word key decodes as mode=full and re-encodes as the new key', () => {
  const { rows, droppedUnknown } = decode('search=cat&whole-word');
  assert.equal(droppedUnknown, false);
  assert.equal(rows[0].params.mode, 'full');
  assert.equal(query(rows[0]), 'search=cat&mode=full');
});

test('an off match mode stays out of the URL', () => {
  assert.equal(query(makeToolRow('search', { pattern: 'cat' })), 'search=cat');
});

test("hidden anagram's spans-words checkbox rides the shared mode key", () => {
  const qs = query(makeToolRow('hidden_anagram', { entry: 'inside', mode: 'span' }));
  assert.equal(qs, 'hidden_anagram=inside&mode=span');
  assert.equal(decode(qs).rows[0].params.mode, 'span');
  // A mode the checkbox can't express decodes as off rather than sticking a
  // truthy junk value into params.
  assert.equal(decode('hidden_anagram=inside&mode=full').rows[0].params.mode, '');
});

test('a param at its default value stays out of the URL', () => {
  assert.equal(query(makeToolRow('rhymes', { entry: 'cat' })), 'rhymes=cat');   // match=loose is the default
  assert.equal(decode('rhymes=cat').rows[0].params.match, 'loose');   // absence decodes to the default
  assert.equal(query(makeToolRow('rhymes', { entry: 'cat', match: 'strict' })), 'rhymes=cat&match=strict');
});

test('a grouped row keeps its secondary params through the `all` toggle', () => {
  const row = makeToolRow('rhymes', { match: 'strict' }, true);
  assert.equal(query(row), 'rhymes&all&match=strict');
  const { rows } = decode('rhymes&all&match=strict');
  assert.equal(rows[0].grouped, true);
  assert.equal(rows[0].params.match, 'strict');
});

test('an unknown key flags droppedUnknown', () => {
  assert.equal(decode('notatool=x').droppedUnknown, true);
  assert.equal(decode('rebus=tool&symbol=' + enc('Ⓣ')).droppedUnknown, false);
});

test('an inverted row carries a bare `not` at its tail', () => {
  assert.equal(query(makeToolRow('search', { pattern: 'c?t' }, false, true)), 'search=c%3Ft&not');
  assert.equal(query(makeToolRow('isograms', {}, false, true)), 'isograms&not');
  assert.equal(query(makeToolRow('search', { pattern: 'c?t' })), 'search=c%3Ft');
});

test('`not` binds to its own row, not the next one', () => {
  const { rows } = decode('search=c%3Ft&not&isograms');
  assert.equal(rows[0].inverted(), true);
  assert.equal(rows[1].inverted(), false);
});

test('`not` survives a round-trip alongside tail params', () => {
  const qs = query(makeToolRow('search', { pattern: 'c?t', mode: 'word' }, false, true));
  assert.equal(qs, 'search=c%3Ft&mode=word&not');
  const row = decode(qs).rows[0];
  assert.equal(row.inverted(), true);
  assert.equal(row.params.mode, 'word');
  assert.equal(query(row), qs);
});

// Normalizing at the `not` key itself would miss this: the row is still a filter
// when `not` is read, and only becomes a transform once `replace` lands.
test('a hand-written `not` on a row a later key turns into a transform is dropped', () => {
  const { rows } = decode('search=cat&not&replace=dog');
  assert.equal(rows[0].kind(), 'transform');
  assert.equal(rows[0].invert, false);
  assert.equal(query(rows[0]), 'search=cat&replace=dog', 're-encodes without the dead `not`');
});

test('`not` on a grouped row is dropped — a group has no verdict to negate', () => {
  const { rows } = decode('cryptogram&all&not');
  assert.equal(rows[0].grouped, true);
  assert.equal(rows[0].invert, false);
});

test('`not` is not mistaken for an unknown key', () => {
  assert.equal(decode('search=cat&not').droppedUnknown, false);
});

// design.md § Tool stack encoding calls this "the one namespace rule the scheme
// rests on": decode classifies each key positionally, so a tool slug or param key
// that shadows a reserved word makes links decode as something else entirely —
// no error, just a different pipeline than the one shared.
test('no tool slug or param key collides with a reserved word', () => {
  const slugs = Object.keys(TOOLS);
  const params = [...new Set(Object.values(TOOLS).flatMap(t => t.params.map(p => p.key)))];
  // `entry` is reserved but deliberately absent: it IS several tools' first-param
  // key, and a first param always rides its tool-slug key, so it never collides.
  for (const word of ['all', 'not', 'sort', 'sort-dir']) {
    assert.ok(!slugs.includes(word), `tool slug "${word}" shadows a reserved word`);
    assert.ok(!params.includes(word), `param key "${word}" shadows a reserved word`);
  }
});
