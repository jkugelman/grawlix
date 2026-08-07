'use strict';

// ─── Entries table ─────────────────────────────────────────────────────────────
//
// The virtual scroller, the entry panel and group popover, and the sort/projection logic that
// orders the entries table. The sort tier follows the tool stack (single-atom
// filter chains, multi-atom transform chains, group chains); each tier owns a
// set of sort axes with fixed-direction tiebreaker chains.
//
// The scroller *instance* plus createScroller/refreshMergedScroller live in the
// sibling rendering module (the cycle is define-only); this module exports the
// classes. The router callback can't be imported (it lives in app/main), so it
// arrives via configureEntriesTable.

import { ROW_HEIGHT, VS_BUFFER, MERGED_ID, MERGED_NAME } from '../core/constants.js';
import { esc } from '../core/util.js';
import { isMobile } from '../core/platform.js';
import { displayOf, projectRangesToDisplay, toNorm, buildUserWlEntry } from '../engine/norm.js';
import { parseRange } from '../engine/range.js';
import { renderHighlightedText } from '../engine/search.js';
import { FIND_MATCH_CAP } from '../engine/find.js';
import { TOOLS } from '../engine/tools.js';
import {
  isGroupChain, rowLastEntry, rowSetAtoms,
} from '../engine/executor.js';
import {
  compareItems, compareValues, activeGroupColumns, activeGroupAnchorLabel,
  sortAxes, chainSortTier, DEFAULT_SORT_BY_TIER, isValidSortAxis,
  isMultiLaneTier, rowMinScore, rowMaxScore, rowMinLength, rowMaxLength,
} from '../engine/sort.js';
import { state, getEditsWordlist } from '../data/state.js';
import { getTrashScore } from '../data/serialize.js';
import { mergedEntryCount, mergedWidthBound } from '../data/merge.js';
import { rescoreEntry, getRescoredByNorm, groupEntries } from '../engine/rescore.js';
import { buildScoreBadgeHTML, buildScoreCellHTML } from '../model/score-display.js';
import { showToast } from './toasts.js';
import { AppView } from './app-view.js';
import { ToolStack } from './tool-stack.js';
import { buildWordlistNameIconHTML } from './scope-selector.js';
import { getWordlistIcon } from './icons.js';
import { getDraftRescoreRules } from './rescore-editor.js';
import { buildTrashIconHTML, positionPopover } from './components.js';
import { LookupSection } from './lookup.js';
import { resolveEntryCanonical } from './canonical.js';
import { isRicher } from '../engine/canonical.js';
import {
  getEntriesScroller, rescorePreviewActive, refreshMergedScroller, reprojectMergedScroller, setScope,
} from './rendering.js';
import { fetchWorkerRows, fetchWorkerGroups, fetchWorkerGroupChains, fetchWorkerAllRows, fetchWorkerAllGroups, fetchWorkerTransformRows, fetchWorkerAllTransformRows, lastCompletedRunId, fetchWorkerEditSeed, fetchWorkerFamily, fetchWorkerWinners, fetchWorkerProvenance, fetchWorkerEditPlan, fetchWorkerSpaceOut, sendViewport, findInResult, locateInResult } from './pipeline-worker.js';

let _navigate              = () => {};

// Counts each time the worker-shipped re-bind answer is consumed, so the rebind
// A/B oracle can prove it isn't silently no-oping.
let rebindAnswersConsumed = 0;
export function rebindAnswersConsumedDebug() { return rebindAnswersConsumed; }
export function resetRebindAnswersConsumedForTest() { rebindAnswersConsumed = 0; }

let _groupWindowUnderfill = 0;
export function groupWindowUnderfillDebug() { return _groupWindowUnderfill; }
export function resetGroupWindowUnderfillForTest() { _groupWindowUnderfill = 0; }

// _winCache rows kept beyond the viewport on each side before eviction prunes
// the rest. Stakes: drop it under VS_BUFFER and eviction discards rows the next
// scroll is about to need, re-fetching them in a thrash that surfaces only as
// silent scroll jank.
const WINDOW_CACHE_KEEP = VS_BUFFER * 6;
export function windowedFlatDebug() {
  const s = getEntriesScroller();
  if (!s) return { error: 'no entries scroller mounted' };
  return {
    isFlatTier: s._flat,
    scoreFilterActive: !!s._scoreIntervals,
    sortTier: s.sortTier,
    winCacheSize: s._winCache ? s._winCache.size : 0,
    richRowsConsumed: s._richRowsConsumed ?? 0,
    ranAgainstOwned: !!s._ranAgainstOwned,
  };
}

export function workerGroupsDebug() {
  const s = getEntriesScroller();
  if (!s || s.sortTier !== 'group') return null;
  return s.entries.map(g => ({
    key: g.key,
    count: g._count,
    residentChains: g.chains.map(c => c.atoms.map(a => a.wlEntry.norm)),
  }));
}

export function workerGroupListDebug() {
  const s = getEntriesScroller();
  if (!s || s.sortTier !== 'group') return null;
  return {
    groupCount: s._groupCount(),
    residentKeys: (s._firstGroups ?? []).map(g => g.key),
  };
}

export function workerSummariesDebug() {
  const s = getEntriesScroller();
  if (!s) return { error: 'no entries scroller mounted' };
  return {
    hasWorkerStats: s._workerStats != null,
    hasWorkerHistogramCounts: s._workerHistogramCounts != null,
    workerStats: s._workerStats,
    workerHistogramCounts: s._workerHistogramCounts ? [...s._workerHistogramCounts] : null,
  };
}

export function existsInScopeDebug() {
  const s = getEntriesScroller();
  if (!s) return { error: 'no entries scroller mounted' };
  return { existsInScope: s._existsInScope };
}

export function entryPanelSeedDebug() {
  return EntryPanel.seedDebug();
}

export function entryPanelProvenanceDebug() {
  return EntryPanel.provenanceDebug();
}

export function configureEntriesTable({ navigate }) {
  if (navigate)              _navigate = navigate;
}

export function streamFlatBatchToScroller(batch) {
  getEntriesScroller()?.appendStreamBatch(batch);
}

export function streamGroupBatchToScroller(batch) {
  getEntriesScroller()?.appendGroupStreamBatch(batch);
}

export function streamTransformBatchToScroller(batch) {
  getEntriesScroller()?.appendTransformStreamBatch(batch);
}

export function ingestReprojectToScroller(batch) {
  getEntriesScroller()?.ingestReproject(batch);
}

// ─── Input helpers ────────────────────────────────────────────────────────────

function blockSemicolon(e) {
  if (!e.data?.includes(';')) return;
  e.preventDefault();
  const el = e.target;
  el.classList.remove('shake');
  void el.offsetWidth; // force reflow so re-triggering restarts the animation
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  showToast('Semicolons are not allowed');
}

// ─── Virtual Scroller ─────────────────────────────────────────────────────────

// Sort axes, tier resolution, and chain projections live in engine/sort.js so the
// worker sorts every tier the same way main labels its headers. Re-exported here
// for the router and tests that reach them through this module.
export {
  compareItems, compareValues, activeGroupColumns,
  chainSortTier, DEFAULT_SORT_BY_TIER, isValidSortAxis,
  rowMinScore, rowMaxScore, rowMinLength, rowMaxLength,
};
// An axis with no counterpart in the new tier maps across rather than
// snapping to the tier default, so a sort survives a tier round-trip. Count is
// the deliberate odd one: group-only with no real twin, it maps to Length
// one-way — a different thing, but it keeps a magnitude sort alive rather than
// silently dropping to the tier default when the group dissolves.
const SORT_AXIS_TIER_MAP = {
  'score': 'min-score', 'min-score': 'score', 'max-score': 'score',
  'length': 'min-length', 'min-length': 'length', 'max-length': 'length',
  'count': 'length',
};

// Order is load-bearing: the first surviving axis is the column's canonical
// pick, consumed far away as nextSortForColumn's ownedAxes[0].
const COLUMN_AXIS_CANDIDATES = {
  'col-entry':     ['entry'],
  'col-len':       ['length', 'min-length', 'max-length'],
  'col-score':     ['score', 'min-score', 'max-score'],
  'col-comment':   ['comment'],
  'group-count':   ['count'],
  'group-anchor':  ['entry', 'length', 'score'],
  // 'entry' is conditional: an anchor owns the entry axis, so the group branch
  // drops it from this column then (see buildEntryHeadersHTML) — else both columns
  // double-own it.
  'group-entries': ['entry', 'min-score', 'max-score', 'min-length', 'max-length'],
};
export function columnSortAxes(colKind, tierAxes) {
  return (COLUMN_AXIS_CANDIDATES[colKind] || []).filter(k => k in tierAxes);
}
export function nextSortForColumn(ownedAxes, curKey, curDir) {
  if (ownedAxes.includes(curKey)) return { key: curKey, dir: curDir === 'asc' ? 'desc' : 'asc' };
  return { key: ownedAxes[0], dir: 'asc' };
}

export function extendSortList(sortList, key, siblingAxes) {
  const list = sortList.map(s => ({ ...s }));
  const at = list.findIndex(s => s.key === key);
  if (at >= 0) { list[at].dir = list[at].dir === 'asc' ? 'desc' : 'asc'; return list; }
  // Swap, not stack, a sibling axis of the same column: a column shows one arrow,
  // so two of its axes active at once would render an ambiguous sort state.
  const sib = list.findIndex(s => siblingAxes.includes(s.key));
  if (sib >= 0) list[sib] = { key, dir: 'asc' };
  else list.push({ key, dir: 'asc' });
  return list;
}

const sortSig = list => list.map(s => s.key + ':' + s.dir).join(',');

// Run synchronously on stack mutation and URL load: the sort tier follows
// the stack, and settling it lazily in the async render let the URL builder
// read a stale axis. A real cross-tier counterpart (Score ⇄ Min score) keeps
// the user's direction; a fallback to the tier default resets it too.
export function reconcileSort(stack) {
  const tier = chainSortTier(stack);
  const axes = sortAxes(tier, stack);
  const out = [];
  const seen = new Set();
  for (let { key, dir } of AppView.sortList) {
    if (!(key in axes)) {
      const mapped = SORT_AXIS_TIER_MAP[key];
      if (mapped && mapped in axes) key = mapped;
      else continue;   // no counterpart in this tier — drop this level
    }
    if (seen.has(key)) continue;   // a tier mapping can collapse two levels onto one
    seen.add(key);
    out.push({ key, dir });
  }
  if (!out.length) out.push({ key: DEFAULT_SORT_BY_TIER[tier], dir: 'asc' });
  AppView.setSortList(out);
}

const ENTRY_SLOT_CAP = 28;

// Must match .src-slot width / .atom-source gap in app.css — sourceColMaxPx sizes
// --source-max from these, so a drift silently clips the matrix or leaves dead space.
const SRC_SLOT_W = 16;
const SRC_SLOT_GAP = 5;

// The slot universe must mirror the worker's contributor universe (shipContributors,
// worker.js): a row's sourceId with no slot here renders nowhere, silently dropping it.
function sourceMatrixSlots() {
  const scopedKey = state.selected !== MERGED_ID ? state.selected.dbKey : null;
  return state.sources.filter(w => w.enabled || w.dbKey === scopedKey);
}

function sourceColMaxPx(slotCount) {
  const matrixW = slotCount > 0 ? slotCount * SRC_SLOT_W + (slotCount - 1) * SRC_SLOT_GAP : 0;
  return Math.max(matrixW, headerLabelPx('Sources'));
}

function buildSourcesMatrixHTML(sourceIds, activeIds, slots) {
  if (!slots) return '';
  const present = new Set(sourceIds || []);
  const active = new Set(activeIds || []);
  const html = slots.map(wl => {
    const has = present.has(wl.dbKey);
    const muted = has && !active.has(wl.dbKey);
    const cls = 'src-slot' + (!has ? ' src-slot--empty' : muted ? ' src-slot--muted' : '');
    const title = muted ? `${wl.name} (overridden)` : wl.name;
    return has
      ? `<span class="${cls}" title="${esc(title)}">${getWordlistIcon(wl)}</span>`
      : `<span class="${cls}"></span>`;
  }).join('');
  return `<span class="atom-source">${html}</span>`;
}

// Off-screen pixel width of `text` rendered in style class `className`
// (.text-probe positioning is layered on automatically). Memoized per
// text+class, so callers measure freely without caching themselves.
const _textWidths = new Map();
function measureTextWidth(text, className) {
  const key = `${className}\0${text}`;
  let w = _textWidths.get(key);
  if (w === undefined) {
    const probe = document.createElement('span');
    probe.className = `text-probe ${className}`;
    probe.textContent = text;
    document.body.appendChild(probe);
    w = probe.getBoundingClientRect().width;
    probe.remove();
    _textWidths.set(key, w);
  }
  return w;
}

function measureMonoChPx() {
  return measureTextWidth('0'.repeat(100), 'entry-row-font') / 100;
}

// Arrow glyphs render from a fallback face wider than one `ch` — measure them.
function measureAtomGlyphPx() {
  return Math.max(...['→ ', '↔ ', '⊃ '].map(g => measureTextWidth(g, 'entry-row-font')));
}

const SCORE_ARROW_PAD_PX = 8; // matches .atom-score-arrow horizontal padding
function measureScoreArrowPx() {
  return measureTextWidth('→', 'entry-row-font') + SCORE_ARROW_PAD_PX;
}

// Two sample widths separate the badge's per-char width from its fixed padding.
function badgeWidthPx(chars) {
  const w1 = measureTextWidth('0', 'score-badge');
  const chPx = (measureTextWidth('0000000000', 'score-badge') - w1) / 9;
  return Math.max(chars, 1) * chPx + (w1 - chPx);
}

function headerLabelPx(text) {
  return measureTextWidth(text, 'entry-headers-font');
}
function sortableHeaderPx(label) {
  let w = headerLabelPx(label + ' ↑');
  // The rank badge needs a modifier-click to appear, so on touch it never can;
  // reserve its width (a digit + margin) only where it's reachable, or a tight
  // track clips the badge under the headers' overflow:hidden.
  if (!isMobile()) w += headerLabelPx('9') + 6;
  return w;
}

const EMPTY_REVEAL_DELAY_MS = 450;

// trueRaw is `rawScore ?? score`: rawScore is set only when a committed rule
// moved the score (engine/rescore.js applyRescoring), else score is the raw.
function previewedEntry(wlEntry, draftRules) {
  const trueRaw = wlEntry.rawScore ?? wlEntry.score;
  const ps = rescoreEntry({ norm: wlEntry.norm, score: trueRaw }, draftRules);
  return ps === trueRaw
    ? { ...wlEntry, score: trueRaw, rawScore: null }
    : { ...wlEntry, score: ps, rawScore: trueRaw };
}

// Capture-mode scroll listener catches events from any ancestor — the page
// scrolls the document, not the window, and scroll events don't bubble.
class BaseVirtualScroller {
  constructor(host, sizerClassName) {
    this.host = host;
    this.sizer = document.createElement('div');
    this.sizer.className = sizerClassName;
    host.innerHTML = '';
    host.appendChild(this.sizer);

    this._reservedHeight = 0;
    this._revealEmpty = false;
    this._emptyRevealTimer = null;

    this._onWinScroll = () => this._onScroll();
    this._onWinResize = () => this._render();
    this._onFocusOut = (e) => {
      const next = e.relatedTarget;
      if (next && next.closest && next.closest('.search-bar, .tool-row')) return;
      // Don't drop reservation when focus moves *within* the host: dropping
      // it reflows the host between mousedown and mouseup, moving in-host
      // buttons (e.g. empty-state Add-it) out from under the click. The
      // bug only shows when the page is short enough that scroll doesn't
      // absorb the shift, so it's easy to "simplify" this line away.
      if (next && this.host.contains(next)) return;
      if (!this._reservedHeight && !this._emptyRevealTimer && !this._revealEmpty) return;
      clearTimeout(this._emptyRevealTimer);
      this._emptyRevealTimer = null;
      this._revealEmpty = false;
      this._reservedHeight = 0;
      this._render();
    };
    window.addEventListener('scroll', this._onWinScroll, { capture: true, passive: true });
    window.addEventListener('resize', this._onWinResize);
    document.addEventListener('focusout', this._onFocusOut);
    this._resizeObserver = new ResizeObserver(() => this._render());
    this._resizeObserver.observe(host);
  }

  // Subclasses can override to react to scroll (e.g., close any open popover).
  _onScroll() { this._render(); }

  _isReservationActive() {
    const a = document.activeElement;
    return !!(a && a.matches && a.matches('.search-bar input, .tool-row input'));
  }

  _sizerHeightFor(naturalHeight) {
    // The reservation parks the empty-state quip below the fold; it must only
    // floor an *empty* result. Flooring a non-empty one pins the sizer to the
    // prior, taller view when a tool shrinks the set (its param input still
    // focused), leaving a dead zone below the real rows that scrolls blank.
    const empty = naturalHeight === 0;
    if (empty && this._isReservationActive() && !this._revealEmpty) {
      this._reservedHeight = Math.max(this._reservedHeight, this.sizer.offsetHeight);
    } else if (this._reservedHeight) {
      this._reservedHeight = 0;
    }
    return Math.max(naturalHeight, this._reservedHeight);
  }

  // Per-item vertical stride. Subclasses with variable-height row kinds
  // (pair-stacked on mobile) override this; the value flips on viewport
  // crossings because the base's resize handler re-renders on resize.
  _rowStride() { return ROW_HEIGHT; }

  // Visible item-index range [start, end) for a list of `itemCount` rows. Same
  // viewport-relative math whether the scroll container is <main> or document.
  _visibleRange(itemCount) {
    const stride = this._rowStride();
    const rect = this.host.getBoundingClientRect();
    const viewH = window.innerHeight;
    const visTop = Math.max(0, -rect.top);
    const visBottom = Math.max(0, Math.min(rect.height, viewH - rect.top));
    const start = Math.max(0, Math.floor(visTop / stride) - VS_BUFFER);
    const end   = Math.min(itemCount, Math.ceil(visBottom / stride) + VS_BUFFER);
    return { start, end };
  }


  destroy() {
    clearTimeout(this._emptyRevealTimer);
    window.removeEventListener('scroll', this._onWinScroll, { capture: true });
    window.removeEventListener('resize', this._onWinResize);
    document.removeEventListener('focusout', this._onFocusOut);
    this._resizeObserver.disconnect();
  }

  _render() { throw new Error('subclass must implement _render'); }
}

function estimateChainWidth(chain, ctx) {
  let maxEntryW = 0;
  let maxScoreW = 0;
  for (const atom of chain.atoms) {
    const glyphW = atom.glyph ? ctx.glyphPx : 0;
    const entryW = displayOf(atom.wlEntry).length * ctx.monoCh + glyphW;
    if (entryW > maxEntryW) maxEntryW = entryW;
    const scoreW = badgeWidthPx(String(atom.wlEntry.score).length);
    if (scoreW > maxScoreW) maxScoreW = scoreW;
  }
  return maxEntryW + 5 + maxScoreW;
}

function buildGroupAnchorHTML(anchor, findRanges = null) {
  if (!anchor) return `<span class="group-anchor"></span>`;
  const displayed = displayOf(anchor);
  const truncTitle = displayed.length > ENTRY_SLOT_CAP ? ` title="${esc(displayed)}"` : '';
  const text = findRanges ? renderHighlightedText(displayed, findRanges) : esc(displayed);
  return `<span class="group-anchor">` +
    `<span class="atom" data-atom-role="anchor">` +
      `<span class="atom-entry"${truncTitle}>${text}</span>` +
      `<span class="atom-score">${buildScoreBadgeHTML(anchor.score)}</span>` +
    `</span>` +
  `</span>`;
}

function buildGroupChainHTML(chain, ci, memberFind = null) {
  const atoms = chain.atoms;
  const html = [];
  for (let ai = 0; ai < atoms.length; ai++) {
    const { wlEntry, highlights, glyph } = atoms[ai];
    const isRepeat = ai > 0 && wlEntry.norm === atoms[ai - 1].wlEntry.norm;
    const displayed = displayOf(wlEntry);
    const projected = projectRangesToDisplay(highlights, wlEntry);
    const glyphHTML = glyph ? `<span class="atom-glyph">${glyph} </span>` : '';
    const truncTitle = displayed.length > ENTRY_SLOT_CAP ? ` title="${esc(displayed)}"` : '';
    const noedit = wlEntry.wordlist === null ? ' atom-noedit' : '';
    const findRanges = memberFind?.get(ai);
    const text = renderHighlightedText(displayed, findRanges ? [...(projected || []), ...findRanges] : projected);
    const entryCell = `<span class="atom-entry${noedit}"${truncTitle}>${glyphHTML}${text}</span>`;
    const scoreCell = isRepeat
      ? `<span class="atom-score"></span>`
      : `<span class="atom-score${noedit}">${buildScoreBadgeHTML(wlEntry.score)}</span>`;
    html.push(`<span class="atom" data-atom="${ai}">${entryCell}${scoreCell}</span>`);
  }
  return `<div class="group-chain" data-chain="${ci}">${html.join('')}</div>`;
}

export const ErrorPopover = (() => {
  let el = null, anchor = null;
  function ensure() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'tool-row-error-popover';
    el.hidden = true;
    document.body.appendChild(el);
  }
  function position() {
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const top = r.bottom + 6;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8));
    el.style.top = top + 'px';
    el.style.left = left + 'px';
  }
  function open(btn, message) {
    ensure();
    el.textContent = message;
    el.hidden = false;
    anchor = btn;
    position();
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
  }
  function close() {
    if (!el) return;
    el.hidden = true;
    anchor = null;
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
  }
  function onDocClick(e) {
    if (anchor && (e.target === anchor || anchor.contains(e.target))) return;
    if (el && el.contains(e.target)) return;
    close();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function toggle(btn, message) {
    if (anchor === btn && el && !el.hidden) { close(); return; }
    open(btn, message);
  }
  return { open, close, toggle };
})();

export const GroupMorePopover = (() => {
  const POPOVER_CHUNK = 200;
  let el = null;
  let anchor = null;
  let group = null;       // the group whose chains this lists: { key, _count, chains: firstChains }
  let scroller = null;
  let runId = null;       // the result run this popover's chains belong to; a fetch reply for a different run is dropped
  // Keyed by ABSOLUTE chain index — not a dense per-window array — so the
  // atom-edit click handler resolves data-chain (also absolute) to the right chain
  // no matter which window supplied it; a per-window remap would edit a wrong atom.
  let chainCache = null;
  let rendered = 0;       // count of absolute indices already laid out (resident + skeleton)
  let fetchSeq = 0;
  let sentinel = null;
  let io = null;
  let findTarget = null;   // { member, ranges } a find is revealing; painted once its chain lands

  function mount() {
    el = document.createElement('div');
    el.className = 'group-popover';
    el.hidden = true;
    document.body.appendChild(el);

    el.addEventListener('click', e => {
      const target = e.target.closest('.atom-score, .atom-entry');
      if (!target || target.classList.contains('atom-noedit')) return;
      const chainEl = target.closest('.group-chain');
      const atomEl = target.closest('.atom');
      if (!chainEl || !atomEl) return;
      const atom = chainCache?.get(parseInt(chainEl.dataset.chain, 10))
                    ?.atoms[parseInt(atomEl.dataset.atom, 10)];
      if (!atom) return;
      const field = target.classList.contains('atom-score') ? 'score' : null;
      EntryPanel.open(atom.wlEntry, null, scroller, field);
    });
  }

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    anchor = group = scroller = chainCache = null;
    runId = null;
    rendered = 0;
    findTarget = null;
    fetchSeq++;   // invalidate any in-flight fetch's fill so a late reply is a no-op
    if (io) { io.disconnect(); io = null; }
    sentinel = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  // A chip re-click is routed through toggle, so don't double-dismiss it here.
  // mousedown, not pointerdown, so a touch-drag that scrolls the table leaves
  // this open.
  function onOutside(e) {
    if (el.contains(e.target)) return;
    if (e.target.closest('.group-more')) return;
    close();
  }

  function chainOrSkeletonHTML(i) {
    const chain = chainCache.get(i);
    return chain
      ? buildGroupChainHTML(chain, i)
      : `<div class="group-chain skeleton" data-chain="${i}"><span class="skeleton-bar"></span></div>`;
  }

  function renderChunk() {
    const total = group._count;
    const end = Math.min(total, rendered + POPOVER_CHUNK);
    if (end <= rendered) return;
    const html = [];
    for (let i = rendered; i < end; i++) html.push(chainOrSkeletonHTML(i));
    sentinel.insertAdjacentHTML('beforebegin', html.join(''));

    // One span fetch covers the chunk's non-resident tail: cached indices form a
    // prefix (firstChains 0..k-1 plus in-order fetched windows), so the first
    // uncached index begins a contiguous run to `end` with no gap left behind.
    let fetchLo = rendered;
    while (fetchLo < end && chainCache.has(fetchLo)) fetchLo++;
    rendered = end;
    if (fetchLo < end) fetchWindow(fetchLo, end);

    if (rendered >= total) {
      io?.disconnect();
      io = null;
      sentinel.remove();
      sentinel = null;
    }
  }

  function fetchWindow(lo, hi) {
    const seq = ++fetchSeq;
    const groupKey = group.key;
    const forRunId = runId;
    fetchWorkerGroupChains(forRunId, groupKey, lo, hi).then(reply => {
      if (seq !== fetchSeq || el.hidden || runId !== forRunId || !reply) return;
      for (let k = 0; k < reply.chains.length; k++) {
        const abs = reply.start + k;
        chainCache.set(abs, reply.chains[k]);
        const skel = el.querySelector(`.group-chain.skeleton[data-chain="${abs}"]`);
        if (skel) skel.outerHTML = buildGroupChainHTML(reply.chains[k], abs);
      }
      paintFindTarget();
    });
  }

  // A member past firstChains renders as a skeleton first, so paintFindTarget also
  // re-runs from the fetch reply — without that, a hit past firstChains never lights.
  function revealMember(nextGroup, anchorEl, nextScroller, targetMember, findRanges) {
    if (anchor !== anchorEl) toggle(nextGroup, anchorEl, nextScroller);
    else clearFindMarks();
    while (rendered <= targetMember && rendered < group._count) renderChunk();
    findTarget = { member: targetMember, ranges: findRanges };
    paintFindTarget();
  }

  function paintFindTarget() {
    if (!findTarget) return;
    const i = findTarget.member;
    const chain = chainCache.get(i);
    const node = el.querySelector(`.group-chain[data-chain="${i}"]`);
    if (!chain || !node) return;
    node.outerHTML = buildGroupChainHTML(chain, i, findTarget.ranges);
    el.querySelector(`.group-chain[data-chain="${i}"]`)?.scrollIntoView({ block: 'center' });
    findTarget = null;
  }

  function clearFindMarks() {
    el.querySelectorAll('.group-chain').forEach(node => {
      if (!node.querySelector('.find-hit')) return;
      const i = parseInt(node.dataset.chain, 10);
      const chain = chainCache.get(i);
      if (chain) node.outerHTML = buildGroupChainHTML(chain, i);
    });
  }

  function toggle(nextGroup, anchorEl, nextScroller) {
    if (anchor === anchorEl) { close(); return; }
    close();
    el.hidden = false;
    group = nextGroup;
    scroller = nextScroller;
    runId = lastCompletedRunId();
    chainCache = new Map();
    nextGroup.chains.forEach((c, i) => chainCache.set(i, c));   // resident firstChains seed indices 0..k-1
    el.innerHTML = '';
    sentinel = document.createElement('span');
    sentinel.className = 'group-popover-sentinel';
    el.appendChild(sentinel);
    rendered = 0;
    renderChunk();
    anchor = anchorEl;
    const r = anchorEl.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 8;
    const gap = 4;
    const fitsBelow = r.bottom + gap + h + margin <= window.innerHeight;
    const top = fitsBelow || (window.innerHeight - r.bottom) >= r.top
      ? Math.max(margin, Math.min(r.bottom + gap, window.innerHeight - h - margin))
      : Math.max(margin, r.top - gap - h);
    el.style.top = top + 'px';
    el.style.left = Math.max(margin, Math.min(r.right - w, window.innerWidth - w - margin)) + 'px';
    if (sentinel) {
      io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) renderChunk();
      }, { root: el, rootMargin: '200px' });
      io.observe(sentinel);
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onOutside, true);
  }
  return { mount, toggle, close, revealMember };
})();

