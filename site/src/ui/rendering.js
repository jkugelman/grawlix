'use strict';

// ─── Rendering ────────────────────────────────────────────────────────────────
// Top of the ui layer. Must never import app/ or main.js: app-layer callees
// arrive through `configureRendering`, sibling-ui cycles are define-only.

import { MERGED_ID } from '../core/constants.js';
import { esc, pluralize } from '../core/util.js';
import { effect } from '../core/signals.js';
import { invalidateStatsCache, computeStatsRaw } from '../engine/stats.js';
import { bucketCounts, invalidateHistogramLayout } from '../engine/histogram.js';
import { PARAM_HELP } from '../engine/tools.js';
import { invalidatePreSearchCache } from '../engine/executor.js';
import {
  sources$, cacheVersion$, pipelineVersion$, bumpCacheVersion, state, getEditsWordlist,
} from '../data/state.js';
import { lsSave } from '../data/storage.js';
import {
  getActiveCorpus, getSourceCounts, invalidateSourceCounts,
  dropScopedCorpus, _mergedStatsKey,
} from '../data/merge.js';
import { scopedHistogramLayout } from '../data/derived.js';
import { scoreColor } from '../model/score-display.js';
import { hashStringMod } from './icons.js';
import { PopupHelp } from './components.js';
import { AppView, scopeKey } from './app-view.js';
import {
  EntriesScroller, AtomPopover, GroupMorePopover,
  reconcileSort, chainSortTier,
  buildEntriesTablePanelHTML, buildEntryHeadersHTML, onSortHeaderActivate,
} from './entries-table.js';
import { ToolStack, runPipeline } from './tool-stack.js';
import { repositionAllHistogramRects } from './histogram-view.js';
import { WordlistSelector } from './scope-selector.js';
import { DiscoveryBanner } from './discovery-banner.js';

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
    <span class="stat-value">${value}</span>
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
    renderSources();              // list/dialog with fresh meta
    WordlistSelector.refresh();   // add/remove/reorder/enable changes the list
    DiscoveryBanner.refresh();    // import can populate the scoped XWI source
    _refreshDerivedDisplays();    // scoring legend + main-panel stats bar
    if (entriesScroller) refreshMergedScroller();
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
    if (entriesScroller) refreshMergedScroller();
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

export function createScroller() {
  AtomPopover.close();
  GroupMorePopover.close();
  entriesScroller?.destroy();
  entriesScroller = new EntriesScroller(document.getElementById('vs-host'));
  return entriesScroller;
}

function currentSort() {
  return { key: AppView.sortKey, dir: AppView.sortDir };
}

export async function refreshMergedScroller() {
  reconcileSort(ToolStack.getStack());
  if (!entriesScroller) return;
  const result = await runPipeline(getActiveCorpus(), ToolStack.getStack(), currentSort());
  if (result.aborted || !entriesScroller) return;
  entriesScroller.updateEntries(result, result.atomCount, chainSortTier(ToolStack.getStack()));
  ToolStack.refreshErrorMarks();
}

// The pre-search and histogram caches assume one corpus, so a scope change
// must drop both before the pipeline re-runs — otherwise the prior scope's
// memoized seed rows leak into the new view with no error.
export async function setScope(target) {
  if (state.selected === target) return;
  state.selected = target;
  lsSave('selectedScope', scopeKey(target));
  invalidatePreSearchCache();
  invalidateHistogramLayout();
  WordlistSelector.refresh();
  DiscoveryBanner.refresh();
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
  repositionAllHistogramRects();
  createScroller();
  entriesScroller.onFilterChange = refreshStatsBarFromScroller;
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
  document.getElementById('entries-table-panel').addEventListener('animationstart', e => {
    if (e.animationName === 'pipeline-room') _signalFirstPaint();
  });
}

// histEntries stays the pre-score-range set (not the filtered statsEntries) so the
// histogram keeps out-of-range bars — clickable to widen the filter — while the readouts shrink.
export function buildStatsBarHTML() {
  const scroller = entriesScroller;
  const statsEntries = scroller ? scroller._statsViewEntries() : [];
  const histEntries = scroller ? scroller._histogramEntries() : getActiveCorpus().entries;
  const grouped = scroller ? scroller.sortTier === 'group' : false;
  const groupCount = grouped ? scroller.entries.length : null;
  const countValue = grouped
    ? (scroller ? scroller._visibleGroupChainCount() : 0)
    : (scroller ? scroller.entries.length : statsEntries.length);
  const stats = computeStatsRaw(statsEntries);
  const layout = scopedHistogramLayout();

  const isEmpty = !countValue;
  const dash = '—';
  const fmt = v => isEmpty ? dash : v;
  const counts = bucketCounts(histEntries || [], layout);
  const scale = Math.max(...counts, 1);
  const barH = c => c === 0 ? 0 : Math.max(2, Math.round((c / scale) * 34));

  const bars = layout.slots.map((s, i) => {
    const c = counts[i];
    const title = `${pluralize(c, 'entry', 'entries')} scored ${s.label} • Click to filter`;
    const { bg } = scoreColor((s.lo + s.hi) / 2);
    return `<div class="histogram-col" title="${title}"><div class="histogram-bar" data-lo="${s.lo}" data-hi="${s.hi}" style="--score-bg:${bg}; height:${barH(c)}px"></div></div>`;
  }).join('');

  const countsHTML = groupCount != null
    ? buildStatItemHTML('Entries', countValue.toLocaleString()) +
      buildStatItemHTML('Groups', groupCount.toLocaleString())
    : buildStatItemHTML('Entries', countValue.toLocaleString());

  const rangeHTML = _buildScoreRangeInputHTML('score-range-input', AppView.scoreRange, 'AppView');
  const sortSlotHTML = `<span class="stats-bar-sort" id="stats-bar-sort"></span>`;
  const exportHTML = _buildExportMenuHTML();
  const exportSlotHTML = exportHTML ? `<span class="stats-bar-export">${exportHTML}</span>` : '';

  return `<div class="stats-bar${isEmpty ? ' stats-empty' : ''}">
      <div class="stats-bar-counts">${countsHTML}</div>
      <div class="stats-bar-distribution">
        <div class="stats-bar-numbers">
          ${buildStatItemHTML('Min', fmt(stats.min), null, 'stat-far')}
          ${buildStatItemHTML('Max', fmt(stats.max), null, 'stat-far')}
        </div>
        <div class="histogram" title="Histogram • Click to filter" onpointerdown="onHistogramPointerDown(event)">${bars}<div class="histogram-rect" hidden></div></div>
      </div>
      <div class="stats-bar-controls">${rangeHTML}${sortSlotHTML}${exportSlotHTML}</div>
    </div>`;
}

