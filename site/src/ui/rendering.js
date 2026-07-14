'use strict';

// ─── Rendering ────────────────────────────────────────────────────────────────
// Top of the ui layer. Must never import app/ or main.js: app-layer callees
// arrive through `configureRendering`, sibling-ui cycles are define-only.

import { MERGED_ID } from '../core/constants.js';
import { pluralize } from '../core/util.js';
import { effect } from '../core/signals.js';
import { invalidateStatsCache } from '../engine/stats.js';
import { bucketCounts, invalidateHistogramLayout } from '../engine/histogram.js';
import { PARAM_HELP } from '../engine/tools.js';
import { streamPlan } from '../engine/executor.js';
import {
  sources$, cacheVersion$, pipelineVersion$, configSummary$, errorMarks$, resultsStale$, bumpCacheVersion, state,
} from '../data/state.js';
import { lsSave } from '../data/storage.js';
import {
  getSourceCounts, invalidateSourceCounts, _mergedStatsKey, mergedEntryCount,
} from '../data/merge.js';
import { scopedHistogramLayout } from '../data/derived.js';
import { scoreColor } from '../model/score-display.js';
import { PopupHelp } from './components.js';
import { AppView, scopeKey, activeScoreRange } from './app-view.js';
import {
  EntriesScroller, EntryPanel, GroupMorePopover,
  reconcileSort, chainSortTier,
  buildEntriesTablePanelHTML, buildEntryHeadersHTML, onSortHeaderActivate,
} from './entries-table.js';
import { ToolStack, runPipeline } from './tool-stack.js';
import { repositionAllHistogramRects } from './histogram-view.js';
import { WordlistSelector } from './scope-selector.js';
import { DiscoveryBanner } from './discovery-banner.js';
import { sendWorkerScope, resyncWorkerConfig, reprojectPipeline, repatchPipeline } from './pipeline-worker.js';

let _refreshDerivedDisplays    = () => {};
let _deleteFromEdits           = () => {};
let _attachExternalEditHandlers = () => {};
let _buildScoreRangeInputHTML  = () => '';
let _buildExportMenuHTML       = () => '';

export function configureRendering({
  refreshDerivedDisplays, deleteFromEdits, attachExternalEditHandlers,
  buildScoreRangeInputHTML, buildExportMenuHTML,
}) {
  if (refreshDerivedDisplays)     _refreshDerivedDisplays = refreshDerivedDisplays;
  if (deleteFromEdits)            _deleteFromEdits = deleteFromEdits;
  if (attachExternalEditHandlers) _attachExternalEditHandlers = attachExternalEditHandlers;
  if (buildScoreRangeInputHTML)   _buildScoreRangeInputHTML = buildScoreRangeInputHTML;
  if (buildExportMenuHTML)        _buildExportMenuHTML = buildExportMenuHTML;
}

let entriesScroller = null;

// Accessor, not a direct export of the binding: createScroller reassigns
// `entriesScroller`, so a captured binding would freeze at its boot-time null.
export function getEntriesScroller() {
  return entriesScroller;
}

// Scoped-source-only: on All Wordlists the open editor edits tier labels, which
// don't remap scores, so a raw → rescored arrow would be meaningless there.
export function rescorePreviewActive() {
  return state.selected !== MERGED_ID && WordlistSelector.isEditorOpen();
}

function buildStatItemHTML(label, value, title, extraClass) {
  const cls = 'stat' + (extraClass ? ' ' + extraClass : '');
  return `<div class="${cls}"${title ? ` title="${title}"` : ''}>
    <span class="stat-label">${label}</span>
    <span class="stat-value bar-headline">${value}</span>
  </div>`;
}

