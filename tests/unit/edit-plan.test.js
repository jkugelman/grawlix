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
  assert.deepStrictEqual(p.upserts, [{ norm: 'banana', display: null, score: 60, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('create: a foreign-only match does NOT block — adding it to My Edits is legitimate', () => {
  const sources = [edits(), src('XWI', [wlEntry('ocean', 30)])];   // XWI bare ocean, not in My Edits
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('ocean'), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: null, score: 50, comment: '' }]);
});

test('create: an exact (norm, displayOf) match in My Edits blocks', () => {
  const sources = [edits([wlEntry('ocean', 30)]), src('XWI', [wlEntry('apple', 30)])];   // My Edits bare ocean
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('ocean'), sources });
  assert.equal(p.blockedReason, 'exists');
  assert.deepStrictEqual(p.upserts, []);
});

test('create: a My Edits norm match with a different display does NOT block', () => {
  const sources = [edits([wlEntry('ocean', 30, { display: 'Ocean' })])];   // My Edits "Ocean"
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('ocean'), sources });   // typing "ocean"
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: null, score: 50, comment: '' }]);
});

test('create: rich over a foreign bare copies the bare down (snapshotting its score)', () => {
  const sources = [edits(), src('XWI', [wlEntry('theirs', 30, { comment: 'pron' })])];   // bare
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('the IRS', 90), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'theirs', display: 'the IRS', score: 90, comment: '' },
    { norm: 'theirs', display: null, score: 30, comment: 'pron' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'keep-bare', norm: 'theirs', display: null, score: 30, comment: 'pron' }]);
});

test('create: rich over a foreign bare does NOT copy the bare when a foreign rich already hides it', () => {
  const sources = [
    edits(),
    src('Nediger', [wlEntry('secondstomach', 60, { display: 'second stomach' })]),
    src('Broda', [wlEntry('secondstomach', 20)]),   // bare, already hidden under Nediger's spelling
  ];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('second stomach', 60), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [{ norm: 'secondstomach', display: 'second stomach', score: 60, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('create: rich over a foreign bare does NOT copy when My Edits already has the norm', () => {
  const sources = [edits([wlEntry('theirs', 70, { display: 'Theirs' })]), src('XWI', [wlEntry('theirs', 30)])];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('the IRS', 90), sources });
  assert.deepStrictEqual(p.upserts, [{ norm: 'theirs', display: 'the IRS', score: 90, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('create: plain over a foreign rich copies the spelling up (keep-rich)', () => {
  const sources = [edits(), src('XWI', [wlEntry('theirs', 30, { display: 'the IRS' })])];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('theirs'), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'theirs', display: null, score: 50, comment: '' },
    { norm: 'theirs', display: 'the IRS', score: 30, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'keep-rich', norm: 'theirs', display: 'the IRS', score: 30, comment: '' }]);
});

test('create: keep-rich snapshots the displayed score — a higher bare wins the spelling', () => {
  const sources = [
    edits(),
    src('JK', [wlEntry('pdfs', 30)]),                          // bare, top of the foreign stack
    src('Nediger', [wlEntry('pdfs', 50, { display: 'PDFs' })]),
  ];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('pdfs', 20), sources });
  // The displayed `PDFs` row is won by JK's bare (30), not Nediger's spelling (50).
  assert.deepStrictEqual(p.upserts, [
    { norm: 'pdfs', display: null, score: 20, comment: '' },
    { norm: 'pdfs', display: 'PDFs', score: 30, comment: '' },
  ]);
});

test('create: keep-rich does NOT copy when My Edits already has the norm', () => {
  const sources = [edits([wlEntry('theirs', 70)]), src('XWI', [wlEntry('theirs', 30, { display: 'the IRS' })])];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('Theirs', 80), sources });
  assert.deepStrictEqual(p.upserts, [{ norm: 'theirs', display: 'Theirs', score: 80, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('create: a typed bare over a hidden bare rescores it and splits out the shown spelling', () => {
  const sources = [
    edits([wlEntry('pgs', 20)]),                              // My Edits bare pgs, shown as PGs
    src('Nediger', [wlEntry('pgs', 50, { display: 'PGs' })]),
  ];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('pgs', 30, 'Pages'), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'pgs', display: null, score: 30, comment: 'Pages' },
    { norm: 'pgs', display: 'PGs', score: 20, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'keep-rich', norm: 'pgs', display: 'PGs', score: 20, comment: '' }]);
});

test('create: a typed bare still blocks when nothing hides the existing bare', () => {
  const sources = [edits([wlEntry('pgs', 20)])];   // bare pgs shows as pgs — no foreign spelling
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('pgs', 30), sources });
  assert.equal(p.blockedReason, 'exists');
});

