'use strict';

import { matchesRange } from './range.js';
import { displayOf, toNorm, synthWlEntry } from './norm.js';
import { normalizeParams } from './tools.js';
import { mergedRowsForNorm } from './corpus.js';

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
      if (!row.inputShown()) {
        count = 1;                              // output only; upstream atoms dropped
      } else {
        if (row.inputHi() && tailSlot) count++; // input mark can't fold into a slot tail
        count++;                                // output atom (new word)
      }
      tailSlot = row.outputHi();
    } else if (row.kind() === 'group') {
      // A bare group producer emits members carrying the upstream atoms unchanged —
      // no atom of its own. One that highlights members (group.memberHighlights)
      // stamps a slot per member, so a downstream search adds its own line.
      if (row.def.group.memberHighlights) {
        if (tailSlot) count++;
        tailSlot = true;
      }
    } else if (row.inputHi() && !row.inverted()) {   // highlighting filter (search)
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

async function makeTupleEmit(emit, downstream, wordlist, vocab, signal, y) {
  const stages = await Promise.all(downstream.map(async row => ({
    row,
    prepared: row.def.prepare
      ? await row.def.prepare(normalizeParams(row.params, row.def.params), makeCtx(wordlist, vocab, signal, y, row.grouped, row.reversed()))
      : normalizeParams(row.params, row.def.params),
  })));
  return async batch => {
    let groups = batch.map(tupleToGroup);
    for (const { row, prepared } of stages) {
      const kept = [];
      for (const g of groups) {
        const chains = await runGroupFilterStage(g.chains, row, prepared, wordlist, y);
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
    if (row.kind() === 'group') return false;   // bare members — unify would throw on them
    return row.kind() === 'transform' || (row.inputHi() && !row.inverted());
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

function makeCtx(wordlist, vocab, signal, y, grouped = false, reversed = false) {
  return {
    wordlist,
    vocab,
    grouped,
    reversed,
    throwIfAborted: () => throwIfAborted(signal),
    due: y.due,
    yield: y.yield,
    progress: y.progress,
    async forEach(iterable, fn) {
      const total = iterable?.length;
      let i = 0, yielded = false;
      for (const item of iterable) {
        fn(item, i++);
        if (y.due()) { if (total) y.progress(i, total); await y.yield(); yielded = true; }
      }
      // Force a terminal 100% only if this pass actually reported — a fast forEach
      // that never yielded stays silent rather than flashing a full ring.
      if (yielded && total) y.progress(total, total, true);
    },
    async times(n, fn) {
      let yielded = false;
      for (let i = 0; i < n; i++) {
        fn(i);
        if (y.due()) { y.progress(i + 1, n); await y.yield(); yielded = true; }
      }
      if (yielded && n) y.progress(n, n, true);
    },
  };
}

// Run the tool stack against the run corpus, returning
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

// The user-stack index the last run resumed from (0 = cold from the bare corpus,
// userStackLen = the whole user stack reused from its cached prefix tile). Test-visible
// ground truth for "an edit reran only the suffix" — the worker echoes it in its cache state.
let _lastSeedFrom = 0;
export function lastPipelineSeedFrom() { return _lastSeedFrom; }

// Wall time from the last prefix-tile cut through to the finished result — the cost to
// re-derive that result from the longest tile. The finished cache admits on THIS, not the
// whole run, so a result cheap to derive from a tile (expensive producer, cheap terminal)
// isn't stored redundantly. No cut → the whole run, so an untileable expensive terminal caches.
let _lastTailMs = 0;
export function lastPipelineTailMs() { return _lastTailMs; }

// A shallow clone of the inter-stage state: new group objects sharing the chain arrays by
// reference. Safe because a downstream stage REPLACES g.chains rather than mutating it in
// place, so the clone never sees a later stage's edits — the discipline that lets a cached
// prefix tile be reused (and offered) without a deep copy.
function cloneState(state) {
  return {
    groups: state.groups.map(g => ({ ...g })),
    grouped: state.grouped,
    laneKind: state.laneKind,
    capped: state.capped,
  };
}

// `resume` (worker-supplied) is the prefix-cache seam: it resumes from the longest cached
// prefix — the whole user stack on a keystroke, a shorter prefix on a tool-row edit — and
// snapshots each inter-stage state back as a tile. Absent (a direct caller) → cold from the
// bare corpus. Its seedState is shared with the cache, so it is CLONED before the suffix
// mutates it (drop the clone and a suffix run silently corrupts the cached prefix under a
// later reuse). Every boundary is a uniform tile candidate — no stage gets special caching.
//
// `wordlist` is the run corpus — the entries to process, scoped to the active view.
// `vocab` is the word-existence corpus tools consult, which stays the full merge under
// every scope: a tool asking "is this a word" against one scope's entries gets a wrong
// answer, not an error. They coincide only in the merged scope, which is why defaulting
// vocab to wordlist reads as harmless and is not.
export async function executePipeline(wordlist, stack, signal,
                                      { emit = null, resume = null, onProgress = null, vocab = wordlist } = {}) {
  const y = makeYielder(signal, onProgress);
  for (const stackRow of stack) stackRow._error = null;

  const userStackLen = stack.length - 1;   // stack[userStackLen] is the trailing search row
  const searchRow = stack[userStackLen];

  const plan = emit ? streamPlan(stack) : null;
  const producer = plan ? plan.producer : null;
  const downstream = plan ? plan.downstream : [];

  let state, from;
  if (resume?.seedState) {
    state = cloneState(resume.seedState);
    from = resume.seedFrom;
  } else {
    // The seed is the bare corpus entries — no per-entry chain wrappers. Stages
    // never mutate their input array (each returns a fresh `next`), so handing them
    // the live `entries` is safe; a filter-only run carries them through untouched.
    state = {
      groups: [{ key: undefined, chains: wordlist.entries }],
      grouped: false,
      laneKind: 'single',
      capped: false,
    };
    from = 0;
  }
  _lastSeedFrom = from;

  // Run the user-stack suffix [from, userStackLen), offering each inter-stage state as a
  // prefix tile once the time since the last cut clears the floor (greedy marginal-cost
  // tiling). The loop reaches the pre-search boundary (prefixLen userStackLen) like any
  // other, so a keystroke reuses the whole user stack and adding a row on top reuses it too.
  let acc = 0;
  let tailStart = performance.now();   // reset at each cut, so it ends up marking the LAST tile boundary
  for (let i = from; i < userStackLen; i++) {
    const stackRow = stack[i];
    const t0 = performance.now();
    await runStackRow(stackRow, state, wordlist, vocab, signal, y, stackRow === producer ? emit : null, downstream);
    if (stackRow.isInert()) continue;
    acc += performance.now() - t0;
    if (resume?.offer && acc >= resume.floorMs) {
      resume.offer(i + 1, cloneState(state), acc);
      acc = 0;
      tailStart = performance.now();
    }
  }

  await runStackRow(searchRow, state, wordlist, vocab, signal, y, searchRow === producer ? emit : null, downstream);

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

  _lastTailMs = performance.now() - tailStart;
  return {
    rows: multiLane ? result : (result[0]?.chains ?? []),
    atomCount: currentAtomCount(stack),
    laneKind,
    capped: state.capped,
  };
}

async function runStackRow(stackRow, state, wordlist, vocab, signal, y, emit = null, downstream = []) {
  if (stackRow.isInert()) return;
  const { def } = stackRow;
  throwIfAborted(signal);

  try {
    if (stackRow.kind() === 'group') {
      const params = normalizeParams(stackRow.params, def.params);
      const ctx = makeCtx(wordlist, vocab, signal, y, stackRow.grouped);
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
      const onBatch = emit ? await makeTupleEmit(emit, downstream, wordlist, vocab, signal, y) : null;
      const { tuples, capped, truncated } = await def.findTuples(poolRows.map(rowLastEntry), prepared, { wordlist, vocab, y, signal, onBatch });
      state.groups = tuples.map(tupleToGroup);
      state.grouped = true;
      state.laneKind = 'record';
      state.capped = !!capped || !!truncated;
      return;
    }

    const params = normalizeParams(stackRow.params, def.params);
    const prepareInput = state.grouped
      ? state.groups.flatMap(g => g.chains)
      : state.groups[0].chains;
    const prepared = def.prepare
      ? await def.prepare(params, makeCtx(wordlist, vocab, signal, y, stackRow.grouped, stackRow.reversed()), makeWorkingSetView(prepareInput))
      : params;
    const groupFilter = state.grouped && stackRow.kind() === 'filter';
    for (const g of state.groups) {
      g.chains = groupFilter
        ? await runGroupFilterStage(g.chains, stackRow, prepared, wordlist, y)
        : await runToolStage(g.chains, stackRow, prepared, wordlist, y, emit);
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

async function runToolStage(rows, stackRow, prepared, wordlist, y, emit = null) {
  const { def } = stackRow;
  const kind = stackRow.kind();
  const invert = stackRow.inverted();
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
    const result = def.run(inputText, prepared, wordlist);
    if (kind === 'filter') {
      if (invert) {
        // A non-match has no ranges, so this opens no highlight slot whatever the
        // tool declares. currentAtomCount agrees via inverted() — disagree and rows overlap.
        if (!result) next.push(row);
      } else if (result) {
        if (stackRow.inputHi()) {
          const highlights = Array.isArray(result) ? tagCoord(result, coord) : [];
          next.push({ atoms: [...rowAtoms(row),
            { wlEntry: tailEntry, highlights, glyph }] });
        } else {
          next.push(row);
        }
      }
    } else {
      for (const out of (result || [])) {
        const synthetic = Array.isArray(out.entry);
        const text = synthetic ? out.entry[0] : out.entry;
        // Emit one row per (norm, display) spelling sharing this output's norm,
        // so transform results match the base merged view's per-spelling rows; a
        // single-winner lookup would silently drop the other spellings (eta/ETA).
        const variants = synthetic ? null : mergedRowsForNorm(wordlist, toNorm(text));
        const scoreSrc = synthetic && out.entry.length > 1 ? { score: out.entry[1] }
          : synthetic ? tailEntry : ZERO_SCORE;
        const targets = variants && variants.length
          ? variants
          : [synthWlEntry(text, scoreSrc)];
        const showInput = stackRow.inputShown();
        for (const wlEntry of targets) {
          const atoms = showInput ? rowAtoms(row).slice() : [];
          if (showInput && stackRow.inputHi()) {
            atoms.push({ wlEntry: tailEntry, highlights: tagCoord(out.inputHighlights || [], coord), glyph: null });
          }
          atoms.push({
            wlEntry,
            highlights: stackRow.outputHi() ? tagCoord(out.outputHighlights || [], coord) : null,
            glyph,
          });
          next.push({ atoms });
        }
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
async function runGroupFilterStage(rows, stackRow, prepared, wordlist, y) {
  const { def } = stackRow;
  const invert = stackRow.inverted();
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
    const result = def.run(inputText, prepared, wordlist);
    results[i] = result;
    if (result) anyMatch = true;
    if (y.due()) await y.yield();
  }
  if (invert) {
    // De Morgan on the STAGE, not the member. Negating per-member as the flat path
    // does reads `any(!match)` — true of nearly every cluster, so the row would
    // filter nothing while looking active.
    if (anyMatch) return [];
    // No match survives to hide, so matched:true opts out of the score-range orphan gate.
    return rows.map(row => ({ atoms: rowAtoms(row), matched: true }));
  }
  if (!anyMatch) return [];
  // `matched` has no home on a bare row, so promote every member to a chain here —
  // the grouped path is off the steady-state hot path, so the wrapper is affordable.
  if (def.input !== 'highlight') return rows.map((row, i) => ({ atoms: rowAtoms(row), matched: !!results[i] }));
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
  const coord = useDisplay ? 'display' : 'norm';
  const memberHighlights = def.group.memberHighlights;
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
    // Pre-collapse here, not via the later unify pass: members are an equivalence
    // set, and unify's cross-row mirror-fold would silently merge reverse members
    // (`rat`/`tar` in one cluster). Single atom = the pure-group path skips unify.
    const chains = memberHighlights ? groupChains.map(chain => {
      const tail = rowLastEntry(chain);
      const text = useDisplay ? displayOf(tail) : tail.norm;
      const hl = { wlEntry: tail, highlights: tagCoord(memberHighlights(text, key), coord), glyph: null };
      return { atoms: collapseRepeatAtoms([...rowAtoms(chain), hl]) };
    }) : groupChains;
    groups.push({ key, chains, anchor });
  }
  return groups;
}

export function cacheGroupStats(g) {
  let min = Infinity, max = -Infinity;
  let minLen = Infinity, maxLen = -Infinity;
  for (const chain of g.chains) {
    for (const atom of rowAtoms(chain)) {
      const s = atom.wlEntry.score;
      if (s < min) min = s;
      if (s > max) max = s;
      const len = atom.wlEntry.norm.length;
      if (len < minLen) minLen = len;
      if (len > maxLen) maxLen = len;
    }
  }
  g._minScore = min;
  g._maxScore = max;
  g._minLength = minLen;
  g._maxLength = maxLen;
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
const DEFAULT_PROGRESS_INTERVAL_MS = 120;
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
let _progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS;

export function configureExecutorYield({ yieldImpl, intervalMs, progressIntervalMs } = {}) {
  if (yieldImpl) _yieldImpl = yieldImpl;
  if (intervalMs != null) _yieldIntervalMs = intervalMs;
  if (progressIntervalMs != null) _progressIntervalMs = progressIntervalMs;
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
function makeYielder(signal, onProgress = null) {
  let stride = 1, sinceCheck = 0;
  let lastClock = performance.now(), lastYield = lastClock, lastProgress = 0;
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
    // Throttled far coarser than the yield cadence — emitting per yield (~160/s)
    // would flood postMessage and can starve the cancel message. `force` bypasses
    // the throttle for the terminal 100%, which the adaptive stride would else skip.
    progress(done, total, force = false) {
      if (!onProgress || !total) return;
      const now = performance.now();
      if (!force && now - lastProgress < _progressIntervalMs) return;
      lastProgress = now;
      onProgress(Math.min(1, done / total));
    },
  };
}