// The render dispatcher is three effects:
//   - render effect — reads `cacheVersion$`, dispatches the panel render
//     (full render on first run, in-place scroller update on subsequent
//     cache bumps). The panel always shows the merged view, so there's no
//     selection to dispatch on.
//   - pipeline effect — reads `pipelineVersion$`, re-runs the pipeline and
//     refreshes the scroller for tool-stack/search changes, skipping the cache
//     branch's merge rebuild (the sources didn't change).
//   - cosmetic effect — subscribes to per-wordlist `name$`/`icon$`/`url$`/
//     `publisherId$` signals across all sources; cosmetic field changes
//     re-render the list/dropdown/dialog and visible scroller rows without
//     touching the merged cache
// Helpers that want to repaint after a cache change bump `cacheVersion$` via
// `repaintAfterCacheChange`. Cosmetic field setters just write the signal —
// the cosmetic effect notices and repaints.
//
// `renderAll()` is the entry point: first call wires up the effects (the
// render effect's first run does the initial paint); subsequent calls bump
// `cacheVersion$` and let the effect dispatch.
let _renderEffectActive = false;
let _firstRenderDone = false;
let _pipelineEffectFirstRun = true;
let _cosmeticEffectFirstRun = true;
let _configSummaryEffectFirstRun = true;

let _signalFirstPaint;
export const firstPaint = new Promise(r => { _signalFirstPaint = r; });

export function setupRenderEffect() {
  if (_renderEffectActive) return;
  _renderEffectActive = true;
  effect(() => {
    cacheVersion$.get();             // subscribe to cache-change bumps

    if (!_firstRenderDone) {
      _firstRenderDone = true;
      renderSources();
      WordlistSelector.refresh();
      DiscoveryBanner.refresh();
      renderMergedDetail();
      return;
    }

    // Cache change — refresh derived state in place rather than rebuilding
    // the panel and the scroller.
    refreshSourceCounts();        // rebuild caches before any UI reads them
    // Every cacheVersion$ bump is a config change (rules/enable/order/…); re-sync
    // so the worker's owned state can't go stale-but-fresh (silent row corruption,
    // since the snapshot no longer clears freshness). A fetch/import takes the
    // in-place applyFetched diff path instead and never bumps cacheVersion$.
    resyncWorkerConfig();
    repaintAfterConfigChange();
    if (entriesScroller) {
      entriesScroller.resetSelectionForViewChange();
      refreshMergedScroller();
    }
  });

  // Pipeline effect for tool-stack/search changes. Two things that look missing
  // but aren't: the stats bar isn't repainted here — refreshMergedScroller's
  // updateEntries fires onFilterChange, which does it; and refreshSourceCounts is
  // deliberately absent — rebuilding the merge on a keystroke is the freeze this
  // whole split exists to kill (see pipelineVersion$ in state.js).
  effect(() => {
    pipelineVersion$.get();
    if (_pipelineEffectFirstRun) {
      _pipelineEffectFirstRun = false;
      return;            // render effect's first run already painted everything
    }
    if (entriesScroller) {
      entriesScroller.resetSelectionForViewChange();
      refreshMergedScroller();
    }
  });

  // Two error channels, two signals: parse errors (pipelineVersion$, every
  // keystroke/stack edit) and async runtime errors (errorMarks$, from the worker).
  // Reacting to these — never to a run resolving — is what stops a ⚠ from lagging
  // behind a superseded run, the failure mode that gating on the run produced.
  effect(() => {
    pipelineVersion$.get();
    errorMarks$.get();
    ToolStack.refreshRowMarks();
  });

  // Cosmetic effect: re-renders the wordlist list and the merged scroller's
  // per-row source column when any wordlist's name/icon/url/publisher
  // changes. Cache-affecting fields (enabled, rescoreRules) route through
  // `cacheVersion$` instead since changing them invalidates derived state.
  effect(() => {
    const sources = sources$.get();
    for (const wl of sources) {
      wl.name$.get();
      wl.icon$.get();
      wl.url$.get();
      wl.publisherId$.get();
    }
    if (_cosmeticEffectFirstRun) {
      _cosmeticEffectFirstRun = false;
      return;            // render effect's first run already painted everything
    }
    renderSources();
    WordlistSelector.refresh();   // a renamed/re-iconed source restyles the rows
    if (entriesScroller) entriesScroller._render();
  });

  // The worker's per-config summaries (X-of-Y counts, merged total, badge axis)
  // arrive AFTER the cacheVersion$ bump that re-synced — the cache branch above
  // already painted with the stale shipped values, so this repaints the count
  // displays once the fresh ones land. Separate from cacheVersion$ so it can't
  // re-trigger the re-sync (an infinite loop).
  effect(() => {
    configSummary$.get();
    if (_configSummaryEffectFirstRun) {
      _configSummaryEffectFirstRun = false;
      return;
    }
    renderSources();
    _refreshDerivedDisplays();
    WordlistSelector.refresh();
    refreshStatsBarFromScroller();
  });

  effect(() => {
    resultsStale$.get();
    syncResultsStaleChip();
  });
}

