'use strict';

// Shared (not worker-copied) so main and the worker can't drift the grouped
// group/chain order — a divergence no error would catch. `stack` is explicit, not
// a ToolStack default, because the engine has no ToolStack.

export const groupMinScore     = g => g._minScore;
export const groupMaxScore     = g => g._maxScore;
export const groupCount        = g => g._count;
export const groupChainEntries = g => g.chains.map(c => c.atoms[0].wlEntry.norm);

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
  const seedEntry = c => c.atoms[0].wlEntry.norm;
  const seedScore = c => c.atoms[0].wlEntry.score;
  const byNorm = (a, b) => seedEntry(a).localeCompare(seedEntry(b));
  const byScore = (a, b) => seedScore(b) - seedScore(a) || byNorm(a, b);
  const cmp = sortKey === 'entry' ? byNorm : byScore;
  for (const g of groups) g.chains.sort(cmp);
}

// Chains sort before the groups (the Entry group axis projects off chain seed
// order via groupChainEntries) and unconditionally — gating the chain sort on the
// score range silently reorders chains off the designed seed order under a filter.
export function sortGroups(groups, sortKey, sortDir, stack) {
  const axis = groupSortAxes(stack)[sortKey];
  if (!axis) return groups;
  sortGroupChains(groups, sortKey);
  return [...groups].sort((a, b) => compareItems(a, b, axis, sortDir));
}
