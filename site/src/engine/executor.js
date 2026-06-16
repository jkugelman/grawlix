'use strict';

import { matchesRange } from './range.js';
import { displayOf, toNorm, synthWlEntry } from './norm.js';
import { normalizeParams } from './tools.js';

export const rowLastEntry = r => r.atoms[r.atoms.length - 1].wlEntry;

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
    if (row.kind() === 'transform') {
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

// Gates the `unify` skip: a transform or a highlighting filter is what makes
// `unify` do real work. With neither active, every row is a lone atom and
// `unify` would only copy them, so the executor returns its rows as-is.
export function chainProducesMultiAtom(stack) {
  return stack.some(row => {
    if (row.isInert()) return false;
    return row.kind() === 'transform' || !!row.def.inputHighlights;
  });
}

// `ctx.input` — chain tail entries as strings, resolved lazily so a tool that
// ignores it pays nothing and the O(N)-per-stage materialization stays avoided.
function makeWorkingSetView(rows) {
  return {
    get length() { return rows.length; },
    at(i) { return rowLastEntry(rows[i]).norm; },
    *[Symbol.iterator]() { for (const row of rows) yield rowLastEntry(row).norm; },
  };
}

// Defines the `_initialChains` field and its per-atom shape on the merged cache.
// The worker's in-place owned-corpus splice splices this same array, so its atom
// literal must stay in lockstep with the shape produced here.
export async function buildInitialChains(mergedWordlist, y) {
  if (mergedWordlist._initialChains) return mergedWordlist._initialChains;
  const { entries } = mergedWordlist;
  const chains = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    chains[i] = { atoms: [{ wlEntry: entries[i], highlights: null, glyph: null }] };
    if (y.due()) await y.yield();
  }
  mergedWordlist._initialChains = chains;
  return chains;
}

// The `prepare` context — see docs/design.md § Pipeline execution.
// Rebuilt per stage so `ctx.input` reflects that stage's input rows.
function makeCtx(mergedWordlist, rows, signal, y) {
  return {
    wordlist: mergedWordlist,
    input: makeWorkingSetView(rows),
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
  };
}

export async function executePipeline(mergedWordlist, stack, signal) {
  const y = makeYielder(signal);
  for (const stackRow of stack) stackRow._error = null;

  const userStack = stack.slice(0, -1);
  const searchRow = stack[stack.length - 1];

  let state;
  if (_preSearchCache) {
    state = clonePreSearchState(_preSearchCache);
  } else {
    state = {
      groups: [{ key: undefined, chains: await buildInitialChains(mergedWordlist, y) }],
      grouped: false,
    };
    for (const stackRow of userStack) {
      await runStackRow(stackRow, state, mergedWordlist, signal, y);
    }
    _preSearchCache = clonePreSearchState(state);
  }

  await runStackRow(searchRow, state, mergedWordlist, signal, y);

  const { groups, grouped } = state;
  const multiAtom = chainProducesMultiAtom(stack);
  const result = [];
  for (const g of groups) {
    if (grouped && g.chains.length === 0) { if (y.due()) await y.yield(); continue; }
    if (multiAtom) g.chains = await unify(g.chains, y);
    if (grouped) cacheGroupStats(g);
    result.push(g);
    if (y.due()) await y.yield();
  }

  return {
    rows: grouped ? result : (result[0]?.chains ?? []),
    atomCount: currentAtomCount(stack),
    grouped,
  };
}