export function renderAll() {
  if (!_renderEffectActive) setupRenderEffect();
  else bumpCacheVersion();
}

// Warms the source-count cache for "X used" meta so cosmetic-effect callers
// don't crash if a cache-affecting helper invalidated the merged cache earlier
// in the same drain. The render effect's cache branch has already rebuilt by the
// time it calls renderSources, so the lazy path is only hit when no cache
// rebuild is in flight.
export function renderSources() {
  getSourceCounts();
}


// Pure cache rebuild — invalidate merged/override/stats caches and re-warm the
// source counts so the next renderSources sees fresh meta. Does no rendering
// itself; the render effect's cache branch calls this and then `renderSources`
// to paint with the rebuilt counts.
export function refreshSourceCounts() {
  invalidateSourceCounts();
  invalidateStatsCache(_mergedStatsKey);
  getSourceCounts();
}

// The non-worker repaints a config change needs (list, selector, discovery banner,
// derived displays). Shared by the cacheVersion$ effect and the fetch/import path
// so the two can't drift; each pairs it with its own worker sync (full resync vs
// the in-place applyFetched diff).
export function repaintAfterConfigChange() {
  refreshSourceCounts();        // rebuild caches before any UI reads them
  renderSources();              // list/dialog with fresh meta
  WordlistSelector.refresh();   // add/remove/reorder/enable changes the list
  DiscoveryBanner.refresh();    // import can populate the scoped XWI source
  _refreshDerivedDisplays();    // scoring legend + main-panel stats bar
}

export function createScroller() {
  EntryPanel.close();
  GroupMorePopover.close();
  entriesScroller?.destroy();
  entriesScroller = new EntriesScroller(document.getElementById('vs-host'));
  return entriesScroller;
}

function currentSort() {
  return AppView.sortList;
}

export async function refreshMergedScroller() {
  const stack = ToolStack.getStack();
  reconcileSort(stack);
  if (!entriesScroller) return;
  // Not redundant with the first batch's pipeline-streaming class: a tuple run's first
  // tuple is ~1s late, so without this the prior result sits on screen looking current
  // for that gap.
  if (streamPlan(stack).tier === 'tuple') entriesScroller.beginStreamPending();
  const result = await runPipeline(stack, currentSort());
  if (result.aborted || !entriesScroller) return;
  entriesScroller.updateEntries(result, result.atomCount, chainSortTier(stack));
}

// A sort / score-range change is a VIEW change: re-derive the view over the worker's
// retained join (no re-join). reconcileSort first so an invalid sort key for the tier
// isn't sent. Falls back to a full re-run only when the worker no longer holds the
// displayed run fresh (reprojectStale — a scope/config change since it settled).
export async function reprojectMergedScroller(recomputeHistogram = false) {
  const stack = ToolStack.getStack();
  reconcileSort(stack);
  if (!entriesScroller) return;
  const { stale } = await reprojectPipeline(currentSort(), activeScoreRange() || null, recomputeHistogram);
  if (stale) refreshMergedScroller();
}

// Refresh a FLAT result in place after a background structural auto-update, no chip
// (§ Fetching & updates). Unlike reprojectMergedScroller it rebindEntry's afterward: a
// repatch changes the SET, so an open panel bound to a now-deleted row must re-bind.
export async function repatchMergedScroller() {
  const stack = ToolStack.getStack();
  reconcileSort(stack);
  if (!entriesScroller) return;
  const { stale } = await repatchPipeline(stack, currentSort(), activeScoreRange() || null);
  if (stale) { refreshMergedScroller(); return; }
  EntryPanel.rebindEntry(entriesScroller);
}


