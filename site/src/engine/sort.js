'use strict';

// Shared (not worker-copied) so main and the worker can't drift the sort order —
// a divergence no error would catch. Lives in engine/ (not ui/) so the worker
// sorts every tier exactly the way main labels its headers. `stack` is always an
// explicit argument, never a ToolStack default, because the engine has no ToolStack.

import { rowLastEntry, rowAtoms, isGroupChain, isTupleChain, isFilterOnlyChain } from './executor.js';
import { displayOf } from './norm.js';
import { TOOLS } from './tools.js';

// ─── Chain-tier sort axes (single / multi) ───────────────────────────────────
//
// The chain tiers sort materialized chain rows (object-shaped axes), unlike the
// flat tier's index-shaped FLAT_SORT_AXES copy in the worker. Each axis declares
// a primary projection and a tiebreaker chain — when the primary ties, fall to
// whichever direction surfaces the most interesting rows first (longer > shorter,
// higher score > lower), alphabetical asc as the final stable tiebreaker.
// Flipping the asc/desc toggle reverses only the primary; a tiebreaker with a
// declared `dir` keeps it, so "score asc" still shows the longest among the
// lowest-scoring rows first instead of letting short junk float up a tied bucket.
// A tiebreaker that OMITS `dir` instead follows the toggle — for axes (Entry)
// whose tiebreaker continues the primary's own ordering rather than ranking ties.
//
// A multi-output transform (anagram) branches one input into rows that share
// their whole first atom; rowChainTail breaks those ties by the later atoms.
// A bare seed row (no `.atoms`) is a single undecorated entry: its own first entry,
// its only score, with no later atoms to tie-break on.
const rowFirstEntry = r => r.atoms ? r.atoms[0].wlEntry : r;
export const rowMinScore = r => r.atoms ? Math.min(...r.atoms.map(a => a.wlEntry.score)) : r.score;
export const rowMaxScore = r => r.atoms ? Math.max(...r.atoms.map(a => a.wlEntry.score)) : r.score;
export const rowMinLength = r => r.atoms ? Math.min(...r.atoms.map(a => a.wlEntry.norm.length)) : r.norm.length;
export const rowMaxLength = r => r.atoms ? Math.max(...r.atoms.map(a => a.wlEntry.norm.length)) : r.norm.length;
// Collate alphabetically on displayOf, not norm: toNorm strips spaces, so a
// multi-word base ("lather up") would silently sort after its inflections.
const rowFirstDisplay = r => displayOf(rowFirstEntry(r));
const rowLastDisplay = r => displayOf(rowLastEntry(r));
// Later atoms joined with a low separator: a string compare then orders them
// atom-by-atom, since every row in a run carries the same atom count.
const rowChainTail = r => !r.atoms ? '' : r.atoms.slice(1).map(a => a.wlEntry.norm).join('\u0000');

