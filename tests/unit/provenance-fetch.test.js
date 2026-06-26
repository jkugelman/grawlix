import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus, isDistinguishing, concreteDisplay } from '../../site/src/engine/corpus.js';
import { compileRescoreRules, getRescoredByNorm, groupEntries } from '../../site/src/engine/rescore.js';
import { toNorm, displayOf } from '../../site/src/engine/norm.js';

// handleFetchProvenance isn't importable (worker.js module scope), so this
// transcribes it (workerFetchProvenance) and pins it against an independent local
// reference — keep the two in lockstep rather than collapsing the duplication.

const wlEntry = (norm, score, { display = null, comment = '' } = {}) =>
  ({ norm, display, score, comment });
const src = (name, rawEntries, { enabled = true } = {}) =>
  ({ name, dbKey: 'db_' + name, enabled, rescoreRules: [], rawEntries });

function fixtureSources() {
  // Hi (highest priority) and Lo overlap on OCEAN; Off is disabled (must still
  // appear in provenance). On THEIRS, 'Rich' spells the norm two ways *and* holds
  // its own bare row, while 'Plain' carries only a bare row — a click scopes to
  // the clicked spelling; the other spellings ride the panel's Related entries.
  // Edits stands in for My Edits.
  const Hi  = src('Hi',  [wlEntry('ocean', 90, { comment: 'big' })]);
  const Lo  = src('Lo',  [wlEntry('ocean', 60, { comment: 'small' })]);
  const Off = src('Off', [wlEntry('ocean', 50, { comment: 'off' })], { enabled: false });
  const Rich = src('Rich', [
    wlEntry('theirs', 90, { display: 'the IRS' }),
    wlEntry('theirs', 80, { display: 'Theirs' }),
    wlEntry('theirs', 70),                              // bare display (null)
  ]);
  const Plain = src('Plain', [wlEntry('theirs', 65)]);  // cross-source bare
  const Edits = src('My Edits', [wlEntry('bagel', 42, { comment: 'mine' })]);
  const sources = [Hi, Lo, Off, Rich, Plain, Edits];
  for (const s of sources) compileRescoreRules(s);
  return sources;
}

// Provenance scopes to one spelling, mirroring corpus.js mergedContributors: a
// bare entry (null concrete display) unifies with any spelling, a concrete one
// must match. A null targetDisplay (the typed case) scopes to the whole norm.
const displayEligible = (d, targetDisplay) =>
  targetDisplay == null || d == null || d === targetDisplay;

// ── main-thread reference (entries-table.js) ──────────────────────────────────

function localGatherProvenance(sources, norm, targetDisplay) {
  const rows = [];
  for (const wl of sources) {
    const group = getRescoredByNorm(wl).get(norm);
    if (group === undefined) continue;
    const entries = groupEntries(group);
    const distinguishing = isDistinguishing(entries);
    for (const e of entries) {
      if (!displayEligible(concreteDisplay(e, norm, distinguishing), targetDisplay)) continue;
      rows.push({ wordlist: wl, entry: e });
    }
  }
  return rows;
}
const localPreview = (merged, raw) =>
  raw && raw.trim() ? (merged.byNorm.get(toNorm(raw)) || null) : null;

// provenanceTarget(): preview for typed text, else typed norm, else clicked. The
// display scopes to the clicked spelling (displayOf, so a bare click takes the
// norm spelling), or null (whole norm) while typing.
function localProvTarget(merged, typedRaw, clicked) {
  const preview = localPreview(merged, typedRaw);
  const norm = preview ? preview.norm
    : typedRaw && typedRaw.trim() ? toNorm(typedRaw)
    : clicked.norm;
  const display = typedRaw && typedRaw.trim() ? null : displayOf(clicked);
  return { norm, display };
}

// ── worker projection (worker.js handleFetchProvenance) ───────────────────────

function workerFetchProvenance(ownedBuilt, ownedMerged, { typedRaw, previewRaw, clickedNorm, clickedDisplay }) {
  const previewSrc = previewRaw ?? typedRaw;
  const preview = previewSrc && previewSrc.trim()
    ? (ownedMerged.byNorm.get(toNorm(previewSrc)) || null)
    : null;
  const provPreview = typedRaw && typedRaw.trim()
    ? (ownedMerged.byNorm.get(toNorm(typedRaw)) || null)
    : null;
  const targetNorm = provPreview ? provPreview.norm
    : typedRaw && typedRaw.trim() ? toNorm(typedRaw)
    : clickedNorm;
  const targetDisplay = typedRaw && typedRaw.trim() ? null : clickedDisplay ?? null;

  const rows = [];
  if (targetNorm != null) {
    for (const wl of ownedBuilt) {
      const group = getRescoredByNorm(wl).get(targetNorm);
      if (group === undefined) continue;
      const entries = groupEntries(group);
      const distinguishing = isDistinguishing(entries);
      for (const e of entries) {
        if (!displayEligible(concreteDisplay(e, targetNorm, distinguishing), targetDisplay)) continue;
        rows.push({
          sourceId: wl.dbKey, enabled: wl.enabled !== false,
          entry: { norm: e.norm, display: e.display ?? null, score: e.score, rawScore: e.rawScore, comment: e.comment || '' },
        });
      }
    }
  }
  const previewOut = preview && {
    norm: preview.norm, display: preview.display ?? null,
    score: preview.score, comment: preview.comment || '', sourceId: preview.wordlist.dbKey,
  };
  return { preview: previewOut ?? null, rows };
}

