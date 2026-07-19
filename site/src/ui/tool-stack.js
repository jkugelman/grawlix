'use strict';

// ─── Tool stack ───────────────────────────────────────────────────────────────
// Tools are catalog records ({ name, icon, category, desc, example, params,
// kind, inputHighlights, outputHighlights, glyph?, run?, group?, isInert?,
// error?, quickFix? }).
// A filter or transform tool carries a `run`; a group tool carries a `group`.
//
// `isInert(params)` is an optional transparency gate: a tool that is a no-op
// for the given params (an empty Search query) reports `true` and
// `executePipeline` skips its row — so an empty search bar neither filters nor
// contributes a highlight lens.
//
// `kind` is 'filter' (keeps/drops an entry), 'transform' (emits 0+ new entries
// per input), or 'group' (clusters all input rows into GroupRow[] via `group`).
// It may instead be a `(params, allMode) => kind` function: such a tool reads
// the `✱` flag and decides its own all-mode kind, rather than a grouped row
// defaulting to 'group' (Caesar's all-mode is a transform when a shift is set).
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
import { MATCH_PARAM } from '../engine/tools/shared.js';
import { runOnWorker, preloadWorkerAsset } from './pipeline-worker.js';
import { resetPipelineProgress } from './entries-table.js';
import { bumpPipelineVersion, setResultsStale } from '../data/state.js';
import {
  buildTextInputHTML, buildParamHTML, syncClearButton,
  buildDragHandleHTML, makeReorderable, positionPopover,
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

// A stack mutation re-runs the pipeline but doesn't touch the sources, so it
// bumps pipelineVersion$, not cacheVersion$ — the latter would needlessly rebuild
// the merged corpus. Going through the signal keeps this view off the rendering
// layer.
function repaintAfterStackChange() {
  bumpPipelineVersion();
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

let _pipelineRunning = 0;
const _pipelineIdleWaiters = [];

// Resolves the next time no pipeline run is in flight. Used by the test bridge
// to await async runs triggered by keystroke / setStack before reading the DOM.
export function pipelineIdle() {
  if (_pipelineRunning === 0) return Promise.resolve();
  return new Promise(r => _pipelineIdleWaiters.push(r));
}

// Run the current stack against the active scope on the worker. Returns
// `{ rows, atomCount }` on completion, or `{ aborted: true }` if a newer call
// superseded this one. Callers drop their result on `aborted` rather than
// touching the scroller — the superseding caller will produce the next update.
//
// The slow-pipeline indicator is one global signal: a timer dims the results
// table when the whole run total crosses the threshold (not per-step — a long
// pipeline of individually-fast tools still trips it).
export async function runPipeline(stack, sort) {
  // A full re-run adopts the fresh corpus, so it flushes any refresh-on-consent pin
  // (a reproject deliberately does NOT — it re-derives the pinned result in place).
  setResultsStale(false);
  _pipelineRunning++;

  const panel = document.getElementById('entries-table-panel');
  panel?.classList.add('pipeline-running');
  resetPipelineProgress();   // fresh run starts on the indefinite spinner until its own progress arrives

  try {
    return await runOnWorker(stack, sort);
  } finally {
    panel?.classList.remove('pipeline-running');
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

export function buildPairListHTML(params, values, toolKey, rowToken) {
  const stringP = params.find(p => p.key === 'string');
  const symbolP = params.find(p => p.key === 'symbol');
  const strings = (values.string && values.string.length) ? values.string : [''];
  const n = Math.max(strings.length, (values.symbol || []).length, 1);
  let rows = '';
  for (let i = 0; i < n; i++) {
    const stringHTML = buildTextInputHTML(stringP, strings[i] || '', toolKey,
      ` data-row="${rowToken}" data-key="string" data-pair="${i}"`);
    const symbolHTML = buildTextInputHTML(symbolP, (values.symbol || [])[i] || '', toolKey,
      ` data-row="${rowToken}" data-key="symbol" data-pair="${i}" data-symbol-suggest`);
    const control = i === 0
      ? `<button type="button" class="rebus-pair-add" data-row="${rowToken}" title="Add replacement" aria-label="Add replacement"><svg width="13" height="13"><use href="#icon-plus"/></svg></button>`
      : `<button type="button" class="rebus-pair-remove" data-row="${rowToken}" data-pair="${i}" title="Remove" aria-label="Remove replacement"><svg width="10" height="10"><use href="#icon-x"/></svg></button>`;
    rows += `<div class="rebus-pair">${stringHTML}<span class="rebus-arrow" aria-hidden="true">→</span>${symbolHTML}${control}</div>`;
  }
  return `<div class="rebus-pairs">${rows}</div>`;
}

export function buildToolRowPartsHTML(params, values, toolKey, wiringFn, opts = {}) {
  if (params.some(p => p.repeat)) {
    return { caret: '', main: buildPairListHTML(params, values, toolKey, opts.rowToken), asides: '', replace: '' };
  }
  const asideEls = [];
  const replaceAsideEls = [];
  let main = '';
  let caret = '';
  let replace = '';
  let frPattern = null, frReplace = null;
  if (opts.findReplace) {
    frPattern = params.find(p => p.type !== 'checkbox' && p.key !== 'replace');
    frReplace = params.find(p => p.key === 'replace');
    if (frPattern && frReplace) {
      caret = buildFindReplaceCaretHTML(!!opts.expanded, opts.rowToken);
      const patternInput = buildTextInputHTML(frPattern, values?.[frPattern.key], toolKey, wiringFn(frPattern));
      main = `<span class="tool-row-param tool-row-param-text">${patternInput}</span>`;
    } else {
      frPattern = frReplace = null;
    }
  }
  for (const p of params) {
    if (p === frPattern || p === frReplace) continue;
    const html = buildParamHTML(p, values?.[p.key], toolKey, wiringFn(p));
    if (frReplace && p.replaceScoped) replaceAsideEls.push(html);
    else if (p.type === 'checkbox') asideEls.push(html);
    else if (!main) main = html;
    else asideEls.push(html);
  }
  if (frReplace) {
    const replaceInput = buildTextInputHTML(frReplace, values?.[frReplace.key], toolKey, wiringFn(frReplace));
    const replaceAsides = replaceAsideEls.length ? `<div class="tool-row-asides">${replaceAsideEls.join('')}</div>` : '';
    replace = `<div class="tool-row-replace"${opts.expanded ? '' : ' hidden'}>`
      + `<span class="tool-row-param tool-row-param-text">${replaceInput}</span>${replaceAsides}</div>`;
  }
  if (opts.quickFix) asideEls.push(opts.quickFix);
  const asides = asideEls.length ? `<div class="tool-row-asides">${asideEls.join('')}</div>` : '';
  return { caret, main, asides, replace };
}

export const SymbolSuggest = (() => {
  let el = null, activeInput = null;
  const CIRCLED = [
    ...Array.from({ length: 26 }, (_, i) => String.fromCodePoint(0x24B6 + i)),   // Ⓐ..Ⓩ
    String.fromCodePoint(0x24EA),                                                // ⓪
    ...Array.from({ length: 9 }, (_, i) => String.fromCodePoint(0x2460 + i)),    // ①..⑨
  ];
  const SYMBOLS = ['@', '#', '$', '%', '&', '*', '+', '=', '~', '^', '!', '?', '/', '|', '<', '>', '(', ')'];

  const reflow = () => { if (el?.classList.contains('open') && activeInput) positionPopover(el, activeInput, { placement: 'below' }); };

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'popup-help symbol-suggest';
    el.innerHTML = `<div class="symbol-grid">`
      + [...SYMBOLS, ...CIRCLED].map(s => `<button type="button" class="symbol-cell" data-symbol="${esc(s)}">${esc(s)}</button>`).join('')
      + `</div>`;
    // Keep the symbol input focused on click — otherwise blur closes the popover
    // before the symbol click lands and nothing is inserted.
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('click', (e) => {
      const cell = e.target.closest('.symbol-cell');
      if (!cell || !activeInput) return;
      activeInput.value = cell.dataset.symbol;
      syncClearButton(activeInput);
      activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.body.appendChild(el);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return el;
  }

  return {
    open(input) {
      activeInput = input;
      ensure().classList.add('open');
      positionPopover(el, input, { placement: 'below' });
    },
    close() {
      el?.classList.remove('open');
      activeInput = null;
    },
  };
})();

// Renders for every filter-CAPABLE tool, graying out when params currently make the
// row a transform. Gating on kind() instead reads cleaner but rebuilds the row
// mid-keystroke, dropping the search bar's focus.
function invertOptsFor(row, rowToken) {
  const def = TOOLS[row.tool];
  if (def.kind !== 'filter' && typeof def.kind !== 'function') return null;
  return { rowToken, active: row.inverted(), canInvert: row.kind() === 'filter' };
}

function reverseOptsFor(row, rowToken) {
  const def = TOOLS[row.tool];
  if (!def.reversible) return null;
  return { rowToken, active: row.reversed(), name: def.name, reverseName: def.reverseName };
}

function labelDefFor(row, def) {
  return def.reversible && row.reversed() ? { icon: def.icon, name: def.reverseName } : def;
}

export function buildSearchBarHTML() {
  const row = ToolStack.getSearchBarRow();
  // `bar`, not a numeric index: the bar's DOM persists across rerenderRows, so
  // a baked-in index would silently point at the wrong row once tools are
  // added above it, routing search input into another row's params.
  const parts = buildToolRowPartsHTML(TOOLS.search.params, row.params, 'search',
    p => ` data-row="bar" data-key="${p.key}"${p.key === 'pattern' ? ' title="Search (Alt-S)"' : ''}`,
    { findReplace: true, rowToken: 'bar', expanded: ToolStack.isRowExpanded('bar') });
  const label = buildToolLabelHTML(TOOLS.search);
  const invert = buildInvertButtonHTML(invertOptsFor(row, 'bar'));
  const solo = ToolStack.getUserStack().length === 0 ? ' solo' : '';
  const inverted = row.inverted() ? ' inverted' : '';
  return `<div class="search-bar${solo}${inverted}">
      <span class="drag-handle" aria-hidden="true">≡</span>
      ${label}
      ${parts.caret}
      ${parts.main}
      ${parts.asides}
      ${invert}
      <span class="tool-row-remove-placeholder" aria-hidden="true"></span>
      ${parts.replace}
    </div>`;
}

// Inline icon + name pair used by tool rows, the search bar, and gallery cards.
export function buildToolLabelHTML({ icon, name }, suffix) {
  const suf = suffix ? `<span class="tool-row-name-suffix"> · ${esc(suffix)}</span>` : '';
  return `<span class="tool-label"><span class="icon tool-row-icon"><span class="tool-row-icon-glyph">${icon}</span></span> `
    + `<span class="tool-row-name">${esc(name)}${suf}</span></span>`;
}

export function invertTooltip({ canInvert }) {
  if (!canInvert) return 'Inverting needs a filter — clear the replacement';
  return 'Exclude matches';
}

function buildInvertButtonHTML(invert) {
  if (!invert) return '';
  const { rowToken, active, canInvert } = invert;
  const title = invertTooltip({ canInvert });
  const cls = ['tool-row-invert'];
  if (active) cls.push('active');
  if (!canInvert) cls.push('disabled');
  return `<button type="button" class="${cls.join(' ')}" data-invert="${rowToken}"`
    + ` aria-pressed="${active}" aria-disabled="${!canInvert}"`
    + ` title="${esc(title)}" aria-label="${esc(title)}">`
    + `<svg width="14" height="14" aria-hidden="true"><use href="#icon-ban"/></svg></button>`;
}

export function reverseTooltip({ active, name, reverseName }) {
  return `Switch to ${active ? name : reverseName}`;
}

function buildReverseButtonHTML(reverse) {
  if (!reverse) return '';
  const { rowToken, active } = reverse;
  const title = reverseTooltip(reverse);
  const cls = ['tool-row-reverse'];
  if (active) cls.push('active');
  return `<button type="button" class="${cls.join(' ')}" data-reverse="${rowToken}"`
    + ` aria-pressed="${active}"`
    + ` title="${esc(title)}" aria-label="${esc(title)}">`
    + `<svg width="14" height="14" aria-hidden="true"><use href="#icon-swap"/></svg></button>`;
}

export function allModeTooltip({ blocked, active, kind }) {
  if (active) return kind === 'corner' ? 'Already showing all' : 'Show one';
  if (blocked) return 'Only one ✱ tool at a time';
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

  // Body-parented singleton (like SymbolSuggest) rather than a menu anchored
  // inside the row: .tool-row clips overflow, so an in-row dropdown would be
  // cut off on user-added Search/Regex rows.
  const MatchModeMenu = (() => {
    let el = null, anchor = null;

    // Anchor the menu under the whole match control, not the narrow arrow it
    // sprang from, so it reads as the control's dropdown rather than the caret's.
    const anchorRect = () => anchor?.closest('.tool-row-match');
    const reflow = () => { if (el?.classList.contains('open') && anchor) positionPopover(el, anchorRect(), { placement: 'below', offset: 4 }); };

    function ensure() {
      if (el) return el;
      el = document.createElement('div');
      el.className = 'split-btn-menu match-mode-menu';
      el.addEventListener('click', (e) => {
        const opt = e.target.closest('button[data-mode]');
        if (opt) pick(opt.dataset.mode);
      });
      document.addEventListener('click', (e) => {
        if (el.classList.contains('open') && !el.contains(e.target)) close();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
      });
      window.addEventListener('resize', reflow);
      window.addEventListener('scroll', reflow, true);
      document.body.appendChild(el);
      return el;
    }

    function pick(mode) {
      const wrap = anchor.closest('.tool-row-match');
      const box = wrap.querySelector('input[type="checkbox"]');
      const token = box.dataset.row;
      const row = token === 'bar' ? getSearchBarRow() : stack[parseInt(token, 10)];
      const choice = MATCH_PARAM.choices.find(c => c.value === mode);
      close();
      if (!row || !choice) return;
      wrap.dataset.mode = mode;
      wrap.querySelector('.match-mode-label').textContent = choice.label;
      box.checked = true;
      row.params.mode = mode;
      row._error = null;
      bumpPipelineVersion();
      _navigate();
    }

    function open(btn) {
      anchor = btn;
      const active = btn.closest('.tool-row-match').dataset.mode;
      ensure().innerHTML = MATCH_PARAM.choices.map(c =>
        `<button type="button" role="menuitemradio" aria-checked="${c.value === active}"`
        + ` data-mode="${esc(c.value)}">${esc(c.label)}</button>`).join('');
      el.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      positionPopover(el, anchorRect(), { placement: 'below', offset: 4 });
    }

    function close() {
      if (!el?.classList.contains('open')) return;
      el.classList.remove('open');
      anchor?.setAttribute('aria-expanded', 'false');
      anchor = null;
    }

    return {
      toggle(btn) {
        const reopen = !(el?.classList.contains('open') && anchor === btn);
        close();
        if (reopen) open(btn);
      },
    };
  })();

  function buildRowHTML(idx, row) {
    // The last row is the permanent Search bar — its own chrome, no remove
    // button (undeletable). Everything above it is an ordinary tool row.
    if (idx === stack.length - 1) return buildSearchBarHTML();
    const tool = row.def;
    const quickFix = tool.quickFix
      ? `<button type="button" class="tool-row-fix" data-fix="${idx}" hidden></button>`
      : '';
    const parts = buildToolRowPartsHTML(tool.params, row.params, row.tool,
      p => ` data-row="${idx}" data-key="${p.key}"`,
      { findReplace: !!tool.findReplace, rowToken: idx, expanded: isRowExpanded(idx), quickFix });
    let main = parts.main;
    if (tool.group) main = decorateMainWithAllToggle(main, idx, row);
    const remove = `<button type="button" class="tool-row-remove" data-remove="${idx}" title="Remove" aria-label="Remove ${esc(tool.name)}"><svg width="12" height="12"><use href="#icon-x"/></svg></button>`;
    const errBtn = `<button type="button" class="icon tool-row-error-btn" data-error-row="${idx}" aria-label="Tool error" hidden>⚠️</button>`;
    const invert = buildInvertButtonHTML(invertOptsFor(row, idx));
    const reverse = buildReverseButtonHTML(reverseOptsFor(row, idx));
    const inverted = row.inverted() ? ' inverted' : '';
    return `<div class="tool-row${inverted}" data-tool="${esc(row.tool)}">
      ${buildDragHandleHTML()}
      ${buildToolLabelHTML(labelDefFor(row, tool))}
      ${parts.caret}
      ${main}
      ${parts.asides}
      ${errBtn}
      ${invert}
      ${reverse}
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
    refreshRowMarks();
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
    refreshRowMarks();
  }

  function add(toolKey, { grouped = false } = {}) {
    if (!TOOLS[toolKey]) return;
    if (grouped && !TOOLS[toolKey].group) return;
    if (grouped && stack.some(r => r.grouped)) return;
    const idx = stack.length - 1;            // insert just above the Search bar
    stack.splice(idx, 0, makeToolRow(toolKey, {}, grouped));
    if (TOOLS[toolKey].asset) preloadWorkerAsset(TOOLS[toolKey].asset);
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
    syncInvertState(rowEl, row);
    refreshOtherAllToggles(idx);
    refreshGalleryActive();
    repaintAfterStackChange();
  }

  function toggleInvert(token) {
    const row = token === 'bar' ? getSearchBarRow() : stack[parseInt(token, 10)];
    if (!row || row.kind() !== 'filter') return;
    row.invert = !row.invert;
    // searchBarEl, not rowEls()[last]: rowEls() is the user tool rows only — the bar
    // isn't in it, so an index lookup silently repaints the wrong row or nothing.
    syncInvertState(token === 'bar' ? searchBarEl() : rowEls()[parseInt(token, 10)], row);
    repaintAfterStackChange();
  }

  function toggleReverse(token) {
    const row = stack[parseInt(token, 10)];
    if (!row || !row.def.reversible) return;
    row.reverse = !row.reverse;
    rerenderRows();   // the label's icon+name and the button state both change
    repaintAfterStackChange();
  }

  // The clear below is load-bearing, not a stray side effect: a replacement typed (or
  // ✱ switched on) moves the row out of filter kind, and the flag left behind would
  // encode a `not` into a shared URL that no stage honors.
  function syncInvertState(rowEl, row) {
    const canInvert = row.kind() === 'filter';
    if (!canInvert) row.invert = false;
    const on = row.inverted();
    rowEl?.classList.toggle('inverted', on);
    const btn = rowEl?.querySelector('.tool-row-invert');
    if (!btn) return;
    const title = invertTooltip({ canInvert });
    btn.classList.toggle('active', on);
    btn.classList.toggle('disabled', !canInvert);
    btn.title = title;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-disabled', String(!canInvert));
    btn.setAttribute('aria-label', title);
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
      const modeBtn = e.target.closest('.match-mode-arrow');
      if (modeBtn) {
        e.stopPropagation();
        MatchModeMenu.toggle(modeBtn);
        return;
      }
      const errBtn = e.target.closest('.tool-row-error-btn[data-error-row]');
      if (errBtn) {
        e.stopPropagation();
        if (window.matchMedia('(hover: hover)').matches) return;
        const idx = parseInt(errBtn.dataset.errorRow, 10);
        const msg = stack[idx]?._error || stack[idx]?.error() || '';
        _showRowError(errBtn, msg);
        return;
      }
      const fixBtn = e.target.closest('.tool-row-fix[data-fix]');
      if (fixBtn) {
        const idx = parseInt(fixBtn.dataset.fix, 10);
        const row = stack[idx];
        const fix = row?.quickFix();
        if (!fix) return;
        const rowEl = fixBtn.closest('.tool-row');
        for (const [key, value] of Object.entries(fix.params)) {
          row.params[key] = value;
          const input = rowEl.querySelector(`input[data-row="${idx}"][data-key="${key}"]`);
          if (input) { input.value = value; syncClearButton(input); }
        }
        repaintAfterStackChange();
        return;
      }
      const removeBtn = e.target.closest('.tool-row-remove[data-remove]');
      if (removeBtn) {
        removeAt(parseInt(removeBtn.dataset.remove, 10));
        return;
      }
      const addPair = e.target.closest('.rebus-pair-add[data-row]');
      if (addPair) {
        const idx = parseInt(addPair.dataset.row, 10);
        const row = stack[idx];
        if (row) {
          (row.params.string ||= ['']).push('');
          (row.params.symbol ||= ['']).push('');
          rerenderRows();
          stackEl()?.querySelectorAll('.tool-row')[idx]?.querySelector('.rebus-pair:last-child input[data-key="string"]')?.focus();
          bumpPipelineVersion(); _navigate();
        }
        return;
      }
      const removePair = e.target.closest('.rebus-pair-remove[data-row]');
      if (removePair) {
        const row = stack[parseInt(removePair.dataset.row, 10)];
        const i = parseInt(removePair.dataset.pair, 10);
        if (row) {
          (row.params.string || []).splice(i, 1);
          (row.params.symbol || []).splice(i, 1);
          rerenderRows();
          bumpPipelineVersion(); _navigate();
        }
        return;
      }
      const allBtn = e.target.closest('.tool-row-all-toggle[data-all-toggle]');
      if (allBtn) {
        if (allBtn.classList.contains('disabled')) return;
        toggleAllMode(parseInt(allBtn.dataset.allToggle, 10));
        return;
      }
      const reverseBtn = e.target.closest('.tool-row-reverse[data-reverse]');
      if (reverseBtn) {
        toggleReverse(reverseBtn.dataset.reverse);
        return;
      }
      const invertBtn = e.target.closest('.tool-row-invert[data-invert]');
      if (invertBtn) {
        if (!invertBtn.classList.contains('disabled')) toggleInvert(invertBtn.dataset.invert);
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
        const before = row.params.replace || '';
        if (expanding) {
          row.params.replace = replaceInput.value;
          replaceInput.focus();
        } else {
          delete row.params.replace;
        }
        syncInvertState(caret.closest('.tool-row, .search-bar'), row);
        if ((row.params.replace || '') !== before) {
          bumpPipelineVersion();
          _navigate();
        }
        return;
      }
    });
    p?.addEventListener('input', (e) => {
      const input = e.target.closest('input[data-row]');
      if (!input) return;
      const rowAttr = input.dataset.row;
      const row = rowAttr === 'bar' ? getSearchBarRow() : stack[parseInt(rowAttr, 10)];
      if (!row) return;
      const key = input.dataset.key;
      const matchBox = input.closest('.tool-row-match');
      if (input.dataset.pair !== undefined) {
        (row.params[key] ||= [])[parseInt(input.dataset.pair, 10)] = input.value;
      } else if (matchBox && input.type === 'checkbox') {
        // The wrapper's data-mode is the toggle's memory: checking the box
        // enables whatever mode the menu last showed. Reading params here
        // instead would enable a mode other than the one displayed.
        row.params[key] = input.checked ? matchBox.dataset.mode : '';
      } else if (input.type === 'checkbox') {
        const v = input.dataset.value;
        row.params[key] = v ? (input.checked ? v : '') : input.checked;
      } else if (input.type === 'range' && input.dataset.rangeValues) {
        const values = input.dataset.rangeValues.split(',');
        row.params[key] = values[parseInt(input.value, 10)] || '';
      } else {
        row.params[key] = input.value;
      }
      // Drop the edited row's async error — it described the old input. The ⚠ mark
      // itself repaints reactively off the bumpPipelineVersion() below.
      row._error = null;
      syncInvertState(input.closest('.tool-row, .search-bar'), row);
      bumpPipelineVersion();
      _navigate();
    });
    p?.addEventListener('focusin', (e) => {
      if (e.target.closest('input[data-symbol-suggest]')) SymbolSuggest.open(e.target);
    });
    p?.addEventListener('focusout', (e) => {
      if (e.target.closest('input[data-symbol-suggest]')) SymbolSuggest.close();
    });
    p?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.closest('input[data-symbol-suggest]')) SymbolSuggest.close();
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
  }
  function getStack() { return stack; }

  function refreshRowMarks() {
    const userRows = getUserStack();
    rowEls().forEach((rowEl, idx) => {
      const row = userRows[idx];
      const btn = rowEl.querySelector('.tool-row-error-btn');
      if (btn) {
        const msg = row?._error || row?.error();
        btn.hidden = !msg;
        if (msg) btn.title = msg;
        else btn.removeAttribute('title');
      }
      const fixBtn = rowEl.querySelector('.tool-row-fix');
      if (fixBtn) {
        const fix = row?.quickFix();
        fixBtn.hidden = !fix;
        if (fix) {
          fixBtn.textContent = fix.label;
          fixBtn.title = fix.title || '';
        } else {
          fixBtn.removeAttribute('title');
        }
      }
    });
  }

  return { buildHTML, buildGalleryHTML, refreshGalleryActive, init, add, getStack, setStack, getSearchBarRow, getUserStack, isRowExpanded, refreshRowMarks };
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
