// ─── Columnar merged-corpus snapshot ─────────────────────────────────────────
//
// snapshot.js must not import executor.js: `_initialChains` is left to the
// executor's lazy buildInitialChains (which walks the unpacked `entries`), and
// the import would cycle the engine layer.

// Maps a norm to the merged entry tools treat as its canonical row. Shared by
// resolveCorpus (main) and unpackSnapshot (worker) so the two maps can't drift.
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
// display): main's patch and the worker's reindex both route through here, so a
// divergent rule silently disagrees on case variants ('CAT' vs 'Cat') per thread.
export function canonicalNormRow(rows) {
  let best = null;
  for (const row of rows) {
    if (!best || (row.display ?? '') < (best.display ?? '')) best = row;
  }
  return best;
}

function packStrings(strings) {
  const enc = new TextEncoder();
  const encoded = strings.map(s => enc.encode(s));
  const offsets = new Uint32Array(encoded.length + 1);
  let total = 0;
  for (let i = 0; i < encoded.length; i++) {
    offsets[i] = total;
    total += encoded[i].length;
  }
  offsets[encoded.length] = total;
  const bytes = new Uint8Array(total);
  for (let i = 0; i < encoded.length; i++) bytes.set(encoded[i], offsets[i]);
  return { bytes: bytes.buffer, offsets: offsets.buffer };
}

function decodeStrings({ bytes, offsets }, count) {
  const dec = new TextDecoder();
  const view = new Uint8Array(bytes);
  const off = new Uint32Array(offsets);
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = dec.decode(view.subarray(off[i], off[i + 1]));
  return out;
}

// Int32Array assumes integer scores — a fractional one would truncate silently.
// A null display stays null (collapsing it to norm would change what the
// pipeline reads), so presence is tracked in a bitmap and only non-null
// displays are encoded.
export function packSnapshot(entries) {
  const n = entries.length;
  const scores = new Int32Array(n);
  const norms = new Array(n);
  const presentBits = new Uint8Array((n + 7) >> 3);
  const displayStrings = [];
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    scores[i] = e.score;
    norms[i] = e.norm;
    if (e.display != null) {
      presentBits[i >> 3] |= 1 << (i & 7);
      displayStrings.push(e.display);
    }
  }
  return {
    count: n,
    scores: scores.buffer,
    norms: packStrings(norms),
    displays: { present: presentBits.buffer, ...packStrings(displayStrings) },
  };
}

export function unpackSnapshot(snapshot) {
  const { count, scores, norms, displays } = snapshot;
  const scoreView = new Int32Array(scores);
  const normStrings = decodeStrings(norms, count);
  const presentBits = new Uint8Array(displays.present);
  const presentDisplays = decodeStrings(displays, presentCount(presentBits, count));

  const entries = new Array(count);
  let d = 0;
  for (let i = 0; i < count; i++) {
    const present = (presentBits[i >> 3] >> (i & 7)) & 1;
    entries[i] = {
      norm: normStrings[i],
      display: present ? presentDisplays[d++] : null,
      score: scoreView[i],
    };
  }
  return { entries, byNorm: buildByNorm(entries) };
}

function presentCount(presentBits, count) {
  let c = 0;
  for (let i = 0; i < count; i++) c += (presentBits[i >> 3] >> (i & 7)) & 1;
  return c;
}

export function snapshotTransferables(snapshot) {
  return [
    snapshot.scores,
    snapshot.norms.bytes, snapshot.norms.offsets,
    snapshot.displays.present, snapshot.displays.bytes, snapshot.displays.offsets,
  ];
}
