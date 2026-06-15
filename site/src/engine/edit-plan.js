'use strict';

// ─── Entry-edit planner ───────────────────────────────────────────────────────
//
// Shared by the save (app/actions.js) and the live preview (ui/entries-table.js).
// The worker applies this write-set verbatim and never re-plans, so main's merge
// view alone decides an edit — re-deriving worker-side would silently diverge.

import { toNorm, displayOf } from './norm.js';
import { getRescoredByNorm } from './rescore.js';
import { computeMergedBucket } from './corpus.js';

const isEdits = wl => wl.type === 'edits';
const isLive = wl => wl.enabled !== false;
const editsOf = sources => sources.find(isEdits) || null;

// Non-edits only: gating on a My Edits sibling would trash the user's own
// deliberate variant during the downscore.
function foreignHasNorm(sources, norm) {
  return sources.some(wl => isLive(wl) && !isEdits(wl) && getRescoredByNorm(wl).has(norm));
}

// A foreign `display: null` bare is the only thing a created rich entry can
// absorb — UI entries always carry a non-null display — so copy-down is one-way.
function foreignBare(sources, norm) {
  for (const wl of sources) {
    if (!isLive(wl) || isEdits(wl)) continue;
    const arr = getRescoredByNorm(wl).get(norm);
    const bare = arr && arr.find(e => e.display == null);
    if (bare) return bare;
  }
  return null;
}

export function planEntryWrite({ mode, clicked, typed, sources, trashScore = 0 }) {
  const newNorm = toNorm(typed.raw);
  const newDisplay = typed.raw;            // literal, non-null — see norm.js buildUserWlEntry
  const score = typed.score;
  const comment = typed.comment ?? '';
  const edits = editsOf(sources);
  const primary = { norm: newNorm, display: newDisplay };
  const deletes = [];
  const upserts = [];
  const notes = [];

  if (mode === 'create') {
    const bucket = computeMergedBucket(newNorm, sources);
    if (bucket.rows.some(r => displayOf(r) === newDisplay)) {
      return { blockedReason: 'exists', primary, deletes, upserts, notes };
    }
    upserts.push({ norm: newNorm, display: newDisplay, score, comment });
    // Without the copy a foreign bare of this norm collapses into the new rich
    // display and silently vanishes; copying it makes My Edits distinguishing.
    const editsCount = edits ? (getRescoredByNorm(edits).get(newNorm)?.length ?? 0) : 0;
    if (newDisplay !== newNorm && editsCount === 0) {
      const bare = foreignBare(sources, newNorm);
      if (bare) {
        upserts.push({ norm: newNorm, display: null, score: bare.score, comment: bare.comment || '' });
        notes.push({ kind: 'keep-bare', norm: newNorm });
      }
    }
    return { blockedReason: null, primary, deletes, upserts, notes };
  }

  const origNorm = clicked.norm;
  const origDisplay = clicked.display ?? clicked.norm;
  if (newNorm !== origNorm || newDisplay !== origDisplay) {
    deletes.push({ norm: origNorm, display: origDisplay });
  }
  upserts.push({ norm: newNorm, display: newDisplay, score, comment });
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
