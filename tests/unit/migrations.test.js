import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMigrate, migrateLs, remapStoredUrls, splitSyncRecord, MIGRATIONS, SCHEMA_VERSION } from '../../site/src/data/migrations.js';
import { WORDLIST_PUBLISHERS } from '../../site/src/core/constants.js';

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

test('v12 → v13 renames merged tool slugs in the seenTools reveal list, deduped', () => {
  _ls.grawlix_seenTools = JSON.stringify(['anagrams', 'behead', 'curtail', 'add_prefix', 'joeys', 'kangaroos', 'rebus']);
  migrateLs({}, 12);
  assert.deepEqual(JSON.parse(_ls.grawlix_seenTools), ['anagrams', 'head_off', 'back_off', 'joeys', 'kangaroos', 'rebus']);
});

test('v12 → v13 leaves seenTools alone when no reveal list is stored', () => {
  delete _ls.grawlix_seenTools;
  migrateLs({}, 12);
  assert.equal('grawlix_seenTools' in _ls, false);
});

test('remapStoredUrls rewrites a relocated url, reports the change, and no-ops otherwise', () => {
  const remaps = [{ to: 'https://grawlix.wtf/wordlists/new.txt', from: ['https://grawlix.wtf/old.txt'] }];
  const metas = [
    { name: 'moved', url: remaps[0].from[0] },
    { name: 'unrelated', url: 'https://example.com/keep.txt' },
    { name: 'imported', url: null },
  ];
  assert.equal(remapStoredUrls(metas, remaps), true);
  assert.equal(metas[0].url, remaps[0].to);                    // relocated → rewritten
  assert.equal(metas[1].url, 'https://example.com/keep.txt');  // unrelated → untouched
  assert.equal(metas[2].url, null);                            // file-based → untouched

  assert.equal(remapStoredUrls(metas, remaps), false);         // idempotent: nothing left to remap
});

test('remapStoredUrls sends every historical url for a destination straight to it', () => {
  const remaps = [{
    to: 'https://grawlix.wtf/c.txt',
    from: ['https://grawlix.wtf/a.txt', 'https://grawlix.wtf/b.txt'],
  }];
  const metas = [
    { name: 'oldest', url: 'https://grawlix.wtf/a.txt' },
    { name: 'newer',  url: 'https://grawlix.wtf/b.txt' },
  ];
  assert.equal(remapStoredUrls(metas, remaps), true);
  assert.equal(metas[0].url, 'https://grawlix.wtf/c.txt');
  assert.equal(metas[1].url, 'https://grawlix.wtf/c.txt');
});

test('the live URL_REMAPS resolve the original Nediger url to its current home', () => {
  const nedigerUrl = WORDLIST_PUBLISHERS.find(p => p.id === 'nediger').url;
  const metas = [{ name: 'nediger', url: 'https://grawlix.wtf/Nediger list.txt' }];
  remapStoredUrls(metas);
  assert.equal(metas[0].url, nedigerUrl);
});

test('the live URL_REMAPS resolve both old STWL and Broda hosts to their current homes', () => {
  const stwl  = WORDLIST_PUBLISHERS.find(p => p.id === 'stwl').url;
  const broda = WORDLIST_PUBLISHERS.find(p => p.id === 'broda').url;
  const metas = [
    { name: 'stwl-root',    url: 'https://grawlix.wtf/spreadthewordlist.txt' },
    { name: 'stwl-hosted',  url: 'https://grawlix.wtf/wordlists/spreadthewordlist.txt' },
    { name: 'broda-root',   url: 'https://grawlix.wtf/peter-broda-wordlist.txt' },
    { name: 'broda-hosted', url: 'https://grawlix.wtf/wordlists/peter-broda-wordlist.txt' },
  ];
  remapStoredUrls(metas);
  assert.equal(metas[0].url, stwl);
  assert.equal(metas[1].url, stwl);
  assert.equal(metas[2].url, broda);
  assert.equal(metas[3].url, broda);
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

test('v13 → v14 renames the accents axis to diacritics and adds ascii, carrying values verbatim', () => {
  const blob = { mergedSettings: { outputFormat: { spaces: true, punctuation: false, accents: false, comments: true } } };
  migrateLs(blob, 13);
  assert.deepEqual(blob.mergedSettings.outputFormat,
    { spaces: true, punctuation: false, diacritics: false, ascii: true, comments: true });
});

test('v13 → v14 defaults ascii to keep, so nothing that survives today is newly stripped', () => {
  const blob = { mergedSettings: { outputFormat: { spaces: false, punctuation: false, accents: false, comments: false } } };
  migrateLs(blob, 13);
  assert.equal(blob.mergedSettings.outputFormat.ascii, true);
});

test('v13 → v14 no-ops when no output format was ever stored', () => {
  const blob = { mergedSettings: {} };
  migrateLs(blob, 13);
  assert.equal(blob.mergedSettings.outputFormat, undefined);
});

test('v13 → v14 tolerates a missing mergedSettings', () => {
  const blob = {};
  migrateLs(blob, 13);
  assert.equal(blob.mergedSettings, undefined);
});
