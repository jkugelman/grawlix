'use strict';

// ─── My Edits 3-way merge ─────────────────────────────────────────────────────

import { displayOf } from './norm.js';
import { mergeKey } from './corpus.js';

// Keyed by (norm, displayOf): same-norm siblings (theirs / the IRS) are distinct
// entries, so keying by norm alone would silently drop one on a disk sync.
function editsEntriesByKey(entries) {
  const m = new Map();
  for (const e of entries) m.set(mergeKey(e.norm, displayOf(e)), e);
  return m;
}
function editsEntryEqual(a, b) {
  if (!a || !b) return !a && !b;
  return a.score === b.score
    && (a.comment || '') === (b.comment || '')
    && (a.display ?? a.norm) === (b.display ?? b.norm);
}

// Conflicting norms default to the IDB/device side in `resolved`; the dialog's
// "keep the file" choice swaps them. One-sided changes are already applied here.
function threeWayMergeEdits(base, file, idb) {
  const bMap = editsEntriesByKey(base), fMap = editsEntriesByKey(file), iMap = editsEntriesByKey(idb);
  const resolved = new Map();
  const conflicts = [];
  for (const key of new Set([...bMap.keys(), ...fMap.keys(), ...iMap.keys()])) {
    const b = bMap.get(key) || null, f = fMap.get(key) || null, i = iMap.get(key) || null;
    if (editsEntryEqual(f, i)) { if (f) resolved.set(key, f); continue; }
    const fChanged = !editsEntryEqual(f, b);
    const iChanged = !editsEntryEqual(i, b);
    if (fChanged && !iChanged)      { if (f) resolved.set(key, f); }
    else if (iChanged && !fChanged) { if (i) resolved.set(key, i); }
    else {
      if (i) resolved.set(key, i);
      const ref = i || f || b;
      conflicts.push({ key, norm: ref.norm, display: ref.display ?? null, device: i, file: f });
    }
  }
  return { resolved, conflicts };
}

function sameEditsEntries(a, b) {
  if (a.length !== b.length) return false;
  const am = editsEntriesByKey(a), bm = editsEntriesByKey(b);
  if (am.size !== bm.size) return false;
  for (const [norm, ae] of am) if (!editsEntryEqual(ae, bm.get(norm))) return false;
  return true;
}

export { editsEntriesByKey, editsEntryEqual, threeWayMergeEdits, sameEditsEntries };
