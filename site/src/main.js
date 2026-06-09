'use strict';

import {
  ROW_HEIGHT, VS_BUFFER, LS_PREFIX, MERGED_ID, MERGED_NAME, EDITS_ICON,
  INITIALS_PALETTE, EMOJI_LIST, WORDLIST_PUBLISHERS, DEFAULT_SCORING,
  SEVERITY_PRIORITY,
} from './core/constants.js';
import { esc, pluralize, plural, timeAgo, nameFromPath, buildHelpHTML } from './core/util.js';
import { getBrowser, isMobile, hoverCapable } from './core/platform.js';
import { signal, effect, runBatched } from './core/signals.js';
import {
  stripAccents, toNorm, displayOf, projectRangesToDisplay, parseWordlist,
  buildUserWlEntry, synthWlEntry, validateWordlistChunk,
} from './engine/norm.js';

const scopeKey = scope => scope === MERGED_ID ? MERGED_ID : scope.dbKey;
let _mergedIcon = null;
function getMergedIcon() { return _mergedIcon ??= buildEmojiIconHTML('⭐'); }

// ─── Components ──────────────────────────────────────────────────────────────

function buildScoreBadgeHTML(score) {
  const { bg, fg } = scoreColor(score);
  return `<span class="score-badge" style="--score-bg:${bg}; --score-fg:${fg}">${score}</span>`;
}

// Scoped-source-only: on All Wordlists the open editor edits tier labels, which don't
// remap scores, so a raw → rescored arrow would be meaningless there.
function rescorePreviewActive() {
  return state.selected !== MERGED_ID && WordlistSelector.isEditorOpen();
}

function buildScoreCellHTML(wlEntry) {
  if (rescorePreviewActive() && wlEntry.rawScore != null && wlEntry.rawScore !== wlEntry.score) {
    return `<span class="atom-score-raw">${wlEntry.rawScore}</span>`
      + `<span class="atom-score-arrow">→</span>`
      + buildScoreBadgeHTML(wlEntry.score);
  }
  return buildScoreBadgeHTML(wlEntry.score);
}

// options: array of { value, label }
function buildSegCtrlHTML(id, options, activeValue) {
  // type="button" so a seg control placed inside a <form method="dialog"> (the
  // download dialog) doesn't submit and close the dialog on selection.
  const buttons = options.map(({ value, label }) =>
    `<button type="button" class="seg-btn${value === activeValue ? ' active' : ''}" data-val="${value}">${label}</button>`
  ).join('');
  return `<div class="seg-ctrl"${id ? ` id="${id}"` : ''}>${buttons}</div>`;
}

const OUTPUT_FLAGS = ['spaces', 'punctuation', 'accents', 'comments'];
const OUTPUT_FORMAT_REGEN_DELAY = 1000;

function buildOutputFormatControlsHTML(fmt) {
  const flags = OUTPUT_FLAGS.map(k =>
    `<label class="of-flag"><input type="checkbox" data-flag="${k}"${fmt[k] ? ' checked' : ''}> ${k[0].toUpperCase() + k.slice(1)}</label>`
  ).join('');
  return `<div class="of-flags">${flags}</div>`;
}

function readOutputFormatControls(container) {
  const fmt = {};
  for (const k of OUTPUT_FLAGS) fmt[k] = container.querySelector(`input[data-flag="${k}"]`).checked;
  return fmt;
}

function wireOutputFormatControls(container, onChange) {
  container.querySelectorAll('input[data-flag]').forEach(cb => { cb.onchange = () => onChange && onChange(); });
}

function buildStatItemHTML(label, value, title, extraClass) {
  const cls = 'stat' + (extraClass ? ' ' + extraClass : '');
  return `<div class="${cls}"${title ? ` title="${title}"` : ''}>
    <span class="stat-label">${label}</span>
    <span class="stat-value">${value}</span>
  </div>`;
}

function buildBadgeHTML(severity, opts = {}) {
  if (!severity) return '';
  const { title = '' } = opts;
  const titleAttr = title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : '';
  return `<span class="badge" data-severity="${severity}"${titleAttr}></span>`;
}

function syncSignHTML(list) {
  if (isMobile()) return '';
  const key = syncKey(list);
  const synced = syncTargets.has(key);
  const status = synced ? SyncStatus.get(key) : null;
  const file = synced ? esc(syncFilename(key)) : '';

  let dot, text;
  if (!synced)                       { dot = 'off';     text = 'Disk sync off'; }
  else if (status === 'unavailable') { dot = 'warn';    text = `Can’t find ${file}`; }
  else if (status === 'conflict')    { dot = 'warn';    text = 'Sync conflict'; }
  else if (status === 'writing')     { dot = 'working'; text = 'Saving…'; }
  else                               { dot = 'ok';      text = `Syncing to ${file}`; }

  return `<div class="sync-hang">
      <button type="button" id="sync-sign" class="sync-sign${dot === 'warn' ? ' attention' : ''}" onclick="WordlistActions.action('openSync')" title="${synced ? 'Manage disk sync' : 'Disk sync'}">
        <span class="sync-dot sync-dot--${dot}"></span>
        <span class="sync-line-text">${text}</span>
      </button>
    </div>`;
}

function maxSeverity(...severities) {
  let max = null;
  let maxPri = 0;
  for (const s of severities) {
    const p = SEVERITY_PRIORITY[s] ?? 0;
    if (p > maxPri) { max = s; maxPri = p; }
  }
  return max;
}

function wordlistSeverity(wordlist) {
  return wordlist._updateAvailable ? 'info' : null;
}

function sourcesSeverity() {
  return maxSeverity(...state.sources.map(wordlistSeverity));
}

function severityTitle(severity) {
  return severity === 'info' ? 'Update available' : '';
}

function buildWordlistCardHTML(icon, name, meta, opts = {}) {
  const {
    enabled       = true,
    populated     = true,
    selected      = false,
    severity      = null,
    severityTitle = '',
    draggable     = true,
    toggle        = true,
  } = opts;

  const classes = ['wordlist-card'];
  if (selected)   classes.push('selected');
  if (!enabled)   classes.push('disabled');
  if (!populated) classes.push('no-data');

  const dragHandle = draggable ? buildDragHandleHTML() : '';

  const badge = buildBadgeHTML(severity, { title: severityTitle });

  const cardInfo = `<div class="card-info">
      <div class="card-name-row"><div class="card-name">${esc(name)}</div>${badge}</div>
      <div class="card-meta">${meta}</div>
    </div>`;

  const toggleTitle = !populated ? 'Click to import'
    : enabled ? 'Enabled — click to disable' : 'Disabled — click to enable';
  const cardActions = toggle ? `<div class="card-actions">
    <label class="toggle" title="${toggleTitle}" aria-label="Toggle ${esc(name)}">
      <input type="checkbox"${populated && enabled ? ' checked' : ''}${populated ? '' : ' disabled'}>
      <span class="toggle-slider"></span>
    </label>
  </div>` : '';

  return `<div class="${classes.join(' ')}" data-wordlist tabindex="0" role="option">${dragHandle}${icon}${cardInfo}${cardActions}</div>`;
}

// Like a regular wordlist card but with no drag handle, no enable toggle, and
// not reorderable.
function buildMergedCardHTML(selected) {
  const meta = pluralize(buildMergedWordlist().entries.length, 'entry', 'entries');
  const cls = ['wordlist-card', 'merged-card'];
  if (selected) cls.push('selected');
  return `<div class="${cls.join(' ')}" data-merged tabindex="0" role="option">
    <span class="drag-handle" aria-hidden="true">≡</span>
    ${getMergedIcon()}
    <div class="card-info">
      <div class="card-name-row"><div class="card-name">${MERGED_NAME}</div></div>
      <div class="card-meta">${esc(meta)}</div>
    </div>
    <span class="merged-card-spacer" aria-hidden="true"></span>
  </div>`;
}

// The × button carries no per-call wiring: clicking it empties the field and
// dispatches an `input` event, so the field's own handler reacts as if the
// user erased the text by hand.
function buildScoreRangeInputHTML(inputId, value, viewName) {
  const input = `<input type="text" id="${inputId}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(value)}" oninput="${viewName}.onScoreRange(this.value)">`;
  return `<label class="score-range-label" title="50, 50-59, or 50+ (Alt-C)">Score ${buildClearableInputHTML(input, !!value)}</label>`;
}

function normalizeScoreRange(value, inputId) {
  const trimmed = (value || '').trim();
  const intervals = trimmed === '' ? null : parseRange(trimmed);
  const inp = document.getElementById(inputId);
  if (inp) inp.classList.toggle('invalid', trimmed !== '' && intervals === null);
  return (trimmed && intervals) ? trimmed : '';
}

function buildClearableInputHTML(inputHTML, hasValue) {
  return `<span class="clearable-input">${inputHTML}` +
    `<button type="button" class="clear-btn" title="Clear" aria-label="Clear"${hasValue ? '' : ' hidden'}>` +
    `<svg width="10" height="10" aria-hidden="true"><use href="#icon-x"/></svg></button></span>`;
}
function syncClearButton(input) {
  const btn = input.closest('.clearable-input')?.querySelector('.clear-btn');
  if (btn) btn.hidden = !input.value;
}
function mountClearableInputs() {
  document.addEventListener('input', e => {
    if (e.target.closest('.clearable-input')) syncClearButton(e.target);
  });
  document.addEventListener('click', e => {
    const btn = e.target.closest('.clearable-input .clear-btn');
    if (!btn) return;
    const input = btn.closest('.clearable-input').querySelector('input');
    input.value = '';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buildTextInputHTML(param, value, toolKey, wiring) {
  const helpAttr = param.help ? ` data-help="${toolKey}/${param.key}"` : '';
  const input = `<input class="entry-input" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${esc(param.placeholder || '')}" value="${esc(value || '')}"${helpAttr}${wiring}>`;
  return buildClearableInputHTML(input, !!value);
}

function buildParamHTML(param, value, toolKey, wiring) {
  const titleAttr = param.title ? ` title="${esc(param.title)}"` : '';
  if (param.type === 'checkbox') {
    return `<span class="tool-row-param"><label${titleAttr}><input type="checkbox"${value ? ' checked' : ''}${wiring}> ${esc(param.label)}</label></span>`;
  }
  const labelHTML = param.label ? `<label>${esc(param.label)}</label>` : '';
  if (param.type === 'number') {
    return `<span class="tool-row-param">${labelHTML}<input type="number" min="1" class="tool-row-num"`
      + ` placeholder="${esc(param.placeholder || '')}" value="${esc(value || '')}"${wiring}></span>`;
  }
  if (param.type === 'range') {
    const choices = (param.choices || []).map(c => typeof c === 'string' ? { value: c, label: c } : c);
    const max = Math.max(0, choices.length - 1);
    const cur = String(value ?? param.default ?? choices[0]?.value ?? '').toLowerCase();
    const idx = Math.max(0, choices.findIndex(c => c.value.toLowerCase() === cur));
    const ticks = choices.map(c => `<span>${esc(c.label)}</span>`).join('');
    const valuesAttr = ` data-range-values="${esc(choices.map(c => c.value).join(','))}"`;
    return `<span class="tool-row-param tool-row-range">${labelHTML}<span class="tool-row-range-wrap">`
      + `<input type="range" min="0" max="${max}" step="1" value="${idx}"${valuesAttr}${wiring}>`
      + `<span class="tool-row-range-ticks">${ticks}</span>`
      + `</span></span>`;
  }
  return `<span class="tool-row-param tool-row-param-text">${labelHTML}${buildTextInputHTML(param, value, toolKey, wiring)}</span>`;
}

function buildFindReplaceCaretHTML(expanded, rowToken) {
  return `<button type="button" class="find-replace-caret" data-replace-row="${rowToken}"`
    + ` aria-expanded="${expanded}" title="Replace" aria-label="Replace">`
    + `<svg class="find-replace-caret-glyph" width="11" height="11" aria-hidden="true"><use href="#icon-chevron-right"/></svg></button>`;
}

function buildToolRowPartsHTML(params, values, toolKey, wiringFn, opts = {}) {
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

function buildSearchBarHTML() {
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

class PopupHelp {
  constructor(anchor, contentHTML, opts = {}) {
    this.anchor = anchor;
    this.placement = opts.placement || 'above';
    this.offset = opts.offset ?? 6;

    this.el = document.createElement('div');
    this.el.className = 'popup-help';
    this.el.innerHTML = contentHTML;
    // Keep the anchor focused when the popover is clicked — otherwise blur
    // hides the popover before a click on a link inside it can land.
    this.el.addEventListener('mousedown', e => e.preventDefault());
    document.body.appendChild(this.el);

    this._onFocus = () => this.show();
    this._onBlur  = () => this.hide();
    this._reflow  = () => { if (this._open) this._position(); };
    this._onKeyDown = (e) => {
      if (e.key === 'Escape' && this._open) {
        this.hide();
        e.stopPropagation();
      }
    };
    anchor.addEventListener('focus', this._onFocus);
    anchor.addEventListener('blur',  this._onBlur);
    anchor.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('resize', this._reflow);
    window.addEventListener('scroll', this._reflow, true);

    if (anchor === document.activeElement) this.show();
  }

  show() {
    if (window.matchMedia('(max-width: 759px)').matches) return;
    this._open = true;
    this._position();
    this.el.classList.add('open');
  }

  hide() {
    this._open = false;
    this.el.classList.remove('open');
  }

  _position() {
    const aRect = this.anchor.getBoundingClientRect();
    const eRect = this.el.getBoundingClientRect();
    let above = this.placement === 'above';
    if (above && aRect.top - eRect.height - this.offset < 8) above = false;
    else if (!above && aRect.bottom + this.offset + eRect.height > window.innerHeight - 8) above = true;
    const top = above
      ? aRect.top - eRect.height - this.offset
      : aRect.bottom + this.offset;
    const maxLeft = window.innerWidth - eRect.width - 8;
    const left = Math.max(8, Math.min(aRect.left, maxLeft));
    this.el.style.top  = top  + 'px';
    this.el.style.left = left + 'px';
  }

  destroy() {
    this.anchor.removeEventListener('focus', this._onFocus);
    this.anchor.removeEventListener('blur',  this._onBlur);
    this.anchor.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('resize', this._reflow);
    window.removeEventListener('scroll', this._reflow, true);
    this.el.remove();
  }
}

function buildSplitBtn(mainLabel, mainOnclick, menuItems, { primary = false, disabled = false, title = '', id = '' } = {}) {
  const dis = disabled ? ' disabled' : '';
  const titleAttr = title ? ` title="${title}"` : '';
  const idAttr = id ? ` id="${id}"` : '';
  const arrow = `<svg width="8" height="5"><use href="#icon-arrow"/></svg>`;
  const items = menuItems.map(([lbl, fn]) => `<button onclick="${fn}">${lbl}</button>`).join('');
  return `<div class="split-btn${primary ? ' primary' : ''}"${idAttr}>` +
    `<button class="split-btn-main"${titleAttr} onclick="${mainOnclick}"${dis}>${mainLabel}</button>` +
    `<button class="split-btn-arrow" onclick="toggleSplitMenu(event)" title="More options"${dis}>${arrow}</button>` +
    `<div class="split-btn-menu">${items}</div>` +
    `</div>`;
}

function buildMoreMenuHTML(menuItems, { className = '', header = '' } = {}) {
  const items = menuItems.map(([lbl, fn, opts = {}]) => {
    const dis   = opts.disabled ? ' disabled' : '';
    const title = opts.title ? ` title="${esc(opts.title)}"` : '';
    return `<button onclick="${fn}"${dis}${title}>${lbl}</button>`;
  }).join('');
  const headerHTML = header ? `<div class="split-btn-menu-header">${esc(header)}</div>` : '';
  return `<div class="split-btn${className ? ' ' + className : ''}">` +
    `<button class="more-menu-btn" onclick="toggleSplitMenu(event)" title="More options">⋮</button>` +
    `<div class="split-btn-menu">${headerHTML}${items}</div>` +
    `</div>`;
}

function toggleSplitMenu(event) {
  event.stopPropagation();
  const btn = event.currentTarget.closest('.split-btn');
  const isOpen = btn.classList.contains('open');
  document.querySelectorAll('.split-btn.open').forEach(b => b.classList.remove('open'));
  if (!isOpen) btn.classList.add('open');
}

function buildUrlInputHTML(id, placeholder) {
  return `<div class="url-input-wrap">` +
    `<svg class="url-input-icon" width="14" height="14" aria-hidden="true"><use href="#icon-globe"/></svg>` +
    `<input class="url-input" id="${id}" type="url" placeholder="${placeholder}" spellcheck="false" autocomplete="off">` +
    `</div>`;
}

function buildRuleRowHTML(i, fieldsHTML, note, onDeleteFn, readOnly = false) {
  const noteWrap = readOnly
    ? `<span class="rule-note-wrap${note ? ' has-note' : ''}"><span class="rule-note-text">${esc(note||'')}</span></span>`
    : `<span class="rule-note-wrap${note ? ' has-note' : ''}" onclick="startNoteEdit(this)" title="Click to edit">
        <span class="rule-note-text">${esc(note||'')}</span>
        ${buildEditHintHTML('rule-note-pencil', 'startNoteEdit(this.parentElement)')}
      </span>`;
  const delBtn = readOnly ? '' : `<button class="icon rule-del" onclick="${onDeleteFn}(${i})" title="Delete row">${buildTrashIconHTML()}</button>`;
  return `<div class="rule-row" data-i="${i}">
      ${fieldsHTML}
      ${noteWrap}
      ${delBtn}
    </div>`;
}

function buildRulesListHTML(rules, { rulesId, saveFn, deleteFn, addFn = '', resetFn = '', neutralizeFn = '', bakeFn = '', bakeOpts = {}, dirty = false, rescore = false, readOnly = false }) {
  let rulesHTML;
  if (!rules.length && rescore) {
    rulesHTML = '<div class="no-rules">No rules — entries kept as-is</div>';
  } else {
    rulesHTML = rules.map((r, i) => {
      const inputInvalid = !readOnly && parseRange((r.input || '').trim()) === null;
      const disabled = readOnly ? ' disabled' : '';
      const inputHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'input',this.value)"`;
      let fieldsHTML = `<input class="rule-in${inputInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.input)}"
            title="Score range: 50, 50-59, or 50+"${disabled}${inputHandlers}>`;
      if (rescore) {
        const lenVal = (r.length || '').trim();
        const lenInvalid = !readOnly && lenVal !== '' && parseRange(lenVal) === null;
        const outInvalid = !readOnly && isRuleOutputInvalid(r.input, r.output);
        const lenHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'length',this.value)"`;
        const outHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'output',this.value)"`;
        fieldsHTML += `
          <span class="rule-field-lbl">length</span><input class="rule-len${lenInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.length||'')}" placeholder="any"
            title="Entry length filter: 7, 7-10, or 7+ (blank = any length)"${disabled}${lenHandlers}>
          <span class="rule-arrow">→</span>
          <input class="rule-out${outInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.output)}" placeholder="unchanged"
            title="Output score, or blank for unchanged"${disabled}${outHandlers}>`;
      }
      return buildRuleRowHTML(i, fieldsHTML, r.note, deleteFn, readOnly);
    }).join('');
  }
  const addBtn = (!readOnly && addFn) ? `<button class="rule-add-btn" onclick="${addFn}()">+ Add rule</button>` : '';
  const neutralizeBtn = (!readOnly && neutralizeFn && rescoringIsNeutralizable(rules)) ? `<button class="rule-neutralize-btn" title="Keep this list's raw scores and notes — drop only Grawlix's rescoring" onclick="${neutralizeFn}()">Disable rescoring</button>` : '';
  const resetBtn = (!readOnly && resetFn && dirty) ? `<button class="rule-reset-btn" onclick="${resetFn}()">Reset to defaults</button>` : '';
  const bakeBtn = (!readOnly && bakeFn)
    ? `<button class="rule-bake-btn" onclick="${bakeFn}"${bakeOpts.disabled ? ' disabled' : ''}${bakeOpts.title ? ` title="${esc(bakeOpts.title)}"` : ''}>Apply rescoring permanently</button>`
    : '';
  const rightCluster = (neutralizeBtn || resetBtn || bakeBtn) ? `<div class="rule-actions-right">${neutralizeBtn}${resetBtn}${bakeBtn}</div>` : '';
  const actionsRow = (addBtn || rightCluster) ? `<div class="rule-actions">${addBtn}${rightCluster}</div>` : '';
  return `<div id="${rulesId}">${rulesHTML}</div>${actionsRow}`;
}

function buildRescoreSectionHTML(wordlist, rulesId = 'rescore-rules') {
  if (!wordlist) return '';
  const hasDefaults = getWordlistDefaultRules(wordlist) !== null;
  return `<div class="rescore-top"><span class="rescore-lbl">Rescoring</span></div>` +
    buildRulesListHTML(wordlist.rescoreRules || [], {
      rulesId,
      saveFn:    'saveRuleField',
      deleteFn:  'deleteRule',
      addFn:     'addRule',
      resetFn:   hasDefaults ? 'resetRescoreRules' : '',
      neutralizeFn: 'neutralizeRescoreRules',
      bakeFn:    `WordlistActions.action('bakeRescoring')`,
      bakeOpts:  bakeMenuOpts(wordlist),
      dirty:     !!wordlist.dirty,
      rescore:   true,
    });
}

function buildScoringSectionHTML(rulesId = 'scoring-rules') {
  sortScoringRules();
  return `<div class="rescore-top"><span class="rescore-lbl">Scoring</span></div>` +
    buildRulesListHTML(state.scoring, {
      rulesId,
      saveFn:    'saveScoringField',
      deleteFn:  'deleteScoringRow',
      addFn:     'addScoringRow',
      resetFn:   'resetScoringRules',
      dirty:     state.scoringDirty,
    });
}

function buildEntriesTablePanelHTML() {
  return `<div id="entries-table-panel">
      <div class="pipeline-spinner" aria-hidden="true"></div>
      <div id="vs-host"></div>
    </div>`;
}

// One header set for every chain shape — the Entry / Length / Score columns
// describe what each atom *line* contains, not the row as a whole, so they
// stay constant whether a row has one atom or many. Comment / Source surface
// on every chain shape when the viewport has room (gated by media query).
function buildEntryHeadersHTML() {
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

function onSortHeaderActivate(e) {
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
  entriesScroller?.applySort(key, dir);
  // applySort rebuilds the header, destroying the activated cell — refocus its
  // replacement so keyboard focus isn't silently dropped to <body>.
  if (e.type === 'keydown') document.querySelector(sel)?.focus();
}

// rerenderRows rebuilds only the tool rows, so a stack edit that flips chain
// rows ⇄ group rows leaves the column headers stale until this runs.
function rebuildEntryHeaders() {
  const el = document.querySelector('.sticky-stack .entry-headers, .sticky-stack .group-headers');
  if (el) el.outerHTML = buildEntryHeadersHTML();
}

function buildEditHintHTML(extraClass, onclick) {
  return `<span class="edit-hint${extraClass ? ' ' + extraClass : ''}" onclick="${onclick}" aria-hidden="true" title="Click to edit">✏️</span>`;
}

function buildTrashIconHTML() {
  return `<svg class="icon-trash"><use href="#icon-trash"/></svg>`;
}

function buildDragHandleHTML() {
  return `<span class="drag-handle" title="Drag to reorder" aria-label="Drag to reorder">≡</span>`;
}

let _dragGhostLayer = null;
function dragGhostLayer() {
  if (!_dragGhostLayer) {
    _dragGhostLayer = document.createElement('div');
    _dragGhostLayer.className = 'drag-ghost-layer';
  }
  return _dragGhostLayer;
}

// A body-parented fixed layer is occluded by a modal's top layer, so the ghost
// vanishes behind the dialog; re-parent the singleton into the dragged
// container's own top-layer host (open dialog, else body). One drag at a time.
function hostDragGhostLayer(container) {
  const host = container.closest('dialog[open]') || document.body;
  const layer = dragGhostLayer();
  if (layer.parentElement !== host) host.appendChild(layer);
  return layer;
}

// Native HTML5 drag never fires from touch, so the reorder handles that used it
// were dead on mobile; pointer events fix that. Needs `touch-action: none` on the
// handle (CSS) or a touch-drag scrolls the page instead of dragging.
function makeReorderable(container, { handleSelector, itemSelector, onReorder }) {
  if (!container) return;
  const THRESHOLD = 4, EDGE = 48, SPEED = 10;
  let fromEl = null, pointerId = null, dragging = false;
  let startX = 0, startY = 0, lastX = 0, lastY = 0, rafId = 0;
  let ghost = null, grabX = 0, grabY = 0;
  let dropLine = null, dropBeforeEl = null, hasDrop = false;

  // A transform-centered modal dialog is the fixed ghost-layer's containing block, so
  // ghost/drop-line positions are layer-relative, not viewport (body layer origin = 0,0).
  const layerOrigin = () => dragGhostLayer().getBoundingClientRect();

  const moveGhost = () => {
    if (!ghost) return;
    const o = layerOrigin();
    ghost.style.left = `${lastX - grabX - o.left}px`;
    ghost.style.top  = `${lastY - grabY - o.top}px`;
  };

  // iOS WebKit honors neither overscroll-behavior nor touch-action for the history
  // swipe; only preventing the (non-passive) touchmove keeps the page from sliding.
  const blockTouch = e => e.preventDefault();

  function refreshDrop() {
    const items = [...container.querySelectorAll(itemSelector)];
    const fromIdx = items.indexOf(fromEl);
    let gap = items.findIndex(it => {
      const r = it.getBoundingClientRect();
      return lastY < r.top + r.height / 2;
    });
    if (gap < 0) gap = items.length;
    hasDrop = gap !== fromIdx && gap !== fromIdx + 1;
    if (!hasDrop) { if (dropLine) dropLine.hidden = true; return; }
    dropBeforeEl = gap < items.length ? items[gap] : null;
    const r = (dropBeforeEl || items[items.length - 1]).getBoundingClientRect();
    if (!dropLine) {
      dropLine = document.createElement('div');
      dropLine.className = 'drop-line';
      dragGhostLayer().appendChild(dropLine);
    }
    const o = layerOrigin();
    dropLine.style.left  = `${r.left - o.left}px`;
    dropLine.style.width = `${r.width}px`;
    dropLine.style.top   = `${(dropBeforeEl ? r.top : r.bottom) - 1 - o.top}px`;
    dropLine.hidden = false;
  }

  // The nearest scrollable ancestor, else the page (null) — the surface to
  // auto-scroll when a drag nears its edge.
  function scrollHost() {
    for (let n = fromEl?.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  }

  // A touch held at the edge stops firing pointermove, so edge-scroll runs on
  // its own frame loop off the last pointer position.
  function tick() {
    rafId = dragging ? requestAnimationFrame(tick) : 0;
    if (!dragging) return;
    const host = scrollHost();
    if (host) {
      const r = host.getBoundingClientRect();
      if (lastY < r.top + EDGE && host.scrollTop > 0) host.scrollTop -= SPEED;
      else if (lastY > r.bottom - EDGE)               host.scrollTop += SPEED;
    } else if (lastY < EDGE)                           scrollBy(0, -SPEED);
    else if (lastY > innerHeight - EDGE)              scrollBy(0,  SPEED);
    refreshDrop();
  }

  function stop(commit) {
    if (!fromEl) return;
    const doDrop = commit && dragging && hasDrop;
    const before = dropBeforeEl;
    if (dropLine) dropLine.hidden = true;
    fromEl.classList.remove('dragging');
    ghost?.remove(); ghost = null;
    if (doDrop) onReorder(fromEl, before);
    fromEl = null; pointerId = null; dragging = false; hasDrop = false;
    document.documentElement.classList.remove('reorder-dragging');
    document.removeEventListener('touchmove', blockTouch, { passive: false });
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  container.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const handle = e.target.closest(handleSelector);
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest(itemSelector);
    if (!item) return;
    fromEl = item; pointerId = e.pointerId;
    startX = lastX = e.clientX; startY = lastY = e.clientY;
    handle.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('reorder-dragging');
    document.addEventListener('touchmove', blockTouch, { passive: false });
    e.preventDefault();
  });
  container.addEventListener('pointermove', e => {
    if (!fromEl || e.pointerId !== pointerId) return;
    lastX = e.clientX; lastY = e.clientY;
    if (!dragging) {
      if (Math.hypot(lastX - startX, lastY - startY) < THRESHOLD) return;
      dragging = true;
      const r = fromEl.getBoundingClientRect();
      grabX = lastX - r.left; grabY = lastY - r.top;
      ghost = fromEl.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.style.width = `${r.width}px`;
      hostDragGhostLayer(container).appendChild(ghost);
      fromEl.classList.add('dragging');
      rafId = requestAnimationFrame(tick);
    }
    e.preventDefault();
    refreshDrop();
    moveGhost();
  });
  container.addEventListener('pointerup',     e => { if (e.pointerId === pointerId) stop(true);  });
  container.addEventListener('pointercancel', e => { if (e.pointerId === pointerId) stop(false); });
}

function buildWordlistNameHTML(wordlist, { bold = true } = {}) {
  const merged = wordlist === MERGED_ID;
  const icon = merged ? getMergedIcon() : getWordlistIcon(wordlist);
  const text = esc(merged ? MERGED_NAME : wordlist.name);
  const name = bold ? `<strong>${text}</strong>` : text;
  // The trailing space inside the span is load-bearing: combined with `white-space: nowrap` on
  // .wordlist-name-icon, it keeps the icon glued to the first word of the name. Move it outside
  // the span and the icon can orphan at a line end.
  return `<span class="wordlist-name-icon">${icon} </span>${name}`;
}

// Inline icon + name pair used by tool rows, the search bar, etc.
// `icon` is raw HTML (emoji string or <svg>); `name` is plain text.
function buildToolLabelHTML({ icon, name }, suffix) {
  const suf = suffix ? `<span class="tool-row-name-suffix"> · ${esc(suffix)}</span>` : '';
  return `<span class="tool-label"><span class="icon tool-row-icon">${icon}</span> <span class="tool-row-name">${esc(name)}${suf}</span></span>`;
}

function allModeTooltip({ blocked, active, kind }) {
  if (active) return kind === 'corner' ? 'Already showing all' : 'Show one';
  if (blocked) return 'Only one tool can show all at a time';
  return 'Show all';
}

function buildToolCardHTML(toolKey, tool, { allButton = true } = {}) {
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

// ─── Router ───────────────────────────────────────────────────────────────────
// Keeps the URL in sync with the tool stack via history.replaceState. URL shape:
//   bare URL    → no query state
//   ?<query>    → the pipeline encoded in the query string
// The bare-URL form is used when there's no query, so the most-shared case stays
// short.
//
// Query encoding: each pipeline row in order — its tool name carries the
// first param's value (`tool=value`), and each successive param is its own
// adjacent key (a bare key for a true checkbox, `key=value` for a non-empty
// text param, omitted at default). The permanent Search bar is the final
// row. See docs/design.md § URL state. The score filter is intentionally
// *not* in the URL — it's per-user (scores aren't portable across wordlist
// setups) and lives in localStorage.
const Router = (() => {
  // One tool row → its URL key(s). The first param rides on the tool-name
  // key so the row always has an anchor (kept even when empty, so an
  // unfilled row survives reload); a param-less tool is a bare tool key.
  function encodeRow(row) {
    if (row.grouped) return [encodeURIComponent(row.tool), 'all'];
    const { params: schema } = row.def;
    const slug = encodeURIComponent(row.tool);
    if (!schema.length) return [slug];
    const parts = [slug + '=' + encodeURIComponent(row.params[schema[0].key] || '')];
    for (const p of schema.slice(1)) {
      const v = row.params[p.key];
      if (p.type === 'checkbox') { if (v) parts.push(encodeURIComponent(p.key)); }
      else if (v)                parts.push(encodeURIComponent(p.key) + '=' + encodeURIComponent(v));
    }
    return parts;
  }

  function rowIsDefault(row) {
    return row.def.params.every(p => !row.params[p.key]);
  }

  function buildQuery() {
    // The full pipeline — user tools plus the permanent Search bar as its
    // last row. Each row serializes via encodeRow; empty values are kept
    // (`anagram=`) so an added-but-unfilled row survives reload. The lone
    // exception is the Search bar: its keys are elided when it's at default
    // state *and* not preceded by another Search row, so an untouched app
    // stays at a bare URL while an added Search tool still round-trips.
    const stack = ToolStack.getStack();
    const parts = [];
    stack.forEach((row, i) => {
      const isBar = i === stack.length - 1;
      if (isBar && rowIsDefault(row) && stack[i - 1]?.tool !== 'search') return;
      parts.push(...encodeRow(row));
    });
    const tier = chainSortTier(stack);
    const defaultAxis = DEFAULT_SORT_BY_TIER[tier];
    if (AppView.sortKey !== defaultAxis)                  parts.push('sort=' + AppView.sortKey);
    if (AppView.sortDir !== 'asc') parts.push('sort-dir=' + AppView.sortDir);
    return parts.join('&');
  }

  function buildSearch() {
    const query = buildQuery();
    return query ? '?' + query : '';
  }

  function navigate() {
    const target = location.pathname + buildSearch();
    if (location.pathname + location.search !== target) {
      history.replaceState(null, '', target);
    }
  }

  // Applies URL state (tool stack, search) as a side effect. The score filter
  // is loaded from localStorage in init() and doesn't participate in URL routing.
  function applyURL() {
    const params = new URLSearchParams(location.search);
    const rows = [];
    let sortKey = null;
    let sortDir = null;
    let droppedUnknown = false;
    // All param names across the catalog — lets the decoder tell a genuinely
    // unknown key (likely a removed tool) from a merely misplaced param.
    const knownParam = new Set(Object.values(TOOLS).flatMap(t => t.params.map(p => p.key)));
    // Each key is one of three things: a tool name (starts a new row, its
    // value is the first param), a reserved view-config key, or a successive
    // param of the most recent row (a bare key sets a checkbox true).
    for (const [key, value] of params) {
      if (key === 'sort')     { if (isValidSortAxis(value)) sortKey = value; continue; }
      if (key === 'sort-dir') { if (value === 'asc' || value === 'desc') sortDir = value; continue; }
      if (key === 'all') {
        const cur = rows[rows.length - 1];
        if (cur && cur.def.group) {
          if (rows.some(r => r.grouped)) {
            rows.pop();
          } else {
            cur.grouped = true;
            cur.params = {};
          }
        }
        continue;
      }
      const tool = TOOLS[key];
      if (tool) {
        const row = makeToolRow(key);
        if (tool.params.length) row.params[tool.params[0].key] = value || '';
        rows.push(row);
        continue;
      }
      const cur = rows[rows.length - 1];
      const pdef = cur && cur.def.params.find(p => p.key === key);
      if (pdef) { cur.params[key] = pdef.type === 'checkbox' ? true : (value || ''); continue; }
      // A key that's not a tool, not reserved, and not any tool's param name
      // is a genuinely unknown key — most likely a tool that's been removed.
      if (!knownParam.has(key)) droppedUnknown = true;
    }
    // The decoded rows are the full pipeline; ToolStack keeps the trailing
    // Search row as the permanent bar (appending an empty one if absent).
    // Stack is set first so applyURLState can derive the current atom count
    // when picking the sort default (a stacked-output URL with no explicit
    // sort= should pick min-score, not the 1-atom default entry).
    ToolStack.setStack(rows);
    AppView.applyURLState({ sortKey, sortDir });
    if (droppedUnknown) {
      // Defer: showToast appends to the toast container which may not be in
      // the DOM yet during initial load.
      setTimeout(() => showToast("That link references a tool that's no longer available."), 0);
    }
  }

  return { navigate, applyURL };
})();

// ─── State ────────────────────────────────────────────────────────────────────

// Default tier labels for the unified score scale. Stored on `state.scoring`
// and surfaced as a read/write legend on the merged All Wordlists view.
//
// Top-level state. `sources$` is the array of wordlists, signal-backed so
// the cosmetic effect can subscribe; reorder/add/remove call `sources$.bump()`
// after splicing (signal equality is by reference, so plain mutation needs a
// bump).
const sources$ = signal([]);

// `cacheVersion$` is bumped whenever the imperative caches change (full
// invalidation or in-place patch). The render effect subscribes to it so
// cache-impacting changes trigger a repaint without manual dispatch.
const cacheVersion$ = signal(0);
function bumpCacheVersion() { cacheVersion$.set(cacheVersion$.peek() + 1); }

// Reads through `state.sources` are non-subscribing (peek). Effects that
// need to re-run on changes read the underlying signal explicitly with
// `.get()`. This keeps the imperative call sites unchanged while preventing
// accidental over-subscription from incidental reads inside effects.
const state = {
  get sources()  { return sources$.peek(); },
  set sources(v) { sources$.set(v); },
  // Tier labels for the unified score scale. Single source of truth for what
  // each score range means to the user; edited from All Wordlists' pane and used
  // everywhere scores get a tooltip. No signal — mutators call
  // `persistScoring()` and `renderScoringRules()` explicitly.
  scoring: [],
  // True when state.scoring has been customized away from DEFAULT_SCORING.
  // Drives `propagateDefaults` at boot (pristine users silently pick up dev
  // updates) and the "Reset to defaults" button visibility.
  scoringDirty: false,
  selected: MERGED_ID,
};

// Per-wordlist cosmetic fields are signal-backed: each wordlist exposes both
// `wl.name`/`wl.icon`/etc. (peek getter, set setter) and `wl.name$`/`wl.icon$`
// for explicit subscriptions. The cosmetic effect subscribes to all four
// across every wordlist.
//
// Cache-affecting fields (`enabled`, `rescoreRules`, `rawEntries`) and
// transient fields (`_loading`, `_updateAvailable`, `lastUpdated`, etc.) are
// plain properties: their mutation goes through a helper that handles the
// invalidation/persistence/dispatch explicitly. See "Mutation helpers" below.
const REACTIVE_WORDLIST_FIELDS = ['name', 'icon', 'url', 'publisherId'];

function wrapWordlist(wl) {
  if (wl.name$) return wl;  // already wrapped
  for (const field of REACTIVE_WORDLIST_FIELDS) {
    const sig = signal(wl[field]);
    delete wl[field];
    Object.defineProperty(wl, field + '$', { value: sig });
    Object.defineProperty(wl, field, {
      get() { return sig.peek(); },
      set(v) { sig.set(v); },
      enumerable: true,
      configurable: false,
    });
  }
  return wl;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function lsSave(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, value); return true; }
  catch { return false; }
}
function lsLoad(key) { return localStorage.getItem(LS_PREFIX + key); }
function lsDel(key)  { localStorage.removeItem(LS_PREFIX + key); }

// Bump when the shape of stored data (localStorage `meta` or IDB entries)
// changes, and register a MIGRATIONS[N] step in the same commit: a bump without
// one routes every existing user to the reset floor. See docs/migration.md.
//
// Schema version history:
//   ≤9: pre-migration-policy baseline; a store this old hits the reset floor.
//   v10 (2026-06-06): dropped the 'ignore' rescore output; rules that output
//                     'ignore' rewrite to '0'.
// #region nodetest:migrations
const SCHEMA_VERSION = 10;

// MIGRATIONS[v] upgrades a settings blob from schema v to v+1, mutating it in
// place (a returned value is ignored). The blob is the
// { sources, scoring, scoringDirty, mergedSettings } shape that migrateLocalStorage
// assembles from the separate localStorage keys; migrations target that, never raw storage.
const MIGRATIONS = {
  9: blob => {
    for (const w of blob.sources || []) {
      for (const r of w.rescoreRules || []) {
        if ((r.output || '').trim().toLowerCase() === 'ignore') r.output = '0';
      }
    }
  },
};

function canMigrate(from) {
  if (!Number.isFinite(from) || from > SCHEMA_VERSION) return false;
  for (let v = from; v < SCHEMA_VERSION; v++) if (!MIGRATIONS[v]) return false;
  return true;
}

function migrateSettings(blob, from) {
  for (let v = from; v < SCHEMA_VERSION; v++) MIGRATIONS[v](blob); // canMigrate(from) must hold
  return blob;
}
// #endregion nodetest:migrations

// IndexedDB for large wordlist data (localStorage has ~5MB limit)
const IDB_NAME  = 'grawlix';
const IDB_STORE = 'data';
let _db = null;

async function resetAllDataAndReload() {
  await Storage.reset();
  location.reload();
  // location.reload() is asynchronous — JS keeps running until the navigation
  // actually fires. Block the caller so it can't re-persist the state we just
  // wiped (init() in particular would write a fresh `meta` back to localStorage
  // and leave the SCHEMA_VERSION warning re-armed for the next load).
  await new Promise(() => {});
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => { _db = e.target.result; resolve(); };
    req.onerror   = () => reject(req.error);
  });
}

function idbPut(key, val) {
  return new Promise(resolve => {
    const tx = _db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
  });
}

function idbGet(key) {
  return new Promise(resolve => {
    const tx  = _db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => resolve(null);
  });
}

function idbDel(key) {
  return new Promise(resolve => {
    const tx = _db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
  });
}

// Opaque IDB key. Avoids crypto.randomUUID because WebKit gates it on
// secure contexts, which breaks local-network mobile testing over HTTP.
function newDbKey() {
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

const Storage = {
  schemaVersion() { const v = parseInt(lsLoad('schemaVersion'), 10); return Number.isFinite(v) ? v : null; },
  setSchemaVersion(v) { lsSave('schemaVersion', String(v)); },
  hasData() { return lsLoad('meta') !== null; },

  readMeta() {
    const raw = lsLoad('meta');
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch { return null; }
  },
  writeMeta(sources) { lsSave('meta', JSON.stringify(sources)); },

  readScoring() {
    const raw = lsLoad('scoring');
    if (!raw) return null;
    try { return { scoring: JSON.parse(raw), dirty: lsLoad('scoringDirty') === '1' }; }
    catch { return null; }
  },
  writeScoring(scoring, dirty) {
    lsSave('scoring', JSON.stringify(scoring));
    lsSave('scoringDirty', dirty ? '1' : '0');
  },

  readMergedSettings() {
    try { return JSON.parse(lsLoad('mergedSettings')) || {}; }
    catch { return {}; }
  },
  writeMergedSettings(s) { lsSave('mergedSettings', JSON.stringify(s)); },

  async readWordlist(wordlist) { return idbGet('data_' + wordlist.dbKey); },
  async writeWordlist(wordlist, text) { await idbPut('data_' + wordlist.dbKey, text); },
  async deleteWordlist(wordlist) { await idbDel('data_' + wordlist.dbKey); },

  async reset() {
    Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX)).forEach(k => localStorage.removeItem(k));
    if (_db) { _db.close(); _db = null; }
    await new Promise(resolve => {
      const req = indexedDB.deleteDatabase(IDB_NAME);
      req.onsuccess = resolve;
      req.onerror   = resolve;
      req.onblocked = resolve;
    });
  },
};

