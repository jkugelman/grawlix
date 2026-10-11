import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maybeAutoSeedRescoreRules } from '../../site/src/engine/rescore.js';

// Entries are passed explicitly (the function does NOT read wordlist.rawEntries —
// main holds none for a non-Edits source); the wordlist carries only metadata.
const wl = ({ publisherId = null, rescoreRules = [] } = {}) => ({ publisherId, rescoreRules });
const entries = scores => scores.map(score => ({ score }));

test('seeds one inert (blank-output) rule per distinct score, sorted ascending', () => {
  const w = wl();
  maybeAutoSeedRescoreRules(w, entries([50, 10, 30]));
  assert.deepStrictEqual(w.rescoreRules, [
    { query: 'score: 10', output: '', note: '' },
    { query: 'score: 30', output: '', note: '' },
    { query: 'score: 50', output: '', note: '' },
  ]);
});

test('duplicate scores collapse to one rule per distinct value', () => {
  const w = wl();
  maybeAutoSeedRescoreRules(w, entries([50, 50, 50, 10]));
  assert.deepStrictEqual(w.rescoreRules.map(r => r.query), ['score: 10', 'score: 50']);
});

test('exactly 10 distinct scores seeds; 11 does not (the AUTO_SEED_SCORE_LIMIT boundary)', () => {
  const ten = wl();
  maybeAutoSeedRescoreRules(ten, entries(Array.from({ length: 10 }, (_, i) => (i + 1) * 5)));
  assert.equal(ten.rescoreRules.length, 10);

  const eleven = wl();
  maybeAutoSeedRescoreRules(eleven, entries(Array.from({ length: 11 }, (_, i) => (i + 1) * 5)));
  assert.equal(eleven.rescoreRules.length, 0);
});

test('a publisher-bound wordlist is never auto-seeded (defaults preserved)', () => {
  const w = wl({ publisherId: 'jkugelman' });
  maybeAutoSeedRescoreRules(w, entries([42]));
  assert.deepStrictEqual(w.rescoreRules, []);
});

test('a wordlist that already has rules is left untouched', () => {
  const existing = [{ query: 'score: 7', output: '20', note: '' }];
  const w = wl({ rescoreRules: existing });
  maybeAutoSeedRescoreRules(w, entries([10, 20]));
  assert.equal(w.rescoreRules, existing);
});

test('an empty wordlist seeds nothing', () => {
  const w = wl();
  maybeAutoSeedRescoreRules(w, entries([]));
  assert.deepStrictEqual(w.rescoreRules, []);
});