const SORT_AXES = {
  single: {
    entry: {
      label: 'Entry',
      primary: r => rowFirstEntry(r).family || rowFirstDisplay(r),
      // Display omits dir to follow the toggle: within a family it's the same
      // alphabetical axis as the primary, so giving it a fixed dir would silently
      // leave Entry desc with reversed clusters but members still ascending.
      // Score keeps a fixed dir — a genuine most-interesting tie.
      tiebreakers: [
        { project: rowFirstDisplay                         },
        { project: r => rowFirstEntry(r).score, dir: 'desc' },
      ],
    },
    length: {
      label: 'Length',
      primary: r => rowFirstEntry(r).norm.length,
      tiebreakers: [
        { project: r => rowFirstEntry(r).score, dir: 'desc' },
        { project: rowFirstDisplay,             dir: 'asc'  },
      ],
    },
    score: {
      label: 'Score',
      primary: r => rowFirstEntry(r).score,
      tiebreakers: [
        { project: r => rowFirstEntry(r).norm.length, dir: 'desc' },
        { project: rowFirstDisplay,                   dir: 'asc'  },
      ],
    },
    comment: {
      label: 'Comment',
      primary: r => rowFirstEntry(r).comment || '',
      tiebreakers: [
        { project: rowFirstDisplay, dir: 'asc' },
      ],
    },
  },
  multi: {
    entry: {
      label: 'Entry',
      primary: r => rowFirstEntry(r).family || rowFirstDisplay(r),
      // Both omit dir so Entry desc mirrors a transform's output branches too,
      // not just the family interior (see single): seed display, then chain tail.
      tiebreakers: [
        { project: rowFirstDisplay },
        { project: rowChainTail    },
      ],
    },
    length: {
      label: 'Length',
      primary: r => rowFirstEntry(r).norm.length,
      // First-atom score then entry replays the tool-less Length order; the
      // chain tail then separates a multi-output transform's branches.
      tiebreakers: [
        { project: r => rowFirstEntry(r).score, dir: 'desc' },
        { project: rowFirstDisplay,             dir: 'asc'  },
        { project: rowChainTail,                dir: 'asc'  },
      ],
    },
    'min-length': {
      label: 'Min length',
      primary: rowMinLength,
      tiebreakers: [
        { project: r => rowLastEntry(r).score, dir: 'desc' },
        { project: rowLastDisplay,             dir: 'asc'  },
      ],
    },
    'max-length': {
      label: 'Max length',
      primary: rowMaxLength,
      tiebreakers: [
        { project: r => rowLastEntry(r).score, dir: 'desc' },
        { project: rowLastDisplay,             dir: 'asc'  },
      ],
    },
    'min-score': {
      label: 'Min score',
      primary: rowMinScore,
      tiebreakers: [
        { project: r => rowLastEntry(r).norm.length, dir: 'desc' },
        { project: rowLastDisplay,                   dir: 'asc'  },
      ],
    },
    'max-score': {
      label: 'Max score',
      primary: rowMaxScore,
      tiebreakers: [
        { project: r => rowLastEntry(r).norm.length, dir: 'desc' },
        { project: rowLastDisplay,                   dir: 'asc'  },
      ],
    },
    comment: {
      label: 'Comment',
      primary: r => rowFirstEntry(r).comment || '',
      tiebreakers: [
        { project: rowFirstDisplay, dir: 'asc' },
        { project: rowChainTail,    dir: 'asc' },
      ],
    },
  },
};
export const DEFAULT_SORT_BY_TIER = { single: 'entry', multi: 'entry', group: 'entry', tuple: 'entry' };

// Group and tuple rows share the multi-lane render/window machinery; they differ
// only in chrome (a group has a key/anchor/columns and can overflow; a tuple is
// bare fixed-N lanes). Callers branch on this where the shared machinery applies.
export function isMultiLaneTier(tier) { return tier === 'group' || tier === 'tuple'; }

// The sort tier is single-atom when the chain is filter-only and multi-atom once
// a transform is in play — transforms are what give a row genuinely distinct
// atoms to sort across. Highlight-only repeat atoms don't promote the tier:
// they're all the same word and score.
export function chainSortTier(stack) {
  if (isGroupChain(stack)) return 'group';
  if (isTupleChain(stack)) return 'tuple';
  return isFilterOnlyChain(stack) ? 'single' : 'multi';
}
export function sortAxes(tier, stack) {
  return isMultiLaneTier(tier) ? groupSortAxes(stack) : SORT_AXES[tier];
}
export function isValidSortAxis(key) {
  if (key in SORT_AXES.single || key in SORT_AXES.multi
      || key in GROUP_SORT_AXES) return true;
  for (const tool of Object.values(TOOLS)) {
    for (const col of tool.group?.columns || []) {
      if (col.key === key) return true;
    }
  }
  return false;
}

// ─── Group-tier sort axes ────────────────────────────────────────────────────

export const groupMinScore     = g => g._minScore;
export const groupMaxScore     = g => g._maxScore;
export const groupMinLength    = g => g._minLength;
export const groupMaxLength    = g => g._maxLength;
export const groupCount        = g => g._count;
export const groupChainEntries = g => g.chains.map(c => rowFirstDisplay(c));