function migrateLocalStorage(from) {
  const scoring = Storage.readScoring();
  const blob = {
    sources:        Storage.readMeta(),
    scoring:        scoring?.scoring ?? null,
    scoringDirty:   scoring?.dirty ?? false,
    mergedSettings: Storage.readMergedSettings(),
  };
  try { migrateSettings(blob, from); }
  catch (err) { console.error('migration failed', err); return false; }
  Storage.writeMeta(blob.sources);
  if (blob.scoring) Storage.writeScoring(blob.scoring, blob.scoringDirty);
  Storage.writeMergedSettings(blob.mergedSettings);
  Storage.setSchemaVersion(SCHEMA_VERSION);
  return true;
}

// ─── Disk sync (per-list file sync) ───────────────────────────────────────────

const SYNC_REC_PREFIX        = 'sync_';        // IDB record key: sync_<dbKey | MERGED_ID>
const EDITS_DEFAULT_FILENAME = 'My Edits.txt';
const DISK_SYNC_POLL_INTERVAL = 2000;
const MIRROR_WRITE_DELAY      = 500;

// key → { handle, baseline? }. `baseline` (serialized as-is My Edits text) is the
// common ancestor for My Edits' 3-way merge; without it, a two-way union can't
// tell "added here" from "deleted there" and silently resurrects deletions.
const syncTargets = new Map();
const syncStatus  = new Map();

function syncKey(list)       { return list === MERGED_ID ? MERGED_ID : list.dbKey; }
function isMirrorList(list)  { return list === MERGED_ID || list.type !== 'edits'; }
function editsSyncKey()      { const e = getEditsWordlist(); return e ? e.dbKey : null; }
function listForSyncKey(key) { return key === MERGED_ID ? MERGED_ID : state.sources.find(s => s.dbKey === key) || null; }
function syncFilename(key)   { return syncTargets.get(key)?.handle?.name || ''; }

const SyncStatus = {
  get(key) { return syncTargets.has(key) ? (syncStatus.get(key) || 'synced') : null; },
  set(key, status) { syncStatus.set(key, status); renderSyncIndicators(); },
  clear(key) { syncStatus.delete(key); renderSyncIndicators(); },
};

function renderSyncIndicators() {
  WordlistSelector.refreshSyncSign?.();
}

async function loadSyncTargets() {
  for (const key of [MERGED_ID, ...state.sources.map(s => s.dbKey)]) {
    const rec = await idbGet(SYNC_REC_PREFIX + key);
    if (rec && rec.handle) syncTargets.set(key, { handle: rec.handle, baseline: rec.baseline });
  }
}

async function persistSyncTarget(key) {
  const t = syncTargets.get(key);
  if (t) await idbPut(SYNC_REC_PREFIX + key, { handle: t.handle, baseline: t.baseline });
  else   await idbDel(SYNC_REC_PREFIX + key);
}

// InvalidStateError means a cloud-sync client (Dropbox, OneDrive) touched the file
// underneath the handle mid-operation, not an app bug — retry rather than fail.
const FS_RETRY_ATTEMPTS = 5;
const FS_RETRY_BASE_MS  = 200;

async function withFsRetry(op) {
  for (let attempt = 1; ; attempt++) {
    try { return await op(); }
    catch (e) {
      if (e?.name !== 'InvalidStateError' || attempt >= FS_RETRY_ATTEMPTS) throw e;
      await new Promise(r => setTimeout(r, FS_RETRY_BASE_MS * attempt));
    }
  }
}

const Disk = {
  isSupported() {
    return typeof window.showOpenFilePicker === 'function'
        && typeof window.showSaveFilePicker === 'function';
  },

  async pickExisting() {
    if (!Disk.isSupported()) return null;
    try {
      const [handle] = await window.showOpenFilePicker({ id: 'grawlix', multiple: false });
      return handle || null;
    } catch (e) { if (e?.name === 'AbortError') return null; throw e; }
  },
  async pickNew(suggestedName) {
    if (!Disk.isSupported()) return null;
    try {
      return await window.showSaveFilePicker({ id: 'grawlix', suggestedName });
    } catch (e) { if (e?.name === 'AbortError') return null; throw e; }
  },

  async queryPermission(handle, mode = 'readwrite') {
    if (!handle) return 'denied';
    try { return (await handle.queryPermission?.({ mode })) ?? 'prompt'; }
    catch { return 'prompt'; }
  },
  async requestPermission(handle, mode = 'readwrite') {
    if (!handle) return false;
    try { return (await handle.requestPermission?.({ mode })) === 'granted'; }
    catch { return false; }
  },

  async read(handle) {
    return withFsRetry(async () => {
      try { return await (await handle.getFile()).text(); }
      catch (e) { if (e?.name === 'NotFoundError') return null; throw e; }
    });
  },
  async lastModified(handle) {
    return withFsRetry(async () => {
      try { return (await handle.getFile()).lastModified; }
      catch (e) { if (e?.name === 'NotFoundError') return null; throw e; }
    });
  },
  async write(handle, text) {
    return withFsRetry(async () => {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
    });
  },
};

const MirrorSync = {
  _timers: new Map(),

  schedule(list) {
    const key = syncKey(list);
    if (!syncTargets.has(key) || !isMirrorList(list)) return;
    this._debounce(key, () => this._flush(key));
  },
  scheduleMerged() {
    if (!syncTargets.has(MERGED_ID)) return;
    this._debounce(MERGED_ID, () => this._flush(MERGED_ID));
  },
  _debounce(key, fn) {
    clearTimeout(this._timers.get(key));
    this._timers.set(key, setTimeout(fn, MIRROR_WRITE_DELAY));
  },

  async _flush(key) {
    const t = syncTargets.get(key);
    if (!t) return;
    SyncStatus.set(key, 'writing');
    try {
      await Disk.write(t.handle, this._serialize(key));
      SyncStatus.set(key, 'synced');
    } catch (err) {
      console.error('mirror write failed', err);
      SyncStatus.set(key, 'unavailable');
    }
  },
  _serialize(key) {
    if (key === MERGED_ID) return serializeEntries(sortedEntries(buildMergedWordlist().entries), getOutputFormat());
    const list = listForSyncKey(key);
    return serializeEntries(sortedEntries(applyRescoring(list.rawEntries, list.rescoreRules || [])), getOutputFormat());
  },
};

// #region nodetest:merge3
function editsEntriesByNorm(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.norm, e);
  return m;
}
function editsEntryEqual(a, b) {
  if (!a || !b) return !a && !b;
  return a.score === b.score
    && (a.comment || '') === (b.comment || '')
    && (a.display ?? a.norm) === (b.display ?? b.norm);
}

// Conflicting norms default to the IDB/device side in `resolved`; the dialog's
// "keep the file" choice swaps them. One-sided changes are already applied here.
function threeWayMergeEdits(base, file, idb) {
  const bMap = editsEntriesByNorm(base), fMap = editsEntriesByNorm(file), iMap = editsEntriesByNorm(idb);
  const resolved = new Map();
  const conflicts = [];
  for (const norm of new Set([...bMap.keys(), ...fMap.keys(), ...iMap.keys()])) {
    const b = bMap.get(norm) || null, f = fMap.get(norm) || null, i = iMap.get(norm) || null;
    if (editsEntryEqual(f, i)) { if (f) resolved.set(norm, f); continue; }
    const fChanged = !editsEntryEqual(f, b);
    const iChanged = !editsEntryEqual(i, b);
    if (fChanged && !iChanged)      { if (f) resolved.set(norm, f); }
    else if (iChanged && !fChanged) { if (i) resolved.set(norm, i); }
    else { if (i) resolved.set(norm, i); conflicts.push({ norm, device: i, file: f }); }
  }
  return { resolved, conflicts };
}

function sameEditsEntries(a, b) {
  if (a.length !== b.length) return false;
  const am = editsEntriesByNorm(a), bm = editsEntriesByNorm(b);
  if (am.size !== bm.size) return false;
  for (const [norm, ae] of am) if (!editsEntryEqual(ae, bm.get(norm))) return false;
  return true;
}
// #endregion nodetest:merge3

function applyReconciledEdits(edits, entries) {
  batchUpdate(() => {
    invalidateWordlistCaches(edits);
    edits.rawEntries = entries;
    edits.lastUpdated = Date.now();
    compileRescoreRules(edits);
    persistMeta();
    repaintAfterCacheChange();
  });
  Storage.writeWordlist(edits, serializeEntries(sortedEntries(entries)))
    .catch(err => console.error('My Edits IDB write failed', err));
}

const EditsSync = {
  _pollId: null,
  _snapshotMtime: null,
  _held: 0,
  _ownWritePending: false,
  _writeTimer: null,
  _reconcileInFlight: false,

  handle()   { const t = syncTargets.get(editsSyncKey()); return t?.handle || null; },
  isActive() { return !!this.handle(); },

  async connect(handle) {
    const key = editsSyncKey();
    syncTargets.set(key, { handle, baseline: '' });
    await persistSyncTarget(key);
    SyncStatus.set(key, 'synced');
    await this.reconcile();
    this.start();
    renderSyncIndicators();
  },

  start() {
    if (this._pollId || !this.isActive()) return;
    // The first tick re-establishes the mtime baseline, absorbing any write
    // connect() just did — so a leftover own-write mark must not survive into it,
    // or the next genuine external edit gets consumed as ours and skipped.
    this._snapshotMtime = null;
    this._ownWritePending = false;
    this._pollId = setInterval(() => this._tick(), DISK_SYNC_POLL_INTERVAL);
    document.addEventListener('visibilitychange', this._onVisibility);
  },
  stop() {
    if (this._pollId) { clearInterval(this._pollId); this._pollId = null; }
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._snapshotMtime = null;
  },
  _onVisibility() {
    if (document.visibilityState === 'visible') EditsSync._tick();
  },

  scheduleWrite() {
    if (!this.isActive()) return;
    clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => this._flushWrite(), MIRROR_WRITE_DELAY);
  },
  async _flushWrite() {
    const key = editsSyncKey();
    const t = syncTargets.get(key);
    if (!t) return;
    const text = serializeEntries(sortedEntries(getEditsWordlist().rawEntries));
    if (text === t.baseline) return;
    SyncStatus.set(key, 'writing');
    try {
      await this._ownWrite(text);
      t.baseline = text;
      await persistSyncTarget(key);
      SyncStatus.set(key, 'synced');
    } catch (err) {
      console.error('My Edits file write failed', err);
      SyncStatus.set(key, 'unavailable');
    }
  },
  // `_held` skips ticks for the whole write so the watcher can't read a half-written
  // file; `_ownWritePending` consumes the mtime bump the write causes so the next
  // tick doesn't mistake it for an external edit and reconcile against itself.
  async _ownWrite(text) {
    const t = syncTargets.get(editsSyncKey());
    this._held++;
    try {
      await Disk.write(t.handle, text);
      this._ownWritePending = true;
    } finally {
      this._held--;
    }
  },

  async _tick() {
    if (document.visibilityState === 'hidden' || this._held > 0 || this._reconcileInFlight) return;
    const t = syncTargets.get(editsSyncKey());
    if (!t) return;
    const mtime = await Disk.lastModified(t.handle);
    if (mtime === null) { SyncStatus.set(editsSyncKey(), 'unavailable'); return; }
    if (this._snapshotMtime === null) { this._snapshotMtime = mtime; return; }
    if (mtime === this._snapshotMtime) return;
    this._snapshotMtime = mtime;
    if (this._ownWritePending) { this._ownWritePending = false; return; }
    this._reconcileInFlight = true;
    try { await this.reconcile(); }
    finally { this._reconcileInFlight = false; }
  },

  async reconcile() {
    const key = editsSyncKey();
    const t = syncTargets.get(key);
    if (!t) return;
    const edits = getEditsWordlist();
    const fileText = await Disk.read(t.handle);
    if (fileText === null) { SyncStatus.set(key, 'unavailable'); return; }

    const { resolved, conflicts } = threeWayMergeEdits(
      parseWordlist(t.baseline || ''), parseWordlist(fileText), edits.rawEntries);

    if (conflicts.length) {
      SyncStatus.set(key, 'conflict');
      const choice = await showEditsConflict(t.handle.name, conflicts);
      if (choice === 'file') {
        for (const c of conflicts) { if (c.file) resolved.set(c.norm, c.file); else resolved.delete(c.norm); }
      }
    }

    const merged = [...resolved.values()];
    if (!sameEditsEntries(merged, edits.rawEntries)) applyReconciledEdits(edits, merged);

    const outText = serializeEntries(sortedEntries(merged));
    if (outText !== fileText) await this._ownWrite(outText);
    t.baseline = outText;
    await persistSyncTarget(key);
    SyncStatus.set(key, 'synced');
  },
};

async function attachMirrorSync(list, { existing = false } = {}) {
  let handle;
  if (existing) {
    handle = await Disk.pickExisting();
    if (handle && !await Disk.requestPermission(handle, 'readwrite')) {
      await showAlert(`Grawlix needs permission to write ${esc(handle.name)} to sync it.`);
      return false;
    }
  } else {
    handle = await Disk.pickNew(rescoredFilename(list));
  }
  if (!handle) return false;
  const key = syncKey(list);
  syncTargets.set(key, { handle });
  await persistSyncTarget(key);
  SyncStatus.set(key, 'writing');
  await MirrorSync._flush(key);
  renderSyncIndicators();
  return true;
}

async function attachEditsSync({ existing }) {
  let handle;
  if (existing) {
    handle = await Disk.pickExisting();
    if (handle && !await Disk.requestPermission(handle, 'readwrite')) {
      await showAlert(`Grawlix needs permission to write ${esc(handle.name)} to sync it.`);
      return false;
    }
  } else {
    handle = await Disk.pickNew(EDITS_DEFAULT_FILENAME);
  }
  if (!handle) return false;
  await EditsSync.connect(handle);
  return true;
}

async function detachSync(list) {
  const key = syncKey(list);
  if (!syncTargets.has(key)) return true;
  if (!isMirrorList(list)) EditsSync.stop();
  syncTargets.delete(key);
  syncStatus.delete(key);
  await idbDel(SYNC_REC_PREFIX + key);
  renderSyncIndicators();
  return true;
}

function rescoredFilename(list) {
  return `${sanitizeFilenameStem(list === MERGED_ID ? MERGED_NAME : list.name)} rescored.txt`;
}

// #region nodetest:merge3
const RESERVED_DEVICE_NAMES = new Set(
  ['CON', 'PRN', 'AUX', 'NUL']
    .concat(Array.from({ length: 9 }, (_, i) => `COM${i + 1}`))
    .concat(Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`))
);
function sanitizeFilenameStem(name) {
  const stem = (name || '')
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!stem || RESERVED_DEVICE_NAMES.has(stem.toUpperCase())) return `${stem || 'Wordlist'}_`;
  return stem;
}
// #endregion nodetest:merge3

async function partitionSyncPermissions() {
  const granted = [], prompt = [];
  for (const [key, t] of syncTargets) {
    (await Disk.queryPermission(t.handle, 'readwrite') === 'granted' ? granted : prompt).push(key);
  }
  return { granted, prompt };
}

async function activateSyncTarget(key) {
  if (key === editsSyncKey()) {
    EditsSync.start();
    await EditsSync.reconcile();
  } else if (key === MERGED_ID) {
    MirrorSync.scheduleMerged();
  } else {
    MirrorSync.schedule(listForSyncKey(key));
  }
}

const showEditsConflict = (() => {
  let el, body;
  const side = e => e ? `${e.score}${e.comment ? ' (' + esc(e.comment) + ')' : ''}` : '(removed)';
  const show = function (filename, conflicts) {
    return new Promise(resolve => {
      const rows = conflicts.map(c =>
        `<div class="merge-entry-row"><b>${esc(c.device?.display ?? c.file?.display ?? c.norm)}</b> this device: ${side(c.device)} | file: ${side(c.file)}</div>`).join('');
      body.innerHTML = `
        <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
        <form method="dialog">
          <h2 id="edits-conflict-title">My Edits changed in two places</h2>
          <p class="dialog-msg">${conflicts.length} ${conflicts.length === 1 ? 'entry was' : 'entries were'} changed both here and in ${esc(filename)} since they last agreed. Keep which version?</p>
          <div class="merge-entries merge-entries-conflict">${rows}</div>
          <div class="dialog-footer dialog-footer-split">
            <button type="button" class="dialog-cancel-btn">Keep this device</button>
            <button class="primary" value="file" autofocus>Keep the file</button>
          </div>
        </form>`;
      showDialog(el, () => resolve(el.returnValue === 'file' ? 'file' : 'device'));
    });
  };
  show.mount = () => { ({ el, body } = createDialog('edits-conflict-dialog', { labelledby: 'edits-conflict-title' })); };
  return show;
})();

function persistMeta() {
  if (_batchDepth > 0) { _persistPending = true; return; }
  _persistMetaNow();
}

// #region nodetest:merge3
function serializeMetaEntry(l) {
  return {
    ...(l.type ? { type: l.type } : {}),
    dbKey: l.dbKey,
    ...(l.icon ? { icon: l.icon } : {}),
    ...(l.publisherId ? { publisherId: l.publisherId } : {}),
    name: l.name, url: l.url || null,
    enabled: l.enabled, populated: l.populated, lastUpdated: l.lastUpdated || null,
    fetchedSize: l.fetchedSize || null,
    rescoreRules: l.rescoreRules || [],
    ...(l.dirty ? { dirty: true } : {}),
    originalFilename: l.originalFilename || null,
  };
}
// #endregion nodetest:merge3

function _persistMetaNow() {
  Storage.writeMeta(state.sources.map(serializeMetaEntry));
  MirrorSync.scheduleMerged();
}

function persistScoring() {
  Storage.writeScoring(state.scoring, state.scoringDirty);
}

// ─── Dark mode ────────────────────────────────────────────────────────────────

const DARK_MODE_CYCLE = ['auto', 'light', 'dark'];
const DARK_MODE_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

function applyDarkMode(val) {
  const dark = val === 'dark' || (val !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark-mode', dark);
  document.documentElement.classList.toggle('light-mode', !dark);
}

function cycleDarkMode() {
  const current = lsLoad('darkMode') || 'auto';
  const next = DARK_MODE_CYCLE[(DARK_MODE_CYCLE.indexOf(current) + 1) % DARK_MODE_CYCLE.length];
  lsSave('darkMode', next);
  applyDarkMode(next);
  const seg = document.getElementById('dark-mode-seg');
  if (seg) seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === next));
  showToast(`Dark mode: ${DARK_MODE_LABELS[next]}`);
}

// ─── Dialog helpers ───────────────────────────────────────────────────────────

function enableDismissClicks(el, dismissOnBackdrop = true) {
  el.addEventListener('click', e => {
    const onDismissBtn = e.target.closest('.dialog-close-btn, .dialog-cancel-btn');
    const onBackdrop = e.target === el && dismissOnBackdrop;
    if (onDismissBtn || onBackdrop) el.close();
  });
}

function showDialog(el, onClose = null) {
  const opener = document.activeElement;
  el.returnValue = '';
  el.addEventListener('close', () => {
    opener?.focus();
    onClose?.();
  }, { once: true });
  el.showModal();
  if (!el.querySelector('[autofocus]')) {
    el.tabIndex = -1;
    el.focus();
  }
}

function createDialog(id, { labelledby, label, dismissOnBackdrop = true } = {}) {
  const el = document.createElement('dialog');
  el.id = id;
  if (labelledby) el.setAttribute('aria-labelledby', labelledby);
  if (label)      el.setAttribute('aria-label', label);
  enableDismissClicks(el, dismissOnBackdrop);
  const body = document.createElement('div');
  body.className = 'dialog-body';
  el.appendChild(body);
  document.body.appendChild(el);
  return { el, body };
}

// ─── Settings dialog ──────────────────────────────────────────────────────────

const SettingsDialog = (() => {
  let el, body, ofCtrls, resetSub;

  function mount() {
    ({ el, body } = createDialog('settings-dialog', { labelledby: 'settings-dialog-title' }));
    body.innerHTML = `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="settings-dialog-title">Settings</h2>
      <div class="dialog-row">
        <span class="dialog-row-label">Dark mode</span>
        <div id="dark-mode-seg"></div>
      </div>
      <div class="dialog-row">
        <div>
          <div class="dialog-row-label">Auto-update wordlists</div>
          <div class="dialog-row-sub">Update wordlists without asking</div>
        </div>
        <div id="auto-update-seg"></div>
      </div>
      <div class="of-section">
        <div class="dialog-row-label">Output format</div>
        <div class="dialog-row-sub">How entries are written to files and downloads.</div>
        <div id="output-format-ctrls" class="of-ctrls"></div>
      </div>
      <div class="dialog-row">
        <div>
          <div class="dialog-row-label">Reset browser data</div>
          <div class="dialog-row-sub" id="reset-row-sub"></div>
        </div>
        <button id="btn-reset" class="danger" title="Reset browser data"><svg class="icon-trash"><use href="#icon-trash"/></svg> Reset</button>
      </div>`;

    const seg  = el.querySelector('#dark-mode-seg');

    const darkSaved = lsLoad('darkMode') || 'auto';
    applyDarkMode(darkSaved);
    seg.innerHTML = buildSegCtrlHTML(null, [
      { value: 'auto',  label: 'Auto' },
      { value: 'light', label: '☀ Light' },
      { value: 'dark',  label: '☽ Dark' },
    ], darkSaved);
    seg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = () => {
        const val = btn.dataset.val;
        lsSave('darkMode', val);
        applyDarkMode(val);
        seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      };
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((lsLoad('darkMode') || 'auto') === 'auto') applyDarkMode('auto');
    });

    const autoSeg = el.querySelector('#auto-update-seg');
    autoSeg.innerHTML = buildSegCtrlHTML(null, [
      { value: 'off', label: 'Off' },
      { value: 'on',  label: 'On' },
    ], getAutoUpdate() ? 'on' : 'off');
    autoSeg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = () => {
        autoSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        lsSave('autoUpdate', btn.dataset.val);
        if (btn.dataset.val === 'on') checkForUpdates();
      };
    });

    ofCtrls  = el.querySelector('#output-format-ctrls');
    resetSub = el.querySelector('#reset-row-sub');

    el.querySelector('#btn-reset').onclick = async () => {
      if (!await showConfirm('Reset all wordlists and settings? This cannot be undone.', { confirmText: 'Reset' })) return;
      await resetAllDataAndReload();
    };
  }

  let ofRegenTimer = null;
  function flushRegen() {
    if (!ofRegenTimer) return;
    clearTimeout(ofRegenTimer);
    ofRegenTimer = null;
    regenerateFillOutputs();
  }

  function open() {
    resetSub.textContent = 'Reset all wordlists and settings';
    ofCtrls.innerHTML = buildOutputFormatControlsHTML(getOutputFormat());
    wireOutputFormatControls(ofCtrls, () => {
      setOutputFormat(readOutputFormatControls(ofCtrls));
      if (ofRegenTimer) clearTimeout(ofRegenTimer);
      ofRegenTimer = setTimeout(() => { ofRegenTimer = null; regenerateFillOutputs(); }, OUTPUT_FORMAT_REGEN_DELAY);
    });
    showDialog(el, flushRegen);
  }

  return { mount, open };
})();

// ─── Welcome dialog ───────────────────────────────────────────────────────────

const WelcomeDialog = (() => {
  let el, body;

  function mount() {
    ({ el, body } = createDialog('welcome-dialog', { labelledby: 'welcome-title' }));
    // Without this the All Wordlists count freezes at its open-time snapshot (~0 on a cold boot, before fetches populate the wordlists).
    effect(() => {
      sources$.get();
      cacheVersion$.get();
      if (!el.open) return;
      const count = el.querySelector('.welcome-merge-count');
      if (count) count.textContent = pluralize(buildMergedWordlist().entries.length, 'entry', 'entries');
    });
  }

  function render() {
    const toolsShot = FEATURED_TOOLS
      .map(k => TOOLS[k] ? buildToolCardHTML(k, TOOLS[k], { allButton: false }) : '')
      .join('');

    const featuredToolNames = FEATURED_TOOLS
      .filter(k => TOOLS[k])
      .map(k => TOOLS[k].name)
      .join(', ');

    const byPop = [...WORDLIST_PUBLISHERS].sort((a, b) => a.popularity - b.popularity);
    const names = byPop.map(p => p.name);
    const nameList = `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;

    const sourceIcons = byPop
      .map(p => buildIconHTML(p.icon, p.name, colorSeed(p)))
      .join('');

    const wordlistShot = `
      <div class="welcome-merge-sources">${sourceIcons}</div>
      <svg class="welcome-merge-arrow" width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M2 2l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="welcome-merge-all">
        <div class="welcome-merge-all-head">
          ${getMergedIcon()}
          <span class="welcome-merge-all-name">${MERGED_NAME}</span>
        </div>
        <span class="welcome-merge-count">${pluralize(buildMergedWordlist().entries.length, 'entry', 'entries')}</span>
      </div>`;

    const storageShot = `
      <ul class="welcome-sync-files">
        <li>📄 <strong>My Edits.txt</strong> <span class="welcome-sync-dir">⇄</span> Grawlix</li>
        <li>Grawlix <span class="welcome-sync-dir">→</span> 📄 <strong>${MERGED_NAME} rescored.txt</strong></li>
        <li>Grawlix <span class="welcome-sync-dir">→</span> 📄 Spread the Word(list).txt</li>
      </ul>`;

    const diskCaveat = Disk.isSupported() ? ''
      : isMobile() ? ' (Desktop only)'
      : ' (Chrome only)';

    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="welcome-title">Welcome to Grawlix</h2>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Hunt for puzzle ideas</h3>
          <p>Comb the beach with ${featuredToolNames}, and a few dozen more tools. Combine them to unlock new wordplay possibilities.</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-tools">${toolsShot}</div></div>
      </section>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Search multiple popular wordlists</h3>
          <p>${nameList} are at your fingertips. Grawlix rescores each onto a common scale.</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-merge">${wordlistShot}</div></div>
      </section>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Sync with your construction software</h3>
          <p>Point Grawlix at a file you already feed to Ingrid, Crossfire, or Crossword Compiler. Your edits flow both ways, automatically.${diskCaveat}</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-storage">${storageShot}</div></div>
      </section>

      <div class="dialog-footer">
        <button type="button" class="primary dialog-cancel-btn" autofocus>Get started</button>
      </div>`;
  }

  function open() {
    render();
    showDialog(el, () => lsSave('welcomeSeen', '1'));
  }

  return { mount, open };
})();

// ─── Boot reconnect splash ────────────────────────────────────────────────────

// Must run inside a click — FSA gates requestPermission/pickers on a user gesture,
// so calling this off a gesture silently fails.
async function regrantSyncTarget(key) {
  const t = syncTargets.get(key);
  if (!t) return false;
  if (await Disk.requestPermission(t.handle, 'readwrite') && await Disk.lastModified(t.handle) !== null) {
    await activateSyncTarget(key);
    SyncStatus.set(key, 'synced');
    return true;
  }
  return repickSyncTarget(key);
}

async function repickSyncTarget(key) {
  const isEdits = key === editsSyncKey();
  let handle;
  if (isEdits) {
    handle = await Disk.pickExisting();
    if (handle && !await Disk.requestPermission(handle, 'readwrite')) return false;
  } else {
    handle = await Disk.pickNew(syncFilename(key) || rescoredFilename(listForSyncKey(key)));
  }
  if (!handle) return false;
  syncTargets.set(key, isEdits ? { handle, baseline: '' } : { handle });
  await persistSyncTarget(key);
  await activateSyncTarget(key);
  SyncStatus.set(key, 'synced');
  return true;
}

const ReconnectSplash = (() => {
  let _hasAnimatedIn = false;

  function ensureOverlay() {
    let overlay = document.getElementById('splash-screen');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'splash-screen';
    overlay.innerHTML = `<div class="splash-logo">Grawlix <span class="bubble">!@#$</span></div><div class="splash-spinner"><span></span><span></span><span></span></div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function show(keys) {
    return new Promise(resolve => {
      const overlay = ensureOverlay();
      const spinner = overlay.querySelector('.splash-spinner');
      if (spinner) spinner.hidden = true;
      const pending = new Set(keys);

      const finish = () => {
        overlay.classList.add('done');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        resolve();
      };

      function render() {
        overlay.querySelectorAll('.splash-reconnect').forEach(e => e.remove());
        const wrap = document.createElement('div');
        wrap.className = _hasAnimatedIn ? 'splash-reconnect' : 'splash-reconnect animated';
        _hasAnimatedIn = true;

        const intro = document.createElement('p');
        intro.className = 'splash-reconnect-intro';
        intro.textContent = pending.size === 1
          ? 'Reopen your synced file to resume syncing.'
          : 'Reopen your synced files to resume syncing.';
        wrap.appendChild(intro);

        for (const key of pending) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'primary splash-reconnect-open';
          btn.textContent = `Open ${syncFilename(key)}`;
          btn.onclick = async () => {
            btn.disabled = true;
            const ok = await regrantSyncTarget(key);
            btn.disabled = false;
            if (!ok) return;
            pending.delete(key);
            pending.size ? render() : finish();
          };
          wrap.appendChild(btn);
        }

        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'splash-reconnect-skip';
        skip.textContent = 'Skip for now';
        skip.onclick = finish;
        wrap.appendChild(skip);

        overlay.appendChild(wrap);
        wrap.querySelector('.splash-reconnect-open')?.focus();
      }

      render();
    });
  }

  return { show };
})();

