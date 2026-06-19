'use strict';

// ─── Manage wordlists panel ─────────────────────────────────────────────────

import { pluralize } from '../core/util.js';
import { effect } from '../core/signals.js';
import { state, cacheVersion$, configSummary$ } from '../data/state.js';
import { persistMeta, batchUpdate, repaintAfterCacheChange } from '../data/persist.js';
import { getWordlistIcon } from './icons.js';
import { makeReorderable } from './components.js';
import { createDialog, showDialog } from './dialogs/dialog.js';
import { showConfirm } from './dialogs/confirm.js';
import { buildWordlistCardHTML } from './scope-selector.js';

// The Add-wordlist dialog lives upward (main.js); injected so this view imports
// nothing above ui.
let _openAddWordlist = () => {};

export function configureManagePanel({ openAddWordlist }) {
  if (openAddWordlist) _openAddWordlist = openAddWordlist;
}

export const ManagePanel = (() => {
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
        <button type="button" class="manage-apply-btn primary">Save</button>
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

    addRow.addEventListener('click', () => _openAddWordlist(absorb));

    // Self-gates on shadow rather than subscribing only while open: the signals
    // lib has no teardown, so this lifelong effect must no-op when closed.
    effect(() => {
      cacheVersion$.get();
      configSummary$.get();   // a fetch content-diff bumps this, not cacheVersion$, but still changes the per-row entry count
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
