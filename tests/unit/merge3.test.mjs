import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  threeWayMergeEdits, editsEntryEqual, sameEditsEntries, sanitizeFilenameStem,
} from '../../site/src/data/disk-sync.js';
import { serializeMetaEntry } from '../../site/src/data/persist.js';

const mk = (norm, score, comment = '') => ({ norm, score, comment });

test('a one-sided change applies without a conflict', () => {
  const base = [mk('a', 10), mk('b', 20)];
  const file = [mk('a', 99), mk('b', 20)];
  const idb  = [mk('a', 10), mk('b', 20)];
  const { resolved, conflicts } = threeWayMergeEdits(base, file, idb);
  assert.equal(resolved.get('a').score, 99);
  assert.equal(conflicts.length, 0);
});

test('both sides making the same change is not a conflict', () => {
  const base = [mk('a', 10)];
  const { resolved, conflicts } = threeWayMergeEdits(base, [mk('a', 50)], [mk('a', 50)]);
  assert.equal(resolved.get('a').score, 50);
  assert.equal(conflicts.length, 0);
});

test('a true conflict keeps the device (idb) side and records it', () => {
  const { resolved, conflicts } = threeWayMergeEdits([mk('a', 10)], [mk('a', 99)], [mk('a', 50)]);
  assert.equal(resolved.get('a').score, 50);
  assert.deepEqual(conflicts.map(c => c.norm), ['a']);
});

test('deletion does not resurrect: file deletes an entry idb left untouched', () => {
  const base = [mk('a', 10), mk('b', 20)];
  const file = [mk('b', 20)];
  const idb  = [mk('a', 10), mk('b', 20)];
  const { resolved } = threeWayMergeEdits(base, file, idb);
  assert.equal(resolved.has('a'), false);
  assert.equal(resolved.get('b').score, 20);
});

test('both sides deleting the same entry leaves it deleted, no conflict', () => {
  const { resolved, conflicts } = threeWayMergeEdits([mk('a', 10)], [], []);
  assert.equal(resolved.size, 0);
  assert.equal(conflicts.length, 0);
});

test('editsEntryEqual: two records with matching score/comment/display are equal', () => {
  assert.equal(editsEntryEqual(mk('a', 10, 'hi'), mk('a', 10, 'hi')), true);
});

test('editsEntryEqual: a differing score breaks equality', () => {
  assert.equal(editsEntryEqual(mk('a', 10), mk('a', 11)), false);
});

test('editsEntryEqual: a differing comment breaks equality', () => {
  assert.equal(editsEntryEqual(mk('a', 10, 'x'), mk('a', 10, 'y')), false);
});

test('editsEntryEqual: missing comment equals empty-string comment', () => {
  assert.equal(editsEntryEqual({ norm: 'a', score: 10 }, mk('a', 10, '')), true);
});

test('editsEntryEqual: compares on display, falling back to norm when display is absent', () => {
  assert.equal(editsEntryEqual(mk('a', 10), mk('b', 10)), false);
  assert.equal(
    editsEntryEqual({ norm: 'a', display: 'D', score: 10 }, { norm: 'b', display: 'D', score: 10 }),
    true,
  );
  assert.equal(
    editsEntryEqual({ norm: 'x', display: 'a', score: 10 }, mk('a', 10)),
    true,
  );
});

test('editsEntryEqual: two nulls are equal, one null is not', () => {
  assert.equal(editsEntryEqual(null, null), true);
  assert.equal(editsEntryEqual(null, mk('a', 10)), false);
  assert.equal(editsEntryEqual(mk('a', 10), null), false);
});

test('sameEditsEntries: identical collections are equal', () => {
  assert.equal(sameEditsEntries([mk('a', 10), mk('b', 20)], [mk('a', 10), mk('b', 20)]), true);
});

test('sameEditsEntries: order does not matter (keyed by norm)', () => {
  assert.equal(sameEditsEntries([mk('a', 10), mk('b', 20)], [mk('b', 20), mk('a', 10)]), true);
});

test('sameEditsEntries: a length mismatch is not equal', () => {
  assert.equal(sameEditsEntries([mk('a', 10)], [mk('a', 10), mk('b', 20)]), false);
});

test('sameEditsEntries: one differing member is not equal', () => {
  assert.equal(sameEditsEntries([mk('a', 10), mk('b', 20)], [mk('a', 10), mk('b', 99)]), false);
});

