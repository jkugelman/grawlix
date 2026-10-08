'use strict';

// ─── Manage wordlists panel ─────────────────────────────────────────────────

import { esc, pluralize } from '../core/util.js';
import { effect } from '../core/signals.js';
import { state, cacheVersion$, configSummary$ } from '../data/state.js';
import { persistMeta, batchUpdate, repaintAfterCacheChange } from '../data/persist.js';
import { sourceTotal } from '../data/merge.js';
import { getMergeMode, setMergeMode } from '../data/serialize.js';
import { getWordlistIcon } from './icons.js';
import { makeReorderable, buildMoreMenuHTML, buildTrashIconHTML, closeMenus, buildChoiceArrowHTML, toggleChoiceMenu } from './components.js';
import { createDialog, showDialog } from './dialogs/dialog.js';
import { ConfigureWordlistDialog } from './dialogs/configure-wordlist.js';
import { buildWordlistCardHTML } from './scope-selector.js';

// deleteWordlist lives upward (app/actions.js); injected so this view imports
// nothing above ui.
let _deleteWordlist = async () => false;

export function configureManagePanel({ deleteWordlist }) {
  if (deleteWordlist) _deleteWordlist = deleteWordlist;
}

const MERGE_MODES = [
  { value: 'first',   label: 'First wins' },
  { value: 'highest', label: 'Highest score wins' },
  { value: 'lowest',  label: 'Lowest score wins' },
];

