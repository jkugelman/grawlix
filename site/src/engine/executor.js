'use strict';

import { matchesRange } from './range.js';
import { displayOf, toNorm, synthWlEntry } from './norm.js';
import { normalizeParams } from './tools.js';

const ZERO_SCORE = { score: 0 };

// A pipeline row is EITHER a bare wlEntry — the undecorated, single-atom seed
// straight off the merged corpus — OR a { atoms } chain, once a tool highlights,
// transforms, or group-tags it. Seeding bare (the steady-state filter-only run
// never decorates) is what keeps the ~663K-entry corpus from materializing a chain
// object + atoms array + atom object per row (~45 MB).
// Every reader that can see a pre-decoration row goes through these two accessors;
// unify/collapse run only post-decoration, so they read `.atoms` directly.
export const rowLastEntry = r => r.atoms ? r.atoms[r.atoms.length - 1].wlEntry : r;
export const rowAtoms = r => r.atoms ?? [{ wlEntry: r, highlights: null, glyph: null }];

// The chain shape is derivable from the catalog records alone — no per-row
// runtime inspection. Simulate the executor's emit-then-unify on the active
// tools (run-having, not inert): the originator is one atom; each highlighting
// tool emits a same-word atom that the unifier folds into the tail unless the
// tail is itself a highlight slot, in which case it stays its own atom; each
// transform emits a new-word output atom that never folds. This keys off the
// tools' static highlight flags, exactly as `collapseRepeatAtoms` keys off the
// atoms' slot-ness, so the two always agree. `atomCount` is the resulting
// count — the row's height in `ROW_HEIGHT` units, read by the renderer and the
// scroller's stride math.
export function currentAtomCount(stack) {
  let count = 1;          // originator
  let tailSlot = false;   // is the tail atom a highlight slot?
  for (const row of stack) {
    if (row.isInert()) continue;   // transparent rows
    if (row.kind() === 'tuple') {
      // Re-seeds one-atom lanes (upstream atoms dropped) whose variables are colored,
      // so the tail is a highlight slot: a downstream search adds a line instead of
      // folding in. Miss this and the row is an atom too short and overlaps the next.
      count = 1;
      tailSlot = true;
    } else if (row.kind() === 'transform') {
      if (row.def.inputHighlights && tailSlot) count++;   // input mark can't fold into a slot tail
      count++;                                            // output atom (new word)
      tailSlot = !!row.def.outputHighlights;
    } else if (row.def.inputHighlights) {                 // highlighting filter (search)
      if (tailSlot) count++;
      tailSlot = true;
    }
  }
  return count;
}

// True when no active transform sits in the stack — every row is then a single
// merged-wordlist entry (plus same-word highlight atoms), so the count is per
// entry and the sort axes stay in their single-atom tier. Drives the stats-bar
// count label (Entries vs Results) and the sort tier.
export function isFilterOnlyChain(stack) {
  return !stack.some(row => row.kind() === 'transform' && !row.isInert());
}

export function isGroupChain(stack) {
  return stack.some(row => row.kind() === 'group' && !row.isInert());
}

export function isTupleChain(stack) {
  return stack.some(row => row.kind() === 'tuple' && !row.isInert());
}

function lastNonInert(stack) {
  for (let i = stack.length - 1; i >= 0; i--) if (!stack[i].isInert()) return stack[i];
  return null;
}

export function streamPlan(stack) {
  const last = lastNonInert(stack);
  if (!last) return { tier: null, producer: null, downstream: [] };
  const tail = tupleWithFilterTail(stack);
  if (tail) return { tier: 'tuple', producer: tail.producer, downstream: tail.filters };
  if (last.kind() === 'filter' && isFilterOnlyChain(stack) && !isGroupChain(stack) && !isTupleChain(stack)) {
    return { tier: 'flat', producer: last, downstream: [] };
  }
  if (last.kind() === 'transform' && !isGroupChain(stack) && !isTupleChain(stack)) {
    return { tier: 'transform', producer: last, downstream: [] };
  }
  return { tier: null, producer: null, downstream: [] };
}

