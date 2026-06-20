'use strict';

// ─── Entries table ─────────────────────────────────────────────────────────────
//
// The virtual scroller, atom/group popovers, and the sort/projection logic that
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
import { displayOf, projectRangesToDisplay, toNorm, buildUserWlEntry } from '../engine/norm.js';
import { planEntryWrite } from '../engine/edit-plan.js';
import { parseRange } from '../engine/range.js';
import { renderHighlightedText } from '../engine/search.js';
import { TOOLS } from '../engine/tools.js';
import {
  isFilterOnlyChain, isGroupChain, rowLastEntry,
  bottomLineAtoms, rowSetAtoms, applyScoreRangeToRows,
} from '../engine/executor.js';
import {
  compareItems, compareValues, groupSortAxes, GROUP_SORT_AXES,
  activeGroupColumns, activeGroupAnchorLabel,
} from '../engine/group-sort.js';
import { compileFlatHighlighters } from '../engine/flat-highlight.js';
import { state, getEditsWordlist } from '../data/state.js';
import { getTrashScore } from '../data/serialize.js';
import { rescoreEntry } from '../engine/rescore.js';
import { buildScoreBadgeHTML, buildScoreCellHTML } from '../model/score-display.js';
import { showToast } from './toasts.js';
import { AppView } from './app-view.js';
import { ToolStack } from './tool-stack.js';
import { buildWordlistNameIconHTML } from './scope-selector.js';
import { getDraftRescoreRules } from './rescore-editor.js';
import { buildTrashIconHTML } from './components.js';
import {
  getEntriesScroller, rescorePreviewActive, refreshMergedScroller, setScope,
} from './rendering.js';
import { fetchWorkerRows, fetchWorkerGroups, fetchWorkerGroupChains, fetchWorkerAllRows, fetchWorkerAllGroups, lastCompletedRunId, fetchWorkerEditSeed, fetchWorkerProvenance } from './pipeline-worker.js';

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

export function popoverSeedDebug() {
  return AtomPopover.seedDebug();
}

export function popoverProvenanceDebug() {
  return AtomPopover.provenanceDebug();
}

export function configureEntriesTable({ navigate }) {
  if (navigate)              _navigate = navigate;
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

// Entry sort axes, split by sort tier — filter-only chains (empty stack or
// searches) sort by Entry / Length / Score; chains with a transform swap Score
// for Min score / Max score. Entry and Length project off the *first* atom —
// the merged-wordlist entry the row grew from — so the table keeps its order when
// a tool is added: a filter or 1-output transform leaves every first atom in
// place, so the rows can't reshuffle. Min/Max project across every atom.
//
// Each axis declares its primary projection and a fixed-direction tiebreaker
// chain — when the primary ties, fall to whichever direction surfaces the
// most interesting rows first (longer > shorter, higher score > lower), with
// alphabetical asc as the final stable tiebreaker. Flipping the user-level
// asc/desc toggle reverses only the primary; tiebreakers keep their declared
// direction, so "score asc" still shows the longest among the lowest-scoring
// rows first instead of letting short junk float to the top of a tied bucket.
//
// A multi-output transform (anagram) branches one input into rows that share
// their whole first atom; rowChainTail breaks those ties by the later atoms.
const rowFirstEntry = r => r.atoms[0].wlEntry;
export const rowMinScore   = r => Math.min(...r.atoms.map(a => a.wlEntry.score));
export const rowMaxScore   = r => Math.max(...r.atoms.map(a => a.wlEntry.score));
// Later atoms joined with a low separator: a string compare then orders them
// atom-by-atom, since every row in a run carries the same atom count.
const rowChainTail  = r => r.atoms.slice(1).map(a => a.wlEntry.norm).join('\u0000');
export { compareItems, compareValues, activeGroupColumns };
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
  },
};
export const DEFAULT_SORT_BY_TIER = { single: 'entry', multi: 'entry', group: 'entry' };
// An axis with no counterpart in the new tier maps across rather than
// snapping to the tier default, so a sort survives a tier round-trip.
// Length↔Count are deliberately paired despite measuring different things —
// both are descending magnitudes, and it keeps Length from being lost when
// a group tool toggles.
const SORT_AXIS_TIER_MAP = {
  'score': 'min-score', 'min-score': 'score', 'max-score': 'score',
  'length': 'count', 'count': 'length',
};
// The sort tier is single-atom when the chain is filter-only and multi-atom
// once a transform is in play — transforms are what give a row genuinely
// distinct atoms to sort across. Highlight-only repeat atoms don't promote the
// tier: they're all the same word and score.
export function chainSortTier(stack) {
  if (isGroupChain(stack)) return 'group';
  return isFilterOnlyChain(stack) ? 'single' : 'multi';
}
export function sortAxes(tier, stack = ToolStack.getStack()) {
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

// Order is load-bearing: the first surviving axis is the column's canonical
// pick, consumed far away as nextSortForColumn's ownedAxes[0].
const COLUMN_AXIS_CANDIDATES = {
  'col-entry':     ['entry'],
  'col-len':       ['length'],
  'col-score':     ['score', 'min-score', 'max-score'],
  'group-count':   ['count'],
  'group-anchor':  ['entry', 'length', 'score'],
  'group-entries': ['entry'],
};
export function columnSortAxes(colKind, tierAxes) {
  return (COLUMN_AXIS_CANDIDATES[colKind] || []).filter(k => k in tierAxes);
}
export function nextSortForColumn(ownedAxes, curKey, curDir) {
  if (ownedAxes.includes(curKey)) return { key: curKey, dir: curDir === 'asc' ? 'desc' : 'asc' };
  return { key: ownedAxes[0], dir: 'asc' };
}

// Run synchronously on stack mutation and URL load: the sort tier follows
// the stack, and settling it lazily in the async render let the URL builder
// read a stale axis. A real cross-tier counterpart (Score ⇄ Min score) keeps
// the user's direction; a fallback to the tier default resets it too.
export function reconcileSort(stack) {
  const tier = chainSortTier(stack);
  const axes = sortAxes(tier, stack);
  let key = AppView.sortKey;
  let dir = AppView.sortDir;
  if (!(key in axes)) {
    const mapped = SORT_AXIS_TIER_MAP[key];
    if (mapped && mapped in axes) {
      key = mapped;
    } else {
      key = DEFAULT_SORT_BY_TIER[tier];
      dir = 'asc';
    }
  }
  AppView.setSort(key, dir);
}

const ENTRY_SLOT_CAP = 21;

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
  return headerLabelPx(label + ' ↑');
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

  _clearSizer() {
    while (this.sizer.firstChild) this.sizer.removeChild(this.sizer.firstChild);
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

function buildGroupAnchorHTML(anchor) {
  if (!anchor) return `<span class="group-anchor"></span>`;
  const displayed = displayOf(anchor);
  const truncTitle = displayed.length > ENTRY_SLOT_CAP ? ` title="${esc(displayed)}"` : '';
  return `<span class="group-anchor">` +
    `<span class="atom" data-atom-role="anchor">` +
      `<span class="atom-entry"${truncTitle}>${esc(displayed)}</span>` +
      `<span class="atom-score">${buildScoreBadgeHTML(anchor.score)}</span>` +
    `</span>` +
  `</span>`;
}

function buildGroupChainHTML(chain, ci) {
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
    const text = renderHighlightedText(displayed, projected);
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

  function mount() {
    el = document.createElement('div');
    el.className = 'group-popover';
    el.hidden = true;
    document.body.appendChild(el);

    // AtomPopover is passed `el` as its row so its dismiss logic treats clicks
    // within this list as in-bounds — letting you edit one hidden word, then
    // another, without it closing between.
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
      AtomPopover.open(atom.wlEntry, el, scroller, target, field);
    });
  }

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    anchor = group = scroller = chainCache = null;
    runId = null;
    rendered = 0;
    fetchSeq++;   // invalidate any in-flight fetch's fill so a late reply is a no-op
    if (io) { io.disconnect(); io = null; }
    sentinel = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  // Neither a chip re-click (routed through toggle) nor a click into the
  // AtomPopover anchored on a word here should dismiss this list. mousedown,
  // not pointerdown, so a touch-drag that scrolls the table leaves it open.
  function onOutside(e) {
    if (el.contains(e.target)) return;
    if (e.target.closest('.group-more, #atom-popover')) return;
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
  return { mount, toggle, close };
})();

