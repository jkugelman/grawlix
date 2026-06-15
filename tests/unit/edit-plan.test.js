import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEntryWrite, applyEditsWriteSet } from '../../site/src/engine/edit-plan.js';
import { compileRescoreRules } from '../../site/src/engine/rescore.js';
import { displayOf } from '../../site/src/engine/norm.js';

const wlEntry = (norm, score, { display = null, comment = '' } = {}) => ({ norm, display, score, comment });

const src = (name, rawEntries, { enabled = true, type = undefined } = {}) => {
  const w = { name, enabled, type, rescoreRules: [], rawEntries };
  compileRescoreRules(w);
  return w;
};

const edits = (rawEntries = []) => src('My Edits', rawEntries, { type: 'edits' });

const typed = (raw, score = 50, comment = '') => ({ raw, score, comment });

// ─── create ────────────────────────────────────────────────────────────────

test('create: a fresh plain entry is a lone upsert, no delete', () => {
  const sources = [edits(), src('XWI', [wlEntry('apple', 30)])];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('banana', 60), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.deletes, []);
  assert.deepStrictEqual(p.upserts, [{ norm: 'banana', display: 'banana', score: 60, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('create: exact (norm, displayOf) anywhere enabled blocks — plain matches a foreign bare', () => {
  const sources = [edits(), src('XWI', [wlEntry('ocean', 30)])];   // XWI bare ocean
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('ocean'), sources });
  assert.equal(p.blockedReason, 'exists');
  assert.deepStrictEqual(p.upserts, []);
});

test('create: a disabled source does not block', () => {
  const sources = [edits(), src('Off', [wlEntry('ocean', 30)], { enabled: false })];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('ocean'), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: 'ocean', score: 50, comment: '' }]);
});

test('create: rich over a foreign bare copies the bare down (snapshotting its score)', () => {
  const sources = [edits(), src('XWI', [wlEntry('theirs', 30, { comment: 'pron' })])];   // bare
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('the IRS', 90), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'theirs', display: 'the IRS', score: 90, comment: '' },
    { norm: 'theirs', display: null, score: 30, comment: 'pron' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'keep-bare', norm: 'theirs' }]);
});

test('create: rich over a foreign bare does NOT copy when My Edits already has the norm', () => {
  const sources = [edits([wlEntry('theirs', 70, { display: 'Theirs' })]), src('XWI', [wlEntry('theirs', 30)])];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('the IRS', 90), sources });
  assert.deepStrictEqual(p.upserts, [{ norm: 'theirs', display: 'the IRS', score: 90, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('create: plain over a foreign rich coexists naturally — no copy, not blocked', () => {
  const sources = [edits(), src('XWI', [wlEntry('theirs', 30, { display: 'the IRS' })])];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('theirs'), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [{ norm: 'theirs', display: 'theirs', score: 50, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

// ─── edit / rename ───────────────────────────────────────────────────────────

test('edit: score-only change is an in-place upsert, no delete', () => {
  const sources = [edits([wlEntry('ocean', 50)])];
  const clicked = { norm: 'ocean', display: null, score: 50, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 80), sources });
  assert.deepStrictEqual(p.deletes, []);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: 'ocean', score: 80, comment: '' }]);
});

test('edit: same-norm enrich deletes the plain and upserts the rich, no downscore', () => {
  const sources = [edits([wlEntry('ocean', 50)])];
  const clicked = { norm: 'ocean', display: null, score: 50, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('Ocean', 50), sources });
  assert.deepStrictEqual(p.deletes, [{ norm: 'ocean', display: 'ocean' }]);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: 'Ocean', score: 50, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('edit: renaming a foreign entry to a new norm trashes the leftover', () => {
  const sources = [edits([]), src('XWI', [wlEntry('oceam', 40)])];   // clicked oceam is foreign-only
  const clicked = { norm: 'oceam', display: null, score: 40, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 60), sources, trashScore: 0 });
  assert.deepStrictEqual(p.upserts, [
    { norm: 'ocean', display: 'ocean', score: 60, comment: '' },
    { norm: 'oceam', display: null, score: 0, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'downscore', norm: 'oceam', display: 'oceam', score: 0 }]);
});

test('edit: renaming a My Edits entry to a new norm deletes it — no downscore even with a foreign norm-mate', () => {
  const sources = [edits([wlEntry('oceam', 60)]), src('XWI', [wlEntry('oceam', 40)])];
  const clicked = { norm: 'oceam', display: null, score: 60, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 60), sources });
  assert.deepStrictEqual(p.deletes, [{ norm: 'oceam', display: 'oceam' }]);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: 'ocean', score: 60, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('edit: renaming with no foreign leftover does not trash', () => {
  const sources = [edits([wlEntry('oceam', 60)])];
  const clicked = { norm: 'oceam', display: null, score: 60, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 60), sources });
  assert.deepStrictEqual(p.deletes, [{ norm: 'oceam', display: 'oceam' }]);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: 'ocean', score: 60, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('edit: the foreign-rename downscore respects a custom trash score', () => {
  const sources = [edits([]), src('XWI', [wlEntry('oceam', 40)])];
  const clicked = { norm: 'oceam', display: null, score: 40, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 60), sources, trashScore: 5 });
  assert.deepStrictEqual(p.upserts[1], { norm: 'oceam', display: null, score: 5, comment: '' });
});