// Downstream filters here run per-batch in the emit path, so their `prepare` runs
// before the tuple producer's input exists. The input is prepare's third arg, so
// a prepare that takes it (arity 3) is excluded: feeding it a stand-in input would
// diverge the streamed result from the terminal pass with no error.
function tupleWithFilterTail(stack) {
  let si = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!stack[i].isInert() && stack[i].kind() === 'tuple') { si = i; break; }
  }
  if (si === -1) return null;
  const filters = [];
  for (let i = si + 1; i < stack.length; i++) {
    const row = stack[i];
    if (row.isInert()) continue;
    if (row.kind() !== 'filter' || (row.def.prepare && row.def.prepare.length >= 3)) return null;
    filters.push(row);
  }
  return { producer: stack[si], filters };
}

// Keyed by joined norms: that key is unique per tuple, so it addresses one tuple
// for the worker's per-group fetch and is the total tiebreak the streaming merge
// needs (see sort.js groupRowComparator). Each lane carries the tuple producer's
// per-variable highlight ranges, so the rendered tuple colors its shared chunks.
function tupleToGroup(tuple) {
  return {
    key: tuple.map(lane => lane.entry.norm).join(' '),
    chains: tuple.map(lane => ({ atoms: [{ wlEntry: lane.entry, highlights: lane.highlights, glyph: null }] })),
  };
}

async function makeTupleEmit(emit, downstream, mergedWordlist, signal, y) {
  const stages = await Promise.all(downstream.map(async row => ({
    row,
    prepared: row.def.prepare
      ? await row.def.prepare(normalizeParams(row.params, row.def.params), makeCtx(mergedWordlist, signal, y, row.grouped))
      : normalizeParams(row.params, row.def.params),
  })));
  return async batch => {
    let groups = batch.map(tupleToGroup);
    for (const { row, prepared } of stages) {
      const kept = [];
      for (const g of groups) {
        const chains = await runGroupFilterStage(g.chains, row, prepared, mergedWordlist, y);
        if (chains.length) kept.push({ ...g, chains });
      }
      groups = kept;
      if (!groups.length) break;
    }
    if (!groups.length) return;
    // Collapse per lane as the terminal pass does: an uncollapsed lane carries more
    // atoms than currentAtomCount reserves, so the streamed rows would overlap.
    emit(groups.map(g => ({ ...g, chains: g.chains.map(c => ({ ...c, atoms: collapseRepeatAtoms(c.atoms) })) })));
  };
}

// Gates the `unify` skip: a transform or a highlighting filter is what makes
// `unify` do real work. With neither active, every row is a lone atom and
// `unify` would only copy them, so the executor returns its rows as-is.
export function chainProducesMultiAtom(stack) {
  return stack.some(row => {
    if (row.isInert()) return false;
    return row.kind() === 'transform' || !!row.def.inputHighlights;
  });
}

// The stage-input view, passed to `prepare` as its third arg and kept OUT of ctx:
// a prepare that reads the input must declare that param, and streamPlan reads its
// arity to keep an input-dependent prepare out of a tuple producer's streaming emit path
// (where the input doesn't exist yet). Fold it into ctx and that gate goes silently
// dead — an input-reading prepare would stream and diverge from the terminal pass.
function makeWorkingSetView(rows) {
  return {
    get length() { return rows.length; },
    at(i) { return rowLastEntry(rows[i]).norm; },
    *[Symbol.iterator]() { for (const row of rows) yield rowLastEntry(row).norm; },
  };
}

function makeCtx(mergedWordlist, signal, y, grouped = false) {
  return {
    wordlist: mergedWordlist,
    grouped,
    throwIfAborted: () => throwIfAborted(signal),
    due: y.due,
    yield: y.yield,
    async forEach(iterable, fn) {
      let i = 0;
      for (const item of iterable) {
        fn(item, i++);
        if (y.due()) await y.yield();
      }
    },
    async times(n, fn) {
      for (let i = 0; i < n; i++) {
        fn(i);
        if (y.due()) await y.yield();
      }
    },
  };
}

