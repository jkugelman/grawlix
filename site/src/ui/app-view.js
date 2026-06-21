'use strict';

// ─── App view ─────────────────────────────────────────────────────────────────

import { MERGED_ID } from '../core/constants.js';
import { parseRange } from '../engine/range.js';
import { state } from '../data/state.js';
import { lsSave, lsDel } from '../data/storage.js';
import { ToolStack } from './tool-stack.js';
import { repositionAllHistogramRects } from './histogram-view.js';
import { reconcileSort, chainSortTier, DEFAULT_SORT_BY_TIER } from './entries-table.js';
import { getEntriesScroller } from './rendering.js';

export const scopeKey = scope => scope === MERGED_ID ? MERGED_ID : scope.dbKey;

export function activeScoreRange() { return AppView.scoreRange; }

export function normalizeScoreRange(value, inputId) {
  const trimmed = (value || '').trim();
  const intervals = trimmed === '' ? null : parseRange(trimmed);
  const inp = document.getElementById(inputId);
  if (inp) inp.classList.toggle('invalid', trimmed !== '' && intervals === null);
  return (trimmed && intervals) ? trimmed : '';
}

export const AppView = (() => {
  // View-private state. Read externally via the getters in the returned
  // object; written either through the handlers below or through
  // `applyURLState` (Router) / `restoreScoreRanges` (boot). The sort state
  // is mutated by EntriesScroller's toolbar via `setSortList`.
  // Search query / whole-word are *not* here — they live in the permanent
  // Search bar's ToolStack row params; the getters below read them from it.
  let _scoreRanges     = {};
  let _sortList        = [{ key: 'entry', dir: 'asc' }];

  function activeScopeKey() { return scopeKey(state.selected); }
  function activeScoreRange() { return _scoreRanges[activeScopeKey()] || ''; }

  function show() {
    // Reposition once the bars are laid out: rect positioning reads live
    // offsetLeft/offsetWidth, and a write before layout would silently bake a
    // 0-based position into the saved rect.
    repositionAllHistogramRects();
  }

  function onScoreRange(value) {
    const range = normalizeScoreRange(value, 'score-range-input');
    if (range) _scoreRanges[activeScopeKey()] = range;
    else       delete _scoreRanges[activeScopeKey()];
    persistScoreRanges();
    getEntriesScroller()?.setScoreRange(range);
    repositionAllHistogramRects();
  }

  function persistScoreRanges() {
    if (Object.keys(_scoreRanges).length) lsSave('scoreRanges', JSON.stringify(_scoreRanges));
    else                                  lsDel('scoreRanges');
  }
  // Canonical sort write. No filter call here — the scroller re-applies sort
  // itself; this just holds the source of truth the getters and URL read.
  function setSortList(list) { _sortList = list.length ? list.map(s => ({ ...s })) : [{ key: 'entry', dir: 'asc' }]; }

  // Bulk-apply URL sort state at boot, after Router has set the tool stack.
  // legacyDir carries an old `sort-dir=` that arrived with no `sort=` — the
  // default axis at that direction — so an old shared link keeps its direction.
  function applyURLState({ sortList, legacyDir }) {
    const stack = ToolStack.getStack();
    _sortList = (sortList && sortList.length)
      ? sortList.map(s => ({ ...s }))
      : [{ key: DEFAULT_SORT_BY_TIER[chainSortTier(stack)], dir: legacyDir || 'asc' }];
    reconcileSort(stack);
  }

  // Score-range is the lone state field that's localStorage-backed (it's a
  // standing preference, not a shared URL parameter — see design.md § Out of
  // scope for the URL). Boot hands the validated per-scope map to this setter.
  function restoreScoreRanges(map) { _scoreRanges = map; }

  return {
    show,
    onScoreRange,
    setSortList, applyURLState, restoreScoreRanges,
    get searchQuery()     { return ToolStack.getSearchBarRow().params.pattern || ''; },
    get scoreRange()      { return activeScoreRange(); },
    get sortKey()         { return _sortList[0].key; },
    get sortDir()         { return _sortList[0].dir; },
    get sortList()        { return _sortList.map(s => ({ ...s })); },
  };
})();