export class EntriesScroller extends BaseVirtualScroller {
  constructor(host) {
    super(host, 'entries-table-rows');
    // `allEntries` / `entries` hold ChainRow[] — `{ atoms: Atom[] }`, where an
    // Atom is `{ wlEntry, highlights, glyph }`. `atomCount` is the (static,
    // catalog-derived) atom count every row in the pipeline shares — the row's
    // height in lines. `sortTier` ('single' | 'multi') picks the sort axes.
    this.atomCount = 1;
    this.sortTier = 'single';
    this.allEntries = [];
    this.entries = [];
    // The ResizeObserver renders the empty scroller before the first setEntries,
    // so the footer needs to tell pending from empty — false until a run lands.
    this._resolved = false;
    this._flat = false;
    this._workerStats = null;
    this._workerHistogramCounts = null;
    this._workerGroupWidthHints = null;
    this._workerChainCount = null;
    this._workerGroupCount = null;
    this._workerFlatCount = null;
    this._capped = false;
    this._workerFiltered = false;
    this._ranAgainstOwned = false;
    this._existsInScope = null;
    this._rebindQuery = null;
    this._rebindEntry = null;
    this._rebindExists = null;
    this._widthHints = null;
    this._errored = false;
    this.sortList = AppView.sortList;
    this.scoreRange = AppView.scoreRange;
    this._scoreIntervals = this.scoreRange ? parseRange(this.scoreRange) : null;
    this._onSave = null;
    this._onDeleteRow = null;
    this._onBatchRescore = null;
    this._onBatchDelete = null;
    this._sentViewport = null;
    this.onFilterChange = null;

    this._find = null;
    this._findBar = null;
    this._findInput = null;
    this._findSeq = 0;
    this._findDebounce = null;
    this._installFindKey();

    this._pendingReveal = null;
    this._revealToken = 0;

    // Selection is keyed on an atom's (norm, display) identity, never a row index:
    // the flat scroller windows, so an index silently names a different entry after
    // a scroll or re-ingest. The cursor also carries a cached index (for nav/scroll/
    // aria), re-derived from its identity on a result change. Flat tier only.
    this._selection = new Map();   // idKey -> { norm, display }
    this._cursor = null;           // { norm, display } | null
    this._cursorIndex = -1;
    this._anchor = null;           // range-select base identity
    this._anchorIndex = -1;
    this._navToken = 0;            // supersedes a stale async cursor move
    this._dragAnchorIndex = -1;
    this._dragLastIndex = -1;
    this._suppressClick = false;
    this._liveRegion = null;
    this._liveTimer = null;
    // Sorted view of allEntries cached across keystrokes. Filter preserves
    // order, so a sorted source means the filter result is already sorted —
    // no per-keystroke re-sort needed. Invalidated when allEntries change.
    this._sortedSource = null;
    this._sortedSourceSig = null;

    this._winCache = new Map();
    this._winCacheRunId = null;
    this._firstRows = null;
    this._winReqSeq = 0;
    this._fetchOutstanding = 0;
    this._richRowsConsumed = 0;

    // Don't "simplify" _render back to clear-and-rebuild: wiping the sizer each frame
    // swaps a row's node out between a click's mousedown and mouseup mid-stream, so the
    // click fires on the sizer and silently resolves to nothing.
    this._mounted = new Map();

    this._streamTotal = null;
    // The in-flight run a mid-stream fetch must name — lastCompletedRunId() only
    // advances at completion, so a fetch keyed off it would target the prior run
    // and serve wrong rows. Null when not streaming; the terminal result clears it.
    this._streamRunId = null;
    this._streamPending = false;
    // The current sorted-snapshot version; a fetched window whose version no
    // longer matches names a snapshot the order has moved past, so it's dropped
    // rather than painted into the live (newer) snapshot — see _fetchWindow.
    this._streamVersion = null;
    this._streamStatsRaf = 0;

    // The grouped tier's _winCache: Map<absolute group index, decoded group>.
    this._groupWinCache = new Map();
    this._groupWinCacheRunId = null;
    this._firstGroups = null;
    this._groupReqSeq = 0;
    this._groupFetchOutstanding = 0;

    this.sizer.tabIndex = -1;
    this.sizer.setAttribute('role', 'listbox');
    this.sizer.setAttribute('aria-multiselectable', 'true');
    this.sizer.setAttribute('aria-label', 'Entries');
    this.sizer.addEventListener('keydown', e => this._onListboxKeydown(e));

    this.sizer.addEventListener('mousedown', e => this._onRowMouseDown(e));

    this.sizer.addEventListener('click', e => {
      // A click that ends a drag-select must not fall through and re-select one row.
      if (this._suppressClick) { this._suppressClick = false; return; }
      const moreBtn = e.target.closest('.group-more');
      if (moreBtn) {
        const gr = moreBtn.closest('.group-row');
        const g = this._groupAt(gr.dataset.idx);
        if (g) GroupMorePopover.toggle(g, moreBtn, this);
        return;
      }
      if (this._flat) {
        const rowEl = e.target.closest('.entry-row');
        if (rowEl && !rowEl.classList.contains('skeleton')) {
          const idx = parseInt(rowEl.dataset.idx, 10);
          const focus = () => this.sizer.focus({ preventScroll: true });
          if (e.shiftKey)             { focus(); this._extendSelectionByClick(idx); return; }
          if (e.ctrlKey || e.metaKey) { focus(); this._toggleSelectionAt(idx);      return; }
          if (!e.target.closest('.atom-score')) {
            // Touch can't double-click, drag, or reach multi-select (it's keyboard-fed),
            // so a lone tap opens the panel rather than selecting a row it can't act on.
            // View-first — don't pop the keyboard until a field is tapped.
            if (isMobile()) {
              const wlEntry = this._winCache.get(idx)?.atoms?.[0]?.wlEntry;
              if (wlEntry) EntryPanel.open(wlEntry, rowEl, this, null);
              return;
            }
            // Selecting as well as opening keeps the table selection and the panel in sync.
            if (e.target.closest('.atom-entry')) {
              focus(); this._selectSingleAt(idx); this._openCursorPanel(); return;
            }
            focus(); this._selectSingleAt(idx); return;
          }
        }
      }
      const resolved = this._resolveAtomTarget(e.target);
      if (!resolved) return;
      const { row, wlEntry, field, anchor } = resolved;
      if (field === 'score' && scoreQuickPickable()) {
        ScorePicker.open(wlEntry, row, this, anchor);
        return;
      }
      EntryPanel.open(wlEntry, row, this, field === 'entry' ? null : field);
    });

    // The single clicks preceding a double-click already selected + cursored the row,
    // so this just opens on it. The score badge keeps its quick-pick, so it's exempt.
    this.sizer.addEventListener('dblclick', e => {
      if (!this._flat) return;
      if (e.target.closest('.atom-score, .group-more')) return;
      const rowEl = e.target.closest('.entry-row');
      if (!rowEl || rowEl.classList.contains('skeleton')) return;
      // WebKit's default double-click word-select lands on the just-focused panel
      // input, so it opens with the entry text selected instead of a caret.
      e.preventDefault();
      const idx = parseInt(rowEl.dataset.idx, 10);
      this._cursorIndex = idx;
      this._cursor = this._rowIdentity(idx);
      this._openCursorPanel();
    });
  }

  _resolveAtomTarget(node) {
    const target = node.closest?.('.atom-entry, .atom-score');
    if (!target) return null;
    let row, wlEntry;
    const groupRow = target.closest('.group-row');
    if (groupRow) {
      const atomEl = target.closest('.atom');
      if (!atomEl) return null;
      row = groupRow;
      const g = this._groupAt(groupRow.dataset.idx);
      if (atomEl.dataset.atomRole === 'anchor') {
        wlEntry = g?.anchor || null;
      } else {
        const chainEl = target.closest('.group-chain');
        if (!chainEl) return null;
        wlEntry = g?.chains[parseInt(chainEl.dataset.chain, 10)]
                  ?.atoms[parseInt(atomEl.dataset.atom, 10)]?.wlEntry;
      }
    } else {
      row = target.closest('.entry-row');
      const atomEl = target.closest('.atom');
      if (!row || !atomEl) return null;
      // A rendered row is always in the window cache (it was pulled from there);
      // this.entries holds only the inline first window, so it can't resolve a
      // clicked atom past it.
      wlEntry = this._flat
        ? row._wlEntry
        : this._winCache.get(parseInt(row.dataset.idx, 10))?.atoms[parseInt(atomEl.dataset.atom, 10)]?.wlEntry;
    }
    if (!wlEntry) return null;
    const field = target.classList.contains('atom-score') ? 'score' : 'entry';
    return { row, wlEntry, field, anchor: target };
  }

  // ─── Selection & keyboard navigation (flat tier) ──────────────────────────

  _idKey(id) { return id.norm + '\x00' + (id.display ?? ''); }

  _rowIdentity(idx) {
    const wl = this._winCache.get(idx)?.atoms?.[0]?.wlEntry;
    return wl ? { norm: wl.norm, display: wl.display ?? null } : null;
  }

  // A transform chain row holds several atoms and the panel can open on any of
  // them, so the walk matches every atom (not just atoms[0]) and returns the
  // column, letting a step stay in it. Flat rows have one atom, so atom is 0.
  _locateIdentity(id) {
    const key = this._idKey(id);
    for (const [i, decoded] of this._winCache) {
      const atoms = decoded.atoms;
      if (!atoms) continue;
      for (let atom = 0; atom < atoms.length; atom++) {
        const wl = atoms[atom].wlEntry;
        if (wl && this._idKey({ norm: wl.norm, display: wl.display ?? null }) === key) return { row: i, atom };
      }
    }
    return { row: -1, atom: 0 };
  }

  _indexOfIdentity(id) { return this._locateIdentity(id).row; }

  _setSelection(ids) {
    this._selection.clear();
    for (const id of ids) if (id) this._selection.set(this._idKey(id), { norm: id.norm, display: id.display ?? null });
  }

  // A rename swaps an atom's (norm, display), which would drop the entry from the
  // identity-keyed selection. Carry it over — old→next in the set and on the cursor/
  // anchor — so a selected entry stays selected as it re-sorts to its new spot.
  renameInSelection(oldId, nextId) {
    const oldKey = this._idKey(oldId);
    const next = { norm: nextId.norm, display: nextId.display ?? null };
    if (this._selection.has(oldKey)) {
      this._selection.delete(oldKey);
      this._selection.set(this._idKey(next), next);
    }
    if (this._cursor && this._idKey(this._cursor) === oldKey) this._cursor = next;
    if (this._anchor && this._idKey(this._anchor) === oldKey) this._anchor = next;
  }

  _selectSingleAt(idx) {
    const id = this._rowIdentity(idx);
    this._cursorIndex = idx; this._cursor = id;
    this._anchorIndex = idx; this._anchor = id;
    this._setSelection(id ? [id] : []);
    this._render();
  }

  _toggleSelectionAt(idx) {
    const id = this._rowIdentity(idx);
    if (id) {
      const key = this._idKey(id);
      if (this._selection.has(key)) this._selection.delete(key);
      else this._selection.set(key, { norm: id.norm, display: id.display ?? null });
    }
    this._cursorIndex = idx; this._cursor = id;
    this._anchorIndex = idx; this._anchor = id;
    this._render();
  }

  async _extendSelectionByClick(idx) {
    const base = this._anchorIndex < 0 ? idx : this._anchorIndex;
    this._cursorIndex = idx; this._cursor = this._rowIdentity(idx);
    await this._selectRange(base, idx);
    this._render();
  }

  async _selectAllRows() {
    const n = this._renderRowCount();
    if (n === 0) return;
    const reply = await fetchWorkerAllRows(this._currentStreamRunId());
    if (!reply) return;
    this._setSelection(reply.rows.map(r => ({ norm: r.norm, display: r.display ?? null })));
    this._render();
  }