export function refreshStatsBarFromScroller() {
  if (!entriesScroller) return;
  const bar = document.querySelector('#stats .stats-bar');
  if (!bar) return;
  swapStatsBarReadouts(bar, buildStatsBarHTML());
  repositionAllHistogramRects();
}

function swapStatsBarReadouts(bar, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const next = tmp.querySelector('.stats-bar');
  if (!next) return;
  bar.querySelector('.stats-bar-counts')?.replaceWith(next.querySelector('.stats-bar-counts'));
  bar.querySelector('.stats-bar-distribution')?.replaceWith(next.querySelector('.stats-bar-distribution'));
  bar.className = next.className;
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
    bar.classList.remove('stats-narrow', 'stats-no-hist');
    const overlapsControls = () => {
      const ctrls = bar.querySelector('.stats-bar-controls');
      if (!ctrls) return false;
      const ctrlsLeft = ctrls.getBoundingClientRect().left;
      for (const el of bar.querySelectorAll('.stats-bar-counts, .stat-far, .histogram')) {
        if (!el.offsetWidth) continue;
        if (el.getBoundingClientRect().right > ctrlsLeft + 0.5) return true;
      }
      return false;
    };
    if (overlapsControls()) {
      bar.classList.add('stats-narrow');
      if (overlapsControls()) bar.classList.add('stats-no-hist');
    }
  }
}
export function mountStatsBarOverflowObservers() {
  const parent = document.getElementById('detail-panel');
  if (!parent) return;
  new ResizeObserver(refreshStatsBarOverflow).observe(parent);
  new MutationObserver(refreshStatsBarOverflow).observe(parent, { childList: true, subtree: true });
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
  try {
    const panel = document.getElementById('detail-panel');
    reconcileSort(ToolStack.getStack());
    mountPanel(panel);
    const showSource = state.selected === MERGED_ID;
    entriesScroller.showSource = showSource;
    panel.classList.toggle('no-source-col', !showSource);
    entriesScroller.editsWordlist = getEditsWordlist() ?? null;
    entriesScroller.showEditDeleteCol = true;
    entriesScroller._onDeleteRow = entry => _deleteFromEdits(entry, refreshMergedScroller);
    _attachExternalEditHandlers(entriesScroller, refreshMergedScroller);

    const result = await runPipeline(getActiveCorpus(), ToolStack.getStack(), currentSort());
    if (result.aborted) return;
    entriesScroller.setEntries(result, result.atomCount, chainSortTier(ToolStack.getStack()));
    ToolStack.refreshErrorMarks();
  } finally {
    // In `finally` so a thrown/aborted pipeline still dismisses the splash
    // screen — otherwise a broken tool in the boot URL strands the user on
    // a forever-spinning overlay with no error in sight.
    _signalFirstPaint();
  }
}

const NO_MATCH_QUIPS = [
  q => `"The ${q} is in another castle."`,
  q => `"This is not the ${q} you are looking for."`,
  q => `"${q} has left the chat."`,
  q => `"${q}? We're gonna need a bigger wordlist."`,
  q => `"We don't talk about ${q}."`,
  q => `"${q} has left the building."`,
  q => `"Nobody puts ${q} in the corner."`,
  q => `"${q}? Where we're going, we don't need ${q}."`,
  q => `"${q}? Inconceivable!"`,
  q => `"Hasta la vista, ${q}."`,
  q => `"Sorry, ${q} can't come to the phone right now."`,
  q => `"Show me the ${q}!"`,
  q => `"${q}? You can't handle the ${q}!"`,
];

export function buildNoMatchQuipHTML(term, asLink = false) {
  const wrapped = asLink
    ? `<button type="button" class="entries-empty-link">${esc(term)}</button>`
    : `<span class="entries-empty-term">${esc(term)}</span>`;
  return NO_MATCH_QUIPS[hashStringMod(term.toLowerCase(), NO_MATCH_QUIPS.length)](wrapped);
}
