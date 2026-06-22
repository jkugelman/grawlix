import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus } from '../../site/src/engine/corpus.js';
import { compileRescoreRules, getRescoredByNorm } from '../../site/src/engine/rescore.js';
import { toNorm } from '../../site/src/engine/norm.js';

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
  // its own bare row, while 'Plain' carries only a bare row — a click on any of
  // them surfaces all four (the whole norm). Edits stands in for My Edits.
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

// ── main-thread reference (entries-table.js) ──────────────────────────────────

function localGatherProvenance(sources, norm) {
  const rows = [];
  for (const wl of sources) {
    const arr = getRescoredByNorm(wl).get(norm);
    if (!arr) continue;
    for (const e of arr) rows.push({ wordlist: wl, entry: e });
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

function workerFetchProvenance(ownedBuilt, ownedMerged, { typedRaw, previewRaw, clickedNorm }) {
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

  const rows = [];
  if (targetNorm != null) {
    for (const wl of ownedBuilt) {
      const arr = getRescoredByNorm(wl).get(targetNorm);
      if (!arr) continue;
      for (const e of arr) rows.push({
        sourceId: wl.dbKey, enabled: wl.enabled !== false,
        entry: { norm: e.norm, display: e.display ?? null, score: e.score, rawScore: e.rawScore, comment: e.comment || '' },
      });
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

test('per-keystroke: typed OCEAN — preview is the Hi winner, provenance spans Hi+Lo+disabled Off', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  const typedRaw = 'ocean', previewRaw = 'ocean';
  const clicked = { norm: 'ocean', display: null };

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);
  const localRows = localGatherProvenance(sources, target.norm);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  // Sanity: the disabled Off source is present, Hi wins the preview.
  assert.equal(worker.preview.sourceId, 'db_Hi');
  assert.deepStrictEqual(worker.rows.map(r => [r.sourceId, r.enabled]),
    [['db_Hi', true], ['db_Lo', true], ['db_Off', false]]);
});

test('initial open of a spelled variant: typedRaw "" → target norm falls to the clicked atom (the IRS); a spelled click still shows the whole norm', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  // Open-time: previewRaw = seed.entry, typedRaw = '' (so provTarget = clicked).
  const clicked = { norm: 'theirs', display: 'the IRS' };
  const previewRaw = 'the IRS', typedRaw = '';

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);   // = clicked
  const localRows = localGatherProvenance(sources, target.norm);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  assert.deepStrictEqual(worker.rows.map(r => r.entry.display), ['the IRS', 'Theirs', null, null]);
});

test('initial open of a bare click: provTarget is the bare norm → every spelling included', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  const clicked = { norm: 'theirs', display: null };
  const previewRaw = 'theirs', typedRaw = '';

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);
  const localRows = localGatherProvenance(sources, target.norm);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  // A bare click shows the whole norm: both spellings plus both bare rows —
  // Rich's own bare and Plain's — each rendered from its stored null display.
  assert.deepStrictEqual(worker.rows.map(r => r.entry.display), ['the IRS', 'Theirs', null, null]);
});

test('My Edits norm: provenance carries the edits source row, preview wins from it', () => {
  const { sources, ownedBuilt, ownedMerged } = rigs();
  const typedRaw = 'bagel', previewRaw = 'bagel';
  const clicked = { norm: 'bagel', display: null };

  const localPrev = localPreview(ownedMerged, previewRaw);
  const target = localProvTarget(ownedMerged, typedRaw, clicked);
  const localRows = localGatherProvenance(sources, target.norm);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm,
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
  const localRows = localGatherProvenance(sources, target.norm);

  const worker = workerFetchProvenance(ownedBuilt, ownedMerged, {
    typedRaw, previewRaw, clickedNorm: clicked.norm,
  });

  assert.deepStrictEqual(worker, localToWire(localRows, localPrev));
  assert.deepStrictEqual(worker, { preview: null, rows: [] });
});