  _onRowMouseDown(e) {
    if (!this._flat || e.button !== 0) return;
    if (e.target.closest('.group-more')) return;
    const rowEl = e.target.closest('.entry-row');
    if (!rowEl || rowEl.classList.contains('skeleton')) return;
    // Kill the native text selection a drag would start — WebKit ignores the rows'
    // user-select:none for a drag, so preventDefault is the portable stop. The click
    // still fires (edit/select), and focus is set explicitly, so nothing is lost.
    e.preventDefault();
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;   // modifier gestures live on click
    this._dragAnchorIndex = parseInt(rowEl.dataset.idx, 10);
    this._dragLastIndex = -1;
    const onMove = ev => this._onRowDragMove(ev);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (this._dragLastIndex >= 0) this._suppressClick = true;
      this._dragAnchorIndex = -1;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _onRowDragMove(e) {
    if (this._dragAnchorIndex < 0) return;
    const idx = this._rowIndexAtPoint(e.clientY);
    if (idx == null || idx === this._dragLastIndex) return;
    if (this._dragLastIndex < 0 && idx === this._dragAnchorIndex) return;   // not yet a drag
    this._dragLastIndex = idx;
    this.sizer.focus({ preventScroll: true });
    this._cursorIndex = idx; this._cursor = this._rowIdentity(idx);
    this._anchorIndex = this._dragAnchorIndex; this._anchor = this._rowIdentity(this._dragAnchorIndex);
    this._selectRange(this._dragAnchorIndex, idx).then(() => this._render());
  }

  _rowIndexAtPoint(clientY) {
    const n = this._renderRowCount();
    if (n === 0) return null;
    const idx = Math.floor((clientY - this.host.getBoundingClientRect().top) / this._rowStride());
    return Math.max(0, Math.min(n - 1, idx));
  }

  _clearSelection() {
    if (this._selection.size === 0) return false;
    this._selection.clear();
    this._render();
    return true;
  }

  _resetSelectionState() {
    this._selection.clear();
    this._cursor = null; this._cursorIndex = -1;
    this._anchor = null; this._anchorIndex = -1;
  }

  // A search, tool, score-range, or wordlist-config edit changes which entries the
  // result holds, so the selection is dropped — a row now out of sight must not stay a
  // live Alt+digit/Delete target. A sort (reorder-only) or edit refresh keeps it instead.
  resetSelectionForViewChange() {
    if (this._selection.size === 0 && !this._cursor && !this._anchor) return;
    this._resetSelectionState();
    this._render();
  }

  // Membership is identity-keyed, so it survives a re-ingest untouched; only the
  // cursor/anchor *indices* are re-derived here.
  _reconcileSelectionCursor() {
    if (!this._flat) { this._resetSelectionState(); return false; }
    const n = this._renderRowCount();
    if (n === 0) { this._resetSelectionState(); return false; }
    const before = this._cursorIndex;
    if (this._cursor) {
      const idx = this._indexOfIdentity(this._cursor);
      this._cursorIndex = idx >= 0 ? idx : Math.min(Math.max(0, this._cursorIndex), n - 1);
    }
    if (this._anchor) {
      const idx = this._indexOfIdentity(this._anchor);
      this._anchorIndex = idx >= 0 ? idx : Math.min(Math.max(0, this._anchorIndex), n - 1);
    }
    return this._cursorIndex !== before;
  }

  rescoreSelectionByDigit(digit) {
    if (!scoreQuickPickable() || this._selection.size === 0) return false;
    const opt = optionForDigit(buildScoreOptions(), digit);
    if (!opt) return false;
    this._batchRescoreSelection(opt.score);
    return true;
  }

  // fetchEditSeed resolves every target — even a visible, cached one — rather than
  // reading the cached row: a second seed path would silently drift from the single-
  // rescore one, writing subtly wrong scores/comments only for batches.
  async _batchRescoreSelection(score) {
    const ids = [...this._selection.values()];
    if (!ids.length) return;
    const edits = getEditsWordlist();
    const seeds = await Promise.all(ids.map(id => fetchWorkerEditSeed(id.norm, id.display ?? null)));
    const targets = [];
    seeds.forEach((winner, i) => {
      if (!winner) return;
      const src = state.sources.find(s => s.dbKey === winner.sourceId) || null;
      const seed = seedFromWinnerRow(
        { norm: ids[i].norm, display: ids[i].display ?? null, score: winner.score, comment: winner.comment, wordlist: src },
        edits != null && src === edits);
      if (seed.score === score) return;
      targets.push({ clicked: editBaselineFor(seed), raw: seed.entry, comment: seed.comment });
    });
    if (targets.length) this._onBatchRescore?.(targets, score);
  }

  _deleteAllowed() {
    const edits = getEditsWordlist();
    return edits != null && state.selected === edits && this._selection.size > 0;
  }

  _deleteSelection() {
    const targets = [...this._selection.values()].map(id => ({ norm: id.norm, display: id.display ?? id.norm }));
    if (!targets.length) return;
    this._selection.clear();
    this._render();
    this._onBatchDelete?.(targets);
  }

  // Focus the entry field as a caret (no selection, so typing appends).
  _openCursorPanel() {
    if (this._cursorIndex < 0) return;
    const wlEntry = this._winCache.get(this._cursorIndex)?.atoms?.[0]?.wlEntry;
    if (!wlEntry) return;
    const rowEl = this._mounted.get(this._cursorIndex)?.node ?? null;
    // ≥2, not ≥1: a lone selected row walks the table rather than dead-ending as a
    // one-member walk with nothing to step to.
    if (this._selection.size >= 2) EntryPanel.openSelectionWalk([...this._selection.values()], wlEntry, rowEl, this);
    else EntryPanel.open(wlEntry, rowEl, this, 'entry', 'edit', false);
  }

  // The panel suppresses the scroller's own key nav while modal, so the walk must
  // drive the cursor from here rather than through _onListboxKeydown. Anchor on the
  // panel's active identity, not _cursorIndex: not every open sets the cursor (a touch
  // tap and a Related-entry click don't) — and the transform tier never does, so its
  // walk relies entirely on locating the active atom here.
  _walkBase(fromId) {
    const loc = fromId ? this._locateIdentity(fromId) : { row: -1, atom: 0 };
    return loc.row >= 0 ? loc : { row: this._cursorIndex, atom: loc.atom };
  }

  async stepPanelCursor(delta, fromId) {
    const n = this._renderRowCount();
    const { row: base, atom } = this._walkBase(fromId);
    if (n === 0 || base < 0) return null;
    const target = base + delta;
    if (target < 0 || target >= n) return null;
    // Flat 'replace' tracks the walked row in the table selection (a visible anchor,
    // and Esc-then-Enter reopens it); the transform tier has no selection, so 'move'
    // just cursors + scrolls the row into view.
    await this._moveCursor(target, this._flat ? 'replace' : 'move');
    const atoms = this._winCache.get(this._cursorIndex)?.atoms;
    return atoms?.[Math.min(atom, atoms.length - 1)]?.wlEntry ?? null;
  }

  // Cursor-only ('move', not 'replace'): a multi-select walk moves the cursor to the
  // current member but leaves the picked set selected — 'replace' would collapse the
  // selection to the current row as you step. Best-effort if the member is off-window.
  async setPanelCursor(id) {
    const idx = this._indexOfIdentity(id);
    if (idx >= 0) await this._moveCursor(idx, 'move');
  }

  panelWalkEdges(fromId) {
    const n = this._renderRowCount();
    const base = this._walkBase(fromId).row;
    return { atFirst: base <= 0, atLast: base >= n - 1 };
  }

  // The walk steps the cursor, then the panel adopts the new active identity; re-
  // render so the .active row highlight (keyed off that identity) follows. In the
  // transform tier that highlight is the only anchor — no selection — so without
  // this the walked row scrolls in unhighlighted.
  repaintActiveRow() { this._render(); }

  _stickyOffsetPx() {
    const cs = getComputedStyle(document.documentElement);
    const px = v => parseFloat(cs.getPropertyValue(v)) || 0;
    return px('--header-h') + px('--wordlist-bar-h') + px('--sticky-stack-h');
  }

  _pageRows() {
    return Math.max(1, Math.floor((window.innerHeight - this._stickyOffsetPx()) / this._rowStride()));
  }

  _firstVisibleIndex() {
    const rect = this.host.getBoundingClientRect();
    const visTop = Math.max(0, this._stickyOffsetPx() - rect.top);
    return Math.max(0, Math.min(this._renderRowCount() - 1, Math.round(visTop / this._rowStride())));
  }

  _scrollCursorIntoView() { this._scrollIndexIntoView(this._cursorIndex); }

  // Scrolls the document, not an inner box: the flat scroller windows against the
  // page, so scrollIntoView on an off-window (unmounted) row would no-op.
  _scrollIndexIntoView(i) {
    if (i < 0) return;
    const stride = this._rowStride();
    const rowTop = this.host.getBoundingClientRect().top + i * stride;
    const top = this._stickyOffsetPx();
    if (rowTop < top) window.scrollBy({ top: rowTop - top - 4 });
    else if (rowTop + stride > window.innerHeight) window.scrollBy({ top: rowTop + stride - window.innerHeight + 8 });
  }

  _scrollIndexToCenter(i) {
    if (i < 0) return;
    const stride = this._rowStride();
    const rowTop = this.host.getBoundingClientRect().top + i * stride;
    const top = this._stickyOffsetPx();
    if (rowTop >= top && rowTop + stride <= window.innerHeight) return;
    window.scrollBy({ top: (rowTop + stride / 2) - (top + (window.innerHeight - top) / 2) });
  }

  // ─── Find in page ── see docs/design.md ─────────────────────────────────────
  _installFindKey() {
    this._onFindKey = e => {
      // Escape closes an open find from anywhere — focus may have left the input
      // (a nav step, or the revealed group popover), so the input's own handler
      // isn't enough.
      if (e.key === 'Escape') {
        if (this._findBar && !this._findBar.hidden) { e.preventDefault(); this.closeFind(); }
        return;
      }
      if (e.key !== 'f' && e.key !== 'F') return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (document.querySelector('dialog[open]')) return;   // a modal owns the keyboard
      if (EntryPanel.isOpen()) return;                      // …as does the entry panel (a modal div, not a <dialog>)
      if (!this.host.offsetParent) return;                  // entries view not on screen
      e.preventDefault();
      this.openFind();
    };
    document.addEventListener('keydown', this._onFindKey);
  }

  // The scroller is torn down + rebuilt on some view swaps (rendering.js), so the
  // document-level find key and the bar must be released, or a stale instance's
  // openFind fires and a dead bar accumulates.
  destroy() {
    super.destroy();
    document.removeEventListener('keydown', this._onFindKey);
    clearTimeout(this._findDebounce);
    this._findBar?.remove();
  }

  openFind() {
    const bar = this._ensureFindBar();
    const wasHidden = bar.hidden;
    bar.hidden = false;
    if (wasHidden && !this._findInput.value) {
      const seed = String(window.getSelection?.() ?? '').trim();
      if (seed && seed.length <= 64) this._findInput.value = seed;
    }
    this._findInput.focus();
    this._findInput.select();
    if (this._findInput.value) this._runFind(this._findInput.value);
  }

  // refocus:false when the entry panel is taking over: refocusing would land focus
  // on the table sizer behind the panel's scrim, where it's invisible and stranded.
  closeFind({ refocus = true } = {}) {
    if (!this._findBar || this._findBar.hidden) return;
    this._findSeq++;                     // supersede any in-flight worker reply
    clearTimeout(this._findDebounce);
    const had = !!this._find;
    this._find = null;
    this._findBar.hidden = true;
    GroupMorePopover.close();
    if (had) this._render();
    if (refocus) this.sizer.focus({ preventScroll: true });
  }

  _ensureFindBar() {
    if (this._findBar) return this._findBar;
    const bar = document.createElement('div');
    bar.className = 'find-bar';
    bar.hidden = true;
    const caret = up => `<svg class="entry-walk-caret${up ? ' entry-walk-caret--up' : ''}" viewBox="0 0 8 5" aria-hidden="true"><use href="#icon-chevron"/></svg>`;
    bar.innerHTML =
      `<span class="find-input-wrap">` +
        `<input type="text" class="find-input" aria-label="Find in results">` +
        `<span class="find-count" aria-live="polite"></span>` +
      `</span>` +
      `<button type="button" class="find-prev" aria-label="Previous match" title="Previous (Shift+Enter)">${caret(true)}</button>` +
      `<button type="button" class="find-next" aria-label="Next match" title="Next (Enter)">${caret(false)}</button>` +
      `<button type="button" class="find-close" aria-label="Close find" title="Close (Esc)">✕</button>`;
    document.querySelector('#app .sticky-stack').appendChild(bar);
    const input = bar.querySelector('.find-input');
    input.addEventListener('input', () => this._runFind(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? this.findPrev() : this.findNext(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
      else if ((e.key === 'f' || e.key === 'F') && (e.metaKey || e.ctrlKey) && !e.altKey) { e.preventDefault(); e.stopPropagation(); input.select(); }
    });
    bar.querySelector('.find-prev').addEventListener('click', () => { this.findPrev(); input.focus(); });
    bar.querySelector('.find-next').addEventListener('click', () => { this.findNext(); input.focus(); });
    bar.querySelector('.find-close').addEventListener('click', () => this.closeFind());
    this._findBar = bar;
    this._findInput = input;
    return bar;
  }

  _runFind(query, navigate = true) {
    clearTimeout(this._findDebounce);
    if (!query) {
      this._findSeq++;
      this._find = null;
      this._updateFindBar();
      this._render();
      return;
    }
    this._findDebounce = setTimeout(() => this._doFind(query, navigate), 120);
  }

  async _doFind(query, navigate = true) {
    const seq = ++this._findSeq;
    const reply = await findInResult(this._currentStreamRunId(), query);
    if (seq !== this._findSeq) return;                     // superseded by a newer keystroke or close
    const matches = reply?.matches ?? [];
    const byRow = new Map();
    for (const m of matches) {
      const arr = byRow.get(m.row);
      if (arr) arr.push(m); else byRow.set(m.row, [m]);
    }
    this._find = { query, matches, capped: reply?.capped ?? false, current: -1, byRow };
    this._find.current = this._pickInitialFindMatch();
    this._updateFindBar();
    if (navigate && this._find.current >= 0) this._navigateToCurrentFind();
    else this._render();
  }

  _pickInitialFindMatch() {
    const matches = this._find.matches;
    if (!matches.length) return -1;
    const top = this._firstVisibleIndex();
    for (let k = 0; k < matches.length; k++) if (matches[k].row >= top) return k;
    return 0;
  }

  findNext() { this._stepFind(1); }
  findPrev() { this._stepFind(-1); }
  _stepFind(dir) {
    if (!this._find || !this._find.matches.length) return;
    const n = this._find.matches.length;
    this._find.current = (this._find.current + dir + n) % n;
    this._updateFindBar();
    this._navigateToCurrentFind();
  }

  _isGroupedTier() { return this.sortTier === 'group' || this.sortTier === 'tuple'; }
  _windowIdleForTier() { return this._isGroupedTier() ? this.groupWindowIdle() : this.windowIdle(); }

  async _navigateToCurrentFind() {
    const m = this._find?.matches[this._find.current];
    if (!m) { this._render(); return; }
    this._scrollIndexToCenter(m.row);
    this._render();
    await this._windowIdleForTier();
    if (!this._find || this._find.matches[this._find.current] !== m) return;   // closed / moved on while awaiting
    // Adopt the match as cursor+selection so Esc lands edit-ready. Flat-tier only:
    // _selectSingleAt reads the flat-only _rowIdentity; non-flat rows aren't selectable.
    if (this._flat) this._selectSingleAt(m.row);
    else this._render();
    this._revealGroupMatch(m);
  }

  // A member's chain node is in the row exactly when it's visible (already lit by
  // the render); its absence means it's behind "+N more" — the only case to reveal.
  _revealGroupMatch(m) {
    if (!this._isGroupedTier() || m.member == null || m.member < 0) return;
    const rowNode = this._mounted.get(m.row)?.node;
    if (!rowNode || rowNode.querySelector(`.group-chain[data-chain="${m.member}"]`)) return;
    const moreBtn = rowNode.querySelector('.group-more');
    const g = this._groupAt(m.row);
    if (!moreBtn || moreBtn.hidden || !g) return;
    GroupMorePopover.revealMember(g, moreBtn, this, m.member, this._groupMemberFind(this._find.byRow.get(m.row), m.member));
  }

  // ─── Route reveal ─────────────────────────────────────────────────────────
  // Scrolls a URL-opened entry's row into view — it has no clicked row to have
  // scrolled there already. Latched rather than run inline because boot opens the
  // panel as soon as the worker can seed it, which is before the first pipeline
  // result exists to locate a row in (renderMergedDetail signals firstPaint ahead
  // of awaiting its run).
  revealRouteEntry(id) {
    this._pendingReveal = id;
    if (this._resolved) this._consumePendingReveal();
  }

  async _consumePendingReveal() {
    const id = this._pendingReveal;
    if (!id) return;
    this._pendingReveal = null;
    const token = ++this._revealToken;
    const runId = this._currentStreamRunId();
    const row = await locateInResult(runId, id.norm, id.display ?? null);
    if (row < 0 || token !== this._revealToken || runId !== this._currentStreamRunId()) return;
    if (!this._rowInView(row)) this._scrollIndexToCenter(row);
    this._render();
    await this._windowIdleForTier();
    if (token !== this._revealToken) return;
    if (this._flat) this._selectSingleAt(row);
    else this._render();
  }

  _rowInView(i) {
    const stride = this._rowStride();
    const rowTop = this.host.getBoundingClientRect().top + i * stride;
    return rowTop >= this._stickyOffsetPx() && rowTop + stride <= window.innerHeight;
  }

  _updateFindBar() {
    if (!this._findBar) return;
    const count = this._findBar.querySelector('.find-count');
    const prev = this._findBar.querySelector('.find-prev');
    const next = this._findBar.querySelector('.find-next');
    const find = this._find;
    if (!find || !find.query) {
      count.textContent = '';
      this._findInput.classList.remove('find-nomatch');
      prev.disabled = next.disabled = true;
      return;
    }
    const total = find.matches.length;
    if (!total) {
      count.textContent = 'No results';
      this._findInput.classList.add('find-nomatch');
      prev.disabled = next.disabled = true;
      return;
    }
    this._findInput.classList.remove('find-nomatch');
    count.textContent = `${find.current + 1}/${find.capped ? FIND_MATCH_CAP + '+' : total}`;
    prev.disabled = next.disabled = false;
  }

  // A fresh run reindexes rows, so stale coords would light the wrong ones — drop
  // them and re-scan the new result when the bar is open.
  _refreshFindForNewResult() {
    this._find = null;
    if (this._findBar && !this._findBar.hidden && this._findInput.value) this._runFind(this._findInput.value, false);
  }

  async _rangeIdentities(lo, hi) {
    const cached = [];
    for (let i = lo; i <= hi; i++) {
      const id = this._rowIdentity(i);
      if (!id) { cached.length = 0; break; }
      cached.push(id);
    }
    if (cached.length === hi - lo + 1) return cached;
    const reply = await fetchWorkerRows(this._currentStreamRunId(), lo, hi + 1);
    return reply ? reply.rows.map(r => ({ norm: r.norm, display: r.display ?? null })) : [];
  }

  async _selectRange(a, b) {
    this._setSelection(await this._rangeIdentities(Math.min(a, b), Math.max(a, b)));
  }

  // mode 'move' (Ctrl+arrow) advances the cursor while leaving the selection intact —
  // the cursor and selection set are meant to diverge here, not a bug to "fix".
  async _moveCursor(target, mode) {
    const n = this._renderRowCount();
    if (n === 0) return;
    target = Math.max(0, Math.min(n - 1, target));
    const token = ++this._navToken;
    this._cursorIndex = target;
    this._scrollCursorIntoView();
    this._render();
    if (!this._winCache.has(target)) await this.windowIdle();
    if (token !== this._navToken) return;
    const id = this._rowIdentity(target);
    if (id) this._cursor = id;
    if (mode === 'replace') {
      this._anchorIndex = target; this._anchor = id;
      this._setSelection(id ? [id] : []);
    } else if (mode === 'extend') {
      await this._selectRange(this._anchorIndex < 0 ? target : this._anchorIndex, target);
      if (token !== this._navToken) return;
    }
    this._render();
  }

  _onListboxKeydown(e) {
    // Alt+Up/Down move the cursor like plain Up/Down; every other Alt combo still
    // falls through to the global Alt+digit/letter handler (don't broaden this bail).
    const altArrow = e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown');
    if (!this._flat || EntryPanel.isOpen() || (e.altKey && !altArrow)) return;
    const n = this._renderRowCount();
    if (n === 0) return;
    const mod = e.ctrlKey || e.metaKey;

    if ((e.key === 'a' || e.key === 'A') && mod) { e.preventDefault(); this._selectAllRows(); return; }
    if (e.key === 'Escape') { if (this._clearSelection()) e.preventDefault(); return; }
    if (e.key === 'Enter') { if (this._cursorIndex >= 0) { e.preventDefault(); this._openCursorPanel(); } return; }
    if (e.key === ' ' || e.key === 'Spacebar') { if (this._cursorIndex >= 0) { e.preventDefault(); this._toggleSelectionAt(this._cursorIndex); } return; }
    if (e.key === 'Delete') { if (this._deleteAllowed()) { e.preventDefault(); this._deleteSelection(); } return; }

    if (this._cursorIndex < 0 && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); this._moveCursor(this._firstVisibleIndex(), 'replace'); return;
    }
    const cur = this._cursorIndex;
    const page = Math.max(1, this._pageRows() - 1);
    let target;
    switch (e.key) {
      case 'ArrowDown': target = cur + 1; break;
      case 'ArrowUp':   target = cur - 1; break;
      case 'PageDown':  target = cur + page; break;
      case 'PageUp':    target = cur - page; break;
      case 'Home':      target = 0; break;
      case 'End':       target = n - 1; break;
      default: return;
    }
    e.preventDefault();
    this._moveCursor(target, e.shiftKey ? 'extend' : mod ? 'move' : 'replace');
  }

  _applyListboxRole() {
    if (this._flat) {
      this.sizer.tabIndex = 0;
      this.sizer.setAttribute('role', 'listbox');
      this.sizer.setAttribute('aria-multiselectable', 'true');
    } else {
      this.sizer.tabIndex = -1;
      this.sizer.removeAttribute('role');
      this.sizer.removeAttribute('aria-multiselectable');
      this.sizer.removeAttribute('aria-activedescendant');
    }
  }

  _applyRowSelection(row, i) {
    row.id = 'entry-opt-' + i;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-setsize', this._renderRowCount());
    row.setAttribute('aria-posinset', i + 1);
    const id = this._rowIdentity(i);
    const selected = !!(id && this._selection.has(this._idKey(id)));
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
    row.classList.toggle('cursor', i === this._cursorIndex);
  }

  _announceCount() {
    if (!this._flat) return;
    if (!this._liveRegion) {
      this._liveRegion = document.createElement('div');
      this._liveRegion.className = 'sr-only';
      this._liveRegion.setAttribute('aria-live', 'polite');
      this.host.appendChild(this._liveRegion);
    }
    clearTimeout(this._liveTimer);
    this._liveTimer = setTimeout(() => {
      const n = this._renderRowCount();
      this._liveRegion.textContent = n === 0 ? 'No matches' : `${n} ${n === 1 ? 'entry' : 'entries'}`;
    }, 500);
  }

  setEntries(result, atomCount = this.atomCount, sortTier = this.sortTier) {
    GroupMorePopover.close();
    ScorePicker.close();
    SortMenu.close();
    this._setChainShape(atomCount, sortTier);
    this._ingestResult(result);
    this._invalidateSortCache();
    // Reset (not reconcile like updateEntries): setEntries means a fresh corpus, so
    // a preserved selection would silently carry one scope's picks into another.
    this._resetSelectionState();
    this._sortAndRender();
    this._consumePendingReveal();
  }

  updateEntries(result, atomCount = this.atomCount, sortTier = this.sortTier) {
    ScorePicker.close();
    SortMenu.close();
    const tierChanged = this._setChainShape(atomCount, sortTier);
    this._ingestResult(result);
    this._invalidateSortCache();
    if (tierChanged) rebuildEntryHeaders();
    this._sortAndRender();
    // Must follow _sortAndRender: it reseeds the win cache to the new window, which
    // _reconcileSelectionCursor scans — run before, and it maps identities against
    // the prior run's window and silently lands the cursor on the wrong row.
    if (this._reconcileSelectionCursor()) this._render();
    EntryPanel.rebindEntry(this);
    this._consumePendingReveal();
  }

  // Empties the table to the tuple-streaming shape with the dots up, ahead of the
  // first batch. Leaves _streamRunId null on purpose: the first batch's fresh branch
  // re-inits off the mismatch, and the terminal result settles a no-result run.
  beginStreamPending() {
    GroupMorePopover.close();
    ScorePicker.close();
    SortMenu.close();
    this._streamPending = true;
    this._streamRunId = null;
    this._streamVersion = null;
    this._cancelStreamStatsRefresh();
    const tierChanged = this._setChainShape(this.atomCount || 1, 'tuple');
    // _setChainShape marks the result resolved; unset it so an empty table reads as
    // "searching" (dots, no quip), not "No matches", until the first batch/result.
    this._resolved = false;
    if (tierChanged) rebuildEntryHeaders();
    this._flat = false;
    this._transform = false;
    this._streamTotal = null;
    this._workerGroupCount = 0;
    this._capped = false;
    this._workerChainCount = 0;
    this._workerStats = null;
    this._workerHistogramCounts = null;
    this._workerGroupWidthHints = null;
    this._workerFiltered = !!this._scoreIntervals;
    this._firstGroups = null;
    this._firstChains = null;
    this._firstRows = null;
    this.allEntries = [];
    this._groupWinCache.clear();
    this._groupWinCacheRunId = null;
    this._winCache.clear();
    this._winCacheRunId = null;
    this._existsInScope = null;
    this._rebindQuery = null;
    this._rebindEntry = null;
    this._rebindExists = null;
    this._panel()?.classList.add('pipeline-streaming');
    this._invalidateSortCache();
    // _sortAndRender repaints the stats bar (and so the dots) because _streamRunId
    // is null here — the active-stream rAF-coalesce path it otherwise routes through.
    this._sortAndRender();
  }

  // Each batch is a SORTED snapshot, not an append: positions reshuffle as better
  // matches arrive, so the position-keyed win-cache is wholly rebuilt per batch
  // (top window re-seeded from firstRows; scrolled-away windows re-fetch against
  // _streamVersion).
  appendStreamBatch(batch) {
    const { runId, version, windowStart = 0, total, firstRows, widthHints,
            stats, histogramCounts, filtered } = batch;
    const fresh = this._streamRunId !== runId;
    if (fresh) {
      GroupMorePopover.close();
      ScorePicker.close();
      SortMenu.close();
      this._streamPending = false;
      const tierChanged = this._setChainShape(1, 'single');
      if (tierChanged) rebuildEntryHeaders();
      this._flat = true;
      this._transform = false;
      this._streamRunId = runId;
      this._streamTotal = 0;
      this.allEntries = [];
      this._firstRows = null;
      this._firstChains = null;
      this._firstGroups = null;
      this._ranAgainstOwned = true;
      // No streamed rebind answer; null these so a mid-stream findResultEntry can't
      // consult the prior run's stale answer. The terminal result rebinds the panel.
      this._existsInScope = null;
      this._rebindQuery = null;
      this._rebindEntry = null;
      this._rebindExists = null;
      this._winCacheRunId = runId;
      this._panel()?.classList.add('pipeline-streaming');
    }

    this._streamVersion = version;
    this._streamTotal = total;
    this._workerStats = stats ?? null;
    this._workerHistogramCounts = histogramCounts ?? null;
    this._workerFiltered = !!filtered;

    // A new run clears; a continuing one keeps its windows so a scrolled-away
    // position holds its rows (stale-while-revalidate) instead of blanking to a
    // skeleton each batch. The worker ships the viewport window at windowStart.
    if (fresh) this._winCache.clear();
    if (firstRows && firstRows.length) {
      const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
      firstRows.forEach((row, k) =>
        this._winCache.set(windowStart + k, this._richRowToChain(row, sourceById)));
    }

    this._widthHints = widthHints;
    this._invalidateSortCache();
    this._sortAndRender();
    // First batch: paint the dots + initial readouts synchronously so the panel
    // class and the dots can't disagree mid-frame; later batches coalesce to rAF.
    if (fresh) this.onFilterChange?.();
    else this._scheduleStreamStatsRefresh();
  }

  // Each batch is a SORTED snapshot (positions reshuffle), so the group window
  // cache is rebuilt per batch and a scrolled-away window re-fetches against
  // _streamVersion — a window served at a version the order moved past is dropped.
  // The worker ships cumulative stats/histogram because main holds no resident lane
  // scores to recompute from.
  appendGroupStreamBatch(batch) {
    const { runId, version, windowStart = 0, atomCount, total, chainCount, firstGroups,
            groupWidthHints, stats, histogramCounts, filtered } = batch;
    const fresh = this._streamRunId !== runId;
    if (fresh) {
      GroupMorePopover.close();
      ScorePicker.close();
      SortMenu.close();
      this._streamPending = false;
      const tierChanged = this._setChainShape(atomCount, 'tuple');
      if (tierChanged) rebuildEntryHeaders();
      this._flat = false;
      this._transform = false;
      this._streamRunId = runId;
      this._streamTotal = null;
      this._firstRows = null;
      this._firstChains = null;
      this._ranAgainstOwned = false;
      this._existsInScope = null;
      this._rebindQuery = null;
      this._rebindEntry = null;
      this._rebindExists = null;
      this._groupWinCacheRunId = runId;
      this._panel()?.classList.add('pipeline-streaming');
    }

    this._streamVersion = version;
    this._workerGroupCount = total;
    this._workerChainCount = chainCount;
    this._workerStats = stats ?? null;
    this._workerHistogramCounts = histogramCounts ?? null;
    this._workerGroupWidthHints = groupWidthHints ?? null;
    this._workerFiltered = !!filtered;
    this._firstGroups = firstGroups;

    // Clear only on a new run; a continuing one keeps scrolled-away windows so they
    // hold their rows instead of strobing to skeletons (see appendStreamBatch). The
    // worker ships the viewport window at windowStart.
    if (fresh) this._groupWinCache.clear();
    firstGroups.forEach((g, i) => this._groupWinCache.set(windowStart + i, g));

    this._invalidateSortCache();
    this._sortAndRender();
    if (fresh) this.onFilterChange?.();
    else this._scheduleStreamStatsRefresh();
  }

  // Setting _winCacheRunId here is load-bearing: it makes _invalidateWinCacheIfStale a
  // no-op so the windowStart-keyed seed below isn't clobbered by a 0-keyed _firstChains
  // re-seed. firstChains arrive already decoded (pipeline-worker), unlike the flat tier.
  appendTransformStreamBatch(batch) {
    const { runId, version, windowStart = 0, atomCount, total, firstChains,
            widthHints, stats, histogramCounts, filtered } = batch;
    const fresh = this._streamRunId !== runId;
    if (fresh) {
      GroupMorePopover.close();
      ScorePicker.close();
      SortMenu.close();
      this._streamPending = false;
      const tierChanged = this._setChainShape(atomCount, 'multi');
      if (tierChanged) rebuildEntryHeaders();
      this._flat = false;
      this._transform = true;
      this._streamRunId = runId;
      this._streamTotal = null;
      this._firstRows = null;
      this._firstGroups = null;
      this._firstChains = null;
      this._workerGroupCount = null;
      this._workerGroupWidthHints = null;
      this._ranAgainstOwned = true;
      this._existsInScope = null;
      this._rebindQuery = null;
      this._rebindEntry = null;
      this._rebindExists = null;
      this.allEntries = [];
      this._winCacheRunId = runId;
      this._panel()?.classList.add('pipeline-streaming');
    }

    this._streamVersion = version;
    this._workerChainCount = total;
    this._workerStats = stats ?? null;
    this._workerHistogramCounts = histogramCounts ?? null;
    this._workerFiltered = !!filtered;
    this._widthHints = widthHints;

    if (fresh) this._winCache.clear();
    if (firstChains && firstChains.length) {
      firstChains.forEach((row, k) => this._winCache.set(windowStart + k, row));
    }

    this._invalidateSortCache();
    this._sortAndRender();
    if (fresh) this.onFilterChange?.();
    else this._scheduleStreamStatsRefresh();
  }

  // Mid-stream a reprojected snapshot rides the continuing-batch path (same runId → the
  // append's `fresh` guard stays false). Settled it must NOT flow through _ingestResult —
  // that clears the stream scalars and strobes skeletons — so refresh the view in place.
  ingestReproject(batch) {
    if (batch.runId !== this._currentStreamRunId()) return;
    const tier = batch.firstRows !== undefined ? 'flat'
      : batch.firstGroups !== undefined ? 'grouped' : 'transform';
    if (this._streamRunId === batch.runId) {
      if (tier === 'flat') this.appendStreamBatch(batch);
      else if (tier === 'grouped') this.appendGroupStreamBatch(batch);
      else this.appendTransformStreamBatch(batch);
      return;
    }
    this._ingestReprojectSettled(tier, batch);
  }

  // The order moved but the runId didn't, so the cache's runId-keyed staleness check
  // won't fire; clear + re-seed here or stale-order rows persist. _sortAndRender then
  // re-fetches the rest of the visible window at the new order.
  _ingestReprojectSettled(tier, batch) {
    this._workerStats = batch.stats ?? null;
    this._workerHistogramCounts = batch.histogramCounts ?? null;
    this._workerFiltered = !!batch.filtered;
    const windowStart = batch.windowStart ?? 0;
    if (tier === 'flat') {
      this._workerFlatCount = batch.total ?? 0;
      this._widthHints = batch.widthHints;
      this._firstRows = batch.firstRows ?? null;
      this._winCache.clear();
      if (batch.firstRows?.length) {
        const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
        batch.firstRows.forEach((row, k) => this._winCache.set(windowStart + k, this._richRowToChain(row, sourceById)));
      }
      this._winCacheRunId = batch.runId;
    } else if (tier === 'grouped') {
      this._workerGroupCount = batch.total ?? 0;
      this._workerChainCount = batch.chainCount ?? null;
      this._workerGroupWidthHints = batch.groupWidthHints ?? null;
      this._firstGroups = batch.firstGroups ?? null;
      this._groupWinCache.clear();
      (batch.firstGroups ?? []).forEach((g, i) => this._groupWinCache.set(windowStart + i, g));
      this._groupWinCacheRunId = batch.runId;
    } else {
      this._workerChainCount = batch.total ?? 0;
      this._widthHints = batch.widthHints;
      this._firstChains = batch.firstChains ?? null;
      this._winCache.clear();
      (batch.firstChains ?? []).forEach((row, k) => this._winCache.set(windowStart + k, row));
      this._winCacheRunId = batch.runId;
    }
    this._invalidateSortCache();
    this._sortAndRender();
  }

  _panel() {
    return this.host.closest('#entries-table-panel');
  }

  _scheduleStreamStatsRefresh() {
    if (this._streamStatsRaf) return;
    this._streamStatsRaf = requestAnimationFrame(() => {
      this._streamStatsRaf = 0;
      this.onFilterChange?.();
    });
  }

  _cancelStreamStatsRefresh() {
    if (!this._streamStatsRaf) return;
    cancelAnimationFrame(this._streamStatsRaf);
    this._streamStatsRaf = 0;
  }

  _ingestResult(result) {
    // Clear the streaming scalars or a completed result keeps sizing from the
    // stale _streamTotal and keying fetches off the stream's runId forever.
    const wasStreaming = this._streamRunId != null || this._streamPending;
    this._streamTotal = null;
    this._streamRunId = null;
    this._streamPending = false;
    this._streamVersion = null;
    this._errored = !!result.errored;
    this._flat = !!result.flat;
    this._transform = !!result.transform;
    // Every tier paints final order while streaming (flat/tuple by a total
    // comparator, transform by folding online to the canonical survivor), and
    // completion adopts that order — so KEEP the stream's win-cache: leaving the
    // runId set makes the next render's _invalidate*WinCacheIfStale a no-op, so a
    // scrolled-away viewport doesn't blank to skeletons (the completion flash this
    // change removes). The seq bumps still run: once _streamRunId clears,
    // _fetchWindow's seq guard is the only thing left to drop an in-flight fetch
    // caching a stale row.
    if (wasStreaming) {
      this._winReqSeq++;
      this._groupReqSeq++;
      this._cancelStreamStatsRefresh();
      this._panel()?.classList.remove('pipeline-streaming');
    }
    if (this._flat) {
      this._workerStats = result.stats ?? null;
      this._workerHistogramCounts = result.histogramCounts ?? null;
      this._workerFiltered = !!result.filtered;
      this._workerFlatCount = result.count ?? 0;
      this._ranAgainstOwned = !!result.ranAgainstOwned;
      this._existsInScope = result.existsInScope ?? null;
      this._rebindQuery = result.rebindQuery ?? null;
      this._rebindEntry = result.rebindEntry ?? null;
      this._rebindExists = result.rebindExists ?? null;
      this._widthHints = result.widthHints;
      this.allEntries = [];
      this._firstRows = result.firstRows ?? null;
      this._firstChains = null;
      this._firstGroups = null;
    } else if (this._transform) {
      // Windowed like flat: allEntries stays empty, so stats / histogram / width
      // hints / rebind all come from the worker (recomputing locally would see no
      // rows). Only a first window of chains ships inline.
      this._workerStats = result.stats ?? null;
      this._workerHistogramCounts = result.histogramCounts ?? null;
      this._workerGroupWidthHints = null;
      this._workerChainCount = result.chainCount ?? 0;
      this._workerGroupCount = null;
      this._workerFiltered = !!result.filtered;
      this._ranAgainstOwned = !!result.ranAgainstOwned;
      this._existsInScope = result.existsInScope ?? null;
      this._rebindQuery = result.rebindQuery ?? null;
      this._rebindEntry = result.rebindEntry ?? null;
      this._rebindExists = result.rebindExists ?? null;
      this._widthHints = result.widthHints;
      this._firstChains = result.firstChains ?? [];
      this._firstGroups = null;
      this.allEntries = [];
    } else {
      // The grouped worker stats/counts are FILTERED (the worker applies the score
      // range), and its histogram is UNFILTERED — _workerFiltered carries that to
      // the rendering.js guard so it consumes the worker's filtered Min/Max under a
      // range instead of recomputing.
      this._workerStats = result.stats ?? null;
      this._workerHistogramCounts = result.histogramCounts ?? null;
      this._workerGroupWidthHints = result.groupWidthHints ?? null;
      this._workerChainCount = result.chainCount ?? null;
      this._workerGroupCount = result.groupCount ?? null;
      this._capped = !!result.capped;
      this._workerFiltered = !!result.filtered;
      this._ranAgainstOwned = false;
      this._existsInScope = null;
      this._rebindQuery = null;
      this._rebindEntry = null;
      this._rebindExists = null;
      // result.rows is only the first WINDOW of groups, not all of them. Leave
      // allEntries empty so a consumer can't iterate a partial window as the full
      // group list (silently wrong counts/rebind over a large result); the render
      // and sync rebind read _groupWinCache (keyed by absolute index) instead.
      this._firstGroups = result.rows;
      this._firstChains = null;
      this.allEntries = [];
    }
  }

  _setChainShape(atomCount, sortTier) {
    const tierChanged = sortTier !== this.sortTier;
    this.atomCount = atomCount;
    this.sortTier = sortTier;
    this.sortList = AppView.sortList;
    this._resolved = true;
    return tierChanged;
  }

  // Sort and score-range are VIEW ops: the worker re-derives the view over its retained
  // join (reprojectMergedScroller) rather than re-running the join. Main holds no
  // comparator to reorder locally, so the reprojected snapshot ships the new window.
  setScoreRange(range) {
    const next = range || '';
    if (next === this.scoreRange) return;
    this.scoreRange = next;
    this._scoreIntervals = next ? parseRange(next) : null;
    this._invalidateSortCache();
    this.resetSelectionForViewChange();
    reprojectMergedScroller();
  }

  _invalidateSortCache() {
    this._sortedSource = null;
  }

  applySort(key, dir) { this.applySortList([{ key, dir }]); }

  // rebuildEntryHeaders looks redundant here — its only other caller fires on a
  // tier flip — but it's what re-syncs the header arrows on same-tier sort changes.
  applySortList(list) {
    AppView.setSortList(list);
    this.sortList = AppView.sortList;
    rebuildEntryHeaders();
    reprojectMergedScroller();
    _navigate();
  }

  _sortAndRender() {
    this._revealEmpty = false;
    clearTimeout(this._emptyRevealTimer);
    this._emptyRevealTimer = null;
    this._refreshFindForNewResult();
    this.entries = this._getSortedSource();
    this._computeSlotWidths();
    this._render();
    this._announceCount();
    // Not a suppression: while streaming the stats bar still refreshes, but via
    // _scheduleStreamStatsRefresh's rAF coalesce — firing it here too would
    // rebuild the histogram on every partial.
    if (this._streamRunId == null) this.onFilterChange?.();
    // _sizerHeightFor parks the no-match quip below the fold while a search
    // input is focused. Reveal it after a typing pause — debounced so the quip
    // settles on the final query rather than re-rolling each keystroke (blur,
    // via _onFocusOut, reveals immediately).
    if (this.entries.length === 0 && this._isReservationActive()) {
      this._emptyRevealTimer = setTimeout(() => {
        this._emptyRevealTimer = null;
        this._revealEmpty = true;
        this._render();
      }, EMPTY_REVEAL_DELAY_MS);
    }
  }

  previewRescore() {
    this._computeSlotWidths();
    this._render();
  }

  _getSortedSource() {
    const sig = sortSig(this.sortList);
    if (this._sortedSource
        && this._sortedSourceSig === sig
        && this._sortedSourceRange === this.scoreRange) {
      return this._sortedSource;
    }

    // Every tier arrives pre-sorted + pre-filtered from the worker and is windowed:
    // `entries` here is only the inline first window — non-empty iff the result is
    // non-empty, the invariant _sortAndRender's empty-state check keys on. The render
    // sizes from the worker's count and pulls visible rows from the window cache.
    let sorted;
    if (this._flat) {
      sorted = this._firstRows ?? [];
    } else if (isMultiLaneTier(this.sortTier)) {
      sorted = this._firstGroups ?? [];
    } else {
      sorted = this._firstChains ?? [];
    }

    this._sortedSource = sorted;
    this._sortedSourceSig = sig;
    this._sortedSourceRange = this.scoreRange;
    return sorted;
  }

  // Slot widths derived from the longest values across the full result set, then
  // fixed during scroll. Capping the entry slot at ENTRY_SLOT_CAP keeps one outlier
  // from blowing out layout for every other row; longer entries truncate with an
  // ellipsis (full text in the atom's title attribute). Min widths floor each
  // track to its column-header label so the sticky headers fit. Vars are written
  // to #detail-panel so both .entry-row and the .entry-headers (which lives in
  // .sticky-stack, a sibling of the scroller's host) inherit the same values.
  _computeSlotWidths() {
    // An errored or not-yet-streamed result carries no width hints; the
    // transform/group sizers would destructure null. The flat header still
    // renders while pending, though — its shape tracks the tool stack, not the
    // scroller's transient 'tuple' tier — so seed its label floors or the
    // labels sit at the CSS fallback with no rows to widen them.
    if (this._errored || this._streamPending) { this._seedFlatHeaderFloors(); return; }
    if (isMultiLaneTier(this.sortTier)) { this._computeGroupSlotWidths(); return; }
    if (this._flat) { this._computeFlatSlotWidths(); return; }
    this._computeTransformSlotWidths();
  }

  // Only fills unset vars: a content-sized track already floors to the same
  // label px and must stick, so a later empty search doesn't shrink it back.
  _seedFlatHeaderFloors() {
    const target = this.host.closest('#detail-panel') || this.sizer;
    const seed = (name, px) => {
      if (!target.style.getPropertyValue(name)) target.style.setProperty(name, `${px}px`);
    };
    seed('--entry-w', sortableHeaderPx('Entry'));
    seed('--len-w', sortableHeaderPx('Length'));
    seed('--score-w', sortableHeaderPx('Score'));
  }

  _computeFlatSlotWidths() {
    // The merged corpus's maxes floor every column so the table holds one width
    // across scopes/filters/streams; a result that truly exceeds the floor (a
    // multiplying tool, a disabled-list scope) still grows past it.
    const floor = mergedWidthBound();
    const countCeil = Math.max(this._streamTotal ?? this._workerFlatCount ?? 0, mergedEntryCount());
    const countDigits = countCeil > 0 ? String(countCeil).length : 1;
    const ch = measureMonoChPx();
    const h = this._widthHints;
    const maxDisplayLen = Math.max(h.maxDisplayLen, floor?.maxDisplayLen ?? 0);
    const maxLenDigits = Math.max(h.maxLenDigits, floor?.maxLenDigits ?? 1);
    const maxScoreDigits = Math.max(h.maxScoreDigits, floor?.maxScoreDigits ?? 1);
    const rawHint = Math.max(h.maxRawDigits ?? 0, floor?.maxRawDigits ?? 0);
    // rawHint is committed-only; a draft can show any row's true raw, up to
    // maxScoreDigits wide, so take the max or a buffered arrow clips here.
    const maxRawDigits = rescorePreviewActive() ? Math.max(rawHint, maxScoreDigits) : 0;

    // The +1 char is rounding slack: a <mark> splits a highlighted entry into
    // separately pixel-rounded text runs whose widths can overshoot the bare string
    // and trip a false ellipsis. Reserved unconditionally (not just when a search
    // highlights) so the column holds one width browse vs search.
    const entryContentW = Math.ceil((Math.min(maxDisplayLen, ENTRY_SLOT_CAP) + 1) * ch) + 1;
    const target = this.host.closest('#detail-panel') || this.sizer;
    target.style.setProperty('--count-w', `${(countDigits + 1) * ch}px`);
    target.style.setProperty('--entry-w', `${Math.max(entryContentW, sortableHeaderPx('Entry'))}px`);
    target.style.setProperty('--len-w', `${Math.max(maxLenDigits * ch, sortableHeaderPx('Length'))}px`);
    const arrowPrefixW = maxRawDigits ? maxRawDigits * ch + measureScoreArrowPx() : 0;
    target.style.setProperty('--score-w', `${Math.max(badgeWidthPx(maxScoreDigits) + arrowPrefixW, sortableHeaderPx('Score'))}px`);
    target.style.setProperty('--source-max', `${sourceColMaxPx(sourceMatrixSlots().length)}px`);
  }

  _computeTransformSlotWidths() {
    const floor = mergedWidthBound();
    const countCeil = Math.max(this._workerChainCount ?? 0, mergedEntryCount());
    const countDigits = countCeil > 0 ? String(countCeil).length : 1;
    const ch = measureMonoChPx();
    const glyphCh = measureAtomGlyphPx() / ch;
    const h = this._widthHints;
    const maxDisplayLen = Math.max(h.maxDisplayLen, floor?.maxDisplayLen ?? 0);
    const maxLenDigits = Math.max(h.maxLenDigits, floor?.maxLenDigits ?? 1);
    const maxScoreDigits = Math.max(h.maxScoreDigits, floor?.maxScoreDigits ?? 1);
    const rawHint = Math.max(h.maxRawDigits ?? 0, floor?.maxRawDigits ?? 0);
    // The worker ships the widest glyph atom's text length apart from the overall
    // widest (it can't measure the glyph prefix); add the measured glyph width back
    // and max the two, or a glyph row's prefix drops out of the entry slot.
    const maxLen = Math.max(maxDisplayLen, h.maxGlyphDisplayLen > 0 ? h.maxGlyphDisplayLen + glyphCh : 0);
    const maxRawDigits = rescorePreviewActive() ? Math.max(rawHint, maxScoreDigits) : 0;
    // +1 char of rounding slack for a <mark>'s split text runs (see
    // _computeFlatSlotWidths), reserved unconditionally for a stable column width.
    const entryContentW = Math.ceil(
      (Math.min(maxLen, ENTRY_SLOT_CAP + glyphCh) + 1) * ch
    ) + 1;
    const target = this.host.closest('#detail-panel') || this.sizer;
    target.style.setProperty('--count-w', `${(countDigits + 1) * ch}px`);
    target.style.setProperty('--entry-w', `${Math.max(entryContentW, sortableHeaderPx('Entry'))}px`);
    target.style.setProperty('--len-w', `${Math.max(maxLenDigits * ch, sortableHeaderPx('Length'))}px`);
    const arrowPrefixW = maxRawDigits ? maxRawDigits * ch + measureScoreArrowPx() : 0;
    target.style.setProperty('--score-w', `${Math.max(badgeWidthPx(maxScoreDigits) + arrowPrefixW, sortableHeaderPx('Score'))}px`);
    target.style.setProperty('--source-max', `${sourceColMaxPx(sourceMatrixSlots().length)}px`);
  }

  // The worker always ships these for a grouped result; the local re-derive is a
  // null-safety fallback that must NOT iterate the now-partial window — return 0
  // rather than undercount over a windowed list.
  _visibleGroupChainCount() {
    return this._workerChainCount ?? 0;
  }

  _groupCount() {
    return this._workerGroupCount ?? 0;
  }

  _groupAt(idx) {
    return this._groupWinCache.get(parseInt(idx, 10)) ?? null;
  }

  _rowStride() {
    return this.atomCount * ROW_HEIGHT;
  }

  isStreaming() {
    return this._streamRunId != null || this._streamPending;
  }

  // Transform holds only a window, so size from the worker's count, NOT a resident
  // array length — the latter would silently cap the scroll at the first window.
  _renderRowCount() {
    if (this._flat) return this._streamTotal ?? this._workerFlatCount ?? 0;
    // A tuple renders one row per tuple (_groupCount); _workerChainCount counts
    // lanes, which double-counts since each lane is its own chain object.
    if (this.sortTier === 'tuple') return this._groupCount();
    return this._workerChainCount ?? 0;
  }

  // Using lastCompletedRunId() during a stream would name the prior run and serve
  // its rows — the in-flight stream's runId must win while one is active. Shared by
  // the flat and grouped/tuple fetch paths (a run streams in exactly one tier).
  _currentStreamRunId() {
    return this._streamRunId ?? lastCompletedRunId();
  }

  // Tell the worker which window to ship in each streaming snapshot. Deduped so a
  // batch-driven re-render at an unchanged scroll position doesn't re-post; only
  // active while streaming (a settled result serves scrolls via fetch).
  _reportViewport(start, end) {
    const runId = this._streamRunId;
    if (runId == null) return;
    const v = this._sentViewport;
    if (v && v.runId === runId && v.start === start && v.end === end) return;
    this._sentViewport = { runId, start, end };
    sendViewport(runId, start, end);
  }

  _render() {
    const plan = this._renderPlan();
    const n = plan.rowCount();
    const stride = this._rowStride();
    this.sizer.style.height = this._sizerHeightFor(n * stride) + 'px';
    this._renderFooter(n);

    const { start, end } = this._visibleRange(n);
    this._reportViewport(start, end);

    plan.invalidateCache();

    const ctx = plan.buildRenderCtx();
    let nextActiveRow = null;
    let minMiss = -1, maxMiss = -1;
    let prev = null;
    for (let i = start; i < end; i++) {
      const decoded = plan.cache.get(i) ?? null;
      let cls, html, built = null;
      if (decoded) {
        built = plan.buildRow(decoded, i, ctx);
        html = built.html;
        cls = plan.rowClass;
      } else {
        html = plan.skeletonHTML(i);
        cls = plan.skeletonClass;
        if (minMiss < 0) minMiss = i;
        maxMiss = i;
      }
      const sig = cls + '\0' + html;

      const mounted = this._mounted.get(i);
      let node;
      if (mounted && mounted.sig === sig) {
        node = mounted.node;
      } else {
        if (mounted) mounted.node.remove();
        node = document.createElement('div');
        node.className = cls;
        node.dataset.idx = i;
        node.innerHTML = html;
        this._mounted.set(i, { node, sig });
      }

      // Re-derived every render even on a kept node — position, active, and the
      // family bracket key off stride/active-entry/neighbors, not row content.
      node.style.top = (i * stride) + 'px';
      if (built) {
        if (built.dataEntry !== undefined) node.dataset.entry = built.dataEntry;
        if (built.wlEntry !== undefined) node._wlEntry = built.wlEntry;
      }
      node.classList.toggle('active', !!built?.active);
      plan.decorateRow(node, i);
      if (built?.active) nextActiveRow = node;

      if (prev ? prev.nextSibling !== node : this.sizer.firstChild !== node) {
        prev ? prev.after(node) : this.sizer.prepend(node);
      }
      prev = node;
    }

    for (const [i, m] of this._mounted) {
      if (i < start || i >= end) { m.node.remove(); this._mounted.delete(i); }
    }

    if (nextActiveRow) EntryPanel.rebindRow(nextActiveRow);

    this._applyListboxRole();
    if (this._flat && this._cursorIndex >= start && this._cursorIndex < end) {
      this.sizer.setAttribute('aria-activedescendant', 'entry-opt-' + this._cursorIndex);
    } else if (this._flat) {
      this.sizer.removeAttribute('aria-activedescendant');
    }

    if (minMiss >= 0) {
      const lo = Math.max(0, minMiss - VS_BUFFER);
      const hi = Math.min(n, maxMiss + 1 + VS_BUFFER);
      plan.fetchWindow(lo, hi);
    }
    this._evictCache(plan.cache, start, end);
  }

  _renderPlan() {
    if (this.sortTier === 'group') return this._groupRenderPlan();
    if (this.sortTier === 'tuple') return this._tupleRenderPlan();
    return this._chainRenderPlan();
  }

  _chainRenderPlan() {
    const preview = rescorePreviewActive();
    const draftRules = preview ? getDraftRescoreRules() : null;
    const activeNorm = EntryPanel.activeNorm(this);
    return {
      cache: this._winCache,
      rowClass: 'entry-row entry-row-font',
      skeletonClass: 'entry-row entry-row-font skeleton',
      rowCount: () => this._renderRowCount(),
      buildRenderCtx: () => {
        this._sourceSlots = sourceMatrixSlots();
        return { activeNorm, preview, draftRules };
      },
      buildRow: (chainRow, i, ctx) =>
        this._buildChainRow(chainRow, i, ctx.activeNorm, ctx.preview, ctx.draftRules),
      skeletonHTML: i => `<span class="atom-count">${i + 1}.</span>`,
      decorateRow: (row, i) => {
        if (this._flat) { this._applyFamilyBracket(row, i); this._applyRowSelection(row, i); }
      },
      invalidateCache: () => this._invalidateWinCacheIfStale(),
      fetchWindow: (lo, hi) => this._fetchWindow(lo, hi),
    };
  }

  _groupRenderPlan() {
    const activeNorm = EntryPanel.activeNorm(this);
    const stack = ToolStack.getStack();
    const columns = activeGroupColumns(stack);
    const hasAnchor = !!activeGroupAnchorLabel(stack);
    return {
      cache: this._groupWinCache,
      rowClass: 'group-row entry-row-font',
      skeletonClass: 'group-row entry-row-font skeleton',
      rowCount: () => this._groupCount(),
      buildRenderCtx: () => ({
        activeNorm, columns, hasAnchor,
        monoCh: this._groupMonoCh || measureMonoChPx(),
        glyphPx: this._groupGlyphPx || 0,
        slot: Math.max(0, this.host.clientWidth - (this._groupChromeWidth || 0)),
      }),
      buildRow: (g, i, ctx) => ({
        html: this._renderGroupRowHTML(g, i, ctx.columns, ctx.hasAnchor, ctx),
        active: !!(ctx.activeNorm && (
          (g.anchor && g.anchor.norm === ctx.activeNorm) ||
          g.chains.some(c => c.atoms.some(a => a.wlEntry.norm === ctx.activeNorm))
        )),
      }),
      skeletonHTML: i => `<span class="group-rownum">${i + 1}.</span>`,
      decorateRow: () => {},
      invalidateCache: () => this._invalidateGroupWinCacheIfStale(),
      fetchWindow: (lo, hi) => this._fetchGroupWindow(lo, hi),
    };
  }

  // A tuple shares the grouped result's window machinery (cache, fetch, count) but
  // renders as bare fixed-N lanes: no key/anchor/columns and never an overflow
  // chip — every lane of a solution must show, so unlike a group row it can't clip.
  _tupleRenderPlan() {
    const activeNorm = EntryPanel.activeNorm(this);
    return {
      cache: this._groupWinCache,
      rowClass: 'group-row tuple-row entry-row-font',
      skeletonClass: 'group-row entry-row-font skeleton',
      rowCount: () => this._groupCount(),
      buildRenderCtx: () => ({
        activeNorm,
        monoCh: this._groupMonoCh || measureMonoChPx(),
        glyphPx: this._groupGlyphPx || 0,
      }),
      buildRow: (tuple, i, ctx) => ({
        html: this._renderTupleRowHTML(tuple, i),
        active: !!(ctx.activeNorm &&
          tuple.chains.some(c => c.atoms.some(a => a.wlEntry.norm === ctx.activeNorm))),
      }),
      skeletonHTML: i => `<span class="group-rownum">${i + 1}.</span>`,
      decorateRow: () => {},
      invalidateCache: () => this._invalidateGroupWinCacheIfStale(),
      fetchWindow: (lo, hi) => this._fetchGroupWindow(lo, hi),
    };
  }

  _renderTupleRowHTML(tuple, rowIdx) {
    const rowMatches = this._find?.byRow.get(rowIdx) || null;
    const chainsHTML = tuple.chains
      .map((c, ci) => buildGroupChainHTML(c, ci, this._groupMemberFind(rowMatches, ci))).join('');
    return `<span class="group-rownum">${rowIdx + 1}.</span>` +
      `<div class="group-chains">${chainsHTML}</div>`;
  }

  // A run change reindexes the corpus, so position-keyed cache entries name the
  // wrong rows — drop them when the run changes, then seed the cache from the
  // result's inline first window so the above-the-fold rows render without a
  // fetchRows round-trip (no skeleton flash for a result that fits on screen).
  _invalidateWinCacheIfStale() {
    const runId = this._currentStreamRunId();
    if (runId === this._winCacheRunId) return;
    this._winCacheRunId = runId;
    this._seedWinCache(this._winCache, () => {
      if (this._flat) {
        if (!this._firstRows) return;
        const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
        this._firstRows.forEach((row, i) =>
          this._winCache.set(i, this._richRowToChain(row, sourceById)));
      } else if (this._firstChains) {
        this._firstChains.forEach((row, i) => this._winCache.set(i, row));
      }
    });
  }

  // Mirrors _invalidateWinCacheIfStale: a run change re-orders the groups, so
  // absolute-index-keyed cache entries name the wrong groups — drop them, then
  // seed from the inline first window so above-the-fold rows render with no fetch.
  _invalidateGroupWinCacheIfStale() {
    const runId = this._currentStreamRunId();
    if (runId === this._groupWinCacheRunId) return;
    this._groupWinCacheRunId = runId;
    this._seedWinCache(this._groupWinCache, () => {
      if (this._firstGroups) {
        this._firstGroups.forEach((g, i) => this._groupWinCache.set(i, g));
      }
    });
  }

  _seedWinCache(cache, seed) {
    cache.clear();
    seed();
  }

  // The keep-window strictly contains [start, end): the render reads cache[i] for
  // i in [start, end), so an entry evicted there would blank a visible row. Narrow
  // it past the viewport and rows silently go blank — keep WINDOW_CACHE_KEEP > 0.
  _evictCache(cache, start, end) {
    const keepLo = start - WINDOW_CACHE_KEEP;
    const keepHi = end + WINDOW_CACHE_KEEP;
    if (cache.size <= (end - start) + WINDOW_CACHE_KEEP * 3) return;
    for (const pos of cache.keys()) {
      if (pos < keepLo || pos >= keepHi) cache.delete(pos);
    }
  }

  _richRowToChain(row, sourceById) {
    const wlEntry = {
      norm: row.norm,
      display: row.display,
      score: row.score,
      rawScore: row.rawScore,
      comment: row.comment,
      wordlist: sourceById.get(row.sourceId) ?? null,
      sourceIds: row.sourceIds ?? (row.sourceId ? [row.sourceId] : []),
      activeIds: row.activeIds ?? (row.sourceId ? [row.sourceId] : []),
    };
    // All atoms of a flat row are the same word (stacked highlighting searches),
    // so they share one wlEntry; each carries its own highlights/glyph slot.
    return {
      atoms: row.atoms.map(a => ({ wlEntry, highlights: a.highlights, glyph: a.glyph })),
      familyStart: row.familyStart,
    };
  }

  // Reads each row's familyStart flag off the cached chain (worker-stamped under
  // the Entry sort), so the bracket renders mid-stream too. A non-Entry sort ships
  // no flag → bail. A miss on the next row (off-window) defers the end cap to the
  // render that caches it — a transient, not a wrong run.
  _applyFamilyBracket(row, i) {
    row.classList.remove('fam-member', 'fam-start', 'fam-end');
    const cur = this._winCache.get(i);
    if (!cur || cur.familyStart === undefined) return;
    const next = this._winCache.get(i + 1);
    const isStart = cur.familyStart === true;
    const isEnd = i + 1 >= this._renderRowCount() || next?.familyStart === true;
    if (isStart && isEnd) return;
    row.classList.add('fam-member');
    if (isStart) row.classList.add('fam-start');
    if (isEnd) row.classList.add('fam-end');
  }

  _fetchWindow(lo, hi) {
    const runId = this._currentStreamRunId();
    const seq = ++this._winReqSeq;
    this._fetchOutstanding++;
    const fetch = this._flat ? fetchWorkerRows : fetchWorkerTransformRows;
    fetch(runId, lo, hi).then(reply => {
      this._fetchOutstanding--;
      if (seq !== this._winReqSeq) return;            // superseded by a newer scroll
      if (runId !== this._currentStreamRunId()) return; // superseded by a newer run
      if (!reply) return;                             // timeout
      // Mid-stream the sort reshuffles per snapshot; a window served at a version
      // we've moved past would paint stale-order rows mixed into the live snapshot.
      if (this._streamRunId != null && reply.version !== this._streamVersion) return;
      if (this._flat) {
        // Rebuilt per batch rather than memoized: an add/remove/reorder between
        // fetches would otherwise resolve sourceId to a stale wordlist object.
        const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
        for (let k = 0; k < reply.rows.length; k++) {
          this._richRowsConsumed++;
          this._winCache.set(reply.start + k, this._richRowToChain(reply.rows[k], sourceById));
        }
      } else {
        for (let k = 0; k < reply.rows.length; k++) {
          this._winCache.set(reply.start + k, reply.rows[k]);
        }
      }
      this._render();
    });
  }

  windowIdle(timeout = 5000) {
    if (this._fetchOutstanding === 0) return Promise.resolve();
    return new Promise(resolve => {
      const deadline = performance.now() + timeout;
      const tick = () => {
        if (this._fetchOutstanding === 0 || performance.now() >= deadline) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // Identity compare against the current match — `byRow` must hold the SAME
  // objects as `matches`, or the find-current style silently never applies.
  _findRanges(rowMatches, pred) {
    if (!rowMatches) return null;
    const cur = this._find.matches[this._find.current];
    let out = null;
    for (const m of rowMatches) {
      if (!pred(m)) continue;
      (out ??= []).push({ start: m.start, end: m.end, kind: m === cur ? 'find-current' : 'find' });
    }
    return out;
  }

  _groupMemberFind(rowMatches, member) {
    if (!rowMatches) return null;
    const cur = this._find.matches[this._find.current];
    let map = null;
    for (const m of rowMatches) {
      if (m.member !== member) continue;
      const range = { start: m.start, end: m.end, kind: m === cur ? 'find-current' : 'find' };
      map ??= new Map();
      const arr = map.get(m.atom);
      if (arr) arr.push(range); else map.set(m.atom, [range]);
    }
    return map;
  }

  _buildChainRow(chainRow, i, activeNorm, preview, draftRules) {
    const atoms = chainRow.atoms;
    const rowMatches = this._find?.byRow.get(i) || null;
    let active = false;
    let html = `<span class="atom-count">${i + 1}.</span>`;
    atoms.forEach((atom, ai) => {
      const { highlights, glyph } = atom;
      const wlEntry = draftRules ? previewedEntry(atom.wlEntry, draftRules) : atom.wlEntry;
      const { norm } = wlEntry;
      if (activeNorm && norm === activeNorm) active = true;
      const displayed = displayOf(wlEntry);
      const projected = projectRangesToDisplay(highlights, wlEntry);
      // Flat stacks its atom lines on one shared entry, so a hit (scanned at atom 0)
      // lights every line; transform lanes are distinct, so it's filtered to its atom.
      const entryFind = this._findRanges(rowMatches, m => m.field === 'entry' && (this._flat || m.atom === ai));
      const glyphHTML = glyph ? `<span class="atom-glyph">${glyph} </span>` : '';
      const truncTitle = displayed.length > ENTRY_SLOT_CAP ? ` title="${esc(displayed)}"` : '';
      const entryCell =
        `<span class="atom-entry"${truncTitle}>${glyphHTML}${renderHighlightedText(displayed, entryFind ? [...(projected || []), ...entryFind] : projected)}</span>`;
      const scoreInner = buildScoreCellHTML(wlEntry, preview);
      const commentText = wlEntry.comment || '';
      const commentFind = this._findRanges(rowMatches, m => m.field === 'comment' && (this._flat || m.atom === ai));
      const commentInner = commentFind ? renderHighlightedText(commentText, commentFind) : esc(commentText);
      const sourceCell = buildSourcesMatrixHTML(wlEntry.sourceIds, wlEntry.activeIds, this._sourceSlots);
      html += `<span class="atom" data-atom="${ai}">` +
        entryCell +
        `<span class="atom-len">${norm.length}</span>` +
        `<span class="atom-score">${scoreInner}</span>` +
        `<span class="atom-comment"${commentText ? ` title="${esc(commentText)}"` : ''}>${commentInner}</span>` +
        sourceCell +
        `</span>`;
    });

    return {
      html, active,
      dataEntry: rowLastEntry(chainRow).norm,
      wlEntry: this._flat ? atoms[0].wlEntry : undefined,
    };
  }

  _fetchGroupWindow(lo, hi) {
    const runId = this._currentStreamRunId();
    const seq = ++this._groupReqSeq;
    this._groupFetchOutstanding++;
    fetchWorkerGroups(runId, lo, hi).then(reply => {
      this._groupFetchOutstanding--;
      if (seq !== this._groupReqSeq) return;            // superseded by a newer scroll
      if (runId !== this._currentStreamRunId()) return; // superseded by a newer run
      if (!reply) return;                               // timeout
      // Mid-stream the order reshuffles per snapshot; drop a window served at a
      // version the live snapshot has moved past (mirrors the flat _fetchWindow).
      if (this._streamRunId != null && reply.version !== this._streamVersion) return;
      for (let k = 0; k < reply.groups.length; k++) {
        this._groupWinCache.set(reply.start + k, reply.groups[k]);
      }
      this._render();
    });
  }

  groupWindowIdle(timeout = 5000) {
    if (this._groupFetchOutstanding === 0) return Promise.resolve();
    return new Promise(resolve => {
      const deadline = performance.now() + timeout;
      const tick = () => {
        if (this._groupFetchOutstanding === 0 || performance.now() >= deadline) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  _renderGroupRowHTML(group, rowIdx, columns, hasAnchor, ctx) {
    const chains = group.chains;
    // _count is the group's true size (the badge / "+N more" count); chains.length
    // is the resident firstChains window the collapsed row lays out from.
    const total = group._count;
    let leftEdge = 0;
    let visibleCount = 0;
    for (let ci = 0; ci < chains.length; ci++) {
      if (visibleCount > 0 && leftEdge >= ctx.slot) break;
      leftEdge += (ci > 0 ? 18 : 0) + estimateChainWidth(chains[ci], ctx);
      visibleCount = ci + 1;
    }
    // Tripwire: GROUP_FIRST_WINDOW must over-cover the slot. If the layout runs the
    // resident window dry mid-slot while more chains exist, the collapsed row
    // silently under-shows — a test asserts this never fires rather than letting a
    // short row ship on an ultra-wide display the constant didn't anticipate.
    if (visibleCount === chains.length && chains.length < total && leftEdge < ctx.slot) {
      _groupWindowUnderfill++;
    }
    const hidden = total - visibleCount;
    const rowMatches = this._find?.byRow.get(rowIdx) || null;
    const chainsHTML = [];
    for (let ci = 0; ci < visibleCount; ci++) {
      chainsHTML.push(buildGroupChainHTML(chains[ci], ci, this._groupMemberFind(rowMatches, ci)));
    }
    const anchorCell = hasAnchor
      ? buildGroupAnchorHTML(group.anchor, this._findRanges(rowMatches, m => m.member === -1))
      : '';
    const colCells = columns.map(c =>
      `<span class="group-col" data-col="${esc(c.key)}">${esc(String(c.value(group)))}</span>`
    ).join('');
    return `<span class="group-rownum">${rowIdx + 1}.</span>` +
      `<span class="group-count">${total}</span>` +
      anchorCell +
      colCells +
      `<div class="group-chains${hidden > 0 ? ' is-clipped' : ''}">${chainsHTML.join('')}</div>` +
      `<button type="button" class="group-more"${hidden > 0 ? `>+${hidden} more` : ' hidden>'}</button>`;
  }

  _renderFooter(n) {
    const empty = n === 0 && this._resolved;
    const scoped = state.selected !== MERGED_ID;
    const existing = this.host.querySelector('.entries-footer');
    if (!empty && !scoped) { existing?.remove(); return; }

    // While a search/tool input is focused an empty result is usually transient —
    // hold the parked footer (below the fold) rather than rebuild it each keystroke;
    // _sortAndRender's reveal timer un-parks it on the typing pause.
    if (empty && existing && this._isReservationActive() && !this._revealEmpty) return;

    const key = `${empty}|${scoped}`;
    if (existing && existing.dataset.key === key) return;

    const el = existing || document.createElement('div');
    el.className = 'entries-footer';
    el.dataset.key = key;
    const switchBtn = `<button type="button" class="entries-footer-btn">Switch to ${MERGED_NAME}</button>`;
    el.innerHTML =
      (empty ? '<p>No matches.</p>' : '')
      + (scoped ? `<p>Expecting more? ${switchBtn}</p>` : '');
    if (scoped) el.querySelector('.entries-footer-btn').onclick = () => setScope(MERGED_ID);

    if (!existing) this.host.appendChild(el);
  }

  _computeGroupSlotWidths() {
    const hints = this._workerGroupWidthHints;
    const target = this.host.closest('#detail-panel') || this.sizer;
    const countW = Math.max(
      measureTextWidth(String(hints.maxCount), 'entry-headers-font'),
      sortableHeaderPx('Count'));
    // Floor the row-number width at the merged-corpus size, as the flat tier does
    // for --count-w, so it doesn't widen as the streamed count climbs 1 -> 10 -> 100.
    const rownumCeil = Math.max(hints.groupCount, mergedEntryCount());
    const rownumW = measureTextWidth(rownumCeil + '.', 'entry-headers-font');
    target.style.setProperty('--group-count-w', `${countW}px`);
    target.style.setProperty('--group-rownum-w', `${rownumW}px`);
    const stack = ToolStack.getStack();
    const monoCh = measureMonoChPx();
    const anchorLabel = activeGroupAnchorLabel(stack);
    let anchorW = 0;
    if (anchorLabel) {
      const maxEntryW = hints.maxAnchorDisplayLen * monoCh;
      const maxBadgeW = hints.maxAnchorScoreDigits > 0 ? badgeWidthPx(hints.maxAnchorScoreDigits) : 0;
      anchorW = Math.max(maxEntryW + 5 + maxBadgeW, sortableHeaderPx(anchorLabel));
      target.style.setProperty('--group-anchor-w', `${anchorW}px`);
    }
    const columns = activeGroupColumns(stack);
    let columnsW = 0;
    for (const col of columns) {
      const widest = hints.columnWidestByKey[col.key] ?? '';
      const maxColW = measureTextWidth(widest, 'entry-headers-font');
      const colLabelW = col.sort === false ? headerLabelPx(col.label) : sortableHeaderPx(col.label);
      const colW = Math.max(maxColW, colLabelW);
      target.style.setProperty(`--group-col-${col.key}-w`, `${colW}px`);
      columnsW += colW;
    }
    const flexChildren = 2 + (anchorLabel ? 1 : 0) + columns.length;
    this._groupChromeWidth = 32 + rownumW + countW + anchorW + columnsW + 14 * flexChildren;
    this._groupMonoCh = monoCh;
    this._groupGlyphPx = measureAtomGlyphPx();
  }

  async exportRows() {
    // Name the in-flight run, not lastCompletedRunId(): mid-stream the latter points
    // at the prior run, whose snapshot the worker dropped, so the export silently empties.
    const runId = this._currentStreamRunId();
    // Must be the full-chains fetch, not fetchWorkerGroups: that ships each group's
    // firstChains window only, so any group over the window silently exports
    // truncated — data loss on an explicit export with no visible symptom.
    if (isMultiLaneTier(this.sortTier)) {
      const reply = await fetchWorkerAllGroups(runId);
      return reply ? reply.groups : [];
    }
    if (this._transform) {
      const reply = await fetchWorkerAllTransformRows(runId);
      return reply ? reply.rows : [];
    }

    // The flat tier holds only positions, so its rich rows come from the worker.
    // A null reply (timeout) leaves nothing to format — main has no corpus to
    // fall back on — so export the empty set rather than throwing.
    const reply = await fetchWorkerAllRows(runId);
    if (!reply) return [];

    const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
    return reply.rows.map(r => this._richRowToChain(r, sourceById));
  }

  // Transform is corpus-sized like flat, so both bound: a full fetch+format for a few
  // preview lines stalls. Grouped/tuple are few enough that exportRows stays cheap.
  async exportPreviewRows(n) {
    if (isMultiLaneTier(this.sortTier)) return this.exportRows();
    const fetch = this._transform ? fetchWorkerTransformRows : fetchWorkerRows;
    const reply = await fetch(this._currentStreamRunId(), 0, n);
    if (!reply) return [];
    if (this._transform) return reply.rows;   // transform windows arrive decoded
    const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
    return reply.rows.map(r => this._richRowToChain(r, sourceById));
  }

  resultRowCount() { return this._renderRowCount(); }

  // The match guard is load-bearing: the shipped answer resolves whatever target
  // rode this run's dispatch, so on a mismatch (the panel re-targeted between
  // dispatch and rebind) it names the wrong entry. Post-flip there's no local
  // corpus to fall back to, so a mismatch returns the not-found answer and the
  // panel reconciles on the next run's rebindEntry.
  _rebindAnswerApplies(norm, display) {
    const applies = !!(this._ranAgainstOwned && this._rebindQuery
      && this._rebindQuery.norm === norm && (this._rebindQuery.display ?? null) === (display ?? null));
    if (applies) rebindAnswersConsumed++;
    return applies;
  }

  // The rows the synchronous rebind search walks. Only reached for the grouped/tuple
  // tier — flat and transform short-circuit on the worker's shipped answer above.
  // Those are windowed, so search the cached groups; the panel only ever opens on a
  // rendered (hence cached) group, so its target is always reachable here.
  _rebindSearchRows() {
    return this._groupWinCache.values();
  }

  resultHasEntry(wlEntry) {
    // Flat and transform both window — no resident rows to walk, so use the worker's
    // shipped answer. Only the grouped tier still searches its cached rows.
    if (this._flat || this._transform) {
      if (this._rebindAnswerApplies(wlEntry.norm, wlEntry.display ?? null)) return this._rebindExists;
      return false;
    }
    for (const a of rowSetAtoms(this._rebindSearchRows())) {
      if (a.wlEntry === wlEntry) return true;
    }
    return false;
  }

  findResultEntry(norm, display) {
    if (this._flat || this._transform) {
      if (this._rebindAnswerApplies(norm, display)) return this._rebindEntry;
      return null;
    }
    for (const a of rowSetAtoms(this._rebindSearchRows())) {
      if (a.wlEntry.norm === norm && a.wlEntry.display === display) return a.wlEntry;
    }
    return null;
  }
}

// ─── Shared editor helpers ───────────────────────────────────────────────────

// Desktop only — the caller (ScorePicker) guards the mobile case, where CSS docks
// the picker as a bottom sheet and inline coordinates must be left unset.
function anchorDropdown(panel, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  panel.style.top = (r.bottom + 4) + 'px';
  panel.style.left = r.left + 'px';
  requestAnimationFrame(() => {
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    if (left < 8) left = 8;
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - 8) {
      const above = r.top - ph - 4;
      top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - ph);
    }
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
  });
}

function seedFromWinnerRow(row, winnerIsEdits) {
  let score = row.score;
  const edits = getEditsWordlist();
  // Seed the score field from My Edits' RAW score, not the displayed effective:
  // the field edits raw, so seeding effective would re-rescore it on every save
  // and silently drift My Edits. A bare My Edits winner (display null, unified with
  // a foreign spelling) backs the row too, so fall back to it.
  if (winnerIsEdits && edits) {
    const backing = edits.rawEntries.find(e => e.norm === row.norm && displayOf(e) === displayOf(row))
                 ?? edits.rawEntries.find(e => e.norm === row.norm && e.display == null);
    if (backing) score = backing.score;
  }
  return {
    entry: displayOf(row),
    score,
    comment: row.comment || '',
    norm: row.norm,
    display: row.display ?? null,
  };
}

function resolveScopedEntry(norm, display) {
  const wl = state.selected;
  if (wl === MERGED_ID) return null;
  const group = groupEntries(getRescoredByNorm(wl).get(norm));
  return group.find(e => (e.display ?? null) === (display ?? null))
      ?? group.find(e => e.display == null)
      ?? group[0] ?? null;
}

// The My Edits entry an edit/rescore should rewrite. When a row is owned only
// through a bare wildcard (display null, unified with a foreign spelling), feeding
// that rich spelling as the planner's "clicked" reads as no rename and silently
// leaves the bare behind as a concrete same-norm sibling — so rewrite the bare.
function editBaselineFor(base) {
  const edits = getEditsWordlist();
  if (!edits) return base;
  const baseDisplay = base.display ?? base.norm;
  if (edits.rawEntries.some(e => e.norm === base.norm && displayOf(e) === baseDisplay)) return base;
  const bare = edits.rawEntries.find(e => e.norm === base.norm && e.display == null);
  return bare ? { norm: bare.norm, display: null, score: bare.score, comment: bare.comment ?? '' } : base;
}

// ─── Entry panel ─────────────────────────────────────────────────────────────

export const EntryPanel = (() => {
  // How long a target must hold still before the panel starts network work. A click
  // or deep link is already settled; a walk step and a keystroke are scrub gestures,
  // where firing per target fans a few reference requests out into a few hundred.
  const OPEN_SETTLE_MS = 0;
  const WALK_SETTLE_MS = 200;
  const TYPING_SETTLE_MS = 600;
  const LOCAL_TIER_MS = 300;   // pair up prov + family so they cost one shift, not two

  let el = null;
  let scrim = null;
  let activeRow = null;
  let familyMembers = [];
  let familyToken = 0;
  let renameSuggestion = null;
  let renameSuggestionFor = null;
  let renameToken = 0;
  let renameTimer = null;
  let renameStandInTimer = null;
  let localTierOpen = false;
  let localTierToken = 0;
  let localTierTimer = null;
  // Non-null bounds the walk to a multi-select ({ members, index }); null is the
  // no-selection walk that steps the table cursor and shows the current family.
  let walkSelection = null;
  let walkToken = 0;
  // Field to re-focus after a walk step; null means don't steal focus — a view-first
  // open never focused a field, and forcing it would pop the mobile keyboard.
  let lastFocusField = null;
  // A fresh open selects the focused field's text (retype-a-score); a walk step only
  // focuses, so continuing to type in the same column doesn't wipe the value.
  let selectFieldOnFocus = true;
  let activeWlEntry = null;
  let activeSeed = null;
  let activeScroller = null;
  let activeMode = 'edit';
  let activeReadOnly = false;
  let stagedDelete = null;
  let stagedAdopt = false;
  // Monotonic token for an in-flight scoped-seed worker query; a re-open or close
  // bumps it so a late reply for a stale panel is dropped rather than re-seeding
  // the wrong row.
  let seedQueryToken = 0;
  let seedQueriesFired = 0;
  let seedWinnersApplied = 0;
  function seedDebug() { return { seedQueriesFired, seedWinnersApplied }; }
  // Last-good-until-refined: held across an in-flight query and replaced only when
  // a newer reply lands, never cleared to empty mid-flight, so the table/footer
  // don't flash on a null (not-fresh) reply.
  let provQueryToken = 0;
  let shippedProvRows = null;
  let lastProvHTML = null;
  let lastNoteHTML = null;
  let provQueriesFired = 0;
  let provRepliesApplied = 0;
  function provenanceDebug() { return { provQueriesFired, provRepliesApplied }; }

  // The worker plans the edit; previewPlan reads this cache synchronously. The
  // STRUCTURAL plan depends only on entry text / mode / seed — never score or
  // comment (planEntryWrite folds those into upserts but never branches on them) —
  // so a score/comment keystroke re-renders from the cache + local vals with no
  // re-fetch. Held last-good so a null (not-fresh) reply doesn't flash the table.
  let planQueryToken = 0;
  let _cachedPlan = null;
  // The panel element focus is in or transitioning to. Tracked via capture-
  // phase blur (relatedTarget says where focus is *headed*) because an
  // edit-commit re-render runs in a microtask between blur and focusin, when
  // document.activeElement is transiently <body> — reading it then would
  // wrongly close the panel or clobber an input mid-tab.
  let focusEl = null;
  // The open panel rides the URL (?entry=…), so Back/Forward, reload, and shared
  // links all drive it. ownsHistoryEntry is true for any entry WE pushed — a fresh
  // open, or a Back/Forward that lands back on one (recognized by its history.state
  // tag). Closing those pops the entry; a cold deep link has nothing of ours behind
  // it, so it strips the param in place instead.
  let ownsHistoryEntry = false;
  let scoreCombo = null;
  let listboxOpener = null;

  function ensureElement() {
    if (el) return el;
    scrim = document.createElement('div');
    scrim.id = 'entry-panel-backdrop';
    scrim.addEventListener('click', dismiss);
    document.body.appendChild(scrim);

    el = document.createElement('div');
    el.id = 'entry-panel';
    el.addEventListener('click', e => {
      if (e.target.closest('.dialog-close-btn')) { dismiss(); return; }
      if (e.target.closest('.entry-panel-note-link')) { editExisting(); return; }
      if (e.target.closest('.entry-panel-suggest-link')) { applyRename(); return; }
      if (e.target.closest('.entry-panel-prov-untrash')) { toggleStagedAdopt(); return; }
      const trash = e.target.closest('.entry-panel-prov-trash');
      if (trash) { toggleStagedDelete(trash.dataset.norm, trash.dataset.display); return; }
      if (e.target.closest('.entry-panel-prev')) { walkPrev(); return; }
      if (e.target.closest('.entry-panel-next')) { walkNext(); return; }
      const famItem = e.target.closest('.entry-family-item');
      if (famItem) { clickFamilyRow(+famItem.dataset.famIdx); return; }
      if (e.target.closest('.entry-panel-adopt-btn')) toggleStagedAdopt();
    });
    el.addEventListener('focus', e => {
      focusEl = e.target;
      const f = fieldNameOf(e.target);
      if (f) lastFocusField = f;
    }, true);
    el.addEventListener('blur', e => {
      focusEl = e.relatedTarget && el.contains(e.relatedTarget) ? e.relatedTarget : null;
    }, true);
    window.addEventListener('popstate', onPopState);
    document.body.appendChild(el);
    return el;
  }

  function routeValue() {
    // null in create mode: a not-yet-existing entry has nothing to name in the URL.
    if (!isOpen() || activeMode === 'create' || !activeWlEntry) return null;
    return displayOf(activeWlEntry);
  }

  // Reconcile the panel to the URL on Back/Forward. Idempotent on purpose — our own
  // close()→back() and the help-hash both fire popstate, and both must no-op here.
  function onPopState() {
    const value = new URLSearchParams(location.search).get('entry');
    if (!value) { if (isOpen()) { commitOnDismiss(); hideAndClear(); } return; }
    const norm = toNorm(value);
    if (isOpen() && activeWlEntry && activeWlEntry.norm === norm && displayOf(activeWlEntry) === value) return;
    openFromRoute({ norm, display: value }, { animate: true });
  }

  function isOpen() { return el != null && el.classList.contains('open'); }

  // No history ops here: close() and the popstate reconcile both call this and
  // each handles history itself — touching it here would double up with close().
  function hideAndClear() {
    el.classList.remove('open');
    scrim.classList.remove('open');
    if (activeRow) activeRow.classList.remove('active');
    activeRow = null;
    activeWlEntry = null;
    activeSeed = null;
    activeScroller = null;
    activeMode = 'edit';
    activeReadOnly = false;
    focusEl = null;
    lastFocusField = null;
    walkSelection = null;
    stagedDelete = null;
    stagedAdopt = false;
    ownsHistoryEntry = false;
    scoreCombo = null;
    renameSuggestion = null;
    renameSuggestionFor = null;
    clearTimeout(renameTimer);
    renameTimer = null;
    clearTimeout(renameStandInTimer);
    renameStandInTimer = null;
    clearTimeout(localTierTimer);
    localTierTimer = null;
    localTierOpen = false;
    localTierToken++;
    seedQueryToken++;
    provQueryToken++;
    planQueryToken++;
    walkToken++;
    renameToken++;
    shippedProvRows = null;
    lastProvHTML = null;
    lastNoteHTML = null;
    _cachedPlan = null;
    document.removeEventListener('keydown', onKeydown, true);
    const opener = listboxOpener;
    listboxOpener = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen()) return;
    const owned = ownsHistoryEntry;
    hideAndClear();
    if (owned) history.back();
    else _navigate();
  }

  function hasUnsavedChanges() {
    if (!isOpen()) return false;
    if (stagedDelete || stagedAdopt) return true;
    const inp = el.querySelector('.entry-input');
    if (!inp || inp.disabled || activeReadOnly) return false;
    const vals = readNewValues();
    return activeMode === 'create' ? valuesValid(vals) : pendingWritesChange(vals);
  }

  // Wired to the scrim and to the ✕, which `app.css` swaps for a back arrow below
  // 1000px — a back arrow that discarded would contradict its own glyph. Hence the ✕
  // commits and only Cancel/Escape discard; re-pairing it with them breaks mobile.
  function dismiss() {
    if (!hasUnsavedChanges()) { close(); return; }
    if (!submit()) nudgeFooter();
  }

  // Back's commit. NOT submit(): its close() would fire a second history.back() on a
  // navigation that already happened. A write that won't go through is dropped rather
  // than refused — the pop already landed, so there's no panel left to hold open.
  function commitOnDismiss() {
    if (activeReadOnly) return;
    if (stagedDelete) {
      const scroller = activeScroller, target = stagedDelete;
      stagedDelete = null;
      scroller._onDeleteRow?.(target);
      return;
    }
    const vals = readNewValues();
    if (activeMode !== 'create' && !stagedAdopt && !pendingWritesChange(vals)) return;
    if (!valuesValid(vals) || saveBlocked()) return;
    const mode = stagedAdopt ? 'adopt' : activeMode;
    activeScroller._onSave?.(mode, mode === 'create' ? null : editBaselineFor(saveBaseline()), vals);
  }

  function nudgeFooter() {
    const foot = el.querySelector('.entry-panel-foot');
    if (!foot) return;
    foot.classList.remove('nudge');
    void foot.offsetWidth;   // reflow so a repeat click replays the animation
    foot.classList.add('nudge');
  }

  function containsFocus() {
    return isOpen() && focusEl !== null && el.contains(focusEl);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (scoreCombo?.isOpen()) { e.preventDefault(); e.stopPropagation(); scoreCombo.close(); return; }
      e.preventDefault();
      close();
      return;
    }
    // Alt+Up/Down walk entries even with the tier list open: the combo claims only
    // the plain vertical arrows, so these never collide with it.
    if (activeMode !== 'create' && e.altKey) {
      if (e.key === 'ArrowUp')   { e.preventDefault(); walkPrev(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); walkNext(); return; }
    }
    // The exclusion defers to controls that own Enter: without it this capture-phase
    // handler would preempt the combobox's tier-pick and turn Enter on Cancel into a
    // save. Left over is the unfocused panel (a view-first open), where Enter saves
    // when dirty and closes when pristine.
    if (e.key === 'Enter' && !e.target.closest('input, textarea, select, button, a[href], [role="button"]')) {
      e.preventDefault();
      submitOrClose();
    }
  }

  // Reached only in an editable scope — a read-only foreign scope resolves its seed
  // locally before this. My Edits (editable, non-merged) still needs the worker: the
  // merge winner can be a higher-priority list main can't read without its corpus.
  // Merged seeds synchronously (clicked IS the winner); a route open has no clicked
  // row, so it asks the worker too.
  function needsWorkerSeed(clicked, route) {
    return route || (state.selected !== MERGED_ID && clicked?.norm != null);
  }

  // A click or an in-session Back/Forward slides the panel in; a cold-load restore
  // (deep link, reload) appears in place — re-painting saved state shouldn't animate.
  // The forced reflow is load-bearing: without it the add/remove of no-anim coalesces
  // into one style pass and the slide fires anyway. Removing it lets a later close slide.
  function revealModal(animate) {
    if (!animate) { el.classList.add('no-anim'); scrim.classList.add('no-anim'); }
    el.classList.add('open');
    scrim.classList.add('open');
    if (!animate) {
      void el.offsetWidth;
      el.classList.remove('no-anim');
      scrim.classList.remove('no-anim');
    }
  }

  // Set up the panel DOM + state for a target. Does NOT touch history — open()
  // and openFromRoute() wrap it and own that.
  // `focus` names the field to focus and select, or is null for a view-first open:
  // entry-cell clicks, navigation, and deep links pass null because auto-focusing
  // there only pops the mobile keyboard for what is really a read.
  function doOpen(wlEntry, rowEl, scroller, focus, mode,
                  { route = false, animate = true, selectField = true, settleMs = OPEN_SETTLE_MS } = {}) {
    selectFieldOnFocus = selectField;
    // The panel is modal — its scrim covers the page. Dismiss the other floating
    // surfaces (the z-600 popovers and the z-700 find bar) that would otherwise
    // float above the scrim and stay live.
    ScorePicker.close();
    SortMenu.close();
    GroupMorePopover.close();
    scroller?.closeFind?.({ refocus: false });
    const panel = ensureElement();
    if (activeRow) activeRow.classList.remove('active');
    activeMode = mode;
    activeReadOnly = mode === 'edit' && !scopeIsEditable();
    // Read-only shows the scoped list's own entry, not the merged winner. A route open
    // or Related click hands us some other list's row (or none), so rebuild from scope.
    if (activeReadOnly && wlEntry.wordlist !== state.selected) {
      const scoped = resolveScopedEntry(wlEntry.norm, wlEntry.display ?? null);
      if (scoped) wlEntry = { ...scoped, wordlist: state.selected };
    }
    activeWlEntry = wlEntry;
    activeRow = rowEl;
    activeScroller = scroller;
    if (rowEl) rowEl.classList.add('active');
    shippedProvRows = null;
    _cachedPlan = null;
    // Reset per-target state here, not only in close(): a route reopen (Back/Forward
    // or a deep link landing on a different entry) reuses the panel without closing,
    // so a stale staged delete or focus ref from the previous target must clear here.
    stagedAdopt = false;
    stagedDelete = null;
    focusEl = null;
    // Cleared before the render below, which now paints this: a reused panel would
    // otherwise open the new entry showing the previous one's suggestion.
    renameSuggestion = null;
    renameSuggestionFor = null;

    // Seed from the clicked row: in the merged view it IS the merge winner; an editable
    // scoped view (or a route open) holds no winner, refined below from the worker.
    const seed = seedFromWinnerRow(wlEntry, getEditsWordlist() != null && wlEntry.wordlist === getEditsWordlist());

    panel.innerHTML = renderHTML(wlEntry, seed);
    lastProvHTML = provWrapHTML();
    lastNoteHTML = renderNotesHTML();
    revealModal(animate);
    wireFields(settleMs);
    armLocalTier(
      renderFamily(activeWlEntry.norm, activeWlEntry.display ?? null),
      fireInitialProvenanceQuery(seed.entry),
    );
    refreshRenameSuggestion(activeWlEntry.display ?? activeWlEntry.norm, settleMs);
    updateNav();

    if (!activeReadOnly && needsWorkerSeed(wlEntry, route)) refineScopedSeed(wlEntry, focus);

    if (focus && !activeReadOnly) focusSeedField(focus);

    document.addEventListener('keydown', onKeydown, true);
  }

  function open(wlEntry, rowEl, scroller, focus = 'score', mode = 'edit', selectField = true) {
    const reopening = isOpen();
    if (!reopening) listboxOpener = scroller && document.activeElement === scroller.sizer ? scroller.sizer : null;
    // A fresh open starts a fresh walk; walkTo() reseeds without coming through here.
    // The bump cancels an in-flight openSelectionWalk, whose reply would reopen over this.
    walkSelection = null;
    walkToken++;
    lastFocusField = null;
    doOpen(wlEntry, rowEl, scroller, focus, mode, { selectField });
    if (reopening) _navigate();
    else {
      ownsHistoryEntry = true;
      _navigate({ push: true });
      // Tag the pushed entry so a Back/Forward that later lands back on it knows we
      // own it and closes by popping — untagged, the re-entered panel would strip
      // its param instead, lighting the Forward button on one close but not the next.
      history.replaceState({ ...history.state, entryPanel: true }, '');
    }
  }

  // Open from the URL (deep link, or Back/Forward into an entry): synthesize a
  // target, let the worker seed it, and DON'T navigate — the URL is already there.
  function openFromRoute({ norm, display }, { animate = false } = {}) {
    walkSelection = null;
    lastFocusField = null;
    // A value equal to its own norm is a bare entry rendered as the norm; seed it
    // as bare (display null) so the worker's bare fallback resolves the winner.
    const seedDisplay = display === norm ? null : display;
    doOpen({ norm, display: seedDisplay, score: '', comment: '', wordlist: null },
      null, getEntriesScroller(), null, 'edit', { route: true, animate });
    // Tagged → an entry we pushed (Back/Forward re-entered it), ours to pop on close.
    // Untagged → a cold deep link with nothing of ours behind it, so close strips.
    ownsHistoryEntry = !!history.state?.entryPanel;
    activeScroller?.revealRouteEntry({ norm, display: seedDisplay });
  }

  // The seed is a correctness input — a save writes FROM it into My Edits — so the
  // fields stay disabled until the worker's winner refines the placeholder; a save
  // against the un-refined scoped value would be wrong. A null reply (stale/disabled
  // scope) keeps the clicked placeholder.
  function refineScopedSeed(clicked, focus) {
    const token = ++seedQueryToken;
    seedQueriesFired++;
    setFieldsDisabled(true);
    fetchWorkerEditSeed(clicked.norm, clicked.display ?? null).then(winner => {
      if (token !== seedQueryToken || !isOpen() || activeWlEntry !== clicked) return;
      // Re-enable before applySeedToFields: focus/select no-op on a disabled input,
      // so deferring this until after would drop the score-cell auto-focus.
      setFieldsDisabled(false);
      if (winner) {
        const src = state.sources.find(s => s.dbKey === winner.sourceId) || null;
        const row = { ...winner, wordlist: src };
        activeSeed = seedFromWinnerRow(row, src != null && src === getEditsWordlist());
        applySeedToFields(activeSeed, focus);
        seedWinnersApplied++;
      }
      refreshSaveEnabled();
    });
  }

  function setFieldsDisabled(disabled) {
    for (const sel of ['.entry-input', '.score-input', '.comment-input', '.entry-panel-save']) {
      const node = el?.querySelector(sel);
      if (node) node.disabled = disabled;
    }
    if (disabled) scoreCombo?.close();
  }

  function applySeedToFields(seed, focus) {
    const entryInp = el.querySelector('.entry-input');
    const scoreInp = el.querySelector('.score-input');
    const commentInp = el.querySelector('.comment-input');
    if (entryInp) entryInp.value = seed.entry;
    if (scoreInp) scoreInp.value = seed.score;
    if (commentInp) commentInp.value = seed.comment;
    LookupSection.setEntry(seed.entry);
    firePlanQuery();   // the refined winner is the new `clicked` baseline
    renderProvWrap();
    refreshSaveEnabled();
    updateModeLabels();
    // The seed sets the score field directly (no `input` event), so the Related-
    // entries anchor won't pick it up on its own — push the seeded score in.
    refreshFamilyScore();
    if (focus) focusSeedField(focus);
  }

  function focusSeedField(focus) {
    const sel = focus === 'entry'   ? '.entry-input'
              : focus === 'comment' ? '.comment-input'
              : '.score-input';
    const input = el?.querySelector(sel);
    // preventScroll: focus-into-view has nothing to do but yank the page when the
    // mobile keyboard opens.
    input?.focus({ preventScroll: true });
    if (selectFieldOnFocus) input?.select();
    // Land a caret at the end (typing appends) rather than whatever the focus left —
    // number inputs reject setSelectionRange, so guard on type.
    else if (input && input.type !== 'number') input.setSelectionRange(input.value.length, input.value.length);
  }

  function openForCreate(entryStr, scroller) {
    open(buildUserWlEntry(entryStr, '', ''), null, scroller, 'entry', 'create');
  }

  function renderFooterHTML(entryText) {
    if (activeReadOnly) return `<button class="entry-panel-close" type="button">Close</button>`;
    return `<span class="entry-panel-adopt"></span>`
      + `<button class="entry-panel-close" type="button">Close</button>`
      + `<button class="entry-panel-cancel" type="button">Cancel</button>`
      + `<button class="entry-panel-save" type="button">${esc(saveLabel(entryText))}</button>`;
  }

  function renderProvenanceTableHTML() {
    const table = renderProvenanceRowsHTML(applyPreviewOverlay(buildBaseRows()));
    if (!table) return '';
    return `<div class="lookup-sec"><div class="lookup-sec-head">Appears in</div>${table}</div>`;
  }

  function buildBaseRows() {
    const edits = getEditsWordlist();
    const rows = [];
    for (const { sourceId, enabled, entry } of (shippedProvRows ?? [])) {
      const wordlist = state.sources.find(s => s.dbKey === sourceId);
      if (!wordlist) continue;
      rows.push({ wordlist, entry, enabled, isEdits: wordlist === edits, saved: true });
    }
    return rows;
  }

  // Gate for the preview overlay and the Save button — both need a valid score.
  // Distinct from hasEditToPlan, the score-free gate for the plan fetch and the
  // duplicate-block note: the block is structural, so it must surface from a typed
  // entry before any score exists.
  function planGuardsPass() {
    const inp = el.querySelector('.entry-input');
    if (!inp || inp.disabled || stagedDelete || activeReadOnly) return false;
    const vals = readNewValues();
    if (!valuesValid(vals)) return false;
    if (activeMode === 'edit' && !stagedAdopt && !pendingWritesChange(vals)) return false;
    return true;
  }

  function previewPlan() {
    return planGuardsPass() ? _cachedPlan : null;
  }

  // Fetch gate. Deliberately broader than the display gate: it does NOT check
  // pendingWritesChange, so the plan is cached at open and ready the instant a
  // score-only change (or adopt staging) makes the edit displayable — neither fires
  // firePlanQuery, and the structural plan is identical whether or not values changed.
  function hasEditToPlan() {
    const inp = el.querySelector('.entry-input');
    if (!inp || inp.disabled || stagedDelete || activeReadOnly) return false;
    return !!readNewValues().raw;
  }

  // Must fire on every input to the structural plan: open, reset, entry-text edit,
  // staged-delete toggle, AND seed refine (the refined winner changes `clicked`). NOT
  // score/comment/adopt — those re-render from the cached plan (see _cachedPlan).
  function firePlanQuery() {
    const token = ++planQueryToken;
    if (!hasEditToPlan()) { _cachedPlan = null; return; }
    const vals = readNewValues();
    const clicked = activeMode === 'edit' ? editBaselineFor(saveBaseline()) : null;
    const typed = { raw: vals.raw, score: isNaN(vals.score) ? 0 : vals.score, comment: vals.comment };
    fetchWorkerEditPlan({ mode: activeMode, clicked, typed, trashScore: getTrashScore() })
      .then(plan => {
        if (token !== planQueryToken || !isOpen()) return;
        if (plan == null) return;   // not-fresh/timeout: keep last-good
        _cachedPlan = plan;
        renderProvWrap();
        refreshSaveEnabled();
      });
  }

  function applyPreviewOverlay(rows) {
    const edits = getEditsWordlist();
    if (!edits) return rows;
    if (stagedDelete) {
      const i = rows.findIndex(r => r.isEdits && r.entry.norm === stagedDelete.norm && displayOf(r.entry) === stagedDelete.display);
      if (i >= 0) rows[i] = { ...rows[i], diff: 'deleted', isStaged: true };
      return rows;
    }
    const plan = previewPlan();
    if (!plan || plan.blockedReason) return rows;
    const vals = readNewValues();
    const extras = [];
    for (const d of plan.deletes) {
      const i = rows.findIndex(r => r.isEdits && r.entry.norm === d.norm && displayOf(r.entry) === d.display && r.diff !== 'deleted');
      if (i >= 0) { rows[i] = { ...rows[i], diff: 'deleted' }; continue; }
      const orig = edits.rawEntries.find(e => e.norm === d.norm && displayOf(e) === d.display);
      if (orig) {
        const eff = rescoreEntry({ norm: orig.norm, score: orig.score }, edits.rescoreRules);
        extras.push({ wordlist: edits, entry: { norm: orig.norm, display: orig.display ?? null, score: eff, rawScore: orig.score, comment: orig.comment || '' }, enabled: true, isEdits: true, saved: true, diff: 'deleted' });
      }
    }
    const p = plan.primary;
    const effective = rescoreEntry({ norm: p.norm, score: vals.score }, edits.rescoreRules);
    const entry = { norm: p.norm, display: p.display, score: effective, rawScore: vals.score, comment: vals.comment };
    const i = rows.findIndex(r => r.isEdits && r.entry.norm === p.norm && displayOf(r.entry) === (p.display ?? p.norm) && r.diff !== 'deleted');
    let primaryIdx;
    if (i >= 0) { rows[i] = { wordlist: edits, entry, enabled: true, isEdits: true, saved: true, diff: 'changed', adoptStaged: stagedAdopt }; primaryIdx = i; }
    else { rows.unshift({ wordlist: edits, entry, enabled: true, isEdits: true, saved: false, diff: 'added', adoptStaged: stagedAdopt }); primaryIdx = 0; }
    for (const n of plan.notes) {
      const eff = rescoreEntry({ norm: n.norm, score: n.score }, edits.rescoreRules);
      extras.push({ wordlist: edits, entry: { norm: n.norm, display: n.display, score: eff, rawScore: n.score, comment: n.comment || '' }, enabled: true, isEdits: true, saved: false, diff: 'added' });
    }
    if (extras.length) rows.splice(primaryIdx + 1, 0, ...extras);
    return rows;
  }

  // Gated on the fetched plan, NOT previewPlan (as saveBlocked/the preview are):
  // the duplicate block is structural, so it must show before a score is typed;
  // previewPlan would re-couple it to the score field being valid.
  function renderNotesHTML() {
    return hasEditToPlan() && _cachedPlan?.blockedReason === 'exists'
      ? `<div class="entry-panel-note entry-panel-note--block">That entry already exists. `
        + `<button type="button" class="entry-panel-note-link">Edit it instead.</button></div>`
      : '';
  }

  // Pass the backing row's full seed, not just {norm, display}: seedFromWinnerRow
  // re-derives the score from rawEntries but not the comment, so a partial seed
  // would silently blank a commented entry's comment field.
  function editExisting() {
    if (_cachedPlan?.blockedReason !== 'exists') return;
    const edits = getEditsWordlist();
    if (!edits) return;
    const { norm, display } = _cachedPlan.primary;
    const rendered = display ?? norm;
    const backing = edits.rawEntries.find(e => e.norm === norm && displayOf(e) === rendered)
                 ?? edits.rawEntries.find(e => e.norm === norm && e.display == null);
    if (!backing) return;
    open({ norm: backing.norm, display: backing.display ?? null, score: backing.score,
           comment: backing.comment ?? '', wordlist: edits },
      null, activeScroller, null, 'edit');
  }

  // Mirror saveEdit's no-op check so an untouched panel shows no preview row.
  function pendingWritesChange({ raw, score, comment }) {
    const base = saveBaseline();
    const baseDisplay = base.display ?? base.norm;
    return !(base.norm === toNorm(raw) && baseDisplay === raw
      && base.score === score && (base.comment ?? '') === comment);
  }

  function renderProvenanceRowsHTML(rows) {
    if (!rows.length) return '';
    const adoptLabel = `Don't ${adoptWillReplace() ? 'update' : 'add to'} My Edits`;
    const body = rows.map(({ wordlist, entry, enabled, diff, saved, isEdits, isStaged, adoptStaged }) => {
      const isScopedRow = activeReadOnly && wordlist === state.selected;
      const disabled = wordlist ? wordlist.enabled === false : enabled === false;
      const cls = ['entry-panel-prov-row'];
      if (disabled && !isScopedRow) cls.push('entry-panel-prov-row--disabled');
      if (diff) cls.push(`entry-panel-prov-row--${diff}`);
      // Read-only scope: keep the scoped list's own row at full strength as the focus
      // and recede the rest (same dim as a disabled row / an out-of-scope Source icon).
      if (activeReadOnly && !isScopedRow) cls.push('entry-panel-prov-row--muted');
      const comment = entry.comment || '';
      const label = isStaged ? 'Restore this edit' : 'Delete this edit';
      // A rename's predicted-delete row (diff 'deleted', not user-staged) gets no
      // trash — only a genuinely saved row, or the staged-delete row to restore it.
      const trash = activeReadOnly ? '' : adoptStaged
        ? `<button class="entry-panel-prov-trash entry-panel-prov-untrash" type="button"`
          + ` title="${adoptLabel}" aria-label="${adoptLabel}">${buildTrashIconHTML()}</button>`
        : saved && isEdits && (diff !== 'deleted' || isStaged)
        ? `<button class="entry-panel-prov-trash${isStaged ? ' staged' : ''}" type="button"`
          + ` data-norm="${esc(entry.norm)}" data-display="${esc(displayOf(entry))}"`
          + ` title="${label}" aria-label="${label}">${buildTrashIconHTML()}</button>`
        : '';
      return `<tr class="${cls.join(' ')}">`
        + `<td class="entry-panel-prov-entry">${esc(displayOf(entry))}</td>`
        + `<td class="entry-panel-prov-score">${buildScoreCellHTML(entry, true)}</td>`
        + `<td class="entry-panel-prov-comment"${comment ? ` title="${esc(comment)}"` : ''}>${esc(comment)}</td>`
        + `<td class="entry-panel-prov-source">${buildWordlistNameIconHTML(wordlist, { bold: false })}</td>`
        + `<td class="entry-panel-prov-action">${trash}</td>`
        + `</tr>`;
    }).join('');
    return `<table class="entry-panel-prov">`
      + `<thead><tr>`
      + `<th class="entry-panel-prov-entry">Entry</th>`
      + `<th class="entry-panel-prov-score">Score</th>`
      + `<th class="entry-panel-prov-comment">Comment</th>`
      + `<th class="entry-panel-prov-source">Source</th>`
      + `<th class="entry-panel-prov-action"></th>`
      + `</tr></thead>`
      + `<tbody>${body}</tbody>`
      + `</table>`;
  }

  function toggleStagedDelete(norm, display) {
    const same = stagedDelete && stagedDelete.norm === norm && stagedDelete.display === display;
    stagedDelete = same ? null : { norm, display };
    setInputsDisabled(!!stagedDelete);
    firePlanQuery();   // staging/unstaging flips hasEditToPlan
    refreshSaveEnabled();
    renderProvWrap();
    updateModeLabels();
  }

  function toggleStagedAdopt() {
    stagedAdopt = !stagedAdopt;
    renderProvWrap();   // the plan is already cached (fetched at open); just re-show it
    refreshSaveEnabled();
  }

  function unstageAdopt() { stagedAdopt = false; }

  function adoptWillReplace() {
    const base = saveBaseline();
    return !!getEditsWordlist()?.rawEntries.some(e => e.norm === base.norm && e.display == null);
  }

  function adoptable() {
    if (activeMode !== 'edit' || stagedDelete || activeReadOnly) return false;
    const edits = getEditsWordlist();
    if (!edits) return false;
    const inp = el?.querySelector('.entry-input');
    if (!inp || inp.disabled) return false;
    const vals = readNewValues();
    if (!valuesValid(vals) || pendingWritesChange(vals)) return false;
    const base = saveBaseline();
    const display = base.display ?? base.norm;
    return !edits.rawEntries.some(e => e.norm === base.norm && displayOf(e) === display);
  }

  function refreshAdoptLink() {
    const slot = el?.querySelector('.entry-panel-adopt');
    if (!slot) return;
    slot.innerHTML = adoptable() && !stagedAdopt
      ? `<button class="entry-panel-adopt-btn" type="button">`
        + `${esc(adoptWillReplace() ? 'Update My Edits' : 'Add to My Edits')}</button>`
      : '';
  }

  function setInputsDisabled(disabled) {
    for (const sel of ['.entry-input', '.score-input', '.comment-input']) {
      const node = el?.querySelector(sel);
      if (node) node.disabled = disabled;
    }
    if (disabled) scoreCombo?.close();
  }

  function renderHTML(wlEntry, seedOverride) {
    const seed = activeSeed = seedOverride
      ?? seedFromWinnerRow(wlEntry, getEditsWordlist() != null && wlEntry.wordlist === getEditsWordlist());
    const ro = activeReadOnly ? ' readonly' : '';
    return `
      <div class="entry-panel-header">
        <button class="dialog-close-btn" type="button" aria-label="Close">
          <span class="entry-panel-close-x" aria-hidden="true">✕</span>
          <span class="entry-panel-close-back" aria-hidden="true">←</span>
        </button>
        <div class="entry-panel-titlerow">
          <div class="entry-panel-title">${esc(headerText(seed.entry))}</div>
          ${renderNavHTML()}
        </div>
      </div>
      <div class="entry-panel-body">
        <div class="entry-panel-fields">
          <label for="entry-panel-entry">Entry</label>
          <input id="entry-panel-entry" class="entry-input" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(seed.entry)}"${ro}>
          <div class="entry-panel-note-slot">${activeReadOnly ? '' : renderNotesHTML()}</div>
          <div class="entry-panel-suggest-slot">${renderRenameHTML()}</div>
          <label for="entry-panel-score">Score</label>
          <div class="entry-panel-score-row">
            <div class="score-combo">
              <input id="entry-panel-score" class="score-input" type="number" min="0" value="${seed.score}"
                role="combobox" aria-expanded="false" aria-controls="entry-panel-score-list" aria-autocomplete="list" autocomplete="off"${ro}>
              ${ro ? '' : `<button type="button" class="score-combo-toggle" tabindex="-1" aria-expanded="false" aria-controls="entry-panel-score-list" aria-label="Show score tiers"><svg class="score-combo-chevron" width="8" height="5" aria-hidden="true"><use href="#icon-arrow"/></svg></button>`}
              <ul id="entry-panel-score-list" class="score-listbox score-combo-list" role="listbox" aria-label="Score tiers" hidden></ul>
            </div>
            <span class="entry-panel-length"><span class="entry-panel-length-label">Length</span><span class="entry-panel-length-value">${toNorm(seed.entry).length}</span></span>
          </div>
          <label for="entry-panel-comment">Comment</label>
          <input id="entry-panel-comment" class="comment-input" type="text" value="${esc(seed.comment)}"${ro}>
        </div>
        <div class="entry-panel-async"><div class="entry-panel-prov-wrap">${provWrapHTML()}</div></div>
        <div class="entry-panel-async"><div class="entry-panel-family"></div></div>
        <div class="entry-panel-async"><div class="entry-panel-lookup"></div></div>
      </div>
      <div class="entry-panel-foot">${renderFooterHTML(seed.entry)}</div>`;
  }

  function renderNavHTML() {
    if (activeMode === 'create') return '';
    const caret = up => `<svg class="entry-walk-caret${up ? ' entry-walk-caret--up' : ''}" viewBox="0 0 8 5" aria-hidden="true"><use href="#icon-chevron"/></svg>`;
    return `<div class="entry-panel-nav">
      <button class="entry-panel-prev" type="button" aria-label="Previous entry" title="Previous entry (Alt+↑)">${caret(true)}</button>
      <span class="entry-panel-walkpos" aria-live="polite"></span>
      <button class="entry-panel-next" type="button" aria-label="Next entry" title="Next entry (Alt+↓)">${caret(false)}</button>
    </div>`;
  }

  // Entry text is passed in, not read from `.entry-input`: during renderHTML `el`
  // still holds the previous panel's input, which would mis-flag a fresh open.
  function isRenaming(entryText) {
    if (activeMode !== 'edit') return false;
    const raw = entryText.trim();
    const seed = activeSeed;
    return !!(seed && raw && (toNorm(raw) !== seed.norm || raw !== (seed.display ?? seed.norm)));
  }

  function entryInputValue() {
    const inp = el && el.querySelector('.entry-input');
    return inp ? inp.value : '';
  }

  function headerText(entryText, changed = false) {
    if (activeReadOnly) return 'View entry (read-only)';
    if (stagedDelete) return 'Delete entry';
    if (activeMode === 'create') return 'Add entry';
    if (isRenaming(entryText)) return 'Rename entry';
    return changed ? 'Edit entry' : 'View entry';
  }

  function saveLabel(entryText) {
    if (stagedDelete) return 'Delete';
    if (activeMode === 'create') return 'Add';
    return isRenaming(entryText) ? 'Rename' : 'Save';
  }

  function updateModeLabels() {
    const entryText = entryInputValue();
    const t = el && el.querySelector('.entry-panel-title');
    if (t) t.textContent = headerText(entryText, pendingWritesChange(readNewValues()));
    const s = el && el.querySelector('.entry-panel-save');
    if (s) s.textContent = saveLabel(entryText);
  }

  // `resetInputs: true` re-renders the inputs too (when the user isn't mid-edit);
  // the default leaves them alone so an edit-commit (e.g. tabbing from score to
  // comment) preserves focus and the just-typed value.
  function refresh({ resetInputs = false, skipExistsCheck = false } = {}) {
    if (!isOpen()) return;
    // rebindEntry already proved the entry is in the result (it re-anchored to it),
    // and post-flip resultHasEntry can't re-confirm a re-bound entry whose display
    // differs from the run's rebindQuery (no local corpus to fall back on) — so it
    // would wrongly return false and skip the provenance refresh (a deleted-edit
    // revert then keeps the stale provenance). Skip the re-check on a fresh rebind.
    if (!skipExistsCheck && !activeScroller.resultHasEntry(activeWlEntry)) return;
    if (resetInputs) {
      el.innerHTML = renderHTML(activeWlEntry);
      lastProvHTML = provWrapHTML();
      lastNoteHTML = renderNotesHTML();
      wireFields();
      const inp = el.querySelector('.entry-input');
      armLocalTier(
        renderFamily(activeWlEntry.norm, activeWlEntry.display ?? null),
        fireProvenanceQuery('', inp ? inp.value : ''),
      );
      refreshRenameSuggestion(activeWlEntry.display ?? activeWlEntry.norm, OPEN_SETTLE_MS);
      updateNav();
      return;
    }
    refreshDynamicBits();
  }

  function refreshDynamicBits() {
    if (!isOpen()) return;
    const inp = el.querySelector('.entry-input');
    const typed = inp ? inp.value : '';
    const norm = toNorm(typed);
    fireProvenanceQuery(typed, typed);
    renderFamily(norm, typed);
    refreshRenameSuggestion(typed);
    renderProvWrap();
    updateModeLabels();
    updateLengthDisplay(norm.length);
  }

  function updateLengthDisplay(len) {
    const valEl = el?.querySelector('.entry-panel-length-value');
    if (valEl) valEl.textContent = String(len);
  }

  function provWrapHTML() {
    return renderProvenanceTableHTML();
  }

  // The note lives above the Score field, clear of the score combo's drop zone —
  // in the body it sat under the open combo and its Edit-it link was unclickable.
  function renderNoteSlot() {
    if (!isOpen()) return;
    const slot = el.querySelector('.entry-panel-note-slot');
    if (!slot) return;
    const html = renderNotesHTML();
    if (html === lastNoteHTML) return;
    lastNoteHTML = html;
    slot.innerHTML = html;
  }

  // Skip the rewrite when the markup is unchanged. An identical rewrite still
  // detaches the trash node, and a detach between a click's mousedown and mouseup
  // makes the browser fire no click at all — silently dropping the staged-delete
  // toggle when an async reply (a plan/prov fetch) lands mid-click.
  function renderProvWrap() {
    if (!isOpen()) return;
    renderNoteSlot();
    if (!localTierOpen) return;
    const provEl = el.querySelector('.entry-panel-prov-wrap');
    if (!provEl) return;
    const html = provWrapHTML();
    if (html === lastProvHTML) return;
    lastProvHTML = html;
    provEl.innerHTML = html;
    revealBlock(provEl);
  }

  function armLocalTier(...replies) {
    const token = ++localTierToken;
    localTierOpen = false;
    clearTimeout(localTierTimer);
    localTierTimer = setTimeout(() => liftLocalTier(token), LOCAL_TIER_MS);
    Promise.allSettled(replies).then(() => liftLocalTier(token));
  }

  function liftLocalTier(token) {
    if (token !== localTierToken || localTierOpen || !isOpen()) return;
    clearTimeout(localTierTimer);
    localTierOpen = true;
    renderProvWrap();
    paintFamily();
  }

  // The collapsed→expanded transition needs a frame at the old height to animate from;
  // setting content and the class in one task lands on the end state with no motion.
  function revealBlock(node) {
    const wrap = node?.closest('.entry-panel-async');
    if (!wrap) return;
    if (!node.innerHTML) { wrap.classList.remove('revealed'); return; }
    if (wrap.classList.contains('revealed')) return;
    requestAnimationFrame(() => wrap.classList.add('revealed'));
  }

  // No debounce: every keystroke (and the open) fires. The monotonic token drops
  // all but the latest reply, so a fast typist's stale reply can't overwrite the
  // live table.
  function fireProvenanceQuery(typedRaw, previewRaw) {
    firePlanQuery();   // the structural plan rides the same entry-text/open triggers
    const token = ++provQueryToken;
    provQueriesFired++;
    const clickedNorm = activeWlEntry?.norm ?? null;
    // Raw display, not displayOf's norm fallback: collapsing a bare entry to its norm
    // makes the worker filter drop the concrete siblings it unified with, with no error.
    const clickedDisplay = activeWlEntry?.display ?? null;
    return fetchWorkerProvenance(typedRaw, previewRaw, clickedNorm, clickedDisplay)
      .then(({ rows }) => {
        // Match by norm, not identity: each run rebuilds activeWlEntry fresh, so an
        // identity check would drop every reply after a re-bind.
        if (token !== provQueryToken || !isOpen()
            || activeWlEntry?.norm !== clickedNorm) return;
        // A null (not-fresh) reply leaves the last-good in place; blanking flashes.
        if (rows == null) return;
        shippedProvRows = rows;
        provRepliesApplied++;
        renderProvWrap();
      });
  }

  // The open-time query: typedRaw '' so the worker's provTarget falls to the
  // clicked atom, while previewRaw seeds the footer from seed.entry — the two
  // targets the open uses, which a single typedRaw can't express.
  function fireInitialProvenanceQuery(seedEntry) {
    return fireProvenanceQuery('', seedEntry);
  }

  function readNewValues() {
    return {
      raw: el.querySelector('.entry-input').value.trim(),
      score: parseInt(el.querySelector('.score-input').value, 10),
      comment: el.querySelector('.comment-input').value,
    };
  }

  function valuesValid({ raw, score }) {
    return raw.length > 0 && !isNaN(score) && score >= 0;
  }

  // Diff against the seed (what's shown/edited), not the clicked atom: from a
  // scoped lower-priority view those differ, so an unchanged save would
  // otherwise write a spurious My Edits entry no one asked for.
  function saveBaseline() {
    if (activeSeed) {
      return { norm: activeSeed.norm, display: activeSeed.display, score: activeSeed.score, comment: activeSeed.comment };
    }
    return activeWlEntry;
  }

  // Create always stays dirty so its Enter still targets the missing field rather
  // than closing; edit/read-only defer to hasUnsavedChanges. Not the save-enabled
  // predicate — a changed-but-blocked edit stays dirty (disabled Save, its reason shown).
  function panelHasChanges() {
    if (activeMode !== 'edit' && !activeReadOnly) return true;
    return hasUnsavedChanges();
  }

  function submitOrClose() {
    panelHasChanges() ? submit() : close();
  }

  // Returns whether the panel committed and closed; a bail — read-only, invalid, or
  // blocked — leaves it open with the offending field focused, which dismiss()
  // turns into a nudge.
  function submit() {
    if (activeReadOnly) return false;
    if (stagedDelete) {
      const scroller = activeScroller;
      const target = stagedDelete;
      close();
      scroller._onDeleteRow?.(target);
      return true;
    }
    const newValues = readNewValues();
    if (!valuesValid(newValues)) {
      const focusTarget = newValues.raw.length === 0 ? '.entry-input' : '.score-input';
      el.querySelector(focusTarget).focus();
      return false;
    }
    if (saveBlocked()) { el.querySelector('.entry-input')?.focus(); return false; }
    const mode = stagedAdopt ? 'adopt' : activeMode;
    const baseline = mode === 'create' ? null : editBaselineFor(saveBaseline());
    activeScroller._onSave?.(mode, baseline, newValues);
    close();
    return true;
  }

  function wireFooter() {
    el.querySelector('.entry-panel-close')?.addEventListener('click', close);
    el.querySelector('.entry-panel-cancel')?.addEventListener('click', close);
    if (activeReadOnly) return;
    el.querySelector('.entry-panel-save').addEventListener('click', submit);
    refreshSaveEnabled();
  }

  // Save commits a staged deletion, so it stays enabled while one is pending
  // (its inputs are disabled then, but the validity gate must not block it).
  function refreshSaveEnabled() {
    const saveBtn = el.querySelector('.entry-panel-save');
    if (saveBtn) {
      if (stagedDelete || stagedAdopt) saveBtn.disabled = false;
      else {
        const vals = readNewValues();
        saveBtn.disabled = !valuesValid(vals) || saveBlocked()
          || (activeMode === 'edit' && !pendingWritesChange(vals));
      }
    }
    el.querySelector('.entry-panel-foot')?.classList.toggle('dirty', panelHasChanges());
    refreshAdoptLink();
  }

  function saveBlocked() {
    const plan = previewPlan();
    return !!(plan && plan.blockedReason);
  }

  function mountLookup(entryInp, settleMs) {
    const host = el.querySelector('.entry-panel-lookup');
    if (host) LookupSection.mount(host, entryInp.value, { settleMs, onChange: () => revealBlock(host) });
  }

  function wireFields(settleMs = OPEN_SETTLE_MS) {
    const entryInp = el.querySelector('.entry-input');
    const scoreInp = el.querySelector('.score-input');
    const commentInp = el.querySelector('.comment-input');

    if (activeReadOnly) {
      scoreCombo = null;
      wireFooter();
      mountLookup(entryInp, settleMs);
      return;
    }

    entryInp.addEventListener('beforeinput', blockSemicolon);
    commentInp.addEventListener('beforeinput', blockSemicolon);
    for (const inp of [entryInp, scoreInp, commentInp]) {
      inp.addEventListener('input', unstageAdopt);
    }
    // An entry edit changes the norm → re-query the worker for contributors;
    // score/comment only move the local My Edits preview row.
    entryInp.addEventListener('input', refreshDynamicBits);
    entryInp.addEventListener('input', () => LookupSection.setEntry(entryInp.value));
    for (const inp of [scoreInp, commentInp]) {
      inp.addEventListener('input', renderProvWrap);
      inp.addEventListener('input', updateModeLabels);
    }
    scoreInp.addEventListener('input', refreshFamilyScore);

    for (const inp of [entryInp, scoreInp, commentInp]) {
      inp.addEventListener('input', refreshSaveEnabled);
    }
    // The score field's Enter is owned by its combobox (pick a tier, or fall to
    // submitOrClose); the other two go straight to submitOrClose.
    for (const inp of [entryInp, commentInp]) {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitOrClose(); }
      });
    }
    scoreCombo = new ScoreCombo(scoreInp, { onSubmit: submitOrClose });

    wireFooter();

    mountLookup(entryInp, settleMs);
  }

  function currentPanelScore() {
    const typed = parseInt(el.querySelector('.score-input')?.value, 10);
    if (Number.isFinite(typed)) return typed;
    return Number.isFinite(activeWlEntry?.score) ? activeWlEntry.score : null;
  }

  function renderFamily(norm, display) {
    const token = ++familyToken;
    // The bound entry rides alongside the query so the worker excludes it from the
    // corpus siblings — the panel owns the current row (below) instead.
    const boundNorm = activeWlEntry?.norm ?? norm;
    const boundDisplay = activeWlEntry ? activeWlEntry.display ?? null : display ?? null;
    return fetchWorkerFamily(norm, display ?? null, boundNorm, boundDisplay).then(members => {
      if (token !== familyToken || !isOpen()) return;
      // An editable panel overwrites the anchor with the live edit (typed name and
      // score) so the list reads as the post-save view and holds through a rename;
      // read-only has no pending edit, so the worker's row stands as-is.
      if (!activeReadOnly) {
        const cur = members.find(m => m.current);
        if (cur) { cur.display = display ?? null; cur.score = currentPanelScore(); }
        else members.push({ norm, display: display ?? null, score: currentPanelScore(), current: true });
      }
      familyMembers = members.sort(
        (a, b) => (a.display ?? a.norm).localeCompare(b.display ?? b.norm) || a.norm.localeCompare(b.norm));
      paintFamily();
    });
  }

  function paintFamily() {
    if (!isOpen() || !localTierOpen) return;
    const h = el?.querySelector('.entry-panel-family');
    if (!h) return;
    h.innerHTML = buildFamilyHTML(familyMembers);
    revealBlock(h);
  }

  // A score edit re-queries no siblings (they can't change), so patch the current
  // row's badge in place — else the anchor keeps its pre-edit score.
  function refreshFamilyScore() {
    const cur = familyMembers.find(m => m.current);
    if (!cur) return;
    cur.score = currentPanelScore();
    paintFamily();
  }

  function renderRenameHTML() {
    if (!renameSuggestion) return '';
    return `<div class="entry-panel-suggest">Rename to `
      + `<button type="button" class="entry-panel-suggest-link">${esc(renameSuggestion)}</button></div>`;
  }

  function renderRenameSlot() {
    const slot = el?.querySelector('.entry-panel-suggest-slot');
    if (slot) slot.innerHTML = renderRenameHTML();
  }

  function setRenameSuggestion(s) {
    if (s === renameSuggestion) return;
    renameSuggestion = s;
    renderRenameSlot();
  }

  // Set well past a healthy resolution on purpose: a stand-in is a second answer the
  // resolution then rewrites, so lowering this makes the two-answer flicker routine.
  const RENAME_STANDIN_MS = 1000;

  // A bare entry (display === norm) takes any canonical form, ungated — it only ever
  // enriches the norm. An already-rich entry takes the reference form only when
  // strictly richer (isRicher), never one that lowercases or de-accents. Clear *and*
  // return when ineligible or a stale hint lingers.
  function refreshRenameSuggestion(display, settleMs = TYPING_SETTLE_MS) {
    const token = ++renameToken;
    clearTimeout(renameTimer);
    clearTimeout(renameStandInTimer);
    // A hint belongs to the exact text it was computed for, so a changed one drops it
    // up front. Without this the un-ready early-returns below would leave the previous
    // keystroke's hint sitting on the new text, where clicking it renames to the wrong
    // spelling. Re-renders pass the SAME text and so keep their hint.
    if (display !== renameSuggestionFor) {
      renameSuggestionFor = display;
      setRenameSuggestion(null);
    }
    const norm = toNorm(display);
    if (activeReadOnly || !norm) { setRenameSuggestion(null); return; }
    const bare = display === norm;
    const start = () => {
      let settled = false;
      // The spacing is resolveEntryCanonical's own fallback, so firing it up front for
      // a faster hint just posts an answer the resolution then rewrites.
      if (bare) renameStandInTimer = setTimeout(() => {
        fetchWorkerSpaceOut(norm).then(({ suggestion, ready }) => {
          // An un-ready segmenter knows nothing about this entry, so it must not speak
          // for it — clearing here would erase a hint the reference pass had upgraded.
          if (settled || token !== renameToken || !isOpen() || !ready) return;
          setRenameSuggestion(suggestion && suggestion !== display ? suggestion : null);
        });
      }, RENAME_STANDIN_MS);
      resolveEntryCanonical(display).then(({ value, complete, local }) => {
        settled = true;
        if (token !== renameToken || !isOpen()) return;
        clearTimeout(renameStandInTimer);   // past the token check, the pending timer is ours
        // A degraded answer still shows when it's the local fallback — an outage degrades
        // to the spacing, not to no hint. A degraded *reference* form is suppressed: its
        // leading capital was settled with no evidence, so it can force-cap (Ground frost).
        if (!complete && !local) return;
        const ok = value && value !== display && (bare || isRicher(value, display));
        setRenameSuggestion(ok ? value : null);
      });
    };
    if (settleMs) renameTimer = setTimeout(start, settleMs);
    else start();
  }

  function applyRename() {
    if (!renameSuggestion) return;
    const inp = el?.querySelector('.entry-input');
    if (!inp || inp.disabled) return;
    inp.value = renameSuggestion;
    // The dispatched input event is load-bearing, not cosmetic: it drives the
    // rename-mode flip, provenance preview, and Save-enable. Setting value alone
    // fills the field but stages nothing.
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }

  // The walk's first member is the worker's to name — main can't order a hand-picked set
  // (Ctrl-click order, and off-window picks aren't in the row window) — so the panel
  // waits on the reply. Opening first and re-seeding on arrival would re-render the panel
  // out from under the user's first keystroke, discarding it.
  async function openSelectionWalk(walkIds, cursorWlEntry, rowEl, scroller) {
    const token = ++walkToken;
    const members = await fetchWorkerWinners(walkIds);
    if (token !== walkToken) return;
    const first = members[0];
    if (!first) { open(cursorWlEntry, rowEl, scroller, 'entry', 'edit', false); return; }
    scroller?.setPanelCursor?.({ norm: first.norm, display: first.display ?? null });
    open(memberTarget(first), null, scroller, 'entry', 'edit', false);
    walkSelection = { members, index: 0 };
    updateNav();
  }

  function buildFamilyHTML(members) {
    // Show only when a sibling is present, else an entry with no relatives renders
    // as a lone bold self. (Empty members — no anchor at all — falls out the same way.)
    if (members.every(m => m.current)) return '';
    const items = members.map((m, i) => {
      const cls = m.current ? 'entry-family-item entry-family-item--current' : 'entry-family-item';
      const badge = Number.isFinite(m.score) ? ` ${buildScoreBadgeHTML(m.score)}` : '';
      return `<span class="${cls}" data-fam-idx="${i}" tabindex="0">`
        + `<span class="entry-family-entry">${esc(displayOf(m))}</span>${badge}</span>`;
    }).join(' · ');
    return `<div class="lookup-sec"><div class="lookup-sec-head">Related entries</div>`
      + `<div class="entry-family-list">${items}</div></div>`;
  }

  function updateNav() {
    if (!isOpen()) return;
    const prev = el.querySelector('.entry-panel-prev');
    const next = el.querySelector('.entry-panel-next');
    const pos = el.querySelector('.entry-panel-walkpos');
    if (!prev || !next) return;
    let atFirst, atLast, label = '';
    if (walkSelection) {
      atFirst = walkSelection.index <= 0;
      atLast = walkSelection.index >= walkSelection.members.length - 1;
      label = walkSelection.members.length ? `${walkSelection.index + 1} / ${walkSelection.members.length}` : '';
    } else {
      const edges = activeScroller?.panelWalkEdges?.(currentWalkId()) ?? { atFirst: false, atLast: false };
      atFirst = edges.atFirst; atLast = edges.atLast;
    }
    prev.disabled = atFirst;
    next.disabled = atLast;
    if (pos) pos.textContent = label;
  }

  function fieldNameOf(node) {
    if (!node || !node.classList) return null;
    if (node.classList.contains('entry-input')) return 'entry';
    if (node.classList.contains('score-input')) return 'score';
    if (node.classList.contains('comment-input')) return 'comment';
    return null;
  }

  // Auto-commit the current member on a walk step. Blocks the step on an invalid
  // value (same gate as Save) so a bad score can't silently drop as you move on.
  function commitForWalk() {
    if (activeReadOnly || activeMode === 'create') return true;
    // A staged delete is a pending commit like an edit; flush it (as submit() does)
    // so navigating to a relative doesn't silently drop it. No close() — the caller
    // navigates instead of dismissing.
    if (stagedDelete) {
      const scroller = activeScroller, target = stagedDelete;
      stagedDelete = null;
      scroller._onDeleteRow?.(target);
      return true;
    }
    const newValues = readNewValues();
    if (!stagedAdopt && !pendingWritesChange(newValues)) return true;
    if (!valuesValid(newValues)) {
      el.querySelector(newValues.raw.length === 0 ? '.entry-input' : '.score-input')?.focus();
      return false;
    }
    if (saveBlocked()) { el.querySelector('.entry-input')?.focus(); return false; }
    activeScroller._onSave?.(stagedAdopt ? 'adopt' : 'edit', editBaselineFor(saveBaseline()), newValues);
    if (walkSelection) {
      const m = walkSelection.members[walkSelection.index];
      if (m) { m.score = newValues.score; m.comment = newValues.comment; m.display = newValues.raw; m.norm = toNorm(newValues.raw); }
    }
    return true;
  }

  function memberTarget(m) {
    const wl = state.sources.find(s => s.dbKey === m.sourceId) ?? null;
    return { norm: m.norm, display: m.display ?? null, score: m.score, comment: m.comment, wordlist: wl };
  }

  async function walkStep(delta) {
    if (!isOpen() || activeMode === 'create') return;
    const focus = lastFocusField;
    if (!commitForWalk()) return;
    if (walkSelection) {
      const target = walkSelection.index + delta;
      if (target < 0 || target >= walkSelection.members.length) return;
      walkSelection.index = target;
      const m = walkSelection.members[target];
      activeScroller?.setPanelCursor?.({ norm: m.norm, display: m.display ?? null });
      walkTo(memberTarget(m), focus);
    } else {
      const wlEntry = await activeScroller?.stepPanelCursor?.(delta, currentWalkId());
      if (wlEntry) walkTo(wlEntry, focus);
    }
  }
  function currentWalkId() {
    return activeWlEntry ? { norm: activeWlEntry.norm, display: activeWlEntry.display ?? null } : null;
  }
  function walkPrev() { walkStep(-1); }
  function walkNext() { walkStep(1); }

  function clickFamilyRow(i) {
    const m = familyMembers[i];
    if (!m || m.current) return;
    if (!commitForWalk()) return;
    // A relative can sit outside the current result, so open it fresh (a history push,
    // Back returns here) instead of moving the table cursor onto a maybe-absent row.
    const wordlist = state.sources.find(s => s.dbKey === m.sourceId) ?? null;
    open({ norm: m.norm, display: m.display ?? null, score: m.score, comment: m.comment, wordlist }, null, getEntriesScroller(), null);
  }

  // Replace (not push): the whole walk is one history entry, so Back closes the
  // panel rather than rewinding member-by-member.
  function walkTo(target, focus) {
    doOpen(target, null, activeScroller, focus, 'edit', { selectField: false, settleMs: WALK_SETTLE_MS });
    activeScroller?.repaintActiveRow?.();
    _navigate();
  }

  function setScoreByDigit(digit) {
    if (!isOpen()) return false;
    const opt = optionForDigit(buildScoreOptions(), digit);
    if (!opt) return false;
    const scoreInp = el.querySelector('.score-input');
    // The lock guards are load-bearing: `disabled` while the scoped seed is in flight
    // (writing then clobbers the un-refined value); `readonly` in a foreign scope,
    // where the field is a read-only value that Alt+digit must not overwrite.
    if (!scoreInp || scoreInp.disabled || activeReadOnly) return false;
    scoreInp.value = opt.score;
    scoreInp.dispatchEvent(new Event('input', { bubbles: true }));
    scoreInp.focus();
    scoreInp.select();
    return true;
  }

  function activeNorm(scroller) {
    if (!isOpen()) return null;
    if (scroller && activeScroller !== scroller) return null;
    return activeWlEntry ? activeWlEntry.norm : null;
  }

  function rebindRow(rowEl) {
    if (!isOpen()) return;
    if (activeRow) activeRow.classList.remove('active');
    activeRow = rowEl;
    rowEl.classList.add('active');
  }

  // Must move in step with renameInSelection: unpaired, the panel silently keeps
  // the pre-rename spelling and every lookup keyed on it misses.
  function renameActive(oldId, nextId) {
    if (!activeWlEntry) return;
    if (activeWlEntry.norm !== oldId.norm) return;
    if ((activeWlEntry.display ?? null) !== (oldId.display ?? null)) return;
    activeWlEntry = { ...activeWlEntry, norm: nextId.norm, display: nextId.display ?? null };
  }

  // Rides the run (mirrors existsInScope) instead of awaiting the worker at
  // rebind time: rebindEntry runs in updateEntries' synchronous render, so
  // async-ifying findResultEntry/resultHasEntry would ripple a dual path through
  // it. The run resolves this target against the owned corpus and ships it back.
  function rebindQuery() {
    return isOpen() && activeWlEntry
      ? { norm: activeWlEntry.norm, display: activeWlEntry.display ?? null }
      : null;
  }

  function rebindEntry(scroller) {
    if (!isOpen() || activeScroller !== scroller) return;
    const found = scroller.findResultEntry(activeWlEntry.norm, activeWlEntry.display);
    if (!found) return;
    activeWlEntry = found;
    const editing = containsFocus() && focusEl.matches('.entry-input, .score-input, .comment-input');
    refresh({ resetInputs: !editing, skipExistsCheck: true });
  }

  return { open, openSelectionWalk, openForCreate, openFromRoute, close, isOpen, containsFocus, activeNorm, rebindRow, rebindEntry, rebindQuery, renameActive, routeValue, setScoreByDigit, seedDebug, provenanceDebug };
})();

export function entryPanelRebindQuery() {
  return EntryPanel.rebindQuery();
}

export function entryPanelRouteValue() {
  return EntryPanel.routeValue();
}

// ─── Score quick-pick ─────────────────────────────────────────────────────────

// Editable scopes are All Wordlists (edits route into My Edits) and My Edits itself;
// a foreign single-list scope is read-only — not ours to change.
function scopeIsEditable() {
  const edits = getEditsWordlist();
  return state.selected === MERGED_ID || (edits != null && state.selected === edits);
}

function scoreQuickPickable() {
  return scopeIsEditable();
}

// `hint` (the Alt+digit accelerator) counts up from 0 = lowest tier rather than
// matching the score's tens digit, so the mapping holds on any scale, not just ×10.
export function buildScoreOptions() {
  const opts = state.scoring
    .map(r => {
      const intervals = parseRange(r.input);
      return intervals ? { note: r.note || '', score: intervals[0].min } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const n = opts.length;
  opts.forEach((o, i) => { const fromBottom = n - 1 - i; o.hint = fromBottom <= 9 ? fromBottom : null; });
  return opts;
}

function optionForDigit(options, digit) {
  return options.find(o => o.hint === digit) || null;
}

function buildScoreOptionItemsHTML(options, activeIndex, idPrefix) {
  const colW = badgeWidthPx(Math.max(...options.map(o => String(o.score).length), 1));
  const html = options.map((o, i) => {
    const hint = o.hint != null ? `<span class="score-picker-hint">Alt+${o.hint}</span>` : '';
    return `<li id="${idPrefix}-${i}" class="score-picker-opt" role="option" data-i="${i}"`
      + ` aria-selected="${i === activeIndex}" title="${esc(o.note)}">`
      + `<span class="score-picker-badge">${buildScoreBadgeHTML(o.score)}</span>`
      + `<span class="score-picker-label">${esc(o.note)}</span>${hint}</li>`;
  }).join('');
  return { html, colW };
}

function commitRescore(scroller, wlEntry, score) {
  if (!scroller || !wlEntry || !Number.isFinite(score) || score < 0) return;
  const winnerIsEdits = getEditsWordlist() != null && wlEntry.wordlist === getEditsWordlist();
  const seed = seedFromWinnerRow(wlEntry, winnerIsEdits);
  // Re-applying the score already in place is a true no-op; bail before _onSave
  // so the table doesn't flash a rebuild for nothing.
  if (score === seed.score) return;
  scroller._onSave?.('rescore', editBaselineFor(seed), { raw: seed.entry, score, comment: seed.comment });
}

export function handleScoreDigitShortcut(digit) {
  if (ScorePicker.isOpen()) return ScorePicker.pickDigit(digit);
  if (EntryPanel.isOpen()) return EntryPanel.setScoreByDigit(digit);
  return getEntriesScroller()?.rescoreSelectionByDigit(digit) ?? false;
}

class ScoreOptionList {
  constructor(el, { idPrefix, ariaHost = el } = {}) {
    this.el = el;
    this.idPrefix = idPrefix;
    this.ariaHost = ariaHost;
    this.options = [];
    this.activeIndex = -1;
  }

  get length() { return this.options.length; }
  option(i) { return this.options[i]; }
  setOptions(options) { this.options = options; }

  // A between-tiers score rounds down to the next tier, not the nearest.
  indexForScore(score) {
    if (!Number.isFinite(score)) return -1;
    const i = this.options.findIndex(o => o.score <= score);
    return i < 0 ? this.options.length - 1 : i;
  }
  indexForDigit(digit) { return this.options.findIndex(o => o.hint === digit); }

  render(activeIndex = -1) {
    this.activeIndex = activeIndex;
    const { html, colW } = buildScoreOptionItemsHTML(this.options, activeIndex, this.idPrefix);
    this.el.innerHTML = html;
    this.el.style.setProperty('--badge-col', `${colW}px`);
  }

  setActive(i, scroll = true) {
    const clamped = Math.max(0, Math.min(this.options.length - 1, i));
    if (clamped === this.activeIndex) return;
    this.activeIndex = clamped;
    this.syncActive(scroll);
  }

  syncActive(scroll = true) {
    const lis = this.el.querySelectorAll('.score-picker-opt');
    lis.forEach((li, j) => {
      const on = j === this.activeIndex;
      li.classList.toggle('active', on);
      li.setAttribute('aria-selected', on);
    });
    if (this.activeIndex >= 0) {
      if (scroll) lis[this.activeIndex]?.scrollIntoView({ block: 'nearest' });
      this.ariaHost.setAttribute('aria-activedescendant', lis[this.activeIndex]?.id ?? '');
    } else {
      this.ariaHost.removeAttribute('aria-activedescendant');
    }
  }
}

// Offered only in the All Wordlists and My Edits scopes: there the clicked row
// holds the value a save writes, so the picked tier shows in place. A single-
// source scope would write the edit into My Edits while still showing the
// source's score — silently appearing to do nothing — so it uses the EntryPanel.
export const ScorePicker = (() => {
  let el = null;
  let list = null;
  let activeRow = null;
  let activeAnchor = null;
  let activeWlEntry = null;
  let activeScroller = null;
  let startIndex = 0;

  function ensureElement() {
    if (el) return el;
    el = document.createElement('ul');
    el.id = 'score-picker';
    el.className = 'score-listbox';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Set score');
    el.tabIndex = -1;
    el.setAttribute('hidden', '');
    el.addEventListener('click', e => {
      const opt = e.target.closest('.score-picker-opt');
      if (opt) commit(parseInt(opt.dataset.i, 10));
    });
    el.addEventListener('mousemove', e => {
      const opt = e.target.closest('.score-picker-opt');
      if (opt) list.setActive(parseInt(opt.dataset.i, 10), false);
    });
    document.body.appendChild(el);
    list = new ScoreOptionList(el, { idPrefix: 'score-picker-opt' });
    return el;
  }

  function isOpen() { return el && !el.hasAttribute('hidden'); }

  function open(wlEntry, rowEl, scroller, anchorEl) {
    EntryPanel.close();
    const options = buildScoreOptions();
    if (!options.length) { EntryPanel.open(wlEntry, rowEl, scroller, 'score'); return; }

    const picker = ensureElement();
    if (activeRow) activeRow.classList.remove('active');
    activeWlEntry = wlEntry;
    activeRow = rowEl;
    activeScroller = scroller;
    activeAnchor = anchorEl ?? rowEl;
    if (rowEl) rowEl.classList.add('active');

    list.setOptions(options);
    startIndex = list.indexForScore(wlEntry.score);
    list.render(startIndex);
    picker.removeAttribute('hidden');
    position();
    picker.focus();
    list.syncActive();

    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  function close() {
    if (!el || el.hasAttribute('hidden')) return;
    el.setAttribute('hidden', '');
    if (activeRow) activeRow.classList.remove('active');
    activeRow = activeAnchor = activeWlEntry = activeScroller = null;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeydown, true);
  }

  function commit(i) {
    const opt = list.option(i);
    const scroller = activeScroller, w = activeWlEntry;
    close();
    if (opt) commitRescore(scroller, w, opt.score);
  }

  function pickDigit(digit) {
    if (!isOpen()) return false;
    const i = list.indexForDigit(digit);
    if (i < 0) return false;
    commit(i);
    return true;
  }

  function onDocMouseDown(e) {
    if (!isOpen()) return;
    if (el.contains(e.target) || (activeAnchor && activeAnchor.contains(e.target))) {
      // The picker overlays its start option on the clicked badge, so a quick
      // second click there completes a native double-click; suppress its default
      // text selection so the score doesn't flash selected before the commit.
      e.preventDefault();
      return;
    }
    close();
  }

  function onKeydown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;   // Alt+digit is routed globally
    switch (e.key) {
      case 'Escape':    e.preventDefault(); close(); break;
      case 'ArrowDown': e.preventDefault(); list.setActive(list.activeIndex + 1); break;
      case 'ArrowUp':   e.preventDefault(); list.setActive(list.activeIndex - 1); break;
      case 'Home':      e.preventDefault(); list.setActive(0); break;
      case 'End':       e.preventDefault(); list.setActive(list.length - 1); break;
      case 'Enter':     e.preventDefault(); commit(list.activeIndex); break;
    }
  }

  function position() {
    if (window.matchMedia('(max-width: 759px)').matches) {
      el.style.top = '';
      el.style.left = '';
      return;
    }
    const anchorBadge = activeAnchor.querySelector('.score-badge') ?? activeAnchor;
    const optBadge = el.querySelectorAll('.score-picker-opt')[startIndex]?.querySelector('.score-badge');
    if (!optBadge) { anchorDropdown(el, activeAnchor); return; }
    const a = anchorBadge.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const b = optBadge.getBoundingClientRect();
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let left = a.left - (b.left - e.left);
    let top  = a.top  - (b.top  - e.top);
    left = Math.max(8, Math.min(left, window.innerWidth  - 8 - pw));
    top  = Math.max(8, Math.min(top,  window.innerHeight - 8 - ph));
    el.style.left = left + 'px';
    el.style.top  = top + 'px';
  }

  return { open, close, isOpen, pickDigit };
})();

class ScoreCombo {
  constructor(input, { onSubmit } = {}) {
    this.input = input;
    this.onSubmit = onSubmit;
    this.combo = input.closest('.score-combo');
    this.listEl = this.combo.querySelector('.score-combo-list');
    this.toggleBtn = this.combo.querySelector('.score-combo-toggle');
    this.list = new ScoreOptionList(this.listEl, { idPrefix: `${input.id}-opt`, ariaHost: input });
    this.list.setOptions(buildScoreOptions());
    this.opened = false;
    // Gates Enter: the highlight tracks the typed value, but Enter snaps to a tier
    // only after an arrow key — else a typed 55 in the ≥50 tier silently becomes 50.
    this.navigated = false;

    if (!this.list.length) { this.combo.classList.add('score-combo--bare'); return; }

    this.input.addEventListener('blur', () => this.close());
    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('keydown', e => this.onKeydown(e));
    // The chevron is the only pointer affordance that opens the list; a plain focus
    // (tab, Alt+digit, panel open) deliberately doesn't — don't re-add a focus opener.
    this.toggleBtn.addEventListener('mousedown', e => e.preventDefault());
    this.toggleBtn.addEventListener('click', () => {
      this.input.focus();
      this.opened ? this.close() : this.open();
    });
    // Keep focus in the input so an option click isn't pre-empted by a blur that
    // closes the list first.
    this.listEl.addEventListener('mousedown', e => e.preventDefault());
    this.listEl.addEventListener('click', e => {
      const li = e.target.closest('.score-picker-opt');
      if (li) this.pick(parseInt(li.dataset.i, 10));
    });
    this.listEl.addEventListener('mousemove', e => {
      const li = e.target.closest('.score-picker-opt');
      if (li) this.list.setActive(parseInt(li.dataset.i, 10), false);
    });
  }

  isOpen() { return this.opened; }
  get activeIndex() { return this.list.activeIndex; }

  open({ navigated = false } = {}) {
    if (this.opened || !this.list.length || this.input.disabled) return;
    this.opened = true;
    this.navigated = navigated;
    this.input.setAttribute('aria-expanded', 'true');
    this.toggleBtn.setAttribute('aria-expanded', 'true');
    this.listEl.hidden = false;
    this.list.render(this.list.indexForScore(parseInt(this.input.value, 10)));
    this.list.syncActive(true);
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    this.navigated = false;
    this.input.setAttribute('aria-expanded', 'false');
    this.toggleBtn.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.listEl.hidden = true;
  }

  onInput() {
    if (!this.opened) return;
    this.navigated = false;
    this.list.render(this.list.indexForScore(parseInt(this.input.value, 10)));
    this.list.syncActive(false);
  }

  onKeydown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;   // Alt+digit is routed globally
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!this.opened) this.open({ navigated: true });
        else this.navTo(this.activeIndex < 0 ? 0 : this.activeIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!this.opened) this.open({ navigated: true });
        else this.navTo(this.activeIndex < 0 ? this.list.length - 1 : this.activeIndex - 1);
        break;
      case 'Home': if (this.opened) { e.preventDefault(); this.navTo(0); } break;
      case 'End':  if (this.opened) { e.preventDefault(); this.navTo(this.list.length - 1); } break;
      case 'Enter':
        // While the list is open Enter stays in the picker (accept the arrowed tier,
        // else close keeping the typed value) — deliberately never the panel's save.
        e.preventDefault();
        if (this.opened) {
          if (this.navigated && this.activeIndex >= 0) this.pick(this.activeIndex);
          else this.close();
        } else {
          this.onSubmit?.();
        }
        break;
      // Escape: handled by EntryPanel.onKeydown (combo-close when open, else panel
      // close), deliberately not here — so don't add an Escape case.
    }
  }

