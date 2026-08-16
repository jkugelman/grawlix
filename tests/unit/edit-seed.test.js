import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus, resolveEditSeedWinner, mergeKey } from '../../site/src/engine/corpus.js';

// resolveEditSeedWinner is the single shared resolution main's resolveSeed and the
// worker's handleFetchEditSeed both run against a merged corpus (buildMergedWordlist
// / ownedMerged) — so testing it here proves the two threads pick the SAME winner
// across the fidelity-critical quirks. The worker reply is the winner row plus its
// source's dbKey; main does the My-Edits raw-score swap locally. These fixtures pin
// the winner identity (entry/score/comment/source) and the bare-display/absent quirks.

const wlEntry = (norm, score, { display = null, comment = '' } = {}) =>
  ({ norm, display, score, comment });
const src = (name, rawEntries, { enabled = true } = {}) =>
  ({ name, dbKey: 'db_' + name, enabled, rescoreRules: [], rawEntries });

// What the worker would ship in `editSeed.winner` (lean: no wordlist ref) plus the
// sourceId — mirroring handleFetchEditSeed's projection of the resolved row.
const projectWinner = row => row == null ? null : ({
  norm: row.norm, display: row.display ?? null,
  score: row.score, comment: row.comment || '', sourceId: row.wordlist.dbKey,
});

test('scoped lower-priority overlap: the winner is the higher-priority list, not the clicked one', () => {
  // Hi added first = higher priority; both carry OCEAN. From a scope on Lo the
  // clicked atom is Lo's 60, but the seed must be Hi's 90 (the merge winner).
  const Hi = src('Hi', [wlEntry('ocean', 90, { comment: 'big' })]);
  const Lo = src('Lo', [wlEntry('ocean', 60, { comment: 'small' })]);
  const merged = buildCorpus([Hi, Lo]);

  const winner = resolveEditSeedWinner(merged, 'ocean', null);
  assert.deepStrictEqual(projectWinner(winner), {
    norm: 'ocean', display: null, score: 90, comment: 'big', sourceId: 'db_Hi',
  });
  // It is exactly the byKey row — the common-case merged path returns clicked-IS-winner.
  assert.equal(winner, merged.byKey.get(mergeKey('ocean', null)));
});

test('bare-display quirk: a bare click with no bare merged row picks the first-alphabetical variant', () => {
  // W1 carries two spelled spellings of SEEINGASHOW; nothing carries the bare form.
  // A bare click resolves to the first-alphabetical spelled variant ('seeing a show').
  const W1 = src('W1', [
    wlEntry('seeingashow', 70, { display: 'seeing as how' }),
    wlEntry('seeingashow', 80, { display: 'seeing a show' }),
  ]);
  const merged = buildCorpus([W1]);

  assert.equal(merged.byKey.get(mergeKey('seeingashow', null)), undefined); // no bare row
  const winner = resolveEditSeedWinner(merged, 'seeingashow', null);
  assert.deepStrictEqual(projectWinner(winner), {
    norm: 'seeingashow', display: 'seeing a show', score: 80, comment: '', sourceId: 'db_W1',
  });
});

test('a bare norm whose only row is bare resolves through byKey, no variant walk', () => {
  const W = src('W', [wlEntry('apple', 42)]);
  const merged = buildCorpus([W]);
  const winner = resolveEditSeedWinner(merged, 'apple', null);
  assert.equal(winner.display, null);
  assert.equal(winner.score, 42);
});

test('a spelled click resolves its own variant, not the first-alphabetical one', () => {
  const W = src('W', [
    wlEntry('eagle', 50, { display: 'EAGLE', comment: 'caps' }),
    wlEntry('eagle', 60, { display: 'Eagle' }),
  ]);
  const merged = buildCorpus([W]);
  const winner = resolveEditSeedWinner(merged, 'eagle', 'EAGLE');
  assert.deepStrictEqual(projectWinner(winner), {
    norm: 'eagle', display: 'EAGLE', score: 50, comment: 'caps', sourceId: 'db_W',
  });
});

test('My-Edits winner: the reply flags it via sourceId so main does the raw swap', () => {
  // My Edits wins BAGEL; the worker ships its dbKey, and main checks
  // sourceId → state.sources === editsWordlist to apply the RAW-score adjustment.
  // Here we assert the winner is the edits source so that flag would fire.
  const edits = src('My Edits', [wlEntry('bagel', 90, { comment: '' })]);
  const other = src('Source', [wlEntry('bagel', 50)]);
  const merged = buildCorpus([edits, other]);

  const winner = resolveEditSeedWinner(merged, 'bagel', null);
  assert.equal(projectWinner(winner).sourceId, 'db_My Edits');
});

test('a spelling absent from the merge resolves to nothing without bareFallback, and to the norm with it', () => {
  // The deep-link case: `?entry=BAGEL` against lists that spell it `bagel`. Without the
  // opt-in the concrete miss is final, which is what left a shared link's score blank.
  const W = src('W', [wlEntry('bagel', 50, { display: 'bagel' })]);
  const merged = buildCorpus([W]);

  assert.equal(resolveEditSeedWinner(merged, 'bagel', 'BAGEL'), null);
  assert.deepStrictEqual(projectWinner(resolveEditSeedWinner(merged, 'bagel', 'BAGEL', true)), {
    norm: 'bagel', display: 'bagel', score: 50, comment: '', sourceId: 'db_W',
  });
});

test('bareFallback never overrides a spelling that IS present', () => {
  // The guard that keeps a click (and a batch rescore) on its own row: an exact hit
  // must win even with the flag on, or a selection would rescore the wrong spelling.
  const W = src('W', [
    wlEntry('eagle', 50, { display: 'EAGLE' }),
    wlEntry('eagle', 60, { display: 'Eagle' }),
  ]);
  const merged = buildCorpus([W]);
  assert.equal(resolveEditSeedWinner(merged, 'eagle', 'EAGLE', true).score, 50);
  assert.equal(resolveEditSeedWinner(merged, 'eagle', 'Eagle', true).score, 60);
});

test('bareFallback on a norm that is absent entirely still resolves to nothing', () => {
  const merged = buildCorpus([src('E', [wlEntry('apple', 10)])]);
  assert.equal(resolveEditSeedWinner(merged, 'ghost', 'GHOST', true), null);
});

test('norm absent from the merge: the worker returns null (main falls back to clicked)', () => {
  // The disabled-list-scope case: the clicked norm exists only in a disabled list,
  // so it is absent from the enabled-only merge. resolveEditSeedWinner returns null;
  // the worker replies winner: null and main seeds from the clicked atom (row._wlEntry).
  const Disabled = src('D', [wlEntry('ghost', 33)], { enabled: false });
  const Enabled = src('E', [wlEntry('apple', 10)]);
  const merged = buildCorpus([Enabled]);   // mirrors ownedMerged: enabled-only

  assert.equal(resolveEditSeedWinner(merged, 'ghost', null), null);
  assert.equal(projectWinner(resolveEditSeedWinner(merged, 'ghost', null)), null);
  // Sanity: a present norm still resolves.
  assert.notEqual(resolveEditSeedWinner(merged, 'apple', null), null);
});