export const GROUP_SORT_AXES = {
  entry: {
    label: 'Entry',
    primary: groupChainEntries,
    tiebreakers: [{ project: groupCount, dir: 'desc' }],
  },
  count: {
    label: 'Count',
    primary: groupCount,
    tiebreakers: [{ project: g => g.key, dir: 'asc' }],
  },
  'min-score': {
    label: 'Min score',
    primary: groupMinScore,
    tiebreakers: [
      { project: groupCount, dir: 'desc' },
      { project: g => g.key, dir: 'asc'  },
    ],
  },
  'max-score': {
    label: 'Max score',
    primary: groupMaxScore,
    tiebreakers: [
      { project: groupCount, dir: 'desc' },
      { project: g => g.key, dir: 'asc'  },
    ],
  },
  'min-length': {
    label: 'Min length',
    primary: groupMinLength,
    tiebreakers: [
      { project: groupCount, dir: 'desc' },
      { project: g => g.key, dir: 'asc'  },
    ],
  },
  'max-length': {
    label: 'Max length',
    primary: groupMaxLength,
    tiebreakers: [
      { project: groupCount, dir: 'desc' },
      { project: g => g.key, dir: 'asc'  },
    ],
  },
};

export function activeGroupRow(stack) {
  return stack.find(r => r.kind() === 'group' && !r.isInert()) ?? null;
}
export function activeGroupColumns(stack) {
  return activeGroupRow(stack)?.def.group?.columns || [];
}
export function activeGroupAnchorLabel(stack) {
  return activeGroupRow(stack)?.def.group?.anchorLabel || null;
}

function buildColumnAxis(primaryCol) {
  const tiebreakers = primaryCol.tiebreakers ?? [
    { project: groupCount,        dir: 'desc' },
    { project: groupMinScore,     dir: 'desc' },
    { project: groupMaxScore,     dir: 'desc' },
    { project: groupChainEntries, dir: 'asc'  },
  ];
  return {
    label: primaryCol.label,
    primary: g => primaryCol.value(g),
    tiebreakers,
  };
}

export function groupSortAxes(stack) {
  const cols = activeGroupColumns(stack);
  const spec = activeGroupRow(stack)?.def.group || null;
  const anchorLabel = spec?.anchorLabel || null;
  const extraTiebreakers = cols
    .filter(c => c.tiebreaker !== false)
    .map(c => ({ project: g => c.value(g), dir: 'desc' }));
  const baseAxes = {};
  for (const [key, axis] of Object.entries(GROUP_SORT_AXES)) {
    let updated = axis;
    if (key === 'entry' && anchorLabel) {
      updated = {
        ...axis,
        label: anchorLabel,
        primary: g => displayOf(g.anchor),
        tiebreakers: [{ project: groupCount, dir: 'desc' }],
      };
    }
    baseAxes[key] = extraTiebreakers.length
      ? { ...updated, tiebreakers: [...updated.tiebreakers, ...extraTiebreakers] }
      : updated;
  }
  if (anchorLabel) {
    baseAxes['length'] = {
      label: `${anchorLabel} length`,
      primary: g => g.anchor.norm.length,
      tiebreakers: [
        { project: g => displayOf(g.anchor), dir: 'asc' },
        { project: groupCount,               dir: 'desc' },
      ],
    };
    baseAxes['score'] = {
      label: `${anchorLabel} score`,
      primary: g => g.anchor.score,
      tiebreakers: [
        { project: g => displayOf(g.anchor), dir: 'asc' },
        { project: groupCount,               dir: 'desc' },
      ],
    };
  }
  const columnAxes = {};
  for (const col of cols) {
    if (col.sort === false) continue;
    if (baseAxes[col.key]) continue;
    columnAxes[col.key] = buildColumnAxis(col);
  }
  return { ...baseAxes, ...columnAxes };
}

