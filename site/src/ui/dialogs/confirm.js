'use strict';

// ─── Confirm / alert / merge-conflict dialogs ──────────────────────────────────

import { esc } from '../../core/util.js';
import { getEditsWordlist } from '../../data/state.js';
import { createDialog, showDialog } from './dialog.js';

export const showConfirm = (() => {
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

export const showAlert = (() => {
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

export const showMergeConflict = (() => {
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

export const showEditsConflict = (() => {
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