// Run the tool stack against the merged wordlist, returning
// `{ rows, atomCount }`. Each row is a ChainRow — `{ atoms: Atom[] }` — where
// an Atom is `{ wlEntry, highlights, glyph }`, where `highlights` is a flat
// list of ranges — or `null` when the atom is not a highlight slot (the
// originator, a plain transform output). Seeded one-atom-per-merged-entry;
// each transform branches a row into one new row per output (appending an
// output atom, plus a same-word input-mark atom when it highlights its input),
// each highlighting filter appends a same-word atom carrying its match. Tools
// emit unconditionally — `unify` folds the redundant same-word atoms
// afterward. Inert tools are transparent. The executor owns the
// per-row loop, cooperative yielding, and abort: `signal` aborts a superseded
// run at the next yield.
export class ToolStageError extends Error {
  constructor(cause, stackRow) {
    super(cause?.message || String(cause));
    this.cause = cause;
    this.stackRow = stackRow;
  }
}

let _preSearchCache = null;
export function invalidatePreSearchCache() { _preSearchCache = null; }

function clonePreSearchState(state) {
  return {
    groups: state.groups.map(g => ({ ...g })),
    grouped: state.grouped,
    laneKind: state.laneKind,
    capped: state.capped,
  };
}

export async function executePipeline(mergedWordlist, stack, signal, emit = null) {
  const y = makeYielder(signal);
  for (const stackRow of stack) stackRow._error = null;

  const userStack = stack.slice(0, -1);
  const searchRow = stack[stack.length - 1];

  const plan = emit ? streamPlan(stack) : null;
  const producer = plan ? plan.producer : null;
  const downstream = plan ? plan.downstream : [];

  let state;
  if (_preSearchCache) {
    state = clonePreSearchState(_preSearchCache);
  } else {
    // The seed is the bare corpus entries — no per-entry chain wrappers. Stages
    // never mutate their input array (each returns a fresh `next`), so handing them
    // the live `entries` is safe; a filter-only run carries them through untouched.
    state = {
      groups: [{ key: undefined, chains: mergedWordlist.entries }],
      grouped: false,
      laneKind: 'single',
      capped: false,
    };
    for (const stackRow of userStack) {
      await runStackRow(stackRow, state, mergedWordlist, signal, y, stackRow === producer ? emit : null, downstream);
    }
    _preSearchCache = clonePreSearchState(state);
  }

  await runStackRow(searchRow, state, mergedWordlist, signal, y, searchRow === producer ? emit : null, downstream);

  const { groups, laneKind } = state;
  const multiLane = laneKind !== 'single';
  const isRecord = laneKind === 'record';
  const multiAtom = chainProducesMultiAtom(stack);
  const result = [];
  for (const g of groups) {
    if (multiLane && g.chains.length === 0) { if (y.due()) await y.yield(); continue; }
    // A record's lanes are positional, not an equivalence class: unify's cross-row
    // mirror-fold (APE/PEA → one ↔ row) would collapse distinct solutions, so a
    // record only collapses repeat atoms *within* each lane (a downstream highlight
    // re-emits the lane's word) — never across lanes.
    if (multiAtom) {
      g.chains = isRecord
        ? g.chains.map(c => ({ ...c, atoms: collapseRepeatAtoms(c.atoms) }))
        : await unify(g.chains, y);
    }
    if (multiLane) cacheGroupStats(g);
    result.push(g);
    if (y.due()) await y.yield();
  }

  return {
    rows: multiLane ? result : (result[0]?.chains ?? []),
    atomCount: currentAtomCount(stack),
    laneKind,
    capped: state.capped,
  };
}

