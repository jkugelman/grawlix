'use strict';

// ─── App view ─────────────────────────────────────────────────────────────────

import { MERGED_ID } from '../core/constants.js';
import { parseRange } from '../engine/range.js';
import { state } from '../data/state.js';
import { lsSave, lsDel } from '../data/storage.js';
import { ToolStack } from './tool-stack.js';
import { repositionAllHistogramRects } from './histogram-view.js';

export const scopeKey = scope => scope === MERGED_ID ? MERGED_ID : scope.dbKey;

export function normalizeScoreRange(value, inputId) {
  const trimmed = (value || '').trim();
  const intervals = trimmed === '' ? null : parseRange(trimmed);
  const inp = document.getElementById(inputId);
  if (inp) inp.classList.toggle('invalid', trimmed !== '' && intervals === null);
  return (trimmed && intervals) ? trimmed : '';
}

// Sort reconciliation and the entries scroller live in the rendering layer
// (still in main.js). They're injected so this near-leaf view doesn't reach
// upward; boot() supplies them via configureAppView.
let _reconcileSort       = () => {};
let _defaultSortAxis     = () => 'entry';
let _setScrollerScoreRange = () => {};

export function configureAppView({ reconcileSort, defaultSortAxis, setScrollerScoreRange }) {
  if (reconcileSort)         _reconcileSort = reconcileSort;
  if (defaultSortAxis)       _defaultSortAxis = defaultSortAxis;
  if (setScrollerScoreRange) _setScrollerScoreRange = setScrollerScoreRange;
}

export const AppView = (() => {
  // View-private state. Read externally via the getters in the returned
  // object; written either through the handlers below or through
  // `applyURLState` (Router) / `restoreScoreRanges` (boot). The sort state
  // is mutated by EntriesScroller's toolbar via `setSort`.
  // Search query / whole-word are *not* here — they live in the permanent
  // Search bar's ToolStack row params; the getters below read them from it.
  let _scoreRanges     = {};
  let _sortKey         = 'entry';
  let _sortDir         = 'asc';

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
    _setScrollerScoreRange(range);
    repositionAllHistogramRects();
  }

  function persistScoreRanges() {
    if (Object.keys(_scoreRanges).length) lsSave('scoreRanges', JSON.stringify(_scoreRanges));
    else                                  lsDel('scoreRanges');
  }
  // Sort state is mutated by EntriesScroller's toolbar when the user
  // picks a new axis or flips the direction. No filter call here — the
  // scroller re-applies sort itself; this just keeps the canonical state.
  function setSort(key, dir) { _sortKey = key; _sortDir = dir; }

  // Bulk-apply URL sort state at boot. Router parses the query string, sets
  // the tool stack (including the Search bar row), then hands us the sort
  // axis/direction. The search query itself rides in the stack, not here.
  function applyURLState({ sortKey, sortDir }) {
    _sortKey = sortKey || _defaultSortAxis(ToolStack.getStack());
    _sortDir = sortDir || 'asc';
    _reconcileSort(ToolStack.getStack());
  }

  // Score-range is the lone state field that's localStorage-backed (it's a
  // standing preference, not a shared URL parameter — see design.md § Out of
  // scope for the URL). Boot hands the validated per-scope map to this setter.
  function restoreScoreRanges(map) { _scoreRanges = map; }

  return {
    show,
    onScoreRange,
    setSort, applyURLState, restoreScoreRanges,
    get searchQuery()     { return ToolStack.getSearchBarRow().params.pattern || ''; },
    get scoreRange()      { return activeScoreRange(); },
    get sortKey()         { return _sortKey;         },
    get sortDir()         { return _sortDir;         },
  };
})();
