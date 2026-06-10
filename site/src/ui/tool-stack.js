'use strict';

// ─── Tool stack ───────────────────────────────────────────────────────────────
// Tools are catalog records ({ name, icon, category, desc, example, params,
// kind, inputHighlights, outputHighlights, glyph?, run?, group?, isInert? }).
// A filter or transform tool carries a `run`; a group tool carries a `group`.
//
// `isInert(params)` is an optional transparency gate: a tool that is a no-op
// for the given params (an empty Search query) reports `true` and
// `executePipeline` skips its row — so an empty search bar neither filters nor
// contributes a highlight lens.
//
// `kind` is 'filter' (keeps/drops an entry), 'transform' (emits 0+ new entries
// per input), or 'group' (clusters all input rows into GroupRow[] via `group`).
// It may instead be a `(params) => kind` function for a tool that switches
// between filter and transform on its params — resolved per row by `kind()`.
// `inputHighlights` / `outputHighlights` are static booleans: each one means
// the tool highlights the atom it reads / the atom it creates. `currentAtomCount`
// reads them to derive the static atom count; transforms also carry a relation
// `glyph`.
//
// An optional `async prepare(params, ctx)` runs once per stage, after every
// upstream stage has finished; its return value is handed to `run` in place of
// `params` (so a tool can compile a regex or pre-sort letters once instead of
// per row, or build an index over `ctx.input`). It must yield cooperatively
// for any non-trivial work — see docs/design.md § Pipeline execution.
// Tools without a `prepare` get the normalized params object.
//
// `run(entry, prepared, wordlist)` is a per-row pure function — the system
// owns the outer loop, cooperative yielding, abort, atom construction, and
// chain bookkeeping. Filters return `null`/`false` (drop), `true` (keep), or a
// `Range[]` (keep + highlights). Transforms return `TransformOutput[]`, each
// `{ entry, inputHighlights?, outputHighlights? }` where `entry` is a string
// or `[string, score]` for a tool-synthesized entry not in the wordlist.

import { esc } from '../core/util.js';
import { HL_COLORS } from '../engine/search.js';
import {
  TOOL_CATEGORIES, FEATURED_TOOLS, TOOLS, groupColumnCSS, makeToolRow,
} from '../engine/tools.js';
import {
  currentAtomCount, executePipeline, ToolStageError, invalidatePreSearchCache,
} from '../engine/executor.js';
import { bumpCacheVersion } from '../data/state.js';
import {
  buildTextInputHTML, buildParamHTML, syncClearButton,
  buildDragHandleHTML, makeReorderable,
} from './components.js';

// Router (URL persistence), the tool-row error popover, and help-popup
// reattachment all live in the rendering layer (still in main.js). Injected so
// this view doesn't reach upward; boot() supplies them via configureToolStack.
let _navigate         = () => {};
let _showRowError     = () => {};
let _attachHelpPopups = () => {};

export function configureToolStack({ navigate, showRowError, attachHelpPopups }) {
  if (navigate)         _navigate = navigate;
  if (showRowError)     _showRowError = showRowError;
  if (attachHelpPopups) _attachHelpPopups = attachHelpPopups;
}

// A stack mutation invalidates the tool-pipeline cache and bumps the cache
// version; the render effect's cache branch re-runs the pipeline and refreshes
// the scroller. Going through the signal keeps this view off the rendering layer.
function repaintAfterStackChange() {
  invalidatePreSearchCache();
  bumpCacheVersion();
  _navigate();
}

