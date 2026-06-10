import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  packSnapshot, unpackSnapshot, buildByNorm, snapshotTransferables,
} from '../../site/src/engine/snapshot.js';
import { resolveCorpus } from '../../site/src/data/merge.js';

const entry = (norm, display, score) => ({ norm, display, score });

const contributor = (wordlist, { score = 0, rawScore = 0, comment = '', display = null } = {}) =>
  ({ wordlist, score, rawScore, comment, display });
const bucket = (...contributors) => {
  const displays = new Set();
  for (const c of contributors) if (c.display != null) displays.add(c.display);
  return { contributors, displays };
};

function assertRoundTrip(entries) {
  const { entries: out } = unpackSnapshot(packSnapshot(entries));
  assert.equal(out.length, entries.length);
  for (let i = 0; i < entries.length; i++) {
    assert.equal(out[i].norm, entries[i].norm, `norm @${i}`);
    assert.equal(out[i].display, entries[i].display, `display @${i}`);
    assert.equal(out[i].score, entries[i].score, `score @${i}`);
  }
  return out;
}

test('round-trip: empty list', () => {
  const { entries, byNorm } = unpackSnapshot(packSnapshot([]));
  assert.deepEqual(entries, []);
  assert.equal(byNorm.size, 0);
});

test('round-trip: single entry with null display', () => {
  assertRoundTrip([entry('cat', null, 50)]);
});

test('round-trip: single entry with an explicit display', () => {
  assertRoundTrip([entry('cat', 'Cat', 50)]);
});

test('round-trip: null display stays null, not collapsed to norm', () => {
  const [out] = unpackSnapshot(packSnapshot([entry('cat', null, 50)])).entries;
  assert.equal(out.display, null);
});

test('round-trip: interleaved null and explicit displays stay aligned', () => {
  assertRoundTrip([
    entry('ant', null, 10),
    entry('bee', 'Bee', 20),
    entry('cat', null, 30),
    entry('dog', 'Dog', 40),
    entry('elk', 'ELK', 50),
    entry('fox', null, 60),
  ]);
});

test('round-trip: a display equal to its norm is stored, not nulled', () => {
  const out = assertRoundTrip([entry('abc', 'abc', 5)]);
  assert.equal(out[0].display, 'abc');
});

test('round-trip: multibyte / unicode displays', () => {
  assertRoundTrip([
    entry('cafe', 'Café', 10),
    entry('naive', 'naïve', 20),
    entry('emoji', '😀🎉', 30),
    entry('cjk', '日本語', 40),
    entry('combine', 'é', 50),
    entry('zwj', '👨‍👩‍👧', 60),
  ]);
});

test('round-trip: multibyte content in norms', () => {
  assertRoundTrip([
    entry('café', 'X', 1),
    entry('日本', null, 2),
  ]);
});

test('round-trip: scores incl. 0, negative, and 32-bit extremes', () => {
  const out = assertRoundTrip([
    entry('a', null, 0),
    entry('b', null, -1),
    entry('c', null, -50),
    entry('d', null, 2147483647),
    entry('e', null, -2147483648),
  ]);
  assert.deepEqual(out.map(e => e.score), [0, -1, -50, 2147483647, -2147483648]);
});

test('round-trip: many entries sharing a norm', () => {
  assertRoundTrip([
    entry('cat', 'Cat', 5),
    entry('cat', 'CAT', 6),
    entry('cat', 'cAt', 7),
  ]);
});

test('round-trip: a larger generated corpus reconstructs index-for-index', () => {
  const entries = [];
  for (let i = 0; i < 5000; i++) {
    const norm = 'w' + i.toString(36);
    const display = i % 3 === 0 ? null : norm.toUpperCase();
    entries.push(entry(norm, display, (i % 100) - 50));
  }
  assertRoundTrip(entries);
});

test('byNorm: reconstructs from the unpacked entries', () => {
  const entries = [
    entry('ant', null, 1),
    entry('bee', 'Bee', 2),
    entry('cat', 'Cat', 3),
  ];
  const { byNorm } = unpackSnapshot(packSnapshot(entries));
  assert.equal(byNorm.size, 3);
  assert.equal(byNorm.get('ant').score, 1);
  assert.equal(byNorm.get('bee').display, 'Bee');
});

test('buildByNorm: picks the code-unit-first display among a norm\'s variants', () => {
  const entries = [
    entry('cat', 'Cat', 3),
    entry('cat', 'CAT', 4),
  ];
  assert.equal(buildByNorm(entries).get('cat').display, 'CAT');
});

test('buildByNorm: a lone null-display row is the canonical row', () => {
  assert.equal(buildByNorm([entry('cat', null, 9)]).get('cat').display, null);
});

// Pins the shared builder against the live merge path: resolveCorpus's byNorm and
// snapshot's byNorm must agree or byNorm-reading tools diverge across threads.
test('buildByNorm: matches resolveCorpus byNorm, incl. the case-variant landmine', () => {
  const a = { name: 'A' }, b = { name: 'B' };
  const buckets = new Map([
    ['ant', bucket(contributor(a))],
    ['cat', bucket(
      contributor(a, { display: 'Cat' }),
      contributor(b, { display: 'CAT' }),
    )],
    ['dog', bucket(contributor(a, { display: 'Dog' }))],
  ]);
  const { entries, byNorm: real } = resolveCorpus(buckets, [a, b]);

  const { byNorm: viaSnapshot } = unpackSnapshot(packSnapshot(entries));
  assert.equal(viaSnapshot.size, real.size);
  for (const [norm, row] of real) {
    assert.equal(viaSnapshot.get(norm).display, row.display, `byNorm[${norm}] display`);
    assert.equal(viaSnapshot.get(norm).score, row.score, `byNorm[${norm}] score`);
  }

  const direct = buildByNorm(entries);
  for (const [norm, row] of real) assert.equal(direct.get(norm), row);
});

test('packed buffers are real ArrayBuffer / typed-array instances', () => {
  const snap = packSnapshot([entry('cat', 'Cat', 5), entry('dog', null, 6)]);
  assert.ok(snap.scores instanceof ArrayBuffer);
  assert.ok(snap.norms.bytes instanceof ArrayBuffer);
  assert.ok(snap.norms.offsets instanceof ArrayBuffer);
  assert.ok(snap.displays.present instanceof ArrayBuffer);
  assert.ok(snap.displays.bytes instanceof ArrayBuffer);
  assert.ok(snap.displays.offsets instanceof ArrayBuffer);
  assert.deepEqual([...new Int32Array(snap.scores)], [5, 6]);
});

test('snapshotTransferables lists every backing ArrayBuffer once', () => {
  const snap = packSnapshot([entry('cat', 'Cat', 5)]);
  const xfer = snapshotTransferables(snap);
  assert.ok(xfer.every(b => b instanceof ArrayBuffer));
  assert.equal(new Set(xfer).size, xfer.length);
  assert.deepEqual(
    new Set(xfer),
    new Set([snap.scores, snap.norms.bytes, snap.norms.offsets,
             snap.displays.present, snap.displays.bytes, snap.displays.offsets]),
  );
});

test('packed buffers survive a transfer (detach) round-trip', () => {
  const entries = [entry('cat', 'Café', 5), entry('dog', null, -7)];
  const snap = packSnapshot(entries);
  const moved = structuredClone(snap, { transfer: snapshotTransferables(snap) });
  const { entries: out } = unpackSnapshot(moved);
  assert.deepEqual(out, entries);
  assert.equal(snap.scores.byteLength, 0);
});
