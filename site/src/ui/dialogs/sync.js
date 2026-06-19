'use strict';

import { esc } from '../../core/util.js';
import { getBrowser } from '../../core/platform.js';
import { syncKey } from '../../data/state.js';
import { syncTargets, isMirrorList, syncFilename, SyncStatus, Disk } from '../../data/disk-sync.js';
import { buildWordlistNameHTML } from '../scope-selector.js';
import { createDialog, showDialog } from './dialog.js';

let _actions = { action: () => {} };
export function configureSyncDialog({ WordlistActions }) {
  if (WordlistActions) _actions = WordlistActions;
}

export const SyncDialog = (() => {
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
    const listLabel = buildWordlistNameHTML(target);

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
    Promise.resolve(_actions.action(name)).then(done => { if (done) el.close(); });
  }

  return {
    mount,
    open(target) { render(target); showDialog(el); },
    act,
  };
})();