// ─── App view ─────────────────────────────────────────────────────────────────
const AppView = (() => {
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
    if (entriesScroller) entriesScroller.setScoreRange(range);
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
    const tier = chainSortTier(ToolStack.getStack());
    _sortKey = sortKey || DEFAULT_SORT_BY_TIER[tier];
    _sortDir = sortDir || 'asc';
    reconcileSort(ToolStack.getStack());
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

// ─── Wordlist selector ─────────────────────────────────────────────────────────
// Pure-scope: clicking a row drives setScope. Enable/disable toggling stays out
// of here on purpose — it lives in the manage panel.

const WordlistSelector = (() => {
  let bar, root, trigger, menu, actions, metaRow, dlSlot, kebabSlot;
  let editorToggle, editor, editorInner;
  let editorOpen = false;

  function scopeIcon(scope)  { return scope === MERGED_ID ? getMergedIcon() : getWordlistIcon(scope); }
  function scopeLabel(scope) { return scope === MERGED_ID ? MERGED_NAME : scope.name; }

  function renderTrigger() {
    const scope = state.selected;
    trigger.querySelector('.wls-trigger-icon').innerHTML = scopeIcon(scope);
    trigger.querySelector('.wls-trigger-label').textContent = scopeLabel(scope);
    const severity = sourcesSeverity();
    trigger.querySelector('.wls-trigger-badge').innerHTML =
      buildBadgeHTML(severity, { title: severityTitle(severity) });
  }

  function downloadBtnHTML() {
    const scope = state.selected;
    if (scope === MERGED_ID) {
      const hasData = buildMergedWordlist().entries.length > 0;
      return hasData ? `<button id="download-btn" title="Download the merged wordlist" onclick="WordlistActions.action('download')">Download</button>` : '';
    }
    if (!scope.rawEntries.length) return '';
    const hasRules = (scope.rescoreRules?.length ?? 0) > 0;
    return hasRules
      ? buildSplitBtn('Download', `WordlistActions.action('download')`,
          [['Download original', `WordlistActions.action('downloadOriginal')`]], { id: 'download-btn', title: 'Download this wordlist (rescored)' })
      : `<button id="download-btn" title="Download this wordlist" onclick="WordlistActions.action('download')">Download</button>`;
  }

  function kebabHTML() {
    const scope = state.selected;
    if (scope === MERGED_ID) return '';
    let items;
    if (scope.type === 'edits') {
      items = [
        ['Import', `WordlistActions.action('import')`],
        ['Clear',  `WordlistActions.action('clear')`],
      ];
    } else {
      const fetchItems = scope.url
        ? [['Fetch', `WordlistActions.action('fetch')`], ['Import', `WordlistActions.action('import')`]]
        : [['Import', `WordlistActions.action('import')`]];
      items = [
        ...fetchItems,
        ['Configure', `WordlistActions.action('configure')`],
        ['Delete',    `WordlistActions.action('delete')`],
      ];
    }
    return buildMoreMenuHTML(items, { className: 'wls-kebab' });
  }

  let _dateTimer = null;
  function renderActions() {
    if (_dateTimer) { clearInterval(_dateTimer); _dateTimer = null; }
    const scope = state.selected;
    const hasDate = scope !== MERGED_ID && scope.rawEntries.length && scope.lastUpdated;
    const dateSlot = hasDate ? '<span class="detail-date"></span>' : '';
    dlSlot.innerHTML = `${dateSlot}${downloadBtnHTML()}`;
    kebabSlot.innerHTML = kebabHTML();
    if (hasDate) {
      const setDate = () => {
        const dEl = actions.querySelector('.detail-date');
        if (!dEl) return;
        dEl.textContent = `Last updated ${timeAgo(scope.lastUpdated)}`;
        dEl.title = new Date(scope.lastUpdated).toLocaleString();
      };
      setDate();
      _dateTimer = setInterval(setDate, 60_000);
    }
  }

  function renderMeta() {
    metaRow.innerHTML = syncSignHTML(state.selected);
  }

  // In-place patch, never a renderMeta: sync status flips on every debounced
  // save, and re-rendering the bar mid-edit would steal focus and scroll.
  function refreshSyncSign() {
    const hang = metaRow.querySelector('.sync-hang');
    if (hang) hang.outerHTML = syncSignHTML(state.selected);
  }

  function optionHTML(scope, contribMap) {
    const selected = scope === state.selected;
    if (scope === MERGED_ID) {
      return buildWordlistCardHTML(getMergedIcon(), MERGED_NAME,
        pluralize(buildMergedWordlist().entries.length, 'entry', 'entries'),
        { draggable: false, toggle: false, selected });
    }
    const severity = wordlistSeverity(scope);
    return buildWordlistCardHTML(getWordlistIcon(scope), scope.name,
      wordlistCardMeta(scope, contribMap),
      { draggable: false, toggle: false, selected, enabled: scope.enabled, populated: scope.populated,
        severity, severityTitle: severityTitle(severity) });
  }

  function buildContribMap() {
    if (!_sourceCountsCache) _sourceCountsCache = buildMergedWordlist().sourceCounts;
    return new Map(_sourceCountsCache.map(s => [s.wordlist, s.count]));
  }

  function renderMenu() {
    const scopes = [MERGED_ID, ...state.sources];
    const contribMap = buildContribMap();
    menu.innerHTML =
        `<div class="wls-menu-section">Merged</div>`
      + optionHTML(MERGED_ID, contribMap)
      + `<div class="wls-menu-section">Sources</div>`
      + state.sources.map(s => optionHTML(s, contribMap)).join('')
      + `<button type="button" class="wls-configure-footer">`
      + `<svg aria-hidden="true"><use href="#icon-settings"/></svg>Manage wordlists</button>`;
    menu.querySelectorAll('.wordlist-card').forEach((el, i) => {
      el._scope = scopes[i];
      el.setAttribute('aria-selected', String(scopes[i] === state.selected));
    });
  }

  function open() {
    renderMenu();
    root.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutsideClick);
  }
  function close() {
    if (!root.classList.contains('open')) return;
    root.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick);
  }
  function onOutsideClick(e) { if (!e.target.closest('.wls')) close(); }

  function editorLabel() {
    return state.selected === MERGED_ID ? 'Scoring tiers' : 'Rescoring rules';
  }
  function syncToggleLabel() {
    editorToggle.title = editorLabel();
    editorToggle.setAttribute('aria-label', editorLabel());
  }
  function renderEditorContent() {
    editorInner.innerHTML = state.selected === MERGED_ID
      ? buildScoringSectionHTML('scoring-rules')
      : buildRescoreSectionHTML(state.selected, 'rescore-rules');
  }
  function refreshEditor() {
    syncToggleLabel();
    if (editorOpen) renderEditorContent();
  }
  function setEditorOpen(open) {
    editorOpen = open;
    editorToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      // Unhide before flipping .rescore-open so the grid-rows transition runs
      // from 0fr; toggling both in one frame would skip the animation.
      editor.hidden = false;
      renderEditorContent();
      requestAnimationFrame(() => bar.classList.add('rescore-open'));
    } else {
      bar.classList.remove('rescore-open');
      hideAfterCollapse();
    }
    // The raw → rescored preview lives in the scroller rows, gated on the
    // editor's open state, so toggling it must repaint the table — refreshEditor
    // only touches the editor's own subtree.
    if (entriesScroller) refreshMergedScroller();
  }
  function hideAfterCollapse() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
      if (editorOpen) return; // reopened mid-transition
      editor.hidden = true;
      editorInner.innerHTML = '';
    };
    if (reduced) { finish(); return; }
    editor.addEventListener('transitionend', function te(e) {
      if (e.target !== editor || e.propertyName !== 'grid-template-rows') return;
      editor.removeEventListener('transitionend', te);
      finish();
    });
  }

  function refresh() {
    renderTrigger();
    renderActions();
    renderMeta();
    if (root.classList.contains('open')) renderMenu();
    refreshEditor();
  }

  function refreshMeta() {
    if (root.classList.contains('open')) renderMenu();
  }

  function mount() {
    bar = document.createElement('div');
    bar.id = 'wordlist-bar';
    bar.innerHTML = `
      <div class="wls-bar-top">
        <div class="wls">
          <button type="button" class="wls-trigger" aria-haspopup="listbox" aria-expanded="false">
            <span class="wls-trigger-icon"></span>
            <span class="wls-trigger-label"></span>
            <span class="wls-trigger-badge"></span>
            <svg class="wls-trigger-chevron" width="10" height="6" aria-hidden="true"><use href="#icon-arrow"/></svg>
          </button>
          <div class="wls-menu" role="listbox" tabindex="-1"></div>
        </div>
        <div class="wls-actions">
          <span class="wls-dl-slot"></span>
          <button type="button" class="rescore-toggle" aria-expanded="false" aria-controls="rescore-editor">
            <svg class="rescore-toggle-icon" width="18" height="18" aria-hidden="true"><use href="#icon-adjustments"/></svg>
          </button>
          <span class="wls-kebab-slot"></span>
        </div>
      </div>
      <div class="wls-bar-meta"></div>
      <div id="rescore-editor" hidden><div class="rescore-editor-inner"></div></div>`;
    document.getElementById('app').prepend(bar);

    root    = bar.querySelector('.wls');
    trigger = bar.querySelector('.wls-trigger');
    menu    = bar.querySelector('.wls-menu');
    actions = bar.querySelector('.wls-actions');
    metaRow = bar.querySelector('.wls-bar-meta');
    dlSlot    = bar.querySelector('.wls-dl-slot');
    kebabSlot = bar.querySelector('.wls-kebab-slot');

    // The editor must stay inside #wordlist-bar: the sticky
    // ResizeObserver watches the bar and cascades the table's offset from its
    // height, so an editor mounted elsewhere would expand under the pinned
    // headers instead of pushing them down.
    editorToggle = bar.querySelector('.rescore-toggle');
    editor       = bar.querySelector('#rescore-editor');
    editorInner  = editor.querySelector('.rescore-editor-inner');

    trigger.addEventListener('click', () => root.classList.contains('open') ? close() : open());
    menu.addEventListener('click', e => {
      if (e.target.closest('.wls-configure-footer')) {
        close();
        ManagePanel.open();
        return;
      }
      const opt = e.target.closest('.wordlist-card');
      if (!opt) return;
      close();
      setScope(opt._scope);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    editorToggle.addEventListener('click', () => setEditorOpen(!editorOpen));

    renderTrigger();
    syncToggleLabel();
  }

  return { mount, refresh, refreshEditor, refreshSyncSign, refreshMeta, isEditorOpen: () => editorOpen };
})();

// ─── Discovery banner ───────────────────────────────────────────────────────────

// Sibling above #detail-panel, not inside it: a banner mounted in the scroller's
// fixed-row-height container would corrupt row layout, and a sticky one would
// permanently consume vertical space for a one-time dismissable notice.
const DiscoveryBanner = (() => {
  let el;

  const BANNERS = [
    {
      key: 'banner_myedits_dismissed',
      when: scope => scope !== MERGED_ID && scope?.type === 'edits',
      body: 'This is <strong>My Edits</strong> — your own corrections and additions, and they win over every other list. Already keep a word list of your own? Import it and it lands right here.',
    },
    {
      // XWI is paywalled, so Grawlix ships only its default scores, never the
      // list itself — gate on !populated so the nudge stops once a subscriber
      // has brought their real copy in.
      key: 'banner_xwi_dismissed',
      when: scope => scope !== MERGED_ID && scope?.publisherId === 'xwi' && !scope.populated,
      body: 'Got an <strong>XWord Info</strong> subscription? You can import your real XWI list here — Grawlix ships only XWI’s default scores, so the genuine list is a big step up.',
    },
  ];

  function pick() {
    return BANNERS.find(b => b.when(state.selected) && lsLoad(b.key) !== '1') || null;
  }

  function refresh() {
    const banner = pick();
    if (!banner) { el.hidden = true; el.innerHTML = ''; el.dataset.banner = ''; return; }
    if (el.dataset.banner === banner.key) return;   // already showing this one
    el.dataset.banner = banner.key;
    el.innerHTML = `
      <button type="button" class="discovery-banner-close" aria-label="Dismiss">✕</button>
      <p>${banner.body}</p>
      <div class="discovery-banner-actions">
        <button type="button" class="discovery-banner-import primary">Import</button>
      </div>`;
    el.hidden = false;
  }

  function mount() {
    el = document.createElement('div');
    el.id = 'discovery-banner';
    el.hidden = true;
    document.getElementById('detail-panel').before(el);

    el.addEventListener('click', e => {
      if (e.target.closest('.discovery-banner-close')) {
        const key = el.dataset.banner;
        if (key) lsSave(key, '1');
        el.hidden = true;
        el.innerHTML = '';
        el.dataset.banner = '';
        return;
      }
      if (e.target.closest('.discovery-banner-import')) {
        WordlistActions.action('import');
      }
    });
  }

  return { mount, refresh };
})();

// ─── Manage wordlists panel ─────────────────────────────────────────────────────

const ManagePanel = (() => {
  let el, listEl, closeBtn, applyBtn, addRow;
  let shadow = null;

  function rowHTML(wl) {
    // Added-while-open lists are absent from shadow.enabled by design; falling
    // back to live wl.enabled keeps their async force-enable from reading as a
    // staged disable here, in isDirty, and in apply.
    const enabled = shadow.enabled.get(wl) ?? wl.enabled;
    return buildWordlistCardHTML(
      getWordlistIcon(wl),
      wl.name,
      pluralize(wl.rawEntries.length, 'entry', 'entries'),
      { enabled, populated: wl.populated },
    );
  }

  function render() {
    listEl.innerHTML = shadow.order.map(rowHTML).join('');
    listEl.querySelectorAll('.wordlist-card').forEach((cardEl, i) => { cardEl._wordlist = shadow.order[i]; });
  }

  function absorb() {
    let grew = false;
    for (const wl of state.sources) {
      // Stays out of shadow.enabled on purpose — see rowHTML's fallback note.
      if (!shadow.order.includes(wl)) { shadow.order.push(wl); grew = true; }
    }
    if (grew) render();
  }

  function isDirty() {
    if (shadow.order.length !== state.sources.length) return true;
    if (shadow.order.some((wl, i) => wl !== state.sources[i])) return true;
    return shadow.order.some(wl => (shadow.enabled.get(wl) ?? wl.enabled) !== wl.enabled);
  }

  function apply() {
    if (isDirty()) {
      batchUpdate(() => {
        state.sources.splice(0, state.sources.length, ...shadow.order);
        for (const wl of state.sources) wl.enabled = shadow.enabled.get(wl) ?? wl.enabled;
        persistMeta();
        repaintAfterCacheChange();
      });
    }
    el.close();
  }

  function mount() {
    let body;
    ({ el, body } = createDialog('manage-dialog', { labelledby: 'manage-dialog-title', dismissOnBackdrop: false }));
    body.innerHTML = `
      <button type="button" class="manage-close-btn" aria-label="Close">✕</button>
      <h2 id="manage-dialog-title">Manage wordlists</h2>
      <div class="manage-list"></div>
      <button type="button" class="manage-add-row"><span class="add-wordlist-icon">＋</span>Add wordlist</button>
      <div class="dialog-footer">
        <button type="button" class="manage-cancel-btn dialog-cancel-btn">Cancel</button>
        <button type="button" class="manage-apply-btn primary">Apply</button>
      </div>`;

    listEl   = el.querySelector('.manage-list');
    closeBtn = el.querySelector('.manage-close-btn');
    applyBtn = el.querySelector('.manage-apply-btn');
    addRow   = el.querySelector('.manage-add-row');

    listEl.addEventListener('change', e => {
      const input = e.target.closest('.toggle input[type="checkbox"]');
      if (!input) return;
      const card = input.closest('.wordlist-card');
      // Must write the shadow map, never wl.enabled: touching wl.enabled here would
      // silently mutate canonical state and rebuild the merge mid-staging, defeating
      // the Apply gate while looking identical on screen.
      shadow.enabled.set(card._wordlist, input.checked);
      card.classList.toggle('disabled', !input.checked);
    });

    // Stage into shadow.order, never reorderSources: that canonical path would
    // rebuild the merge mid-staging and defeat the Apply gate, looking identical
    // on screen — the same trap as the enable toggle above.
    makeReorderable(listEl, {
      handleSelector: '.drag-handle:not([aria-hidden])',
      itemSelector:   '.wordlist-card',
      onReorder: (fromEl, beforeEl) => {
        const from = shadow.order.indexOf(fromEl._wordlist);
        let to = beforeEl ? shadow.order.indexOf(beforeEl._wordlist) : shadow.order.length;
        if (to > from) to--;
        const [item] = shadow.order.splice(from, 1);
        shadow.order.splice(to, 0, item);
        render();
      },
    });

    applyBtn.addEventListener('click', apply);
    closeBtn.addEventListener('click', async () => {
      if (isDirty() && !await showConfirm('Discard changes?', { confirmText: 'Discard' })) return;
      el.close();
    });

    addRow.addEventListener('click', () => ConfigureWordlistDialog.openAdd(absorb));

    // Self-gates on shadow rather than subscribing only while open: the signals
    // lib has no teardown, so this lifelong effect must no-op when closed.
    effect(() => {
      cacheVersion$.get();
      if (shadow) { absorb(); render(); }
    });
  }

  function open() {
    shadow = { order: [...state.sources], enabled: new Map(state.sources.map(wl => [wl, wl.enabled])) };
    render();
    showDialog(el, () => { shadow = null; });
  }

  return { mount, open };
})();

// ─── Wordlist actions dispatcher ──────────────────────────────────────────────

const WordlistActions = (() => {
  const ACTIONS = {
    fetch:     () => fetchWordlist(getActionTargetWordlist()),
    import:    () => importToWordlist(getActionTargetWordlist()),
    delete:    async () => { await deleteWordlist(getActionTargetWordlist()); },
    configure: () => ConfigureWordlistDialog.open(getActionTargetWordlist()),
    clear:     () => clearEdits(),
    bakeRescoring: () => bakeRescoring(getActionTargetWordlist()),
    download:  () => {
      const target = getActionTargetWordlist();
      if (target === MERGED_ID) return downloadMergedWordlistFromPanel();
      return downloadSourceWordlist(target);
    },
    downloadOriginal: () => downloadOriginalWordlist(getActionTargetWordlist()),
    openSync:      () => SyncDialog.open(getActionTargetWordlist()),
    syncExisting:  () => { const t = getActionTargetWordlist(); return syncThen(isMirrorList(t) ? attachMirrorSync(t, { existing: true })  : attachEditsSync({ existing: true })); },
    syncNew:       () => { const t = getActionTargetWordlist(); return syncThen(isMirrorList(t) ? attachMirrorSync(t, { existing: false }) : attachEditsSync({ existing: false })); },
    stopSync:      () => syncThen(detachSync(getActionTargetWordlist())),
  };

  async function syncThen(promise) {
    try { return await promise; }
    catch (err) { console.error('sync action failed', err); return false; }
  }

  function action(name) {
    const fn = ACTIONS[name];
    return fn ? fn() : undefined;
  }

  return { action };
})();

function wordlistFromMeta(m, text) {
  const wordlist = wrapWordlist({
    ...(m.type     ? { type: m.type }         : {}),
    dbKey:         m.dbKey || newDbKey(),
    icon:            m.icon || null,
    publisherId:     m.publisherId || null,
    name: m.name, url: m.url || null,
    enabled: !!m.enabled,
    populated: !!(m.populated || text || m.lastUpdated),
    lastUpdated: m.lastUpdated || null,
    fetchedSize: m.fetchedSize || null,
    rescoreRules: (m.rescoreRules || []).map(r => ({ length: '', ...r })),
    dirty: !!m.dirty,
    originalFilename: m.originalFilename || null,
    rawEntries: text ? parseWordlist(text) : [],
    _loading: false,
  });
  compileRescoreRules(wordlist);
  return wordlist;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Resolves when init() fully completes. The test bridge awaits this before
// driving the UI: `_db` (set early in openDB) goes non-null long before
// applyURL/renderAll, so a test gated on it alone races init's tail, which
// resets the tool stack and re-runs the first render over the test's own.
let _signalReady;
const _ready = new Promise(r => { _signalReady = r; });

async function init() {
  const storedSchema = Storage.schemaVersion();
  const hasOldData   = Storage.hasData();
  if (hasOldData && storedSchema !== SCHEMA_VERSION) {
    if (!(canMigrate(storedSchema) && migrateLocalStorage(storedSchema))) {
      const reset = await showConfirm(
        `Grawlix's data format has changed since your last visit. The site may not work correctly until reset.`,
        { confirmText: 'Reset', cancelText: 'I\'ll take my chances' }
      );
      if (reset) {
        await resetAllDataAndReload();
      }
    }
  } else if (!hasOldData) {
    Storage.setSchemaVersion(SCHEMA_VERSION);
  }

  await openDB();

  // Commit the splash fade to the compositor before the synchronous parse
  // below blocks the main thread, else the logo reveal stalls mid-fade.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const meta = Storage.readMeta();
  if (meta) {
    try {
      state.sources = await Promise.all(meta.map(async m => {
        const m2 = { ...m, dbKey: m.dbKey || newDbKey() };
        const text = await Storage.readWordlist(m2) ?? await idbGet('data_' + m.id);
        return wordlistFromMeta(m2, text);
      }));
    } catch { state.sources = defaultSources(); }
  } else {
    state.sources = defaultSources();
    persistMeta();
  }

  // Scope must land before the score ranges (the active range is keyed off the
  // restored scope) and before the first render (the selector + panel read
  // state.selected). Scope is localStorage-only, never the URL, so it's
  // independent of Router.applyURL below.
  restoreSelectedScope();
  AppView.restoreScoreRanges(restoreScoreRanges());

  Router.applyURL();

  ensureScoring();
  ensureEdits();
  propagateDefaults();
  AppView.show();
  Router.navigate();
  renderAll();
  await _firstPaint;

  await loadSyncTargets();
  const { granted, prompt } = await partitionSyncPermissions();
  const _overlay = document.getElementById('splash-screen');
  if (prompt.length) {
    ReconnectSplash.show(prompt);
  } else if (_overlay) {
    _overlay.classList.add('done');
    _overlay.addEventListener('transitionend', () => _overlay.remove(), { once: true });
  }
  Promise.all(granted.map(activateSyncTarget)).catch(err => console.error('sync resume failed', err));

  bindEvents();
  if (!lsLoad('welcomeSeen')) WelcomeDialog.open();
  checkForUpdates();
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);

  state.sources
    .filter(l => l.url && !l.populated)
    .forEach(l => fetchWordlist(l, null, { silent: true }));

  loadUnigramCorpus().catch(() => { /* surfaced when the tool is used */ });
  _signalReady();
}

function defaultSources() {
  return WORDLIST_PUBLISHERS.map(t => {
    const wordlist = wrapWordlist({
      dbKey: newDbKey(),
      icon: t.icon ? { ...t.icon } : null,
      publisherId: t.id,
      name: t.name,
      url: t.url || null,
      enabled: false,
      populated: false,
      rawEntries: [],
      lastUpdated: null,
      _loading: false,
      rescoreRules: t.defaultRules ? JSON.parse(JSON.stringify(t.defaultRules)) : [],
    });
    compileRescoreRules(wordlist);
    return wordlist;
  });
}

// A stored dbKey scopes to that source even when disabled — disabled sources
// stay viewable when scoped to, so don't add an enabled guard here.
function restoreSelectedScope() {
  const stored = lsLoad('selectedScope');
  if (!stored || stored === MERGED_ID) return;
  const source = state.sources.find(w => w.dbKey === stored);
  if (source) state.selected = source;
}

function restoreScoreRanges() {
  let parsed;
  try { parsed = JSON.parse(lsLoad('scoreRanges') || '{}'); }
  catch { return {}; }
  if (!parsed || typeof parsed !== 'object') return {};
  const out = {};
  for (const [key, range] of Object.entries(parsed)) {
    if (typeof range === 'string' && parseRange(range.trim()) !== null) out[key] = range.trim();
  }
  return out;
}

// ─── My Edits helpers ─────────────────────────────────────────────────────────

function getEditsWordlist() {
  return state.sources.find(l => l.type === 'edits');
}

function ensureEdits() {
  const edits = getEditsWordlist();
  if (edits) {
    if (!edits.icon) edits.icon = EDITS_ICON;
  } else {
    const newEdits = wrapWordlist({
      type: 'edits',
      dbKey: newDbKey(),
      icon: EDITS_ICON,
      name: 'My Edits',
      url: null,
      enabled: true,
      populated: true,
      rawEntries: [],
      lastUpdated: null,
      _loading: false,
      rescoreRules: editsLegend(),
    });
    compileRescoreRules(newEdits);
    state.sources.unshift(newEdits);
    sources$.bump();
    persistMeta();
  }
}

// Load tier labels from storage, or seed defaults on first boot.
function ensureScoring() {
  const stored = Storage.readScoring();
  if (stored && Array.isArray(stored.scoring)) {
    state.scoring = stored.scoring;
    state.scoringDirty = stored.dirty;
    return;
  }
  state.scoring = DEFAULT_SCORING.map(r => ({ ...r }));
  state.scoringDirty = false;
  persistScoring();
}

const AS_IS_FORMAT = { spaces: true, punctuation: true, accents: true, comments: true };

function formatEntryText(e, fmt) {
  let s = e.display ?? e.norm;
  if (!fmt.accents)     s = stripAccents(s);
  if (!fmt.spaces)      s = s.replace(/\s+/g, '');
  if (!fmt.punctuation) s = s.replace(/[^\p{L}\p{N}\s]/gu, '');
  return s;
}