export const ManagePanel = (() => {
  let el, listEl, applyBtn, addRow, modeEl;
  let shadow = null;

  function rowHTML(wl) {
    // Added-while-open lists are absent from shadow.enabled by design; falling
    // back to live wl.enabled keeps their async force-enable from reading as a
    // staged disable here, in isDirty, and in apply.
    const enabled = shadow.enabled.get(wl) ?? wl.enabled;
    const total = sourceTotal(wl);
    const pinned = wl.type === 'edits';
    return buildWordlistCardHTML(
      getWordlistIcon(wl),
      wl.name,
      total == null ? '…' : pluralize(total, 'entry', 'entries'),
      { enabled, populated: wl.populated, pinned, extraActions: pinned ? '' : rowMenuHTML(wl) },
    );
  }

  function rowMenuHTML(wl) {
    return buildMoreMenuHTML([
      ['Configure', '', { className: 'manage-row-configure', icon: '<svg aria-hidden="true"><use href="#icon-settings"/></svg>' }],
      ['Delete',    '', { className: 'manage-row-delete',    icon: buildTrashIconHTML() }],
    ], { className: 'manage-row-kebab', title: `More options for ${esc(wl.name)}` });
  }

  function renderMode() {
    modeEl.querySelector('.choice-label').textContent = MERGE_MODES.find(m => m.value === shadow.mergeMode).label;
    modeEl.querySelector('.manage-merge-note').classList.toggle('off', shadow.mergeMode === 'first');
  }

  function render() {
    closeMenus();
    listEl.innerHTML = shadow.order.map(rowHTML).join('');
    listEl.querySelectorAll('.wordlist-card').forEach((cardEl, i) => { cardEl._wordlist = shadow.order[i]; });
    syncApplyDisabled();
  }

  function absorb() {
    let grew = false;
    for (const wl of state.sources) {
      // Stays out of shadow.enabled on purpose — see rowHTML's fallback note.
      if (!shadow.order.includes(wl)) { shadow.order.push(wl); grew = true; }
    }
    if (grew) render();
  }

  function prune(wl) {
    shadow.order = shadow.order.filter(w => w !== wl);
    shadow.enabled.delete(wl);
    render();
  }

  function isDirty() {
    if (shadow.mergeMode !== getMergeMode()) return true;
    if (shadow.order.length !== state.sources.length) return true;
    if (shadow.order.some((wl, i) => wl !== state.sources[i])) return true;
    return shadow.order.some(wl => (shadow.enabled.get(wl) ?? wl.enabled) !== wl.enabled);
  }

  function syncApplyDisabled() {
    applyBtn.disabled = !isDirty();
  }

  function apply() {
    if (isDirty()) {
      batchUpdate(() => {
        state.sources.splice(0, state.sources.length, ...shadow.order);
        for (const wl of state.sources) wl.enabled = shadow.enabled.get(wl) ?? wl.enabled;
        setMergeMode(shadow.mergeMode);
        persistMeta();
        repaintAfterCacheChange();
      });
    }
    el.close();
  }

  function mount() {
    let body;
    ({ el, body } = createDialog('manage-dialog', { labelledby: 'manage-dialog-title', isDirty: () => !!shadow && isDirty() }));
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="manage-dialog-title">Manage wordlists</h2>
      <div class="manage-merge">
        <div class="dialog-row">
          <span class="dialog-row-label">When lists share an entry</span>
          <span class="tool-row-param tool-row-match manage-merge-choice"><span class="match-mode-toggle choice-label"></span>${buildChoiceArrowHTML('Change merge mode')}</span>
        </div>
        <div class="dialog-row-sub manage-merge-note">(My Edits always wins)</div>
      </div>
      <div class="manage-list"></div>
      <button type="button" class="manage-add-row"><span class="add-wordlist-icon">＋</span>Add wordlist</button>
      <div class="dialog-footer">
        <button type="button" class="manage-cancel-btn dialog-cancel-btn">Cancel</button>
        <button type="button" class="manage-apply-btn primary">Save</button>
      </div>`;

    listEl   = el.querySelector('.manage-list');
    applyBtn = el.querySelector('.manage-apply-btn');
    addRow   = el.querySelector('.manage-add-row');
    modeEl   = el.querySelector('.manage-merge');

    modeEl.querySelector('.manage-merge-choice').addEventListener('click', e => {
      e.stopPropagation();
      toggleChoiceMenu(modeEl.querySelector('.choice-arrow'), {
        choices: MERGE_MODES, current: shadow.mergeMode, anchor: e.currentTarget,
        onPick: mode => { shadow.mergeMode = mode; renderMode(); syncApplyDisabled(); },
      });
    });

    listEl.addEventListener('change', e => {
      const input = e.target.closest('.toggle input[type="checkbox"]');
      if (!input) return;
      const card = input.closest('.wordlist-card');
      // Must write the shadow map, never wl.enabled: touching wl.enabled here would
      // silently mutate canonical state and rebuild the merge mid-staging, defeating
      // the Apply gate while looking identical on screen.
      shadow.enabled.set(card._wordlist, input.checked);
      card.classList.toggle('disabled', !input.checked);
      syncApplyDisabled();
    });

    // Stage into shadow.order, never reorderSources: that canonical path would
    // rebuild the merge mid-staging and defeat the Apply gate, looking identical
    // on screen — the same trap as the enable toggle above.
    makeReorderable(listEl, {
      handleSelector: '.drag-handle:not([aria-hidden])',
      itemSelector:   '.wordlist-card',
      canDrop: (fromEl, beforeEl) => beforeEl?._wordlist.type !== 'edits',
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

    listEl.addEventListener('click', async e => {
      const item = e.target.closest('.manage-row-configure, .manage-row-delete');
      if (!item) return;
      const wl = item.closest('.wordlist-card')._wordlist;
      if (item.classList.contains('manage-row-configure')) {
        ConfigureWordlistDialog.open(wl, () => { if (shadow) render(); });
      } else if (await _deleteWordlist(wl) && shadow) {
        prune(wl);
      }
    });
    el.addEventListener('close', closeMenus);

    addRow.addEventListener('click', () => ConfigureWordlistDialog.openAdd(absorb));

    // Self-gates on shadow rather than subscribing only while open: the signals
    // lib has no teardown, so this lifelong effect must no-op when closed.
    effect(() => {
      cacheVersion$.get();
      configSummary$.get();   // a fetch content-diff bumps this, not cacheVersion$, but still changes the per-row entry count
      if (shadow) { absorb(); render(); }
    });
  }

  function open() {
    shadow = {
      order: [...state.sources],
      enabled: new Map(state.sources.map(wl => [wl, wl.enabled])),
      mergeMode: getMergeMode(),
    };
    renderMode();
    render();
    showDialog(el, () => { shadow = null; });
  }

  return { mount, open };
})();
