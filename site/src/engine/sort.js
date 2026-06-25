'use strict';

// Shared (not worker-copied) so main and the worker can't drift the sort order —
// a divergence no error would catch. Lives in engine/ (not ui/) so the worker
// sorts every tier exactly the way main labels its headers. `stack` is always an
// explicit argument, never a ToolStack default, because the engine has no ToolStack.

import { rowLastEntry, isGroupChain, isFilterOnlyChain } from './executor.js';
import { TOOLS } from './tools.js';

// ─── Chain-tier sort axes (single / multi) ───────────────────────────────────
//
// The chain tiers sort materialized chain rows (object-shaped axes), unlike the
// flat tier's index-shaped FLAT_SORT_AXES copy in the worker. Each axis declares
// a primary projection and a fixed-direction tiebreaker chain — when the primary
// ties, fall to whichever direction surfaces the most interesting rows first
// (longer > shorter, higher score > lower), alphabetical asc as the final stable
// tiebreaker. Flipping the asc/desc toggle reverses only the primary; tiebreakers
// keep their declared direction, so "score asc" still shows the longest among the
// lowest-scoring rows first instead of letting short junk float up a tied bucket.
//
// A multi-output transform (anagram) branches one input into rows that share
// their whole first atom; rowChainTail breaks those ties by the later atoms.
// A bare seed row (no `.atoms`) is a single undecorated entry: its own first entry,
// its only score, with no later atoms to tie-break on.
const rowFirstEntry = r => r.atoms ? r.atoms[0].wlEntry : r;
export const rowMinScore = r => r.atoms ? Math.min(...r.atoms.map(a => a.wlEntry.score)) : r.score;
export const rowMaxScore = r => r.atoms ? Math.max(...r.atoms.map(a => a.wlEntry.score)) : r.score;
// Later atoms joined with a low separator: a string compare then orders them
// atom-by-atom, since every row in a run carries the same atom count.
const rowChainTail = r => !r.atoms ? '' : r.atoms.slice(1).map(a => a.wlEntry.norm).join('\u0000');

// Source sorts alphabetically by name. Reading `.wordlist.name` (a runtime property)
// keeps this engine-pure — sorting by merge position would need `state.sources`, an
// upward import the engine layer forbids. The worker learns names via syncConfig so
// its corpus rows carry `.wordlist.name` too.
const rowSourceName = r => rowFirstEntry(r).wordlist?.name || '';

const SORT_AXES = {
  single: {
    entry: {
      label: 'Entry',
      primary: r => rowFirstEntry(r).norm,
      tiebreakers: [
        { project: r => rowFirstEntry(r).norm.length, dir: 'desc' },
        { project: r => rowFirstEntry(r).score,        dir: 'desc' },
      ],
    },
    length: {
      label: 'Length',
      primary: r => rowFirstEntry(r).norm.length,
      tiebreakers: [
        { project: r => rowFirstEntry(r).score, dir: 'desc' },
        { project: r => rowFirstEntry(r).norm, dir: 'asc'  },
      ],
    },
    score: {
      label: 'Score',
      primary: r => rowFirstEntry(r).score,
      tiebreakers: [
        { project: r => rowFirstEntry(r).norm.length, dir: 'desc' },
        { project: r => rowFirstEntry(r).norm,        dir: 'asc'  },
      ],
    },
    comment: {
      label: 'Comment',
      primary: r => rowFirstEntry(r).comment || '',
      tiebreakers: [
        { project: r => rowFirstEntry(r).norm, dir: 'asc' },
      ],
    },
    source: {
      label: 'Source',
      primary: rowSourceName,
      tiebreakers: [
        { project: r => rowFirstEntry(r).norm, dir: 'asc' },
      ],
    },
  },
  multi: {
    entry: {
      label: 'Entry',
      primary: r => rowFirstEntry(r).norm,
      // First-atom entries are unique per input, so the only ties are a
      // multi-output transform's branches — settled by the chain tail.
      tiebreakers: [
        { project: rowChainTail, dir: 'asc' },
      ],
    },
    length: {
      label: 'Length',
      primary: r => rowFirstEntry(r).norm.length,
      // First-atom score then entry replays the tool-less Length order; the
      // chain tail then separates a multi-output transform's branches.
      tiebreakers: [
        { project: r => rowFirstEntry(r).score, dir: 'desc' },
        { project: r => rowFirstEntry(r).norm, dir: 'asc'  },
        { project: rowChainTail,                dir: 'asc'  },
      ],
    },
    'min-score': {
      label: 'Min score',
      primary: rowMinScore,
      tiebreakers: [
        { project: r => rowLastEntry(r).norm.length, dir: 'desc' },
        { project: r => rowLastEntry(r).norm,        dir: 'asc'  },
      ],
    },
    'max-score': {
      label: 'Max score',
      primary: rowMaxScore,
      tiebreakers: [
        { project: r => rowLastEntry(r).norm.length, dir: 'desc' },
        { project: r => rowLastEntry(r).norm,        dir: 'asc'  },
      ],
    },
    comment: {
      label: 'Comment',
      primary: r => rowFirstEntry(r).comment || '',
      tiebreakers: [
        { project: r => rowFirstEntry(r).norm, dir: 'asc' },
        { project: rowChainTail,                dir: 'asc' },
      ],
    },
    source: {
      label: 'Source',
      primary: rowSourceName,
      tiebreakers: [
        { project: r => rowFirstEntry(r).norm, dir: 'asc' },
        { project: rowChainTail,                dir: 'asc' },
      ],
    },
  },
};
export const DEFAULT_SORT_BY_TIER = { single: 'entry', multi: 'entry', group: 'entry' };