export function mountGroupColumnStyle() {
  const css = groupColumnCSS();
  if (!css) return;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

// ─── Pipeline runtime ─────────────────────────────────────────────────────────
// The runtime wraps `executePipeline` with supersession (a new run aborts the
// in-flight one) and a slow-pipeline indicator that dims the results table
// when the whole run exceeds ~100ms.

// Single-flight controller — every runPipeline call aborts the previous one's
// signal before starting its own run. In-flight tools observe the abort at
// their next `ctx.yield()` (or at the executor's per-row check, for sync tools)
// and bail out; the aborted run's resolved value is discarded by its caller.
let _pipelineController = null;
let _pipelineRunning = 0;
const _pipelineIdleWaiters = [];

// Resolves the next time no pipeline run is in flight. Used by the test bridge
// to await async runs triggered by keystroke / setStack before reading the DOM.
export function pipelineIdle() {
  if (_pipelineRunning === 0) return Promise.resolve();
  return new Promise(r => _pipelineIdleWaiters.push(r));
}

// Run the current stack against the merged wordlist. Returns
// `{ rows, atomCount }` on completion, or `{ aborted: true }` if a newer call
// superseded this one. Callers drop their result on `aborted` rather than
// touching the scroller — the superseding caller will produce the next update.
//
// The slow-pipeline indicator is one global signal: a timer dims the results
// table when the whole run total crosses the threshold (not per-step — a long
// pipeline of individually-fast tools still trips it).
export async function runPipeline(mergedWordlist, stack) {
  _pipelineController?.abort();
  const ac = new AbortController();
  _pipelineController = ac;
  _pipelineRunning++;

  const panel = document.getElementById('entries-table-panel');
  panel?.classList.add('pipeline-running');

  try {
    const result = await executePipeline(mergedWordlist, stack, ac.signal);
    return { ...result, aborted: false };
  } catch (e) {
    if (ac.signal.aborted) return { aborted: true };
    if (e instanceof ToolStageError) {
      return { aborted: false, errored: true, rows: [], atomCount: currentAtomCount(stack), grouped: false };
    }
    throw e;
  } finally {
    panel?.classList.remove('pipeline-running');
    if (_pipelineController === ac) _pipelineController = null;
    _pipelineRunning--;
    if (_pipelineRunning === 0) {
      const waiters = _pipelineIdleWaiters.splice(0);
      queueMicrotask(() => waiters.forEach(fn => fn()));
    }
  }
}

// ─── Tool-domain builders ───────────────────────────────────────────────────

export function buildFindReplaceCaretHTML(expanded, rowToken) {
  return `<button type="button" class="find-replace-caret" data-replace-row="${rowToken}"`
    + ` aria-expanded="${expanded}" title="Replace" aria-label="Replace">`
    + `<svg class="find-replace-caret-glyph" width="11" height="11" aria-hidden="true"><use href="#icon-chevron-right"/></svg></button>`;
}

export function buildToolRowPartsHTML(params, values, toolKey, wiringFn, opts = {}) {
  const asideEls = [];
  let main = '';
  let caret = '';
  let replace = '';
  let frPattern = null, frReplace = null;
  if (opts.findReplace) {
    frPattern = params.find(p => p.type !== 'checkbox' && p.key !== 'replace');
    frReplace = params.find(p => p.key === 'replace');
    if (frPattern && frReplace) {
      const expanded = !!opts.expanded;
      caret = buildFindReplaceCaretHTML(expanded, opts.rowToken);
      const patternInput = buildTextInputHTML(frPattern, values?.[frPattern.key], toolKey, wiringFn(frPattern));
      main = `<span class="tool-row-param tool-row-param-text">${patternInput}</span>`;
      const replaceInput = buildTextInputHTML(frReplace, values?.[frReplace.key], toolKey, wiringFn(frReplace));
      replace = `<span class="tool-row-param tool-row-param-text tool-row-replace"${expanded ? '' : ' hidden'}>${replaceInput}</span>`;
    } else {
      frPattern = frReplace = null;
    }
  }
  for (const p of params) {
    if (p === frPattern || p === frReplace) continue;
    const html = buildParamHTML(p, values?.[p.key], toolKey, wiringFn(p));
    if (p.type === 'checkbox') asideEls.push(html);
    else if (!main) main = html;
    else asideEls.push(html);
  }
  const asides = asideEls.length ? `<div class="tool-row-asides">${asideEls.join('')}</div>` : '';
  return { caret, main, asides, replace };
}

export function buildSearchBarHTML() {
  const row = ToolStack.getSearchBarRow();
  // `bar`, not a numeric index: the bar's DOM persists across rerenderRows, so
  // a baked-in index would silently point at the wrong row once tools are
  // added above it, routing search input into another row's params.
  const parts = buildToolRowPartsHTML(TOOLS.search.params, row.params, 'search',
    p => ` data-row="bar" data-key="${p.key}"${p.key === 'pattern' ? ' title="Search (Alt-S)"' : ''}`,
    { findReplace: true, rowToken: 'bar', expanded: ToolStack.isRowExpanded('bar') });
  const label = buildToolLabelHTML({ icon: '<svg width="16" height="16" aria-hidden="true"><use href="#icon-search"/></svg>', name: 'Search' });
  const solo = ToolStack.getUserStack().length === 0 ? ' solo' : '';
  return `<div class="search-bar${solo}">
      <span class="drag-handle" aria-hidden="true">≡</span>
      ${label}
      ${parts.caret}
      ${parts.main}
      ${parts.asides}
      ${parts.replace}
    </div>`;
}

// Inline icon + name pair used by tool rows, the search bar, etc.
// `icon` is raw HTML (emoji string or <svg>); `name` is plain text.
export function buildToolLabelHTML({ icon, name }, suffix) {
  const suf = suffix ? `<span class="tool-row-name-suffix"> · ${esc(suffix)}</span>` : '';
  return `<span class="tool-label"><span class="icon tool-row-icon">${icon}</span> <span class="tool-row-name">${esc(name)}${suf}</span></span>`;
}

export function allModeTooltip({ blocked, active, kind }) {
  if (active) return kind === 'corner' ? 'Already showing all' : 'Show one';
  if (blocked) return 'Only one tool can show all at a time';
  return 'Show all';
}

export function buildToolCardHTML(toolKey, tool, { allButton = true } = {}) {
  let allBtn = '';
  if (allButton && tool.group) {
    const title = allModeTooltip({ blocked: false, active: false, kind: 'corner' });
    allBtn = `<button type="button" class="tool-card-all-btn" data-all-tool="${esc(toolKey)}" title="${esc(title)}" aria-label="${esc(title)}">✱</button>`;
  }
  return `<div class="tool-card" data-tool="${esc(toolKey)}">
    ${allBtn}
    <div class="tool-card-name">${buildToolLabelHTML(tool)}</div>
    <div class="tool-card-desc">${esc(tool.desc)}</div>
    <div class="tool-card-example">${esc(tool.example)}</div>
  </div>`;
}

export const ToolStack = (() => {
  // The user's pipeline. The last row is always the permanent Search bar —
  // rendered with .search-bar chrome, undeletable; user tools sit above it.
  let stack = [makeToolRow('search')];

  // The permanent Search bar (always the last row) and the user tools above
  // it. getStack() is the full pipeline — what the executor and URL consume.
  function getSearchBarRow() { return stack[stack.length - 1]; }
  function getUserStack() { return stack.slice(0, -1); }

  function isRowExpanded(token) {
    const row = token === 'bar' ? getSearchBarRow() : stack[token];
    return !!(row && (row._replaceExpanded || (row.params.replace || '').trim()));
  }

  function buildRowHTML(idx, row) {
    // The last row is the permanent Search bar — its own chrome, no remove
    // button (undeletable). Everything above it is an ordinary tool row.
    if (idx === stack.length - 1) return buildSearchBarHTML();
    const tool = row.def;
    const parts = buildToolRowPartsHTML(tool.params, row.params, row.tool,
      p => ` data-row="${idx}" data-key="${p.key}"`,
      { findReplace: !!tool.findReplace, rowToken: idx, expanded: isRowExpanded(idx) });
    let main = parts.main;
    if (tool.group) main = decorateMainWithAllToggle(main, idx, row);
    const remove = `<button type="button" class="tool-row-remove" data-remove="${idx}" title="Remove" aria-label="Remove ${esc(tool.name)}"><svg width="12" height="12"><use href="#icon-x"/></svg></button>`;
    const errBtn = `<button type="button" class="icon tool-row-error-btn" data-error-row="${idx}" aria-label="Tool error" hidden>⚠️</button>`;
    return `<div class="tool-row">
      ${buildDragHandleHTML()}
      ${buildToolLabelHTML(tool)}
      ${parts.caret}
      ${main}
      ${parts.asides}
      ${errBtn}
      ${remove}
      ${parts.replace}
    </div>`;
  }

  function decorateMainWithAllToggle(mainHTML, rowIdx, row) {
    const active = !!row.grouped;
    const blocked = !active && stack.some(r => r !== row && r.grouped);
    const wrapClasses = `clearable-input has-all-toggle${active ? ' all-on' : ''}`;
    const toggle = buildAllToggleHTML(rowIdx, active, blocked);
    let html = mainHTML
      .replace('<span class="clearable-input">', `<span class="${wrapClasses}">`)
      .replace('</span></span>', `${toggle}</span></span>`);
    if (active) {
      html = html.replace(/placeholder="[^"]*"/, 'placeholder="all"')
                 .replace(/value="[^"]*"/, 'value=""');
    }
    return html;
  }

  function applyAllModeButtonState(btn, { blocked, active, kind }) {
    btn.classList.toggle('active', !!active);
    btn.classList.toggle('disabled', !!blocked);
    const title = allModeTooltip({ blocked, active, kind });
    btn.title = title;
    btn.setAttribute('aria-label', title);
    if (kind === 'toggle') btn.setAttribute('aria-pressed', String(!!active));
  }

  function buildAllToggleHTML(rowIdx, active, blocked) {
    const cls = ['tool-row-all-toggle'];
    if (active) cls.push('active');
    if (blocked) cls.push('disabled');
    const title = allModeTooltip({ blocked, active, kind: 'toggle' });
    return `<button type="button" class="${cls.join(' ')}" data-all-toggle="${rowIdx}"`
      + ` title="${esc(title)}" aria-pressed="${active}" aria-label="${esc(title)}">`
      + `<span class="ast-glyph" aria-hidden="true">✱</span></button>`;
  }

  function buildGalleryHTML() {
    const byCategory = new Map(TOOL_CATEGORIES.map(c => [c.id, []]));
    Object.entries(TOOLS).forEach(([key, tool]) => {
      byCategory.get(tool.category)?.push([key, tool]);
    });
    return TOOL_CATEGORIES.map((cat, i) => {
      const cards = byCategory.get(cat.id) || [];
      if (!cards.length) return '';
      const chip = `<div class="gallery-cat-chip hl-cat-${i % HL_COLORS}">${esc(cat.label)}</div>`;
      const [first, ...rest] = cards;
      // Bind the chip to its first card as one flex item — otherwise a wrap can
      // strand the chip alone at a row's end while its card starts the next row.
      return `<div class="gallery-cat-group">${chip}${buildToolCardHTML(first[0], first[1])}</div>`
           + rest.map(([key, tool]) => buildToolCardHTML(key, tool)).join('');
    }).join('');
  }

  function buildFeaturedRowHTML() {
    const cards = FEATURED_TOOLS.map(key => {
      const tool = TOOLS[key];
      return tool ? buildToolCardHTML(key, tool) : '';
    }).join('');
    const moreCount = Object.keys(TOOLS).length - FEATURED_TOOLS.length;
    const moreTile = `<button type="button" class="featured-more-tile" aria-label="Browse all tools">
      <span class="featured-more-tile-count">+${moreCount}</span>
      <span class="featured-more-tile-label">more</span>
      <svg class="featured-more-tile-chevron" width="10" height="6" aria-hidden="true"><use href="#icon-arrow"/></svg>
    </button>`;
    return cards + moreTile;
  }

  function relayoutFeaturedRow(container) {
    const CARD_MIN = 140, CARD_MAX = 200, GAP = 8;
    const cards = container.querySelectorAll('.tool-card');
    const moreCountEl = container.querySelector('.featured-more-tile-count');
    const totalTools = Object.keys(TOOLS).length;
    if (window.matchMedia('(max-width: 759px)').matches) {
      cards.forEach(c => { c.hidden = false; });
      container.style.gridTemplateColumns = '';
      moreCountEl.textContent = `+${totalTools - FEATURED_TOOLS.length}`;
      return;
    }
    const w = container.clientWidth;
    let maxN = Math.max(1, Math.floor((w - CARD_MIN) / (CARD_MIN + GAP)));
    maxN = Math.min(maxN, FEATURED_TOOLS.length);
    cards.forEach((c, i) => { c.hidden = i >= maxN; });
    moreCountEl.textContent = `+${totalTools - maxN}`;
    const template = `repeat(${maxN + 1}, minmax(${CARD_MIN}px, ${CARD_MAX}px))`;
    container.style.gridTemplateColumns = template;
  }

  // Used by mountPanel for the initial render. Mutations after that
  // re-render the user tool rows via rerenderRows, which leaves the Search
  // bar's DOM in place. The hover insertion cursor is purely transient and
  // lives only in the DOM, so it's not serialized here.
  function buildRowsHTML() {
    return stack.map((row, idx) => buildRowHTML(idx, row)).join('');
  }

  function buildHTML() {
    return `<div id="tool-stack">${buildRowsHTML()}</div>`;
  }

  function stackEl() { return document.getElementById('tool-stack'); }
  function panelEl() { return document.getElementById('detail-panel'); }

  function rowEls() {
    const e = stackEl();
    if (!e) return [];
    return Array.from(e.querySelectorAll('.tool-row'));
  }

  function focusRowInput(idx) {
    const el = rowEls()[idx];
    if (!el) return;
    const allBtn = el.querySelector('.tool-row-all-toggle.active');
    if (allBtn) { allBtn.focus(); return; }
    el.querySelector('input[type="text"], input[type="number"]')?.focus();
  }

  function flashRow(idx) {
    rowEls()[idx]?.classList.add('flash');
  }

  function refreshGalleryActive() {
    // The permanent Search bar isn't a "tool the user added" — gallery-active
    // marks only the user tools above it.
    const userStack = getUserStack();
    const inStack = new Set(userStack.map(r => r.tool));
    const inAllMode = new Set(userStack.filter(r => r.grouped).map(r => r.tool));
    const allTaken = inAllMode.size > 0;
    document.querySelectorAll('.tool-card[data-tool]').forEach(card => {
      card.classList.toggle('active', inStack.has(card.dataset.tool));
      card.removeAttribute('title');
    });
    document.querySelectorAll('.tool-card-all-btn[data-all-tool]').forEach(btn => {
      applyAllModeButtonState(btn, {
        blocked: allTaken,
        active: inAllMode.has(btn.dataset.allTool),
        kind: 'corner',
      });
    });
  }

  function searchBarEl() { return panelEl()?.querySelector('.search-bar'); }
  function removeCursor() { document.querySelector('.tool-stack-cursor')?.remove(); }

  // Hovering a gallery card shows a .tool-stack-cursor — an insertion caret
  // at the seam where the click will drop the tool: between the last user
  // tool row and the permanent Search bar, or the top of the stack when no
  // user tools exist yet. Parented in .search-bar, absolutely positioned so
  // it adds zero vertical space. Every click appends, so there's nothing
  // destructive to preview — the cursor is the whole hover affordance.
  function showInsertCursor() {
    const sbar = searchBarEl();
    if (sbar && !sbar.querySelector('.tool-stack-cursor')) {
      const cursor = document.createElement('div');
      cursor.className = 'tool-stack-cursor';
      sbar.appendChild(cursor);
    }
  }

  // Rebuilds the user tool rows from `stack`, leaving the permanent Search
  // bar's DOM in place — so its input focus and the sort toolbar mounted
  // inside it survive a tool add/remove. Help popups are then re-attached,
  // since a rebuilt tool row gets fresh input anchors. A full re-render
  // (which does rebuild the bar) happens only via mountPanel.
  function rerenderRows() {
    const e = stackEl();
    if (!e) return;
    removeCursor();
    const bar = e.querySelector('.search-bar');
    e.querySelectorAll('.tool-row').forEach(r => r.remove());
    const userStack = getUserStack();
    userStack.forEach((row, i) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildRowHTML(i, row);
      e.insertBefore(tmp.firstElementChild, bar);
    });
    bar?.classList.toggle('solo', userStack.length === 0);
    _attachHelpPopups();
  }

  // Counterpart to rerenderRows for when a reorder changes which row *is* the
  // bar (a Search row dropped below it): rerenderRows preserves the bar's DOM in
  // place, so reusing it here would leave a stale bar plus a duplicate tool row.
  function rerenderAll() {
    const e = stackEl();
    if (!e) return;
    removeCursor();
    e.innerHTML = buildRowsHTML();
    _attachHelpPopups();
  }

  function add(toolKey, { grouped = false } = {}) {
    if (!TOOLS[toolKey]) return;
    if (grouped && !TOOLS[toolKey].group) return;
    if (grouped && stack.some(r => r.grouped)) return;
    const idx = stack.length - 1;            // insert just above the Search bar
    stack.splice(idx, 0, makeToolRow(toolKey, {}, grouped));
    rerenderRows();
    focusRowInput(idx);
    flashRow(idx);
    refreshGalleryActive();
    repaintAfterStackChange();
  }

  function removeAt(idx) {
    // The permanent Search bar (last row) is undeletable.
    if (idx < 0 || idx >= stack.length - 1) return;
    stack.splice(idx, 1);
    rerenderRows();
    refreshGalleryActive();
    repaintAfterStackChange();
  }

  function toggleAllMode(idx) {
    const row = stack[idx];
    if (!row || !row.def.group) return;
    const turningOn = !row.grouped;
    if (turningOn && stack.some(r => r !== row && r.grouped)) return;
    row.grouped = turningOn;
    const rowEl = rowEls()[idx];
    const wrap = rowEl?.querySelector('.clearable-input.has-all-toggle');
    const btn = rowEl?.querySelector('.tool-row-all-toggle');
    if (wrap && btn) {
      applyAllModeButtonState(btn, { blocked: false, active: turningOn, kind: 'toggle' });
      wrap.classList.toggle('all-on', turningOn);
      const input = wrap.querySelector('input');
      const firstParam = row.def.params[0];
      if (input && firstParam) {
        if (turningOn) {
          input.placeholder = 'all';
          input.value = '';
        } else {
          input.placeholder = firstParam.placeholder || '';
          input.value = row.params[firstParam.key] || '';
        }
        syncClearButton(input);
      }
    }
    refreshOtherAllToggles(idx);
    refreshGalleryActive();
    repaintAfterStackChange();
  }

  function refreshOtherAllToggles(skipIdx) {
    const groupTaken = stack.some(r => r.grouped);
    rowEls().forEach((el, i) => {
      if (i === skipIdx) return;
      const otherBtn = el.querySelector('.tool-row-all-toggle');
      if (!otherBtn) return;
      const otherRow = stack[i];
      applyAllModeButtonState(otherBtn, {
        blocked: !otherRow.grouped && groupTaken,
        active: !!otherRow.grouped,
        kind: 'toggle',
      });
    });
  }

  // The Search bar is pinned as the last row — clamp both indices out of its slot.
  function reorderAt(fromIdx, toIdx) {
    const lastUser = stack.length - 1;
    if (fromIdx === toIdx ||
        fromIdx < 0 || fromIdx >= lastUser ||
        toIdx < 0 || toIdx >= lastUser) return;
    const [row] = stack.splice(fromIdx, 1);
    stack.splice(toIdx, 0, row);
    rerenderRows();
    repaintAfterStackChange();
  }

  // The pushed row becomes the new last row and so the new bar — gated to Search
  // rows so the last row stays a Search bar and the bar stays permanent.
  function moveBelowBar(fromIdx) {
    const row = stack[fromIdx];
    if (!row || row.tool !== 'search') return;
    stack.splice(fromIdx, 1);
    stack.push(row);
    rerenderAll();
    refreshGalleryActive();
    repaintAfterStackChange();
  }

  function init() {
    const featuredCards = document.querySelector('#featured-row .featured-cards');
    if (featuredCards) {
      featuredCards.innerHTML = buildFeaturedRowHTML();
      featuredCards.addEventListener('click', (e) => {
        if (e.target.closest('.featured-more-tile')) {
          ToolPicker.toggle();
          return;
        }
        const allBtn = e.target.closest('.tool-card-all-btn[data-all-tool]');
        if (allBtn) {
          if (!allBtn.classList.contains('disabled') && TOOLS[allBtn.dataset.allTool]) {
            ToolPicker.pick(allBtn.dataset.allTool, { grouped: true });
          }
          return;
        }
        const card = e.target.closest('.tool-card[data-tool]');
        if (!card || card.classList.contains('disabled')) return;
        const toolKey = card.dataset.tool;
        if (!TOOLS[toolKey]) return;
        ToolPicker.pick(toolKey);
      });
      featuredCards.querySelectorAll('.tool-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
          if (!card.classList.contains('disabled')) showInsertCursor();
        });
        card.addEventListener('mouseleave', () => removeCursor());
      });
      relayoutFeaturedRow(featuredCards);
      new ResizeObserver(() => relayoutFeaturedRow(featuredCards)).observe(featuredCards);
    }

    const p = panelEl();
    p?.addEventListener('click', (e) => {
      const errBtn = e.target.closest('.tool-row-error-btn[data-error-row]');
      if (errBtn) {
        e.stopPropagation();
        if (window.matchMedia('(hover: hover)').matches) return;
        const idx = parseInt(errBtn.dataset.errorRow, 10);
        const msg = stack[idx]?._error || '';
        _showRowError(errBtn, msg);
        return;
      }
      const removeBtn = e.target.closest('.tool-row-remove[data-remove]');
      if (removeBtn) {
        removeAt(parseInt(removeBtn.dataset.remove, 10));
        return;
      }
      const allBtn = e.target.closest('.tool-row-all-toggle[data-all-toggle]');
      if (allBtn) {
        if (allBtn.classList.contains('disabled')) return;
        toggleAllMode(parseInt(allBtn.dataset.allToggle, 10));
        return;
      }
      const caret = e.target.closest('.find-replace-caret[data-replace-row]');
      if (caret) {
        const token = caret.dataset.replaceRow;
        const row = token === 'bar' ? getSearchBarRow() : stack[parseInt(token, 10)];
        if (!row) return;
        const expanding = !isRowExpanded(token);
        row._replaceExpanded = expanding;
        caret.setAttribute('aria-expanded', String(expanding));
        const wrap = caret.closest('.tool-row, .search-bar').querySelector('.tool-row-replace');
        wrap.hidden = !expanding;
        const replaceInput = wrap.querySelector('input');
        if (expanding) {
          row.params.replace = replaceInput.value;
          replaceInput.focus();
        } else {
          delete row.params.replace;
        }
        if (token !== 'bar') invalidatePreSearchCache();
        bumpCacheVersion();
        _navigate();
        return;
      }
    });
    p?.addEventListener('input', (e) => {
      const input = e.target.closest('input[data-row]');
      if (!input) return;
      const rowAttr = input.dataset.row;
      const row = rowAttr === 'bar' ? getSearchBarRow() : stack[parseInt(rowAttr, 10)];
      const key = input.dataset.key;
      if (row) {
        if (input.type === 'checkbox') {
          row.params[key] = input.checked;
        } else if (input.type === 'range' && input.dataset.rangeValues) {
          const values = input.dataset.rangeValues.split(',');
          row.params[key] = values[parseInt(input.value, 10)] || '';
        } else {
          row.params[key] = input.value;
        }
        if (rowAttr !== 'bar') invalidatePreSearchCache();
        bumpCacheVersion();
        _navigate();
      }
    });

    makeReorderable(p, {
      handleSelector: '.drag-handle:not([aria-hidden])',
      // The bar is a drop target (so a Search row can land below it) but never a
      // drag source — safe only because its handle is aria-hidden, set elsewhere.
      itemSelector:   '.tool-row, .search-bar',
      canDrop: (fromEl, beforeEl) => {
        if (beforeEl) return true;
        const idx = rowEls().indexOf(fromEl);
        return idx >= 0 && stack[idx]?.tool === 'search';
      },
      onReorder: (fromEl, beforeEl) => {
        const rows = rowEls();
        const fromIdx = rows.indexOf(fromEl);
        if (fromIdx < 0) return;
        if (!beforeEl) { moveBelowBar(fromIdx); return; }
        let toIdx = beforeEl.classList.contains('search-bar') ? rows.length : rows.indexOf(beforeEl);
        if (toIdx < 0) return;
        if (toIdx > fromIdx) toIdx--;
        reorderAt(fromIdx, toIdx);
      },
    });

    refreshGalleryActive();
  }

  // setStack replaces the internal stack without animation or URL roundtrip —
  // used by Router.applyURL on init. The decoded rows are the full pipeline;
  // their trailing Search row (if any) is the permanent bar — append an empty
  // one when absent so the invariant "last row = Search bar" always holds.
  // The next mountPanel call (in renderAll) renders the rows; init()
  // attaches handlers afterwards.
  function setStack(newStack) {
    const rows = Array.isArray(newStack) ? newStack.slice() : [];
    if (!rows.length || rows[rows.length - 1].tool !== 'search') {
      rows.push(makeToolRow('search'));
    }
    stack = rows;
    invalidatePreSearchCache();
  }
  function getStack() { return stack; }

  function refreshErrorMarks() {
    const userRows = getUserStack();
    rowEls().forEach((rowEl, idx) => {
      const btn = rowEl.querySelector('.tool-row-error-btn');
      if (!btn) return;
      const err = userRows[idx]?._error;
      btn.hidden = !err;
      if (err) btn.title = err;
      else btn.removeAttribute('title');
    });
  }

  return { buildHTML, buildGalleryHTML, refreshGalleryActive, init, add, getStack, setStack, getSearchBarRow, getUserStack, isRowExpanded, refreshErrorMarks };
})();