test('create: a typed bare skips a foreign source\'s concretized bare, keeping the typed score', () => {
  // X holds both a bare and a rich of 'ebay', so its bare concretizes to a
  // display === norm row. Copying that into My Edits would re-bare on reload and
  // overwrite the typed score (30 → 20) via the (norm, displayOf) upsert dedup.
  const sources = [
    edits(),
    src('X', [wlEntry('ebay', 20), wlEntry('ebay', 40, { display: 'eBay' })]),
  ];
  const p = planEntryWrite({ mode: 'create', clicked: null, typed: typed('ebay', 30), sources });
  assert.equal(p.blockedReason, null);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'ebay', display: null, score: 30, comment: '' },
    { norm: 'ebay', display: 'eBay', score: 40, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'keep-rich', norm: 'ebay', display: 'eBay', score: 40, comment: '' }]);
});

// ─── edit / rename ───────────────────────────────────────────────────────────

test('edit: score-only change is an in-place upsert, no delete', () => {
  const sources = [edits([wlEntry('ocean', 50)])];
  const clicked = { norm: 'ocean', display: null, score: 50, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 80), sources });
  assert.deepStrictEqual(p.deletes, []);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: null, score: 80, comment: '' }]);
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
    { norm: 'ocean', display: null, score: 60, comment: '' },
    { norm: 'oceam', display: null, score: 0, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'downscore', norm: 'oceam', display: 'oceam', score: 0 }]);
});

test('edit: renaming a My Edits entry to a new norm junks the foreign norm-mate it leaves behind', () => {
  const sources = [edits([wlEntry('oceam', 60)]), src('XWI', [wlEntry('oceam', 40)])];
  const clicked = { norm: 'oceam', display: null, score: 60, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 60), sources, trashScore: 0 });
  assert.deepStrictEqual(p.deletes, [{ norm: 'oceam', display: 'oceam' }]);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'ocean', display: null, score: 60, comment: '' },
    { norm: 'oceam', display: null, score: 0, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'downscore', norm: 'oceam', display: 'oceam', score: 0 }]);
});

test('edit: renaming with no foreign leftover does not trash', () => {
  const sources = [edits([wlEntry('oceam', 60)])];
  const clicked = { norm: 'oceam', display: null, score: 60, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 60), sources });
  assert.deepStrictEqual(p.deletes, [{ norm: 'oceam', display: 'oceam' }]);
  assert.deepStrictEqual(p.upserts, [{ norm: 'ocean', display: null, score: 60, comment: '' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('edit: the foreign-rename downscore respects a custom trash score', () => {
  const sources = [edits([]), src('XWI', [wlEntry('oceam', 40)])];
  const clicked = { norm: 'oceam', display: null, score: 40, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('ocean', 60), sources, trashScore: 5 });
  assert.deepStrictEqual(p.upserts[1], { norm: 'oceam', display: null, score: 5, comment: '' });
});

test('edit: renaming to a plain norm a foreign list spells richly copies the spelling (keep-rich)', () => {
  const sources = [edits([wlEntry('xyz', 50)]),                            // My Edits bare xyz
                   src('XWI', [wlEntry('pdfs', 50, { display: 'PDFs' })])];
  const clicked = { norm: 'xyz', display: null, score: 50, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('pdfs', 40), sources });
  assert.deepStrictEqual(p.deletes, [{ norm: 'xyz', display: 'xyz' }]);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'pdfs', display: null, score: 40, comment: '' },
    { norm: 'pdfs', display: 'PDFs', score: 50, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'keep-rich', norm: 'pdfs', display: 'PDFs', score: 50, comment: '' }]);
});

test('edit: renaming to a rich form over a foreign bare copies the bare (keep-bare)', () => {
  const sources = [edits([wlEntry('xyz', 50)]),                            // My Edits bare xyz
                   src('XWI', [wlEntry('theirs', 30, { comment: 'pron' })])];   // foreign bare
  const clicked = { norm: 'xyz', display: null, score: 50, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('the IRS', 90), sources });
  assert.deepStrictEqual(p.deletes, [{ norm: 'xyz', display: 'xyz' }]);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'theirs', display: 'the IRS', score: 90, comment: '' },
    { norm: 'theirs', display: null, score: 30, comment: 'pron' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'keep-bare', norm: 'theirs', display: null, score: 30, comment: 'pron' }]);
});