// The sort tier is single-atom when the chain is filter-only and multi-atom once
// a transform is in play — transforms are what give a row genuinely distinct
// atoms to sort across. Highlight-only repeat atoms don't promote the tier:
// they're all the same word and score.
export function chainSortTier(stack) {
  if (isGroupChain(stack)) return 'group';
  return isFilterOnlyChain(stack) ? 'single' : 'multi';
}
export function sortAxes(tier, stack) {
  return tier === 'group' ? groupSortAxes(stack) : SORT_AXES[tier];
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
export const groupCount        = g => g._count;
export const groupChainEntries = g => g.chains.map(c => rowFirstEntry(c).norm);

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
        primary: g => g.anchor.norm,
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
        { project: g => g.anchor.norm, dir: 'asc' },
        { project: groupCount,         dir: 'desc' },
      ],
    };
    baseAxes['score'] = {
      label: `${anchorLabel} score`,
      primary: g => g.anchor.score,
      tiebreakers: [
        { project: g => g.anchor.norm, dir: 'asc' },
        { project: groupCount,         dir: 'desc' },
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

// primaryDir flips only the primary; tiebreakers keep their declared direction,
// so flipping asc/desc can't reshuffle within a tied bucket.
export function compareItems(a, b, axis, primaryDir) {
  const primCmp = compareValues(axis.primary(a), axis.primary(b)) * (primaryDir === 'asc' ? 1 : -1);
  if (primCmp !== 0) return primCmp;
  for (const tb of axis.tiebreakers) {
    const cmp = compareValues(tb.project(a), tb.project(b)) * (tb.dir === 'asc' ? 1 : -1);
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
  const seedEntry = c => rowFirstEntry(c).norm;
  const seedScore = c => rowFirstEntry(c).score;
  const byNorm = (a, b) => seedEntry(a).localeCompare(seedEntry(b));
  const byScore = (a, b) => seedScore(b) - seedScore(a) || byNorm(a, b);
  const cmp = sortKey === 'entry' ? byNorm : byScore;
  for (const g of groups) g.chains.sort(cmp);
}

// Chains sort before the groups (the Entry group axis projects off chain seed
// order via groupChainEntries) and unconditionally — gating the chain sort on the
// score range silently reorders chains off the designed seed order under a filter.
export function sortGroups(groups, sortList, stack) {
  const axis = composeSortAxis(sortList, groupSortAxes(stack));
  if (!axis) return groups;
  sortGroupChains(groups, sortList[0].key);
  return [...groups].sort((a, b) => compareItems(a, b, axis, sortList[0].dir));
}

export function sortChainRows(rows, sortList, stack) {
  const axis = composeSortAxis(sortList, sortAxes(chainSortTier(stack), stack));
  if (!axis) return rows;
  return [...rows].sort((a, b) => compareItems(a, b, axis, sortList[0].dir));
}