export class EntriesScroller extends BaseVirtualScroller {
  constructor(host) {
    super(host, 'entries-table-rows');
    this.toolbar = document.getElementById('stats-bar-sort');
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
    // When _flat (the filter-only tier), allEntries/entries hold an Int32Array of
    // the worker's corpus indices (positions for the windowed fetch), NOT
    // ChainRow[]; _flatScores is parallel, and rows arrive rich from the worker's
    // fetchRows for only the visible window. The transform/group tiers leave _flat
    // false and keep the row arrays above.
    this._flat = false;
    this._flatScores = null;
    this._flatViewScores = null;
    this._workerStats = null;
    this._workerHistogramCounts = null;
    this._workerGroupWidthHints = null;
    this._workerChainCount = null;
    this._workerGroupCount = null;
    this._workerFiltered = false;
    this._ranAgainstOwned = false;
    this._existsInScope = null;
    this._rebindQuery = null;
    this._rebindEntry = null;
    this._rebindExists = null;
    this._widthHints = null;
    this._flatHighlighters = [];
    this.sortKey = AppView.sortKey;
    this.sortDir = AppView.sortDir;
    this.scoreRange = AppView.scoreRange;
    this._scoreIntervals = this.scoreRange ? parseRange(this.scoreRange) : null;
    this.showSource = false;
    this._onSave = null;
    this._onDeleteRow = null;
    this.onFilterChange = null;
    // Sorted view of allEntries cached across keystrokes. Filter preserves
    // order, so a sorted source means the filter result is already sorted —
    // no per-keystroke re-sort needed. Invalidated when allEntries change.
    this._sortedSource = null;
    this._sortedSourceKey = null;
    this._sortedSourceDir = null;

    this._winCache = new Map();
    this._winCacheRunId = null;
    this._firstRows = null;
    this._winReqSeq = 0;
    this._fetchOutstanding = 0;
    this._richRowsConsumed = 0;

    // The grouped tier's _winCache: Map<absolute group index, decoded group>.
    this._groupWinCache = new Map();
    this._groupWinCacheRunId = null;
    this._firstGroups = null;
    this._groupReqSeq = 0;
    this._groupFetchOutstanding = 0;

    this.sizer.addEventListener('click', e => {
      const moreBtn = e.target.closest('.group-more');
      if (moreBtn) {
        const gr = moreBtn.closest('.group-row');
        const g = this._groupAt(gr.dataset.idx);
        if (g) GroupMorePopover.toggle(g, moreBtn, this);
        return;
      }
      const target = e.target.closest('.atom-entry, .atom-score, .atom-comment');
      if (!target) return;
      let row, wlEntry;
      const groupRow = target.closest('.group-row');
      if (groupRow) {
        const atomEl = target.closest('.atom');
        if (!atomEl) return;
        row = groupRow;
        const g = this._groupAt(groupRow.dataset.idx);
        if (atomEl.dataset.atomRole === 'anchor') {
          wlEntry = g?.anchor || null;
        } else {
          const chainEl = target.closest('.group-chain');
          if (!chainEl) return;
          wlEntry = g?.chains[parseInt(chainEl.dataset.chain, 10)]
                    ?.atoms[parseInt(atomEl.dataset.atom, 10)]?.wlEntry;
        }
      } else {
        row = target.closest('.entry-row');
        const atomEl = target.closest('.atom');
        if (!row || !atomEl) return;
        wlEntry = this._flat
          ? row._wlEntry
          : this.entries[parseInt(row.dataset.idx, 10)]?.atoms[parseInt(atomEl.dataset.atom, 10)]?.wlEntry;
      }
      if (!wlEntry) return;
      const field = target.classList.contains('atom-score') ? 'score'
                  : target.classList.contains('atom-comment') ? 'comment'
                  : null;
      if (field === 'score' && scoreQuickPickable()) {
        ScorePicker.open(wlEntry, row, this, target);
        return;
      }
      AtomPopover.open(wlEntry, row, this, target, field);
    });

    this._buildToolbar();
  }

  setEntries(result, atomCount = this.atomCount, sortTier = this.sortTier) {
    GroupMorePopover.close();
    ScorePicker.close();
    this._setChainShape(atomCount, sortTier);
    this._ingestResult(result);
    this._invalidateSortCache();
    this._buildToolbar();
    this._sortAndRender();
  }

  updateEntries(result, atomCount = this.atomCount, sortTier = this.sortTier) {
    ScorePicker.close();
    const tierChanged = this._setChainShape(atomCount, sortTier);
    this._ingestResult(result);
    this._invalidateSortCache();
    if (tierChanged) { this._buildToolbar(); rebuildEntryHeaders(); }
    this._sortAndRender();
    AtomPopover.rebindEntry(this);
  }

  _ingestResult(result) {
    this._flat = !!result.flat;
    if (this._flat) {
      this._flatScores = result.scores;
      this._workerStats = result.stats ?? null;
      this._workerHistogramCounts = result.histogramCounts ?? null;
      this._workerFiltered = !!result.filtered;
      this._ranAgainstOwned = !!result.ranAgainstOwned;
      this._existsInScope = result.existsInScope ?? null;
      this._rebindQuery = result.rebindQuery ?? null;
      this._rebindEntry = result.rebindEntry ?? null;
      this._rebindExists = result.rebindExists ?? null;
      this._widthHints = result.widthHints;
      this._flatHighlighters = compileFlatHighlighters(ToolStack.getStack());
      this.allEntries = result.indices;
      this._firstRows = result.firstRows ?? null;
    } else {
      this._flatScores = null;
      // The grouped worker stats/counts are FILTERED (the worker applies the score
      // range), and its histogram is UNFILTERED — _workerFiltered carries that to
      // the rendering.js guard so it consumes the worker's filtered Min/Max under a
      // range instead of recomputing.
      const g = !!result.grouped;
      this._workerStats = g ? (result.stats ?? null) : null;
      this._workerHistogramCounts = g ? (result.histogramCounts ?? null) : null;
      this._workerGroupWidthHints = g ? (result.groupWidthHints ?? null) : null;
      this._workerChainCount = g ? (result.chainCount ?? null) : null;
      this._workerGroupCount = g ? (result.groupCount ?? null) : null;
      this._workerFiltered = g ? !!result.filtered : false;
      this._ranAgainstOwned = false;
      this._existsInScope = null;
      this._rebindQuery = null;
      this._rebindEntry = null;
      this._rebindExists = null;
      if (g) {
        // result.rows is only the first WINDOW of groups, not all of them. Leave
        // allEntries empty so a consumer can't iterate a partial window as the full
        // group list (silently wrong counts/rebind over a large result); the render
        // and sync rebind read _groupWinCache (keyed by absolute index) instead.
        this._firstGroups = result.rows;
        this.allEntries = [];
      } else {
        this._firstGroups = null;
        this.allEntries = result.rows;
      }
    }
  }

  _setChainShape(atomCount, sortTier) {
    const tierChanged = sortTier !== this.sortTier;
    this.atomCount = atomCount;
    this.sortTier = sortTier;
    this.sortKey = AppView.sortKey;
    this.sortDir = AppView.sortDir;
    this._resolved = true;
    return tierChanged;
  }

  setScoreRange(range) {
    const next = range || '';
    if (next === this.scoreRange) return;
    this.scoreRange = next;
    this._scoreIntervals = next ? parseRange(next) : null;
    this._invalidateSortCache();
    if (this._workerOwnsOrder()) refreshMergedScroller();
    else this._sortAndRender();
  }

  // The flat and grouped tiers arrive pre-sorted + pre-filtered from the worker, so
  // a sort-axis or score-range change must re-run the pipeline rather than reorder
  // locally — main holds no comparator that would reproduce the worker's order.
  _workerOwnsOrder() {
    return this._flat || this.sortTier === 'group';
  }

  _invalidateSortCache() {
    this._sortedSource = null;
  }

  _buildToolbar() {
    if (!this.toolbar) return;
    const arrow = this.sortDir === 'asc' ? '↑' : '↓';
    const options = Object.entries(sortAxes(this.sortTier))
      .map(([key, { label }]) => `<option value="${key}"${key === this.sortKey ? ' selected' : ''}>${label}</option>`)
      .join('');
    this.toolbar.innerHTML = `
      Sort by
      <select class="sort-axis-select">${options}</select>
      <button class="sort-dir-btn" type="button" title="Toggle direction" aria-label="Toggle direction">${arrow}</button>`;
    this.toolbar.querySelector('.sort-axis-select').addEventListener('change', e => {
      if (this.sortKey !== e.target.value) this.applySort(e.target.value, this.sortDir);
    });
    this.toolbar.querySelector('.sort-dir-btn').addEventListener('click', () => {
      this.applySort(this.sortKey, this.sortDir === 'asc' ? 'desc' : 'asc');
    });
  }