// The histogram layout cache assumes one corpus, so a scope change must drop it
// before the pipeline re-runs — otherwise the prior scope's memoized axis leaks
// into the new view with no error. (The worker's prefix cache needs no hook: its
// corpus-identity test invalidates the old scope's tiles on the rebuild.)
export async function setScope(target) {
  if (state.selected === target) return;
  state.selected = target;
  lsSave('selectedScope', scopeKey(target));
  invalidateHistogramLayout();
  WordlistSelector.refresh();
  DiscoveryBanner.refresh();
  // Before the scope's run: FIFO must put the worker's ownedCorpus rebuild ahead
  // of that run's fetchRows, or rich rows enrich from the prior scope's corpus.
  sendWorkerScope(target === MERGED_ID ? MERGED_ID : target?.dbKey ?? MERGED_ID);
  await renderMergedDetail();
}

export function mountPanel(panel) {
  panel.innerHTML = `
    <div class="sticky-stack">
      ${ToolStack.buildHTML()}
      <div id="stats">${buildStatsBarHTML()}</div>
      ${buildEntryHeadersHTML()}
    </div>
    ${buildEntriesTablePanelHTML()}
  `;
  ToolStack.refreshGalleryActive();
  ToolStack.refreshRowMarks();
  repositionAllHistogramRects();
  createScroller();
  entriesScroller.onFilterChange = refreshStatsBarFromScroller;
  document.getElementById('stats')?.addEventListener('click', e => {
    if (e.target.closest('[data-action="refresh-results"]')) refreshMergedScroller();
  });
  attachHelpPopups();
  publishBarHeights();
  const stickyStack = panel.querySelector('.sticky-stack');
  const obs = stickyObserver();
  obs.disconnect();
  obs.observe(stickyStack);
  const wordlistBar = document.getElementById('wordlist-bar');
  if (wordlistBar) obs.observe(wordlistBar);
  // Delegate rather than bind the header cells directly: rebuildEntryHeaders
  // replaces them via outerHTML on every sort change, which would orphan a
  // direct listener after the first sort.
  stickyStack.addEventListener('click', onSortHeaderActivate);
  stickyStack.addEventListener('keydown', onSortHeaderActivate);
}

export function buildStatsBarHTML() {
  const scroller = entriesScroller;
  const grouped = scroller ? scroller.sortTier === 'group' : false;
  const tuple = scroller ? scroller.sortTier === 'tuple' : false;
  const groupCount = grouped ? scroller._groupCount() : null;
  const countValue = grouped
    ? (scroller ? scroller._visibleGroupChainCount() : 0)
    : tuple ? scroller._groupCount()
    : (scroller ? scroller._renderRowCount() : 0);
  const layout = scopedHistogramLayout();

  const isEmpty = !countValue;
  // The worker's counts pair with the layout its run bucketed against; during a
  // scope switch the live layout updates a frame before the next run re-stamps the
  // counts, so a length mismatch means they're from different runs — show zero bars
  // for that frame rather than index past the stale array.
  const workerCounts = scroller?._workerHistogramCounts;
  const counts = (workerCounts && workerCounts.length === layout.slots.length)
    ? workerCounts
    : bucketCounts([], layout);
  const scale = Math.max(...counts, 1);
  const barH = c => c === 0 ? 0 : Math.max(2, Math.round((c / scale) * 34));

  const bars = layout.slots.map((s, i) => {
    const c = counts[i];
    const title = `${pluralize(c, 'entry', 'entries')} scored ${s.label} • Click to filter`;
    const { bg } = scoreColor((s.lo + s.hi) / 2);
    return `<div class="histogram-col" title="${title}"><div class="histogram-bar" data-lo="${s.lo}" data-hi="${s.hi}" style="--score-bg:${bg}; height:${barH(c)}px"></div></div>`;
  }).join('');

  const incomplete = !!(tuple && scroller?._capped);
  const countText = countValue.toLocaleString() + (incomplete ? '+' : '');
  const countsHTML = groupCount != null
    ? buildStatItemHTML('Entries', countValue.toLocaleString(), null, 'stat-entries') +
      buildStatItemHTML('Groups', groupCount.toLocaleString())
    : buildStatItemHTML(tuple ? 'Results' : 'Entries', countText, incomplete ? 'Results incomplete' : null, 'stat-entries');

  const rangeHTML = _buildScoreRangeInputHTML('score-range-input', AppView.scoreRange, 'AppView');
  const exportHTML = _buildExportMenuHTML();

  return `<div class="stats-bar${isEmpty ? ' stats-empty' : ''}">
      <div class="stats-bar-counts">${countsHTML}</div>
      <div class="stats-bar-distribution">
        <div class="histogram" title="Histogram • Click to filter" onpointerdown="onHistogramPointerDown(event)">${bars}<div class="histogram-rect" hidden></div></div>
        ${rangeHTML}
        ${buildResultsStaleChipHTML()}
      </div>
      <div class="stats-bar-controls">${exportHTML}</div>
    </div>`;
}