async function runStackRow(stackRow, state, mergedWordlist, signal, y, emit = null, downstream = []) {
  if (stackRow.isInert()) return;
  const { def } = stackRow;
  throwIfAborted(signal);

  try {
    if (stackRow.kind() === 'group') {
      const params = normalizeParams(stackRow.params, def.params);
      const ctx = makeCtx(mergedWordlist, signal, y, stackRow.grouped);
      const prepared = def.group.prepare
        ? await def.group.prepare(params, ctx, makeWorkingSetView(state.groups[0].chains))
        : params;
      state.groups = await bucketize(state.groups[0].chains, def, ctx, prepared);
      state.grouped = true;
      state.laneKind = 'set';
      return;
    }

    if (stackRow.kind() === 'tuple') {
      const params = normalizeParams(stackRow.params, def.params);
      const poolRows = state.grouped ? state.groups.flatMap(g => g.chains) : state.groups[0].chains;
      const prepared = def.prepare(params);
      const onBatch = emit ? await makeTupleEmit(emit, downstream, mergedWordlist, signal, y) : null;
      const { tuples, capped } = await def.findTuples(poolRows.map(rowLastEntry), prepared, { wordlist: mergedWordlist, y, signal, onBatch });
      state.groups = tuples.map(tupleToGroup);
      state.grouped = true;
      state.laneKind = 'record';
      state.capped = !!capped;
      return;
    }

    const params = normalizeParams(stackRow.params, def.params);
    const prepareInput = state.grouped
      ? state.groups.flatMap(g => g.chains)
      : state.groups[0].chains;
    const prepared = def.prepare
      ? await def.prepare(params, makeCtx(mergedWordlist, signal, y, stackRow.grouped), makeWorkingSetView(prepareInput))
      : params;
    const groupFilter = state.grouped && stackRow.kind() === 'filter';
    for (const g of state.groups) {
      g.chains = groupFilter
        ? await runGroupFilterStage(g.chains, stackRow, prepared, mergedWordlist, y)
        : await runToolStage(g.chains, stackRow, prepared, mergedWordlist, y, emit);
      if (y.due()) await y.yield();
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    stackRow._error = e?.message || String(e);
    console.error(`Tool "${stackRow.tool}" failed:`, e);
    throw new ToolStageError(e, stackRow);
  }
}

function tagCoord(ranges, coord) {
  if (!ranges?.length) return ranges;
  return ranges.map(r => r.coord ? r : { ...r, coord });
}

async function runToolStage(rows, stackRow, prepared, mergedWordlist, y, emit = null) {
  const { def } = stackRow;
  const kind = stackRow.kind();
  const glyph = stackRow.glyph();
  const matchOn = def.matchOn || 'norm';
  const coord = matchOn === 'display' ? 'display' : 'norm';
  const next = [];
  let flushed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tailEntry = rowLastEntry(row);
    const inputText = matchOn === 'both' ? tailEntry
      : matchOn === 'display' ? displayOf(tailEntry)
      : tailEntry.norm;
    const result = def.run(inputText, prepared, mergedWordlist);
    if (kind === 'filter') {
      if (result) {
        if (def.inputHighlights) {
          const highlights = Array.isArray(result) ? tagCoord(result, coord) : [];
          next.push({ atoms: [...rowAtoms(row),
            { wlEntry: tailEntry, highlights, glyph }] });
        } else {
          next.push(row);
        }
      }
    } else {
      for (const out of (result || [])) {
        const atoms = rowAtoms(row).slice();
        if (def.inputHighlights) {
          atoms.push({ wlEntry: tailEntry, highlights: tagCoord(out.inputHighlights || [], coord), glyph: null });
        }
        const synthetic = Array.isArray(out.entry);
        const text = synthetic ? out.entry[0] : out.entry;
        const lookup = synthetic ? null : mergedWordlist.byNorm.get(toNorm(text));
        const wlEntry = lookup || synthWlEntry(text, synthetic ? tailEntry : ZERO_SCORE);
        atoms.push({
          wlEntry,
          highlights: def.outputHighlights ? tagCoord(out.outputHighlights || [], coord) : null,
          glyph,
        });
        next.push({ atoms });
      }
    }
    if (y.due()) {
      // Flush before y.yield(), not after: y.yield() is where a superseded run
      // throws AbortError, so flushing below it would silently swallow the last
      // batch. Emitting a tail that abort then strips is harmless (consumer drops it).
      if (emit && next.length > flushed) { emit(next.slice(flushed)); flushed = next.length; }
      await y.yield();
    }
  }
  if (emit && next.length > flushed) emit(next.slice(flushed));
  return next;
}

