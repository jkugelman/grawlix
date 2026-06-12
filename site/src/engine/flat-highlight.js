'use strict';

// ─── Flat-row highlight materialization ──────────────────────────────────────

import { normalizeParams } from './tools.js';
import { displayOf } from './norm.js';
import { collapseRepeatAtoms } from './executor.js';

// ─── Flat-tier highlight re-derivation ──────────────────────────────────────
// The flat result ships no highlights; the visible window re-derives them by
// replaying each active highlighting filter. This and materializeFlatRow must
// reproduce the executor's runToolStage + collapseRepeatAtoms exactly — any
// divergence is a silent visual bug (wrong marks, or an atom count that mismatches
// the row's reserved line height). A flat chain has no transforms, so the only
// highlighting filters are Search/Regex in filter mode.
export function compileFlatHighlighters(stack) {
  const out = [];
  for (const row of stack) {
    const { def } = row;
    if (row.isInert() || row.kind() !== 'filter' || !def.inputHighlights) continue;
    const params = normalizeParams(row.params, def.params);
    // Sync prepare only — the render path can't await; Search/Regex prepare is
    // sync and ignores ctx, so a future async-prepare highlighting filter would
    // silently ship a Promise as `prepared` here.
    const prepared = def.prepare ? def.prepare(params, {}) : params;
    const coord = def.matchOn === 'display' ? 'display' : 'norm';
    out.push({ def, prepared, coord });
  }
  return out;
}

function tagCoord(ranges, coord) {
  return ranges.map(r => r.coord ? r : { ...r, coord });
}

export function materializeFlatRow(wlEntry, highlighters) {
  const atoms = [{ wlEntry, highlights: null, glyph: null }];
  for (const { def, prepared, coord } of highlighters) {
    const input = def.matchOn === 'both' ? wlEntry
      : def.matchOn === 'display' ? displayOf(wlEntry)
      : wlEntry.norm;
    const result = def.run(input, prepared, null);
    const highlights = Array.isArray(result) ? tagCoord(result, coord) : [];
    atoms.push({ wlEntry, highlights, glyph: null });
  }
  return { atoms: collapseRepeatAtoms(atoms) };
}