  // rebuildEntryHeaders looks redundant here — its only other caller fires on a
  // tier flip — but it's what re-syncs the header arrow on same-tier sort changes.
  applySort(key, dir) {
    this.sortKey = key;
    this.sortDir = dir;
    AppView.setSort(key, dir);
    this._buildToolbar();
    rebuildEntryHeaders();
    if (this._workerOwnsOrder()) refreshMergedScroller();
    else this._sortAndRender();
    _navigate();
  }

  _sortAndRender() {
    this._revealEmpty = false;
    clearTimeout(this._emptyRevealTimer);
    this._emptyRevealTimer = null;
    this.entries = this._getSortedSource();
    this._computeSlotWidths();
    this._render();
    this.onFilterChange?.();
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
    if (this._sortedSource
        && this._sortedSourceKey === this.sortKey
        && this._sortedSourceDir === this.sortDir
        && this._sortedSourceRange === this.scoreRange) {
      return this._sortedSource;
    }

    // The worker pre-sorts AND pre-filters both the flat and the grouped tiers (a
    // sort-axis or score-range change re-runs the pipeline), so they arrive in final
    // order, ready to render. The single/multi tiers still sort + filter locally.
    let sorted;
    if (this._flat) {
      this._flatViewScores = this._flatScores;
      sorted = this.allEntries;
    } else if (this.sortTier === 'group') {
      // Only the inline first window — empty iff groupCount is 0, the invariant
      // _sortAndRender's empty-state check keys on. The render sizes from groupCount
      // and pulls visible groups from _groupWinCache.
      sorted = this._firstGroups ?? [];
    } else {
      const filtered = applyScoreRangeToRows(this.allEntries, this._scoreIntervals, false);
      const axis = sortAxes(this.sortTier)[this.sortKey];
      sorted = axis
        ? [...filtered].sort((a, b) => compareItems(a, b, axis, this.sortDir))
        : filtered;
    }

    this._sortedSource = sorted;
    this._sortedSourceKey = this.sortKey;
    this._sortedSourceDir = this.sortDir;
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
    if (this.sortTier === 'group') { this._computeGroupSlotWidths(); return; }
    if (this._flat) { this._computeFlatSlotWidths(); return; }
    // Count and entry slot widths track the unfiltered result so columns
    // don't shift sideways when a search or score filter cuts the visible
    // set down. Len/score slots stay tied to the filtered view since their
    // widths are tiny and effectively constant in practice. Every atom of
    // every row measures against the same tracks so the eye reads down them.
    const total = this.allEntries.length;
    const countDigits = total > 0 ? String(total).length : 1;
    const ch = measureMonoChPx();
    // A glyph atom renders `<glyph> ` ahead of its entry, so its slot need is
    // entry chars + the glyph prefix. Cap the entry text at ENTRY_SLOT_CAP but
    // let the glyph spill past the cap — it's fixed overhead, not entry text.
    const glyphCh = measureAtomGlyphPx() / ch;
    let maxLen = 0, maxLenDigits = 1, maxScoreDigits = 1, hasHighlight = false;
    for (const row of this.allEntries) {
      for (const atom of row.atoms) {
        const len = displayOf(atom.wlEntry).length + (atom.glyph ? glyphCh : 0);
        if (len > maxLen) maxLen = len;
        if (!hasHighlight && atom.highlights?.length) hasHighlight = true;
      }
    }
    const draftRules = rescorePreviewActive() ? getDraftRescoreRules() : null;
    let maxRawDigits = 0;
    for (const row of this.entries) {
      for (const atom of row.atoms) {
        const we = draftRules ? previewedEntry(atom.wlEntry, draftRules) : atom.wlEntry;
        const d = String(we.norm.length).length;
        if (d > maxLenDigits) maxLenDigits = d;
        const sd = String(we.score).length;
        if (sd > maxScoreDigits) maxScoreDigits = sd;
        if (we.rawScore != null && we.rawScore !== we.score) {
          maxRawDigits = Math.max(maxRawDigits, String(we.rawScore).length);
        }
      }
    }
    // A `<mark>` highlight splits the entry into separate text runs, each
    // rounded to a whole pixel independently — the rounding can accumulate
    // past a column sized to the bare text. Reserve a character of slack
    // whenever the result carries highlights so it never clips a fitting entry.
    // Then round up and pad a pixel: length × average-char-width lands a
    // sub-pixel under the real rendered string, which Safari/iPad clips at the
    // grid track's sub-pixel boundary (Chrome rounds the other way and fits).
    const entryContentW = Math.ceil(
      Math.min(maxLen, ENTRY_SLOT_CAP + glyphCh) * ch + (hasHighlight ? ch : 0)
    ) + 1;
    const target = this.host.closest('#detail-panel') || this.sizer;
    target.style.setProperty('--count-w', `${(countDigits + 1) * ch}px`);
    // Floored to the header label so it never overflows its column.
    target.style.setProperty('--entry-w', `${Math.max(entryContentW, sortableHeaderPx('Entry'))}px`);
    target.style.setProperty('--len-w', `${Math.max(maxLenDigits * ch, sortableHeaderPx('Len'))}px`);
    const arrowPrefixW = maxRawDigits ? maxRawDigits * ch + measureScoreArrowPx() : 0;
    target.style.setProperty('--score-w', `${Math.max(badgeWidthPx(maxScoreDigits) + arrowPrefixW, sortableHeaderPx('Score'))}px`);
    target.style.setProperty('--source-max', `${22 * ch}px`);
  }

  _computeFlatSlotWidths() {
    const total = this.allEntries.length;
    const countDigits = total > 0 ? String(total).length : 1;
    const ch = measureMonoChPx();
    const { maxDisplayLen, maxLenDigits, maxScoreDigits, maxRawDigits: rawHint } = this._widthHints;
    const hasHighlight = this._flatHighlighters.length > 0;
    // rawHint is committed-only; a draft can show any row's true raw, up to
    // maxScoreDigits wide, so take the max or a buffered arrow clips here.
    const maxRawDigits = rescorePreviewActive() ? Math.max(rawHint ?? 0, maxScoreDigits) : 0;

    const entryContentW = Math.ceil(
      Math.min(maxDisplayLen, ENTRY_SLOT_CAP) * ch + (hasHighlight ? ch : 0)
    ) + 1;
    const target = this.host.closest('#detail-panel') || this.sizer;
    target.style.setProperty('--count-w', `${(countDigits + 1) * ch}px`);
    target.style.setProperty('--entry-w', `${Math.max(entryContentW, sortableHeaderPx('Entry'))}px`);
    target.style.setProperty('--len-w', `${Math.max(maxLenDigits * ch, sortableHeaderPx('Len'))}px`);
    const arrowPrefixW = maxRawDigits ? maxRawDigits * ch + measureScoreArrowPx() : 0;
    target.style.setProperty('--score-w', `${Math.max(badgeWidthPx(maxScoreDigits) + arrowPrefixW, sortableHeaderPx('Score'))}px`);
    target.style.setProperty('--source-max', `${22 * ch}px`);
  }

  _statsViewEntries() {
    if (this._flat) return this._flatViewScores ?? this._flatScores;
    // The grouped tier ships stats off the worker; the entries here are only the
    // window, so never bottom-line them as if they were the full result.
    if (this.sortTier === 'group') return [];
    return bottomLineAtoms(this.entries);
  }