  navTo(i) {
    this.navigated = true;
    this.list.setActive(i);
  }

  pick(i) {
    const opt = this.list.option(i);
    if (!opt) return;
    this.input.value = String(opt.score);
    this.close();
    // Drives the panel's preview/save wiring as a typed digit would; without it a
    // pick wouldn't refresh the preview or re-enable Save.
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.input.focus();
  }
}

export const SortMenu = (() => {
  let el = null;
  let anchorBtn = null;
  let options = [];      // [{ key, label, active }]
  let cursor = 0;        // keyboard cursor index
  let extendMode = false;   // opened via a modifier-click → picks extend the sort
  let menuAxisKeys = [];    // the column's sibling axes, for extend's swap-not-stack

  function ensureElement() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'sort-menu';
    el.setAttribute('hidden', '');
    el.addEventListener('click', e => {
      const opt = e.target.closest('.sort-menu-opt');
      if (opt) commit(opt.dataset.key, false);
    });
    el.addEventListener('mousemove', e => {
      const opt = e.target.closest('.sort-menu-opt');
      if (opt) setCursor(parseInt(opt.dataset.i, 10), false);
    });
    document.body.appendChild(el);
    return el;
  }

  function isOpen() { return el && !el.hasAttribute('hidden'); }

  function open(trigger, axisKeys, extend = false) {
    ScorePicker.close();
    EntryPanel.close();
    extendMode = extend;
    menuAxisKeys = axisKeys;
    const stack = ToolStack.getStack();
    const tierAxes = sortAxes(chainSortTier(stack), stack);
    // Label by axis name (Min score / Max score), never the column label, or the
    // active sub-axis stops being distinguishable — the gap this menu exists to close.
    options = axisKeys
      .filter(k => k in tierAxes)
      .map(k => ({ key: k, label: tierAxes[k].label, active: AppView.sortList.some(s => s.key === k) }));
    if (!options.length) return;

    const menu = ensureElement();
    anchorBtn = trigger;
    cursor = Math.max(0, options.findIndex(o => o.active));
    menu.innerHTML = renderHTML();
    menu.removeAttribute('hidden');
    // The mobile bottom-sheet is pinned by CSS; inline coords would override it.
    if (window.matchMedia('(max-width: 759px)').matches) {
      menu.style.top = menu.style.left = '';
    } else {
      positionPopover(menu, trigger, { placement: 'below', offset: 4 });
    }
    menu.querySelector('.menu-list')?.focus();
    syncCursor(false);

    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  function close(refocusTrigger = false) {
    if (!el || el.hasAttribute('hidden')) return;
    const btn = anchorBtn;
    el.setAttribute('hidden', '');
    anchorBtn = null;
    options = [];
    extendMode = false;
    menuAxisKeys = [];
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeydown, true);
    if (refocusTrigger) btn?.focus();
  }

  function renderHTML() {
    const opts = options.map((o, i) => {
      const inList = AppView.sortList.find(s => s.key === o.key);
      const arrow = inList ? (inList.dir === 'asc' ? '↑' : '↓') : '';
      return `<li id="sort-menu-opt-${i}" class="sort-menu-opt" role="option" data-key="${esc(o.key)}" data-i="${i}"`
        + ` aria-selected="${o.active}"><span class="sort-menu-label">${esc(o.label)}</span>`
        + `<span class="sort-menu-arrow">${arrow}</span></li>`;
    }).join('');
    return `<div class="menu-header">Sort by</div>`
      + `<ul class="menu-list" role="listbox" aria-label="Sort by" tabindex="-1">${opts}</ul>`;
  }

  function setCursor(i, scroll = true) {
    if (i === cursor) return;
    cursor = i;
    syncCursor(scroll);
  }

  function syncCursor(scroll = true) {
    const lis = el.querySelectorAll('.sort-menu-opt');
    lis.forEach((li, j) => li.classList.toggle('active', j === cursor));
    if (scroll) lis[cursor]?.scrollIntoView({ block: 'nearest' });
    el.querySelector('.menu-list')
      ?.setAttribute('aria-activedescendant', lis[cursor]?.id ?? '');
  }

  function commit(key, keyboard) {
    const o = options.find(x => x.key === key);
    const kind = anchorBtn?.dataset.sortCol;
    const extend = extendMode;
    const siblings = menuAxisKeys;
    close();
    if (!o) return;
    const scroller = getEntriesScroller();
    if (extend) {
      scroller?.applySortList(extendSortList(AppView.sortList, key, siblings));
    } else {
      const dir = key === AppView.sortKey ? (AppView.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
      scroller?.applySort(key, dir);
    }
    // applySort rebuilds the header, replacing the trigger — refocus the new one
    // so keyboard focus isn't dropped to <body>.
    if (keyboard && kind) document.querySelector(`.sticky-stack [data-sort-col="${CSS.escape(kind)}"]`)?.focus();
  }

  function onDocMouseDown(e) {
    if (!isOpen()) return;
    if (el.contains(e.target) || (anchorBtn && anchorBtn.contains(e.target))) return;
    close();
  }

  function onKeydown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'Escape':    e.preventDefault(); close(true); break;
      case 'ArrowDown': e.preventDefault(); setCursor(Math.min(options.length - 1, cursor + 1)); break;
      case 'ArrowUp':   e.preventDefault(); setCursor(Math.max(0, cursor - 1)); break;
      case 'Home':      e.preventDefault(); setCursor(0); break;
      case 'End':       e.preventDefault(); setCursor(options.length - 1); break;
      case 'Enter':
      case ' ':         e.preventDefault(); commit(options[cursor]?.key, true); break;
    }
  }

  return { open, close, isOpen };
})();