function serializeEntries(entries, fmt = AS_IS_FORMAT) {
  const transforming = !fmt.spaces || !fmt.punctuation || !fmt.accents;
  let lines;
  if (transforming) {
    // formatEntryText is many-to-one under stripping (café/cafe, the IRS/theirs);
    // collapse or the output file gets duplicate, conflicting entry lines.
    const byText = new Map();
    for (const e of entries) {
      const text = formatEntryText(e, fmt);
      const cur = byText.get(text);
      if (!cur) byText.set(text, { text, score: e.score, comments: e.comment ? [{ comment: e.comment, score: e.score }] : [] });
      else {
        cur.score = Math.max(cur.score, e.score);
        if (e.comment) cur.comments.push({ comment: e.comment, score: e.score });
      }
    }
    lines = [...byText.values()].map(({ text, score, comments }) => {
      if (!fmt.comments || !comments.length) return `${text};${score}`;
      const combined = [...new Set(comments.sort((a, b) => b.score - a.score).map(c => c.comment))].join(' / ');
      return `${text};${score};${combined}`;
    });
  } else {
    lines = entries.map(e => {
      const head = e.display ?? e.norm;
      return (fmt.comments && e.comment) ? `${head};${e.score};${e.comment}` : `${head};${e.score}`;
    });
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

function getOutputFormat() {
  return { ...AS_IS_FORMAT, ...(Storage.readMergedSettings().outputFormat || {}) };
}

function setOutputFormat(fmt) {
  Storage.writeMergedSettings({ ...Storage.readMergedSettings(), outputFormat: fmt });
}

let _regenInFlight = false, _regenAgain = false;
// My Edits is excluded — its file is always written as-is, never output-format-
// stripped; including it here would silently destroy the user's rich entries.
async function regenerateFillOutputs() {
  // A format change landing mid-rewrite re-runs once at the end; without it the
  // files would sit stale at the pre-change format until the next edit.
  if (_regenInFlight) { _regenAgain = true; return; }
  _regenInFlight = true;
  try {
    do {
      _regenAgain = false;
      for (const wl of state.sources) {
        if (wl.type !== 'edits' && syncTargets.has(wl.dbKey)) await MirrorSync._flush(wl.dbKey);
      }
      if (syncTargets.has(MERGED_ID)) await MirrorSync._flush(MERGED_ID);
    } while (_regenAgain);
  } finally { _regenInFlight = false; }
}

function sortedEntries(entries) {
  return [...entries].sort((a, b) => a.norm.localeCompare(b.norm));
}

async function persistEdits(edits) {
  await Storage.writeWordlist(edits, serializeEntries(sortedEntries(edits.rawEntries)));
  persistMeta();
  EditsSync.scheduleWrite();
}

// Gated to user-owned, non-fetched lists: a fetch URL would re-pull the
// original-scale data and clobber the bake, and a publisher's defaultRules are a
// live transform, so resetting a baked publisher list to them would re-rescore
// the already-baked scores.
function canBakeRescoring(wordlist) {
  return !wordlist.publisherId && !wordlist.url && bakingWouldChangeScores(wordlist);
}

function bakingWouldChangeScores(wordlist) {
  return getRescoredEntries(wordlist).some((e, i) => e.score !== wordlist.rawEntries[i].score);
}

function bakeMenuOpts(wordlist) {
  if (canBakeRescoring(wordlist)) return {};
  const reason = (wordlist.publisherId || wordlist.url)
    ? 'Only available for My Edits and imported lists'
    : 'No rescoring to apply';
  return { disabled: true, title: reason };
}

// Reset like a fresh import. The dirty = false is load-bearing: reconcile
// early-returns on a dirty list, so without it a prior translation setup would
// survive the bake and silently re-impose the dual scale baking just resolved.
function resetRescoreRulesAfterBake(wordlist) {
  if (wordlist.type === 'edits') {
    wordlist.rescoreRules = editsLegend();
    wordlist.dirty = false;
    reconcileEditsRulesAfterImport(wordlist);
  } else {
    wordlist.rescoreRules = [];
    maybeAutoSeedRescoreRules(wordlist);
  }
}

async function bakeRescoring(wordlist) {
  if (!canBakeRescoring(wordlist)) return;
  const html = `Permanently rescore ${buildWordlistNameHTML(wordlist)}? This will rewrite every entry's score using the current rules, then reset the rules. The original scores will be lost — use <strong>Download original</strong> first if you want a backup.`;
  if (!await showConfirm('', { confirmText: 'Rescore', html })) return;

  const baked = getRescoredEntries(wordlist).map(e => ({ ...e }));
  batchUpdate(() => {
    invalidateWordlistCaches(wordlist);
    wordlist.rawEntries = baked;
    resetRescoreRulesAfterBake(wordlist);
    compileRescoreRules(wordlist);
    repaintAfterCacheChange();
  });

  if (wordlist.type === 'edits') {
    await persistEdits(wordlist);
  } else {
    await Storage.writeWordlist(wordlist, serializeEntries(wordlist.rawEntries));
    persistMeta();
    MirrorSync.schedule(wordlist);
  }
}

async function clearEdits() {
  const edits = getEditsWordlist();
  if (!edits.rawEntries.length) return;
  if (!await showConfirm(`Clear all ${pluralize(edits.rawEntries.length, 'entry', 'entries')} from "${esc(edits.name)}"?`, { confirmText: 'Clear' })) return;
  batchUpdate(() => {
    edits.rawEntries = [];
    invalidateWordlistCaches(edits);
    compileRescoreRules(edits);
    repaintAfterCacheChange();
  });
  await persistEdits(edits);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

const _statsCache = new WeakMap();
const _mergedStatsKey = {};
let _sourceCountsCache = null;
let _mergedWordlistCache = null;
let _scopedWordlistCache = new Map();

function invalidateRescoredCache(wordlist) { wordlist._rescored = null; wordlist._rescoredMap = null; wordlist._rescoredByNorm = null; invalidateHistogramLayout(); }
function invalidateStatsCache(key) { _statsCache.delete(key); }
function invalidateSourceCounts() {
  _sourceCountsCache = null;
  _mergedWordlistCache = null;
  _scopedWordlistCache.clear();
  invalidatePreSearchCache();
  invalidateHistogramLayout();
}
function invalidateWordlistCaches(wordlist) {
  invalidateRescoredCache(wordlist);
  invalidateStatsCache(wordlist);
  invalidateSourceCounts();
  invalidateStatsCache(_mergedStatsKey);
}

// #region nodetest:histogram
function computeStatsRaw(entries) {
  // Empty state: return an all-zero shape so buildStatsBarHTML can render the
  // bar with dashes and an empty histogram.
  if (!entries.length) {
    return { count: 0, min: 0, max: 0, distinctScores: [] };
  }
  let min = Infinity, max = -Infinity;
  const freq = {};
  for (const { score } of entries) {
    if (score < min) min = score;
    if (score > max) max = score;
    freq[score] = (freq[score] || 0) + 1;
  }
  const distinctScores = Object.keys(freq).map(Number).sort((a, b) => a - b);
  return { count: entries.length, min, max, distinctScores };
}
// #endregion nodetest:histogram

function computeStats(key, entries) {
  if (_statsCache.has(key)) return _statsCache.get(key);
  const result = computeStatsRaw(entries);
  _statsCache.set(key, result);
  return result;
}

// ─── Histogram layout ─────────────────────────────────────────────────────────

// #region nodetest:histogram
const HIST_DISCRETE_THRESHOLD = 12;
const HIST_BINNED_BUCKETS = 11;
// #endregion nodetest:histogram

// Keyed, not a single slot: two distinct axes coexist — the scope-aware stats
// histogram and the scope-stable all-sources badge-color gradient. A shared
// slot would let the selected scope silently leak into the badge colors.
const _layoutCache = new Map();
function invalidateHistogramLayout() { _layoutCache.clear(); }

function* allSourcesScores() {
  for (const wl of state.sources) yield* getRescoredEntries(wl);
}

function scopedHistogramLayout() {
  const scoreSource = state.selected === MERGED_ID ? allSourcesScores() : getActiveCorpus().entries;
  return getHistogramLayout(scoreSource, 'scoped:' + syncKey(state.selected));
}

// A fixed all-sources axis, used by scoreColor's badge gradient: pointing it at
// the scoped axis would shift badge colors on every scope change, a
// regression no error would surface.
function allSourcesHistogramLayout() {
  return getHistogramLayout(allSourcesScores(), 'all');
}

// #region nodetest:histogram
function getHistogramLayout(scoreSource, cacheKey) {
  const cached = _layoutCache.get(cacheKey);
  if (cached) return cached;
  const distinct = new Set();
  let min = Infinity, max = -Infinity;
  for (const { score } of scoreSource) {
    distinct.add(score);
    if (score < min) min = score;
    if (score > max) max = score;
  }
  if (!distinct.size) {
    // No data → empty layout. Don't cache: as soon as data arrives, the next
    // call should recompute. (Caching here would also burn the cache if
    // anything calls into the layout before sources finish loading.)
    return { mode: 'empty', slots: [], min: null, max: null };
  }
  const distinctScores = [...distinct].sort((a, b) => a - b);
  let layout;
  if (distinctScores.length <= HIST_DISCRETE_THRESHOLD) {
    layout = {
      mode: 'discrete',
      slots: distinctScores.map(s => ({ score: s, lo: s, hi: s, label: String(s) })),
      min, max,
    };
  } else {
    const N = HIST_BINNED_BUCKETS;
    const bucketSize = Math.max(1, Math.ceil((max - min + 1) / N));
    const slots = [];
    for (let i = 0; i < N; i++) {
      const lo = min + i * bucketSize;
      if (lo > max) break;
      const hi = Math.min(max, lo + bucketSize - 1);
      slots.push({ lo, hi, label: lo === hi ? String(lo) : `${lo}–${hi}` });
    }
    layout = { mode: 'binned', slots, min, max };
  }
  _layoutCache.set(cacheKey, layout);
  return layout;
}
// #endregion nodetest:histogram

// #region nodetest:histogram
function bucketCounts(entries, layout) {
  const counts = layout.slots.map(() => 0);
  if (layout.mode === 'discrete') {
    const idxByScore = new Map(layout.slots.map((s, i) => [s.score, i]));
    for (const { score } of entries) {
      const idx = idxByScore.get(score);
      if (idx !== undefined) counts[idx]++;
    }
  } else if (layout.slots.length) {
    const min0 = layout.slots[0].lo;
    const bs = layout.slots[0].hi - layout.slots[0].lo + 1;
    const last = layout.slots.length - 1;
    for (const { score } of entries) {
      const idx = Math.min(last, Math.max(0, Math.floor((score - min0) / bs)));
      counts[idx]++;
    }
  }
  return counts;
}

function slotIntersectsRange(lo, hi, intervals) {
  for (const { min, max } of intervals) {
    const m = max === null ? Infinity : max;
    const n = min === null ? -Infinity : min;
    if (lo <= m && hi >= n) return true;
  }
  return false;
}
// #endregion nodetest:histogram

// ─── Score colors ─────────────────────────────────────────────────────────────

// t positions are hand-picked so that on the canonical 0–60 scale, scores
// 30/40/50/60 land directly on stops (orange/yellow/green/blue).
const SCORE_COLOR_STOPS = [
  { t: 0,   bg: '--score-0-bg', fg: '--score-0-fg' },
  { t: 1/6, bg: '--score-0-bg', fg: '--score-0-fg' },
  { t: 1/3, bg: '--score-1-bg', fg: '--score-1-fg' },
  { t: 1/2, bg: '--score-2-bg', fg: '--score-2-fg' },
  { t: 2/3, bg: '--score-3-bg', fg: '--score-3-fg' },
  { t: 5/6, bg: '--score-4-bg', fg: '--score-4-fg' },
  { t: 1,   bg: '--score-5-bg', fg: '--score-5-fg' },
];

// Out-of-range scores clamp to the nearest endpoint. With no data loaded,
// falls back to the middle stop (a gradient is meaningless without a range).
function scoreColor(score) {
  const { min, max } = allSourcesHistogramLayout();
  if (min == null || max == null || max <= min) {
    const s = SCORE_COLOR_STOPS[Math.floor(SCORE_COLOR_STOPS.length / 2)];
    return { bg: `var(${s.bg})`, fg: `var(${s.fg})` };
  }
  const t = Math.max(0, Math.min(1, (score - min) / (max - min)));
  let i = 0;
  while (i < SCORE_COLOR_STOPS.length - 1 && SCORE_COLOR_STOPS[i + 1].t < t) i++;
  const lo = SCORE_COLOR_STOPS[i];
  const hi = SCORE_COLOR_STOPS[i + 1];
  const localT = (t - lo.t) / (hi.t - lo.t);
  const pct = (localT * 100).toFixed(1);
  return {
    bg: `color-mix(in lch, var(${lo.bg}), var(${hi.bg}) ${pct}%)`,
    fg: `color-mix(in lch, var(${lo.fg}), var(${hi.fg}) ${pct}%)`,
  };
}

// ─── Search ───────────────────────────────────────────────────────────────────

// #region nodetest:search-highlight
const CONSONANTS = 'bcdfghjklmnpqrstvwxyz';
const VOWELS = 'aeiou';
function escapeRegex(s)        { return s.replace(/[.+*?^${}()|[\]\\]/g, '\\$&'); }
function escapeRegexClass(s)   { return s.replace(/[\]\\^-]/g, '\\$&'); }

// Wildcards buildSearchPattern recognizes — keep this list in sync with it.
const SEARCH_WILDCARD_RE = /[*?#@[]/;
function isLiteralQuery(query) { return query !== '' && !SEARCH_WILDCARD_RE.test(query); }

// Two arms: the regex runs against both the entry's norm (accents + separators
// stripped) and its verbatim display, matching if either does — norm forgives
// separators (`theirs` finds "the IRS"); display requires a typed space/accent.
function buildSearchPattern(query, wholeWord = false) {
  const q = query.normalize('NFC').trim();
  if (!q) return null;

  function customClass(body) {
    const expanded = body.replace(/#/g, CONSONANTS).replace(/@/g, VOWELS);
    if (expanded.startsWith('^')) return `[^${escapeRegexClass(expanded.slice(1))}]`;
    return `[${escapeRegexClass(expanded)}]`;
  }

  const tokens = [];
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    if (ch === '*')      tokens.push({ kind: 'wild', re: '.*' });
    else if (ch === '?') tokens.push({ kind: 'wild', re: '.' });
    else if (ch === '#') tokens.push({ kind: 'wild', re: `[${CONSONANTS}]` });
    else if (ch === '@') tokens.push({ kind: 'wild', re: `[${VOWELS}]` });
    else if (ch === '[') {
      const end = q.indexOf(']', i);
      if (end === -1) tokens.push({ kind: 'literal', re: '\\[' });
      else { tokens.push({ kind: 'wild', re: customClass(q.slice(i + 1, end)) }); i = end; }
    }
    else tokens.push({ kind: 'literal', re: escapeRegex(ch) });
  }

  // hlPat wraps each maximal run of literal tokens in a capture group so only
  // the fixed text highlights, never what `?`/`*` swallowed.
  let pat = '', hlPat = '', runOpen = false;
  const closeRun = () => { if (runOpen) { hlPat += ')'; runOpen = false; } };
  for (const tok of tokens) {
    pat += tok.re;
    if (tok.kind === 'literal') { if (!runOpen) { hlPat += '('; runOpen = true; } }
    else closeRun();
    hlPat += tok.re;
  }
  closeRun();

  const anchor = p => wholeWord ? '^(?:' + p + ')$' : p;
  const filterRe = new RegExp(anchor(pat),   'iu');
  const hlRe     = new RegExp(anchor(hlPat), 'giud');
  const globalRe = new RegExp(anchor(pat),   'giud');

  const tag = (ranges, coord) => ranges.map(r => ({ ...r, coord }));
  return {
    test(wlEntry) {
      if (filterRe.test(wlEntry.norm)) return true;
      const d = wlEntry.display;
      return d != null && filterRe.test(d);
    },
    // Prefer the display arm's ranges (already in display coordinates); fall back
    // to the norm arm, whose coordinates projectRangesToDisplay maps at render.
    searchRanges(wlEntry) {
      const d = wlEntry.display;
      if (d != null) {
        const dispRanges = searchRangesFor(d, hlRe);
        if (dispRanges.length) return tag(dispRanges, 'display');
      }
      return tag(searchRangesFor(wlEntry.norm, hlRe), 'norm');
    },
    globalRe,
  };
}

function searchRangesFor(text, hlRe) {
  hlRe.lastIndex = 0;
  const ranges = [];
  let m;
  while ((m = hlRe.exec(text)) !== null) {
    ranges.push(...groupSpansToRanges(m));
    if (m[0].length === 0) hlRe.lastIndex++;   // step past a zero-width match or loop forever
  }
  return ranges;
}

// Without the `d` (indices) flag on the regex, `m.indices` is absent and this
// silently yields no highlights — the caller must compile with `d`.
// Must equal the count of --hl0..N CSS vars / .search-match-N rules; a mismatch
// emits search:N kinds with no matching color.
const HL_COLORS = 9;

function groupSpansToRanges(m) {
  if (!m?.indices) return [];
  const ranges = [];
  let colorIdx = 0;
  for (let g = 1; g < m.indices.length; g++) {
    if (!m.indices[g]) continue;
    const [start, end] = m.indices[g];
    ranges.push({ start, end, kind: `search:${colorIdx % HL_COLORS}` });
    colorIdx++;
  }
  return ranges;
}

// Render a string with a set of highlight ranges. Each range is
// `{ start, end, kind }`; search hits use `search:N` (rendered as `<mark>`),
// tool-emitted highlights use one of the kinds in the registry below
// (rendered as `<span class="hl-<kind>">`). Overlapping ranges are resolved
// by skipping later ranges entirely — simple and predictable; the visual
// loss is bounded to the rare case where a tool highlight overlaps a search
// match exactly. Entry text is HTML-escaped: this output is interpolated into
// innerHTML and an entry's display can come from a wordlist imported or fetched
// from an untrusted URL, so an unescaped `<img onerror>` entry would be XSS.
function renderHighlightedText(text, ranges) {
  if (!ranges || !ranges.length) return esc(text);
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = '';
  let pos = 0;
  for (const r of sorted) {
    if (r.start < pos || r.end <= r.start) continue;
    result += esc(text.slice(pos, r.start));
    const content = esc(text.slice(r.start, r.end));
    if (r.kind.startsWith('search:')) {
      result += `<mark class="search-match search-match-${r.kind.slice(7)}">${content}</mark>`;
    } else {
      result += `<span class="hl-${r.kind}">${content}</span>`;
    }
    pos = r.end;
  }
  return result + esc(text.slice(pos));
}
// #endregion nodetest:search-highlight

// ─── Regex tool helpers ─────────────────────────────────────────────────────

// #region nodetest:regex-tool
// Splits the pattern into literal runs — maximal stretches of verbatim literal
// characters — and the wildcards between them: `.`, classes (`[…]`, `\d`…),
// quantified atoms, groups, alternation, anchors. The Regex tool colors each
// literal run; wildcard Search colors literal runs of a query the same way.
// The two notions of "literal run" must stay aligned or the tools highlight
// the same construct differently, with no error to flag the drift.
function analyzeRegexPattern(body) {
  let capturing = false;
  const runs = [];
  let runStart = -1;
  const closeRun = end => { if (runStart !== -1) { runs.push([runStart, end]); runStart = -1; } };
  const n = body.length;
  let i = 0;
  while (i < n) {
    const c = body[i];
    const baseStart = i;
    let baseEnd, isAnchor = false, isLiteral = false;
    if (c === '\\') {
      const next = body[i + 1];
      if (next === 'b' || next === 'B') isAnchor = true;
      else isLiteral = !/[dDwWsS0-9]/.test(next || '');
      baseEnd = Math.min(i + 2, n);
    } else if (c === '[') {
      let j = i + 1;
      if (body[j] === '^') j++;
      if (body[j] === ']') j++;
      while (j < n && body[j] !== ']') j += body[j] === '\\' ? 2 : 1;
      baseEnd = Math.min(j + 1, n);
    } else if (c === '(') {
      capturing = capturing || isCapturingGroup(body, i);
      baseEnd = matchingParen(body, i);
    } else if (c === '^' || c === '$') {
      isAnchor = true;
      baseEnd = i + 1;
    } else if (c === '|') {
      closeRun(i);
      i++;
      continue;
    } else if (c === '.') {
      baseEnd = i + 1;
    } else {
      isLiteral = true;
      baseEnd = i + 1;
    }
    if (isAnchor) { closeRun(i); i = baseEnd; continue; }
    let q = baseEnd, quantified = false;
    if (q < n && (body[q] === '*' || body[q] === '+' || body[q] === '?')) {
      quantified = true;
      q++;
    } else if (q < n && body[q] === '{') {
      const close = body.indexOf('}', q);
      if (close !== -1 && /^\d+(,\d*)?$/.test(body.slice(q + 1, close))) { quantified = true; q = close + 1; }
    }
    if (q < n && body[q] === '?') q++;   // a `?` past a quantifier is the lazy modifier, not a new atom
    if (isLiteral && !quantified) { if (runStart === -1) runStart = baseStart; }
    else closeRun(baseStart);
    i = q;
  }
  closeRun(n);
  return { capturing, runs };
}

function isCapturingGroup(body, i) {
  if (body[i + 1] !== '?') return true;
  if (body[i + 2] === '<') return body[i + 3] !== '=' && body[i + 3] !== '!';
  return false;
}

function matchingParen(body, i) {
  const n = body.length;
  let depth = 0, j = i;
  while (j < n) {
    const c = body[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '[') {
      j++;
      if (body[j] === '^') j++;
      if (body[j] === ']') j++;
      while (j < n && body[j] !== ']') j += body[j] === '\\' ? 2 : 1;
      j++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j + 1;
    j++;
  }
  return n;
}

function wrapRuns(body, runs) {
  let out = '', pos = 0;
  for (const [s, e] of runs) {
    out += body.slice(pos, s) + '(' + body.slice(s, e) + ')';
    pos = e;
  }
  return out + body.slice(pos);
}

// Grawlix tokenizes the replacement and applies it itself rather than calling
// String.replace, because it needs each group's offset in the built output to
// place highlights — String.replace surfaces no such offsets. `$&` is group 0.
function parseReplacement(str) {
  const tokens = [];
  let lit = '';
  const flush = () => { if (lit) { tokens.push({ lit }); lit = ''; } };
  for (let i = 0; i < str.length; i++) {
    const c = str[i], next = str[i + 1];
    if (c === '$' && next === '$') { lit += '$'; i++; }
    else if (c === '$' && next === '&') { flush(); tokens.push({ group: 0 }); i++; }
    else if (c === '$' && next >= '0' && next <= '9') {
      let digits = next;
      if (str[i + 2] >= '0' && str[i + 2] <= '9') digits += str[i + 2];
      flush();
      tokens.push({ group: parseInt(digits, 10) });
      i += digits.length;
    } else lit += c;
  }
  flush();
  return tokens;
}

// A capture group and its `$N` echoes must resolve to the same color so
// rearranged text visibly moves between the input and output atoms.
function kindForGroup(g) {
  return 'search:' + (g <= 0 ? 0 : (g - 1) % HL_COLORS);
}

function regexExecAll(re, text) {
  re.lastIndex = 0;
  const ranges = [];
  let m, hit = false;
  while ((m = re.exec(text)) !== null) {
    hit = true;
    ranges.push(...groupSpansToRanges(m));
    if (m[0].length === 0) re.lastIndex++;   // step past a zero-width match or loop forever
  }
  return { hit, ranges };
}

function runRegexReplace(entry, prepared, wordlist) {
  const { re, hlRe, tokens } = prepared;
  re.lastIndex = 0;
  let out = '', inPos = 0, m;
  const inputHighlights = [], outputHighlights = [];
  while ((m = re.exec(entry)) !== null) {
    const mStart = m.index, mEnd = mStart + m[0].length;
    const groups = m.length > 1;
    out += entry.slice(inPos, mStart);
    if (groups) {
      for (let g = 1; g < m.length; g++) {
        if (m.indices[g]) inputHighlights.push({ start: m.indices[g][0], end: m.indices[g][1], kind: kindForGroup(g) });
      }
    } else if (hlRe) {
      hlRe.lastIndex = mStart;   // lockstep with `re`: same pattern, literal runs wrapped
      inputHighlights.push(...groupSpansToRanges(hlRe.exec(entry)));
    }
    let litIdx = 0;
    for (const tok of tokens) {
      if (tok.lit !== undefined) {
        if (!groups) outputHighlights.push({ start: out.length, end: out.length + tok.lit.length, kind: `search:${litIdx++ % HL_COLORS}` });
        out += tok.lit;
        continue;
      }
      const val = tok.group === 0 ? m[0] : (m[tok.group] || '');
      if (val && groups) outputHighlights.push({ start: out.length, end: out.length + val.length, kind: kindForGroup(tok.group) });
      out += val;
    }
    inPos = mEnd;
    if (m[0].length === 0) re.lastIndex++;   // a zero-width match leaves lastIndex put; step it or loop forever
  }
  out += entry.slice(inPos);
  if (out === entry || !wordlist.byNorm.has(out)) return [];
  return [{ entry: out, inputHighlights, outputHighlights }];
}

function runSearchReplace(entry, prepared, wordlist) {
  const { matcher, replacement } = prepared;
  const re = matcher.globalRe;
  re.lastIndex = 0;
  let out = '', inPos = 0, m, colorIdx = 0;
  const inputHighlights = [], outputHighlights = [];
  while ((m = re.exec(entry)) !== null) {
    const mStart = m.index, mEnd = mStart + m[0].length;
    out += entry.slice(inPos, mStart);
    const kind = `search:${colorIdx++ % HL_COLORS}`;
    inputHighlights.push({ start: mStart, end: mEnd, kind, coord: 'display' });
    outputHighlights.push({ start: out.length, end: out.length + replacement.length, kind, coord: 'display' });
    out += replacement;
    inPos = mEnd;
    if (m[0].length === 0) re.lastIndex++;
  }
  out += entry.slice(inPos);
  const outNorm = toNorm(out);
  if (outNorm === toNorm(entry) || !wordlist.byNorm.has(outNorm)) return [];
  return [{ entry: out, inputHighlights, outputHighlights }];
}
// #endregion nodetest:regex-tool

// ─── Unigram corpus & phrase segmenter ───────────────────────────────────────

const UNIGRAM_CORPUS_URL = 'https://raw.githubusercontent.com/rspeer/wordfreq/master/wordfreq/data/large_en.msgpack.gz';
const UNIGRAM_CORPUS_IDB_KEY = 'corpus_unigrams_decoded';
const UNIGRAM_CORPUS_SIZE_KEY = 'corpus_unigrams_size';

// #region nodetest:segmenter
const SPACE_OUT_WINDOWS = { one: 2, few: 5, many: 10 };
const SPACE_OUT_PART_PENALTY = 7;
const SPACE_OUT_OOV_PER_LETTER = 1.5 * Math.LN10;
const SPACE_OUT_MORPHEME_PENALTY = 1.0;
const SPACE_OUT_SUFFIXES = ['s', 'es', 'ed', 'ied', 'ing', 'er', 'est', 'ly', 'ies'];
// #endregion nodetest:segmenter

let unigramLogFreqs = null;
let unigramMinLogFreq = -Infinity;
let unigramFetchedSize = null;
let unigramLoadPromise = null;

// #region nodetest:segmenter
function morphemeStemLogFreq(word) {
  if (!unigramLogFreqs) return -Infinity;
  let best = -Infinity;
  const tryStem = s => {
    const lf = unigramLogFreqs.get(s);
    if (lf !== undefined && lf > best) best = lf;
  };
  for (const suf of SPACE_OUT_SUFFIXES) {
    if (!word.endsWith(suf)) continue;
    const stemLen = word.length - suf.length;
    if (stemLen < 2) continue;
    const stem = word.slice(0, stemLen);
    tryStem(stem);
    if (suf === 'ed' || suf === 'ing' || suf === 'er' || suf === 'est') {
      tryStem(stem + 'e');  // raced, racing, racer, ...
    }
    if (suf === 'ies' || suf === 'ied') {
      tryStem(stem + 'y');  // tries, tried
    }
  }
  return best;
}

function unigramLogFreq(word) {
  const lf = unigramLogFreqs?.get(word);
  if (lf !== undefined) return lf;
  const stemLf = morphemeStemLogFreq(word);
  if (stemLf > -Infinity) return stemLf - SPACE_OUT_MORPHEME_PENALTY;
  return unigramMinLogFreq - word.length * SPACE_OUT_OOV_PER_LETTER;
}
// #endregion nodetest:segmenter

// #region nodetest:segmenter
function msgpackDecode(bytes) {
  const td = new TextDecoder('utf-8');
  let pos = 0;
  const u8 = () => bytes[pos++];
  const u16 = () => { const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; };
  const u32 = () => {
    const v = bytes[pos] * 0x1000000 + ((bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]);
    pos += 4;
    return v;
  };
  const str = (len) => { const s = td.decode(bytes.subarray(pos, pos + len)); pos += len; return s; };
  const arr = (n) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = readVal(); return out; };
  const map = (n) => { const out = {}; for (let i = 0; i < n; i++) { const k = readVal(); out[k] = readVal(); } return out; };
  function readVal() {
    const t = u8();
    if (t <= 0x7f) return t;
    if (t <= 0x8f) return map(t & 0x0f);
    if (t <= 0x9f) return arr(t & 0x0f);
    if (t <= 0xbf) return str(t & 0x1f);
    if (t === 0xd9) return str(u8());
    if (t === 0xda) return str(u16());
    if (t === 0xdb) return str(u32());
    if (t === 0xdc) return arr(u16());
    if (t === 0xdd) return arr(u32());
    if (t === 0xde) return map(u16());
    if (t === 0xdf) return map(u32());
    throw new Error(`msgpack: unsupported type 0x${t.toString(16)}`);
  }
  return readVal();
}
// #endregion nodetest:segmenter

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// #region nodetest:segmenter
function buildCorpusFromMsgpack(decoded) {
  const map = new Map();
  let lastNonEmpty = 1;
  for (let bucket = 1; bucket < decoded.length; bucket++) {
    const words = decoded[bucket];
    if (!words || words.length === 0) continue;
    const logFreq = -bucket * Math.LN10 / 100;
    for (const word of words) map.set(word, logFreq);
    lastNonEmpty = bucket;
  }
  return { map, minLog: -lastNonEmpty * Math.LN10 / 100 };
}
// #endregion nodetest:segmenter

async function loadUnigramCorpus() {
  if (unigramLogFreqs) return;
  if (unigramLoadPromise) return unigramLoadPromise;
  unigramLoadPromise = (async () => {
    const cached = await idbGet(UNIGRAM_CORPUS_IDB_KEY);
    if (cached && cached.map) {
      unigramLogFreqs = cached.map;
      unigramMinLogFreq = cached.minLog;
      unigramFetchedSize = lsLoad(UNIGRAM_CORPUS_SIZE_KEY);
      return;
    }
    const resp = await fetch(UNIGRAM_CORPUS_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const gz = await resp.arrayBuffer();
    unigramFetchedSize = resp.headers.get('content-length') || null;
    const decompressed = await gunzipBytes(new Uint8Array(gz));
    const { map, minLog } = buildCorpusFromMsgpack(msgpackDecode(decompressed));
    unigramLogFreqs = map;
    unigramMinLogFreq = minLog;
    await idbPut(UNIGRAM_CORPUS_IDB_KEY, { map, minLog });
    if (unigramFetchedSize) lsSave(UNIGRAM_CORPUS_SIZE_KEY, unigramFetchedSize);
  })();
  try {
    await unigramLoadPromise;
  } finally {
    if (!unigramLogFreqs) unigramLoadPromise = null;
  }
}

// #region nodetest:segmenter
function rankedSplits(entry, window, wordlist) {
  if (entry.length < 1) return [];
  const isAllowedPart = p => p.length <= 2 || wordlist.byNorm.has(p);
  const isDigit = c => c >= '0' && c <= '9';
  const splitsMidDigit = (s, i) => i < s.length && isDigit(s[i - 1]) && isDigit(s[i]);

  const bestMemo = new Map();
  bestMemo.set('', 0);
  function bestFor(s) {
    const hit = bestMemo.get(s);
    if (hit !== undefined) return hit;
    let best = -Infinity;
    for (let i = 1; i <= s.length; i++) {
      if (splitsMidDigit(s, i)) continue;
      const p = s.slice(0, i);
      if (!isAllowedPart(p)) continue;
      const score = unigramLogFreq(p) - SPACE_OUT_PART_PENALTY + bestFor(s.slice(i));
      if (score > best) best = score;
    }
    bestMemo.set(s, best);
    return best;
  }
  const overallBest = bestFor(entry);
  const threshold = overallBest - window;

  const results = [];
  const acc = [];
  function enumerate(s, accScore) {
    if (s === '') {
      if (accScore >= threshold) {
        results.push({ score: accScore, parts: acc.slice() });
      }
      return;
    }
    if (accScore + bestFor(s) < threshold) return;
    for (let i = 1; i <= s.length; i++) {
      if (splitsMidDigit(s, i)) continue;
      const p = s.slice(0, i);
      if (!isAllowedPart(p)) continue;
      acc.push(p);
      enumerate(s.slice(i), accScore + unigramLogFreq(p) - SPACE_OUT_PART_PENALTY);
      acc.pop();
    }
  }
  enumerate(entry, 0);

  results.sort((a, b) => b.score - a.score);
  return results.map(r => r.parts);
}
// #endregion nodetest:segmenter

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

const TOOL_CATEGORIES = [
  { id: 'anagram',    label: 'Anagram' },
  { id: 'bank',       label: 'Bank' },
  { id: 'halves',     label: 'Halves' },
  { id: 'letters',    label: 'Letters' },
  { id: 'pairs',      label: 'Pairs' },
  { id: 'palindrome', label: 'Palindrome' },
  { id: 'phrase',     label: 'Phrase' },
  { id: 'search',     label: 'Search' },
  { id: 'side',       label: 'Side' },
];

const FEATURED_TOOLS = ['regex', 'anagrams', 'letter_bank', 'palindromes', 'initialisms', 'behead'];

const WHOLE_WORD_PARAM = { key: 'whole-word', type: 'checkbox', label: 'Whole word', title: 'Whole word (Alt-W)' };

const TOOLS = {
  anagrams: {
    name: 'Anagrams', icon: '🔀', category: 'anagram',
    desc: 'Same letters, rearranged',
    example: 'ELVIS → LIVES',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    prepare(params) { return sortLetters(params.entry); },
    run(entry, target, wordlist) {
      if (!target) return true;
      return sortLetters(entry) === target;
    },
    group: {
      key: entry => sortLetters(entry),
      columns: [
        { label: 'Letters', value: g => g.key.length },
      ],
    },
  },
  letter_bank: {
    name: 'Letter bank', icon: '🏦', category: 'bank',
    desc: 'Uses every letter at least once',
    example: 'SPOT → STOOPS, TOPS, POSTOP',
    params: [{ placeholder: 'letters' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    isInert: params => !((params && params.letters || '').trim()),
    prepare(params) { return new Set(params.letters.trim()); },
    run(entry, alphabet, wordlist) {
      if (alphabet.size === 0) return true;
      const present = new Set();
      for (const ch of entry) {
        if (!alphabet.has(ch)) return false;
        present.add(ch);
      }
      return present.size === alphabet.size;
    },
    group: {
      key: entry => [...new Set(entry)].sort().join(''),
      columns: [
        { label: 'Letters', value: g => g.key.length },
      ],
    },
  },
  restricted_alphabet: {
    name: 'Restricted alphabet', icon: '🔡', category: 'bank',
    desc: 'Uses only the given letters',
    example: 'SPOT → STOOP, TOP, POP',
    params: [{ placeholder: 'letters' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    isInert: params => !((params && params.letters || '').trim()),
    prepare(params) { return new Set(params.letters.trim()); },
    run(entry, alphabet, wordlist) {
      for (const ch of entry) if (!alphabet.has(ch)) return false;
      return true;
    },
  },
  scrabble: {
    name: 'Scrabble', icon: '🧱', category: 'bank',
    desc: 'Can be spelled with the given tiles',
    example: 'PARENTAL → PLANE, RENT',
    params: [{ key: 'tiles', placeholder: 'tiles' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    isInert: params => !((params && params.tiles || '').trim()),
    prepare(params) {
      const bank = new Map();
      for (const ch of params.tiles.trim()) bank.set(ch, (bank.get(ch) || 0) + 1);
      return bank;
    },
    run(entry, bank, wordlist) {
      const used = new Map();
      for (const ch of entry) {
        const n = (used.get(ch) || 0) + 1;
        if (n > (bank.get(ch) || 0)) return false;
        used.set(ch, n);
      }
      return true;
    },
  },
  repeaters: {
    name: 'Repeaters', icon: '🔂', category: 'halves',
    desc: 'Left and right halves are the same',
    example: 'TARTAR · HOTSHOTS',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      const n = entry.length;
      if (n < 2 || n % 2 !== 0) return false;
      const half = n / 2;
      return entry.slice(0, half) === entry.slice(half);
    },
  },
  neckouts: {
    name: 'Neckouts', icon: '🦒', category: 'halves',
    desc: 'Left and right halves are anagrams',
    example: 'STUCKONESNECKOUT',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      const n = entry.length;
      if (n < 2 || n % 2 !== 0) return false;
      const half = n / 2;
      const left = entry.slice(0, half);
      const right = entry.slice(half);
      if (left === right) return false;
      return sortLetters(left) === sortLetters(right);
    },
  },
  isograms: {
    name: 'Isograms', icon: '1️⃣', category: 'letters',
    desc: 'No repeated letter',
    example: 'CYBERPUNK · JUXTAPOSE',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      const seen = new Set();
      for (const ch of entry) {
        if (ch < 'a' || ch > 'z') continue;
        if (seen.has(ch)) return false;
        seen.add(ch);
      }
      return true;
    },
  },
  supervocalics: {
    name: 'Supervocalics', icon: '🌈', category: 'letters',
    desc: 'Each of A E I O U exactly once',
    example: 'AIRQUOTE · EUPHORIA',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      let a = 0, e = 0, i = 0, o = 0, u = 0;
      for (const ch of entry) {
        if (ch === 'a') a++;
        else if (ch === 'e') e++;
        else if (ch === 'i') i++;
        else if (ch === 'o') o++;
        else if (ch === 'u') u++;
      }
      return a === 1 && e === 1 && i === 1 && o === 1 && u === 1;
    },
  },
  monovocalics: {
    name: 'Monovocalics', icon: '👩‍🎤', category: 'letters',
    desc: 'Only one distinct vowel',
    example: 'TOOCOOLFORSCHOOL',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      let vowel = '';
      let prevWasLetter = false;
      for (const ch of entry) {
        if (ch < 'a' || ch > 'z') { prevWasLetter = false; continue; }
        let v = '';
        if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u') v = ch;
        else if (ch === 'y' && prevWasLetter) v = 'y';
        if (v) {
          if (!vowel) vowel = v;
          else if (v !== vowel) return false;
        }
        prevWasLetter = true;
      }
      return !!vowel;
    },
  },
  alphabetical: {
    name: 'Alphabetical', icon: '📈', category: 'letters',
    desc: 'Letters in alphabetical order',
    example: 'CHINTZ · KNOTTY',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      let prev = null;
      for (const ch of entry) {
        if (ch < 'a' || ch > 'z') continue;
        if (prev && ch < prev) return false;
        prev = ch;
      }
      return true;
    },
  },
  reverse_alphabetical: {
    name: 'Reverse alphabetical', icon: '📉', category: 'letters',
    desc: 'Letters in reverse alphabetical order',
    example: 'SPOOFED · YUPPIE',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) {
      let prev = null;
      for (const ch of entry) {
        if (ch < 'a' || ch > 'z') continue;
        if (prev && ch > prev) return false;
        prev = ch;
      }
      return true;
    },
  },
  consonantcy: {
    name: 'Consonantcy', icon: '🦴', category: 'letters',
    desc: 'Same consonants in order; vowels may differ',
    example: 'ISAIDNO → SODONE',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    prepare(params) { return consonantSkeleton(params.entry); },
    run(entry, skeleton, wordlist) {
      if (!skeleton) return true;
      return consonantSkeleton(entry) === skeleton;
    },
    group: {
      key: entry => consonantSkeleton(entry),
      columns: [
        { label: 'Consonants', value: g => g.key.length },
      ],
    },
  },
  vowelcy: {
    name: 'Vowelcy', icon: '🅰️', category: 'letters',
    desc: 'Same vowels in order; consonants may differ',
    example: 'OUTHOUSE → OUTOFUSE',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    prepare(params) { return vowelSkeleton(params.entry); },
    run(entry, skeleton, wordlist) {
      if (!skeleton) return true;
      return vowelSkeleton(entry) === skeleton;
    },
    group: {
      key: entry => vowelSkeleton(entry),
      columns: [
        { label: 'Vowels', value: g => g.key.length },
      ],
    },
  },
  kangaroos: {
    name: 'Kangaroos', icon: '🦘', category: 'pairs',
    desc: 'Words containing the input spread out',
    example: 'KANGA → MILKANDSUGAR',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: true, outputHighlights: false,
    isInert: params => !((params && params.entry || '').trim()),
    prepare(params) { return params.entry.trim(); },
    run(entry, joey, wordlist) {
      if (!joey) return true;
      if (entry.length <= joey.length) return false;
      const ranges = [];
      let i = 0;
      for (let j = 0; j < entry.length && i < joey.length; j++) {
        if (entry[j] === joey[i]) {
          ranges.push({ start: j, end: j + 1, kind: 'search:0' });
          i++;
        }
      }
      return i === joey.length ? ranges : false;
    },
  },
  joeys: {
    name: 'Joeys', icon: '🍼', category: 'pairs',
    desc: 'Words contained in the input spread out',
    example: 'MAJORKEY → JOEY',
    params: [{ placeholder: 'entry' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    isInert: params => !((params && params.entry || '').trim()),
    prepare(params) { return params.entry.trim(); },
    run(entry, kangaroo, wordlist) {
      if (!kangaroo) return true;
      if (entry.length >= kangaroo.length) return false;
      let i = 0;
      for (let j = 0; j < kangaroo.length && i < entry.length; j++) {
        if (kangaroo[j] === entry[i]) i++;
      }
      return i === entry.length;
    },
  },
  palindromes: {
    name: 'Palindromes', icon: '🪞', category: 'palindrome',
    desc: 'Read the same forwards and back',
    example: 'RACECAR · KAYAK',
    params: [],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    run(entry) { return entry === reverseString(entry); },
  },
  semordnilap: {
    name: 'Semordnilap', icon: '⬅️', category: 'palindrome',
    desc: 'Reverse to get a different word',
    example: 'STRESSED → DESSERTS',
    params: [],
    kind: 'transform', inputHighlights: false, outputHighlights: false,
    glyph: () => '→',
    run(entry, params, wordlist) {
      // Bidirectional emit — a row whenever the reverse is also an entry, in
      // both directions. The post-executor `unify` pass collapses
      // the matched mirror pair into one row with a ↔ glyph; a downstream
      // transform breaks the symmetry and the two directions stay separate.
      // Palindromes are skipped — reversing them yields the same word.
      const reversed = reverseString(entry);
      if (reversed === entry) return [];
      if (!wordlist.byNorm.has(reversed)) return [];
      return [{ entry: reversed }];
    },
  },
  space_out: {
    name: 'Space out', icon: '🌌', category: 'phrase',
    desc: 'Guess at where spaces go in multi-word entries',
    example: 'SPACEOUT → SPACE OUT',
    params: [
      { key: 'splits', label: 'Splits', type: 'range', default: 'few',
        choices: [
          { value: 'one',  label: 'One'  },
          { value: 'few',  label: 'Few'  },
          { value: 'many', label: 'Many' },
        ] },
    ],
    kind: 'transform', inputHighlights: false, outputHighlights: false,
    glyph: () => '→',
    async prepare(params) {
      await loadUnigramCorpus();
      const choice = params.splits || 'few';
      return { window: SPACE_OUT_WINDOWS[choice] ?? SPACE_OUT_WINDOWS.few, onlyTop: choice === 'one' };
    },
    run(entry, prepared, wordlist) {
      if (!unigramLogFreqs) return [];
      const existing = wordlist.byNorm.get(entry);
      if (existing && displayOf(existing).includes(' ')) return [{ entry }];
      const splits = rankedSplits(entry, prepared.window, wordlist);
      if (splits.length === 0) return [];
      const inputScore = existing?.score ?? 0;
      const picks = prepared.onlyTop ? splits.slice(0, 1) : splits;
      return picks.map(parts => {
        const joined = parts.join(' ');
        if (joined === entry) return { entry };
        const hit = wordlist.byNorm.get(toNorm(joined));
        const hitIsJoined = hit && (hit.display || '').toLowerCase() === joined;
        return { entry: hitIsJoined ? hit.norm : [joined, inputScore] };
      });
    },
  },
  search: {
    name: 'Search', icon: '<svg width="16" height="16" aria-hidden="true"><use href="#icon-search"/></svg>', category: 'search',
    desc: 'Search (and replace) with wildcards',
    example: 'UN*ED · C?T',
    findReplace: true,
    params: [
      { placeholder: 'pattern', help: buildHelpHTML([
        ['*', 'any string'],
        ['?', 'any character'],
        ['#', 'any consonant'],
        ['@', 'any vowel'],
        ['[abc]', 'any of a, b, c'],
        ['[^abc]', 'none of a, b, c'],
        ['[a-m]', 'letter range'],
      ]) },
      { key: 'replace', placeholder: 'replace', raw: true },
      WHOLE_WORD_PARAM,
    ],
    kind: params => (params.replace ? 'transform' : 'filter'),
    inputHighlights: true, outputHighlights: true,
    glyph: params => (params.replace ? '→' : null),
    // An empty query is a no-op: the row is transparent — no filtering, no
    // lens — so an empty permanent search bar costs nothing.
    isInert: params => !((params && params.pattern || '').trim()),
    matchOn: 'both',
    prepare(params) {
      const matcher = buildSearchPattern((params.pattern || '').trim(), !!params['whole-word']);
      if (!matcher) return null;
      const replacement = params.replace || '';
      return replacement ? { mode: 'replace', matcher, replacement } : { mode: 'filter', matcher };
    },
    run(wlEntry, prepared, wordlist) {
      if (!prepared) return true;
      if (prepared.mode === 'replace') return runSearchReplace(displayOf(wlEntry), prepared, wordlist);
      const { matcher } = prepared;
      if (!matcher.test(wlEntry)) return null;
      const ranges = matcher.searchRanges(wlEntry);
      return ranges.length ? ranges : true;
    },
  },
  regex: {
    name: 'Regex', icon: '🪄', category: 'search',
    desc: 'Search (and replace) with regular expressions',
    example: 'UN.+ED · C.{2,4}T',
    findReplace: true,
    params: [
      { key: 'pattern', raw: true, placeholder: 'pattern', help: buildHelpHTML([
        ['.*', 'any string'],
        ['.', 'any character'],
        ['[abc]', 'any of a, b, c'],
        ['[^abc]', 'none of a, b, c'],
        ['a*', 'zero or more'],
        ['a+', 'one or more'],
        ['a?', 'optional'],
        ['a{2,4}', '2 to 4 times'],
        ['a|b', 'either a or b'],
        ['(…)', 'capture group'],
      ], { link: { url: 'https://regexone.com/', text: 'Learn regex at regexone.com →' } }) },
      { key: 'replace', placeholder: 'replace', raw: true, help: buildHelpHTML([
        ['$1', 'first capture group'],
        ['$2', 'second group, etc.'],
        ['$&', 'the whole match'],
        ['$$', 'a literal $'],
      ], { cols: 1, link: { url: 'https://regexone.com/', text: 'Learn regex at regexone.com →' } }) },
      WHOLE_WORD_PARAM,
    ],
    // Blank replacement reads as filter mode, not "delete the match" — a blank
    // field is indistinguishable from one that was never touched.
    kind: params => (params.replace ? 'transform' : 'filter'),
    inputHighlights: true, outputHighlights: true,
    glyph: params => (params.replace ? '→' : null),
    // A half-typed, invalid pattern is inert like an empty one, so the view
    // neither blanks nor churns mid-keystroke.
    isInert(params) {
      const pattern = (params && params.pattern || '').trim();
      if (!pattern) return true;
      try { new RegExp(pattern); return false; } catch { return true; }
    },
    matchOn: 'both',
    prepare(params) {
      const replacement = params.replace || '';
      const body = params.pattern.trim();
      // Flags `gid`: `i` lets a raw (un-lowercased, so `\D \S \B` survive)
      // pattern match case-insensitively; `d` exposes match indices for
      // highlighting. The pattern runs against both norm and display (see run),
      // so `\s`, `-`, or an accent can match the punctuation display carries but
      // norm strips. The whole-word wrap is non-capturing so `$N` backrefs keep
      // their group numbers.
      const wrap = src => params['whole-word'] ? '^(?:' + src + ')$' : src;
      const { capturing, runs } = analyzeRegexPattern(body);
      if (replacement) {
        // The functional `re` can't be wrapped for highlighting — synthetic
        // groups would renumber the user's `$N`; `hlRe` is the wrapped copy.
        const hlRe = capturing ? null : new RegExp(wrap(wrapRuns(body, runs)), 'gid');
        return { mode: 'replace', re: new RegExp(wrap(body), 'gid'), hlRe, tokens: parseReplacement(replacement) };
      }
      return { mode: 'filter', re: new RegExp(wrap(capturing ? body : wrapRuns(body, runs)), 'gid') };
    },
    run(wlEntry, prepared, wordlist) {
      if (prepared.mode === 'filter') {
        const { re } = prepared;
        const normRes = regexExecAll(re, wlEntry.norm);
        const d = wlEntry.display;
        const dispRes = d != null ? regexExecAll(re, d) : null;
        if (!normRes.hit && !dispRes?.hit) return null;
        if (dispRes?.ranges.length) return dispRes.ranges.map(r => ({ ...r, coord: 'display' }));
        if (normRes.ranges.length) return normRes.ranges.map(r => ({ ...r, coord: 'norm' }));
        return true;
      }
      return runRegexReplace(wlEntry.norm, prepared, wordlist);
    },
  },
  initialisms: {
    name: 'Initialisms', icon: '🔠', category: 'phrase',
    desc: 'Starting letters spell a word',
    example: 'HOT → Helen of Troy',
    params: [{ placeholder: 'word' }],
    kind: 'filter', inputHighlights: false, outputHighlights: false,
    matchOn: 'display',
    isInert: params => !((params && params['word'] || '').trim()),
    prepare(params) { return (params['word'] || '').trim().toLowerCase(); },
    run(displayText, target, wordlist) {
      if (!target) return true;
      for (const split of wordSplits(displayText)) {
        if (split.length !== target.length) continue;
        let ok = true;
        for (let i = 0; i < split.length; i++) {
          if (split[i][0].toLowerCase() !== target[i]) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    },
    group: {
      key: displayText => {
        const words = displayText.split(/[ ]+/).filter(Boolean);
        if (words.length < 2) return null;
        let initialism = '';
        for (const w of words) initialism += w[0].toLowerCase();
        return initialism;
      },
      anchor: (key, wordlist) => wordlist.byNorm.get(key) || null,
      anchorLabel: 'Initialism',
    },
  },
  behead: {
    name: 'Behead', icon: '🪓', category: 'side',
    desc: 'Remove the first N letters',
    example: 'SLING → LING',
    params: [{ label: 'Count', default: '1', type: 'number' }],
    kind: 'transform', inputHighlights: true, outputHighlights: false,
    glyph: () => '→',
    run(entry, params, wordlist) {
      const count = Math.max(1, parseInt(params.count, 10) || 1);
      if (entry.length <= count) return [];
      const beheaded = entry.slice(count);
      if (!wordlist.byNorm.has(beheaded)) return [];
      return [{ entry: beheaded, inputHighlights: [{ kind: 'removed', start: 0, end: count }] }];
    },
  },
  curtail: {
    name: 'Curtail', icon: '✂️', category: 'side',
    desc: 'Remove the last N letters',
    example: 'PARTY → PART',
    params: [{ label: 'Count', default: '1', type: 'number' }],
    kind: 'transform', inputHighlights: true, outputHighlights: false,
    glyph: () => '→',
    run(entry, params, wordlist) {
      const count = Math.max(1, parseInt(params.count, 10) || 1);
      if (entry.length <= count) return [];
      // Skip plural → singular.
      if (entry.endsWith('s') && !entry.endsWith('ss')) return [];
      const curtailed = entry.slice(0, -count);
      if (!wordlist.byNorm.has(curtailed)) return [];
      return [{ entry: curtailed, inputHighlights: [{ kind: 'removed', start: entry.length - count, end: entry.length }] }];
    },
  },
};

// A param's `key` defaults to a slug of its label (or placeholder); declare
// `key` explicitly only when the internal name should differ from that text.
for (const tool of Object.values(TOOLS)) {
  for (const p of tool.params) {
    if (!p.key) p.key = (p.label || p.placeholder || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
}

for (const col of Object.values(TOOLS).flatMap(t => t.group?.columns || [])) {
  if (!col.key) col.key = col.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function mountGroupColumnStyle() {
  const keys = new Set();
  for (const tool of Object.values(TOOLS)) {
    for (const col of tool.group?.columns || []) keys.add(col.key);
  }
  if (!keys.size) return;
  const style = document.createElement('style');
  style.textContent = [...keys].map(k =>
    `.group-col[data-col="${k}"] { min-width: var(--group-col-${k}-w, 2ch); }`
  ).join('\n');
  document.head.appendChild(style);
}

// Keyed `toolKey/paramKey` to match the `data-help` attribute that input
// builders emit — attachHelpPopups joins the two. Keep the formats in sync.
const PARAM_HELP = {};
for (const [toolKey, tool] of Object.entries(TOOLS)) {
  for (const p of tool.params) {
    if (p.help) PARAM_HELP[`${toolKey}/${p.key}`] = p.help;
  }
}

function reverseString(s) {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += s[i];
  return out;
}

// #region nodetest:tool-utils
// Sort the letters of an already-canonical string. Tools that need letter-bank
// equivalence call this on `entry` (and on user-supplied params, which the
// runtime normalizes the same way before passing in). Non-letters survive and
// participate in the comparison — for letter-only wordlists they're a no-op,
// for the rare punctuation-bearing entry they make the match stricter.
function sortLetters(s) {
  if (!s) return '';
  return s.split('').sort().join('');
}

const consonantSkeleton = s => (s || '').replace(/[^bcdfghjklmnpqrstvwxyz]/g, '');
const vowelSkeleton     = s => (s || '').replace(/[^aeiou]/g, '');

function wordSplits(display) {
  const stripped = display.split(/[ ]+/).filter(Boolean);
  const splits = [stripped];
  if (stripped.some(w => w.includes('-'))) {
    splits.push(stripped.flatMap(w => w.split(/-+/).filter(Boolean)));
  }
  return splits;
}

// Normalize tool param strings: lowercase only. Same rule as wlEntry.norm —
// the executor runs this on every param before handing to `run`, so tools see
// canonical-lowercase input on both sides without per-call ceremony. A param
// flagged `raw` in the schema opts out — a regex pattern would have its `\D`
// classes and group names corrupted by lowercasing.
function normalizeParams(params, schema) {
  const raw = new Set((schema || []).filter(p => p.raw).map(p => p.key));
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    out[k] = (typeof v === 'string' && !raw.has(k)) ? v.toLowerCase() : v;
  }
  return out;
}
// #endregion nodetest:tool-utils

function makeToolRow(tool, params = {}, grouped = false) {
  const def = TOOLS[tool];
  if (!grouped) {
    for (const p of def.params) {
      if (p.default !== undefined && params[p.key] === undefined) params[p.key] = p.default;
    }
  }
  const row = {
    tool, params, def, grouped,
    kind() {
      if (row.grouped) return 'group';
      return typeof def.kind === 'function' ? def.kind(row.params) : def.kind;
    },
    isInert() {
      if (row.grouped) return false;
      return def.isInert ? def.isInert(row.params) : false;
    },
    glyph() {
      return def.glyph ? def.glyph(row.params) : null;
    },
  };
  return row;
}

// #region nodetest:pipeline-shape
// The chain shape is derivable from the catalog records alone — no per-row
// runtime inspection. Simulate the executor's emit-then-unify on the active
// tools (run-having, not inert): the originator is one atom; each highlighting
// tool emits a same-word atom that the unifier folds into the tail unless the
// tail is itself a highlight slot, in which case it stays its own atom; each
// transform emits a new-word output atom that never folds. This keys off the
// tools' static highlight flags, exactly as `collapseRepeatAtoms` keys off the
// atoms' slot-ness, so the two always agree. `atomCount` is the resulting
// count — the row's height in `ROW_HEIGHT` units, read by the renderer and the
// scroller's stride math.
function currentAtomCount(stack) {
  let count = 1;          // originator
  let tailSlot = false;   // is the tail atom a highlight slot?
  for (const row of stack) {
    if (row.isInert()) continue;   // transparent rows
    if (row.kind() === 'transform') {
      if (row.def.inputHighlights && tailSlot) count++;   // input mark can't fold into a slot tail
      count++;                                            // output atom (new word)
      tailSlot = !!row.def.outputHighlights;
    } else if (row.def.inputHighlights) {                 // highlighting filter (search)
      if (tailSlot) count++;
      tailSlot = true;
    }
  }
  return count;
}
// #endregion nodetest:pipeline-shape

// #region nodetest:pipeline-shape
// True when no active transform sits in the stack — every row is then a single
// merged-wordlist entry (plus same-word highlight atoms), so the count is per
// entry and the sort axes stay in their single-atom tier. Drives the stats-bar
// count label (Entries vs Results) and the sort tier.
function isFilterOnlyChain(stack) {
  return !stack.some(row => row.kind() === 'transform' && !row.isInert());
}

function isGroupChain(stack) {
  return stack.some(row => row.kind() === 'group' && !row.isInert());
}

// Gates the `unify` skip: a transform or a highlighting filter is what makes
// `unify` do real work. With neither active, every row is a lone atom and
// `unify` would only copy them, so the executor returns its rows as-is.
function chainProducesMultiAtom(stack) {
  return stack.some(row => {
    if (row.isInert()) return false;
    return row.kind() === 'transform' || !!row.def.inputHighlights;
  });
}
// #endregion nodetest:pipeline-shape

// `ctx.input` — chain tail entries as strings, resolved lazily so a tool that
// ignores it pays nothing and the O(N)-per-stage materialization stays avoided.
function makeWorkingSetView(rows) {
  return {
    get length() { return rows.length; },
    at(i) { return rowLastEntry(rows[i]).norm; },
    *[Symbol.iterator]() { for (const row of rows) yield rowLastEntry(row).norm; },
  };
}

async function buildInitialChains(mergedWordlist, y) {
  if (mergedWordlist._initialChains) return mergedWordlist._initialChains;
  const { entries } = mergedWordlist;
  const chains = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    chains[i] = { atoms: [{ wlEntry: entries[i], highlights: null, glyph: null }] };
    if (y.due()) await y.yield();
  }
  mergedWordlist._initialChains = chains;
  return chains;
}

// The `prepare` context — see docs/design.md § Pipeline execution.
// Rebuilt per stage so `ctx.input` reflects that stage's input rows.
function makeCtx(mergedWordlist, rows, signal, y) {
  return {
    wordlist: mergedWordlist,
    input: makeWorkingSetView(rows),
    throwIfAborted: () => throwIfAborted(signal),
    due: y.due,
    yield: y.yield,
    async forEach(iterable, fn) {
      let i = 0;
      for (const item of iterable) {
        fn(item, i++);
        if (y.due()) await y.yield();
      }
    },
    async times(n, fn) {
      for (let i = 0; i < n; i++) {
        fn(i);
        if (y.due()) await y.yield();
      }
    },
  };
}

// Run the tool stack against the merged wordlist, returning
// `{ rows, atomCount }`. Each row is a ChainRow — `{ atoms: Atom[] }` — where
// an Atom is `{ wlEntry, highlights, glyph }`, where `highlights` is a flat
// list of ranges — or `null` when the atom is not a highlight slot (the
// originator, a plain transform output). Seeded one-atom-per-merged-entry;
// each transform branches a row into one new row per output (appending an
// output atom, plus a same-word input-mark atom when it highlights its input),
// each highlighting filter appends a same-word atom carrying its match. Tools
// emit unconditionally — `unify` folds the redundant same-word atoms
// afterward. Inert tools are transparent. The executor owns the
// per-row loop, cooperative yielding, and abort: `signal` aborts a superseded
// run at the next yield.
class ToolStageError extends Error {
  constructor(cause, stackRow) {
    super(cause?.message || String(cause));
    this.cause = cause;
    this.stackRow = stackRow;
  }
}

let _preSearchCache = null;
function invalidatePreSearchCache() { _preSearchCache = null; }

function clonePreSearchState(state) {
  return {
    groups: state.groups.map(g => ({ ...g })),
    grouped: state.grouped,
  };
}

async function executePipeline(mergedWordlist, stack, signal) {
  const y = makeYielder(signal);
  for (const stackRow of stack) stackRow._error = null;

  const userStack = stack.slice(0, -1);
  const searchRow = stack[stack.length - 1];

  let state;
  if (_preSearchCache) {
    state = clonePreSearchState(_preSearchCache);
  } else {
    state = {
      groups: [{ key: undefined, chains: await buildInitialChains(mergedWordlist, y) }],
      grouped: false,
    };
    for (const stackRow of userStack) {
      await runStackRow(stackRow, state, mergedWordlist, signal, y);
    }
    _preSearchCache = clonePreSearchState(state);
  }

  await runStackRow(searchRow, state, mergedWordlist, signal, y);

  const { groups, grouped } = state;
  const multiAtom = chainProducesMultiAtom(stack);
  const result = [];
  for (const g of groups) {
    if (grouped && g.chains.length === 0) { if (y.due()) await y.yield(); continue; }
    if (multiAtom) g.chains = await unify(g.chains, y);
    if (grouped) cacheGroupStats(g);
    result.push(g);
    if (y.due()) await y.yield();
  }

  return {
    rows: grouped ? result : (result[0]?.chains ?? []),
    atomCount: currentAtomCount(stack),
    grouped,
  };
}

async function runStackRow(stackRow, state, mergedWordlist, signal, y) {
  if (stackRow.isInert()) return;
  const { def } = stackRow;
  throwIfAborted(signal);

  try {
    if (stackRow.kind() === 'group') {
      const ctx = makeCtx(mergedWordlist, state.groups[0].chains, signal, y);
      state.groups = await bucketize(state.groups[0].chains, def, ctx);
      state.grouped = true;
      return;
    }

    const params = normalizeParams(stackRow.params, def.params);
    const prepareInput = state.grouped
      ? state.groups.flatMap(g => g.chains)
      : state.groups[0].chains;
    const prepared = def.prepare
      ? await def.prepare(params, makeCtx(mergedWordlist, prepareInput, signal, y))
      : params;
    for (const g of state.groups) {
      g.chains = await runToolStage(g.chains, stackRow, prepared, mergedWordlist, y);
      if (y.due()) await y.yield();
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    stackRow._error = e?.message || String(e);
    console.error(`Tool "${stackRow.tool}" failed:`, e);
    throw new ToolStageError(e, stackRow);
  }
}

function tagCoord(ranges, coord) {
  if (!ranges?.length) return ranges;
  return ranges.map(r => r.coord ? r : { ...r, coord });
}

async function runToolStage(rows, stackRow, prepared, mergedWordlist, y) {
  const { def } = stackRow;
  const kind = stackRow.kind();
  const glyph = stackRow.glyph();
  const matchOn = def.matchOn || 'norm';
  const coord = matchOn === 'display' ? 'display' : 'norm';
  const next = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tail = row.atoms[row.atoms.length - 1];
    const inputText = matchOn === 'both' ? tail.wlEntry
      : matchOn === 'display' ? displayOf(tail.wlEntry)
      : tail.wlEntry.norm;
    const result = def.run(inputText, prepared, mergedWordlist);
    if (kind === 'filter') {
      if (result) {
        if (def.inputHighlights) {
          const highlights = Array.isArray(result) ? tagCoord(result, coord) : [];
          next.push({ atoms: [...row.atoms,
            { wlEntry: tail.wlEntry, highlights, glyph }] });
        } else {
          next.push(row);
        }
      }
    } else {
      for (const out of (result || [])) {
        const atoms = row.atoms.slice();
        if (def.inputHighlights) {
          atoms.push({ wlEntry: tail.wlEntry, highlights: tagCoord(out.inputHighlights || [], coord), glyph: null });
        }
        const synthetic = Array.isArray(out.entry);
        const text = synthetic ? out.entry[0] : out.entry;
        const lookup = synthetic ? null : mergedWordlist.byNorm.get(toNorm(text));
        const wlEntry = lookup || synthWlEntry(text, synthetic ? out.entry[1] : 0);
        atoms.push({
          wlEntry,
          highlights: def.outputHighlights ? tagCoord(out.outputHighlights || [], coord) : null,
          glyph,
        });
        next.push({ atoms });
      }
    }
    if (y.due()) await y.yield();
  }
  return next;
}

// #region nodetest:pipeline-shape
async function bucketize(chains, def, ctx) {
  const useDisplay = def.matchOn === 'display';
  const buckets = new Map();
  await ctx.forEach(chains, chain => {
    const tail = rowLastEntry(chain);
    const input = useDisplay ? displayOf(tail) : tail.norm;
    const key = def.group.key(input);
    if (!key) return;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = []);
    bucket.push(chain);
  });
  const anchorFn = def.group.anchor;
  const groups = [];
  for (const [key, groupChains] of buckets) {
    if (groupChains.length < 2) continue;
    const anchor = anchorFn ? anchorFn(key, ctx.wordlist) : null;
    if (anchorFn && !anchor) continue;
    groupChains.sort((a, b) => {
      const ae = rowLastEntry(a), be = rowLastEntry(b);
      return be.score - ae.score || ae.norm.localeCompare(be.norm);
    });
    groups.push({ key, chains: groupChains, anchor });
  }
  return groups;
}

function cacheGroupStats(g) {
  let min = Infinity, max = -Infinity;
  for (const chain of g.chains) {
    for (const atom of chain.atoms) {
      const s = atom.wlEntry.score;
      if (s < min) min = s;
      if (s > max) max = s;
    }
  }
  g._minScore = min;
  g._maxScore = max;
  g._count = g.chains.length;
}

// Post-executor unification — two collapses that turn the executor's
// emit-everything output into the displayed chain rows.
//
// Within a row, `collapseRepeatAtoms` folds adjacent atoms for the same word:
// the originator and a search's same-word atom become one, while two searches'
// atoms stay distinct — the rule is "fold unless both carry highlights."
//
// Across rows, a transform like semordnilap emits both directed halves of a
// pair (STRESSED→DESSERTS and DESSERTS→STRESSED). Exact reverses — same
// entries mirrored, same scores — collapse to one row, its relation glyphs
// promoted to ↔. A downstream transform breaks the symmetry, so those rows
// fail the mirror test and stay separate with their directed → glyphs. The
// survivor is whichever direction's entry chain sorts lexicographically
// smaller — picked explicitly, so it's deterministic regardless of emit order
// — and it keeps its own highlights; the dropped direction's are not carried
// over.
async function unify(rows, y) {
  const seen = new Map();   // entry-chain key → { row, index } of its slot in `out`
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = { atoms: collapseRepeatAtoms(rows[i].atoms) };
    const entries = row.atoms.map(a => a.wlEntry.norm);
    const fwd = entries.join('\0');
    const rev = [...entries].reverse().join('\0');
    let folded = false;
    if (fwd !== rev) {
      const mirror = seen.get(rev);
      if (mirror) {
        const mScores = mirror.row.atoms.map(a => a.wlEntry.score);
        const rScores = row.atoms.map(a => a.wlEntry.score).reverse();
        if (mScores.every((s, j) => s === rScores[j])) {
          const survivor = fwd < rev ? row : mirror.row;
          survivor.atoms = survivor.atoms.map(a => a.glyph ? { ...a, glyph: '↔' } : a);
          out[mirror.index] = survivor;
          folded = true;
        }
      }
    }
    if (!folded) {
      seen.set(fwd, { row, index: out.length });
      out.push(row);
    }
    if (y.due()) await y.yield();
  }
  return out;
}

// Fold adjacent same-word atoms in a row into one. An atom is a *highlight
// slot* when its `highlights` is an array (a search's atom, a transform's
// input/output mark) and not a slot when `highlights` is `null` (the
// originator, a plain transform output). Two slot atoms for the same word stay
// distinct — that's how three searches render as three lines; any other
// same-word pair folds. Keying on slot-ness, not on whether the array is
// non-empty, keeps the row's atom count matched to `currentAtomCount` even
// when a tool highlights only conditionally (a wildcard-only search matches
// without producing ranges, yet still holds its slot).
function collapseRepeatAtoms(atoms) {
  const out = [atoms[0]];
  for (let i = 1; i < atoms.length; i++) {
    const prev = out[out.length - 1];
    const cur = atoms[i];
    if (prev.wlEntry.norm === cur.wlEntry.norm &&
        !(prev.highlights !== null && cur.highlights !== null) &&
        !cur.glyph) {
      // Survivor keeps `prev`'s glyph (a repeat atom has none) and takes the
      // highlight slot when one side is one.
      if (cur.highlights !== null) out[out.length - 1] = { ...prev, highlights: cur.highlights };
    } else {
      out.push(cur);
    }
  }
  return out;
}

// Flatten the chain rows to their atoms' wlEntries, row order. Feeds the stats
// aggregates / histogram — a chain row contributes each distinct word's score.
// Atoms that merely repeat the previous atom's word (a multi-search row stacks
// the same word under several highlights) are skipped so one entry isn't
// counted once per highlight.
function flattenAtoms(rows) {
  const out = [];
  const pushChain = chain => {
    let prev = null;
    for (const atom of chain.atoms) {
      if (atom.wlEntry.norm === prev) continue;
      out.push(atom.wlEntry);
      prev = atom.wlEntry.norm;
    }
  };
  for (const row of rows) {
    if (row.chains) {
      for (const chain of row.chains) pushChain(chain);
    } else pushChain(row);
  }
  return out;
}

function bottomLineAtoms(rows) {
  const out = [];
  for (const row of rows) {
    if (row.chains) {
      for (const chain of row.chains) out.push(chain.atoms[chain.atoms.length - 1].wlEntry);
    } else {
      out.push(row.atoms[row.atoms.length - 1].wlEntry);
    }
  }
  return out;
}

function applyScoreRangeToRows(rows, intervals, grouped) {
  if (!intervals) return rows;
  const chainOk = chain => chain.atoms.every(a => matchesRange(a.wlEntry.score, intervals));
  if (grouped) {
    const out = [];
    for (const g of rows) {
      if (g.anchor && !matchesRange(g.anchor.score, intervals)) continue;
      const chains = g.chains.filter(chainOk);
      if (chains.length < 2) continue;
      const ng = { ...g, chains };
      cacheGroupStats(ng);
      out.push(ng);
    }
    return out;
  }
  return rows.filter(chainOk);
}
// #endregion nodetest:pipeline-shape

function* rowSetAtoms(rows) {
  for (const row of rows) {
    if (row.chains) {
      for (const chain of row.chains) yield* chain.atoms;
    } else yield* row.atoms;
  }
}

// ─── Pipeline runtime ─────────────────────────────────────────────────────────
// The runtime wraps `executePipeline` with supersession (a new run aborts the
// in-flight one) and a slow-pipeline indicator that dims the results table
// when the whole run exceeds ~100ms.

// Yield budget — when an in-helper loop has consumed this much CPU since its
// last yield, it gives the browser a turn. ~6ms is roughly half a 60Hz frame,
// leaving the other half for input handling and paint. Iteration-count chunking
// blows up at small body sizes: 1K iterations of ~1μs work yields every ~1ms,
// burning hundreds of ms of pure yield overhead on a 500K filter. Time-based
// chunking keeps yield count proportional to wall-clock cost.
const YIELD_INTERVAL_MS = 6;
// scheduler.yield is the modern primitive (Chrome 129+); the setTimeout fallback
// is universal and lands the browser back on the macrotask queue, which is what
// we want — input events and paints get a turn before the tool resumes.
const _yieldImpl = (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function')
  ? () => scheduler.yield()
  : () => new Promise(r => setTimeout(r, 0));

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

// Cooperative-yield gate, one per run. `due()` is a cheap synchronous check;
// when true the caller `await`s `yield()`. `due()` can't read the clock every
// iteration, so it samples once per `stride` calls and retunes `stride` to keep
// those samples ~YIELD_CLOCK_TARGET_MS apart whatever the per-iteration cost.
const YIELD_CLOCK_TARGET_MS = 1;
const YIELD_STRIDE_MAX = 1 << 16;
function makeYielder(signal) {
  let stride = 1, sinceCheck = 0;
  let lastClock = performance.now(), lastYield = lastClock;
  return {
    due() {
      if (++sinceCheck < stride) return false;
      const now = performance.now();
      const elapsed = now - lastClock;
      if (elapsed > 0) stride = Math.max(1, Math.min(YIELD_STRIDE_MAX, Math.round(stride * YIELD_CLOCK_TARGET_MS / elapsed)));
      lastClock = now;
      sinceCheck = 0;
      return now - lastYield >= YIELD_INTERVAL_MS;
    },
    async yield() {
      await _yieldImpl();
      throwIfAborted(signal);
      lastYield = lastClock = performance.now();
    },
  };
}

// Single-flight controller — every runPipeline call aborts the previous one's
// signal before starting its own run. In-flight tools observe the abort at
// their next `ctx.yield()` (or at the executor's per-row check, for sync tools)
// and bail out; the aborted run's resolved value is discarded by its caller.
let _pipelineController = null;
let _pipelineRunning = 0;
const _pipelineIdleWaiters = [];

// Resolves the next time no pipeline run is in flight. Used by the test bridge
// to await async runs triggered by keystroke / setStack before reading the DOM.
function pipelineIdle() {
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
async function runPipeline(mergedWordlist, stack) {
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

const ToolStack = (() => {
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
  function buildHTML() {
    const rows = stack.map((row, idx) => buildRowHTML(idx, row)).join('');
    return `<div id="tool-stack">${rows}</div>`;
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
    attachHelpPopups();
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
    invalidatePreSearchCache();
    refreshMergedScroller();
    Router.navigate();
  }

  function removeAt(idx) {
    // The permanent Search bar (last row) is undeletable.
    if (idx < 0 || idx >= stack.length - 1) return;
    stack.splice(idx, 1);
    rerenderRows();
    refreshGalleryActive();
    invalidatePreSearchCache();
    refreshMergedScroller();
    Router.navigate();
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
    invalidatePreSearchCache();
    refreshMergedScroller();
    Router.navigate();
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
    invalidatePreSearchCache();
    refreshMergedScroller();
    Router.navigate();
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
        ErrorPopover.toggle(errBtn, msg);
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
        refreshMergedScroller();
        Router.navigate();
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
        refreshMergedScroller();
        Router.navigate();
      }
    });

    makeReorderable(p, {
      handleSelector: '.drag-handle:not([aria-hidden])',
      itemSelector:   '.tool-row',
      onReorder: (fromEl, beforeEl) => {
        const rows = rowEls();
        const fromIdx = rows.indexOf(fromEl);
        let toIdx = beforeEl ? rows.indexOf(beforeEl) : rows.length;
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

const ToolPicker = (() => {
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
// #region nodetest:pipeline-shape
const rowLastEntry  = r => r.atoms[r.atoms.length - 1].wlEntry;
// #endregion nodetest:pipeline-shape
// #region nodetest:scroller-sort
const rowMinScore   = r => Math.min(...r.atoms.map(a => a.wlEntry.score));
const rowMaxScore   = r => Math.max(...r.atoms.map(a => a.wlEntry.score));
// #endregion nodetest:scroller-sort
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
const DEFAULT_SORT_BY_TIER = { single: 'entry', multi: 'entry', group: 'entry' };
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
function chainSortTier(stack) {
  if (isGroupChain(stack)) return 'group';
  return isFilterOnlyChain(stack) ? 'single' : 'multi';
}
function activeGroupRow(stack) {
  return stack.find(r => r.kind() === 'group' && !r.isInert());
}
function activeGroupColumns(stack) {
  return activeGroupRow(stack)?.def.group?.columns || [];
}
function activeGroupAnchorLabel(stack) {
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
function sortAxes(tier, stack = ToolStack.getStack()) {
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
function isValidSortAxis(key) {
  if (key in SORT_AXES.single || key in SORT_AXES.multi
      || key in SORT_AXES.group) return true;
  for (const tool of Object.values(TOOLS)) {
    for (const col of tool.group?.columns || []) {
      if (col.key === key) return true;
    }
  }
  return false;
}

// #region nodetest:scroller-sort
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
function columnSortAxes(colKind, tierAxes) {
  return (COLUMN_AXIS_CANDIDATES[colKind] || []).filter(k => k in tierAxes);
}
function nextSortForColumn(ownedAxes, curKey, curDir) {
  if (ownedAxes.includes(curKey)) return { key: curKey, dir: curDir === 'asc' ? 'desc' : 'asc' };
  return { key: ownedAxes[0], dir: 'asc' };
}
// #endregion nodetest:scroller-sort

// Run synchronously on stack mutation and URL load: the sort tier follows
// the stack, and settling it lazily in the async render let the URL builder
// read a stale axis. A real cross-tier counterpart (Score ⇄ Min score) keeps
// the user's direction; a fallback to the tier default resets it too.
function reconcileSort(stack) {
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

// #region nodetest:scroller-sort
// Compare two items along an axis, falling through tiebreakers when the
// primary projection is equal. Primary direction is the user's pick;
// tiebreakers keep their declared direction regardless.
function compareItems(a, b, axis, primaryDir) {
  const primCmp = compareValues(axis.primary(a), axis.primary(b)) * (primaryDir === 'asc' ? 1 : -1);
  if (primCmp !== 0) return primCmp;
  for (const tb of axis.tiebreakers) {
    const cmp = compareValues(tb.project(a), tb.project(b)) * (tb.dir === 'asc' ? 1 : -1);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function compareValues(a, b) {
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
// #endregion nodetest:scroller-sort
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

const ErrorPopover = (() => {
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

const GroupMorePopover = (() => {
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

class EntriesScroller extends BaseVirtualScroller {
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
        wlEntry = this.entries[parseInt(row.dataset.idx, 10)]
                  ?.atoms[parseInt(atomEl.dataset.atom, 10)]?.wlEntry;
      }
      if (!wlEntry) return;
      const field = target.classList.contains('atom-score') ? 'score'
                  : target.classList.contains('atom-comment') ? 'comment'
                  : null;
      AtomPopover.open(wlEntry, row, this, target, field);
    });

    this._buildToolbar();
  }

  // atomCount / sortTier default to the current values so callers that only
  // update the rows (e.g. display-case re-render) don't need to know the
  // pipeline shape. Search is a pipeline tool now; the scroller only filters
  // by score range.
  setEntries(allEntries, atomCount = this.atomCount, sortTier = this.sortTier) {
    GroupMorePopover.close();
    this._setChainShape(atomCount, sortTier);
    this.allEntries = allEntries;
    this._invalidateSortCache();
    this._buildToolbar();
    this._sortAndRender();
  }

  updateEntries(allEntries, atomCount = this.atomCount, sortTier = this.sortTier) {
    const tierChanged = this._setChainShape(atomCount, sortTier);
    this.allEntries = allEntries;
    this._invalidateSortCache();
    if (tierChanged) { this._buildToolbar(); rebuildEntryHeaders(); }
    this._sortAndRender();
    AtomPopover.rebindEntry(this);
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
    this._sortAndRender();
    Router.navigate();
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

    const filtered = applyScoreRangeToRows(this.allEntries, this._scoreIntervals, this.sortTier === 'group');

    let sorted;
    const axis = sortAxes(this.sortTier)[this.sortKey];
    if (!axis) {
      sorted = filtered;
    } else {
      if (this.sortTier === 'group') this._sortGroupChains();
      const dir = this.sortDir;
      sorted = [...filtered].sort((a, b) => compareItems(a, b, axis, dir));
    }

    this._sortedSource = sorted;
    this._sortedSourceKey = this.sortKey;
    this._sortedSourceDir = this.sortDir;
    this._sortedSourceRange = this.scoreRange;
    return sorted;
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

  _statsViewEntries() {
    return bottomLineAtoms(this.entries);
  }

  _histogramEntries() {
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
    const n = this.entries.length;
    const stride = this._rowStride();
    this.sizer.style.height = this._sizerHeightFor(n * stride) + 'px';
    this._renderEmptyState(n, 'chain');

    const { start, end } = this._visibleRange(n);
    this._clearSizer();

    const tierFor = makeTierLookup();
    const activeNorm = AtomPopover.activeNorm(this);
    let nextActiveRow = null;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const row = this._renderChainRow(this.entries[i], i, tierFor, activeNorm);
      row.style.top = (i * stride) + 'px';
      if (row.classList.contains('active')) nextActiveRow = row;
      frag.appendChild(row);
    }
    this.sizer.appendChild(frag);
    if (nextActiveRow) AtomPopover.rebindRow(nextActiveRow);
  }

  _renderChainRow(chainRow, i, tierFor, activeNorm) {
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
      const scoreInner = buildScoreCellHTML(wlEntry);
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
    const key = `${kind}|${addable ? query.toLowerCase() : ''}`;
    if (existing && existing.dataset.key === key) return;

    const el = existing || document.createElement('div');
    el.className = 'entries-empty';
    el.dataset.key = key;

    if (kind === 'group') {
      el.textContent = 'No groups match.';
    } else if (addable) {
      el.innerHTML =
        `<div class="entries-empty-msg">${buildNoMatchQuipHTML(query)}</div>` +
        `<button type="button" class="entries-empty-add">＋ Add it</button>`;
      el.querySelector('.entries-empty-add').onclick = e =>
        AtomPopover.openForCreate(query, entriesScroller, e.currentTarget);
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
}

// ─── Atom popover ─────────────────────────────────────────────────────────────

const AtomPopover = (() => {
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
    let stillPresent = false;
    for (const a of rowSetAtoms(activeScroller.allEntries)) {
      if (a.wlEntry === activeWlEntry) { stillPresent = true; break; }
    }
    if (!stillPresent) return;
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
    let found = null, normFallback = null;
    for (const a of rowSetAtoms(scroller.allEntries)) {
      if (a.wlEntry.norm !== targetNorm) continue;
      if (a.wlEntry.display === targetDisplay) { found = a.wlEntry; break; }
      if (!normFallback) normFallback = a.wlEntry;
    }
    found ??= normFallback;
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

// ─── Update Summary Scroller ──────────────────────────────────────────────────

class UpdateSummaryScroller {
  constructor(container) {
    this.container = container;
    this.rows = [];

    this.sizer = document.createElement('div');
    this.sizer.className = 'usd-sizer';
    container.appendChild(this.sizer);

    container.addEventListener('scroll', () => this._render(), { passive: true });
    new ResizeObserver(() => this._render()).observe(container);
  }

  setRows(rows) {
    this.rows = rows;
    this.sizer.style.height = (rows.length * ROW_HEIGHT) + 'px';
    this.container.scrollTop = 0;
    this._render();
  }

  scrollToIndex(i) {
    this.container.scrollTop = i * ROW_HEIGHT;
  }

  _render() {
    const n = this.rows.length;
    const scrollTop = this.container.scrollTop;
    const viewH = this.container.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VS_BUFFER);
    const end   = Math.min(n, Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + VS_BUFFER);

    this.sizer.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
      const row = this.rows[i];
      const div = document.createElement('div');
      div.className = 'usd-row';
      div.style.top = (i * ROW_HEIGHT) + 'px';

      if (row.type === 'header') {
        div.classList.add('usd-section-header');
        div.textContent = row.label;
      } else {
        div.classList.add('usd-entry-row', 'usd-' + row.kind);

        const entrySpan = document.createElement('span');
        entrySpan.className = 'usd-entry-col';
        entrySpan.textContent = row.display;
        div.appendChild(entrySpan);

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'usd-score-col';
        if (row.kind === 'rescored') {
          scoreSpan.innerHTML =
            `<span class="usd-old-score">${row.oldScore}</span>` +
            `<span class="usd-arrow">→</span>` +
            buildScoreBadgeHTML(row.score);
        } else {
          scoreSpan.innerHTML = buildScoreBadgeHTML(row.score);
        }
        div.appendChild(scoreSpan);
      }

      frag.appendChild(div);
    }

    this.sizer.appendChild(frag);
  }
}

// ─── Rescoring ────────────────────────────────────────────────────────────────

// #region nodetest:rescoring
function parseRange(str) {
  str = (str || '').trim();
  if (!str) return null;
  const mPlus  = str.match(/^(\d+)\+$/);        if (mPlus)  return [{ min: +mPlus[1],  max: null }];
  const mRange = str.match(/^(\d+)[-–](\d+)$/); if (mRange) return [{ min: +mRange[1], max: +mRange[2] }];
  const mExact = str.match(/^(\d+)$/);          if (mExact) return [{ min: +mExact[1], max: +mExact[1] }];
  return null;
}

function matchesRange(value, intervals) {
  for (const { min, max } of intervals) {
    if ((min === null || value >= min) && (max === null || value <= max)) return true;
  }
  return false;
}

function rangeSpan(str) {
  if (!str || !str.trim()) return Infinity;
  const intervals = parseRange(str);
  if (!intervals) return Infinity;
  let total = 0;
  for (const { min, max } of intervals) {
    if (max === null) return Infinity;
    total += max - min;
  }
  return total;
}

function scoresToRangeStr(scores) {
  if (!scores.length) return '';
  const sorted = [...scores].sort((a, b) => a - b);
  const min = sorted[0], max = sorted[sorted.length - 1];
  return min === max ? `${min}` : `${min}-${max}`;
}

function getRuleMaxScore(rule) {
  const intervals = parseRange(rule.input);
  if (!intervals) return -1;
  let max = -Infinity;
  for (const { max: imax } of intervals) {
    const m = imax === null ? Infinity : imax;
    if (m > max) max = m;
  }
  return max;
}

function outputSortKey(rule) {
  const s = parseRuleOutput(rule.output);
  if (typeof s === 'number') return s;
  if (s && typeof s === 'object') return s.max === null ? s.min : (s.min + s.max) / 2;
  return getRuleMaxScore(rule); // 'unchanged' sorts by input score
}

// Equality for rule arrays. Drives the dirty flag and the boot-time silent
// propagation of dev-shipped default updates.
function rescoreRulesEqual(a, b) {
  const au = [...(a || [])].sort(compareRescoreRulesForPriority);
  const bu = [...(b || [])].sort(compareRescoreRulesForPriority);
  if (au.length !== bu.length) return false;
  return au.every((r, i) => {
    const o = bu[i];
    return r.input === o.input
      && (r.length || '') === (o.length || '')
      && (r.output || '') === (o.output || '')
      && (r.note   || '') === (o.note   || '');
  });
}

function scoringRulesEqual(a, b) {
  const au = a || [];
  const bu = b || [];
  if (au.length !== bu.length) return false;
  return au.every((r, i) => {
    const o = bu[i];
    return r.input === o.input && (r.note || '') === (o.note || '');
  });
}
// #endregion nodetest:rescoring

// The My Edits legend: an inert mirror of All Wordlists' tier scale, one blank-output row
// per tier. Sourced from the live tiers (state.scoring), not frozen
// DEFAULT_SCORING — otherwise customizing All Wordlists' tiers would silently desync the
// legend My Edits shows. Outputs stay blank (scoring rows carry none), so
// propagateDefaults can push it onto a non-dirty My Edits without re-grading.
function editsLegend() {
  return state.scoring.map(({ input, note }) => ({ input, length: '', output: '', note }));
}

function getWordlistDefaultRules(wordlist) {
  if (wordlist.type === 'edits') return editsLegend();
  const publisher = getPublisher(wordlist);
  return publisher?.defaultRules ?? null;
}

// Recompute the dirty flag after a rule mutation. Custom wordlists (no
// defaults) keep `dirty` undefined and don't participate in propagation.
function updateWordlistDirty(wordlist) {
  const defaults = getWordlistDefaultRules(wordlist);
  if (defaults === null) return;
  wordlist.dirty = !rescoreRulesEqual(wordlist.rescoreRules, defaults);
}

function updateScoringDirty() {
  state.scoringDirty = !scoringRulesEqual(state.scoring, DEFAULT_SCORING);
}

function propagateDefaults() {
  if (!scoringRulesEqual(state.scoring, DEFAULT_SCORING) && !state.scoringDirty) {
    state.scoring = DEFAULT_SCORING.map(r => ({ ...r }));
    persistScoring();
  }
  let metaTouched = false;
  for (const wordlist of state.sources) {
    const defaults = getWordlistDefaultRules(wordlist);
    if (defaults === null) continue;
    if (!rescoreRulesEqual(wordlist.rescoreRules, defaults) && !wordlist.dirty) {
      wordlist.rescoreRules = defaults.map(r => ({ ...r }));
      compileRescoreRules(wordlist);
      invalidateWordlistCaches(wordlist);
      metaTouched = true;
    }
  }
  if (metaTouched) {
    persistMeta();
    repaintAfterCacheChange();
  }
}

// On fetch/import of a custom wordlist (no publisherId) with empty rescore
// rules and ≤10 distinct scores, seed one inert row per distinct score —
// blank output, so scores pass through unchanged. Lays the source's scale
// out as concrete rows next to All Wordlists' tier scale; the user can fill in
// output mappings if they want to translate into the unified scale.
// See docs/design.md § Rescore rules.
const AUTO_SEED_SCORE_LIMIT = 10;

function makeRescoreRuleStub(input = '') { return { input, length: '', output: '', note: '' }; }
function makeScoringRowStub(input = '') { return { input, note: '' }; }

function maybeAutoSeedRescoreRules(wordlist) {
  if (wordlist.publisherId) return;
  if (wordlist.rescoreRules?.length) return;
  const scores = [...new Set(wordlist.rawEntries.map(e => e.score))];
  if (!scores.length || scores.length > AUTO_SEED_SCORE_LIMIT) return;
  scores.sort((a, b) => a - b);
  wordlist.rescoreRules = scores.map(s => makeRescoreRuleStub(String(s)));
}

// A pristine tier legend mislabels a foreign-scaled import, so a misaligned
// import discards it and auto-seeds the actual scale instead.
function reconcileEditsRulesAfterImport(edits) {
  if (edits.dirty) return;
  const tierIntervals = editsLegend().map(r => parseRange(r.input)).filter(Boolean);
  const aligned = edits.rawEntries.every(e => tierIntervals.some(iv => matchesRange(e.score, iv)));
  if (aligned) return;
  edits.rescoreRules = [];
  maybeAutoSeedRescoreRules(edits);
  updateWordlistDirty(edits);
}

// #region nodetest:rescoring
// First-match-wins: narrower rules must precede broader supersets or never fire.
function compareRescoreRulesForPriority(a, b) {
  const am = getRuleMaxScore(a), bm = getRuleMaxScore(b);
  if (am !== bm) return bm - am;
  const ais = rangeSpan(a.input), bis = rangeSpan(b.input);
  if (ais !== bis) return ais - bis;
  const aLF = !!(a.length && a.length.trim()), bLF = !!(b.length && b.length.trim());
  if (aLF !== bLF) return aLF ? -1 : 1;
  if (aLF) {
    const als = rangeSpan(a.length), bls = rangeSpan(b.length);
    if (als !== bls) return als - bls;
  }
  return outputSortKey(b) - outputSortKey(a);
}

function compileRescoreRules(wordlist) {
  const rules = wordlist.rescoreRules;
  rules.sort(compareRescoreRulesForPriority);
  rules.forEach(compileRule);
}

function parseRuleOutput(str) {
  str = (str || '').trim().toLowerCase();
  if (!str) return 'unchanged';
  const mRange = str.match(/^(\d+)[-–](\d+)$/);
  if (mRange) return { min: +mRange[1], max: +mRange[2] };
  const mPlus  = str.match(/^(\d+)\+$/);
  if (mPlus)  return { min: +mPlus[1], max: null };
  const mExact = str.match(/^(\d+)$/);
  return mExact ? +mExact[1] : null;
}

function compileRule(rule) {
  rule._scoreIntervals = parseRange(rule.input);
  rule._lenIntervals   = (rule.length && rule.length.trim()) ? parseRange(rule.length) : null;
  rule._output         = parseRuleOutput(rule.output);
}

function applyRescoring(entries, rules) {
  return entries.map(e => {
    const score = rescoreEntry(e, rules);
    return score !== e.score ? { ...e, score, rawScore: e.score } : e;
  });
}
// #endregion nodetest:rescoring

function getRescoredEntries(wordlist) {
  return wordlist._rescored ??= applyRescoring(wordlist.rawEntries, wordlist.rescoreRules);
}

function getRescoredMap(wordlist) {
  if (wordlist._rescoredMap) return wordlist._rescoredMap;
  const map = new Map();
  for (const e of getRescoredEntries(wordlist)) map.set(e.norm, e);
  wordlist._rescoredMap = map;
  return map;
}

// norm → all rescored entries for that norm. Distinct from `getRescoredMap`,
// which keeps one entry per norm: a faithful single-norm merged rebuild must
// see every display variant a wordlist holds, not just the last.
function getRescoredByNorm(wordlist) {
  if (wordlist._rescoredByNorm) return wordlist._rescoredByNorm;
  const map = new Map();
  for (const e of getRescoredEntries(wordlist)) {
    let arr = map.get(e.norm);
    if (!arr) map.set(e.norm, arr = []);
    arr.push(e);
  }
  return wordlist._rescoredByNorm = map;
}

// #region nodetest:rescoring
function rescoreEntry(wlEntry, rules) {
  for (const rule of rules) {
    const scoreIntervals = rule._scoreIntervals !== undefined ? rule._scoreIntervals : parseRange(rule.input);
    if (!scoreIntervals || !matchesRange(wlEntry.score, scoreIntervals)) continue;
    if (rule.length && rule.length.trim()) {
      const lenIntervals = rule._lenIntervals !== undefined ? rule._lenIntervals : parseRange(rule.length);
      if (!lenIntervals || !matchesRange(wlEntry.norm.length, lenIntervals)) continue;
    }
    const s = rule._output !== undefined ? rule._output : parseRuleOutput(rule.output);
    if (s === null) continue;
    if (s === 'unchanged') return wlEntry.score;
    if (s && typeof s === 'object') {
      const iv = scoreIntervals[0];
      if (iv.max === null && s.max === null) {
        // Both N+: shift by the difference
        return wlEntry.score + (s.min - iv.min);
      }
      // Bounded range: linearly scale; skip if shapes don't match or input is degenerate
      if (iv.min === null || iv.max === null || s.max === null || iv.min === iv.max) continue;
      const t = (wlEntry.score - iv.min) / (iv.max - iv.min);
      return Math.round(s.min + t * (s.max - s.min));
    }
    return s; // first matching rule wins
  }
  return wlEntry.score;
}
// #endregion nodetest:rescoring

// ─── Rescoring / Scoring section ─────────────────────────────────────────────

function renderRescoreSection() {
  WordlistSelector.refreshEditor();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

let entriesScroller = null;

// The render dispatcher is two effects:
//   - render effect — reads `cacheVersion$`, dispatches the panel render
//     (full render on first run, in-place scroller update on subsequent
//     cache bumps). The panel always shows the merged view, so there's no
//     selection to dispatch on.
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
let _cosmeticEffectFirstRun = true;

let _signalFirstPaint;
const _firstPaint = new Promise(r => { _signalFirstPaint = r; });

function setupRenderEffect() {
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
    refreshDerivedDisplays();     // scoring legend + main-panel stats bar
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

function renderAll() {
  if (!_renderEffectActive) setupRenderEffect();
  else bumpCacheVersion();
}

function wordlistCardMeta(wordlist, contribMap) {
  const total = wordlist.rawEntries.length;
  if (!total) return 'No data';
  if (!wordlist.enabled) return pluralize(total, 'entry', 'entries');
  const used = contribMap.get(wordlist) ?? 0;
  return used === total
    ? `${pluralize(used, 'entry', 'entries')} used`
    : `${used.toLocaleString()} of ${pluralize(total, 'entry', 'entries')} used`;
}

// Reads `_sourceCountsCache` for "X used" meta — populated lazily here when
// missing, so cosmetic-effect callers don't crash if a cache-affecting helper
// invalidated the merged cache earlier in the same drain. The render effect's
// cache branch has already rebuilt by the time it calls renderSources, so the
// lazy path is only hit when no cache rebuild is in flight.
function renderSources() {
  if (!_sourceCountsCache) _sourceCountsCache = buildMergedWordlist().sourceCounts;
}


// Pure cache rebuild — invalidate merged/override/stats caches and re-warm
// `_sourceCountsCache` so the next renderSources sees fresh meta. Does no
// rendering itself; the render effect's cache branch calls this and then
// `renderSources` to paint with the rebuilt counts.
function refreshSourceCounts() {
  invalidateSourceCounts();
  invalidateStatsCache(_mergedStatsKey);
  _sourceCountsCache = buildMergedWordlist().sourceCounts;
}

function createScroller() {
  AtomPopover.close();
  GroupMorePopover.close();
  entriesScroller?.destroy();
  entriesScroller = new EntriesScroller(document.getElementById('vs-host'));
  return entriesScroller;
}

async function refreshMergedScroller() {
  reconcileSort(ToolStack.getStack());
  if (!entriesScroller) return;
  const result = await runPipeline(getActiveCorpus(), ToolStack.getStack());
  if (result.aborted || !entriesScroller) return;
  entriesScroller.updateEntries(result.rows, result.atomCount, chainSortTier(ToolStack.getStack()));
  ToolStack.refreshErrorMarks();
}

// The pre-search and histogram caches assume one corpus, so a scope change
// must drop both before the pipeline re-runs — otherwise the prior scope's
// memoized seed rows leak into the new view with no error.
async function setScope(target) {
  if (state.selected === target) return;
  state.selected = target;
  lsSave('selectedScope', scopeKey(target));
  invalidatePreSearchCache();
  invalidateHistogramLayout();
  WordlistSelector.refresh();
  DiscoveryBanner.refresh();
  await renderMergedDetail();
}

function mountPanel(panel) {
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
  _stickyObserver.disconnect();
  _stickyObserver.observe(stickyStack);
  const wordlistBar = document.getElementById('wordlist-bar');
  if (wordlistBar) _stickyObserver.observe(wordlistBar);
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
function buildStatsBarHTML() {
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

  const rangeHTML = buildScoreRangeInputHTML('score-range-input', AppView.scoreRange, 'AppView');
  const sortSlotHTML = `<span class="stats-bar-sort" id="stats-bar-sort"></span>`;
  const exportHTML = buildExportMenuHTML();
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

function refreshStatsBarFromScroller() {
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

function publishBarHeights() {
  const stack = document.getElementById('tool-stack');
  if (stack) document.documentElement.style.setProperty('--tool-stack-h', stack.offsetHeight + 'px');
  const stats = document.getElementById('stats');
  if (stats) document.documentElement.style.setProperty('--stats-bar-h', stats.offsetHeight + 'px');
  const stickyStack = document.querySelector('#app .sticky-stack');
  if (stickyStack) document.documentElement.style.setProperty('--sticky-stack-h', stickyStack.offsetHeight + 'px');
  const bar = document.getElementById('wordlist-bar');
  if (bar) document.documentElement.style.setProperty('--wordlist-bar-h', bar.offsetHeight + 'px');
}
const _stickyObserver = new ResizeObserver(publishBarHeights);

function refreshStatsBarOverflow() {
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
function mountStatsBarOverflowObservers() {
  const parent = document.getElementById('detail-panel');
  if (!parent) return;
  new ResizeObserver(refreshStatsBarOverflow).observe(parent);
  new MutationObserver(refreshStatsBarOverflow).observe(parent, { childList: true, subtree: true });
}

function mountHeaderHeightObserver() {
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
function attachHelpPopups() {
  _helpPopups.forEach(p => p.destroy());
  _helpPopups = [];
  for (const input of document.querySelectorAll('[data-help]')) {
    const content = PARAM_HELP[input.dataset.help];
    if (!content) continue;
    const placement = input.closest('.tool-row-replace') ? 'below' : 'above';
    _helpPopups.push(new PopupHelp(input, content, { placement }));
  }
}

async function renderMergedDetail() {
  try {
    const panel = document.getElementById('detail-panel');
    reconcileSort(ToolStack.getStack());
    mountPanel(panel);
    const showSource = state.selected === MERGED_ID;
    entriesScroller.showSource = showSource;
    panel.classList.toggle('no-source-col', !showSource);
    entriesScroller.editsWordlist = getEditsWordlist() ?? null;
    entriesScroller.showEditDeleteCol = true;
    entriesScroller._onDeleteRow = entry => deleteFromEdits(entry, refreshMergedScroller);
    attachExternalEditHandlers(entriesScroller, refreshMergedScroller);

    const result = await runPipeline(getActiveCorpus(), ToolStack.getStack());
    if (result.aborted) return;
    const { rows, atomCount } = result;
    entriesScroller.setEntries(rows, atomCount, chainSortTier(ToolStack.getStack()));
    ToolStack.refreshErrorMarks();
  } finally {
    // In `finally` so a thrown/aborted pipeline still dismisses the splash
    // screen — otherwise a broken tool in the boot URL strands the user on
    // a forever-spinning overlay with no error in sight.
    _signalFirstPaint();
  }
}

// ─── Scoring (tier labels) ────────────────────────────────────────────────────

// Returns a `score → tier label` function. First matching rule wins; an
// empty note collapses to '' so callers can skip the tooltip entirely.
function makeTierLookup() {
  const rules = state.scoring
    .map(r => ({ note: r.note || '', intervals: parseRange(r.input) }))
    .filter(r => r.intervals);
  return score => {
    for (const r of rules) if (matchesRange(score, r.intervals)) return r.note;
    return '';
  };
}

// Sort tier labels into canonical priority order (highest max score first) so
// makeTierLookup's first-match-wins resolves overlapping ranges consistently.
function sortScoringRules() {
  state.scoring.sort((a, b) => getRuleMaxScore(b) - getRuleMaxScore(a));
}

// Tier-label changes don't touch data, so a cheap re-render of the visible
// rows (they carry the label as a `title=`) is enough — no full rebuild.
function renderScoringRules() {
  sortScoringRules();
  WordlistSelector.refreshEditor();
  entriesScroller?._render?.();
}

function deleteScoringRow(i) {
  const [deleted] = state.scoring.splice(i, 1);
  applyScoringChange();
  showUndoToast('Deleted scoring row', () => {
    state.scoring.push(deleted);
    applyScoringChange();
  });
}

function saveScoringField(i, field, val) {
  if (!state.scoring[i]) return;
  state.scoring[i][field] = val;
  applyScoringChange();
}

function addScoringRow() {
  state.scoring.push(makeScoringRowStub());
  applyScoringChange();
  const inp = [...document.querySelectorAll(`${activeRescoreContainerSelector('scoring')} .rule-row .rule-in`)].find(i => !i.value);
  inp?.focus();
}

function applyScoringChange() {
  updateScoringDirty();
  persistScoring();
  propagateDefaults();
  renderScoringRules();
}

async function resetScoringRules() {
  if (!await showConfirm('Replace your tier labels with the defaults? Your customizations will be lost.', { confirmText: 'Reset' })) return;
  state.scoring = DEFAULT_SCORING.map(r => ({ ...r }));
  applyScoringChange();
}


// ─── Actions ──────────────────────────────────────────────────────────────────

function attachExternalEditHandlers(s, refreshFn) {
  s._onSave = (originalWlEntry, newValues) => {
    saveEdit(originalWlEntry, newValues);
    refreshFn?.();
  };
}

function saveEdit(originalWlEntry, { raw, score, comment }) {
  const edits = getEditsWordlist();
  const newNorm = toNorm(raw);
  const newDisplay = raw;
  const origNorm = originalWlEntry.norm;
  const origDisplay = originalWlEntry.display ?? origNorm;
  const origScore = originalWlEntry.score;
  const origComment = originalWlEntry.comment ?? '';

  if (origNorm === newNorm && origDisplay === newDisplay
      && origScore === score && origComment === comment) {
    return;
  }

  const entryChanged = newNorm !== origNorm || newDisplay !== origDisplay;
  const norms = entryChanged && origNorm ? [origNorm, newNorm] : [newNorm];

  applyEditsChange(edits, norms, () => {
    if (entryChanged && origNorm) {
      const idx = edits.rawEntries.findIndex(e => e.norm === origNorm && displayOf(e) === origDisplay);
      if (idx >= 0) edits.rawEntries.splice(idx, 1);
    }
    const existing = edits.rawEntries.find(e => e.norm === newNorm && displayOf(e) === newDisplay);
    if (existing) {
      existing.score = score;
      existing.comment = comment;
    } else {
      edits.rawEntries.push({ norm: newNorm, display: newDisplay, score, comment });
    }
  });
  persistEdits(edits);
}

// ─── Histogram pointer interaction ───────────────────────────────────────────

let _histDrag = null;

function rangeStrFromBounds(lo, hi, layout) {
  if (lo === hi) return String(lo);
  const max = layout.slots.length ? layout.slots[layout.slots.length - 1].hi : null;
  if (max != null && hi >= max) return `${lo}+`;
  return `${lo}-${hi}`;
}

function _slotAt(histEl, clientX) {
  const cols = histEl.querySelectorAll('.histogram-col');
  if (!cols.length) return null;
  const x = clientX - histEl.getBoundingClientRect().left;
  const first = cols[0];
  const stride = cols.length >= 2 ? (cols[1].offsetLeft - first.offsetLeft) : (first.offsetWidth + 3);
  if (x < first.offsetLeft) return null;
  let idx = Math.floor((x - first.offsetLeft) / stride);
  if (idx >= cols.length) idx = cols.length - 1;
  const bar = cols[idx].querySelector('.histogram-bar');
  return { idx, lo: +bar.dataset.lo, hi: +bar.dataset.hi };
}

function onHistogramPointerDown(event) {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  const hist = event.currentTarget;
  const slot = _slotAt(hist, event.clientX);
  if (!slot) return;
  event.preventDefault();
  hist.setPointerCapture?.(event.pointerId);
  _histDrag = {
    pointerId: event.pointerId,
    histEl: hist,
    startLo: slot.lo, startHi: slot.hi,
    curLo: slot.lo, curHi: slot.hi,
    moved: false,
  };
  // No rect update here — wait for first pointermove so a click-to-clear doesn't flash a one-bar preview.
}

function _onHistogramPointerMove(event) {
  if (!_histDrag || event.pointerId !== _histDrag.pointerId) return;
  const slot = _slotAt(_histDrag.histEl, event.clientX);
  if (!slot) return;
  if (slot.lo === _histDrag.curLo && slot.hi === _histDrag.curHi) return;
  _histDrag.curLo = slot.lo;
  _histDrag.curHi = slot.hi;
  if (slot.lo !== _histDrag.startLo || slot.hi !== _histDrag.startHi) _histDrag.moved = true;
  const rangeLo = Math.min(_histDrag.startLo, slot.lo);
  const rangeHi = Math.max(_histDrag.startHi, slot.hi);
  positionHistogramRect(_histDrag.histEl, [{ min: rangeLo, max: rangeHi }]);
}

function _onHistogramPointerUp(event) {
  if (!_histDrag || event.pointerId !== _histDrag.pointerId) return;
  const ds = _histDrag;
  _histDrag = null;
  const layout = scopedHistogramLayout();
  let next;
  if (!ds.moved && AppView.scoreRange) {
    const intervals = parseRange(AppView.scoreRange);
    const insideSelection = intervals && matchesRange(ds.startLo, intervals) && matchesRange(ds.startHi, intervals);
    next = insideSelection ? '' : rangeStrFromBounds(ds.startLo, ds.startHi, layout);
  } else {
    next = rangeStrFromBounds(Math.min(ds.startLo, ds.curLo), Math.max(ds.startHi, ds.curHi), layout);
  }
  document.querySelectorAll('#score-range-input').forEach(inp => { inp.value = next; syncClearButton(inp); });
  AppView.onScoreRange(next);
}

function mountHistogramPointer() {
  document.addEventListener('pointermove', _onHistogramPointerMove);
  document.addEventListener('pointerup', _onHistogramPointerUp);
  document.addEventListener('pointercancel', () => { _histDrag = null; repositionAllHistogramRects(); });
}

// Pass `intervals` to override the live filter (used during drag preview).
function positionHistogramRect(histEl, intervals = undefined) {
  const rect = histEl.querySelector('.histogram-rect');
  if (!rect) return;
  if (intervals === undefined) {
    const range = AppView.scoreRange;
    intervals = range ? parseRange(range) : null;
  }
  if (!intervals) { rect.hidden = true; return; }
  const cols = [...histEl.querySelectorAll('.histogram-col')];
  const matching = cols.filter(c => {
    const bar = c.querySelector('.histogram-bar');
    return slotIntersectsRange(+bar.dataset.lo, +bar.dataset.hi, intervals);
  });
  if (!matching.length) { rect.hidden = true; return; }
  const first = matching[0], last = matching[matching.length - 1];
  const left = first.offsetLeft - 2;
  const right = last.offsetLeft + last.offsetWidth + 2;
  rect.hidden = false;
  rect.style.left = `${left}px`;
  rect.style.width = `${right - left}px`;
}

function repositionAllHistogramRects() {
  document.querySelectorAll('#app .histogram').forEach(h => positionHistogramRect(h));
}

// ─── Fetch, import & update ───────────────────────────────────────────────────

let _updateScroller = null;

const openUpdateSummaryDialog = (() => {
  let el, titleEl, countEl, pillsEl, scrollEl;

  const show = function(wordlist, oldCount, added, deleted, rescored) {
    titleEl.textContent = `${wordlist.name} Updated`;
    countEl.textContent = `${oldCount.toLocaleString()} → ${wordlist.rawEntries.length.toLocaleString()} entries`;

    const rows = [];
    const sectionIndices = {};

    if (added.length) {
      sectionIndices.added = rows.length;
      rows.push({ type: 'header', label: `Added (${added.length.toLocaleString()})` });
      for (const e of added) rows.push({ type: 'entry', display: displayOf(e), score: e.score, kind: 'added' });
    }
    if (deleted.length) {
      sectionIndices.deleted = rows.length;
      rows.push({ type: 'header', label: `Deleted (${deleted.length.toLocaleString()})` });
      for (const e of deleted) rows.push({ type: 'entry', display: displayOf(e), score: e.score, kind: 'deleted' });
    }
    if (rescored.length) {
      sectionIndices.rescored = rows.length;
      rows.push({ type: 'header', label: `Rescored (${rescored.length.toLocaleString()})` });
      for (const e of rescored) rows.push({ type: 'entry', display: displayOf(e.entry), score: e.score, kind: 'rescored', oldScore: e.oldScore });
    }

    pillsEl.innerHTML = '';
    const pillDefs = [
      { key: 'added',    label: `${added.length.toLocaleString()} added`,    cls: 'usd-pill-added'   },
      { key: 'deleted',  label: `${deleted.length.toLocaleString()} deleted`,  cls: 'usd-pill-deleted'  },
      { key: 'rescored', label: `${rescored.length.toLocaleString()} rescored`, cls: 'usd-pill-rescored' },
    ];
    for (const { key, label, cls } of pillDefs) {
      if (sectionIndices[key] == null) continue;
      const btn = document.createElement('button');
      btn.className = 'usd-pill ' + cls;
      btn.textContent = label;
      btn.onclick = () => _updateScroller.scrollToIndex(sectionIndices[key]);
      pillsEl.appendChild(btn);
    }

    scrollEl.innerHTML = '';
    _updateScroller = new UpdateSummaryScroller(scrollEl);
    _updateScroller.setRows(rows);

    showDialog(el);
  };
  show.mount = () => {
    el = document.createElement('dialog');
    el.id = 'update-summary-dialog';
    el.setAttribute('aria-labelledby', 'update-summary-title');
    document.body.appendChild(el);
    el.innerHTML = `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <div class="usd-header">
        <h2 id="update-summary-title"></h2>
        <div class="usd-count" id="update-summary-count"></div>
        <div class="usd-pills" id="update-summary-pills"></div>
      </div>
      <div class="usd-scroll" id="update-summary-scroll"></div>`;
    titleEl   = el.querySelector('#update-summary-title');
    countEl   = el.querySelector('#update-summary-count');
    pillsEl   = el.querySelector('#update-summary-pills');
    scrollEl  = el.querySelector('#update-summary-scroll');
    enableDismissClicks(el);
  };
  return show;
})();

async function applyWordlistText(wordlist, text, { fetchedSize = null, originalFilename = null, nameOverride = null, source = null, clearUrl = false, silent = false, viaToast = false } = {}) {
  const wasEmpty = !wordlist.rawEntries.length;
  const oldEntries = wasEmpty ? null : wordlist.rawEntries;

  // Invalidate first, then mutate — so signal writes (name/url) don't fire
  // the cosmetic effect against still-stale caches mid-flight. Wrap in
  // batchUpdate to coalesce all writes + the cache bump into one render
  // effect run after the batch.
  batchUpdate(() => {
    invalidateWordlistCaches(wordlist);
    wordlist.rawEntries = parseWordlist(text);
    wordlist.lastUpdated = Date.now();
    if (fetchedSize !== null) { wordlist.fetchedSize = fetchedSize; wordlist._updateAvailable = false; }
    if (originalFilename !== null) wordlist.originalFilename = originalFilename;
    if (!wordlist.populated) { wordlist.populated = true; wordlist.enabled = true; }
    maybeAutoSeedRescoreRules(wordlist);
    if (wordlist.type === 'edits') reconcileEditsRulesAfterImport(wordlist);
    compileRescoreRules(wordlist);
    if (nameOverride) wordlist.name = nameOverride;
    if (clearUrl) { wordlist.url = null; wordlist.fetchedSize = null; wordlist._updateAvailable = false; }
    persistMeta();
    repaintAfterCacheChange();
  });

  await Storage.writeWordlist(wordlist, text);
  if (wordlist.type === 'edits') EditsSync.scheduleWrite();
  else                           MirrorSync.schedule(wordlist);
  // The render effect drained inside batchUpdate already updated the wordlist
  // list, dropdown, scoring legend, stats bar, and active scroller for the
  // current selection. Nothing else to repaint here.

  if (wasEmpty) {
    if (!silent) showToast(`Loaded ${pluralize(wordlist.rawEntries.length, 'entry', 'entries')} from ${esc(source)}`);
  } else {
    const oldMap = new Map(oldEntries.map(e => [e.norm, e.score]));
    const newMap = new Map(wordlist.rawEntries.map(e => [e.norm, e.score]));
    const added   = wordlist.rawEntries.filter(e => !oldMap.has(e.norm)).sort((a, b) => a.norm.localeCompare(b.norm));
    const deleted = oldEntries.filter(e => !newMap.has(e.norm)).sort((a, b) => a.norm.localeCompare(b.norm));
    const rescored = oldEntries
      .filter(e => newMap.has(e.norm) && newMap.get(e.norm) !== e.score)
      .map(e => ({ entry: e, oldScore: e.score, score: newMap.get(e.norm) }))
      .sort((a, b) => a.entry.norm.localeCompare(b.entry.norm));
    if (!added.length && !deleted.length && !rescored.length) {
      if (!viaToast) showAlert(`${buildWordlistNameHTML(wordlist)} is already up to date — no changes.`);
    } else if (viaToast) {
      const parts = [];
      if (added.length)    parts.push(`${added.length.toLocaleString()} added`);
      if (deleted.length)  parts.push(`${deleted.length.toLocaleString()} deleted`);
      if (rescored.length) parts.push(`${rescored.length.toLocaleString()} rescored`);
      showActionToast(
        `${esc(wordlist.name)} auto-updated: ${parts.join(', ')}`,
        'Details',
        () => openUpdateSummaryDialog(wordlist, oldEntries.length, added, deleted, rescored),
      );
    } else {
      openUpdateSummaryDialog(wordlist, oldEntries.length, added, deleted, rescored);
    }
  }
}

async function fetchWordlist(wordlist, event, { silent = false, viaToast = false } = {}) {
  if (event) event.stopPropagation();
  if (!wordlist || !wordlist.url || wordlist._loading) return;

  wordlist._loading = true;
  renderSources();

  try {
    const resp = await fetch(wordlist.url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const text = await resp.text();
    const fetchedSize = resp.headers.get('content-length') || null;
    const originalFilename = new URL(wordlist.url).pathname.split('/').pop() || null;
    wordlist._loading = false;
    await applyWordlistText(wordlist, text, { fetchedSize, originalFilename, source: wordlist.url, silent, viaToast });
  } catch (err) {
    wordlist._loading = false;
    renderSources();
    const detail = err.message === 'Failed to fetch' ? '' : `: ${err.message}`;
    showToast(`Failed to fetch ${esc(wordlist.url)}${esc(detail)}`);
  }
}

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

function getAutoUpdate() { return lsLoad('autoUpdate') !== 'off'; }

async function checkForUpdates() {
  const candidates = state.sources.filter(l => l.url && l.rawEntries.length > 0 && l.fetchedSize);
  if (!candidates.length) return;

  const autoUpdate = getAutoUpdate();
  let anyChanged = false;
  await Promise.all(candidates.map(async wordlist => {
    try {
      const resp = await fetch(wordlist.url, { method: 'HEAD' });
      if (!resp.ok) return;
      const size = resp.headers.get('content-length');
      if (!size || size === wordlist.fetchedSize) return;
      if (autoUpdate) {
        await fetchWordlist(wordlist, null, { silent: true, viaToast: true });
      } else if (!wordlist._updateAvailable) {
        wordlist._updateAvailable = true;
        anyChanged = true;
      }
    } catch { /* offline or network error — silently ignore */ }
  }));

  if (anyChanged) {
    renderSources();
    WordlistSelector.refresh();
  }

  if (unigramFetchedSize) {
    try {
      const resp = await fetch(UNIGRAM_CORPUS_URL, { method: 'HEAD' });
      const size = resp.ok ? resp.headers.get('content-length') : null;
      if (size && size !== unigramFetchedSize) {
        unigramLogFreqs = null;
        unigramLoadPromise = null;
        await idbPut(UNIGRAM_CORPUS_IDB_KEY, '');
        await loadUnigramCorpus();
      }
    } catch { /* offline or network error — silently ignore */ }
  }
}

function triggerImportForWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  if (!wordlist) return;
  if (wordlist.url) fetchWordlist(wordlist, event);
  else importToWordlist(wordlist);
}

function importToWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  ImportGuideDialog.open(wordlist);
}

function ingestFile(file, wordlist, nameOverride) {
  const reader = new FileReader();
  reader.onerror = () => showToast('Error reading file');
  reader.onabort = () => showToast('File read cancelled');
  reader.onload = async e => {
    const text = e.target.result;
    if (!wordlist) return;

    const entries = parseWordlist(text);
    if (!entries.length && text.trim()) {
      showToast('No valid wordlist entries found — check the file format');
      return;
    }

    // My Edits: always combine instead of replace
    if (wordlist.type === 'edits' && wordlist.rawEntries.length > 0) {
      const existingMap = new Map(wordlist.rawEntries.map(e => [mergeKey(e.norm, e.display), e]));
      const newEntries = [], conflicts = [];
      let unchanged = 0;

      for (const wlEntry of entries) {
        const existing = existingMap.get(mergeKey(wlEntry.norm, wlEntry.display));
        if (!existing) {
          newEntries.push(wlEntry);
        } else if (existing.score !== wlEntry.score || existing.comment !== wlEntry.comment) {
          conflicts.push({ existing, incoming: wlEntry });
        } else {
          unchanged++;
        }
      }

      let conflictResolution = null;
      if (conflicts.length > 0) {
        conflictResolution = await showMergeConflict(conflicts.length);
        if (conflictResolution === null) return; // cancelled

        if (conflictResolution === 'file') {
          for (const { existing, incoming } of conflicts) {
            existing.score   = incoming.score;
            existing.comment = incoming.comment;
          }
        }
      }

      wordlist.rawEntries.push(...newEntries);
      wordlist.lastUpdated = Date.now();
      reconcileEditsRulesAfterImport(wordlist);
      invalidateWordlistCaches(wordlist);
      compileRescoreRules(wordlist);

      await Storage.writeWordlist(wordlist, serializeEntries(wordlist.rawEntries));
      persistMeta();

      renderSources();
      renderMergedDetail();

      const parts = [];
      if (newEntries.length) parts.push(`${newEntries.length.toLocaleString()} new`);
      if (conflicts.length) parts.push(`${conflicts.length.toLocaleString()} ${conflictResolution === 'file' ? 'updated from file' : 'conflicts kept'}`);
      if (unchanged)        parts.push(`${unchanged.toLocaleString()} unchanged`);
      showToast(parts.length ? `Merged — ${parts.join(', ')}` : 'File already merged — no changes');
      return;
    }

    await applyWordlistText(wordlist, text, { originalFilename: file.name, nameOverride, source: file.name });
  };
  reader.readAsText(file);
}


// ─── My Edits: add entry & delete ────────────────────────────────────────────

function newEntrySeedQuery() {
  const q = AppView.searchQuery.trim();
  if (!isLiteralQuery(q) || getActiveCorpus().byNorm.has(toNorm(q))) return '';
  return q;
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

function buildNoMatchQuipHTML(term) {
  const span = `<span class="entries-empty-term">${esc(term)}</span>`;
  return NO_MATCH_QUIPS[hashStringMod(term.toLowerCase(), NO_MATCH_QUIPS.length)](span);
}

function deleteFromEdits(target, refreshFn) {
  const edits = getEditsWordlist();
  const norm = target.norm;
  const display = target.display;
  const idx = edits.rawEntries.findIndex(e => e.norm === norm && displayOf(e) === display);
  if (idx === -1) return;

  const refresh = refreshFn ?? (() => {
    entriesScroller._invalidateSortCache();
    entriesScroller._sortAndRender();
  });

  let deleted;
  applyEditsChange(edits, [norm], () => { [deleted] = edits.rawEntries.splice(idx, 1); });
  persistEdits(edits);
  refresh();

  showUndoToast(`Deleted ${esc(displayOf(deleted))} from ${buildWordlistNameHTML(edits)}`, () => {
    applyEditsChange(edits, [norm], () => { edits.rawEntries.splice(idx, 0, deleted); });
    persistEdits(edits);
    refresh();
  });
}

async function deleteWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  if (!wordlist) return;
  if (!await showConfirm('', { confirmText: 'Delete', html: `Delete ${buildWordlistNameHTML(wordlist)}?` })) return;
  // Invalidate first so any reactive subscribers re-rendering on the
  // `state.sources` change below don't read a stale merged cache.
  invalidateWordlistCaches(wordlist);
  state.sources = state.sources.filter(l => l !== wordlist);
  await detachSync(wordlist);
  await Storage.deleteWordlist(wordlist);
  persistMeta();
  renderAll();
}

function toggleWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  if (!wordlist || !wordlist.populated) return;
  setWordlistEnabled(wordlist, !wordlist.enabled);
}

function addNewWordlist(wordlistDef) {
  const wordlist = wrapWordlist({ rescoreRules: [], ...wordlistDef, rawEntries: [], lastUpdated: null, _loading: false });
  compileRescoreRules(wordlist);
  state.sources.push(wordlist);
  invalidateSourceCounts();
  invalidateStatsCache(_mergedStatsKey);
  persistMeta();
  sources$.bump();              // notify cosmetic effect with fresh caches
  return wordlist;
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

const showConfirm = (() => {
  let el, msgEl, okBtn, cancelBtn;

  const show = function(message, { confirmText = 'OK', cancelText = 'Cancel', danger = true, html = null } = {}) {
    return new Promise(resolve => {
      if (html != null) { msgEl.innerHTML = html; } else { msgEl.textContent = message; }
      okBtn.textContent     = confirmText;
      cancelBtn.textContent = cancelText;
      okBtn.className       = danger ? 'danger' : '';
      showDialog(el, () => resolve(el.returnValue === 'ok'));
    });
  };
  show.mount = () => {
    let body;
    ({ el, body } = createDialog('confirm-dialog', { labelledby: 'confirm-dialog-msg' }));
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <form method="dialog">
        <p class="dialog-msg" id="confirm-dialog-msg"></p>
        <div class="dialog-footer">
          <button type="button" id="btn-confirm-cancel" class="dialog-cancel-btn">Cancel</button>
          <button id="btn-confirm-ok" value="ok"></button>
        </div>
      </form>`;
    msgEl     = el.querySelector('#confirm-dialog-msg');
    okBtn     = el.querySelector('#btn-confirm-ok');
    cancelBtn = el.querySelector('#btn-confirm-cancel');
  };
  return show;
})();

const showAlert = (() => {
  let el, msgEl;

  const show = function(message) {
    return new Promise(resolve => {
      msgEl.innerHTML = message;
      showDialog(el, resolve);
    });
  };
  show.mount = () => {
    let body;
    ({ el, body } = createDialog('alert-dialog', { labelledby: 'alert-dialog-msg' }));
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <form method="dialog">
        <p class="dialog-msg" id="alert-dialog-msg"></p>
        <div class="dialog-footer">
          <button class="primary" autofocus>OK</button>
        </div>
      </form>`;
    msgEl = el.querySelector('#alert-dialog-msg');
  };
  return show;
})();

const showMergeConflict = (() => {
  let el, msgEl;

  const show = function(conflictCount) {
    return new Promise(resolve => {
      const editsName = getEditsWordlist().name;
      const noun = conflictCount === 1 ? 'entry appears' : 'entries appear';
      msgEl.textContent = `${conflictCount.toLocaleString()} ${noun} in both ${editsName} and the imported file with different scores or comments. Which should take precedence?`;
      showDialog(el, () => resolve(el.returnValue || null));
    });
  };
  show.mount = () => {
    let body;
    ({ el, body } = createDialog('merge-conflict-dialog', { labelledby: 'merge-conflict-msg' }));
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <form method="dialog">
        <p class="dialog-msg" id="merge-conflict-msg"></p>
        <div class="dialog-footer">
          <button type="button" class="dialog-cancel-btn" autofocus>Cancel</button>
          <button value="file">Use Imported File</button>
          <button class="primary" value="edits">Keep My Edits</button>
        </div>
      </form>`;
    msgEl = el.querySelector('#merge-conflict-msg');
  };
  return show;
})();

// ─── Disk sync dialog ─────────────────────────────────────────────────────────

const SyncDialog = (() => {
  let el, body;

  function mount() {
    ({ el, body } = createDialog('sync-dialog', { labelledby: 'sync-dialog-title' }));
  }

  function diagram(arrow) {
    return `<div class="sync-diagram">
        <svg class="sync-diagram-icon" aria-hidden="true"><use href="#${getBrowser().icon}"/></svg>
        <span class="sync-diagram-arrow">${arrow}</span>
        <span class="sync-diagram-emoji">📄</span>
        <span class="sync-diagram-arrow">${arrow}</span>
        <svg class="sync-diagram-icon" aria-hidden="true"><use href="#icon-crossword"/></svg>
      </div>`;
  }

  function render(target) {
    const key = syncKey(target);
    const synced = syncTargets.has(key);
    const mirror = isMirrorList(target);
    const name = esc(syncFilename(key));
    const listLabel = buildWordlistNameHTML(target, { bold: false });

    let title, inner;
    if (!Disk.isSupported()) {
      title = 'Saved in your browser';
      inner = `<p class="sync-dialog-lead">Grawlix keeps your wordlists in ${esc(getBrowser().name)}'s storage on this device. Disk sync — keeping a list in sync with a file your construction software reads — needs a Chromium browser like Chrome or Edge. Use <strong>Download</strong> to save a file out anytime.</p>
        <div class="sync-dialog-actions"><button type="button" class="dialog-cancel-btn primary">Got it</button></div>`;
    } else if (synced) {
      const unavailable = SyncStatus.get(key) === 'unavailable';
      title = `Syncing ${listLabel} to disk`;
      inner = `${diagram(mirror ? '→' : '⇄')}
        <p class="sync-dialog-lead">${mirror
          ? `<strong>${name}</strong> is shared by Grawlix and your construction software. It will stay up to date as you make changes.`
          : `<strong>${name}</strong> is shared between Grawlix and your construction software. Edit in either place — changes flow both ways.`}</p>
        ${unavailable ? `<p class="sync-dialog-note attention"><span class="sync-dialog-note-icon" aria-hidden="true">⚠️</span><span>Grawlix can't find <strong>${name}</strong> — it may have been moved or deleted, so syncing is paused.</span></p>` : ''}
        <div class="sync-dialog-actions"><button type="button" class="danger" onclick="SyncDialog.act('stopSync')">Turn off</button></div>`;
    } else {
      title = `Sync ${listLabel} to disk`;
      inner = `${diagram(mirror ? '→' : '⇄')}
        <p class="sync-dialog-lead">Share a single file between Grawlix and your construction software.${mirror ? ' It will stay up to date as you make changes.' : ' Edit in either place — changes will flow both ways.'}</p>
        <div class="sync-choices">
          <button type="button" class="sync-choice" onclick="SyncDialog.act('syncExisting')">
            <span class="sync-choice-title">${mirror ? 'Overwrite an existing file' : 'Use an existing file'}</span>
            <span class="sync-choice-sub">Point at the wordlist your construction software already reads.</span>
          </button>
          <button type="button" class="sync-choice" onclick="SyncDialog.act('syncNew')">
            <span class="sync-choice-title">Create a new file</span>
            <span class="sync-choice-sub">Save changes to a fresh file.</span>
          </button>
        </div>`;
    }

    body.innerHTML = `<button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="sync-dialog-title">${title}</h2>
      ${inner}`;
  }

  // Don't await before dispatching: the action's FSA picker must fire inside this
  // click's transient activation, or it silently fails.
  function act(name) {
    Promise.resolve(WordlistActions.action(name)).then(done => { if (done) el.close(); });
  }

  return {
    mount,
    open(target) { render(target); showDialog(el); },
    act,
  };
})();

// ─── Configure / Add wordlist dialog ─────────────────────────────────────────────

const ConfigureWordlistDialog = (() => {
  let el, pickerPopup;

  // State
  let _mode           = 'configure';
  let _wordlist           = null;
  let _pickerOpen     = false;
  let _selectedPublisher = null;
  let _originalPublisher = null;
  let _pendingIcon    = null;
  let _pendingName    = '';
  let _rulesOption    = 'none';
  let _pendingFile    = null;
  let _onAdded        = null;

  // Elements
  let titleEl, publisherChipsEl, rulesOptionRow, rulesSelect, rulesPreviewWrap,
      iconPreview, pickerTrigger, imgUrlInput, nameInput, urlInput, urlCheckIcon,
      urlMetaEl, importSection, btnSave, importZoneLabel;

  // ── Icon picker ──────────────────────────────────────────────────────────────

  function colorSeedObj() {
    return _wordlist || { url: urlInput.value.trim(), name: _pendingName };
  }

  function setBufferedIcon(icon) {
    _pendingIcon = icon;
    iconPreview.innerHTML = buildIconHTML(icon, _pendingName, colorSeed(colorSeedObj()));
  }

  function syncEmojiGrid() {
    const cur = _pendingIcon?.type === 'emoji' ? _pendingIcon.value : null;
    pickerPopup.querySelectorAll('.icon-emoji-btn').forEach(btn => {
      if (btn.hasAttribute('data-auto')) {
        btn.classList.toggle('selected', !_pendingIcon);
      } else {
        btn.classList.toggle('selected', btn.dataset.emoji === cur);
      }
    });
  }

  function showPickerMode(mode) {
    pickerPopup.querySelectorAll('.icon-picker-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    pickerPopup.querySelectorAll('.icon-picker-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === mode));
    if (mode === 'emoji') syncEmojiGrid();
    if (mode === 'url')   setTimeout(() => imgUrlInput.focus(), 30);
  }

  function openPicker() {
    _pickerOpen = true;
    pickerPopup.querySelector('[data-auto]').innerHTML = buildInitialsIconHTML(_pendingName, colorSeed(colorSeedObj()));
    const tr = pickerTrigger.getBoundingClientRect();
    const dr = el.getBoundingClientRect();
    pickerPopup.style.top  = (tr.bottom - dr.top + 4) + 'px';
    pickerPopup.style.left = (tr.left - dr.left) + 'px';
    pickerPopup.hidden = false;
    if (_pendingIcon?.type === 'img') { imgUrlInput.value = _pendingIcon.url; showPickerMode('url'); }
    else                              { imgUrlInput.value = '';                showPickerMode('emoji'); }
  }

  function closePicker() {
    _pickerOpen = false;
    pickerPopup.hidden = true;
  }

  function wireIconPicker() {
    pickerTrigger.addEventListener('click',   () => { _pickerOpen ? closePicker() : openPicker(); });
    pickerTrigger.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _pickerOpen ? closePicker() : openPicker(); } });

    el.addEventListener('mousedown', e => {
      if (!_pickerOpen) return;
      if (pickerPopup.contains(e.target) || pickerTrigger.contains(e.target)) return;
      closePicker();
    });

    pickerPopup.querySelectorAll('.icon-picker-tab').forEach(tab => {
      tab.addEventListener('click', () => showPickerMode(tab.dataset.mode));
    });

    pickerPopup.querySelector('#icon-emoji-grid').addEventListener('click', e => {
      const btn = e.target.closest('.icon-emoji-btn');
      if (!btn) return;
      if (btn.hasAttribute('data-auto')) {
        setBufferedIcon(null);
      } else {
        const emoji = btn.dataset.emoji;
        const same = _pendingIcon?.type === 'emoji' && _pendingIcon.value === emoji;
        setBufferedIcon(same ? null : { type: 'emoji', value: emoji });
      }
      syncEmojiGrid();
      closePicker();
    });

    imgUrlInput.addEventListener('input', () => {
      const url = imgUrlInput.value.trim();
      setBufferedIcon(url ? { type: 'img', url } : null);
    });
  }

  // ── Publisher chips ──────────────────────────────────────────────────────────

  function renderPublisherChips() {
    const chips = [...WORDLIST_PUBLISHERS].sort((a, b) => a.popularity - b.popularity).map(p => {
      const icon = buildIconHTML(p.icon, p.name, colorSeed(p));
      return `<button class="publisher-chip${_selectedPublisher === p ? ' active' : ''}" data-publisher-id="${p.id}">${icon}${esc(p.name)}</button>`;
    });
    chips.push(`<button class="publisher-chip${!_selectedPublisher ? ' active' : ''}" data-publisher-id="">Custom</button>`);
    publisherChipsEl.innerHTML = chips.join('');
  }

  function selectPublisher(publisher) {
    _selectedPublisher = publisher;
    renderPublisherChips();
    if (publisher) {
      if (_mode === 'add') {
        _pendingName = publisher.name;
        nameInput.value = publisher.name;
        setBufferedIcon(publisher.icon ? { ...publisher.icon } : null);
        urlInput.value = publisher.url || '';
      }
      _rulesOption = _mode === 'add' ? 'recommended' : 'none';
    }
    updateRulesOptionRow();
    updateRulesPreview();
  }

  function wirePublisherChips() {
    publisherChipsEl.addEventListener('click', e => {
      const chip = e.target.closest('.publisher-chip');
      if (!chip) return;
      const publisher = chip.dataset.publisherId ? WORDLIST_PUBLISHERS.find(p => p.id === chip.dataset.publisherId) : null;
      selectPublisher(publisher);
    });
  }

  // ── Rules option ─────────────────────────────────────────────────────────────

  function updateRulesOptionRow() {
    if (!_selectedPublisher) { rulesOptionRow.hidden = true; return; }
    const isAdd = _mode === 'add';
    const publisherUnchanged = !isAdd && _selectedPublisher?.id === _originalPublisher?.id;
    const recommendedIsNoop  = publisherUnchanged && rulesMatchDefaultRules(_wordlist, _selectedPublisher);
    const applyVerb = isAdd ? 'Use' : publisherUnchanged ? 'Reapply' : 'Apply';
    const opts = [
      { value: 'recommended', label: `${applyVerb} recommended rules`, disabled: recommendedIsNoop },
      { value: 'levels',      label: `${applyVerb} scoring levels only` },
      { value: 'none',        label: isAdd ? 'None' : 'Do not change rules' },
    ];
    rulesSelect.innerHTML = opts.map(o =>
      `<option value="${o.value}"${_rulesOption === o.value ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${o.label}</option>`
    ).join('');
    rulesOptionRow.hidden = false;
  }

  function rulesMatchDefaultRules(wordlist, publisher) {
    const publisherRules = publisher?.defaultRules || [];
    const wordlistRules  = wordlist?.rescoreRules || [];
    if (wordlistRules.length !== publisherRules.length) return false;
    return wordlistRules.every((r, i) => {
      const p = publisherRules[i];
      return r.input === p.input && r.length === p.length && r.output === p.output && (r.note ?? '') === (p.note ?? '');
    });
  }

  function updateRulesPreview() {
    if (!_selectedPublisher || _rulesOption === 'none') { rulesPreviewWrap.hidden = true; return; }
    const rules = _rulesOption === 'levels'
      ? _selectedPublisher.defaultRules.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' }))
      : _selectedPublisher.defaultRules;
    rulesPreviewWrap.hidden = false;
    rulesPreviewWrap.innerHTML = buildRulesListHTML(rules || [], {
      rulesId: 'preview-rules',
      saveFn: '', deleteFn: '',
      rescore: true,
      readOnly: true,
    });
  }

  function wireRulesSelect() {
    rulesSelect.addEventListener('change', () => {
      _rulesOption = rulesSelect.value;
      updateRulesPreview();
    });
  }

  // ── Name input ────────────────────────────────────────────────────────────────

  function wireNameInput() {
    nameInput.addEventListener('input', () => {
      _pendingName = nameInput.value;
      if (!_pendingIcon) {
        iconPreview.innerHTML = buildInitialsIconHTML(_pendingName, colorSeed(colorSeedObj()));
        if (_pickerOpen) pickerPopup.querySelector('[data-auto]').innerHTML = buildInitialsIconHTML(_pendingName, colorSeed(colorSeedObj()));
      }
    });

    nameInput.addEventListener('focus', () => nameInput.classList.remove('invalid'));
  }

  // ── Auto-update URL / file areas ─────────────────────────────────────────────


  // ── URL guardrail check ───────────────────────────────────────────────────────

  let _urlCheckTimer = null;
  let _urlCheckAbort = null;

  const HTTP_REASON = { 400:'Bad Request', 401:'Unauthorized', 403:'Forbidden', 404:'Not Found',
    405:'Method Not Allowed', 410:'Gone', 429:'Too Many Requests', 500:'Internal Server Error',
    502:'Bad Gateway', 503:'Service Unavailable', 504:'Gateway Timeout' };

  function setUrlCheckError(msg) {
    urlCheckIcon.innerHTML = '<span class="url-check-err-icon">✗</span>';
    urlCheckIcon.hidden = false;
    urlMetaEl.innerHTML = `<span class="url-check-error">${msg}</span>`;
    urlMetaEl.classList.add('visible');
  }
  function setUrlCheckWarn(msg) {
    urlCheckIcon.textContent = '⚠️';
    urlCheckIcon.hidden = false;
    urlMetaEl.innerHTML = `<span class="url-check-warn">${msg}</span>`;
    urlMetaEl.classList.add('visible');
  }
  function setUrlCheckOk() {
    urlCheckIcon.innerHTML = '<span class="url-check-ok-icon">✓</span>';
    urlCheckIcon.hidden = false;
    urlMetaEl.classList.remove('visible');
  }

  async function checkUrl(url, signal) {
    // Step 1: HEAD — reachability + content-length (needed for update checking)
    let hasContentLength = false;
    try {
      const headResp = await fetch(url, { method: 'HEAD', signal });
      if (!headResp.ok) {
        const reason = headResp.statusText || HTTP_REASON[headResp.status] || '';
        setUrlCheckError(`Server returned ${headResp.status}${reason ? ' ' + esc(reason) : ''}`);
        return;
      }
      hasContentLength = !!headResp.headers.get('content-length');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setUrlCheckError('Unreachable — possible CORS restriction');
      return;
    }

    // Step 2: Range GET — fetch first 1 KB and validate content
    let chunkText = '';
    try {
      const rangeResp = await fetch(url, { method: 'GET', headers: { 'Range': 'bytes=0-1023' }, signal });
      if (rangeResp.body) {
        const reader = rangeResp.body.getReader();
        try {
          const { value } = await reader.read();
          if (value) chunkText = new TextDecoder().decode(value);
        } finally {
          reader.cancel();
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setUrlCheckWarn("Can't verify content");
      return;
    }

    if (!validateWordlistChunk(chunkText)) {
      setUrlCheckError('Not a wordlist file');
      return;
    }

    if (hasContentLength) {
      setUrlCheckOk();
    } else {
      setUrlCheckWarn('Update checking unavailable (no content-length)');
    }
  }

  function wireUrlAndFile() {
    urlInput.addEventListener('input', () => {
      clearTimeout(_urlCheckTimer);
      if (_urlCheckAbort) { _urlCheckAbort.abort(); _urlCheckAbort = null; }
      const url = urlInput.value.trim();
      if (!url) { urlCheckIcon.hidden = true; urlMetaEl.classList.remove('visible'); return; }
      urlCheckIcon.innerHTML = '<div class="url-check-spinner"></div>';
      urlCheckIcon.hidden = false;
      urlMetaEl.classList.remove('visible');
      _urlCheckTimer = setTimeout(() => {
        _urlCheckAbort = new AbortController();
        checkUrl(url, _urlCheckAbort.signal);
      }, 600);
    });

    bindDropZone(el.querySelector('#cfg-drop-zone'), el.querySelector('#cfg-file-input'), file => {
      _pendingFile = file;
      importZoneLabel.textContent = file.name;
      if (!nameInput.value.trim()) {
        _pendingName = nameFromPath(file.name);
        nameInput.value = _pendingName;
        if (!_pendingIcon) iconPreview.innerHTML = buildInitialsIconHTML(_pendingName, colorSeed(colorSeedObj()));
      }
    });
  }

  // ── Save / Add ────────────────────────────────────────────────────────────────

  function computeRulesToApply() {
    if (!_selectedPublisher) return _mode === 'add' ? [] : null;
    if (_rulesOption === 'recommended') return JSON.parse(JSON.stringify(_selectedPublisher.defaultRules || []));
    if (_rulesOption === 'levels')      return _selectedPublisher.defaultRules.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' }));
    return _mode === 'add' ? [] : null;
  }

  function wireSaveAndClose() {
    btnSave.onclick = () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); nameInput.classList.add('invalid'); return; }
      const rules = computeRulesToApply();
      const url   = urlInput.value.trim() || null;

      if (_mode === 'add') {
        const wordlist = addNewWordlist({
          dbKey: newDbKey(), icon: _pendingIcon, name,
          url, enabled: false, populated: false,
          ...(_selectedPublisher ? { publisherId: _selectedPublisher.id } : {}),
          rescoreRules: rules || [],
        });
        _onAdded?.(wordlist);
        el.close();
        if (url) {
          fetchWordlist(wordlist);
        } else if (_pendingFile) {
          ingestFile(_pendingFile, wordlist, name);
        }
      } else {
        batchUpdate(() => {
          setWordlistName(_wordlist, name);
          setWordlistIcon(_wordlist, _pendingIcon);
          setWordlistUrl(_wordlist, url);
          setWordlistPublisher(_wordlist, _selectedPublisher?.id ?? null);
          if (rules !== null) setWordlistRescoreRules(_wordlist, rules);
        });
        el.close();
      }
    };

    el.addEventListener('cancel', e => { if (_pickerOpen) { e.preventDefault(); closePicker(); } });
    el.addEventListener('close',  () => {
      closePicker();
      clearTimeout(_urlCheckTimer);
      if (_urlCheckAbort) { _urlCheckAbort.abort(); _urlCheckAbort = null; }
    });
  }

  // ── open (configure mode) ─────────────────────────────────────────────────────

  function open(wordlist) {
    _mode           = 'configure';
    _wordlist           = wordlist;
    _pickerOpen     = false;
    _selectedPublisher = getPublisher(wordlist);
    _originalPublisher = _selectedPublisher;
    _pendingIcon    = wordlist.icon || null;
    _pendingName    = wordlist.name || '';
    _pendingFile    = null;
    _rulesOption    = 'none';
    _onAdded        = null;

    titleEl.textContent = 'Configure Wordlist';
    btnSave.textContent = 'Save';
    pickerPopup.hidden = true;
    nameInput.classList.remove('invalid');
    iconPreview.innerHTML = buildIconHTML(wordlist.icon, wordlist.name, colorSeed(wordlist));
    nameInput.value = wordlist.name || '';
    urlInput.value  = wordlist.url  || '';

    renderPublisherChips();
    updateRulesOptionRow();
    updateRulesPreview();
    if (wordlist.url) {
      urlCheckIcon.innerHTML = '<div class="url-check-spinner"></div>';
      urlCheckIcon.hidden = false;
      urlMetaEl.classList.remove('visible');
      _urlCheckAbort = new AbortController();
      checkUrl(wordlist.url, _urlCheckAbort.signal);
    } else {
      urlCheckIcon.hidden = true;
      urlMetaEl.classList.remove('visible');
    }
    importSection.hidden = true;

    showDialog(el);
  }

  // ── openAdd (add mode) ────────────────────────────────────────────────────────

  function openAdd(onAdded = null) {
    _mode           = 'add';
    _wordlist           = null;
    _pickerOpen     = false;
    _selectedPublisher = null;
    _originalPublisher = null;
    _pendingIcon    = null;
    _pendingName    = '';
    _pendingFile    = null;
    _rulesOption    = 'none';
    _onAdded        = onAdded;

    titleEl.textContent = 'Add Wordlist';
    btnSave.textContent = 'Add';
    pickerPopup.hidden = true;
    nameInput.classList.remove('invalid');
    iconPreview.innerHTML = buildInitialsIconHTML('', colorSeed({ name: '' }));
    nameInput.value = '';
    urlInput.value  = '';
    urlCheckIcon.hidden = true;
    urlMetaEl.classList.remove('visible');
    importZoneLabel.textContent = 'Drop file here or click to browse';

    renderPublisherChips();
    updateRulesOptionRow();
    updateRulesPreview();

    importSection.hidden = false;

    showDialog(el);
  }

  function mount() {
    let body;
    ({ el, body } = createDialog('configure-wordlist-dialog', { labelledby: 'configure-wordlist-title', dismissOnBackdrop: false }));
    body.innerHTML = `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="configure-wordlist-title"></h2>
      <div class="configure-section">
        <div class="configure-section-label">Publisher</div>
        <div class="publisher-chips" id="publisher-chips"></div>
        <div class="rules-option-row" id="rules-option-row" hidden>
          <span class="rules-option-lbl">Scoring</span>
          <select id="rules-select"></select>
        </div>
        <div class="rules-preview-wrap" id="rules-preview-wrap" hidden></div>
      </div>
      <div class="configure-section">
        <div class="configure-icon-name-row">
          <div class="configure-section-label">Icon</div>
          <div class="configure-section-label">Name</div>
          <div class="icon-picker-trigger" id="icon-picker-trigger" tabindex="0" role="button" aria-label="Change icon">
            <div class="icon-preview-box" id="config-icon-preview"></div>
          </div>
          <input type="text" id="config-name-input" class="config-name-input" placeholder="Wordlist name" spellcheck="false" autocomplete="off">
        </div>
      </div>
      <div class="configure-section">
        <div class="configure-section-label">Auto-update URL</div>
        <div class="url-input-wrap">
          <svg class="url-input-icon" width="14" height="14" aria-hidden="true"><use href="#icon-globe"/></svg>
          <input class="url-input" id="config-url-input" type="url" placeholder="Auto-update disabled" spellcheck="false" autocomplete="off">
          <span id="url-check-icon" hidden></span>
        </div>
        <div id="source-url-meta" class="source-meta"></div>
      </div>
      <div class="configure-section" id="source-import-section" hidden>
        <div class="configure-section-label">Import</div>
        <div id="source-file-add-zone">
          <div class="import-zone" id="cfg-drop-zone">
            <span id="cfg-import-zone-label">Drop file here or click to browse</span>
            <input type="file" id="cfg-file-input" accept=".txt,.dict">
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button id="btn-cfg-cancel" class="dialog-cancel-btn">Cancel</button>
        <button class="primary" id="btn-cfg-save"></button>
      </div>`;

    // Popup lives inside the dialog so it's in the top layer with it
    pickerPopup = document.createElement('div');
    pickerPopup.id = 'icon-picker-popup';
    pickerPopup.hidden = true;
    pickerPopup.innerHTML = `
      <div class="icon-picker-tabs">
        <button class="icon-picker-tab active" data-mode="emoji">Emoji</button>
        <button class="icon-picker-tab" data-mode="url">URL</button>
      </div>
      <div class="icon-picker-pane active" data-pane="emoji">
        <div class="icon-emoji-grid" id="icon-emoji-grid">
          <button class="icon-emoji-btn" data-auto></button>
          ${EMOJI_LIST.map(e => `<button class="icon-emoji-btn" data-emoji="${esc(e)}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="icon-picker-pane" data-pane="url">
        ${buildUrlInputHTML('icon-img-url-input', 'https://example.com/icon.png')}
      </div>`;
    el.appendChild(pickerPopup);

    titleEl          = el.querySelector('#configure-wordlist-title');
    publisherChipsEl = el.querySelector('#publisher-chips');
    rulesOptionRow   = el.querySelector('#rules-option-row');
    rulesSelect      = el.querySelector('#rules-select');
    rulesPreviewWrap = el.querySelector('#rules-preview-wrap');
    iconPreview      = el.querySelector('#config-icon-preview');
    pickerTrigger    = el.querySelector('#icon-picker-trigger');
    imgUrlInput      = el.querySelector('#icon-img-url-input');
    nameInput        = el.querySelector('#config-name-input');
    urlInput         = el.querySelector('#config-url-input');
    urlCheckIcon     = el.querySelector('#url-check-icon');
    urlMetaEl        = el.querySelector('#source-url-meta');
    importSection    = el.querySelector('#source-import-section');
    btnSave          = el.querySelector('#btn-cfg-save');
    importZoneLabel  = el.querySelector('#cfg-import-zone-label');

    wireIconPicker();
    wirePublisherChips();
    wireRulesSelect();
    wireNameInput();
    wireUrlAndFile();
    wireSaveAndClose();
  }

  return { mount, open, openAdd };
})();

// ─── Event wiring ─────────────────────────────────────────────────────────────

function bindEvents() {
  // Header chrome
  document.querySelector('.header-logo-link').href = location.pathname;
  document.getElementById('btn-settings').onclick = () => SettingsDialog.open();
  document.getElementById('btn-help').onclick     = () => WelcomeDialog.open();
  document.getElementById('add-fab').onclick = () =>
    AtomPopover.openForCreate(newEntrySeedQuery(), entriesScroller, null);

  ToolStack.init();

  document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    let handled = true;
    switch (e.code) {
      case 'KeyM': cycleDarkMode();          break;
      case 'KeyS': focusPermanentSearch();   break;
      case 'KeyW': toggleWholeWord();        break;
      case 'KeyC': focusScoreRange();        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });
}

function focusPermanentSearch() {
  const input = document.querySelector('#app input[data-row="bar"][data-key="pattern"]');
  if (input) { input.focus(); input.select(); }
}

function focusScoreRange() {
  const input = document.getElementById('score-range-input');
  if (input) { input.focus(); input.select(); }
}

function toggleWholeWord() {
  const row = document.activeElement?.closest('.tool-row, .search-bar');
  let cb = row?.querySelector('input[type="checkbox"][data-key="whole-word"]');
  if (!cb) cb = document.querySelector('#app input[data-row="bar"][data-key="whole-word"]');
  if (!cb) return;
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('input', { bubbles: true }));
  cb.dispatchEvent(new Event('change', { bubbles: true }));
}

// ─── Utility ──────────────────────────────────────────────────────────────────

let _toastContainerEl = null;
function toastContainer() {
  if (_toastContainerEl) return _toastContainerEl;
  _toastContainerEl = document.createElement('div');
  _toastContainerEl.id = 'toast-container';
  document.body.appendChild(_toastContainerEl);
  return _toastContainerEl;
}
function _mountToast(el, duration) {
  let hovered = false;
  const arm = () => { clearTimeout(el._timer); el._timer = setTimeout(() => _dismissToast(el), duration); };
  // Without this gate, touch's sticky mouseenter (no mouseleave) pins the toast open forever.
  if (hoverCapable().matches) {
    el.addEventListener('mouseenter', () => { hovered = true; clearTimeout(el._timer); });
    el.addEventListener('mouseleave', () => { hovered = false; if (el.classList.contains('show')) arm(); });
  }
  el.addEventListener('click', () => { if (!hovered && el.classList.contains('show')) arm(); });
  toastContainer().appendChild(el);
  el.offsetWidth; // force reflow so opacity transition fires
  el.classList.add('show');
  arm();
}
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = msg;
  _mountToast(el, 5000);
}
function showActionToast(msg, actionLabel, onAction) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = msg + `<span class="toast-action">${esc(actionLabel)}</span>`;
  el.querySelector('.toast-action').onclick = e => {
    e.stopPropagation();
    _dismissToast(el);
    onAction();
  };
  _mountToast(el, 10000);
}
function showUndoToast(msg, onUndo) {
  showActionToast(msg, 'Undo', onUndo);
}
function _dismissToast(el) {
  clearTimeout(el._timer);
  el.classList.add('dismissing');
  el.classList.remove('show');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}

// ─── Publisher lookup ─────────────────────────────────────────────────────────

function getPublisher(wordlist) {
  return wordlist.publisherId ? WORDLIST_PUBLISHERS.find(p => p.id === wordlist.publisherId) ?? null : null;
}

// ─── Wordlist icons ───────────────────────────────────────────────────────────────

function nameToInitials(name) {
  const words = name.trim().split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function hashStringMod(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function nameColorIndex(name) { return hashStringMod(name, INITIALS_PALETTE.length); }

function buildInitialsIconHTML(name, colorSeed = name) {
  const initials = esc(nameToInitials(name));
  const ci = nameColorIndex(colorSeed);
  return `<svg class="wordlist-icon wordlist-icon-initials ic-${ci}" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3"/><text x="8" y="8" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="700" font-size="8" letter-spacing="-0.02em">${initials}</text></svg>`;
}

function buildEmojiIconHTML(emoji) {
  return `<svg class="wordlist-icon wordlist-icon-emoji" viewBox="0 0 16 16" aria-hidden="true"><text x="8" y="8" text-anchor="middle" dominant-baseline="central" font-size="13">${esc(emoji)}</text></svg>`;
}

function buildImgIconHTML(url) {
  return `<img src="${esc(url)}" class="wordlist-icon wordlist-icon-img" onerror="this.style.display='none'" alt="">`;
}

// descriptor: null | { type: 'emoji', value } | { type: 'img', url }
function buildIconHTML(descriptor, name, seed) {
  if (descriptor?.type === 'emoji') return buildEmojiIconHTML(descriptor.value);
  if (descriptor?.type === 'img')   return buildImgIconHTML(descriptor.url);
  return buildInitialsIconHTML(name, seed);
}

function colorSeed(obj) {
  return obj.url || obj.name;
}

function getWordlistIcon(wordlist) {
  return buildIconHTML(wordlist.icon, wordlist.name, colorSeed(wordlist));
}

// ─── Import Guide ─────────────────────────────────────────────────────────────

function bindDropZone(zone, fileInput, onFile) {
  zone.onclick     = () => fileInput.click();
  zone.ondragover  = e => { e.preventDefault(); zone.classList.add('drag-over'); };
  zone.ondragleave = () => zone.classList.remove('drag-over');
  zone.ondrop      = e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };
  fileInput.onchange = () => { if (fileInput.files[0]) onFile(fileInput.files[0]); };
}

const ImportGuideDialog = (() => {
  let el, body;

  let _wordlist = null;
  let _pendingFile = null;

  function mount() {
    ({ el, body } = createDialog('import-guide-dialog', { labelledby: 'guide-title' }));
  }

  function open(wordlist) {
    _wordlist = wordlist;
    _pendingFile = null;
    body.innerHTML = buildContentHTML(wordlist);

    const zoneLabel = el.querySelector('.guide-zone-label');
    const importBtn = el.querySelector('.guide-import-btn');
    importBtn.disabled = true;

    importBtn.onclick = () => {
      if (!_pendingFile) return;
      el.close();
      ingestFile(_pendingFile, _wordlist);
    };

    bindDropZone(el.querySelector('.guide-drop-zone'), el.querySelector('.guide-file-input'), file => {
      _pendingFile = file;
      zoneLabel.textContent = file.name;
      importBtn.disabled = false;
    });

    showDialog(el);
  }

  function buildContentHTML(wordlist) {
    const publisher = getPublisher(wordlist);
    const dropZone = `
      <div class="import-zone compact guide-drop-zone">
        <span class="guide-zone-label">Drop file here or click to browse</span>
        <input type="file" class="guide-file-input" accept=".txt,.dict">
      </div>`;
    const footer = `
      <div class="dialog-footer">
        <button class="dialog-cancel-btn">Cancel</button>
        <button class="primary guide-import-btn">Import</button>
      </div>`;

    if (!publisher?.sourcePage) {
      return `
        <button class="dialog-close-btn" aria-label="Close">✕</button>
        <h2 id="guide-title">Import ${esc(wordlist.name)}</h2>
        <p class="guide-intro">Import a wordlist file from your computer. Grawlix will load its words and scores into this wordlist.</p>
        ${dropZone}
        ${footer}`;
    }

    const subNote = publisher.subscriptionNote
      ? `<div class="subscription-note"><strong>Note:</strong> ${esc(publisher.subscriptionNote)}</div>`
      : '';
    // sourceNote is trusted HTML hardcoded in WORDLIST_PUBLISHERS, never user input.
    return `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="guide-title">Import ${esc(publisher.name)}</h2>
      <p class="guide-intro">This wordlist isn't auto-fetched — you'll need to download it yourself, then drop the file back here.</p>
      ${subNote}
      <ol class="guide-steps">
        <li class="guide-step"><div class="guide-step-body">
          Open the wordlist page: <a href="${esc(publisher.sourcePage)}" target="_blank" rel="noopener">${esc(publisher.sourcePage)} 🔗</a>
        </div></li>
        <li class="guide-step"><div class="guide-step-body">${publisher.sourceNote || 'Download the wordlist file.'}</div></li>
        <li class="guide-step"><div class="guide-step-body">
          Drop the downloaded file below, or click to browse:
          ${dropZone}
        </div></li>
      </ol>
      ${footer}`;
  }

  return { mount, open };
})();


// ─── Rescore rule management ──────────────────────────────────────────────────

function afterRuleChange(wordlist) {
  applyRescoreRulesChange(wordlist);
  renderRescoreSection();
}

function getRescoreContextWordlist() {
  return (state.selected && state.selected !== MERGED_ID) ? state.selected : null;
}

function getActionTargetWordlist() {
  return state.selected;
}

function deleteRule(idx) {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist) return;
  const [deleted] = wordlist.rescoreRules.splice(idx, 1);
  afterRuleChange(wordlist);
  showUndoToast('Deleted rescore rule', () => {
    wordlist.rescoreRules.push(deleted);
    afterRuleChange(wordlist);
  });
}

function saveRuleField(idx, field, value) {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist || !wordlist.rescoreRules[idx]) return;
  if (field === 'length' && value.trim().toLowerCase() === 'any') value = '';
  if (field === 'output' && value.trim().toLowerCase() === 'unchanged') value = '';
  wordlist.rescoreRules[idx][field] = value;
  afterRuleChange(wordlist);
}

function activeRescoreContainerSelector(kind) {
  return kind === 'scoring' ? '#scoring-rules' : '#rescore-rules';
}

function addRule() {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist) return;
  wordlist.rescoreRules.push(makeRescoreRuleStub());
  afterRuleChange(wordlist);
  // afterRuleChange re-sorts and re-renders, so find the new row by its empty input rather than by index.
  const inp = [...document.querySelectorAll(`${activeRescoreContainerSelector('rescore')} .rule-row .rule-in`)].find(i => !i.value);
  inp?.focus();
}

async function resetRescoreRules() {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist) return;
  const defaults = getWordlistDefaultRules(wordlist);
  if (defaults === null) return;
  if (!await showConfirm('Replace your rescore rules with the defaults? Your customizations will be lost.', { confirmText: 'Reset' })) return;
  wordlist.rescoreRules = defaults.map(r => ({ ...r }));
  afterRuleChange(wordlist);
}

function rescoringIsNeutralizable(rules) {
  return (rules || []).some(r => r.scoring === false || (r.output ?? '').trim() !== '');
}

async function neutralizeRescoreRules() {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist || !wordlist.rescoreRules?.length) return;
  if (!await showConfirm('Disable rescoring? The input ranges and notes are kept as a legend — only the score remapping is removed.', { confirmText: 'Disable rescoring' })) return;
  wordlist.rescoreRules = wordlist.rescoreRules.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' }));
  afterRuleChange(wordlist);
}

function noteDisplayHTML(note) {
  return `<span class="rule-note-text">${esc(note)}</span><span class="edit-hint rule-note-pencil" aria-hidden="true">✏️</span>`;
}

function startNoteEdit(wrapEl) {
  if (wrapEl.querySelector('.rule-note-input')) return;
  const i = parseInt(wrapEl.closest('.rule-row').dataset.i, 10);
  const isScoring = !!wrapEl.closest('#scoring-rules');

  let currentNote, onSave;
  if (isScoring) {
    if (!state.scoring[i]) return;
    currentNote = state.scoring[i].note || '';
    onSave = note => saveScoringField(i, 'note', note);
  } else {
    const wordlist = getRescoreContextWordlist();
    if (!wordlist?.rescoreRules[i]) return;
    currentNote = wordlist.rescoreRules[i].note || '';
    onSave = note => saveRuleField(i, 'note', note);
  }

  wrapEl.innerHTML = `<input class="rule-note-input" value="${esc(currentNote)}" placeholder="note…">`;
  const input = wrapEl.querySelector('input');
  input.focus();
  input.select();

  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newNote = input.value;
    onSave(newNote);
    if (wrapEl.isConnected) {
      wrapEl.innerHTML = noteDisplayHTML(newNote);
      wrapEl.classList.toggle('has-note', !!newNote.trim());
    }
  }
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') {
      committed = true;
      if (wrapEl.isConnected) {
        wrapEl.innerHTML = noteDisplayHTML(currentNote);
        wrapEl.classList.toggle('has-note', !!currentNote.trim());
      }
    }
  });
}

function isRuleOutputInvalid(inputVal, outputVal) {
  const v = (outputVal || '').trim();
  if (!v) return false;
  const parsed = parseRuleOutput(v);
  if (parsed === null) return true;
  if (parsed && typeof parsed === 'object') {
    const iv = parseRange((inputVal || '').trim())?.[0];
    if (parsed.max === null) {
      // N+ output requires N+ input
      if (!iv || iv.max !== null) return true;
    } else {
      // Bounded range output requires bounded non-degenerate input range
      if (!iv || iv.min === null || iv.max === null || iv.min === iv.max) return true;
    }
  }
  return false;
}

function validateRulesContainer(container) {
  if (!container) return;
  container.querySelectorAll('.rule-in').forEach(inp => {
    inp.classList.toggle('invalid', parseRange(inp.value.trim()) === null);
  });
  container.querySelectorAll('.rule-len').forEach(inp => {
    const v = inp.value.trim();
    inp.classList.toggle('invalid', v !== '' && parseRange(v) === null);
  });
  container.querySelectorAll('.rule-out').forEach(inp => {
    const inEl = inp.closest('.rule-row')?.querySelector('.rule-in');
    inp.classList.toggle('invalid', isRuleOutputInvalid(inEl?.value, inp.value));
  });
}

function onRuleInput(el) {
  if (el.classList.contains('rule-len') && el.value.trim().toLowerCase() === 'any') el.value = '';
  if (el.classList.contains('rule-out') && el.value.trim().toLowerCase() === 'unchanged') el.value = '';
  const container = el.closest('#rescore-rules, #scoring-rules');
  if (!container) return;
  validateRulesContainer(container);
}

// ─── Rename ───────────────────────────────────────────────────────────────────

function startInlineRename(inputEl, originalName, { onCommit, onCancel, onInput }) {
  let done = false;
  function commit() {
    if (done) return;
    done = true;
    onCommit(inputEl.value.trim() || originalName);
  }
  function cancel() {
    if (done) return;
    done = true;
    onCancel();
  }
  if (onInput) inputEl.oninput = () => onInput(inputEl.value || originalName);
  inputEl.onblur = commit;
  inputEl.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { inputEl.onblur = null; cancel(); }
  };
}

// ─── Merge & Download ─────────────────────────────────────────────────────────


// `norms` must list every norm the mutation touches — an entry-text edit moves
// an entry between two norms, and any omitted norm keeps a stale merged bucket
// with no error.
function applyEditsChange(edits, norms, mutate) {
  const snap = snapshotMergedBuckets(norms);
  mutate();
  invalidateRescoredCache(edits);
  _statsCache.delete(edits);
  _statsCache.delete(_mergedStatsKey);
  invalidatePreSearchCache();
  patchMergedForNorms(snap);
  // When scoped to My Edits itself, its own view must rebuild to reflect the edit
  // (other scoped sources show only their own data, so they're unaffected).
  if (state.selected !== MERGED_ID) _scopedWordlistCache.delete(state.selected);
  refreshDerivedDisplays();
}

// The detail panel's stats bar is deliberately not repainted here — every
// caller also runs a scroller filter pass, and its onFilterChange callback
// repaints the bar.
function refreshDerivedDisplays() {
  WordlistSelector.refreshMeta();
  renderScoringRules();
}

// `sourceList[0]` is highest priority; winner resolution depends on it.
function bucketContributors(sourceList) {
  const buckets = new Map();
  for (const wordlist of sourceList) {
    for (const wlE of getRescoredEntries(wordlist)) {
      let b = buckets.get(wlE.norm);
      if (!b) buckets.set(wlE.norm, b = { contributors: [], displays: new Set() });
      b.contributors.push({ wordlist, score: wlE.score, rawScore: wlE.rawScore, comment: wlE.comment || '', display: wlE.display });
      if (wlE.display != null) b.displays.add(wlE.display);
    }
  }
  return buckets;
}

// #region nodetest:merge
function resolveCorpus(buckets, sourceList) {
  const entries = [];
  const byNorm = new Map();
  const byKey = new Map();
  const sourceCountMap = new Map();
  for (const [norm, { contributors, displays }] of buckets) {
    const variants = displays.size > 0 ? [...displays].sort() : [null];
    const countedContributors = new Set();
    for (const variant of variants) {
      const eligible = c => c.display === variant || c.display === null;
      const winner = contributors.find(eligible);
      if (!winner) continue;
      const commenter = contributors.find(c => eligible(c) && c.comment) ?? winner;
      const row = { norm, display: variant, score: winner.score, rawScore: winner.rawScore, comment: commenter.comment, wordlist: winner.wordlist };
      entries.push(row);
      if (!byNorm.has(norm)) byNorm.set(norm, row);
      byKey.set(mergeKey(norm, variant), row);
      if (!countedContributors.has(winner)) {
        countedContributors.add(winner);
        sourceCountMap.set(winner.wordlist, (sourceCountMap.get(winner.wordlist) || 0) + 1);
      }
    }
  }

  entries.sort((a, b) => a.norm.localeCompare(b.norm)
    || (a.display ?? '').localeCompare(b.display ?? ''));

  const sourceCounts = sourceList.map(wl => ({ wordlist: wl, count: sourceCountMap.get(wl) || 0 }));

  return { entries, sourceCounts, byNorm, byKey };
}
// #endregion nodetest:merge

function buildMergedWordlist() {
  if (_mergedWordlistCache) return _mergedWordlistCache;
  const enabled = state.sources.filter(wl => wl.enabled);
  _mergedWordlistCache = resolveCorpus(bucketContributors(enabled), enabled);
  return _mergedWordlistCache;
}

// Built independent of source.enabled so a disabled source stays viewable when
// it's the scope.
function buildScopedCorpus(source) {
  const cached = _scopedWordlistCache.get(source);
  if (cached) return cached;
  const corpus = resolveCorpus(bucketContributors([source]), [source]);
  _scopedWordlistCache.set(source, corpus);
  return corpus;
}

function getActiveCorpus() {
  return state.selected === MERGED_ID ? buildMergedWordlist() : buildScopedCorpus(state.selected);
}

// #region nodetest:merge
function mergeKey(norm, display) {
  return norm + '\0' + (display ?? '');
}
// #endregion nodetest:merge

// Must reproduce buildMergedWordlist's per-bucket logic exactly — including
// deduping winners by contributor, not wordlist — or the merged cache drifts
// silently on the next edit.
function computeMergedBucket(norm) {
  const contributors = [];
  const displays = new Set();
  for (const wl of state.sources) {
    if (!wl.enabled) continue;
    const arr = getRescoredByNorm(wl).get(norm);
    if (!arr) continue;
    for (const e of arr) {
      contributors.push({ wordlist: wl, score: e.score, comment: e.comment || '', display: e.display });
      if (e.display != null) displays.add(e.display);
    }
  }
  const rows = [];
  const winners = [];
  const counted = new Set();
  const variants = displays.size > 0 ? [...displays].sort() : [null];
  for (const variant of variants) {
    const eligible = c => c.display === variant || c.display === null;
    const winner = contributors.find(eligible);
    if (!winner) continue;
    const commenter = contributors.find(c => eligible(c) && c.comment) ?? winner;
    rows.push({ norm, display: variant, score: winner.score, comment: commenter.comment, wordlist: winner.wordlist });
    if (!counted.has(winner)) { counted.add(winner); winners.push(winner.wordlist); }
  }
  rows.sort((a, b) => (a.display ?? '').localeCompare(b.display ?? ''));
  return { rows, winners };
}

// #region nodetest:merge
function mergedNormLowerBound(entries, norm) {
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].norm.localeCompare(norm) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function mergedRowsForNorm(merged, norm) {
  const { entries } = merged;
  const rows = [];
  for (let i = mergedNormLowerBound(entries, norm); i < entries.length && entries[i].norm === norm; i++) {
    rows.push(entries[i]);
  }
  return rows;
}
// #endregion nodetest:merge

// Must run BEFORE My Edits is mutated: patchMergedForNorms diffs these winners
// against the post-mutation ones, so a snapshot taken too late drifts the
// source counts with no error.
function snapshotMergedBuckets(norms) {
  if (!_mergedWordlistCache) return null;
  const snap = new Map();
  for (const norm of norms) snap.set(norm, computeMergedBucket(norm).winners);
  return snap;
}

// `_initialChains` is parallel to `entries`, so it must take the same splice —
// otherwise the pipeline keeps seeding from rows that no longer exist.
function patchMergedForNorms(snap) {
  const cache = _mergedWordlistCache;
  if (!cache || !snap) return;
  const { entries, byNorm, byKey, sourceCounts } = cache;
  const chains = cache._initialChains;
  const countDelta = new Map();
  for (const [norm, beforeWinners] of snap) {
    const lo = mergedNormLowerBound(entries, norm);
    let hi = lo;
    while (hi < entries.length && entries[hi].norm === norm) hi++;
    for (let i = lo; i < hi; i++) byKey.delete(mergeKey(norm, entries[i].display));

    const { rows, winners } = computeMergedBucket(norm);
    entries.splice(lo, hi - lo, ...rows);
    if (chains) chains.splice(lo, hi - lo, ...rows.map(r => ({ atoms: [{ wlEntry: r, highlights: null, glyph: null }] })));
    for (const r of rows) byKey.set(mergeKey(norm, r.display), r);
    if (rows.length) byNorm.set(norm, rows[0]); else byNorm.delete(norm);

    for (const wl of beforeWinners) countDelta.set(wl, (countDelta.get(wl) || 0) - 1);
    for (const wl of winners)       countDelta.set(wl, (countDelta.get(wl) || 0) + 1);
  }
  for (const [wl, d] of countDelta) {
    if (!d) continue;
    const sc = sourceCounts.find(s => s.wordlist === wl);
    if (sc) sc.count += d;
    else sourceCounts.push({ wordlist: wl, count: d });
  }
}

function downloadMergedWordlistFromPanel() {
  const { entries } = buildMergedWordlist();
  triggerDownload(serializeEntries(entries, getOutputFormat()), rescoredFilename(MERGED_ID));
  showToast(`Downloaded ${pluralize(entries.length, 'entry', 'entries')}`);
}

function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadSourceWordlist(wordlist) {
  if (!wordlist || !wordlist.rawEntries.length) return;
  triggerDownload(serializeEntries(getRescoredEntries(wordlist), getOutputFormat()), rescoredFilename(wordlist));
  showToast(`Downloaded ${pluralize(wordlist.rawEntries.length, 'entry', 'entries')}`);
}

async function downloadOriginalWordlist(wordlist) {
  if (!wordlist || !wordlist.rawEntries.length) return;
  // Serve the imported file verbatim from IndexedDB — reconstructing from parsed
  // wlEntries would lose the comment formatting, line endings, and ordering the
  // user's file had, none of which round-trip through serializeEntries.
  const text = await Storage.readWordlist(wordlist);
  if (!text) { showToast('Original file not available'); return; }
  triggerDownload(text, `${sanitizeFilenameStem(wordlist.name)}.txt`);
  showToast(`Downloaded ${pluralize(wordlist.rawEntries.length, 'entry', 'entries')}`);
}

// ─── Export ──────────────────────────────────────────────────────────
// See docs/design.md § Entries-table export.

function buildExportMenuHTML() {
  return buildMoreMenuHTML([
    ['Copy to clipboard',            'exportCopy()'],
    ['Download results as wordlist', 'exportWordlist()'],
    ['Download as CSV',              'exportCSV()'],
    ['Download as JSON',             'exportJSON()'],
  ], { header: 'Export these results' });
}

// #region nodetest:export
function chainContentEntries(chain) {
  const out = [];
  let prevEntry = null;
  for (const atom of chain.atoms) {
    if (atom.wlEntry.norm === prevEntry) continue;
    out.push(atom.wlEntry);
    prevEntry = atom.wlEntry.norm;
  }
  return out;
}
// #endregion nodetest:export

function currentContentAtomCount(stack) {
  let count = 1;
  for (const row of stack) {
    if (row.isInert()) continue;
    if (row.kind() === 'transform') count++;
  }
  return count;
}

// #region nodetest:export
function* iterDisplayChains(rows, grouped) {
  if (grouped) {
    for (const g of rows) for (const chain of g.chains) yield { group: g, chain };
  } else {
    for (const chain of rows) yield { group: null, chain };
  }
}
// #endregion nodetest:export

function countExportEntries(rows, grouped) {
  if (grouped) { let n = 0; for (const g of rows) n += g.chains.length; return n; }
  return rows.length;
}

function exportToolsMetadata(stack) {
  const out = [];
  stack.forEach((row, i) => {
    const isBar = i === stack.length - 1 && row.tool === 'search';
    if (isBar && row.isInert()) return;
    const entry = { name: row.tool };
    const params = {};
    for (const p of row.def.params) {
      const v = row.params[p.key];
      if (p.type === 'checkbox') { if (v) params[p.key] = true; }
      else if (v !== undefined && v !== '') params[p.key] = v;
    }
    if (Object.keys(params).length) entry.params = params;
    if (row.grouped) entry.grouped = true;
    out.push(entry);
  });
  return out;
}

function exportScoreRangeMetadata() {
  const intervals = parseRange(AppView.scoreRange);
  if (!intervals) return null;
  const { min, max } = intervals[0];
  const out = {};
  if (min !== null) out.min = min;
  if (max !== null) out.max = max;
  return Object.keys(out).length ? out : null;
}

function exportSortMetadata() {
  return { by: AppView.sortKey, dir: AppView.sortDir };
}

// #region nodetest:export
function exportFilenameSegment(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[*?#@\[\]/\\:|"<>]/g, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function exportFilename(stack, ext) {
  const parts = ['grawlix'];
  stack.forEach((row, i) => {
    const isBar = i === stack.length - 1 && row.tool === 'search';
    if (isBar && row.isInert()) return;
    parts.push(exportFilenameSegment(row.tool));
    if (row.grouped) parts.push('all');
    const firstParam = row.def.params.find(p => row.params[p.key] && p.type !== 'checkbox');
    if (firstParam) {
      const seg = exportFilenameSegment(String(row.params[firstParam.key]));
      if (seg) parts.push(seg);
    }
  });
  if (parts.length === 1) parts.push('all');
  let name = parts.join('-');
  if (name.length > 100) name = name.slice(0, 100).replace(/-+$/, '');
  return `${name}.${ext}`;
}
// #endregion nodetest:export

// ── Copy ──

function chainCopyText(chain) {
  const parts = [];
  let prevNorm = null;
  for (const atom of chain.atoms) {
    const wlE = atom.wlEntry;
    if (wlE.norm === prevNorm) continue;
    const shown = wlE.display ?? wlE.norm.toUpperCase();
    const piece = `${wlE.norm.length} ${shown}`;
    parts.push(atom.glyph ? `${atom.glyph} ${piece}` : piece);
    prevNorm = wlE.norm;
  }
  return parts.join(' ');
}

// Backtick the params: a wildcard like `*EARNING` would otherwise trigger
// italic-on-rest-of-line in markdown renderers that parse formatting inside
// link text — a silent breakage in Discord/GitHub, invisible in plain text.
function exportCopyHeader(stack) {
  const url = location.href;
  const labels = [];
  stack.forEach((row, i) => {
    const isBar = i === stack.length - 1 && row.tool === 'search';
    if (isBar && row.isInert()) return;
    let label = row.def.name;
    const firstParam = row.def.params.find(p => row.params[p.key] && p.type !== 'checkbox');
    if (firstParam) {
      const v = row.params[firstParam.key];
      label += firstParam.type === 'number' ? ` ${v}` : ' `' + v + '`';
    }
    if (row.grouped) label += ' (all)';
    labels.push(label);
  });
  const desc = labels.length ? labels.join(' → ') : MERGED_NAME;
  return `[${desc}](${url})`;
}

function buildCopyText(rows, grouped, stack) {
  const header = exportCopyHeader(stack);
  const body = [];
  if (grouped) {
    for (const g of rows) body.push(g.chains.map(chainCopyText).join(', '));
  } else {
    body.push(...flatCopyLines(rows));
  }
  return header + (body.length ? '\n' + body.join('\n') : '');
}

// #region nodetest:export
function flatCopyLines(chains) {
  const piecesPerChain = chains.map(chain => {
    const pieces = [];
    let prevNorm = null;
    for (const atom of chain.atoms) {
      const wlE = atom.wlEntry;
      if (wlE.norm === prevNorm) continue;
      const shown = wlE.display ?? wlE.norm.toUpperCase();
      pieces.push({ glyph: atom.glyph || '', len: String(wlE.norm.length), entry: shown });
      prevNorm = wlE.norm;
    }
    return pieces;
  });

  const maxCols = Math.max(0, ...piecesPerChain.map(p => p.length));
  const lenW = new Array(maxCols).fill(0);
  const entryW = new Array(maxCols).fill(0);
  for (const pieces of piecesPerChain) {
    pieces.forEach((p, i) => {
      if (p.len.length > lenW[i]) lenW[i] = p.len.length;
      if (p.entry.length > entryW[i]) entryW[i] = p.entry.length;
    });
  }

  return piecesPerChain.map(pieces => pieces.map((p, i) => {
    const lenStr = p.len.padStart(lenW[i], ' ');
    const entry = i === maxCols - 1 ? p.entry : p.entry.padEnd(entryW[i], ' ');
    const piece = `${lenStr} ${entry}`;
    return p.glyph ? `${p.glyph} ${piece}` : piece;
  }).join(' '));
}
// #endregion nodetest:export

async function exportCopy() {
  if (!entriesScroller) return;
  const grouped = entriesScroller.sortTier === 'group';
  const text = buildCopyText(entriesScroller.entries, grouped, ToolStack.getStack());
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    showToast('Copy failed — clipboard permission denied');
    return;
  }
  const count = countExportEntries(entriesScroller.entries, grouped);
  showToast(`Copied ${pluralize(count, 'entry', 'entries')}`);
}

// ── Wordlist ──

// #region nodetest:export
function buildWordlistText(rows, grouped) {
  const acc = new Map();
  let skipped = 0;
  for (const { chain } of iterDisplayChains(rows, grouped)) {
    const content = chainContentEntries(chain);
    if (!content.length) continue;
    const tail = displayOf(content[content.length - 1]);
    if (tail.includes(';')) { skipped++; continue; }
    let chainMin = Infinity;
    for (const wlE of content) if (wlE.score < chainMin) chainMin = wlE.score;
    const cur = acc.get(tail);
    if (cur === undefined || chainMin > cur) acc.set(tail, chainMin);
  }
  const lines = [...acc.keys()].sort().map(e => `${e};${acc.get(e)}`);
  return { text: lines.length ? lines.join('\n') + '\n' : '', count: lines.length, skipped };
}
// #endregion nodetest:export

async function exportWordlist() {
  if (!entriesScroller) return;
  const grouped = entriesScroller.sortTier === 'group';
  const { text, count, skipped } = buildWordlistText(entriesScroller.entries, grouped);
  triggerDownload(text, exportFilename(ToolStack.getStack(), 'txt'));
  let msg = `Downloaded ${pluralize(count, 'entry', 'entries')}`;
  if (skipped) msg += ` (${pluralize(skipped, 'entry', 'entries')} skipped due to semicolons)`;
  showToast(msg);
}

// ── CSV ──

// #region nodetest:export
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// #endregion nodetest:export
function csvRow(cells) { return cells.map(csvCell).join(','); }

function buildCSVText(rows, grouped, stack) {
  const atomCount = currentContentAtomCount(stack);
  const isMulti = atomCount > 1;
  const groupCols = grouped ? activeGroupColumns(stack) : [];

  const header = [];
  if (grouped) header.push('group_key', 'count');
  for (const col of groupCols) header.push(col.key);
  if (isMulti) header.push('min_score', 'max_score');
  if (atomCount === 1) {
    header.push('entry', 'length', 'score');
    if (!grouped) header.push('comment', 'source');
  } else {
    for (let i = 1; i <= atomCount; i++) {
      header.push(`entry_${i}`, `length_${i}`, `score_${i}`);
      if (!grouped) header.push(`comment_${i}`, `source_${i}`);
    }
  }

  const out = [csvRow(header)];
  for (const { group, chain } of iterDisplayChains(rows, grouped)) {
    const content = chainContentEntries(chain);
    const cells = [];
    if (grouped) {
      cells.push(group.key, group.chains.length);
      for (const col of groupCols) cells.push(col.value(group));
    }
    if (isMulti) {
      let mn = Infinity, mx = -Infinity;
      for (const wlE of content) { if (wlE.score < mn) mn = wlE.score; if (wlE.score > mx) mx = wlE.score; }
      cells.push(mn, mx);
    }
    for (let i = 0; i < atomCount; i++) {
      const wlE = content[i];
      if (!wlE) {
        cells.push('', '', '');
        if (!grouped) cells.push('', '');
      } else {
        cells.push(displayOf(wlE), wlE.norm.length, wlE.score);
        if (!grouped) cells.push(wlE.comment || '', wlE.wordlist?.name ?? '');
      }
    }
    out.push(csvRow(cells));
  }
  return out.join('\r\n') + '\r\n';
}

async function exportCSV() {
  if (!entriesScroller) return;
  const grouped = entriesScroller.sortTier === 'group';
  const text = buildCSVText(entriesScroller.entries, grouped, ToolStack.getStack());
  triggerDownload(text, exportFilename(ToolStack.getStack(), 'csv'));
  const count = countExportEntries(entriesScroller.entries, grouped);
  showToast(`Downloaded ${pluralize(count, 'entry', 'entries')}`);
}

// ── JSON ──

function buildExportJSONObject(rows, grouped, stack) {
  const obj = { url: location.href, tools: exportToolsMetadata(stack) };
  const range = exportScoreRangeMetadata();
  if (range) obj.score_range = range;
  obj.sort = exportSortMetadata();
  const groupCols = grouped ? activeGroupColumns(stack) : [];

  function chainObj(chain, includeProvenance) {
    const entries = chainContentEntries(chain).map(wlE => {
      const e = { entry: displayOf(wlE), score: wlE.score };
      if (includeProvenance) {
        e.comment = wlE.comment || '';
        e.source = wlE.wordlist?.name ?? null;
      }
      return e;
    });
    return { entries };
  }

  if (grouped) {
    obj.groups = rows.map(g => {
      const out = { group_key: g.key };
      for (const col of groupCols) out[col.key] = col.value(g);
      out.chains = g.chains.map(c => chainObj(c, false));
      return out;
    });
  } else {
    obj.groups = [{ chains: rows.map(c => chainObj(c, true)) }];
  }
  return obj;
}

async function exportJSON() {
  if (!entriesScroller) return;
  const grouped = entriesScroller.sortTier === 'group';
  const obj = buildExportJSONObject(entriesScroller.entries, grouped, ToolStack.getStack());
  triggerDownload(JSON.stringify(obj, null, 2) + '\n', exportFilename(ToolStack.getStack(), 'json'));
  const count = countExportEntries(entriesScroller.entries, grouped);
  showToast(`Downloaded ${pluralize(count, 'entry', 'entries')}`);
}

// ─── Mutation helpers ─────────────────────────────────────────────────────────
//
// State mutations bundled with the right invalidation/persistence/cache bump,
// so call sites don't have to remember the sequence. Cosmetic changes write
// the signal and persist; the cosmetic effect handles repaint. Cache-affecting
// changes also call `repaintAfterCacheChange()` to bump `cacheVersion$` and
// let the render effect dispatch the right scroller update.
// `batchUpdate(fn)` coalesces multiple mutations: signal writes queue their
// subscribers, a single deferred `cacheVersion$` bump fires once at the end
// of the batch, and `persistMeta()` is deferred to one call at the end too.

let _batchDepth = 0;
let _cacheBumpPending = false;
let _persistPending = false;

function batchUpdate(fn) {
  // The persist/cache flush must run inside runBatched's fn, not after it, so it
  // lands before the signal queue drains — effects see the persisted/bumped state.
  runBatched(() => {
    _batchDepth++;
    try { fn(); }
    finally {
      _batchDepth--;
      if (_batchDepth === 0) {
        if (_persistPending) { _persistPending = false; _persistMetaNow(); }
        if (_cacheBumpPending) { _cacheBumpPending = false; bumpCacheVersion(); }
      }
    }
  });
}

function repaintAfterCacheChange() {
  if (_batchDepth > 0) { _cacheBumpPending = true; return; }
  bumpCacheVersion();
}

// Cosmetic setters: write the signal and persist. The cosmetic effect
// re-renders the list/dropdown/dialog and visible scroller rows; no explicit
// repaint call needed.
function setWordlistName(wordlist, name) {
  if (wordlist.name === name) return;
  wordlist.name = name;
  persistMeta();
}

function setWordlistIcon(wordlist, icon) {
  wordlist.icon = icon;
  persistMeta();
}

function setWordlistUrl(wordlist, url) {
  if ((wordlist.url ?? null) === (url ?? null)) return;
  wordlist.url = url;
  persistMeta();
}

function setWordlistPublisher(wordlist, publisherId) {
  const newVal = publisherId || null;
  if ((wordlist.publisherId ?? null) === newVal) return;
  wordlist.publisherId = newVal;
  // Defaults changed with the publisher — recompute dirty against the new
  // publisher's defaultRules (whether or not the caller is also updating
  // the rules in the same batchUpdate).
  updateWordlistDirty(wordlist);
  persistMeta();
}

// Cache-affecting setters: bump cacheVersion$ so the render effect refreshes
// derived state (merged cache, scroller).
function setWordlistEnabled(wordlist, enabled) {
  if (wordlist.enabled === enabled) return;
  wordlist.enabled = enabled;
  persistMeta();
  repaintAfterCacheChange();
}

function setWordlistRescoreRules(wordlist, rules) {
  wordlist.rescoreRules = rules;
  applyRescoreRulesChange(wordlist);
}

// For rescore-rule mutations done in place (splice/push). Caller has already
// mutated wordlist.rescoreRules; this clears derived caches and repaints. Stats
// and merged caches must clear too, since histograms now show rescored entries
// and the histogram layout depends on the union of every source's rescored set.
function applyRescoreRulesChange(wordlist) {
  compileRescoreRules(wordlist);
  updateWordlistDirty(wordlist);
  invalidateWordlistCaches(wordlist);
  persistMeta();
  MirrorSync.schedule(wordlist);
  repaintAfterCacheChange();
}

function reorderSources(fromIdx, toIdx) {
  if (fromIdx === toIdx ||
      fromIdx < 0 || toIdx < 0 ||
      fromIdx >= state.sources.length || toIdx >= state.sources.length) return;
  const [item] = state.sources.splice(fromIdx, 1);
  state.sources.splice(toIdx, 0, item);
  persistMeta();
  // The cache effect already covers the order change (refreshSourceCounts
  // rebuilds derived caches from state.sources). No separate sources$ bump
  // is needed — repaintAfterCacheChange routes through the render effect.
  repaintAfterCacheChange();
}

// ─── Test API ─────────────────────────────────────────────────────────────────
// Exposed on `window.__grawlixTest` for the Playwright smoke suite. Routes
// through real internal codepaths (applyWordlistText, setWordlistRescoreRules)
// so tests exercise the same plumbing the UI does. The surface is small and
// stable — adding to it is fine; renaming or repurposing existing helpers
// breaks the tests that depend on them.

const __grawlixTest = {
  // Add a populated custom wordlist (no publisherId). Entries are auto-named
  // WORD001, WORD002, … one per score. Goes through applyWordlistText so the
  // auto-seed path is exercised on import.
  async addCustomWordlist({ name, scores, entries, comments = [], enabled = true } = {}) {
    const text = scores.map((s, i) => {
      const entry = entries?.[i] ?? `WORD${String(i + 1).padStart(3, '0')}`;
      const comment = comments[i];
      return comment ? `${entry};${s};${comment}` : `${entry};${s}`;
    }).join('\n');
    const wordlist = addNewWordlist({
      dbKey: newDbKey(),
      icon: null,
      publisherId: null,
      name,
      url: null,
      enabled,
      populated: false,
    });
    await applyWordlistText(wordlist, text, {
      originalFilename: `${name}.txt`,
      source: name,
      silent: true,
    });
    // Drain the fire-and-forget refresh applyWordlistText's cache bump started,
    // else a following setStack aborts it mid-run and strands the scroller on
    // pre-filter rows — the webkit flake the single-read tool specs lose.
    await pipelineIdle();
    return wordlist.dbKey;
  },

  // Replace a wordlist's rescore rules via the proper helper. Rules are the
  // editor's shape: { input, length, output, note? }.
  setRescoreRules(name, rules) {
    const wl = this._lookup(name);
    setWordlistRescoreRules(wl, rules);
  },

  bakeRescoring(name) { return bakeRescoring(this._lookup(name)); },

  setUpdateAvailable(name, value) {
    const wl = this._lookup(name);
    wl._updateAvailable = !!value;
    renderSources();
    WordlistSelector.refresh();
  },

  // Reorder state.sources so `name` lands at `beforeName`'s position (and
  // `beforeName` shifts down). Routes through `reorderSources` so caches
  // invalidate the same way a drag does.
  moveBefore(name, beforeName) {
    const fromIdx = state.sources.findIndex(w => w.name === name);
    const toIdx   = state.sources.findIndex(w => w.name === beforeName);
    if (fromIdx < 0) throw new Error(`No wordlist named "${name}"`);
    if (toIdx   < 0) throw new Error(`No wordlist named "${beforeName}"`);
    reorderSources(fromIdx, toIdx);
  },

  // Read-only snapshot of the active corpus (All Wordlists by default, the scoped source
  // after setScope) for a single entry. The sourcing wordlist is user-
  // observable via the row's popover and via the `.atom-source` column, but
  // that column is hidden below a 960px viewport. Exposing it here lets merge-
  // correctness tests assert regardless of viewport width and without driving
  // the popover.
  getMergedEntry(entry, display) {
    const cache = getActiveCorpus();
    const m = display !== undefined ? cache.byKey.get(mergeKey(toNorm(entry), display)) : cache.byNorm.get(toNorm(entry));
    if (!m) return null;
    return { entry: m.norm, display: m.display, score: m.score, comment: m.comment, wordlist: m.wordlist.name };
  },

  // Pass a source name to scope, or 'All Wordlists'/nothing for the merged view.
  async setScope(name) {
    await setScope(!name || name === MERGED_NAME ? MERGED_ID : this._lookup(name));
  },

  // Stable, comparable dump of the merged cache: entries as ordered tuples
  // plus per-source counts (sorted by name so map-order noise can't fail a
  // comparison). Tests diff the live surgically-patched cache against a forced
  // full rebuild to prove the My Edits patch stays faithful.
  dumpMergedCache() {
    const c = buildMergedWordlist();
    return {
      entries: c.entries.map(e => [e.norm, e.display, e.score, e.comment, e.wordlist.name]),
      counts: c.sourceCounts.map(s => [s.wordlist.name, s.count]).sort((a, b) => a[0].localeCompare(b[0])),
    };
  },
  rebuildMergedCache() {
    invalidateSourceCounts();
    return this.dumpMergedCache();
  },

  // Stamp the live cache object; a My Edits edit must preserve the stamp
  // (in-place patch). A full rebuild — the regression we guard against —
  // discards the object and the stamp with it.
  markMergedCache(tag) { buildMergedWordlist()._testTag = tag; },
  mergedCacheTag() { return _mergedWordlistCache ? (_mergedWordlistCache._testTag ?? null) : null; },

  // Drive a My Edits upsert/rename through the real saveEdit path — the patch
  // under test — without the popover DOM, so the cache-consistency test can
  // apply many mutations without choreographing popovers across search changes.
  // origRaw === raw upserts; differing raw renames (a two-norm move).
  saveMyEdit(origRaw, raw, score, comment = '') {
    // Mirror openForCreate: a not-yet-present entry seeds a blank-score orig so
    // saveEdit treats it as a genuine add, not a no-op against an equal score.
    const orig = getActiveCorpus().byNorm.get(toNorm(origRaw)) || buildUserWlEntry(origRaw, '', '');
    saveEdit(orig, { raw, score, comment });
    return refreshMergedScroller();
  },
  deleteMyEdit(raw) {
    const m = getEditsWordlist().rawEntries.find(e => e.norm === toNorm(raw));
    if (m) deleteFromEdits({ norm: m.norm, display: displayOf(m) }, refreshMergedScroller);
  },

  setUnigramCorpus(freqs) {
    const entries = Object.entries(freqs);
    unigramLogFreqs = new Map(entries);
    unigramMinLogFreq = entries.length ? Math.min(...entries.map(([, lf]) => lf)) : -Infinity;
    unigramLoadPromise = null;
  },

  // Set the tool stack directly, bypassing gallery clicks. Routes
  // through the same path the URL parser uses (`ToolStack.setStack` +
  // `renderMergedDetail`), so tests exercise the executor with the
  // same plumbing the user does. Pass an array of `{tool, params}`.
  // Returns the render promise — tests `await` it before reading the DOM.
  async setStack(stack) {
    ToolStack.setStack(stack.filter(r => TOOLS[r.tool]).map(r => makeToolRow(r.tool, r.params || {}, !!r.grouped)));
    const p = renderMergedDetail();
    ToolStack.refreshGalleryActive();
    await p;
  },

  // Resolves when no pipeline run is in flight. Tests use this after keystroke
  // interactions (which fire-and-forget the refresh) before reading the DOM.
  pipelineIdle() { return pipelineIdle(); },

  // Resolves once init() has fully completed. gotoApp awaits this before the
  // test touches the UI, so init's boot tail can't reset the stack mid-test.
  whenReady() { return _ready; },

  // Visible scroller rows as user-meaningful strings. A single-word
  // row returns its entry string; a chain row returns the array of its
  // distinct atom entry strings (relation glyph stripped). Adjacent repeat
  // atoms — the same word stacked under several search highlights — collapse
  // to one, so the result describes the chain's distinct words. Reads from the
  // live DOM so assertions describe what's actually rendered. Awaits
  // pipelineIdle so an in-flight async refresh finishes first.
  async getVisibleEntries() {
    await pipelineIdle();
    const rows = document.querySelectorAll('#vs-host .entry-row');
    return [...rows].map(r => {
      const words = [];
      for (const atomEl of r.querySelectorAll('.atom')) {
        const entryEl = atomEl.querySelector('.atom-entry');
        const glyph = entryEl.querySelector('.atom-glyph');
        const full = entryEl.textContent || '';
        const word = glyph ? full.slice(glyph.textContent.length) : full;
        if (word !== words[words.length - 1]) words.push(word);
      }
      return words.length === 1 ? words[0] : words;
    });
  },

  async getVisibleGroups() {
    await pipelineIdle();
    const stripGlyph = el => {
      if (!el) return '';
      const glyph = el.querySelector('.atom-glyph');
      const full = el.textContent || '';
      return glyph ? full.slice(glyph.textContent.length) : full;
    };
    return [...document.querySelectorAll('#vs-host .group-row')].map(row => {
      const anchorAtom = row.querySelector('.group-anchor .atom[data-atom-role="anchor"]');
      const anchor = anchorAtom ? {
        entry: stripGlyph(anchorAtom.querySelector('.atom-entry')),
        score: parseInt(anchorAtom.querySelector('.score-badge')?.textContent || '', 10),
      } : null;
      return {
        count: parseInt(row.querySelector('.group-count')?.textContent || '', 10),
        anchor,
        chains: [...row.querySelectorAll('.group-chain')].map(chainEl =>
          [...chainEl.querySelectorAll('.atom .atom-entry')].map(stripGlyph)
        ),
      };
    });
  },

  // Read-only snapshot for assertions. Returns the fields the smoke suite
  // looks at; not a full wordlist dump.
  getWordlist(name) {
    const wl = state.sources.find(w => w.name === name);
    if (!wl) return null;
    return {
      name: wl.name,
      publisherId: wl.publisherId,
      enabled: wl.enabled,
      populated: wl.populated,
      entries: wl.rawEntries.map(e => ({ entry: e.norm, display: e.display, score: e.score, comment: e.comment || '' })),
      rescoreRules: wl.rescoreRules.map(r => ({ input: r.input, length: r.length || '', output: r.output })),
      dirty: !!wl.dirty,
      updateAvailable: !!wl._updateAvailable,
    };
  },

  async exportText(format) {
    await pipelineIdle();
    const rows = entriesScroller.entries;
    const grouped = entriesScroller.sortTier === 'group';
    const stack = ToolStack.getStack();
    if (format === 'copy')     return buildCopyText(rows, grouped, stack);
    if (format === 'wordlist') return buildWordlistText(rows, grouped);
    if (format === 'csv')      return buildCSVText(rows, grouped, stack);
    if (format === 'json')     return buildExportJSONObject(rows, grouped, stack);
    throw new Error(`Unknown export format: ${format}`);
  },

  exportFilename(ext) {
    return exportFilename(ToolStack.getStack(), ext);
  },

  sync: {
    merge3(base, file, idb) {
      const { resolved, conflicts } = threeWayMergeEdits(parseWordlist(base), parseWordlist(file), parseWordlist(idb));
      const dump = e => ({ entry: e.norm, display: e.display, score: e.score, comment: e.comment || '' });
      return {
        resolved: [...resolved.values()].map(dump).sort((a, b) => a.entry.localeCompare(b.entry)),
        conflicts: conflicts.map(c => ({ norm: c.norm, device: c.device ? dump(c.device) : null, file: c.file ? dump(c.file) : null })),
      };
    },
    _list(name) { return name === MERGED_NAME ? MERGED_ID : state.sources.find(w => w.name === name); },
    attachMirror(name, opts) { return attachMirrorSync(this._list(name), opts); },
    attachEditsExisting() { return attachEditsSync({ existing: true }); },
    attachEditsNew() { return attachEditsSync({ existing: false }); },
    reconcileEdits() { return EditsSync.reconcile(); },
    tickEdits() { return EditsSync._tick(); },
    isSynced(name) { return syncTargets.has(syncKey(this._list(name))); },
    filename(name) { return syncFilename(syncKey(this._list(name))); },
    async flushWrites() {
      for (const [key, id] of [...MirrorSync._timers]) { clearTimeout(id); MirrorSync._timers.delete(key); await MirrorSync._flush(key); }
      if (EditsSync._writeTimer) { clearTimeout(EditsSync._writeTimer); EditsSync._writeTimer = null; await EditsSync._flushWrite(); }
    },
  },

  _lookup(name) {
    const wl = state.sources.find(w => w.name === name);
    if (!wl) throw new Error(`No wordlist named "${name}"`);
    return wl;
  },

  migrateSettings,
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Two callers reach module-scoped names through `window`, which can't see this
// module's private scope: inline on*= handlers in generated HTML, and the
// Playwright suite's page.evaluate bodies. Expose the names both depend on.
function exposeWindowGlobals() {
  Object.assign(window, {
    WordlistActions, SyncDialog, AppView,
    toggleSplitMenu, startNoteEdit, onRuleInput, onHistogramPointerDown,
    saveRuleField, deleteRule, addRule, resetRescoreRules, neutralizeRescoreRules,
    saveScoringField, deleteScoringRow, addScoringRow, resetScoringRules,
    exportCopy, exportWordlist, exportCSV, exportJSON,
    state, Router, ToolStack, SettingsDialog, Storage, TOOLS,
    getOutputFormat, setOutputFormat, persistMeta, persistEdits, buildMergedWordlist,
    downloadSourceWordlist, downloadOriginalWordlist, checkForUpdates, saveEdit,
    serializeEntries, buildWordlistText, applyWordlistText, renderMergedDetail,
    getEditsWordlist,
  });
  window.__grawlixTest = __grawlixTest;
  // `_db` is reassigned after openDB() resolves; a static copy would freeze at its
  // boot-time null, so the suite (which polls `_db !== null`) needs a live read.
  Object.defineProperty(window, '_db', { get: () => _db, configurable: true });
}

function mountSplitMenuDismiss() {
  document.addEventListener('click', () => document.querySelectorAll('.split-btn.open').forEach(b => b.classList.remove('open')));
}

// Hide the splash screen immediately if no wordlists have data. (When data
// exists, init's reconnect/fade path retires it instead.)
function maybeRemoveSplashEarly() {
  const meta = Storage.readMeta() || [];
  if (!meta.some(l => l.lastUpdated)) document.getElementById('splash-screen')?.remove();
}

// Module evaluation only *defines*; the side effects run here. The order is a
// load-bearing contract — a wrong order surfaces as a runtime error, not the
// hoisting non-issue it was when these ran as stray top-level statements.
function boot() {
  // Window exposure first: components below render HTML with inline on*= handlers
  // that resolve through `window`, and the Playwright bridge polls `window._db`.
  exposeWindowGlobals();

  // Document-level / pure wiring — no dependency on the app-shell DOM existing.
  mountGroupColumnStyle();
  mountClearableInputs();
  mountHistogramPointer();
  mountSplitMenuDismiss();

  // Dialog/overlay singletons append to <body>. showConfirm must exist before
  // init() (init's migration path calls it); the rest before any UI opens them.
  SettingsDialog.mount();
  WelcomeDialog.mount();
  showEditsConflict.mount();
  showConfirm.mount();
  showAlert.mount();
  showMergeConflict.mount();
  openUpdateSummaryDialog.mount();
  SyncDialog.mount();
  ConfigureWordlistDialog.mount();
  ImportGuideDialog.mount();
  GroupMorePopover.mount();

  // App-shell components must exist before init()'s renderAll: the render
  // effect's first run calls WordlistSelector.refresh() + DiscoveryBanner.refresh()
  // and renders the panel (whose sticky observer watches #wordlist-bar).
  WordlistSelector.mount();
  ManagePanel.mount();
  DiscoveryBanner.mount();
  ToolPicker.mount();

  mountStatsBarOverflowObservers();
  mountHeaderHeightObserver();

  maybeRemoveSplashEarly();
  init();
}

boot();