  _histogramEntries() {
    if (this._flat) return this._flatScores;
    if (this.sortTier === 'group') return [];
    return bottomLineAtoms(this.allEntries);
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

  _render() {
    if (this.sortTier === 'group') return this._renderGroups();
    const n = this.entries.length;
    const stride = this._rowStride();
    this.sizer.style.height = this._sizerHeightFor(n * stride) + 'px';
    this._renderFooter(n);

    const { start, end } = this._visibleRange(n);
    this._clearSizer();

    // The flat tier is always windowed post-flip — main holds no corpus, so its
    // rows arrive rich from the worker's fetchRows; the transform/group tiers keep
    // their resident ChainRow[] and render directly.
    const windowed = this._flat;
    if (windowed) this._invalidateWinCacheIfStale();

    const preview = rescorePreviewActive();
    const draftRules = preview ? getDraftRescoreRules() : null;
    const activeNorm = AtomPopover.activeNorm(this);
    let nextActiveRow = null;
    let minMiss = -1, maxMiss = -1;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      let row;
      if (windowed) {
        const chainRow = this._windowedRowOrNull(i);
        if (chainRow) {
          row = this._renderChainRow(chainRow, i, activeNorm, preview, draftRules);
        } else {
          row = this._skeletonRow(i);
          if (minMiss < 0) minMiss = i;
          maxMiss = i;
        }
      } else {
        row = this._renderChainRow(this.entries[i], i, activeNorm, preview, draftRules);
      }
      row.style.top = (i * stride) + 'px';
      if (row.classList.contains('active')) nextActiveRow = row;
      frag.appendChild(row);
    }
    this.sizer.appendChild(frag);
    if (nextActiveRow) AtomPopover.rebindRow(nextActiveRow);

    if (windowed && minMiss >= 0) {
      const lo = Math.max(0, minMiss - VS_BUFFER);
      const hi = Math.min(n, maxMiss + 1 + VS_BUFFER);
      this._fetchWindow(lo, hi);
    }
    if (windowed) this._evictWinCache(start, end);
  }

  // A run change reindexes the corpus, so position-keyed cache entries name the
  // wrong rows — drop them when the run changes, then seed the cache from the
  // result's inline first window so the above-the-fold rows render without a
  // fetchRows round-trip (no skeleton flash for a result that fits on screen).
  _invalidateWinCacheIfStale() {
    const runId = lastCompletedRunId();
    if (runId !== this._winCacheRunId) {
      this._winCache.clear();
      this._winCacheRunId = runId;
      if (this._firstRows) {
        const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
        this._firstRows.forEach((row, i) =>
          this._winCache.set(i, this._richRowToChain(row, sourceById)));
      }
    }
  }

  // The keep-window strictly contains [start, end): the render reads cache[i] for
  // i in [start, end), so an entry evicted there would blank a visible row. Narrow
  // it past the viewport and rows silently go blank — keep WINDOW_CACHE_KEEP > 0.
  _evictWinCache(start, end) {
    const keepLo = start - WINDOW_CACHE_KEEP;
    const keepHi = end + WINDOW_CACHE_KEEP;
    if (this._winCache.size <= (end - start) + WINDOW_CACHE_KEEP * 3) return;
    for (const pos of this._winCache.keys()) {
      if (pos < keepLo || pos >= keepHi) this._winCache.delete(pos);
    }
  }

  _windowedRowOrNull(i) {
    return this._winCache.get(i) ?? null;
  }

  _richRowToChain(row, sourceById) {
    const wlEntry = {
      norm: row.norm,
      display: row.display,
      score: row.score,
      rawScore: row.rawScore,
      comment: row.comment,
      wordlist: sourceById.get(row.sourceId) ?? null,
    };
    // All atoms of a flat row are the same word (stacked highlighting searches),
    // so they share one wlEntry; each carries its own highlights/glyph slot.
    return {
      atoms: row.atoms.map(a => ({ wlEntry, highlights: a.highlights, glyph: a.glyph })),
    };
  }

  _skeletonRow(i) {
    const row = document.createElement('div');
    row.className = 'entry-row entry-row-font skeleton';
    row.innerHTML = `<span class="atom-count">${i + 1}.</span>`;
    return row;
  }

