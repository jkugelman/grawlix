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

import { ROW_HEIGHT, VS_BUFFER, MERGED_ID } from '../core/constants.js';
import { esc } from '../core/util.js';
import { displayOf, projectRangesToDisplay, toNorm, buildUserWlEntry } from '../engine/norm.js';
import { parseRange, matchesRange } from '../engine/range.js';
import { renderHighlightedText } from '../engine/search.js';
import { TOOLS, normalizeParams } from '../engine/tools.js';
import {
  isFilterOnlyChain, isGroupChain, rowLastEntry,
  bottomLineAtoms, rowSetAtoms, applyScoreRangeToRows, collapseRepeatAtoms,
} from '../engine/executor.js';
import { state, getEditsWordlist } from '../data/state.js';
import { getRescoredByNorm, rescoreEntry } from '../data/rescoring.js';
import { buildMergedWordlist, mergeKey, mergedRowsForNorm } from '../data/merge.js';
import { makeTierLookup } from '../model/scoring.js';
import { buildScoreBadgeHTML, buildScoreCellHTML } from '../model/score-display.js';
import { showToast } from './toasts.js';
import { AppView } from './app-view.js';
import { ToolStack } from './tool-stack.js';
import { buildWordlistNameHTML } from './scope-selector.js';
import {
  getEntriesScroller, rescorePreviewActive, buildNoMatchQuipHTML, refreshMergedScroller,
} from './rendering.js';

