import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lootRowSizes, unseenToolSlugs } from '../../site/src/engine/new-tools.js';
import { TOOLS } from '../../site/src/engine/tools.js';
import { RETURNING_BASELINE } from '../../site/src/data/new-tools.js';

const sweep = fit => Array.from({ length: 10 }, (_, i) => lootRowSizes(i + 1, fit));

test('lootRowSizes fit=4 (the reveal caps here on a wide screen)', () => {
  assert.deepStrictEqual(sweep(4), [
    [1], [2], [3], [4], [3, 2],
    [3, 3], [4, 3], [4, 4], [3, 3, 3], [4, 3, 3],
  ]);
});

test('lootRowSizes fit=3', () => {
  assert.deepStrictEqual(sweep(3), [
    [1], [2], [3], [2, 2], [3, 2],
    [3, 3], [3, 2, 2], [3, 3, 2], [3, 3, 3], [3, 3, 2, 2],
  ]);
});

test('lootRowSizes fit=2', () => {
  assert.deepStrictEqual(sweep(2), [
    [1], [2], [2, 1], [2, 2], [2, 2, 1],
    [2, 2, 2], [2, 2, 2, 1], [2, 2, 2, 2], [2, 2, 2, 2, 1], [2, 2, 2, 2, 2],
  ]);
});

test('lootRowSizes fit=1 stacks one per row', () => {
  assert.deepStrictEqual(sweep(1), Array.from({ length: 10 }, (_, i) => Array(i + 1).fill(1)));
});

test('lootRowSizes invariants for fit 1..6, counts 1..10', () => {
  for (let fit = 1; fit <= 6; fit++) {
    for (let count = 1; count <= 10; count++) {
      const sizes = lootRowSizes(count, fit);
      const ctx = `count=${count} fit=${fit} -> ${JSON.stringify(sizes)}`;
      assert.equal(sizes.reduce((a, b) => a + b, 0), count, `sum: ${ctx}`);
      assert.ok(Math.max(...sizes) <= fit, `no row wider than fit: ${ctx}`);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `rows differ by <=1: ${ctx}`);
      assert.equal(sizes.length, Math.ceil(count / fit), `row count: ${ctx}`);
    }
  }
});

test('lootRowSizes zero yields no rows', () => {
  assert.deepStrictEqual(lootRowSizes(0, 4), []);
});

const CATALOG = ['anagrams', 'rhymes', 'rebus', 'caesar', 'cryptogram'];

test('unseenToolSlugs returns catalog order, minus seen', () => {
  assert.deepStrictEqual(unseenToolSlugs(CATALOG, ['rhymes', 'anagrams']), ['rebus', 'caesar', 'cryptogram']);
});

test('unseenToolSlugs: a fully-seen catalog yields nothing (returning visitor, no new tools)', () => {
  assert.deepStrictEqual(unseenToolSlugs(CATALOG, CATALOG), []);
});

test('unseenToolSlugs: empty seen set yields the whole catalog (the seed-on-first-run input)', () => {
  assert.deepStrictEqual(unseenToolSlugs(CATALOG, []), CATALOG);
});

test('unseenToolSlugs ignores stale seen slugs no longer in the catalog', () => {
  assert.deepStrictEqual(unseenToolSlugs(CATALOG, ['rhymes', 'retired_tool']), ['anagrams', 'rebus', 'caesar', 'cryptogram']);
});

test('the returning-user baseline is a frozen static list, not the live catalog minus the new tools', () => {
  assert.deepStrictEqual(RETURNING_BASELINE, [
    'anagrams', 'letter_bank', 'restricted_alphabet', 'scrabble',
    'repeaters', 'neckouts', 'isograms', 'supervocalics', 'monovocalics',
    'alphabetical', 'reverse_alphabetical', 'consonantcy', 'vowelcy',
    'kangaroos', 'joeys', 'palindromes', 'semordnilap', 'rhymes',
    'space_out', 'search', 'regex', 'initialisms', 'behead', 'curtail', 'rebus',
  ]);
  const catalog = new Set(Object.keys(TOOLS));
  for (const slug of RETURNING_BASELINE) assert.ok(catalog.has(slug), `unknown tool in baseline: ${slug}`);
  assert.ok(!RETURNING_BASELINE.includes('caesar') && !RETURNING_BASELINE.includes('cryptogram'));
});