// ─── applyEditsWriteSet + inverse round-trip ─────────────────────────────────

const snapshot = arr => arr.map(e => ({ norm: e.norm, display: e.display ?? null, score: e.score, comment: e.comment ?? '' }));

function roundTrip(rawEntries, writes) {
  const before = snapshot(rawEntries);
  const inverse = applyEditsWriteSet(rawEntries, writes);
  applyEditsWriteSet(rawEntries, inverse);
  return { after: snapshot(rawEntries), before };
}

test('applyEditsWriteSet: rename move (delete + upsert) applies, then inverse reverts', () => {
  const raw = [wlEntry('oceam', 60)];
  applyEditsWriteSet(raw, { deletes: [{ norm: 'oceam', display: 'oceam' }], upserts: [{ norm: 'ocean', display: 'ocean', score: 60, comment: '' }] });
  assert.deepStrictEqual(snapshot(raw), [{ norm: 'ocean', display: 'ocean', score: 60, comment: '' }]);
});

test('applyEditsWriteSet: upsert updates an existing entry in place', () => {
  const raw = [wlEntry('ocean', 50, { display: 'Ocean', comment: 'old' })];
  applyEditsWriteSet(raw, { upserts: [{ norm: 'ocean', display: 'Ocean', score: 80, comment: 'new' }] });
  assert.deepStrictEqual(snapshot(raw), [{ norm: 'ocean', display: 'Ocean', score: 80, comment: 'new' }]);
});

test('applyEditsWriteSet: inverse round-trips a rename-with-downscore back to the start', () => {
  const raw = [wlEntry('oceam', 60, { comment: 'typo' })];
  const writes = {
    deletes: [{ norm: 'oceam', display: 'oceam' }],
    upserts: [
      { norm: 'ocean', display: 'ocean', score: 60, comment: '' },
      { norm: 'oceam', display: null, score: 0, comment: '' },
    ],
  };
  const { after, before } = roundTrip(raw, writes);
  assert.deepStrictEqual(after, before);
});

test('applyEditsWriteSet: inverse round-trips a copy-down create back to the start', () => {
  const raw = [];
  const writes = {
    upserts: [
      { norm: 'theirs', display: 'the IRS', score: 90, comment: '' },
      { norm: 'theirs', display: null, score: 30, comment: 'pron' },
    ],
  };
  const { after, before } = roundTrip(raw, writes);
  assert.deepStrictEqual(after, before);
});
