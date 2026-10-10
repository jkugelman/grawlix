'use strict';

// ─── Scope selector ─────────────────────────────────────────────────────────
// The scope dropdown + wordlist bar. Pure-scope: clicking
// a row drives setScope. Enable/disable toggling stays out of here on purpose —
// it lives in the manage panel.

import { MERGED_ID, MERGED_NAME } from '../core/constants.js';
import { esc, pluralize, timeAgo } from '../core/util.js';
import { state } from '../data/state.js';
import { mergedEntryCount, getSourceCounts, sourceTotal } from '../data/merge.js';
import { getWordlistIcon, getMergedIcon } from './icons.js';
import {
  buildBadgeHTML, buildDragHandleHTML, buildSplitBtn, buildMoreMenuHTML, afterTransition,
} from './components.js';
import {
  syncSignHTML, syncBusyKey, setSyncBusy, applySyncBusy,
  wordlistSeverity, sourcesSeverity, severityTitle,
} from './sync-indicators.js';
import { ManagePanel } from './manage-panel.js';
import { setScope } from './rendering.js';

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
    pinned        = false,
    extraActions  = '',
  } = opts;

  const classes = ['wordlist-card'];
  if (selected)   classes.push('selected');
  if (!enabled)   classes.push('disabled');
  if (!populated) classes.push('no-data');

  const dragHandle = pinned ? buildDragHandleHTML({ hidden: true }) : draggable ? buildDragHandleHTML() : '';

  const badge = buildBadgeHTML(severity, { title: severityTitle });

  const cardInfo = `<div class="card-info">
      <div class="card-name-row"><div class="card-name">${esc(name)}</div>${badge}</div>
      <div class="card-meta">${meta}</div>
    </div>`;

  const toggleTitle = !populated ? 'Click to import'
    : enabled ? 'Enabled — click to disable' : 'Disabled — click to enable';
  const toggleHTML = toggle && !pinned ? `
    <label class="toggle" title="${toggleTitle}" aria-label="Toggle ${esc(name)}">
      <input type="checkbox"${populated && enabled ? ' checked' : ''}${populated ? '' : ' disabled'}>
      <span class="toggle-slider"></span>
    </label>` : '';
  const cardActions = toggleHTML || extraActions
    ? `<div class="card-actions">${toggleHTML}${extraActions}</div>` : '';

  return `<div class="${classes.join(' ')}" data-wordlist tabindex="0" role="option">${dragHandle}${icon}${cardInfo}${cardActions}</div>`;
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
  setSyncBusy(syncBusyKey());
  WordlistSelector.refreshSyncSign?.();
}

export const WordlistSelector = (() => {
  let bar, root, appEl, trigger, menu, actions, dlSlot, kebabSlot;
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
    if (scope === MERGED_ID) return [['Download', `WordlistActions.action('download')`, { disabled: mergedEntryCount() === 0 }]];
    if (!sourceTotal(scope)) return [['Download', `WordlistActions.action('download')`, { disabled: true }]];
    const hasRules = (scope.rescoreRules?.length ?? 0) > 0;
    return hasRules
      ? [['Download rescored', `WordlistActions.action('download')`],
         ['Download original',  `WordlistActions.action('downloadOriginal')`]]
      : [['Download', `WordlistActions.action('download')`]];
  }

  function kebabHTML(level) {
    const scope = state.selected;
    const folded = level >= 1 ? downloadMenuItems(scope) : [];
    let base;
    if (scope === MERGED_ID) {
      base = [['Scoring tiers…', `WordlistActions.action('rescore')`]];
    } else if (scope.type === 'edits') {
      base = [
        ['Import', `WordlistActions.action('import')`],
        ['Clear',  `WordlistActions.action('clear')`],
        ['Rescoring rules…', `WordlistActions.action('rescore')`],
      ];
    } else {
      base = [
        ...(scope.url ? [['Fetch', `WordlistActions.action('fetch')`]] : []),
        ['Import', `WordlistActions.action('import')`],
        ['Rescoring rules…', `WordlistActions.action('rescore')`],
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
    const signHTML = syncSignHTML(scope);
    dlSlot.innerHTML = `${dateSlot}${signHTML}${level === 0 ? downloadBtnHTML() : ''}`;
    stampSyncSign(signHTML);
    setSyncBusy(syncBusyKey());
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
    const max = w > 0 ? 1 : 0;
    let level = 0;
    while (level < max && nameSqueezed()) renderActions(++level);
  }

  function stampSyncSign(html) {
    const el = dlSlot.querySelector('#sync-sign');
    if (el) el._syncHTML = html;
    applySyncBusy();
  }

  // In-place patch, never a full renderActions: sync status flips on every
  // debounced save, and rebuilding the action row mid-edit would steal focus
  // and scroll. The equality gate narrows that further — writing→synced leaves
  // the label identical, and replacing the node would restart the saving ring.
  function refreshSyncSign() {
    const cur = dlSlot.querySelector('#sync-sign');
    if (!cur) return;
    const html = syncSignHTML(state.selected);
    if (cur._syncHTML === html) { applySyncBusy(); return; }
    cur.outerHTML = html;
    stampSyncSign(html);
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

  function refresh() {
    renderTrigger();
    fitActions(true);
    if (root.classList.contains('open')) renderMenu();
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
          <span class="wls-kebab-slot"></span>
        </div>
      </div>`;
    document.getElementById('app').prepend(bar);

    root    = bar.querySelector('.wls');
    appEl   = document.getElementById('app');
    trigger = bar.querySelector('.wls-trigger');
    triggerMax = parseFloat(getComputedStyle(trigger).maxWidth);
    menu    = bar.querySelector('.wls-menu');
    actions = bar.querySelector('.wls-actions');
    dlSlot    = bar.querySelector('.wls-dl-slot');
    kebabSlot = bar.querySelector('.wls-kebab-slot');

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
    new ResizeObserver(() => fitActions()).observe(appEl);

    renderTrigger();
  }

  return { mount, refresh, refreshSyncSign, refreshMeta };
})();
