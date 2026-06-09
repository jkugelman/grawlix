import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './support/extract.mjs';

const { canMigrate, migrateSettings, SCHEMA_VERSION } =
  extract('migrations', ['canMigrate', 'migrateSettings', 'SCHEMA_VERSION']);

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

test('canMigrate gates future versions, non-finite input, and gaps in the step chain', () => {
  assert.equal(canMigrate(9), true);
  assert.equal(canMigrate(SCHEMA_VERSION), true);
  assert.equal(canMigrate(SCHEMA_VERSION + 1), false);
  assert.equal(canMigrate(NaN), false);
  assert.equal(canMigrate(8), false);
});
