import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMigrate, migrateSettings, remapStoredUrls, SCHEMA_VERSION } from '../../site/src/data/migrations.js';
import { URL_REMAPS } from '../../site/src/core/constants.js';

test('v9 → v10 rewrites the dropped "ignore" rescore output to "0"', () => {
  const blob = {
    sources: [
      { name: 'A', rescoreRules: [{ input: '0', output: 'ignore' }, { input: '50', output: '80' }] },
      { name: 'B', rescoreRules: [{ input: '0', output: ' Ignore ' }] },
    ],
  };
  migrateSettings(blob, 9);
  assert.equal(blob.sources[0].rescoreRules[0].output, '0');
  assert.equal(blob.sources[0].rescoreRules[1].output, '80');
  assert.equal(blob.sources[1].rescoreRules[0].output, '0');
});

test('remapStoredUrls rewrites a relocated url, reports the change, and no-ops otherwise', () => {
  const { from, to } = URL_REMAPS[0];
  const metas = [
    { name: 'moved', url: from },
    { name: 'unrelated', url: 'https://example.com/keep.txt' },
    { name: 'imported', url: null },
  ];
  assert.equal(remapStoredUrls(metas), true);
  assert.equal(metas[0].url, to);                              // relocated → rewritten
  assert.equal(metas[1].url, 'https://example.com/keep.txt');  // unrelated → untouched
  assert.equal(metas[2].url, null);                            // file-based → untouched

  assert.equal(remapStoredUrls(metas), false);                 // idempotent: nothing left to remap
});

test('remapStoredUrls chains a far-behind url all the way forward in one pass', () => {
  const remaps = [
    { from: 'https://grawlix.wtf/a.txt', to: 'https://grawlix.wtf/b.txt' },
    { from: 'https://grawlix.wtf/b.txt', to: 'https://grawlix.wtf/c.txt' },
  ];
  const metas = [{ name: 'stale', url: 'https://grawlix.wtf/a.txt' }];
  assert.equal(remapStoredUrls(metas, remaps), true);
  assert.equal(metas[0].url, 'https://grawlix.wtf/c.txt');
});

test('canMigrate gates future versions, non-finite input, and gaps in the step chain', () => {
  assert.equal(canMigrate(9), true);
  assert.equal(canMigrate(SCHEMA_VERSION), true);
  assert.equal(canMigrate(SCHEMA_VERSION + 1), false);
  assert.equal(canMigrate(NaN), false);
  assert.equal(canMigrate(8), false);
});