let _navigate              = () => {};

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
const groupMinScore     = g => g._minScore;
const groupMaxScore     = g => g._maxScore;
const groupCount        = g => g._count;
const groupChainEntries = g => g.chains.map(c => c.atoms[0].wlEntry.norm);
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
  group: {
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
function activeGroupRow(stack) {
  return stack.find(r => r.kind() === 'group' && !r.isInert());
}
export function activeGroupColumns(stack) {
  return activeGroupRow(stack)?.def.group?.columns || [];
}
export function activeGroupAnchorLabel(stack) {
  return activeGroupRow(stack)?.def.group?.anchorLabel || null;
}
function buildColumnAxis(primaryCol, allColumns) {
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
export function sortAxes(tier, stack = ToolStack.getStack()) {
  if (tier !== 'group') return SORT_AXES[tier];
  const cols = activeGroupColumns(stack);
  const spec = activeGroupRow(stack)?.def.group || null;
  const anchorLabel = spec?.anchorLabel || null;
  const extraTiebreakers = cols
    .filter(c => c.tiebreaker !== false)
    .map(c => ({ project: g => c.value(g), dir: 'desc' }));
  const baseAxes = {};
  for (const [key, axis] of Object.entries(SORT_AXES.group)) {
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
    columnAxes[col.key] = buildColumnAxis(col, cols);
  }
  return { ...baseAxes, ...columnAxes };
}
export function isValidSortAxis(key) {
  if (key in SORT_AXES.single || key in SORT_AXES.multi
      || key in SORT_AXES.group) return true;
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

// Compare two items along an axis, falling through tiebreakers when the
// primary projection is equal. Primary direction is the user's pick;
// tiebreakers keep their declared direction regardless.
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
const ENTRY_SLOT_CAP = 21;

// ─── Flat-tier highlight re-derivation ──────────────────────────────────────
// The flat result ships no highlights; the visible window re-derives them by
// replaying each active highlighting filter. This and materializeFlatRow must
// reproduce the executor's runToolStage + collapseRepeatAtoms exactly — any
// divergence is a silent visual bug (wrong marks, or an atom count that mismatches
// the row's reserved line height). A flat chain has no transforms, so the only
// highlighting filters are Search/Regex in filter mode.
function compileFlatHighlighters(stack) {
  const out = [];
  for (const row of stack) {
    const { def } = row;
    if (row.isInert() || row.kind() !== 'filter' || !def.inputHighlights) continue;
    const params = normalizeParams(row.params, def.params);
    // Sync prepare only — the render path can't await; Search/Regex prepare is
    // sync and ignores ctx, so a future async-prepare highlighting filter would
    // silently ship a Promise as `prepared` here.
    const prepared = def.prepare ? def.prepare(params, {}) : params;
    const coord = def.matchOn === 'display' ? 'display' : 'norm';
    out.push({ def, prepared, coord });
  }
  return out;
}

function tagCoord(ranges, coord) {
  return ranges.map(r => r.coord ? r : { ...r, coord });
}

function materializeFlatRow(wlEntry, highlighters) {
  const atoms = [{ wlEntry, highlights: null, glyph: null }];
  for (const { def, prepared, coord } of highlighters) {
    const input = def.matchOn === 'both' ? wlEntry
      : def.matchOn === 'display' ? displayOf(wlEntry)
      : wlEntry.norm;
    const result = def.run(input, prepared, null);
    const highlights = Array.isArray(result) ? tagCoord(result, coord) : [];
    atoms.push({ wlEntry, highlights, glyph: null });
  }
  return { atoms: collapseRepeatAtoms(atoms) };
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
  return headerLabelPx(label + ' ↑');
}

const EMPTY_REVEAL_DELAY_MS = 450;

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
    if (this._isReservationActive() && !this._revealEmpty) {
      this._reservedHeight = Math.max(this._reservedHeight, this.sizer.offsetHeight, naturalHeight);
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
  let chains = null;
  let scroller = null;
  let rendered = 0;
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
      const atom = chains?.[parseInt(chainEl.dataset.chain, 10)]
                    ?.atoms[parseInt(atomEl.dataset.atom, 10)];
      if (!atom) return;
      const field = target.classList.contains('atom-score') ? 'score' : null;
      AtomPopover.open(atom.wlEntry, el, scroller, target, field);
    });
  }

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    anchor = chains = scroller = null;
    rendered = 0;
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

  function renderChunk() {
    const end = Math.min(chains.length, rendered + POPOVER_CHUNK);
    const html = [];
    for (let i = rendered; i < end; i++) {
      html.push(buildGroupChainHTML(chains[i], i));
    }
    sentinel.insertAdjacentHTML('beforebegin', html.join(''));
    rendered = end;
    if (rendered >= chains.length) {
      io?.disconnect();
      io = null;
      sentinel.remove();
      sentinel = null;
    }
  }

  function toggle(nextChains, anchorEl, nextScroller) {
    if (anchor === anchorEl) { close(); return; }
    close();
    chains = nextChains;
    scroller = nextScroller;
    el.innerHTML = '';
    sentinel = document.createElement('span');
    sentinel.className = 'group-popover-sentinel';
    el.appendChild(sentinel);
    rendered = 0;
    renderChunk();
    el.hidden = false;
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
    // When _flat (the filter-only tier), allEntries/entries hold Int32Array
    // indices into _flatCorpus.entries, NOT ChainRow[] — _flatScores is parallel
    // to allEntries, rows are materialized lazily for the visible window. The
    // transform/group tiers leave _flat false and keep the row arrays above.
    this._flat = false;
    this._flatCorpus = null;
    this._flatScores = null;
    this._flatViewScores = null;
    this._widthHints = null;
    this._flatHighlighters = [];
    this.sortKey = AppView.sortKey;
    this.sortDir = AppView.sortDir;
    this.scoreRange = AppView.scoreRange;
    this._scoreIntervals = this.scoreRange ? parseRange(this.scoreRange) : null;
    this.showSource = false;
    this.showDeleteCol = false;
    this.showEditDeleteCol = false;
    this.editsWordlist = null;
    this.currentWordlist = null;
    this._onSave = null;
    this._onDeleteRow = null;
    this.onFilterChange = null;
    // Sorted view of allEntries cached across keystrokes. Filter preserves
    // order, so a sorted source means the filter result is already sorted —
    // no per-keystroke re-sort needed. Invalidated when allEntries change.
    this._sortedSource = null;
    this._sortedSourceKey = null;
    this._sortedSourceDir = null;

    this.sizer.addEventListener('click', e => {
      const moreBtn = e.target.closest('.group-more');
      if (moreBtn) {
        const gr = moreBtn.closest('.group-row');
        const g = this.entries[parseInt(gr.dataset.idx, 10)];
        if (g) GroupMorePopover.toggle(g.chains, moreBtn, this);
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
        const g = this.entries[parseInt(groupRow.dataset.idx, 10)];
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
        const rowIdx = parseInt(row.dataset.idx, 10);
        wlEntry = this._flat
          ? this._flatCorpus.entries[this.entries[rowIdx]]
          : this.entries[rowIdx]?.atoms[parseInt(atomEl.dataset.atom, 10)]?.wlEntry;
      }
      if (!wlEntry) return;
      const field = target.classList.contains('atom-score') ? 'score'
                  : target.classList.contains('atom-comment') ? 'comment'
                  : null;
      AtomPopover.open(wlEntry, row, this, target, field);
    });

    this._buildToolbar();
  }

  setEntries(result, atomCount = this.atomCount, sortTier = this.sortTier) {
    GroupMorePopover.close();
    this._setChainShape(atomCount, sortTier);
    this._ingestResult(result);
    this._invalidateSortCache();
    this._buildToolbar();
    this._sortAndRender();
  }

  updateEntries(result, atomCount = this.atomCount, sortTier = this.sortTier) {
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
      this._flatCorpus = result.corpus;
      this._flatSnapVersion = result.corpus._snapVersion ?? 0;
      this._flatScores = result.scores;
      this._widthHints = result.widthHints;
      this._flatHighlighters = compileFlatHighlighters(ToolStack.getStack());
      this.allEntries = result.indices;
    } else {
      this._flatCorpus = null;
      this._flatScores = null;
      this.allEntries = result.rows;
    }
  }

  _setChainShape(atomCount, sortTier) {
    const tierChanged = sortTier !== this.sortTier;
    this.atomCount = atomCount;
    this.sortTier = sortTier;
    this.sortKey = AppView.sortKey;
    this.sortDir = AppView.sortDir;
    return tierChanged;
  }

  setScoreRange(range) {
    const next = range || '';
    if (next === this.scoreRange) return;
    this.scoreRange = next;
    this._scoreIntervals = next ? parseRange(next) : null;
    this._invalidateSortCache();
    this._sortAndRender();
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
    // The flat tier has no main-thread comparator (the worker pre-sorts), so an
    // axis change must re-run the pipeline; sorting locally would silently misorder.
    if (this._flat) refreshMergedScroller();
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

  _getSortedSource() {
    if (this._sortedSource
        && this._sortedSourceKey === this.sortKey
        && this._sortedSourceDir === this.sortDir
        && this._sortedSourceRange === this.scoreRange) {
      return this._sortedSource;
    }

    // Flat tier: the index array is already sorted (by the worker); a sort-axis
    // change re-runs the pipeline (applySort), so don't re-sort here — only the
    // score-range filter applies, order-preserving.
    let sorted;
    if (this._flat) {
      sorted = this._filterFlatIndices();
    } else {
      const filtered = applyScoreRangeToRows(this.allEntries, this._scoreIntervals, this.sortTier === 'group');
      const axis = sortAxes(this.sortTier)[this.sortKey];
      if (!axis) {
        sorted = filtered;
      } else {
        if (this.sortTier === 'group') this._sortGroupChains();
        sorted = [...filtered].sort((a, b) => compareItems(a, b, axis, this.sortDir));
      }
    }

    this._sortedSource = sorted;
    this._sortedSourceKey = this.sortKey;
    this._sortedSourceDir = this.sortDir;
    this._sortedSourceRange = this.scoreRange;
    return sorted;
  }

  _filterFlatIndices() {
    if (!this._scoreIntervals) {
      this._flatViewScores = this._flatScores;
      return this.allEntries;
    }
    const all = this.allEntries, scores = this._flatScores;
    const idxOut = [], scoreOut = [];
    for (let i = 0; i < all.length; i++) {
      if (matchesRange(scores[i], this._scoreIntervals)) {
        idxOut.push(all[i]);
        scoreOut.push(scores[i]);
      }
    }
    this._flatViewScores = Int32Array.from(scoreOut);
    return Int32Array.from(idxOut);
  }

  _sortGroupChains() {
    const seedEntry = c => c.atoms[0].wlEntry.norm;
    const seedScore = c => c.atoms[0].wlEntry.score;
    const byNorm = (a, b) => seedEntry(a).localeCompare(seedEntry(b));
    const byScore = (a, b) => seedScore(b) - seedScore(a) || byNorm(a, b);
    const cmp = this.sortKey === 'entry' ? byNorm : byScore;
    for (const g of this.allEntries) g.chains.sort(cmp);
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
    const preview = rescorePreviewActive();
    let maxRawDigits = 0;
    for (const row of this.entries) {
      for (const atom of row.atoms) {
        const d = String(atom.wlEntry.norm.length).length;
        if (d > maxLenDigits) maxLenDigits = d;
        const sd = String(atom.wlEntry.score).length;
        if (sd > maxScoreDigits) maxScoreDigits = sd;
        const { rawScore, score } = atom.wlEntry;
        if (preview && rawScore != null && rawScore !== score) {
          maxRawDigits = Math.max(maxRawDigits, String(rawScore).length);
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
    const { maxDisplayLen, maxLenDigits, maxScoreDigits } = this._widthHints;
    const hasHighlight = this._flatHighlighters.length > 0;

    let maxRawDigits = 0;
    if (rescorePreviewActive()) {
      const corpus = this._flatCorpus.entries, view = this.entries;
      for (let i = 0; i < view.length; i++) {
        const { rawScore, score } = corpus[view[i]];
        if (rawScore != null && rawScore !== score) {
          maxRawDigits = Math.max(maxRawDigits, String(rawScore).length);
        }
      }
    }

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
    return bottomLineAtoms(this.entries);
  }

  _histogramEntries() {
    if (this._flat) return this._flatScores;
    return bottomLineAtoms(this.allEntries);
  }

  _visibleGroupChainCount() {
    let n = 0;
    for (const g of this.entries) n += g.chains.length;
    return n;
  }

  _rowStride() {
    return this.atomCount * ROW_HEIGHT;
  }

  _render() {
    if (this.sortTier === 'group') return this._renderGroups();
    // A My Edits patch splices _flatCorpus.entries in place; rendering before the
    // always-following re-run repaints would index this.entries past the corpus and throw.
    if (this._flat && this._flatCorpus && (this._flatCorpus._snapVersion ?? 0) !== this._flatSnapVersion) return;
    const n = this.entries.length;
    const stride = this._rowStride();
    this.sizer.style.height = this._sizerHeightFor(n * stride) + 'px';
    this._renderEmptyState(n, 'chain');

    const { start, end } = this._visibleRange(n);
    this._clearSizer();

    const tierFor = makeTierLookup();
    const preview = rescorePreviewActive();
    const activeNorm = AtomPopover.activeNorm(this);
    let nextActiveRow = null;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const chainRow = this._flat ? this._flatRowAt(i) : this.entries[i];
      const row = this._renderChainRow(chainRow, i, tierFor, activeNorm, preview);
      row.style.top = (i * stride) + 'px';
      if (row.classList.contains('active')) nextActiveRow = row;
      frag.appendChild(row);
    }
    this.sizer.appendChild(frag);
    if (nextActiveRow) AtomPopover.rebindRow(nextActiveRow);
  }

  _flatRowAt(i) {
    return materializeFlatRow(this._flatCorpus.entries[this.entries[i]], this._flatHighlighters);
  }

  _renderChainRow(chainRow, i, tierFor, activeNorm, preview) {
    const atoms = chainRow.atoms;
    let isActive = false;
    let html = `<span class="atom-count">${i + 1}.</span>`;
    atoms.forEach((atom, ai) => {
      const { wlEntry, highlights, glyph } = atom;
      const { norm, score } = wlEntry;
      if (activeNorm && norm === activeNorm) isActive = true;
      const displayed = displayOf(wlEntry);
      const projected = projectRangesToDisplay(highlights, wlEntry);
      const glyphHTML = glyph ? `<span class="atom-glyph">${glyph} </span>` : '';
      const truncTitle = displayed.length > ENTRY_SLOT_CAP ? ` title="${esc(displayed)}"` : '';
      const entryCell =
        `<span class="atom-entry"${truncTitle}>${glyphHTML}${renderHighlightedText(displayed, projected)}</span>`;
      const scoreInner = buildScoreCellHTML(wlEntry, preview);
      const tierLabel = tierFor(score);
      const scoreTitle = tierLabel ? ` title="${esc(tierLabel)}"` : '';
      const commentText = wlEntry.comment || '';
      const sourceWl = wlEntry.wordlist;
      const sourceHTML = sourceWl ? buildWordlistNameHTML(sourceWl, { bold: false }) : '';
      const sourceTitle = sourceWl ? ` title="${esc(sourceWl.name)}"` : '';
      const sourceCell = this.showSource
        ? `<span class="atom-source"${sourceTitle}>${sourceHTML}</span>`
        : '';
      html += `<span class="atom" data-atom="${ai}">` +
        entryCell +
        `<span class="atom-len">${norm.length}</span>` +
        `<span class="atom-score"${scoreTitle}>${scoreInner}</span>` +
        `<span class="atom-comment"${commentText ? ` title="${esc(commentText)}"` : ''}>${esc(commentText)}</span>` +
        sourceCell +
        `</span>`;
    });

    const row = document.createElement('div');
    row.className = isActive ? 'entry-row entry-row-font active' : 'entry-row entry-row-font';
    row.dataset.idx = i;
    row.dataset.entry = rowLastEntry(chainRow).norm;
    row.innerHTML = html;
    return row;
  }

  _renderGroups() {
    const n = this.entries.length;
    const stride = this.atomCount * ROW_HEIGHT;
    this.sizer.style.height = this._sizerHeightFor(n * stride) + 'px';
    this._renderEmptyState(n, 'group');
    const { start, end } = this._visibleRange(n);
    this._clearSizer();
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
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const g = this.entries[i];
      const row = document.createElement('div');
      row.className = 'group-row entry-row-font';
      row.dataset.idx = i;
      row.style.top = (i * stride) + 'px';
      row.innerHTML = this._renderGroupRowHTML(g, i, columns, hasAnchor, ctx);
      const matchesActive = activeNorm && (
        (g.anchor && g.anchor.norm === activeNorm) ||
        g.chains.some(c => c.atoms.some(a => a.wlEntry.norm === activeNorm))
      );
      if (matchesActive) {
        row.classList.add('active');
        nextActiveRow = row;
      }
      frag.appendChild(row);
    }
    this.sizer.appendChild(frag);
    if (nextActiveRow) AtomPopover.rebindRow(nextActiveRow);
  }

  _renderGroupRowHTML(group, rowIdx, columns, hasAnchor, ctx) {
    const chains = group.chains;
    const total = chains.length;
    let leftEdge = 0;
    let visibleCount = 0;
    for (let ci = 0; ci < total; ci++) {
      if (visibleCount > 0 && leftEdge >= ctx.slot) break;
      leftEdge += (ci > 0 ? 18 : 0) + estimateChainWidth(chains[ci], ctx);
      visibleCount = ci + 1;
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

  _renderEmptyState(n, kind) {
    const existing = this.host.querySelector('.entries-empty');
    if (n > 0) { existing?.remove(); return; }

    if (existing && this._isReservationActive() && !this._revealEmpty) return;

    const query = AppView.searchQuery.trim();
    const addable = kind === 'chain' && /\S/i.test(query);
    const inMerge = addable && buildMergedWordlist().byNorm.has(toNorm(query));
    const key = `${kind}|${addable ? query.toLowerCase() : ''}|${addable ? inMerge : ''}`;
    if (existing && existing.dataset.key === key) return;

    const el = existing || document.createElement('div');
    el.className = 'entries-empty';
    el.dataset.key = key;

    if (kind === 'group') {
      el.textContent = 'No groups match.';
    } else if (addable) {
      el.innerHTML = `<div class="entries-empty-msg">${buildNoMatchQuipHTML(query, inMerge)}</div>`
        + (inMerge ? '' : `<button type="button" class="entries-empty-add">＋ Add it</button>`);
      el.querySelectorAll('.entries-empty-link, .entries-empty-add').forEach(t => {
        t.onclick = e => AtomPopover.openForCreate(query, this, e.currentTarget);
      });
    } else {
      el.textContent = 'No matches.';
    }

    if (!existing) this.host.appendChild(el);
  }

  _computeGroupSlotWidths() {
    let maxCount = 0;
    for (const g of this.allEntries) {
      if (g.chains.length > maxCount) maxCount = g.chains.length;
    }
    const target = this.host.closest('#detail-panel') || this.sizer;
    const countW = Math.max(
      measureTextWidth(String(maxCount), 'entry-headers-font'),
      sortableHeaderPx('Count'));
    const rownumW = measureTextWidth(this.allEntries.length + '.', 'entry-headers-font');
    target.style.setProperty('--group-count-w', `${countW}px`);
    target.style.setProperty('--group-rownum-w', `${rownumW}px`);
    const stack = ToolStack.getStack();
    const monoCh = measureMonoChPx();
    const anchorLabel = activeGroupAnchorLabel(stack);
    let anchorW = 0;
    if (anchorLabel) {
      let maxEntryW = 0, maxBadgeW = 0;
      for (const g of this.allEntries) {
        if (!g.anchor) continue;
        const entryW = displayOf(g.anchor).length * monoCh;
        if (entryW > maxEntryW) maxEntryW = entryW;
        const badgeW = badgeWidthPx(String(g.anchor.score).length);
        if (badgeW > maxBadgeW) maxBadgeW = badgeW;
      }
      anchorW = Math.max(maxEntryW + 5 + maxBadgeW, sortableHeaderPx(anchorLabel));
      target.style.setProperty('--group-anchor-w', `${anchorW}px`);
    }
    const columns = activeGroupColumns(stack);
    let columnsW = 0;
    for (const col of columns) {
      let maxColW = 0;
      for (const g of this.allEntries) {
        const w = measureTextWidth(String(col.value(g)), 'entry-headers-font');
        if (w > maxColW) maxColW = w;
      }
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

  exportRows() {
    if (!this._flat) return this.entries;
    const out = new Array(this.entries.length);
    for (let i = 0; i < this.entries.length; i++) out[i] = this._flatRowAt(i);
    return out;
  }

  resultHasEntry(wlEntry) {
    if (this._flat) return this._flatCorpus.byNorm.has(wlEntry.norm);
    for (const a of rowSetAtoms(this.allEntries)) {
      if (a.wlEntry === wlEntry) return true;
    }
    return false;
  }

  findResultEntry(norm, display) {
    if (this._flat) {
      const byKey = this._flatCorpus.byKey.get(mergeKey(norm, display));
      return byKey ?? this._flatCorpus.byNorm.get(norm) ?? null;
    }
    let normFallback = null;
    for (const a of rowSetAtoms(this.allEntries)) {
      if (a.wlEntry.norm !== norm) continue;
      if (a.wlEntry.display === display) return a.wlEntry;
      if (!normFallback) normFallback = a.wlEntry;
    }
    return normFallback;
  }
}

// ─── Atom popover ─────────────────────────────────────────────────────────────

export const AtomPopover = (() => {
  let el = null;
  let activeRow = null;
  let activeWlEntry = null;
  let activeSeed = null;
  let activeScroller = null;
  let pendingDelete = false;
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
      if (e.target.closest('.dialog-close-btn')) close();
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
    activeWlEntry = null;
    activeSeed = null;
    activeScroller = null;
    focusEl = null;
    pendingDelete = false;
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

  function open(wlEntry, rowEl, scroller, anchorEl, focusField = 'score') {
    const popover = ensureElement();
    if (activeRow) activeRow.classList.remove('active');
    activeWlEntry = wlEntry;
    activeRow = rowEl;
    activeScroller = scroller;
    if (rowEl) rowEl.classList.add('active');

    popover.innerHTML = renderHTML(wlEntry, scroller);
    popover.removeAttribute('hidden');
    position(anchorEl ?? rowEl);
    wireFields();
    const focusSel = focusField === 'entry'   ? '.entry-input'
                   : focusField === 'comment' ? '.comment-input'
                   : '.score-input';
    const input = popover.querySelector(focusSel);
    input?.focus();
    if (focusField !== null) input?.select();

    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  function openForCreate(entryStr, scroller, anchorEl) {
    const focusField = entryStr.trim() ? 'score' : 'entry';
    open(buildUserWlEntry(entryStr, '', ''), null, scroller, anchorEl, focusField);
  }

  function renderFooterHTML(preview, scroller) {
    const rowWordlist = preview?.wordlist || scroller.currentWordlist;
    const editsWordlist = scroller.editsWordlist || getEditsWordlist();
    const rowIsEdits = rowWordlist && rowWordlist === editsWordlist;
    const showDelete = scroller.showDeleteCol || (scroller.showEditDeleteCol && rowIsEdits);
    const editsName = editsWordlist ? buildWordlistNameHTML(editsWordlist, { bold: false }) : 'My Edits';
    const leftSlot = showDelete
      ? `<button class="atom-pop-delete" type="button">Delete edit</button>`
      : `<span class="atom-pop-saves">Saves to ${editsName}</span>`;
    return leftSlot
      + `<button class="atom-pop-cancel" type="button">Cancel</button>`
      + `<button class="atom-pop-save" type="button">Save</button>`;
  }

  // Spans ALL sources, not the merge's enabled-only walk: filtering by `enabled`
  // here would silently drop the disabled/non-winning lists this panel exists to
  // surface. A null-display (bare) entry applies to every spelling of its norm, so
  // the include test stays asymmetric — never collapse it to `e.display === display`.
  function gatherProvenance(norm, display) {
    const rows = [];
    for (const wl of state.sources) {
      const arr = getRescoredByNorm(wl).get(norm);
      if (!arr) continue;
      for (const e of arr) {
        const include = display == null || e.display === display || e.display == null;
        if (include) rows.push({ wordlist: wl, entry: e });
      }
    }
    return rows;
  }

  function renderProvenanceHTML(wlEntry) {
    if (!wlEntry || wlEntry.norm == null) return '';
    const rows = gatherProvenance(wlEntry.norm, wlEntry.display);
    if (!rows.length) return '';
    const body = rows.map(({ wordlist, entry }) => {
      const cls = wordlist.enabled === false ? ' atom-pop-prov-row--disabled' : '';
      const comment = entry.comment || '';
      return `<tr class="atom-pop-prov-row${cls}">`
        + `<td class="atom-pop-prov-entry">${esc(displayOf(entry))}</td>`
        + `<td class="atom-pop-prov-score">${buildScoreBadgeHTML(entry.score)}</td>`
        + `<td class="atom-pop-prov-comment"${comment ? ` title="${esc(comment)}"` : ''}>${esc(comment)}</td>`
        + `<td class="atom-pop-prov-source">${buildWordlistNameHTML(wordlist, { bold: false })}</td>`
        + `</tr>`;
    }).join('');
    return `<table class="atom-pop-prov">`
      + `<thead><tr>`
      + `<th class="atom-pop-prov-entry">Entry</th>`
      + `<th class="atom-pop-prov-score">Score</th>`
      + `<th class="atom-pop-prov-comment">Comment</th>`
      + `<th class="atom-pop-prov-source">Source</th>`
      + `</tr></thead>`
      + `<tbody>${body}</tbody>`
      + `</table>`;
  }

  function previewWlEntry(rawEntry) {
    const raw = rawEntry?.trim();
    if (!raw) return null;
    return buildMergedWordlist().byNorm.get(toNorm(raw)) || null;
  }

  function currentPreview() {
    const inp = el?.querySelector('.entry-input');
    return previewWlEntry(inp ? inp.value : displayOf(activeWlEntry));
  }

  // Seed from the All Wordlists merge winner, never the clicked atom's own value: under a
  // scoped lower-priority list the atom holds that list's losing value, but the
  // editor must show what the merge actually serves — a regression invisible
  // until you scope away from My Edits.
  function resolveSeed(clicked) {
    const merged = buildMergedWordlist();
    const norm = clicked.norm;
    let row = merged.byKey.get(mergeKey(norm, clicked.display));
    // A bare click with no bare merged row edits the first-alphabetical spelled
    // variant — deterministic but arbitrary; don't "fix" the ordering.
    if (!row && clicked.display == null) {
      const variants = mergedRowsForNorm(merged, norm).filter(r => r.display != null);
      variants.sort((a, b) => a.display.localeCompare(b.display));
      row = variants[0] || merged.byNorm.get(norm) || null;
    }
    if (!row) row = clicked; // norm absent from the merge (only in a disabled list)

    let score = row.score;
    const edits = getEditsWordlist();
    // Seed the score field from My Edits' RAW score, not the displayed effective:
    // the field edits raw, so seeding effective would re-rescore it on every save
    // and silently drift My Edits.
    if (edits && row.wordlist === edits) {
      const rawEntry = edits.rawEntries.find(e => e.norm === row.norm && displayOf(e) === displayOf(row));
      if (rawEntry) score = rawEntry.score;
    }

    return {
      entry: displayOf(row),
      score,
      comment: row.comment || '',
      norm: row.norm,
      display: row.display ?? null,
    };
  }

  // The score field edits a raw score that My Edits' rules then rescore, so when
  // they remap it the save is lossy; surface the gap rather than letting the
  // typed number silently become something else.
  function rescoreNoteHTML() {
    const edits = getEditsWordlist();
    if (!edits) return '';
    const rawScore = parseInt(el.querySelector('.score-input').value, 10);
    if (isNaN(rawScore)) return '';
    const entryVal = el.querySelector('.entry-input')?.value;
    const norm = entryVal != null ? toNorm(entryVal) : (activeSeed?.norm ?? activeWlEntry?.norm ?? '');
    const effective = rescoreEntry({ norm, score: rawScore }, edits.rescoreRules);
    if (effective === rawScore) return '';
    return `<div class="atom-pop-rescore-note">rescores to ${buildScoreBadgeHTML(effective)}</div>`;
  }

  function refreshRescoreNote() {
    const wrap = el?.querySelector('.atom-pop-rescore-wrap');
    if (wrap) wrap.innerHTML = rescoreNoteHTML();
  }

  function renderHTML(wlEntry, scroller) {
    const seed = activeSeed = resolveSeed(wlEntry);
    const preview = previewWlEntry(seed.entry) ?? wlEntry;
    return `
      <button class="dialog-close-btn" type="button" aria-label="Close">✕</button>
      <div class="atom-pop-fields">
        <label for="atom-pop-entry">Entry</label>
        <input id="atom-pop-entry" class="entry-input" type="text" value="${esc(seed.entry)}">
        <label for="atom-pop-score">Score</label>
        <span class="atom-pop-score-cell">
          <input id="atom-pop-score" class="score-input" type="number" min="0" value="${seed.score}">
          <span class="atom-pop-rescore-wrap"></span>
        </span>
        <label for="atom-pop-comment">Comment</label>
        <input id="atom-pop-comment" class="comment-input" type="text" value="${esc(seed.comment)}">
      </div>
      <div class="atom-pop-prov-wrap">${renderProvenanceHTML(wlEntry)}</div>
      <div class="atom-pop-foot">${renderFooterHTML(preview, scroller)}</div>`;
  }

  // Re-render after an edit/delete commits so the popover reflects the new
  // state. If the entry has been fully removed from the underlying data (e.g.
  // deleting an entry that only My Edits had, or any delete from the My Edits
  // view), there's nothing left to show — close.
  //
  // `resetInputs: true` re-renders everything (including the score/comment
  // inputs) — used after Delete, where the underlying values change. The
  // default leaves the inputs alone so an edit-commit (e.g. tabbing from
  // score to comment) preserves focus and the just-typed value.
  function refresh({ resetInputs = false } = {}) {
    if (!isOpen()) return;
    if (!activeScroller.resultHasEntry(activeWlEntry)) return;
    if (resetInputs) {
      el.innerHTML = renderHTML(activeWlEntry, activeScroller);
      wireFields();
      return;
    }
    refreshDynamicBits();
  }

  function refreshDynamicBits() {
    if (!isOpen()) return;
    const preview = currentPreview();
    const provEl = el.querySelector('.atom-pop-prov-wrap');
    if (provEl) provEl.innerHTML = renderProvenanceHTML(provenanceTarget());
    const footEl = el.querySelector('.atom-pop-foot');
    if (footEl) {
      footEl.innerHTML = renderFooterHTML(preview, activeScroller);
      wireFooter();
    }
  }

  function provenanceTarget() {
    const preview = currentPreview();
    if (preview) return preview;
    const inp = el?.querySelector('.entry-input');
    const raw = inp ? inp.value.trim() : displayOf(activeWlEntry);
    if (!raw) return activeWlEntry;
    return { norm: toNorm(raw), display: null };
  }

  function editTarget() {
    const preview = currentPreview();
    if (preview) return { norm: preview.norm, display: preview.display ?? preview.norm };
    return { norm: activeWlEntry.norm, display: activeWlEntry.display ?? activeWlEntry.norm };
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
    const newValues = readNewValues();
    if (!valuesValid(newValues)) {
      const focusTarget = newValues.raw.length === 0 ? '.entry-input' : '.score-input';
      el.querySelector(focusTarget).focus();
      return;
    }
    activeScroller._onSave?.(saveBaseline(), newValues);
    close();
  }

  function wireFooter() {
    const deleteBtn = el.querySelector('.atom-pop-delete');
    if (deleteBtn) {
      const target = editTarget();
      const scroller = activeScroller;
      deleteBtn.addEventListener('mousedown', e => e.preventDefault());
      deleteBtn.addEventListener('click', () => {
        pendingDelete = true;
        scroller._onDeleteRow?.(target);
      });
    }
    el.querySelector('.atom-pop-cancel').addEventListener('click', close);
    el.querySelector('.atom-pop-save').addEventListener('click', submit);
    refreshSaveEnabled();
  }

  function refreshSaveEnabled() {
    const saveBtn = el.querySelector('.atom-pop-save');
    if (!saveBtn) return;
    saveBtn.disabled = !valuesValid(readNewValues());
  }

  function wireFields() {
    const popover = el;
    const entryInp = popover.querySelector('.entry-input');
    const scoreInp = popover.querySelector('.score-input');
    const commentInp = popover.querySelector('.comment-input');

    entryInp.addEventListener('beforeinput', blockSemicolon);
    commentInp.addEventListener('beforeinput', blockSemicolon);
    entryInp.addEventListener('input', refreshDynamicBits);
    entryInp.addEventListener('input', refreshRescoreNote);
    scoreInp.addEventListener('input', refreshRescoreNote);

    for (const inp of [entryInp, scoreInp, commentInp]) {
      inp.addEventListener('input', refreshSaveEnabled);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    }

    refreshRescoreNote();
    wireFooter();
  }

  function position(anchorEl) {
    if (!anchorEl) {
      const pw = el.offsetWidth, ph = el.offsetHeight;
      el.style.left = Math.max(8, (window.innerWidth  - pw) / 2) + 'px';
      el.style.top  = Math.max(8, (window.innerHeight - ph) / 2) + 'px';
      return;
    }
    const r = anchorEl.getBoundingClientRect();
    el.style.top = (r.bottom + 4) + 'px';
    el.style.left = r.left + 'px';
    requestAnimationFrame(() => {
      const pw = el.offsetWidth, ph = el.offsetHeight;
      let left = r.left;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
      if (left < 8) left = 8;
      let top = r.bottom + 4;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
      el.style.top = top + 'px';
      el.style.left = left + 'px';
    });
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

  function rebindEntry(scroller) {
    if (!isOpen() || activeScroller !== scroller) return;
    const targetNorm = activeWlEntry.norm;
    const targetDisplay = activeWlEntry.display;
    const found = scroller.findResultEntry(targetNorm, targetDisplay);
    const wasPendingDelete = pendingDelete;
    pendingDelete = false;
    if (!found) {
      if (wasPendingDelete) {
        activeWlEntry = { norm: targetNorm, display: targetDisplay, score: '', comment: '' };
        el.innerHTML = renderHTML(activeWlEntry, activeScroller);
        wireFields();
        el.querySelector('.score-input')?.focus();
      }
      return;
    }
    activeWlEntry = found;
    const editing = !wasPendingDelete && containsFocus() && focusEl.matches('.entry-input, .score-input, .comment-input');
    refresh({ resetInputs: !editing });
  }

  return { open, openForCreate, close, isOpen, containsFocus, activeNorm, rebindRow, rebindEntry };
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