function buildResultsStaleChipHTML() {
  return `<button type="button" class="results-stale-chip primary" data-action="refresh-results"${resultsStale$.peek() ? '' : ' hidden'}`
    + ` title="A wordlist changed in the background. Refresh to apply the added and removed entries.">`
    + `<svg class="results-stale-icon" width="12" height="12" aria-hidden="true"><use href="#icon-reset"/></svg>Refresh</button>`;
}

// swapStatsBarReadouts replaces only the .histogram in .stats-bar-distribution, not the
// chip beside the score-range box, so the chip survives scroller repaints and its
// visibility rides resultsStale$ alone.
export function syncResultsStaleChip() {
  const chip = document.querySelector('#stats .results-stale-chip');
  if (chip) chip.hidden = !resultsStale$.peek();
}

export function refreshStatsBarFromScroller() {
  if (!entriesScroller) return;
  const bar = document.querySelector('#stats .stats-bar');
  if (!bar) return;
  // Floor the Entries readout's width to the merged-corpus count, so the live count
  // climbing through a stream can't widen it and shove Min/Max sideways.
  bar.style.setProperty('--entries-ch', String(Math.max(1, mergedEntryCount().toLocaleString().length)));
  swapStatsBarReadouts(bar, buildStatsBarHTML());
  syncStreamDots(bar, entriesScroller.isStreaming());
  repositionAllHistogramRects();
}

function swapStatsBarReadouts(bar, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const next = tmp.querySelector('.stats-bar');
  if (!next) return;
  bar.querySelector('.stats-bar-counts')?.replaceWith(next.querySelector('.stats-bar-counts'));
  // Replace only the histogram, not the whole cell: a wholesale replaceWith would
  // detach the persistent .stream-dots child (restarting its CSS animation) and the
  // .score-range-label (dropping the user's focus/typing mid-edit).
  const dist = bar.querySelector('.stats-bar-distribution');
  const nextDist = next.querySelector('.stats-bar-distribution');
  if (dist && nextDist) {
    dist.querySelector('.histogram')?.replaceWith(nextDist.querySelector('.histogram'));
  }
  bar.className = next.className;
}

function syncStreamDots(bar, streaming) {
  const dist = bar.querySelector('.stats-bar-distribution');
  if (!dist) return;
  const existing = dist.querySelector('.stream-dots');
  if (streaming && !existing) {
    const dots = document.createElement('span');
    dots.className = 'stream-dots worm-spinner';
    dots.setAttribute('role', 'status');
    dots.setAttribute('aria-label', 'Still finding entries');
    dots.innerHTML = '<span></span><span></span><span></span>';
    dist.append(dots);
  } else if (!streaming) {
    existing?.remove();
  }
}