// A filter over grouped state keeps the WHOLE cluster when any member matches,
// rather than trimming to the matchers as runToolStage does for a flat chain.
// Trimming here would silently strip a searched cluster to a lone member, which
// the worker's <2 score-range guard then drops entirely — the bug this avoids.
// Non-matchers still get an empty highlight slot so every member keeps the atom
// height currentAtomCount reserves; omit it and matched rows gain a line the
// rest lack, misaligning the grid with no error.
//
// Each member also carries `matched`. Its only reader is the worker's score-range
// gate (drop a cluster the range has stripped of every match), so it looks unused
// here — prune it and that gate silently goes dead, reviving the orphan cluster.
async function runGroupFilterStage(rows, stackRow, prepared, mergedWordlist, y) {
  const { def } = stackRow;
  const glyph = stackRow.glyph();
  const matchOn = def.matchOn || 'norm';
  const coord = matchOn === 'display' ? 'display' : 'norm';
  const results = new Array(rows.length);
  let anyMatch = false;
  for (let i = 0; i < rows.length; i++) {
    const tailEntry = rowLastEntry(rows[i]);
    const inputText = matchOn === 'both' ? tailEntry
      : matchOn === 'display' ? displayOf(tailEntry)
      : tailEntry.norm;
    const result = def.run(inputText, prepared, mergedWordlist);
    results[i] = result;
    if (result) anyMatch = true;
    if (y.due()) await y.yield();
  }
  if (!anyMatch) return [];
  // `matched` has no home on a bare row, so promote every member to a chain here —
  // the grouped path is off the steady-state hot path, so the wrapper is affordable.
  if (!def.inputHighlights) return rows.map((row, i) => ({ atoms: rowAtoms(row), matched: !!results[i] }));
  const next = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tailEntry = rowLastEntry(row);
    const highlights = Array.isArray(results[i]) ? tagCoord(results[i], coord) : [];
    next[i] = { atoms: [...rowAtoms(row), { wlEntry: tailEntry, highlights, glyph }], matched: !!results[i] };
    if (y.due()) await y.yield();
  }
  return next;
}

export async function bucketize(chains, def, ctx, prepared) {
  const useDisplay = def.matchOn === 'display';
  const buckets = new Map();
  await ctx.forEach(chains, chain => {
    const tail = rowLastEntry(chain);
    const input = useDisplay ? displayOf(tail) : tail.norm;
    const keys = def.group.key(input, prepared);
    for (const key of (Array.isArray(keys) ? keys : [keys])) {
      if (!key) continue;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = []);
      bucket.push(chain);
    }
  });
  const anchorFn = def.group.anchor;
  const keepGroup = def.group.keepGroup;
  // The two-member floor counts distinct *words*, not merged rows: the merge emits
  // one row per (norm, display), so one entry's spellings (`going ape`/`goingape`/
  // `GOINGAPE!`) are one word and an all-one-word bucket is no cluster. Only this
  // gate dedups — a surviving cluster still shows every spelling. Whole-chain key,
  // not the tail: a transform upstream can land two distinct words on one tail
  // (wheat/cheat → heat), which must stay separate members.
  const identity = chain =>
    rowAtoms(chain).map(a => useDisplay ? displayOf(a.wlEntry) : a.wlEntry.norm).join('\0');
  const memberKey = c => useDisplay ? displayOf(rowLastEntry(c)) : rowLastEntry(c).norm;
  const groups = [];
  for (const [key, groupChains] of buckets) {
    if (new Set(groupChains.map(identity)).size < 2) continue;
    if (keepGroup && !keepGroup(groupChains.map(memberKey))) continue;
    const anchor = anchorFn ? anchorFn(key, ctx.wordlist) : null;
    if (anchorFn && !anchor) continue;
    groupChains.sort((a, b) => {
      const ae = rowLastEntry(a), be = rowLastEntry(b);
      return be.score - ae.score || ae.norm.localeCompare(be.norm)
        || displayOf(ae).localeCompare(displayOf(be));
    });
    groups.push({ key, chains: groupChains, anchor });
  }
  return groups;
}

export function cacheGroupStats(g) {
  let min = Infinity, max = -Infinity;
  for (const chain of g.chains) {
    for (const atom of rowAtoms(chain)) {
      const s = atom.wlEntry.score;
      if (s < min) min = s;
      if (s > max) max = s;
    }
  }
  g._minScore = min;
  g._maxScore = max;
  g._count = g.chains.length;
}

