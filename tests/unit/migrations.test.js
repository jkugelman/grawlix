import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMigrate, migrateLs, remapStoredUrls, splitSyncRecord, MIGRATIONS, SCHEMA_VERSION } from '../../site/src/data/migrations.js';
import { URL_REMAPS } from '../../site/src/core/constants.js';

// Migrations can touch localStorage (the v11 `ls` step renames a key), and a
// settings fixture runs the whole chain from its version — so the node env needs
// a localStorage. Minimal in-memory stand-in.
const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

test('v9 → v10 rewrites the dropped "ignore" rescore output to "0"', () => {
  const blob = {
    sources: [
      { name: 'A', rescoreRules: [{ input: '0', output: 'ignore' }, { input: '50', output: '80' }] },
      { name: 'B', rescoreRules: [{ input: '0', output: ' Ignore ' }] },
    ],
  };
  migrateLs(blob, 9);
  assert.equal(blob.sources[0].rescoreRules[0].output, '0');
  assert.equal(blob.sources[0].rescoreRules[1].output, '80');
  assert.equal(blob.sources[1].rescoreRules[0].output, '0');
});

test('v11 → v12 renames the standalone welcomeSeen flag to returningVisitor and drops the old key', () => {
  _ls.grawlix_welcomeSeen = '1';
  delete _ls.grawlix_returningVisitor;
  migrateLs({}, 11);
  assert.equal(_ls.grawlix_returningVisitor, '1');
  assert.equal('grawlix_welcomeSeen' in _ls, false);
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

// v10 → v11 (disk-sync IDB record split) is IDB-only. splitSyncRecord is its pure
// core; the real IDB read/write/delete is the round-trip oracle in disk-sync.spec.js.

// A real FileSystemFileHandle can't be reconstructed from serialized state, so the
// split must pass it through by identity — this stand-in is asserted unchanged by ===.
const HANDLE = { __handle: 'opaque' };

test('v10 → v11 is IDB-only: canMigrate(10) holds but its MIGRATIONS entry has no ls step', () => {
  assert.equal(canMigrate(10), true);
  assert.equal(MIGRATIONS[10].ls, undefined);
});

test('splitSyncRecord splits an edits record (with baseline) into main + worker records', () => {
  const before = structuredClone({ handle: HANDLE, baseline: 'FOO;50\n' });
  before.handle = HANDLE;   // structuredClone can't carry the opaque handle; restore by reference
  const after = splitSyncRecord(before);
  assert.deepEqual(after, { main: { handle: HANDLE }, worker: { baseline: 'FOO;50\n' } });
  assert.ok(after.main.handle === HANDLE, 'handle passes through by reference, not cloned');
});

test('splitSyncRecord splits a mirror record (no baseline) into a main record + null', () => {
  // The mirror case — a one-way output list, and '__merged__' too: the splitter is
  // key-agnostic, so the same shape covers a source dbKey and MERGED_ID alike.
  const after = splitSyncRecord({ handle: HANDLE });
  assert.deepEqual(after, { main: { handle: HANDLE }, worker: null });
  assert.ok(after.main.handle === HANDLE, 'handle passes through by reference, not cloned');
});

test('splitSyncRecord treats an empty-string baseline as real (My Edits empty ancestor)', () => {
  const after = splitSyncRecord({ handle: HANDLE, baseline: '' });
  assert.deepEqual(after.worker, { baseline: '' });   // '' !== undefined → a record, not null
});