// Normalize the local pair to the worker wire shape so the two are deep-equalled.
function localToWire(localRows, localPrev) {
  return {
    preview: localPrev && {
      norm: localPrev.norm, display: localPrev.display ?? null,
      score: localPrev.score, comment: localPrev.comment || '', sourceId: localPrev.wordlist.dbKey,
    } || null,
    rows: localRows.map(({ wordlist, entry }) => ({
      sourceId: wordlist.dbKey, enabled: wordlist.enabled !== false,
      entry: { norm: entry.norm, display: entry.display ?? null, score: entry.score, rawScore: entry.rawScore, comment: entry.comment || '' },
    })),
  };
}

// ownedMerged mirrors the enabled-only merge; ownedBuilt is every source.
function rigs() {
  const sources = fixtureSources();
  const ownedBuilt = sources;
  const ownedMerged = buildCorpus(sources.filter(s => s.enabled));
  return { sources, ownedBuilt, ownedMerged };
}

function runFetch(rig, { typedRaw, previewRaw, clicked }) {
  const { sources, ownedBuilt, ownedMerged } = rig;
  const target = localProvTarget(ownedMerged, typedRaw, clicked);
  const localPrev = localPreview(ownedMerged, previewRaw);
  const localRows = localGatherProvenance(sources, target.norm, target.display);
  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm, clickedDisplay: displayOf(clicked),
  });
  // Worker projection and the independent reference must agree, every case.
  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  return worker;
}

test('per-keystroke: typed OCEAN — preview is the Hi winner, provenance spans Hi+Lo+disabled Off', () => {
  const worker = runFetch(rigs(), {
    typedRaw: 'ocean', previewRaw: 'ocean', clicked: { norm: 'ocean', display: null },
  });
  // Typing scopes to the whole norm: the disabled Off source is present, Hi wins.
  assert.equal(worker.preview.sourceId, 'db_Hi');
  assert.deepStrictEqual(worker.rows.map(r => [r.sourceId, r.enabled]),
    [['db_Hi', true], ['db_Lo', true], ['db_Off', false]]);
});

test('initial open of a spelled variant (the IRS): provenance scopes to that spelling + the cross-source bare', () => {
  // Open-time: previewRaw = seed.entry, typedRaw = '' (so provTarget = clicked).
  const worker = runFetch(rigs(), {
    typedRaw: '', previewRaw: 'the IRS', clicked: { norm: 'theirs', display: 'the IRS' },
  });
  // Only Rich's 'the IRS' row and Plain's bare row (a bare unifies with any
  // spelling); 'Theirs' and Rich's own bare ride Related entries instead.
  assert.deepStrictEqual(worker.rows.map(r => [r.sourceId, r.entry.display]),
    [['db_Rich', 'the IRS'], ['db_Plain', null]]);
});

test('initial open of the bare/norm spelling: provenance scopes to the bare rows, not the spelled variants', () => {
  const worker = runFetch(rigs(), {
    typedRaw: '', previewRaw: 'theirs', clicked: { norm: 'theirs', display: null },
  });
  // A bare click takes the norm spelling: Rich's concretized-bare row and Plain's
  // bare row, each rendered from its stored null display. 'the IRS' / 'Theirs' go
  // to Related entries.
  assert.deepStrictEqual(worker.rows.map(r => [r.sourceId, r.entry.display]),
    [['db_Rich', null], ['db_Plain', null]]);
});

test('My Edits norm: provenance carries the edits source row, preview wins from it', () => {
  const worker = runFetch(rigs(), {
    typedRaw: 'bagel', previewRaw: 'bagel', clicked: { norm: 'bagel', display: null },
  });
  assert.equal(worker.preview.sourceId, 'db_My Edits');
  assert.deepStrictEqual(worker.rows.map(r => r.sourceId), ['db_My Edits']);
});

test('a norm absent from every source: empty rows, null preview', () => {
  const worker = runFetch(rigs(), {
    typedRaw: 'zzzznope', previewRaw: 'zzzznope', clicked: { norm: 'zzzznope', display: null },
  });
  assert.deepStrictEqual(worker, { preview: null, rows: [] });
});
