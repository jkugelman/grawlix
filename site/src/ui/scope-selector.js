'use strict';

// ─── Scope selector ─────────────────────────────────────────────────────────
// The scope dropdown + wordlist bar + inline editor slot. Pure-scope: clicking
// a row drives setScope. Enable/disable toggling stays out of here on purpose —
// it lives in the manage panel.

import { MERGED_ID, MERGED_NAME } from '../core/constants.js';
import { esc, pluralize, timeAgo } from '../core/util.js';
import { state } from '../data/state.js';
import { mergedEntryCount, getSourceCounts, sourceTotal } from '../data/merge.js';
import { getWordlistIcon, getMergedIcon } from './icons.js';
import {
  buildBadgeHTML, buildDragHandleHTML, buildSplitBtn, buildMoreMenuHTML,
} from './components.js';
import {
  syncSignHTML, wordlistSeverity, sourcesSeverity, severityTitle,
} from './sync-indicators.js';
import {
  buildRescoreSectionHTML, buildScoringSectionHTML,
  beginEdit, discardDraft, isDraftDirty, draftScope, wireDraftReorder,
} from './rescore-editor.js';
import { showConfirm } from './dialogs/confirm.js';
import { ManagePanel } from './manage-panel.js';
import { setScope, refreshMergedScroller, getEntriesScroller, attachHelpPopups } from './rendering.js';

// ─── Wordlist-card domain builders ──────────────────────────────────────────