async function runStackRow(stackRow, state, mergedWordlist, signal, y) {
  if (stackRow.isInert()) return;
  const { def } = stackRow;
  throwIfAborted(signal);

  try {
    if (stackRow.kind() === 'group') {
      const params = normalizeParams(stackRow.params, def.params);
      const ctx = makeCtx(mergedWordlist, state.groups[0].chains, signal, y);
      const prepared = def.group.prepare ? await def.group.prepare(params, ctx) : params;
      state.groups = await bucketize(state.groups[0].chains, def, ctx, prepared);
      state.grouped = true;
      return;
    }

    const params = normalizeParams(stackRow.params, def.params);
    const prepareInput = state.grouped
      ? state.groups.flatMap(g => g.chains)
      : state.groups[0].chains;
    const prepared = def.prepare
      ? await def.prepare(params, makeCtx(mergedWordlist, prepareInput, signal, y))
      : params;
    for (const g of state.groups) {
      g.chains = await runToolStage(g.chains, stackRow, prepared, mergedWordlist, y);
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

async function runToolStage(rows, stackRow, prepared, mergedWordlist, y) {
  const { def } = stackRow;
  const kind = stackRow.kind();
  const glyph = stackRow.glyph();
  const matchOn = def.matchOn || 'norm';
  const coord = matchOn === 'display' ? 'display' : 'norm';
  const next = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tail = row.atoms[row.atoms.length - 1];
    const inputText = matchOn === 'both' ? tail.wlEntry
      : matchOn === 'display' ? displayOf(tail.wlEntry)
      : tail.wlEntry.norm;
    const result = def.run(inputText, prepared, mergedWordlist);
    if (kind === 'filter') {
      if (result) {
        if (def.inputHighlights) {
          const highlights = Array.isArray(result) ? tagCoord(result, coord) : [];
          next.push({ atoms: [...row.atoms,
            { wlEntry: tail.wlEntry, highlights, glyph }] });
        } else {
          next.push(row);
        }
      }
    } else {
      for (const out of (result || [])) {
        const atoms = row.atoms.slice();
        if (def.inputHighlights) {
          atoms.push({ wlEntry: tail.wlEntry, highlights: tagCoord(out.inputHighlights || [], coord), glyph: null });
        }
        const synthetic = Array.isArray(out.entry);
        const text = synthetic ? out.entry[0] : out.entry;
        const lookup = synthetic ? null : mergedWordlist.byNorm.get(toNorm(text));
        const wlEntry = lookup || synthWlEntry(text, synthetic ? out.entry[1] : 0);
        atoms.push({
          wlEntry,
          highlights: def.outputHighlights ? tagCoord(out.outputHighlights || [], coord) : null,
          glyph,
        });
        next.push({ atoms });
      }
    }
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
  const groups = [];
  for (const [key, groupChains] of buckets) {
    if (groupChains.length < 2) continue;
    if (keepGroup) {
      const members = groupChains.map(c => {
        const tail = rowLastEntry(c);
        return useDisplay ? displayOf(tail) : tail.norm;
      });
      if (!keepGroup(members)) continue;
    }
    const anchor = anchorFn ? anchorFn(key, ctx.wordlist) : null;
    if (anchorFn && !anchor) continue;
    groupChains.sort((a, b) => {
      const ae = rowLastEntry(a), be = rowLastEntry(b);
      return be.score - ae.score || ae.norm.localeCompare(be.norm);
    });
    groups.push({ key, chains: groupChains, anchor });
  }
  return groups;
}

export function cacheGroupStats(g) {
  let min = Infinity, max = -Infinity;
  for (const chain of g.chains) {
    for (const atom of chain.atoms) {
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
    const row = { atoms: collapseRepeatAtoms(rows[i].atoms) };
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
    for (const atom of chain.atoms) {
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
      for (const chain of row.chains) out.push(chain.atoms[chain.atoms.length - 1].wlEntry);
    } else {
      out.push(row.atoms[row.atoms.length - 1].wlEntry);
    }
  }
  return out;
}

export function applyScoreRangeToRows(rows, intervals, grouped) {
  if (!intervals) return rows;
  const chainOk = chain => chain.atoms.every(a => matchesRange(a.wlEntry.score, intervals));
  if (grouped) {
    const out = [];
    for (const g of rows) {
      if (g.anchor && !matchesRange(g.anchor.score, intervals)) continue;
      const chains = g.chains.filter(chainOk);
      if (chains.length < 2) continue;
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
      for (const chain of row.chains) yield* chain.atoms;
    } else yield* row.atoms;
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