// Each non-primary sort pick rides as a fixed-direction tiebreaker — its own dir,
// never flipped by primaryDir — ahead of the primary axis's built-in tiebreakers.
// Get that order or those directions wrong and ties resolve subtly off, no error.
export function composeSortAxis(sortList, axes) {
  const list = (sortList || []).filter(s => s && axes[s.key]);
  if (!list.length) return null;
  const base = axes[list[0].key];
  return {
    primary: base.primary,
    tiebreakers: [
      ...list.slice(1).map(s => ({ project: axes[s.key].primary, dir: s.dir })),
      ...base.tiebreakers,
    ],
  };
}

// primaryDir flips the primary and any dir-less tiebreaker (which rides along with
// the primary's ordering); a tiebreaker with its own dir stays put, so flipping
// asc/desc can't reshuffle the genuine tie-rankers within a bucket.
export function compareItems(a, b, axis, primaryDir) {
  const sign = dir => dir === 'asc' ? 1 : -1;
  const primCmp = compareValues(axis.primary(a), axis.primary(b)) * sign(primaryDir);
  if (primCmp !== 0) return primCmp;
  for (const tb of axis.tiebreakers) {
    const cmp = compareValues(tb.project(a), tb.project(b)) * sign(tb.dir ?? primaryDir);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export function compareValues(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compareValues(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function sortGroupChains(groups, sortKey) {
  const seedEntry = c => rowFirstDisplay(c);
  const seedScore = c => rowFirstEntry(c).score;
  const byNorm = (a, b) => seedEntry(a).localeCompare(seedEntry(b));
  const byScore = (a, b) => seedScore(b) - seedScore(a) || byNorm(a, b);
  const cmp = sortKey === 'entry' ? byNorm : byScore;
  for (const g of groups) g.chains.sort(cmp);
}

// A tuple's group comparator must be a TOTAL order, or the streaming emitter's
// incremental merge wouldn't equal a from-scratch sort and completion would
// reshuffle: the group axes tiebreak down to groupCount, constant N for a
// fixed-arity tuple. g.key (the joined norms) is unique per tuple, so it's the
// total tiebreak — and it only fixes otherwise-arbitrary ties, so the buffered
// path's order is unchanged. The worker's stream merge imports this so the two
// orders can't drift.
export function groupRowComparator(sortList, stack) {
  const axis = composeSortAxis(sortList, groupSortAxes(stack));
  if (!axis) return null;
  const dir = sortList[0].dir;
  if (!isTupleChain(stack)) return (a, b) => compareItems(a, b, axis, dir);
  return (a, b) => compareItems(a, b, axis, dir) || String(a.key).localeCompare(String(b.key));
}

// Chains sort before the groups (the Entry group axis projects off chain seed
// order via groupChainEntries) and unconditionally — gating the chain sort on the
// score range silently reorders chains off the designed seed order under a filter.
export function sortGroups(groups, sortList, stack) {
  const cmp = groupRowComparator(sortList, stack);
  if (!cmp) return groups;
  // A group's members are an unordered set, so the chain sort seeds their display
  // order; a tuple's lanes are positional (APE/PEA ≠ PEA/APE), so reordering them
  // would collapse distinct solutions — sort the rows, never a tuple's lanes.
  if (!isTupleChain(stack)) sortGroupChains(groups, sortList[0].key);
  return [...groups].sort(cmp);
}

// Total order (like groupRowComparator): the joined atom-norm key breaks chain-axis
// ties so the streamed transform merge equals a from-scratch sort. Drop the tiebreak
// and completion silently reshuffles tied rows out from under the stream.
export function chainRowComparator(sortList, stack) {
  const axis = composeSortAxis(sortList, sortAxes(chainSortTier(stack), stack));
  if (!axis) return null;
  const dir = sortList[0].dir;
  const key = r => rowAtoms(r).map(a => a.wlEntry.norm).join('\0');
  return (a, b) => compareItems(a, b, axis, dir) || key(a).localeCompare(key(b));
}

export function sortChainRows(rows, sortList, stack) {
  const cmp = chainRowComparator(sortList, stack);
  return cmp ? [...rows].sort(cmp) : rows;
}
