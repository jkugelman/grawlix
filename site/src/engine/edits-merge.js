'use strict';

// ─── My Edits 3-way merge ─────────────────────────────────────────────────────

function editsEntriesByNorm(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.norm, e);
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
  const bMap = editsEntriesByNorm(base), fMap = editsEntriesByNorm(file), iMap = editsEntriesByNorm(idb);
  const resolved = new Map();
  const conflicts = [];
  for (const norm of new Set([...bMap.keys(), ...fMap.keys(), ...iMap.keys()])) {
    const b = bMap.get(norm) || null, f = fMap.get(norm) || null, i = iMap.get(norm) || null;
    if (editsEntryEqual(f, i)) { if (f) resolved.set(norm, f); continue; }
    const fChanged = !editsEntryEqual(f, b);
    const iChanged = !editsEntryEqual(i, b);
    if (fChanged && !iChanged)      { if (f) resolved.set(norm, f); }
    else if (iChanged && !fChanged) { if (i) resolved.set(norm, i); }
    else { if (i) resolved.set(norm, i); conflicts.push({ norm, device: i, file: f }); }
  }
  return { resolved, conflicts };
}

function sameEditsEntries(a, b) {
  if (a.length !== b.length) return false;
  const am = editsEntriesByNorm(a), bm = editsEntriesByNorm(b);
  if (am.size !== bm.size) return false;
  for (const [norm, ae] of am) if (!editsEntryEqual(ae, bm.get(norm))) return false;
  return true;
}

export { editsEntriesByNorm, editsEntryEqual, threeWayMergeEdits, sameEditsEntries };
