'use strict';

// ─── Flat-row highlight materialization ──────────────────────────────────────

import { normalizeParams } from './tools.js';
import { displayOf } from './norm.js';
import { collapseRepeatAtoms } from './executor.js';
import { activeFlatColumn } from './sort.js';

// ─── Flat-tier highlight re-derivation ──────────────────────────────────────
// The flat result ships no highlights; the visible window re-derives them by
// replaying each active highlighting filter. This and materializeFlatRow must
// reproduce the executor's runToolStage + collapseRepeatAtoms exactly — any
// divergence is a silent visual bug (wrong marks, or an atom count that mismatches
// the row's reserved line height). A flat chain has no transforms, so the only
// highlighters are its highlighting filters.
export function compileFlatHighlighters(stack, ctx) {
  const out = [];
  for (const row of stack) {
    const { def } = row;
    if (row.isInert() || row.kind() !== 'filter' || !row.inputHi() || row.inverted()) continue;
    const coord = def.matchOn === 'display' ? 'display' : 'norm';
    out.push({ def, prepared: preparedSync(row, ctx), coord });
  }
  return out;
}

// Sync only — the render path can't await, and an async prepare would silently
// ship a Promise as `prepared`. A filter whose prepare awaits or reads ctx
// declares a sync `replay(params, ctx)` that rebuilds the same value.
function preparedSync(row, ctx) {
  const { def } = row;
  const params = normalizeParams(row.params, def.params);
  return def.replay ? def.replay(params, ctx)
    : def.prepare ? def.prepare(params, {}) : params;
}

function runInput(def, wlEntry) {
  return def.matchOn === 'both' ? wlEntry
    : def.matchOn === 'display' ? displayOf(wlEntry)
    : wlEntry.norm;
}

export function compileFlatColumn(stack, ctx) {
  const col = activeFlatColumn(stack);
  if (!col) return null;
  const { def } = col.row;
  const prepared = preparedSync(col.row, ctx);
  return {
    key: col.key,
    value: e => col.value(runInput(def, e), prepared),
    order: e => col.order(runInput(def, e), prepared),
  };
}

function tagCoord(ranges, coord) {
  return ranges.map(r => r.coord ? r : { ...r, coord });
}

export function materializeFlatRow(wlEntry, highlighters) {
  const atoms = [{ wlEntry, highlights: null, glyph: null }];
  for (const { def, prepared, coord } of highlighters) {
    const result = def.run(runInput(def, wlEntry), prepared, null);
    const highlights = Array.isArray(result) ? tagCoord(result, coord) : [];
    atoms.push({ wlEntry, highlights, glyph: null });
  }
  return { atoms: collapseRepeatAtoms(atoms) };
}
