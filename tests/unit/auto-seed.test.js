import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maybeAutoSeedRescoreRules } from '../../site/src/engine/rescore.js';

const wl = (scores, { publisherId = null, rescoreRules = [] } = {}) =>
  ({ publisherId, rescoreRules, rawEntries: scores.map(score => ({ score })) });

test('seeds one inert (blank-output) rule per distinct score, sorted ascending', () => {
  const w = wl([50, 10, 30]);
  maybeAutoSeedRescoreRules(w);
  assert.deepStrictEqual(w.rescoreRules, [
    { input: '10', length: '', output: '', note: '' },
    { input: '30', length: '', output: '', note: '' },
    { input: '50', length: '', output: '', note: '' },
  ]);
});

test('duplicate scores collapse to one rule per distinct value', () => {
  const w = wl([50, 50, 50, 10]);
  maybeAutoSeedRescoreRules(w);
  assert.deepStrictEqual(w.rescoreRules.map(r => r.input), ['10', '50']);
});

test('exactly 10 distinct scores seeds; 11 does not (the AUTO_SEED_SCORE_LIMIT boundary)', () => {
  const ten = wl(Array.from({ length: 10 }, (_, i) => (i + 1) * 5));
  maybeAutoSeedRescoreRules(ten);
  assert.equal(ten.rescoreRules.length, 10);

  const eleven = wl(Array.from({ length: 11 }, (_, i) => (i + 1) * 5));
  maybeAutoSeedRescoreRules(eleven);
  assert.equal(eleven.rescoreRules.length, 0);
});

test('a publisher-bound wordlist is never auto-seeded (defaults preserved)', () => {
  const w = wl([42], { publisherId: 'jkugelman', rescoreRules: [] });
  maybeAutoSeedRescoreRules(w);
  assert.deepStrictEqual(w.rescoreRules, []);
});

test('a wordlist that already has rules is left untouched', () => {
  const existing = [{ input: '7', length: '', output: '20', note: '' }];
  const w = wl([10, 20], { rescoreRules: existing });
  maybeAutoSeedRescoreRules(w);
  assert.equal(w.rescoreRules, existing);
});

test('an empty wordlist seeds nothing', () => {
  const w = wl([]);
  maybeAutoSeedRescoreRules(w);
  assert.deepStrictEqual(w.rescoreRules, []);
});