// Post-executor unification — two collapses that turn the executor's
// emit-everything output into the displayed chain rows.
//
// Within a row, `collapseRepeatAtoms` folds adjacent atoms for the same word:
// the originator and a search's same-word atom become one, while two searches'
// atoms stay distinct — the rule is "fold unless both carry highlights."
//
// Across rows, a transform like semordnilap emits both directed halves of a
// pair (STRESSED→DESSERTS and DESSERTS→STRESSED). Exact reverses — same
// entries mirrored, same scores — collapse to one row, its relation glyphs
// promoted to ↔. A downstream transform breaks the symmetry, so those rows
// fail the mirror test and stay separate with their directed → glyphs. The
// survivor is whichever direction's entry chain sorts lexicographically
// smaller — picked explicitly, so it's deterministic regardless of emit order
// — and it keeps its own highlights; the dropped direction's are not carried
// over.
export async function unify(rows, y) {
  const seen = new Map();   // entry-chain key → { row, index } of its slot in `out`
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = { atoms: collapseRepeatAtoms(rows[i].atoms), matched: rows[i].matched };
    const entries = row.atoms.map(a => a.wlEntry.norm);
    const fwd = entries.join('\0');
    const rev = [...entries].reverse().join('\0');
    let folded = false;
    if (fwd !== rev) {
      const mirror = seen.get(rev);
      if (mirror) {
        const mScores = mirror.row.atoms.map(a => a.wlEntry.score);
        const rScores = row.atoms.map(a => a.wlEntry.score).reverse();
        if (mScores.every((s, j) => s === rScores[j])) {
          const survivor = fwd < rev ? row : mirror.row;
          survivor.atoms = survivor.atoms.map(a => a.glyph ? { ...a, glyph: '↔' } : a);
          out[mirror.index] = survivor;
          folded = true;
        }
      }
    }
    if (!folded) {
      seen.set(fwd, { row, index: out.length });
      out.push(row);
    }
    if (y.due()) await y.yield();
  }
  return out;
}

// Fold adjacent same-word atoms in a row into one. An atom is a *highlight
// slot* when its `highlights` is an array (a search's atom, a transform's
// input/output mark) and not a slot when `highlights` is `null` (the
// originator, a plain transform output). Two slot atoms for the same word stay
// distinct — that's how three searches render as three lines; any other
// same-word pair folds. Keying on slot-ness, not on whether the array is
// non-empty, keeps the row's atom count matched to `currentAtomCount` even
// when a tool highlights only conditionally (a wildcard-only search matches
// without producing ranges, yet still holds its slot).
export function collapseRepeatAtoms(atoms) {
  const out = [atoms[0]];
  for (let i = 1; i < atoms.length; i++) {
    const prev = out[out.length - 1];
    const cur = atoms[i];
    if (prev.wlEntry.norm === cur.wlEntry.norm &&
        !(prev.highlights !== null && cur.highlights !== null) &&
        !cur.glyph) {
      // Survivor keeps `prev`'s glyph (a repeat atom has none) and takes the
      // highlight slot when one side is one.
      if (cur.highlights !== null) out[out.length - 1] = { ...prev, highlights: cur.highlights };
    } else {
      out.push(cur);
    }
  }
  return out;
}

// Flatten the chain rows to their atoms' wlEntries, row order. Feeds the stats
// aggregates / histogram — a chain row contributes each distinct word's score.
// Atoms that merely repeat the previous atom's word (a multi-search row stacks
// the same word under several highlights) are skipped so one entry isn't
// counted once per highlight.
export function flattenAtoms(rows) {
  const out = [];
  const pushChain = chain => {
    let prev = null;
    for (const atom of rowAtoms(chain)) {
      if (atom.wlEntry.norm === prev) continue;
      out.push(atom.wlEntry);
      prev = atom.wlEntry.norm;
    }
  };
  for (const row of rows) {
    if (row.chains) {
      for (const chain of row.chains) pushChain(chain);
    } else pushChain(row);
  }
  return out;
}

export function bottomLineAtoms(rows) {
  const out = [];
  for (const row of rows) {
    if (row.chains) {
      for (const chain of row.chains) out.push(rowLastEntry(chain));
    } else {
      out.push(rowLastEntry(row));
    }
  }
  return out;
}