export function buildWordlistCardHTML(icon, name, meta, opts = {}) {
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
export function buildMergedCardHTML(selected) {
  const meta = pluralize(mergedEntryCount(), 'entry', 'entries');
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

export function buildWordlistNameHTML(wordlist, { bold = true } = {}) {
  const text = esc(wordlist === MERGED_ID ? MERGED_NAME : wordlist.name);
  return bold ? `<strong>${text}</strong>` : text;
}

export function buildWordlistNameIconHTML(wordlist, { bold = true } = {}) {
  const icon = wordlist === MERGED_ID ? getMergedIcon() : getWordlistIcon(wordlist);
  const name = buildWordlistNameHTML(wordlist, { bold });
  // The trailing space inside the span is load-bearing: combined with `white-space: nowrap` on
  // .wordlist-name-icon, it keeps the icon glued to the first word of the name. Move it outside
  // the span and the icon can orphan at a line end.
  return `<span class="wordlist-name-icon">${icon} </span>${name}`;
}

function wordlistCardMeta(wordlist, contribMap) {
  const total = sourceTotal(wordlist);
  if (total == null) return '…';
  if (!total) return 'No data';
  if (!wordlist.enabled) return pluralize(total, 'entry', 'entries');
  const used = contribMap.get(wordlist) ?? 0;
  return used === total
    ? `${pluralize(used, 'entry', 'entries')} used`
    : `${used.toLocaleString()} of ${pluralize(total, 'entry', 'entries')} used`;
}

// ─── Sync indicators ──────────────────────────────────────────────────────────
// Relocated here (vs. sync-indicators.js, which holds the severity/sign
// builders) because it calls WordlistSelector.refreshSyncSign — breaking the
// cycle one-directionally: scope-selector → sync-indicators.

export function renderSyncIndicators() {
  WordlistSelector.refreshSyncSign?.();
}

export const WordlistSelector = (() => {
  let bar, root, appEl, trigger, menu, actions, dlSlot, rescoreSlot, kebabSlot;
  let editor, editorInner;
  let editorOpen = false;
  let triggerMax = 0;

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
      const dis = mergedEntryCount() === 0 ? ' disabled' : '';
      return `<button id="download-btn"${dis} title="Download the merged wordlist" onclick="WordlistActions.action('download')">Download</button>`;
    }
    if (!sourceTotal(scope)) {
      return `<button id="download-btn" disabled title="Download this wordlist" onclick="WordlistActions.action('download')">Download</button>`;
    }
    const hasRules = (scope.rescoreRules?.length ?? 0) > 0;
    return hasRules
      ? buildSplitBtn('Download', `WordlistActions.action('download')`,
          [['Download rescored', `WordlistActions.action('download')`],
           ['Download original', `WordlistActions.action('downloadOriginal')`]], { id: 'download-btn', title: 'Download this wordlist (rescored)' })
      : `<button id="download-btn" title="Download this wordlist" onclick="WordlistActions.action('download')">Download</button>`;
  }

  function downloadMenuItems(scope) {
    if (!sourceTotal(scope)) return [['Download', `WordlistActions.action('download')`, { disabled: true }]];
    const hasRules = (scope.rescoreRules?.length ?? 0) > 0;
    return hasRules
      ? [['Download rescored', `WordlistActions.action('download')`],
         ['Download original',  `WordlistActions.action('downloadOriginal')`]]
      : [['Download', `WordlistActions.action('download')`]];
  }

  function rescoreLabel() { return state.selected === MERGED_ID ? 'Scoring' : 'Rescoring'; }
  function rescoreBtnHTML() {
    return `<button type="button" class="rescore-toggle" aria-expanded="${editorOpen}" aria-controls="rescore-editor" title="${editorLabel()}">${rescoreLabel()}<svg class="rescore-chevron" width="8" height="5" aria-hidden="true"><use href="#icon-arrow"/></svg></button>`;
  }

  function kebabHTML(level) {
    const scope = state.selected;
    if (scope === MERGED_ID) return '';
    const folded = [];
    if (level >= 2) folded.push([rescoreLabel(), `WordlistActions.action('rescore')`]);
    if (level >= 1) folded.push(...downloadMenuItems(scope));
    let base;
    if (scope.type === 'edits') {
      base = [
        ['Import', `WordlistActions.action('import')`],
        ['Clear',  `WordlistActions.action('clear')`],
      ];
    } else {
      const fetchItems = scope.url
        ? [['Fetch', `WordlistActions.action('fetch')`], ['Import', `WordlistActions.action('import')`]]
        : [['Import', `WordlistActions.action('import')`]];
      base = [
        ...fetchItems,
        ['Configure', `WordlistActions.action('configure')`],
      ];
    }
    return buildMoreMenuHTML([...folded, ...base], { className: 'wls-kebab' });
  }

  let _dateTimer = null;
  function renderActions(level) {
    if (_dateTimer) { clearInterval(_dateTimer); _dateTimer = null; }
    const scope = state.selected;
    const hasDate = scope !== MERGED_ID && scope.type !== 'edits' && sourceTotal(scope) && scope.lastUpdated;
    const dateSlot = hasDate ? '<span class="detail-date"></span>' : '';
    dlSlot.innerHTML = `${dateSlot}${syncSignHTML(scope)}${level === 0 ? downloadBtnHTML() : ''}`;
    rescoreSlot.innerHTML = level < 2 ? rescoreBtnHTML() : '';
    kebabSlot.innerHTML = kebabHTML(level);
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

  let _fitWidth = -1;
  // Fold while the name is ellipsized — but stop at the trigger's max-width: a
  // name longer than the cap stays ellipsized, so folding the row can't help it.
  function nameSqueezed() {
    const label = trigger.querySelector('.wls-trigger-label');
    return label.scrollWidth > label.clientWidth + 1 && root.offsetWidth < triggerMax - 1;
  }
  function fitActions(force = false) {
    const w = appEl.clientWidth;
    if (!force && w === _fitWidth) return;
    _fitWidth = w;
    renderActions(0);
    const max = w > 0 && state.selected !== MERGED_ID ? 2 : 0;
    let level = 0;
    while (level < max && nameSqueezed()) renderActions(++level);
  }

  // In-place patch, never a full renderActions: sync status flips on every
  // debounced save, and rebuilding the action row mid-edit would steal focus
  // and scroll.
  function refreshSyncSign() {
    const cur = dlSlot.querySelector('#sync-sign');
    if (cur) cur.outerHTML = syncSignHTML(state.selected);
  }

  function optionHTML(scope, contribMap) {
    const selected = scope === state.selected;
    if (scope === MERGED_ID) {
      return buildWordlistCardHTML(getMergedIcon(), MERGED_NAME,
        pluralize(mergedEntryCount(), 'entry', 'entries'),
        { draggable: false, toggle: false, selected });
    }
    const severity = wordlistSeverity(scope);
    return buildWordlistCardHTML(getWordlistIcon(scope), scope.name,
      wordlistCardMeta(scope, contribMap),
      { draggable: false, toggle: false, selected, enabled: scope.enabled, populated: scope.populated,
        severity, severityTitle: severityTitle(severity) });
  }

  function buildContribMap() {
    return new Map(getSourceCounts().map(s => [s.wordlist, s.count]));
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
  function setToggleExpanded(open) {
    rescoreSlot.querySelector('.rescore-toggle')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function toggleEditor() { editorOpen ? attemptCloseEditor() : expandEditor(); }
  function renderEditorContent() {
    if (!editorOpen) return;
    editorInner.innerHTML = state.selected === MERGED_ID
      ? buildScoringSectionHTML()
      : buildRescoreSectionHTML();
    wireDraftReorder();
    attachHelpPopups();
  }
  function refreshEditor() {
    if (!editorOpen) return;
    if (draftScope() !== state.selected) beginEdit(state.selected);
    renderEditorContent();
  }
  // Like refreshEditor but reseeds the draft even when the scope is unchanged —
  // for when committed rules are rewritten under an open editor (baking resets
  // them), which refreshEditor's scope guard would otherwise leave stale.
  function reseedEditor() {
    if (!editorOpen) return;
    beginEdit(state.selected);
    renderEditorContent();
  }
  function expandEditor() {
    editorOpen = true;
    setToggleExpanded(true);
    beginEdit(state.selected);
    // Unhide before flipping .rescore-open so the grid-rows transition runs
    // from 0fr; toggling both in one frame would skip the animation.
    editor.hidden = false;
    renderEditorContent();
    requestAnimationFrame(() => bar.classList.add('rescore-open'));
    // The raw → rescored preview lives in the scroller rows, gated on the
    // editor's open state, so toggling it must repaint the table.
    if (getEntriesScroller()) refreshMergedScroller();
  }
  function collapseEditor() {
    if (!editorOpen) return;
    editorOpen = false;
    setToggleExpanded(false);
    bar.classList.remove('rescore-open');
    hideAfterCollapse();
    if (getEntriesScroller()) refreshMergedScroller();
  }
  async function attemptCloseEditor() {
    if (isDraftDirty() && !await showConfirm('Discard your changes?', { confirmText: 'Discard' })) return;
    discardDraft();
    collapseEditor();
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
    fitActions(true);
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
          <button type="button" class="wls-trigger bar-headline" aria-haspopup="listbox" aria-expanded="false">
            <span class="wls-trigger-icon"></span>
            <span class="wls-trigger-label"></span>
            <span class="wls-trigger-badge"></span>
            <svg class="wls-trigger-chevron" width="10" height="6" aria-hidden="true"><use href="#icon-arrow"/></svg>
          </button>
          <div class="wls-menu" role="listbox" tabindex="-1"></div>
        </div>
        <div class="wls-actions">
          <span class="wls-dl-slot"></span>
          <span class="wls-rescore-slot"></span>
          <span class="wls-kebab-slot"></span>
        </div>
      </div>
      <div id="rescore-editor" hidden><div class="rescore-editor-inner"></div></div>`;
    document.getElementById('app').prepend(bar);

    root    = bar.querySelector('.wls');
    appEl   = document.getElementById('app');
    trigger = bar.querySelector('.wls-trigger');
    triggerMax = parseFloat(getComputedStyle(trigger).maxWidth);
    menu    = bar.querySelector('.wls-menu');
    actions = bar.querySelector('.wls-actions');
    dlSlot      = bar.querySelector('.wls-dl-slot');
    rescoreSlot = bar.querySelector('.wls-rescore-slot');
    kebabSlot   = bar.querySelector('.wls-kebab-slot');

    // The editor must stay inside #wordlist-bar: the sticky
    // ResizeObserver watches the bar and cascades the table's offset from its
    // height, so an editor mounted elsewhere would expand under the pinned
    // headers instead of pushing them down.
    editor       = bar.querySelector('#rescore-editor');
    editorInner  = editor.querySelector('.rescore-editor-inner');

    trigger.addEventListener('click', () => root.classList.contains('open') ? close() : open());
    menu.addEventListener('click', async e => {
      if (e.target.closest('.wls-configure-footer')) {
        close();
        ManagePanel.open();
        return;
      }
      const opt = e.target.closest('.wordlist-card');
      if (!opt) return;
      if (opt._scope !== state.selected && editorOpen && isDraftDirty()) {
        if (!await showConfirm('Discard your changes?', { confirmText: 'Discard' })) return;
        discardDraft();
      }
      close();
      setScope(opt._scope);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    // Delegated so the rescore toggle survives renderActions re-rendering it at a
    // different fold level (it can be an inline button or, deepest, a kebab item).
    actions.addEventListener('click', e => { if (e.target.closest('.rescore-toggle')) toggleEditor(); });
    new ResizeObserver(() => fitActions()).observe(appEl);

    renderTrigger();
  }

  return { mount, refresh, refreshEditor, reseedEditor, refreshSyncSign, refreshMeta, toggleEditor, isEditorOpen: () => editorOpen, collapseEditor };
})();