test('edit: a same-norm enrich does not keep-copy, but junks the foreign sibling it un-unifies', () => {
  const sources = [edits([wlEntry('ocean', 50)]),                          // My Edits bare ocean, shown as OCEAN
                   src('XWI', [wlEntry('ocean', 30, { display: 'OCEAN' })])];
  const clicked = { norm: 'ocean', display: null, score: 50, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('Ocean', 70), sources, trashScore: 0 });
  assert.deepStrictEqual(p.deletes, [{ norm: 'ocean', display: 'ocean' }]);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'ocean', display: 'Ocean', score: 70, comment: '' },
    { norm: 'ocean', display: 'OCEAN', score: 0, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'downscore', norm: 'ocean', display: 'OCEAN', score: 0 }]);
});

test('edit: respelling a My Edits bare junks a foreign rich sibling but leaves foreign bares alone', () => {
  // My Edits bare standupguy is shown via Nediger's spelling "standup guy"; renaming to
  // "stand-up guy" must junk "standup guy" or it lingers beside the new spelling.
  const sources = [
    edits([wlEntry('standupguy', 60)]),                                    // My Edits bare
    src('Nediger', [wlEntry('standupguy', 60, { display: 'standup guy' })]),
    src('XWI', [wlEntry('standupguy', 50)]),                              // bare
    src('Broda', [wlEntry('standupguy', 20)]),                           // bare
  ];
  const clicked = { norm: 'standupguy', display: null, score: 60, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('stand-up guy', 60), sources, trashScore: 0 });
  assert.deepStrictEqual(p.deletes, [{ norm: 'standupguy', display: 'standupguy' }]);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'standupguy', display: 'stand-up guy', score: 60, comment: '' },
    { norm: 'standupguy', display: 'standup guy', score: 0, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'downscore', norm: 'standupguy', display: 'standup guy', score: 0 }]);
});

test('edit: respelling a foreign BARE entry within its norm (case/spacing) does NOT downscore — it enriches', () => {
  const sources = [edits([]), src('Broda', [wlEntry('gabrielknight', 20)])];   // foreign bare
  const clicked = { norm: 'gabrielknight', display: null, score: 20, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('Gabriel Knight', 50, 'Sierra series'), sources, trashScore: 0 });
  assert.deepStrictEqual(p.upserts, [{ norm: 'gabrielknight', display: 'Gabriel Knight', score: 50, comment: 'Sierra series' }]);
  assert.deepStrictEqual(p.notes, []);
});

test('edit: respelling a foreign entry within its norm (adding an accent) trashes the old spelling only', () => {
  const sources = [edits([]), src('Nediger', [wlEntry('reneerapp', 50, { display: 'Renee Rapp' })])];
  const clicked = { norm: 'reneerapp', display: 'Renee Rapp', score: 50, comment: '' };
  const p = planEntryWrite({ mode: 'edit', clicked, typed: typed('Reneé Rapp', 50, 'Singer/actress'), sources, trashScore: 0 });
  assert.deepStrictEqual(p.deletes, [{ norm: 'reneerapp', display: 'Renee Rapp' }]);
  assert.deepStrictEqual(p.upserts, [
    { norm: 'reneerapp', display: 'Reneé Rapp', score: 50, comment: 'Singer/actress' },
    { norm: 'reneerapp', display: 'Renee Rapp', score: 0, comment: '' },
  ]);
  assert.deepStrictEqual(p.notes, [{ kind: 'downscore', norm: 'reneerapp', display: 'Renee Rapp', score: 0 }]);
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

test('applyEditsWriteSet: inverse round-trips a keep-bare create back to the start', () => {
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

test('applyEditsWriteSet: inverse round-trips a keep-rich create back to the start', () => {
  const raw = [];
  const writes = {
    upserts: [
      { norm: 'theirs', display: 'theirs', score: 50, comment: '' },
      { norm: 'theirs', display: 'the IRS', score: 30, comment: '' },
    ],
  };
  const { after, before } = roundTrip(raw, writes);
  assert.deepStrictEqual(after, before);
});
