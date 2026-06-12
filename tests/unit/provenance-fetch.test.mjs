import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus } from '../../site/src/engine/corpus.js';
import { compileRescoreRules, getRescoredByNorm } from '../../site/src/engine/rescore.js';
import { displayOf, toNorm } from '../../site/src/engine/norm.js';

// The worker's handleFetchProvenance reproduces main's previewWlEntry +
// provenanceTarget + gatherProvenance off ownedMerged / ownedBuilt. handleFetch-
// Provenance lives in worker.js module scope (not importable), so this pins the
// shared pure logic both sides run — the local (main) computation vs the worker's
// projection — and asserts they deep-equal across the fidelity-critical quirks:
// the bare-display include asymmetry, disabled-source inclusion, the provTarget
// derivation (preview → typed-norm → clicked), and a My-Edits source.

const wlEntry = (norm, score, { display = null, comment = '' } = {}) =>
  ({ norm, display, score, comment });
const src = (name, rawEntries, { enabled = true } = {}) =>
  ({ name, dbKey: 'db_' + name, enabled, rescoreRules: [], rawEntries });

function fixtureSources() {
  // Hi (highest priority) and Lo overlap on OCEAN; Off is disabled (must still
  // appear in provenance). 'Rich' carries spelled variants + a bare row of
  // THEIRS — the bare-display quirk. Edits stands in for My Edits.
  const Hi  = src('Hi',  [wlEntry('ocean', 90, { comment: 'big' })]);
  const Lo  = src('Lo',  [wlEntry('ocean', 60, { comment: 'small' })]);
  const Off = src('Off', [wlEntry('ocean', 50, { comment: 'off' })], { enabled: false });
  const Rich = src('Rich', [
    wlEntry('theirs', 90, { display: 'the IRS' }),
    wlEntry('theirs', 80, { display: 'Theirs' }),
    wlEntry('theirs', 70),                              // bare display (null)
  ]);
  const Edits = src('My Edits', [wlEntry('bagel', 42, { comment: 'mine' })]);
  const sources = [Hi, Lo, Off, Rich, Edits];
  for (const s of sources) compileRescoreRules(s);
  return sources;
}

// ── main-thread reference (entries-table.js) ──────────────────────────────────

function localGatherProvenance(sources, norm, display) {
  const rows = [];
  for (const wl of sources) {
    const arr = getRescoredByNorm(wl).get(norm);
    if (!arr) continue;
    for (const e of arr) {
      const include = display == null || e.display === display || e.display == null;
      if (include) rows.push({ wordlist: wl, entry: e });
    }
  }
  return rows;
}
const localPreview = (merged, raw) =>
  raw && raw.trim() ? (merged.byNorm.get(toNorm(raw)) || null) : null;

// provenanceTarget(): preview for typed text, else typed norm (bare), else clicked
function localProvTarget(merged, typedRaw, clicked) {
  const preview = localPreview(merged, typedRaw);
  if (preview) return preview;
  if (typedRaw && typedRaw.trim()) return { norm: toNorm(typedRaw), display: null };
  return clicked;
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
  const target = provPreview ?? (typedRaw && typedRaw.trim()
    ? { norm: toNorm(typedRaw), display: null }
    : { norm: clickedNorm, display: clickedDisplay ?? null });

  const rows = [];
  if (target.norm != null) {
    const display = target.display;
    for (const wl of ownedBuilt) {
      const arr = getRescoredByNorm(wl).get(target.norm);
      if (!arr) continue;
      for (const e of arr) {
        const include = display == null || e.display === display || e.display == null;
        if (include) rows.push({
          sourceId: wl.dbKey, enabled: wl.enabled !== false,
          entry: { norm: e.norm, display: e.display ?? null, score: e.score, comment: e.comment || '' },
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
      entry: { norm: entry.norm, display: entry.display ?? null, score: entry.score, comment: entry.comment || '' },
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

test('per-keystroke: typed OCEAN — preview is the Hi winner, provenance spans Hi+Lo+disabled Off', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  const typedRaw = 'ocean', previewRaw = 'ocean';
  const clicked = { norm: 'ocean', display: null };

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);
  const localRows = localGatherProvenance(sources, target.norm, target.display);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm, clickedDisplay: clicked.display,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  // Sanity: the disabled Off source is present, Hi wins the preview.
  assert.equal(worker.preview.sourceId, 'db_Hi');
  assert.deepStrictEqual(worker.rows.map(r => [r.sourceId, r.enabled]),
    [['db_Hi', true], ['db_Lo', true], ['db_Off', false]]);
});

test('initial open of a spelled variant: typedRaw "" → provTarget falls to the clicked atom (the IRS), bare quirk applies', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  // Open-time: previewRaw = seed.entry, typedRaw = '' (so provTarget = clicked).
  const clicked = { norm: 'theirs', display: 'the IRS' };
  const previewRaw = 'the IRS', typedRaw = '';

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);   // = clicked
  const localRows = localGatherProvenance(sources, target.norm, target.display);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm, clickedDisplay: clicked.display,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  // A spelled click pulls in that spelling + the bare row, NOT the sibling 'Theirs'.
  assert.deepStrictEqual(worker.rows.map(r => r.entry.display), ['the IRS', null]);
});

test('initial open of a bare click: provTarget is the bare norm → every spelling included', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  const clicked = { norm: 'theirs', display: null };
  const previewRaw = 'theirs', typedRaw = '';

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);
  const localRows = localGatherProvenance(sources, target.norm, target.display);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm, clickedDisplay: clicked.display,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  assert.deepStrictEqual(worker.rows.map(r => r.entry.display), ['the IRS', 'Theirs', null]);
});

test('My Edits norm: provenance carries the edits source row, preview wins from it', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  const typedRaw = 'bagel', previewRaw = 'bagel';
  const clicked = { norm: 'bagel', display: null };

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);
  const localRows = localGatherProvenance(sources, target.norm, target.display);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm, clickedDisplay: clicked.display,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  assert.equal(worker.preview.sourceId, 'db_My Edits');
  assert.deepStrictEqual(worker.rows.map(r => r.sourceId), ['db_My Edits']);
});

test('a norm absent from every source: empty rows, null preview', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  const typedRaw = 'zzzznope', previewRaw = 'zzzznope';
  const clicked = { norm: 'zzzznope', display: null };

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);
  const localRows = localGatherProvenance(sources, target.norm, target.display);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm, clickedDisplay: clicked.display,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  assert.deepStrictEqual(worker, { preview: null, rows: [] });
});
