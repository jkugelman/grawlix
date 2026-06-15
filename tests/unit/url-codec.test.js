import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRow, decodeRows } from '../../site/src/app/url-codec.js';
import { makeToolRow } from '../../site/src/engine/tools.js';

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
  const qs = query(makeToolRow('search', { pattern: 'c?t', replace: 'dog', 'whole-word': true }));
  assert.equal(qs, 'search=' + enc('c?t') + '&replace=dog&whole-word');
  const { rows } = decode(qs);
  assert.equal(rows[0].params.pattern, 'c?t');
  assert.equal(rows[0].params.replace, 'dog');
  assert.equal(rows[0].params['whole-word'], true);
});

test('an unknown key flags droppedUnknown', () => {
  assert.equal(decode('notatool=x').droppedUnknown, true);
  assert.equal(decode('rebus=tool&symbol=' + enc('Ⓣ')).droppedUnknown, false);
});