test('sameEditsEntries: same length but different norms is not equal', () => {
  assert.equal(sameEditsEntries([mk('a', 10), mk('b', 20)], [mk('a', 10), mk('c', 20)]), false);
});

test('sanitizeFilenameStem: a clean name passes through unchanged', () => {
  assert.equal(sanitizeFilenameStem('My Wordlist'), 'My Wordlist');
});

test('sanitizeFilenameStem: illegal filename characters become spaces', () => {
  assert.equal(sanitizeFilenameStem('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(sanitizeFilenameStem('a\tb\nc'), 'a b c');
});

test('sanitizeFilenameStem: a path separator never survives into the output', () => {
  assert.equal(sanitizeFilenameStem('foo/bar').includes('/'), false);
  assert.equal(sanitizeFilenameStem('foo\\bar').includes('\\'), false);
});

test('sanitizeFilenameStem: trailing dots and spaces are stripped (Windows would strip them)', () => {
  assert.equal(sanitizeFilenameStem('name.'), 'name');
  assert.equal(sanitizeFilenameStem('name...'), 'name');
  assert.equal(sanitizeFilenameStem('name   '), 'name');
  assert.equal(sanitizeFilenameStem('name . . '), 'name');
});

test('sanitizeFilenameStem: empty or all-illegal input falls back to Wordlist_', () => {
  assert.equal(sanitizeFilenameStem(''), 'Wordlist_');
  assert.equal(sanitizeFilenameStem(null), 'Wordlist_');
  assert.equal(sanitizeFilenameStem('///'), 'Wordlist_');
  assert.equal(sanitizeFilenameStem('...'), 'Wordlist_');
});

test('sanitizeFilenameStem: Windows reserved device names get an underscore so the OS accepts them', () => {
  // CON/PRN/AUX/NUL, COM1–COM9, LPT1–LPT9 — case-insensitive — are escaped with a trailing _.
  for (const reserved of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9']) {
    assert.equal(sanitizeFilenameStem(reserved), `${reserved}_`);
  }
  assert.equal(sanitizeFilenameStem('con'), 'con_');
  assert.equal(sanitizeFilenameStem('Nul'), 'Nul_');
});

test('sanitizeFilenameStem: only the exact reserved names are guarded, not lookalikes', () => {
  assert.equal(sanitizeFilenameStem('COM0'), 'COM0');
  assert.equal(sanitizeFilenameStem('LPT0'), 'LPT0');
  assert.equal(sanitizeFilenameStem('CONSOLE'), 'CONSOLE');
  assert.equal(sanitizeFilenameStem('CON game'), 'CON game');
});

test('serializeMetaEntry: a regular populated wordlist serializes to its meta shape', () => {
  const l = {
    dbKey: 'k1',
    name: 'Spread the Wordlist',
    url: 'https://example.com/stwl.txt',
    enabled: true,
    populated: true,
    lastUpdated: 1700000000000,
    fetchedSize: 12345,
    rescoreRules: [{ from: 0, to: 50 }],
    originalFilename: 'stwl.txt',
  };
  assert.deepEqual(serializeMetaEntry(l), {
    dbKey: 'k1',
    name: 'Spread the Wordlist',
    url: 'https://example.com/stwl.txt',
    enabled: true,
    populated: true,
    lastUpdated: 1700000000000,
    fetchedSize: 12345,
    rescoreRules: [{ from: 0, to: 50 }],
    originalFilename: 'stwl.txt',
  });
});

test('serializeMetaEntry: optional fields are omitted when falsy, present when set', () => {
  const bare = serializeMetaEntry({ dbKey: 'k', name: 'X', enabled: false, populated: false });
  assert.equal('type' in bare, false);
  assert.equal('icon' in bare, false);
  assert.equal('publisherId' in bare, false);
  assert.equal('dirty' in bare, false);
  assert.equal(bare.url, null);
  assert.equal(bare.lastUpdated, null);
  assert.equal(bare.fetchedSize, null);
  assert.equal(bare.originalFilename, null);
  assert.deepEqual(bare.rescoreRules, []);

  const icon = { type: 'emoji', value: '✏️' };
  const full = serializeMetaEntry({
    type: 'edits', dbKey: 'k', icon, publisherId: 'xwi',
    name: 'My Edits', enabled: true, populated: true, dirty: true,
  });
  assert.equal(full.type, 'edits');
  assert.equal(full.icon, icon);
  assert.equal(full.publisherId, 'xwi');
  assert.equal(full.dirty, true);
});