export const ToolPicker = (() => {
  let host, searchInput, closeBtn, gallery, galleryInner;

  let _isOpen          = false;
  let _addedDuringOpen = false;

  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    let visibleCount = 0;
    gallery.querySelectorAll('.tool-card[data-tool]').forEach(card => {
      const tool = TOOLS[card.dataset.tool];
      if (!tool) { card.hidden = true; return; }
      const match = !q || (tool.name + ' ' + (tool.desc || '')).toLowerCase().includes(q);
      card.hidden = !match;
      if (match) visibleCount++;
    });
    gallery.querySelectorAll('.gallery-cat-group').forEach(group => {
      let any = !!group.querySelector('.tool-card[data-tool]:not([hidden])');
      let next = group.nextElementSibling;
      while (!any && next && !next.classList.contains('gallery-cat-group')) {
        if (next.classList.contains('tool-card') && !next.hidden) any = true;
        next = next.nextElementSibling;
      }
      group.hidden = !any;
    });
    let empty = galleryInner.querySelector('.gallery-empty');
    if (visibleCount === 0) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'gallery-empty';
        empty.innerHTML = '<p>No tools match.</p>';
        galleryInner.appendChild(empty);
      }
      empty.hidden = false;
    } else if (empty) {
      empty.hidden = true;
    }
  }

  function open() {
    if (_isOpen) return;
    _isOpen = true;
    _addedDuringOpen = false;
    searchInput.value = '';
    applyFilter();
    ToolStack.refreshGalleryActive();
    closeBtn.hidden = false;
    host.classList.add('expanded');
    document.body.classList.add('picker-expanded');
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    requestAnimationFrame(() => searchInput.focus());
    document.addEventListener('mousedown', onOutsideMouseDown, true);
  }

  function close() {
    if (!_isOpen) return;
    _isOpen = false;
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    host.classList.remove('expanded');
    document.body.classList.remove('picker-expanded');
    closeBtn.hidden = true;
    searchInput.blur();
    if (_addedDuringOpen) {
      const rows = document.querySelectorAll('#tool-stack .tool-row');
      const lastRow = rows[rows.length - 1];
      const allBtn = lastRow?.querySelector('.tool-row-all-toggle.active');
      if (allBtn) allBtn.focus();
      else lastRow?.querySelector('input[type="text"], input[type="number"]')?.focus();
    }
  }

  function pick(toolKey, opts) {
    ToolStack.add(toolKey, opts);
    _addedDuringOpen = true;
    close();
  }

  function onOutsideMouseDown(e) {
    if (!_isOpen) return;
    if (host.contains(e.target)) return;
    close();
  }

  function toggle() { _isOpen ? close() : open(); }

  function mount() {
    host        = document.getElementById('featured-row');
    searchInput = document.getElementById('tool-picker-search');
    closeBtn    = host.querySelector('.picker-close');
    gallery     = host.querySelector('.picker-gallery');
    gallery.innerHTML = `<div class="picker-gallery-inner">${ToolStack.buildGalleryHTML()}</div>`;
    galleryInner = gallery.querySelector('.picker-gallery-inner');

    searchInput.addEventListener('click', () => open());
    searchInput.addEventListener('input', () => { if (!_isOpen) open(); applyFilter(); });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = gallery.querySelector('.tool-card[data-tool]:not([hidden]):not(.disabled)');
      if (!first) return;
      pick(first.dataset.tool);
    });

    closeBtn.addEventListener('click', () => close());

    gallery.addEventListener('click', (e) => {
      const allBtn = e.target.closest('.tool-card-all-btn[data-all-tool]');
      if (allBtn) {
        e.stopPropagation();
        if (allBtn.classList.contains('disabled')) return;
        const key = allBtn.dataset.allTool;
        if (!TOOLS[key]) return;
        pick(key, { grouped: true });
        return;
      }
      const card = e.target.closest('.tool-card[data-tool]');
      if (!card || card.classList.contains('disabled')) return;
      const key = card.dataset.tool;
      if (!TOOLS[key]) return;
      pick(key);
    });

    document.addEventListener('keydown', (e) => {
      if (_isOpen) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        return;
      }
      const isAltT = e.altKey && e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      const isCmdK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey;
      if (isAltT || isCmdK) {
        e.preventDefault();
        open();
      }
    });
  }

  return { mount, open, close, toggle, pick };
})();