export function applyScoreRangeToRows(rows, intervals, laneKind) {
  if (!intervals) return rows;
  const chainOk = chain => rowAtoms(chain).every(a => matchesRange(a.wlEntry.score, intervals));
  if (laneKind === 'record') {
    // A record's lanes are positional — each is part of one solution, so the range
    // can't trim a lane the way it trims a cluster member without rendering a row
    // below its arity. Keep a record only when every lane is in range, else drop it
    // whole (the §Umiaq "all lanes in range" rule).
    const out = [];
    for (const g of rows) {
      if (!g.chains.every(chainOk)) continue;
      cacheGroupStats(g);
      out.push(g);
    }
    return out;
  }
  if (laneKind === 'set') {
    const out = [];
    for (const g of rows) {
      if (g.anchor && !matchesRange(g.anchor.score, intervals)) continue;
      const chains = g.chains.filter(chainOk);
      if (chains.length < 2) continue;
      // A grouped filter tags its matches; once the range trims members, the
      // cluster is a result only while an in-range member is still one of them.
      // Skip and it survives on a match the range hid — a cluster showing none
      // of the words the search found. Untagged chains (no grouped filter) opt out.
      if (chains[0].matched !== undefined && !chains.some(c => c.matched)) continue;
      const ng = { ...g, chains };
      cacheGroupStats(ng);
      out.push(ng);
    }
    return out;
  }
  return rows.filter(chainOk);
}

export function* rowSetAtoms(rows) {
  for (const row of rows) {
    if (row.chains) {
      for (const chain of row.chains) yield* rowAtoms(chain);
    } else yield* rowAtoms(row);
  }
}

// ─── Cooperative yielding & abort ───────────────────────────────────────────
// Yield budget — when an in-helper loop has consumed this much CPU since its
// last yield, it gives the browser a turn. ~6ms is roughly half a 60Hz frame,
// leaving the other half for input handling and paint. Iteration-count chunking
// blows up at small body sizes: 1K iterations of ~1μs work yields every ~1ms,
// burning hundreds of ms of pure yield overhead on a 500K filter. Time-based
// chunking keeps yield count proportional to wall-clock cost.
const DEFAULT_YIELD_INTERVAL_MS = 6;
// scheduler.yield is the modern primitive (Chrome 129+); the setTimeout fallback
// is universal and lands the browser back on the macrotask queue, which is what
// we want — input events and paints get a turn before the tool resumes.
const defaultYieldImpl = (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function')
  ? () => scheduler.yield()
  : () => new Promise(r => setTimeout(r, 0));

// Injectable so the worker realm can swap in a setTimeout(0) macrotask yielder:
// the default scheduler.yield() starves the worker's cancel message (B1 spike),
// silently breaking supersession with no visible symptom in the code.
let _yieldImpl = defaultYieldImpl;
let _yieldIntervalMs = DEFAULT_YIELD_INTERVAL_MS;

export function configureExecutorYield({ yieldImpl, intervalMs } = {}) {
  if (yieldImpl) _yieldImpl = yieldImpl;
  if (intervalMs != null) _yieldIntervalMs = intervalMs;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

// Cooperative-yield gate, one per run. `due()` is a cheap synchronous check;
// when true the caller `await`s `yield()`. `due()` can't read the clock every
// iteration, so it samples once per `stride` calls and retunes `stride` to keep
// those samples ~YIELD_CLOCK_TARGET_MS apart whatever the per-iteration cost.
const YIELD_CLOCK_TARGET_MS = 1;
const YIELD_STRIDE_MAX = 1 << 16;
function makeYielder(signal) {
  let stride = 1, sinceCheck = 0;
  let lastClock = performance.now(), lastYield = lastClock;
  return {
    due() {
      if (++sinceCheck < stride) return false;
      const now = performance.now();
      const elapsed = now - lastClock;
      if (elapsed > 0) stride = Math.max(1, Math.min(YIELD_STRIDE_MAX, Math.round(stride * YIELD_CLOCK_TARGET_MS / elapsed)));
      lastClock = now;
      sinceCheck = 0;
      return now - lastYield >= _yieldIntervalMs;
    },
    async yield() {
      await _yieldImpl();
      throwIfAborted(signal);
      lastYield = lastClock = performance.now();
    },
  };
}