  _fetchWindow(lo, hi) {
    const runId = lastCompletedRunId();
    const seq = ++this._winReqSeq;
    this._fetchOutstanding++;
    fetchWorkerRows(runId, lo, hi).then(reply => {
      this._fetchOutstanding--;
      if (seq !== this._winReqSeq) return;            // superseded by a newer scroll
      if (runId !== lastCompletedRunId()) return;     // superseded by a newer run
      if (!reply) return;                             // timeout
      // Rebuilt per batch rather than memoized: an add/remove/reorder between
      // fetches would otherwise resolve sourceId to a stale wordlist object.
      const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
      for (let k = 0; k < reply.rows.length; k++) {
        this._richRowsConsumed++;
        this._winCache.set(reply.start + k, this._richRowToChain(reply.rows[k], sourceById));
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

  _renderChainRow(chainRow, i, activeNorm, preview, draftRules) {
    const atoms = chainRow.atoms;
    let isActive = false;
    let html = `<span class="atom-count">${i + 1}.</span>`;
    atoms.forEach((atom, ai) => {
      const { highlights, glyph } = atom;
      const wlEntry = draftRules ? previewedEntry(atom.wlEntry, draftRules) : atom.wlEntry;
      const { norm } = wlEntry;
      if (activeNorm && norm === activeNorm) isActive = true;
      const displayed = displayOf(wlEntry);
      const projected = projectRangesToDisplay(highlights, wlEntry);
      const glyphHTML = glyph ? `<span class="atom-glyph">${glyph} </span>` : '';
      const truncTitle = displayed.length > ENTRY_SLOT_CAP ? ` title="${esc(displayed)}"` : '';
      const entryCell =
        `<span class="atom-entry"${truncTitle}>${glyphHTML}${renderHighlightedText(displayed, projected)}</span>`;
      const scoreInner = buildScoreCellHTML(wlEntry, preview);
      const commentText = wlEntry.comment || '';
      const sourceWl = wlEntry.wordlist;
      const sourceHTML = sourceWl ? buildWordlistNameIconHTML(sourceWl, { bold: false }) : '';
      const sourceTitle = sourceWl ? ` title="${esc(sourceWl.name)}"` : '';
      const sourceCell = this.showSource
        ? `<span class="atom-source"${sourceTitle}>${sourceHTML}</span>`
        : '';
      html += `<span class="atom" data-atom="${ai}">` +
        entryCell +
        `<span class="atom-len">${norm.length}</span>` +
        `<span class="atom-score">${scoreInner}</span>` +
        `<span class="atom-comment"${commentText ? ` title="${esc(commentText)}"` : ''}>${esc(commentText)}</span>` +
        sourceCell +
        `</span>`;
    });

    const row = document.createElement('div');
    row.className = isActive ? 'entry-row entry-row-font active' : 'entry-row entry-row-font';
    row.dataset.idx = i;
    row.dataset.entry = rowLastEntry(chainRow).norm;
    row.innerHTML = html;
    if (this._flat) row._wlEntry = atoms[0].wlEntry;
    return row;
  }

  _renderGroups() {
    // Size from the TOTAL group count (shipped), not the resident window — the
    // worker ships only the first window of group rows and serves the rest on scroll.
    const n = this._groupCount();
    const stride = this.atomCount * ROW_HEIGHT;
    this.sizer.style.height = this._sizerHeightFor(n * stride) + 'px';
    this._renderFooter(n);
    const { start, end } = this._visibleRange(n);
    this._clearSizer();
    this._invalidateGroupWinCacheIfStale();
    const activeNorm = AtomPopover.activeNorm(this);
    let nextActiveRow = null;
    const stack = ToolStack.getStack();
    const columns = activeGroupColumns(stack);
    const hasAnchor = !!activeGroupAnchorLabel(stack);
    const ctx = {
      monoCh: this._groupMonoCh || measureMonoChPx(),
      glyphPx: this._groupGlyphPx || 0,
      slot: Math.max(0, this.host.clientWidth - (this._groupChromeWidth || 0)),
    };
    let minMiss = -1, maxMiss = -1;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const g = this._groupWinCache.get(i) ?? null;
      let row;
      if (g) {
        row = document.createElement('div');
        row.className = 'group-row entry-row-font';
        row.dataset.idx = i;
        row.innerHTML = this._renderGroupRowHTML(g, i, columns, hasAnchor, ctx);
        const matchesActive = activeNorm && (
          (g.anchor && g.anchor.norm === activeNorm) ||
          g.chains.some(c => c.atoms.some(a => a.wlEntry.norm === activeNorm))
        );
        if (matchesActive) {
          row.classList.add('active');
          nextActiveRow = row;
        }
      } else {
        row = this._skeletonGroupRow(i);
        if (minMiss < 0) minMiss = i;
        maxMiss = i;
      }
      row.style.top = (i * stride) + 'px';
      frag.appendChild(row);
    }
    this.sizer.appendChild(frag);
    if (nextActiveRow) AtomPopover.rebindRow(nextActiveRow);

    if (minMiss >= 0) {
      const lo = Math.max(0, minMiss - VS_BUFFER);
      const hi = Math.min(n, maxMiss + 1 + VS_BUFFER);
      this._fetchGroupWindow(lo, hi);
    }
    this._evictGroupWinCache(start, end);
  }

  // Mirrors _invalidateWinCacheIfStale: a run change re-orders the groups, so
  // absolute-index-keyed cache entries name the wrong groups — drop them, then
  // seed from the inline first window so above-the-fold rows render with no fetch.
  _invalidateGroupWinCacheIfStale() {
    const runId = lastCompletedRunId();
    if (runId !== this._groupWinCacheRunId) {
      this._groupWinCache.clear();
      this._groupWinCacheRunId = runId;
      if (this._firstGroups) {
        this._firstGroups.forEach((g, i) => this._groupWinCache.set(i, g));
      }
    }
  }

  _evictGroupWinCache(start, end) {
    const keepLo = start - WINDOW_CACHE_KEEP;
    const keepHi = end + WINDOW_CACHE_KEEP;
    if (this._groupWinCache.size <= (end - start) + WINDOW_CACHE_KEEP * 3) return;
    for (const pos of this._groupWinCache.keys()) {
      if (pos < keepLo || pos >= keepHi) this._groupWinCache.delete(pos);
    }
  }

  _skeletonGroupRow(i) {
    const row = document.createElement('div');
    row.className = 'group-row entry-row-font skeleton';
    row.innerHTML = `<span class="group-rownum">${i + 1}.</span>`;
    return row;
  }

  _fetchGroupWindow(lo, hi) {
    const runId = lastCompletedRunId();
    const seq = ++this._groupReqSeq;
    this._groupFetchOutstanding++;
    fetchWorkerGroups(runId, lo, hi).then(reply => {
      this._groupFetchOutstanding--;
      if (seq !== this._groupReqSeq) return;          // superseded by a newer scroll
      if (runId !== lastCompletedRunId()) return;     // superseded by a newer run
      if (!reply) return;                             // timeout
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
    const chainsHTML = [];
    for (let ci = 0; ci < visibleCount; ci++) {
      chainsHTML.push(buildGroupChainHTML(chains[ci], ci));
    }
    const anchorCell = hasAnchor ? buildGroupAnchorHTML(group.anchor) : '';
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
    const rownumW = measureTextWidth(hints.groupCount + '.', 'entry-headers-font');
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
    // Must be the full-chains fetch, not fetchWorkerGroups: that ships each group's
    // firstChains window only, so any group over the window silently exports
    // truncated — data loss on an explicit export with no visible symptom.
    if (this.sortTier === 'group') {
      const reply = await fetchWorkerAllGroups(lastCompletedRunId());
      return reply ? reply.groups : [];
    }
    if (!this._flat) return this.entries;

    // The flat tier holds only positions, so its rich rows come from the worker.
    // A null reply (timeout) leaves nothing to format — main has no corpus to
    // fall back on — so export the empty set rather than throwing.
    const reply = await fetchWorkerAllRows(lastCompletedRunId());
    if (!reply) return [];

    const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
    return reply.rows.map(r => this._richRowToChain(r, sourceById));
  }

  // The match guard is load-bearing: the shipped answer resolves whatever target
  // rode this run's dispatch, so on a mismatch (the popover re-targeted between
  // dispatch and rebind) it names the wrong entry. Post-flip there's no local
  // corpus to fall back to, so a mismatch returns the not-found answer and the
  // popover reconciles on the next run's rebindEntry.
  _rebindAnswerApplies(norm, display) {
    const applies = !!(this._ranAgainstOwned && this._rebindQuery
      && this._rebindQuery.norm === norm && (this._rebindQuery.display ?? null) === (display ?? null));
    if (applies) rebindAnswersConsumed++;
    return applies;
  }

  // The rows the synchronous rebind search walks. Grouped windows, so allEntries is
  // empty there — search the cached groups instead. The popover only ever anchors
  // on a rendered (hence cached) group, so its target is always reachable here.
  _rebindSearchRows() {
    return this.sortTier === 'group' ? this._groupWinCache.values() : this.allEntries;
  }

  resultHasEntry(wlEntry) {
    if (this._flat) {
      if (this._rebindAnswerApplies(wlEntry.norm, wlEntry.display ?? null)) return this._rebindExists;
      return false;
    }
    for (const a of rowSetAtoms(this._rebindSearchRows())) {
      if (a.wlEntry === wlEntry) return true;
    }
    return false;
  }

  findResultEntry(norm, display) {
    if (this._flat) {
      if (this._rebindAnswerApplies(norm, display)) return this._rebindEntry;
      return null;
    }
    let normFallback = null;
    for (const a of rowSetAtoms(this._rebindSearchRows())) {
      if (a.wlEntry.norm !== norm) continue;
      if (a.wlEntry.display === display) return a.wlEntry;
      if (!normFallback) normFallback = a.wlEntry;
    }
    return normFallback;
  }
}

// ─── Shared popover helpers ───────────────────────────────────────────────────

// Desktop only — callers guard the mobile case, where CSS docks the panel as a
// bottom sheet and inline coordinates must be left unset.
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

// ─── Atom popover ─────────────────────────────────────────────────────────────

export const AtomPopover = (() => {
  let el = null;
  let activeRow = null;
  let activeAnchor = null;
  let activeWlEntry = null;
  let activeSeed = null;
  let activeScroller = null;
  let activeMode = 'edit';
  let stagedDelete = null;
  let stagedAdopt = false;
  // Monotonic token for an in-flight scoped-seed worker query; a re-open or close
  // bumps it so a late reply for a stale popover is dropped rather than re-seeding
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
  let provQueriesFired = 0;
  let provRepliesApplied = 0;
  function provenanceDebug() { return { provQueriesFired, provRepliesApplied }; }
  // The popover element focus is in or transitioning to. Tracked via capture-
  // phase blur (relatedTarget says where focus is *headed*) because an
  // edit-commit re-render runs in a microtask between blur and focusin, when
  // document.activeElement is transiently <body> — reading it then would
  // wrongly close the popover or clobber an input mid-tab.
  let focusEl = null;

  function ensureElement() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'atom-popover';
    el.setAttribute('hidden', '');
    el.addEventListener('click', e => {
      if (e.target.closest('.dialog-close-btn')) { close(); return; }
      if (e.target.closest('.atom-pop-prov-untrash')) { toggleStagedAdopt(); return; }
      const trash = e.target.closest('.atom-pop-prov-trash');
      if (trash) { toggleStagedDelete(trash.dataset.norm, trash.dataset.display); return; }
      if (e.target.closest('.atom-pop-adopt-btn')) toggleStagedAdopt();
    });
    el.addEventListener('focus', e => { focusEl = e.target; }, true);
    el.addEventListener('blur', e => {
      focusEl = e.relatedTarget && el.contains(e.relatedTarget) ? e.relatedTarget : null;
    }, true);
    document.body.appendChild(el);
    return el;
  }

  function isOpen() { return el && !el.hasAttribute('hidden'); }

  function close() {
    if (!el || el.hasAttribute('hidden')) return;
    el.setAttribute('hidden', '');
    if (activeRow) activeRow.classList.remove('active');
    activeRow = null;
    activeAnchor = null;
    activeWlEntry = null;
    activeSeed = null;
    activeScroller = null;
    activeMode = 'edit';
    focusEl = null;
    stagedDelete = null;
    stagedAdopt = false;
    seedQueryToken++;
    provQueryToken++;
    shippedProvRows = null;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeydown, true);
  }

  function containsFocus() {
    return isOpen() && focusEl !== null && el.contains(focusEl);
  }

  function onDocMouseDown(e) {
    if (!isOpen()) return;
    if (el.contains(e.target)) return;
    if (activeRow && activeRow.contains(e.target)) return;
    close();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  // Only the scoped case needs the worker: the merge winner there can be a
  // higher-priority list main can't read without its corpus. Merged (clicked IS
  // the winner) seeds synchronously from the clicked row.
  function needsWorkerSeed(clicked) {
    return state.selected !== MERGED_ID && clicked?.norm != null;
  }

  function open(wlEntry, rowEl, scroller, anchorEl, focusField = 'score', mode = 'edit') {
    ScorePicker.close();
    const popover = ensureElement();
    if (activeRow) activeRow.classList.remove('active');
    activeMode = mode;
    activeWlEntry = wlEntry;
    activeRow = rowEl;
    activeScroller = scroller;
    if (rowEl) rowEl.classList.add('active');
    shippedProvRows = null;
    stagedAdopt = false;

    // Seed from the clicked row: in the merged view it IS the merge winner; a
    // scoped view holds a losing value, refined below by refineScopedSeed.
    const seed = seedFromWinnerRow(wlEntry, getEditsWordlist() != null && wlEntry.wordlist === getEditsWordlist());

    popover.innerHTML = renderHTML(wlEntry, seed);
    popover.removeAttribute('hidden');
    activeAnchor = anchorEl ?? rowEl;
    position(activeAnchor);
    wireFields();

    fireInitialProvenanceQuery(seed.entry);
    if (needsWorkerSeed(wlEntry)) refineScopedSeed(wlEntry, focusField);

    const focusSel = focusField === 'entry'   ? '.entry-input'
                   : focusField === 'comment' ? '.comment-input'
                   : '.score-input';
    const input = popover.querySelector(focusSel);
    input?.focus();
    if (focusField !== null) input?.select();

    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  // The seed is a correctness input — a save writes FROM it into My Edits — so the
  // fields stay disabled until the worker's winner refines the placeholder; a save
  // against the un-refined scoped value would be wrong. A null reply (stale/disabled
  // scope) keeps the clicked placeholder.
  function refineScopedSeed(clicked, focusField) {
    const token = ++seedQueryToken;
    seedQueriesFired++;
    setFieldsDisabled(true);
    fetchWorkerEditSeed(clicked.norm, clicked.display ?? null).then(winner => {
      if (token !== seedQueryToken || !isOpen() || activeWlEntry !== clicked) return;
      if (winner) {
        const src = state.sources.find(s => s.dbKey === winner.sourceId) || null;
        const row = { ...winner, wordlist: src };
        activeSeed = seedFromWinnerRow(row, src != null && src === getEditsWordlist());
        applySeedToFields(activeSeed, focusField);
        seedWinnersApplied++;
      }
      setFieldsDisabled(false);
      refreshSaveEnabled();
    });
  }

  function setFieldsDisabled(disabled) {
    for (const sel of ['.entry-input', '.score-input', '.comment-input', '.atom-pop-save']) {
      const node = el?.querySelector(sel);
      if (node) node.disabled = disabled;
    }
  }

  function applySeedToFields(seed, focusField) {
    const entryInp = el.querySelector('.entry-input');
    const scoreInp = el.querySelector('.score-input');
    const commentInp = el.querySelector('.comment-input');
    if (entryInp) entryInp.value = seed.entry;
    if (scoreInp) scoreInp.value = seed.score;
    if (commentInp) commentInp.value = seed.comment;
    renderProvWrap();
    refreshSaveEnabled();
    updateModeLabels();
    const focusSel = focusField === 'entry' ? '.entry-input'
                   : focusField === 'comment' ? '.comment-input'
                   : '.score-input';
    const focusInp = el.querySelector(focusSel);
    focusInp?.focus();
    if (focusField !== null) focusInp?.select();
  }

  function openForCreate(entryStr, scroller, anchorEl) {
    const focusField = entryStr.trim() ? 'score' : 'entry';
    open(buildUserWlEntry(entryStr, '', ''), null, scroller, anchorEl, focusField, 'create');
  }

  function renderFooterHTML(entryText) {
    return `<span class="atom-pop-adopt"></span>`
      + `<button class="atom-pop-cancel" type="button">Cancel</button>`
      + `<button class="atom-pop-save" type="button">${esc(saveLabel(entryText))}</button>`;
  }

  function renderProvenanceTableHTML() {
    return renderProvenanceRowsHTML(applyPreviewOverlay(buildBaseRows()));
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

  function previewPlan() {
    const inp = el.querySelector('.entry-input');
    if (!inp || inp.disabled || stagedDelete) return null;
    const vals = readNewValues();
    if (!valuesValid(vals)) return null;
    if (activeMode === 'edit' && !stagedAdopt && !pendingWritesChange(vals)) return null;
    const clicked = activeMode === 'edit' ? editBaselineFor(saveBaseline()) : null;
    return planEntryWrite({ mode: activeMode, clicked, typed: vals, sources: state.sources, trashScore: getTrashScore() });
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
    const i = rows.findIndex(r => r.isEdits && r.entry.norm === p.norm && displayOf(r.entry) === p.display && r.diff !== 'deleted');
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

  function renderNotesHTML() {
    return previewPlan()?.blockedReason === 'exists'
      ? `<div class="atom-pop-note atom-pop-note--block">That entry already exists.</div>`
      : '';
  }

  // Mirror saveEdit's no-op check so an untouched popover shows no preview row.
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
      const disabled = wordlist ? wordlist.enabled === false : enabled === false;
      const cls = ['atom-pop-prov-row'];
      if (disabled) cls.push('atom-pop-prov-row--disabled');
      if (diff) cls.push(`atom-pop-prov-row--${diff}`);
      const comment = entry.comment || '';
      const label = isStaged ? 'Restore this edit' : 'Delete this edit';
      // A rename's predicted-delete row (diff 'deleted', not user-staged) gets no
      // trash — only a genuinely saved row, or the staged-delete row to restore it.
      const trash = adoptStaged
        ? `<button class="atom-pop-prov-trash atom-pop-prov-untrash" type="button"`
          + ` title="${adoptLabel}" aria-label="${adoptLabel}">${buildTrashIconHTML()}</button>`
        : saved && isEdits && (diff !== 'deleted' || isStaged)
        ? `<button class="atom-pop-prov-trash${isStaged ? ' staged' : ''}" type="button"`
          + ` data-norm="${esc(entry.norm)}" data-display="${esc(displayOf(entry))}"`
          + ` title="${label}" aria-label="${label}">${buildTrashIconHTML()}</button>`
        : '';
      return `<tr class="${cls.join(' ')}">`
        + `<td class="atom-pop-prov-entry">${esc(displayOf(entry))}</td>`
        + `<td class="atom-pop-prov-score">${buildScoreCellHTML(entry, true)}</td>`
        + `<td class="atom-pop-prov-comment"${comment ? ` title="${esc(comment)}"` : ''}>${esc(comment)}</td>`
        + `<td class="atom-pop-prov-source">${buildWordlistNameIconHTML(wordlist, { bold: false })}</td>`
        + `<td class="atom-pop-prov-action">${trash}</td>`
        + `</tr>`;
    }).join('');
    return `<table class="atom-pop-prov">`
      + `<thead><tr>`
      + `<th class="atom-pop-prov-entry">Entry</th>`
      + `<th class="atom-pop-prov-score">Score</th>`
      + `<th class="atom-pop-prov-comment">Comment</th>`
      + `<th class="atom-pop-prov-source">Source</th>`
      + `<th class="atom-pop-prov-action"></th>`
      + `</tr></thead>`
      + `<tbody>${body}</tbody>`
      + `</table>`;
  }

  function toggleStagedDelete(norm, display) {
    const same = stagedDelete && stagedDelete.norm === norm && stagedDelete.display === display;
    stagedDelete = same ? null : { norm, display };
    setInputsDisabled(!!stagedDelete);
    refreshSaveEnabled();
    renderProvWrap();
    updateModeLabels();
  }

  function toggleStagedAdopt() {
    stagedAdopt = !stagedAdopt;
    renderProvWrap();
    refreshSaveEnabled();
  }

  function unstageAdopt() { stagedAdopt = false; }

  function adoptWillReplace() {
    const base = saveBaseline();
    return !!getEditsWordlist()?.rawEntries.some(e => e.norm === base.norm && e.display == null);
  }

  function adoptable() {
    if (activeMode !== 'edit' || stagedDelete) return false;
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
    const slot = el?.querySelector('.atom-pop-adopt');
    if (!slot) return;
    slot.innerHTML = adoptable() && !stagedAdopt
      ? `<button class="atom-pop-adopt-btn" type="button">`
        + `${esc(adoptWillReplace() ? 'Update My Edits' : 'Add to My Edits')}</button>`
      : '';
  }

  function setInputsDisabled(disabled) {
    for (const sel of ['.entry-input', '.score-input', '.comment-input']) {
      const node = el?.querySelector(sel);
      if (node) node.disabled = disabled;
    }
  }

  function renderHTML(wlEntry, seedOverride) {
    const seed = activeSeed = seedOverride
      ?? seedFromWinnerRow(wlEntry, getEditsWordlist() != null && wlEntry.wordlist === getEditsWordlist());
    return `
      <button class="dialog-close-btn" type="button" aria-label="Close">✕</button>
      <div class="atom-pop-title">${esc(headerText(seed.entry))}</div>
      <div class="atom-pop-fields">
        <label for="atom-pop-entry">Entry</label>
        <input id="atom-pop-entry" class="entry-input" type="text" value="${esc(seed.entry)}">
        <label for="atom-pop-score">Score</label>
        <input id="atom-pop-score" class="score-input" type="number" min="0" value="${seed.score}">
        <label for="atom-pop-comment">Comment</label>
        <input id="atom-pop-comment" class="comment-input" type="text" value="${esc(seed.comment)}">
      </div>
      <div class="atom-pop-prov-wrap">${renderProvenanceTableHTML()}${renderNotesHTML()}</div>
      <div class="atom-pop-foot">${renderFooterHTML(seed.entry)}</div>`;
  }

  // Entry text is passed in, not read from `.entry-input`: during renderHTML `el`
  // still holds the previous popover's input, which would mis-flag a fresh open.
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

  function headerText(entryText) {
    if (stagedDelete) return 'Delete entry';
    if (activeMode === 'create') return 'Add entry';
    return isRenaming(entryText) ? 'Rename entry' : 'Edit entry';
  }

  function saveLabel(entryText) {
    if (stagedDelete) return 'Delete';
    if (activeMode === 'create') return 'Add';
    return isRenaming(entryText) ? 'Rename' : 'Save';
  }

  function updateModeLabels() {
    const entryText = entryInputValue();
    const t = el && el.querySelector('.atom-pop-title');
    if (t) t.textContent = headerText(entryText);
    const s = el && el.querySelector('.atom-pop-save');
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
      wireFields();
      const inp = el.querySelector('.entry-input');
      fireProvenanceQuery('', inp ? inp.value : '');
      return;
    }
    refreshDynamicBits();
  }

  function refreshDynamicBits() {
    if (!isOpen()) return;
    const inp = el.querySelector('.entry-input');
    const typed = inp ? inp.value : '';
    fireProvenanceQuery(typed, typed);
    renderProvWrap();
    updateModeLabels();
  }

  function renderProvWrap() {
    if (!isOpen()) return;
    const provEl = el.querySelector('.atom-pop-prov-wrap');
    if (provEl) provEl.innerHTML = renderProvenanceTableHTML() + renderNotesHTML();
    // open() positions against the still-empty table (rows await the worker), so
    // re-anchor as it grows or the popover spills off the bottom near the viewport edge.
    position(activeAnchor);
  }

  // No debounce: every keystroke (and the open) fires. The monotonic token drops
  // all but the latest reply, so a fast typist's stale reply can't overwrite the
  // live table.
  function fireProvenanceQuery(typedRaw, previewRaw) {
    const token = ++provQueryToken;
    provQueriesFired++;
    const clicked = activeWlEntry;
    const clickedNorm = clicked?.norm ?? null;
    const clickedDisplay = clicked?.display ?? null;
    fetchWorkerProvenance(typedRaw, previewRaw, clickedNorm, clickedDisplay)
      .then(({ rows }) => {
        // Match by (norm, display), not identity: each run rebuilds activeWlEntry
        // fresh, so an identity check would drop every reply after a re-bind.
        if (token !== provQueryToken || !isOpen()
            || activeWlEntry?.norm !== clickedNorm
            || (activeWlEntry?.display ?? null) !== clickedDisplay) return;
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
    fireProvenanceQuery('', seedEntry);
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

  function submit() {
    if (stagedDelete) {
      const scroller = activeScroller;
      const target = stagedDelete;
      close();
      scroller._onDeleteRow?.(target);
      return;
    }
    const newValues = readNewValues();
    if (!valuesValid(newValues)) {
      const focusTarget = newValues.raw.length === 0 ? '.entry-input' : '.score-input';
      el.querySelector(focusTarget).focus();
      return;
    }
    if (saveBlocked()) { el.querySelector('.entry-input')?.focus(); return; }
    const mode = stagedAdopt ? 'adopt' : activeMode;
    const baseline = mode === 'create' ? null : editBaselineFor(saveBaseline());
    activeScroller._onSave?.(mode, baseline, newValues);
    close();
  }

  function wireFooter() {
    el.querySelector('.atom-pop-cancel').addEventListener('click', close);
    el.querySelector('.atom-pop-save').addEventListener('click', submit);
    refreshSaveEnabled();
  }

  // Save commits a staged deletion, so it stays enabled while one is pending
  // (its inputs are disabled then, but the validity gate must not block it).
  function refreshSaveEnabled() {
    const saveBtn = el.querySelector('.atom-pop-save');
    if (saveBtn) {
      if (stagedDelete || stagedAdopt) saveBtn.disabled = false;
      else {
        const vals = readNewValues();
        saveBtn.disabled = !valuesValid(vals) || saveBlocked()
          || (activeMode === 'edit' && !pendingWritesChange(vals));
      }
    }
    refreshAdoptLink();
  }

  function saveBlocked() {
    const plan = previewPlan();
    return !!(plan && plan.blockedReason);
  }

  function wireFields() {
    const entryInp = el.querySelector('.entry-input');
    const scoreInp = el.querySelector('.score-input');
    const commentInp = el.querySelector('.comment-input');

    entryInp.addEventListener('beforeinput', blockSemicolon);
    commentInp.addEventListener('beforeinput', blockSemicolon);
    for (const inp of [entryInp, scoreInp, commentInp]) {
      inp.addEventListener('input', unstageAdopt);
    }
    // An entry edit changes the norm → re-query the worker for contributors;
    // score/comment only move the local My Edits preview row.
    entryInp.addEventListener('input', refreshDynamicBits);
    scoreInp.addEventListener('input', renderProvWrap);
    commentInp.addEventListener('input', renderProvWrap);

    for (const inp of [entryInp, scoreInp, commentInp]) {
      inp.addEventListener('input', refreshSaveEnabled);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    }

    wireFooter();
  }

  function position(anchorEl) {
    // Mobile uses a CSS bottom sheet; clear inline top/left left by a prior
    // desktop open, or they'd override the sheet's positioning after a resize.
    if (window.matchMedia('(max-width: 759px)').matches) {
      el.style.top = '';
      el.style.left = '';
      return;
    }
    if (!anchorEl) {
      const pw = el.offsetWidth, ph = el.offsetHeight;
      el.style.left = Math.max(8, (window.innerWidth  - pw) / 2) + 'px';
      el.style.top  = Math.max(8, (window.innerHeight - ph) / 2) + 'px';
      return;
    }
    anchorDropdown(el, anchorEl);
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

  return { open, openForCreate, close, isOpen, containsFocus, activeNorm, rebindRow, rebindEntry, rebindQuery, seedDebug, provenanceDebug };
})();

export function popoverRebindQuery() {
  return AtomPopover.rebindQuery();
}

// ─── Score quick-pick ─────────────────────────────────────────────────────────

function scoreQuickPickable() {
  const edits = getEditsWordlist();
  return state.selected === MERGED_ID || (edits != null && state.selected === edits);
}

// Offered only in the All Wordlists and My Edits scopes: there the clicked row
// holds the value a save writes, so the picked tier shows in place. A single-
// source scope would write the edit into My Edits while still showing the
// source's score — silently appearing to do nothing — so it uses the AtomPopover.
export const ScorePicker = (() => {
  let el = null;
  let activeRow = null;
  let activeAnchor = null;
  let activeWlEntry = null;
  let activeScroller = null;
  let options = [];
  let activeIndex = 0;
  let startIndex = 0;

  function buildOptions() {
    return state.scoring
      .map(r => {
        const intervals = parseRange(r.input);
        if (!intervals) return null;
        return { note: r.note || '', intervals, score: intervals[0].min };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }

  function ensureElement() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'score-picker';
    el.setAttribute('hidden', '');
    el.addEventListener('click', e => {
      const opt = e.target.closest('.score-picker-opt');
      if (opt) commit(parseInt(opt.dataset.i, 10));
    });
    el.addEventListener('mousemove', e => {
      const opt = e.target.closest('.score-picker-opt');
      if (opt) setActive(parseInt(opt.dataset.i, 10), false);
    });
    document.body.appendChild(el);
    return el;
  }

  function isOpen() { return el && !el.hasAttribute('hidden'); }

  function open(wlEntry, rowEl, scroller, anchorEl) {
    AtomPopover.close();
    options = buildOptions();
    if (!options.length) { AtomPopover.open(wlEntry, rowEl, scroller, anchorEl, 'score'); return; }

    const picker = ensureElement();
    if (activeRow) activeRow.classList.remove('active');
    activeWlEntry = wlEntry;
    activeRow = rowEl;
    activeScroller = scroller;
    activeAnchor = anchorEl ?? rowEl;
    if (rowEl) rowEl.classList.add('active');

    const score = wlEntry.score;
    // The cursor/overlay start on the tier the score sits in, or the next tier
    // down in a between-tiers gap (22 → the 20 tier), floored at the lowest.
    startIndex = options.findIndex(o => o.score <= score);
    if (startIndex < 0) startIndex = options.length - 1;
    activeIndex = startIndex;

    picker.innerHTML = renderHTML();
    picker.removeAttribute('hidden');
    position();
    picker.querySelector('.score-picker-list')?.focus();
    syncActive();

    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  function close() {
    if (!el || el.hasAttribute('hidden')) return;
    el.setAttribute('hidden', '');
    if (activeRow) activeRow.classList.remove('active');
    activeRow = activeAnchor = activeWlEntry = activeScroller = null;
    options = [];
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeydown, true);
  }

  function renderHTML() {
    const opts = options.map((o, i) =>
      `<li id="score-picker-opt-${i}" class="score-picker-opt" role="option" data-i="${i}"`
      + ` aria-selected="${i === activeIndex}" title="${esc(o.note)}">`
      + `<span class="score-picker-badge">${buildScoreBadgeHTML(o.score)}</span>`
      + `<span class="score-picker-label">${esc(o.note)}</span>`
      + `</li>`
    ).join('');
    return `<ul class="score-picker-list" role="listbox" aria-label="Set score" tabindex="-1">${opts}</ul>`;
  }

  function setActive(i, scroll = true) {
    if (i === activeIndex) return;
    activeIndex = i;
    syncActive(scroll);
  }

  function syncActive(scroll = true) {
    const lis = el.querySelectorAll('.score-picker-opt');
    lis.forEach((li, j) => {
      li.classList.toggle('active', j === activeIndex);
      li.setAttribute('aria-selected', j === activeIndex);
    });
    if (scroll) lis[activeIndex]?.scrollIntoView({ block: 'nearest' });
    el.querySelector('.score-picker-list')
      ?.setAttribute('aria-activedescendant', lis[activeIndex]?.id ?? '');
  }

  function commit(i) {
    const opt = options[i];
    const scroller = activeScroller;
    const w = activeWlEntry;
    if (!opt || !scroller || !w) { close(); return; }
    const winnerIsEdits = getEditsWordlist() != null && w.wordlist === getEditsWordlist();
    const seed = seedFromWinnerRow(w, winnerIsEdits);
    close();
    // Re-picking the score already in place is a true no-op (only the score can
    // differ — entry and comment ride from the seed). The save path would no-op
    // it too, but still re-renders the table; bail here so it doesn't flash.
    if (opt.score === seed.score) return;
    scroller._onSave?.('edit', editBaselineFor(seed), { raw: seed.entry, score: opt.score, comment: seed.comment });
  }

  function onDocMouseDown(e) {
    if (!isOpen()) return;
    if (el.contains(e.target) || (activeRow && activeRow.contains(e.target))) {
      // The picker overlays its start option on the clicked badge, so a quick
      // second click there completes a native double-click; suppress its default
      // text selection so the score doesn't flash selected before the commit.
      e.preventDefault();
      return;
    }
    close();
  }

  function onKeydown(e) {
    switch (e.key) {
      case 'Escape':    e.preventDefault(); close(); break;
      case 'ArrowDown': e.preventDefault(); setActive(Math.min(options.length - 1, activeIndex + 1)); break;
      case 'ArrowUp':   e.preventDefault(); setActive(Math.max(0, activeIndex - 1)); break;
      case 'Home':      e.preventDefault(); setActive(0); break;
      case 'End':       e.preventDefault(); setActive(options.length - 1); break;
      case 'Enter':     e.preventDefault(); commit(activeIndex); break;
    }
  }

  // Overlay the starting tier's option badge directly on the clicked score badge,
  // so the value being changed stays put under the cursor (a native-select feel)
  // rather than dropping the list below the row.
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

  return { open, close, isOpen };
})();

export function buildEntriesTablePanelHTML() {
  return `<div id="entries-table-panel">
      <div class="pipeline-spinner" aria-hidden="true"></div>
      <div id="vs-host"></div>
    </div>`;
}

// One header set for every chain shape — the Entry / Length / Score columns
// describe what each atom *line* contains, not the row as a whole, so they
// stay constant whether a row has one atom or many. Comment / Source surface
// on every chain shape when the viewport has room (gated by media query).
export function buildEntryHeadersHTML() {
  const stack = ToolStack.getStack();
  const tier = chainSortTier(stack);
  const tierAxes = sortAxes(tier, stack);
  const hdr = (label, ownedAxes) => {
    if (!ownedAxes.length) return { attrs: '', inner: esc(label) };
    const active = ownedAxes.includes(AppView.sortKey);
    const asc = AppView.sortDir === 'asc';
    const arrow = active ? (asc ? ' ↑' : ' ↓') : '';
    const state = active ? (asc ? ', ascending' : ', descending') : '';
    return {
      attrs: ` data-sort-axes="${ownedAxes.join(' ')}" role="button" tabindex="0" aria-label="Sort by ${esc(label)}${state}"`,
      inner: `${esc(label)}${arrow}`,
    };
  };
  if (isGroupChain(stack)) {
    const cols = activeGroupColumns(stack);
    const anchorLabel = activeGroupAnchorLabel(stack);
    const countH = hdr('Count', columnSortAxes('group-count', tierAxes));
    const anchorH = anchorLabel ? hdr(anchorLabel, columnSortAxes('group-anchor', tierAxes)) : null;
    const anchorHeader = anchorH ? `<span class="group-anchor"${anchorH.attrs}>${anchorH.inner}</span>` : '';
    const colHeaders = cols.map(c => {
      const owned = (c.sort !== false && c.key in tierAxes) ? [c.key] : [];
      const h = hdr(c.label, owned);
      return `<span class="group-col" data-col="${esc(c.key)}"${h.attrs}>${h.inner}</span>`;
    }).join('');
    const entriesH = hdr('Entries', anchorLabel ? [] : columnSortAxes('group-entries', tierAxes));
    return `<div class="group-headers entry-headers-font">
      <span class="group-rownum"></span>
      <span class="group-count"${countH.attrs}>${countH.inner}</span>
      ${anchorHeader}
      ${colHeaders}
      <span class="group-entries-label"${entriesH.attrs}>${entriesH.inner}</span>
    </div>`;
  }
  const entryH = hdr('Entry', columnSortAxes('col-entry', tierAxes));
  const lenH   = hdr('Len',   columnSortAxes('col-len', tierAxes));
  const scoreH = hdr('Score', columnSortAxes('col-score', tierAxes));
  const sourceHeader = state.selected === MERGED_ID ? '<span class="col-source">Source</span>' : '';
  return `<div class="entry-headers entry-headers-font">
      <span></span>
      <span class="col-entry"${entryH.attrs}>${entryH.inner}</span>
      <span class="col-len"${lenH.attrs}>${lenH.inner}</span>
      <span class="col-score"${scoreH.attrs}>${scoreH.inner}</span>
      <span class="col-comment">Comment</span>
      ${sourceHeader}
    </div>`;
}

export function onSortHeaderActivate(e) {
  const cell = e.target.closest('[data-sort-axes]');
  if (!cell) return;
  if (e.type === 'keydown') {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
  }
  const owned = cell.dataset.sortAxes.split(' ');
  const { key, dir } = nextSortForColumn(owned, AppView.sortKey, AppView.sortDir);
  const sel = cell.dataset.col
    ? `.sticky-stack [data-col="${CSS.escape(cell.dataset.col)}"]`
    : `.sticky-stack .${cell.classList[0]}`;
  getEntriesScroller()?.applySort(key, dir);
  // applySort rebuilds the header, destroying the activated cell — refocus its
  // replacement so keyboard focus isn't silently dropped to <body>.
  if (e.type === 'keydown') document.querySelector(sel)?.focus();
}

// rerenderRows rebuilds only the tool rows, so a stack edit that flips chain
// rows ⇄ group rows leaves the column headers stale until this runs.
export function rebuildEntryHeaders() {
  const el = document.querySelector('.sticky-stack .entry-headers, .sticky-stack .group-headers');
  if (el) el.outerHTML = buildEntryHeadersHTML();
}
