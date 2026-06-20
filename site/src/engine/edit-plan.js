'use strict';

// ─── Entry-edit planner ───────────────────────────────────────────────────────
//
// Shared by the save (app/actions.js) and the live preview (ui/entries-table.js).
// The worker applies this write-set verbatim and never re-plans, so main's merge
// view alone decides an edit — re-deriving worker-side would silently diverge.

import { toNorm, displayOf, buildWlEntry, detectCase } from './norm.js';
import { getRescoredByNorm } from './rescore.js';
import { computeMergedBucket } from './corpus.js';

const isEdits = wl => wl.type === 'edits';
const isLive = wl => wl.enabled !== false;
const editsOf = sources => sources.find(isEdits) || null;

// My Edits' detected case, cached on the rawEntries array identity — bulk replaces
// (import, load, disk-sync) swap the array so the cache refreshes; in-place edits
// keep it, and one typed entry can't move the ratio, so skipping that refresh is safe.
function editsFileCase(edits) {
  if (!edits) return 'lower';
  const raw = edits.rawEntries;
  if (edits._fileCaseFor !== raw) {
    edits._fileCase = detectCase(raw.map(e => ({ raw: displayOf(e) })));
    edits._fileCaseFor = raw;
  }
  return edits._fileCase;
}

// Decide bare-vs-rich the way the worker's re-parse will, not by keeping the
// literal: a kept literal diverges silently and re-bares on the next reload.
function typedDisplay(raw, edits) {
  return buildWlEntry(raw, 0, '', editsFileCase(edits)).display;
}

// Non-edits only: gating on a My Edits sibling would trash the user's own
// deliberate variant during the downscore.
function foreignHasNorm(sources, norm) {
  return sources.some(wl => isLive(wl) && !isEdits(wl) && getRescoredByNorm(wl).has(norm));
}

function foreignBare(sources, norm) {
  for (const wl of sources) {
    if (!isLive(wl) || isEdits(wl)) continue;
    const arr = getRescoredByNorm(wl).get(norm);
    const bare = arr && arr.find(e => e.display == null);
    if (bare) return bare;
  }
  return null;
}

// Shared by create and rename so the two gestures stay symmetric: a typed entry
// that would hide under (or absorb) a foreign spelling of its norm copies the other
// form in. A My Edits sibling already at this norm is distinguishing — no copy.
function keepCopies(newNorm, newDisplay, sources, edits, upserts, notes) {
  const editsRows = edits ? (getRescoredByNorm(edits).get(newNorm) || []) : [];
  if (newDisplay != null) {
    // keep-bare: else the typed rich absorbs a foreign bare and hides it.
    if (editsRows.length === 0) {
      const bare = foreignBare(sources, newNorm);
      if (bare) {
        upserts.push({ norm: newNorm, display: null, score: bare.score, comment: bare.comment || '' });
        notes.push({ kind: 'keep-bare', norm: newNorm, display: null, score: bare.score, comment: bare.comment || '' });
      }
    }
    return;
  }
  if (editsRows.some(r => r.display && r.display !== newNorm)) return;
  // keep-rich: the typed bare folds into a foreign spelling; copy each shown one at
  // the displayed winner's score (a bare can win a spelling — not the speller's score).
  for (const r of computeMergedBucket(newNorm, sources).rows) {
    // Skip a row the bare primary already renders: copying its display === norm
    // would re-bare on reload and clobber the typed score via the upsert dedup.
    if (r.display == null || r.display === newNorm) continue;
    upserts.push({ norm: newNorm, display: r.display, score: r.score, comment: r.comment || '' });
    notes.push({ kind: 'keep-rich', norm: newNorm, display: r.display, score: r.score, comment: r.comment || '' });
  }
}

export function planEntryWrite({ mode, clicked, typed, sources, trashScore = 0 }) {
  const newNorm = toNorm(typed.raw);
  const edits = editsOf(sources);
  const newDisplay = typedDisplay(typed.raw, edits);
  const newRendered = newDisplay ?? newNorm;
  const score = typed.score;
  const comment = typed.comment ?? '';
  const primary = { norm: newNorm, display: newDisplay };
  const deletes = [];
  const upserts = [];
  const notes = [];

  if (mode === 'create') {
    const shown = computeMergedBucket(newNorm, sources).rows;
    // Block only a spelling My Edits already SHOWS. A bare hidden under a foreign
    // spelling shows as that spelling, so typing the bare splits it out via keepCopies.
    if (shown.some(r => r.wordlist === edits && displayOf(r) === newRendered)) {
      return { blockedReason: 'exists', primary, deletes, upserts, notes };
    }
    // Rescores an existing hidden bare (matched by displayOf), else adds fresh.
    upserts.push({ norm: newNorm, display: newDisplay, score, comment });
    keepCopies(newNorm, newDisplay, sources, edits, upserts, notes);
    return { blockedReason: null, primary, deletes, upserts, notes };
  }

  const origNorm = clicked.norm;
  const origDisplay = clicked.display ?? clicked.norm;
  if (newNorm !== origNorm || newRendered !== origDisplay) {
    deletes.push({ norm: origNorm, display: origDisplay });
  }
  upserts.push({ norm: newNorm, display: newDisplay, score, comment });
  // A rename to a new norm lands like a fresh create there — keep it distinguishing
  // against any foreign spelling of that norm, exactly as create does.
  if (newNorm !== origNorm) keepCopies(newNorm, newDisplay, sources, edits, upserts, notes);
  // Downscore only a foreign original (not in My Edits) — renaming your own entry
  // just deletes it. The bare null wildcard trashes every spelling of the old norm.
  const origInEdits = !!edits && (getRescoredByNorm(edits).get(origNorm) || []).some(e => displayOf(e) === origDisplay);
  if (newNorm !== origNorm && !origInEdits && foreignHasNorm(sources, origNorm)) {
    upserts.push({ norm: origNorm, display: null, score: trashScore, comment: '' });
    notes.push({ kind: 'downscore', norm: origNorm, display: origDisplay, score: trashScore });
  }
  return { blockedReason: null, primary, deletes, upserts, notes };
}

export function applyEditsWriteSet(rawEntries, { deletes = [], upserts = [] }) {
  const invDeletes = [];
  const invUpserts = [];
  // Deletes before upserts: a rename's delete must not shadow its own upsert.
  for (const d of deletes) {
    const idx = rawEntries.findIndex(e => e.norm === d.norm && displayOf(e) === d.display);
    if (idx < 0) continue;
    const [removed] = rawEntries.splice(idx, 1);
    invUpserts.push({ norm: removed.norm, display: removed.display ?? null, score: removed.score, comment: removed.comment ?? '' });
  }
  for (const u of upserts) {
    const uDisplay = displayOf(u);
    const existing = rawEntries.find(e => e.norm === u.norm && displayOf(e) === uDisplay);
    if (existing) {
      invUpserts.push({ norm: existing.norm, display: existing.display ?? null, score: existing.score, comment: existing.comment ?? '' });
      existing.score = u.score;
      existing.comment = u.comment ?? '';
    } else {
      rawEntries.push({ norm: u.norm, display: u.display ?? null, score: u.score, comment: u.comment ?? '' });
      invDeletes.push({ norm: u.norm, display: uDisplay });
    }
  }
  return { deletes: invDeletes, upserts: invUpserts };
}
