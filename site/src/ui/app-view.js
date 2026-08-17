'use strict';

// ─── App view ─────────────────────────────────────────────────────────────────

import { MERGED_ID } from '../core/constants.js';
import { parseRange } from '../engine/range.js';
import { lsSave, lsDel } from '../data/storage.js';
import { defaultScoreRange } from '../data/serialize.js';
import { ToolStack } from './tool-stack.js';
import { repositionAllHistogramRects } from './histogram-view.js';
import { reconcileSort, chainSortTier, DEFAULT_SORT_BY_TIER } from './entries-table.js';
import { getEntriesScroller } from './rendering.js';

export const scopeKey = scope => scope === MERGED_ID ? MERGED_ID : scope.dbKey;

let _navigate = () => {};
export function configureAppView({ navigate }) { _navigate = navigate; }

export function activeScoreRange() { return AppView.scoreRange; }

// '' whenever the filter is inert, so a disabled control can't reach the worker: the
// value stays in the URL and in the field, and every downstream consumer — rows,
// counts, histogram — sees no filter at all rather than a greyed one still biting.
export function activeLengthRange() { return lengthFilterDisabled() ? '' : AppView.lengthRange; }

// A tuple's lanes are simultaneous — one solution needs all of them — so no reading of
// "is this row 7 letters" holds. Derived from the stack, not the worker's laneKind, so
// the control greys the moment the tool is added rather than a run later.
export function lengthFilterDisabled() {
  return chainSortTier(ToolStack.getStack()) === 'tuple';
}

export function normalizeRangeInput(value, inputId) {
  const trimmed = (value || '').trim();
  const intervals = trimmed === '' ? null : parseRange(trimmed);
  const inp = document.getElementById(inputId);
  if (inp) inp.classList.toggle('invalid', trimmed !== '' && intervals === null);
  return (trimmed && intervals) ? trimmed : '';
}

export const AppView = (() => {
  // View-private state. Read externally via the getters in the returned
  // object; written either through the handlers below or through
  // `applyURLState` (Router) / `restoreScoreRange` (boot). The sort state
  // is mutated by EntriesScroller's toolbar via `setSortList`.
  // Search query / match mode are *not* here — they live in the permanent
  // Search bar's ToolStack row params; the getters below read them from it.
  let _scoreRange      = '';
  let _lengthRange     = '';
  let _sortList        = [{ key: 'entry', dir: 'asc' }];

  function show() {
    // Reposition once the bars are laid out: rect positioning reads live
    // offsetLeft/offsetWidth, and a write before layout would silently bake a
    // 0-based position into the saved rect.
    repositionAllHistogramRects();
  }

  function onScoreRange(value) {
    _scoreRange = normalizeRangeInput(value, 'score-range-input');
    persistScoreRange();
    getEntriesScroller()?.setScoreRange(_scoreRange);
    repositionAllHistogramRects();
  }

  // URL-backed, not localStorage-backed like the score range: a length is a query
  // ("what fits this slot"), not a standing preference, and it means the same thing on
  // any setup — see design.md § Out of scope for the URL.
  function onLengthRange(value) {
    _lengthRange = normalizeRangeInput(value, 'length-range-input');
    _navigate();
    getEntriesScroller()?.setLengthRange(activeLengthRange());
  }

  function restoreLengthRange(range) { _lengthRange = range; }

  // Stores '' too (not lsDel on blank): absence means "apply the default", so a
  // cleared filter must persist explicitly or reload re-applies it. See restoreScoreRange.
  function persistScoreRange() {
    lsSave('scoreRange', _scoreRange);
  }

  // Reset drops the stored key (not lsSave) so an untouched user keeps following
  // defaultScoreRange(); persisting the value would freeze them if the default moves.
  function resetScoreRange() {
    _scoreRange = defaultScoreRange();
    lsDel('scoreRange');
    getEntriesScroller()?.setScoreRange(_scoreRange);
    repositionAllHistogramRects();
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

  // Score-range is the lone state field that's localStorage-backed — a single
  // global filter (a standing preference, not a shared URL parameter — see
  // design.md § Out of scope for the URL). Boot hands the validated range here.
  function restoreScoreRange(range) { _scoreRange = range; }

  return {
    show,
    onScoreRange, resetScoreRange,
    onLengthRange, restoreLengthRange,
    setSortList, applyURLState, restoreScoreRange,
    get searchQuery()     { return ToolStack.getSearchBarRow().params.pattern || ''; },
    get scoreRange()      { return _scoreRange; },
    get lengthRange()     { return _lengthRange; },
    get sortKey()         { return _sortList[0].key; },
    get sortDir()         { return _sortList[0].dir; },
    get sortList()        { return _sortList.map(s => ({ ...s })); },
  };
})();

// ─── Score-range clear / reset button ─────────────────────────────────────────

function scoreRangeButtonMode(value) {
  return (value || '').trim() === defaultScoreRange() ? 'clear' : 'reset';
}

export function buildScoreRangeButtonHTML(value) {
  const reset = scoreRangeButtonMode(value) === 'reset';
  const label = reset ? `Reset to ${defaultScoreRange()}` : 'Clear';
  return `<button type="button" class="score-range-btn" data-mode="${reset ? 'reset' : 'clear'}" tabindex="-1"` +
    ` title="${label}" aria-label="${label}">` +
    `<svg width="10" height="10" aria-hidden="true"><use href="#icon-${reset ? 'reset' : 'x'}"/></svg></button>`;
}

export function syncScoreRangeButton(input) {
  const btn = input.closest('.clearable-input')?.querySelector('.score-range-btn');
  if (!btn) return;
  const reset = scoreRangeButtonMode(input.value) === 'reset';
  const label = reset ? `Reset to ${defaultScoreRange()}` : 'Clear';
  btn.dataset.mode = reset ? 'reset' : 'clear';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.querySelector('use').setAttribute('href', `#icon-${reset ? 'reset' : 'x'}`);
}

export function refreshScoreRangeButtons() {
  document.querySelectorAll('#score-range-input').forEach(syncScoreRangeButton);
}

export function mountScoreRangeControl() {
  document.addEventListener('input', e => {
    if (e.target.id === 'score-range-input') syncScoreRangeButton(e.target);
  });
  document.addEventListener('click', e => {
    const btn = e.target.closest('.score-range-btn');
    if (!btn) return;
    const input = btn.closest('.clearable-input').querySelector('input');
    if (btn.dataset.mode === 'reset') {
      AppView.resetScoreRange();
      input.value = AppView.scoreRange;
    } else {
      AppView.onScoreRange('');
      input.value = '';
    }
    input.focus();
    syncScoreRangeButton(input);
  });
}