export function buildEntriesTablePanelHTML() {
  return `<div id="entries-table-panel">
      <div class="pipeline-spinner" aria-hidden="true"></div>
      <svg class="progress-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="progress-ring-track" cx="18" cy="18" r="16"></circle>
        <circle class="progress-ring-fill" cx="18" cy="18" r="16"></circle>
      </svg>
      <div id="vs-host"></div>
    </div>`;
}

export function setPipelineProgress(fraction) {
  const panel = document.getElementById('entries-table-panel');
  if (!panel) return;
  panel.classList.add('has-progress');
  panel.style.setProperty('--progress', String(Math.max(0, Math.min(1, fraction))));
}

export function resetPipelineProgress() {
  const panel = document.getElementById('entries-table-panel');
  if (!panel) return;
  panel.classList.remove('has-progress');
  panel.style.removeProperty('--progress');
}

// One header set for every chain shape — the Entry / Length / Score columns
// describe what each atom *line* contains, not the row as a whole, so they
// stay constant whether a row has one atom or many. Comment / Source surface
// on every chain shape when the viewport has room (gated by media query).
export function buildEntryHeadersHTML() {
  const stack = ToolStack.getStack();
  const tier = chainSortTier(stack);
  const tierAxes = sortAxes(tier, stack);
  const sortList = AppView.sortList;
  const hdr = (label, ownedAxes, colKind) => {
    if (!ownedAxes.length) return esc(label);
    const pos = sortList.findIndex(s => ownedAxes.includes(s.key));
    const active = pos >= 0;
    const asc = active && sortList[pos].dir === 'asc';
    const arrow = active ? (asc ? ' ↑' : ' ↓') : '';
    const ranked = active && sortList.length > 1;
    const badge = ranked ? `<span class="sort-rank">${pos + 1}</span>` : '';
    const state = active ? (asc ? ', ascending' : ', descending') : '';
    const rankAria = ranked ? `, sort priority ${pos + 1}` : '';
    const aria = ownedAxes.length > 1
      ? ` aria-haspopup="listbox" aria-label="Sort by ${esc(label)}"`
      : ` aria-label="Sort by ${esc(label)}${state}${rankAria}"`;
    return `<span class="col-sort" data-sort-axes="${ownedAxes.join(' ')}" data-sort-col="${esc(colKind)}"`
      + ` role="button" tabindex="0"${aria}>${esc(label)}${arrow}${badge}</span>`;
  };
  if (tier === 'tuple') {
    return `<div class="group-headers tuple-headers entry-headers-font">
      <span class="group-rownum"></span>
      <span class="group-entries-label">${hdr('Entries', columnSortAxes('group-entries', tierAxes), 'group-entries')}</span>
    </div>`;
  }
  if (isGroupChain(stack)) {
    const cols = activeGroupColumns(stack);
    const anchorLabel = activeGroupAnchorLabel(stack);
    const countInner  = hdr('Count', columnSortAxes('group-count', tierAxes), 'group-count');
    const anchorInner = anchorLabel ? hdr(anchorLabel, columnSortAxes('group-anchor', tierAxes), 'group-anchor') : null;
    const anchorHeader = anchorInner != null ? `<span class="group-anchor">${anchorInner}</span>` : '';
    const colHeaders = cols.map(c => {
      const owned = (c.sort !== false && c.key in tierAxes) ? [c.key] : [];
      return `<span class="group-col" data-col="${esc(c.key)}">${hdr(c.label, owned, c.key)}</span>`;
    }).join('');
    // An anchor owns the entry axis, so the Entries column drops it (keeping just
    // its min/max-score axes) to avoid both columns offering an Entry sort.
    const entriesAxes = anchorLabel
      ? columnSortAxes('group-entries', tierAxes).filter(k => k !== 'entry')
      : columnSortAxes('group-entries', tierAxes);
    return `<div class="group-headers entry-headers-font">
      <span class="group-rownum"></span>
      <span class="group-count">${countInner}</span>
      ${anchorHeader}
      ${colHeaders}
      <span class="group-entries-label">${hdr('Entries', entriesAxes, 'group-entries')}</span>
    </div>`;
  }
  return `<div class="entry-headers entry-headers-font">
      <span></span>
      <span class="col-entry">${hdr('Entry', columnSortAxes('col-entry', tierAxes), 'col-entry')}</span>
      <span class="col-len">${hdr('Length', columnSortAxes('col-len', tierAxes), 'col-len')}</span>
      <span class="col-score">${hdr('Score', columnSortAxes('col-score', tierAxes), 'col-score')}</span>
      <span class="col-comment">${hdr('Comment', columnSortAxes('col-comment', tierAxes), 'col-comment')}</span>
      <span class="col-source">Sources</span>
    </div>`;
}

