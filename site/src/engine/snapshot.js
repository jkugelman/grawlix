// ─── Canonical merged-row selection ──────────────────────────────────────────
//
// The two functions that decide which row is a norm's canonical merged entry,
// shared by main's merge build and the worker's owned-corpus splice so the two
// can never disagree on case variants.

// Maps a norm to the merged entry tools treat as its canonical row.
//
// The selection — first variant in the bucket's `[...displays].sort()` order —
// is NOT the entries array's first row for the norm: `entries` is sorted by
// `display.localeCompare`, which disagrees with code-unit order on case
// ('Cat' < 'CAT' under localeCompare, 'CAT' < 'Cat' under code units). Picking
// the array-first row would silently choose the wrong canonical entry for
// case-variant norms. Per norm, `entries` holds either one `display: null` row
// or all-non-null rows (resolveCorpus drops the null variant once any display
// exists), so the code-unit minimum is recoverable from `entries` alone.
export function buildByNorm(entries) {
  const byNorm = new Map();
  for (const row of entries) {
    const cur = byNorm.get(row.norm);
    if (!cur || (row.display ?? '') < (cur.display ?? '')) byNorm.set(row.norm, row);
  }
  return byNorm;
}

// One norm's canonical row. MUST match buildByNorm's rule (code-unit-min
// display): the worker's owned-corpus splice routes through here, so a divergent
// rule silently disagrees on case variants ('CAT' vs 'Cat').
export function canonicalNormRow(rows) {
  let best = null;
  for (const row of rows) {
    if (!best || (row.display ?? '') < (best.display ?? '')) best = row;
  }
  return best;
}
