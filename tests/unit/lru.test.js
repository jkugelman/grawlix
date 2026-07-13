import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from '../../site/src/core/lru.js';

test('caps size, evicting the least recently used entry', () => {
  const lru = new LruCache(3, 60_000);
  lru.set('a', 1);
  lru.set('b', 2);
  lru.set('c', 3);
  lru.set('d', 4);
  assert.equal(lru.has('a'), false);
  assert.equal(lru.get('b'), 2);
  assert.equal(lru.get('c'), 3);
  assert.equal(lru.get('d'), 4);
});

test('a read refreshes recency, protecting the entry from eviction', () => {
  const lru = new LruCache(3, 60_000);
  lru.set('a', 1);
  lru.set('b', 2);
  lru.set('c', 3);
  lru.get('a');
  lru.set('d', 4);
  assert.equal(lru.get('a'), 1);
  assert.equal(lru.has('b'), false);
});

test('overwriting a key updates in place without evicting others', () => {
  const lru = new LruCache(2, 60_000);
  lru.set('a', 1);
  lru.set('b', 2);
  lru.set('a', 10);
  assert.equal(lru.get('a'), 10);
  assert.equal(lru.get('b'), 2);
});

test('entries expire after the TTL even when read constantly', t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const lru = new LruCache(10, 1000);
  lru.set('a', 1);
  t.mock.timers.tick(999);
  assert.equal(lru.get('a'), 1);
  t.mock.timers.tick(1);
  assert.equal(lru.get('a'), undefined);
  assert.equal(lru.has('a'), false);
});

test('a read does not extend an entry lifetime', t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const lru = new LruCache(10, 1000);
  lru.set('a', 1);
  t.mock.timers.tick(600);
  lru.get('a');
  t.mock.timers.tick(600);
  assert.equal(lru.get('a'), undefined);
});

test('a set restarts the clock for that key', t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const lru = new LruCache(10, 1000);
  lru.set('a', 1);
  t.mock.timers.tick(600);
  lru.set('a', 2);
  t.mock.timers.tick(600);
  assert.equal(lru.get('a'), 2);
});

test('stores undefined as a present value, distinguishable via has()', () => {
  const lru = new LruCache(10, 60_000);
  lru.set('pending', undefined);
  assert.equal(lru.has('pending'), true);
  assert.equal(lru.get('pending'), undefined);
  assert.equal(lru.has('missing'), false);
});

test('delete removes the entry', () => {
  const lru = new LruCache(10, 60_000);
  lru.set('a', 1);
  lru.delete('a');
  assert.equal(lru.has('a'), false);
});