export function onSortHeaderActivate(e) {
  const cell = e.target.closest('[data-sort-axes]');
  if (!cell) return;
  if (e.type === 'keydown') {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
  }
  const extend = e.shiftKey || e.ctrlKey || e.altKey || e.metaKey;
  const owned = cell.dataset.sortAxes.split(' ');
  if (owned.length > 1) {
    SortMenu.open(cell, owned, extend);
    return;
  }
  const scroller = getEntriesScroller();
  if (extend) {
    scroller?.applySortList(extendSortList(AppView.sortList, owned[0], owned));
  } else {
    const { key, dir } = nextSortForColumn(owned, AppView.sortKey, AppView.sortDir);
    scroller?.applySort(key, dir);
  }
  // applySort rebuilds the header, destroying the activated cell — refocus its
  // replacement so keyboard focus isn't silently dropped to <body>.
  if (e.type === 'keydown') document.querySelector(`.sticky-stack [data-sort-col="${CSS.escape(cell.dataset.sortCol)}"]`)?.focus();
}

// rerenderRows rebuilds only the tool rows, so a stack edit that flips chain
// rows ⇄ group rows leaves the column headers stale until this runs.
export function rebuildEntryHeaders() {
  const el = document.querySelector('.sticky-stack .entry-headers, .sticky-stack .group-headers');
  if (el) el.outerHTML = buildEntryHeadersHTML();
}
