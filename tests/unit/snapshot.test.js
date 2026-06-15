import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildByNorm, canonicalNormRow } from '../../site/src/engine/snapshot.js';
import { resolveCorpus } from '../../site/src/engine/corpus.js';

const entry = (norm, display, score) => ({ norm, display, score });

const contributor = (wordlist, { score = 0, rawScore = 0, comment = '', display = null } = {}) =>
  ({ wordlist, score, rawScore, comment, display });
const bucket = (...contributors) => {
  const displays = new Set();
  for (const c of contributors) if (c.display != null) displays.add(c.display);
  return { contributors, displays };
};

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

test('canonicalNormRow: picks the same code-unit-min row buildByNorm would', () => {
  // The worker's owned-corpus splice picks a norm's canonical row through
  // canonicalNormRow; it must agree with buildByNorm or byNorm-reading tools drift.
  const rows = [entry('cat', 'Cat', 3), entry('cat', 'CAT', 4), entry('cat', 'cAt', 5)];
  assert.equal(canonicalNormRow(rows), buildByNorm(rows).get('cat'));
  assert.equal(canonicalNormRow(rows).display, 'CAT');
});

test('canonicalNormRow: a lone null-display row is canonical', () => {
  assert.equal(canonicalNormRow([entry('cat', null, 9)]).display, null);
});

test('canonicalNormRow: empty rows yield null', () => {
  assert.equal(canonicalNormRow([]), null);
});

// Pins the shared builder against the live merge path: resolveCorpus's byNorm and
// buildByNorm must agree or byNorm-reading tools diverge across threads.
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

  const direct = buildByNorm(entries);
  assert.equal(direct.size, real.size);
  for (const [norm, row] of real) assert.equal(direct.get(norm), row);
});