export function publishBarHeights() {
  const stack = document.getElementById('tool-stack');
  if (stack) document.documentElement.style.setProperty('--tool-stack-h', stack.offsetHeight + 'px');
  const stats = document.getElementById('stats');
  if (stats) document.documentElement.style.setProperty('--stats-bar-h', stats.offsetHeight + 'px');
  const stickyStack = document.querySelector('#app .sticky-stack');
  if (stickyStack) document.documentElement.style.setProperty('--sticky-stack-h', stickyStack.offsetHeight + 'px');
  const bar = document.getElementById('wordlist-bar');
  if (bar) document.documentElement.style.setProperty('--wordlist-bar-h', bar.offsetHeight + 'px');
}
// Lazily constructed: a sibling ui module (entries-table) imports this one, and
// its node unit tests evaluate the module where ResizeObserver doesn't exist.
let _stickyObserver = null;
function stickyObserver() {
  return _stickyObserver ??= new ResizeObserver(publishBarHeights);
}

export function refreshStatsBarOverflow() {
  for (const bar of document.querySelectorAll('.stats-bar')) {
    bar.classList.remove('stats-no-hist', 'stats-no-entries');
    const overlapsControls = () => {
      const ctrls = bar.querySelector('.stats-bar-controls');
      if (!ctrls) return false;
      const ctrlsLeft = ctrls.getBoundingClientRect().left;
      for (const el of bar.querySelectorAll('.stats-bar-counts, .histogram, .score-range-label')) {
        if (!el.offsetWidth) continue;
        if (el.getBoundingClientRect().right > ctrlsLeft + 0.5) return true;
      }
      return false;
    };
    if (overlapsControls()) {
      bar.classList.add('stats-no-hist');
      if (overlapsControls()) bar.classList.add('stats-no-entries');
    }
  }
}
export function mountStatsBarOverflowObservers() {
  const parent = document.getElementById('detail-panel');
  if (!parent) return;
  new ResizeObserver(refreshStatsBarOverflow).observe(parent);
  // A scroll re-renders rows inside #vs-host — irrelevant to the stats bar's fit;
  // skipping those keeps the overflow recompute (a forced reflow) off the scroll path.
  new MutationObserver(records => {
    const host = entriesScroller?.host;
    if (host && records.every(r => host.contains(r.target))) return;
    refreshStatsBarOverflow();
  }).observe(parent, { childList: true, subtree: true });
}

export function mountHeaderHeightObserver() {
  const headerEl = document.querySelector('header');
  const publish = () => document.documentElement.style.setProperty(
    '--header-h', headerEl.offsetHeight + 'px'
  );
  publish();
  new ResizeObserver(publish).observe(headerEl);
}

// Help anchors are rebuilt whenever the panel re-renders (mountPanel,
// rerenderRows), so destroy the prior popups and rebind from a fresh
// document-wide scan for `data-help`.
let _helpPopups = [];
export function attachHelpPopups() {
  _helpPopups.forEach(p => p.destroy());
  _helpPopups = [];
  for (const input of document.querySelectorAll('[data-help]')) {
    const content = PARAM_HELP[input.dataset.help];
    if (!content) continue;
    const placement = input.closest('.tool-row-replace') ? 'below' : 'above';
    _helpPopups.push(new PopupHelp(input, content, { placement }));
  }
}

export async function renderMergedDetail() {
  let run;
  const stack = ToolStack.getStack();
  try {
    const panel = document.getElementById('detail-panel');
    reconcileSort(stack);
    mountPanel(panel);
    entriesScroller._onDeleteRow = entry => _deleteFromEdits(entry, refreshMergedScroller);
    _attachExternalEditHandlers(entriesScroller, refreshMergedScroller);
    if (streamPlan(stack).tier === 'tuple') entriesScroller.beginStreamPending();
    run = runPipeline(stack, currentSort());
  } finally {
    // Release the splash once the run is dispatched, before awaiting it: the
    // splash covers the corpus build (gated with workerReady), not the pipeline,
    // so awaiting the result would strand it behind a slow/broken boot-URL tool.
    // `finally` so a setup throw dismisses it too.
    _signalFirstPaint();
  }
  const result = await run;
  if (result.aborted) return;
  entriesScroller.setEntries(result, result.atomCount, chainSortTier(stack));
}
