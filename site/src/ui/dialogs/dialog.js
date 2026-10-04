'use strict';

// ─── Dialog helpers ───────────────────────────────────────────────────────────

import { showConfirm } from './confirm.js';

// Cancel skips the discard confirm deliberately: it's an explicit discard, as
// in the rescore editor and entry panel. Only the ambiguous exits (✕,
// backdrop, Escape) confirm.
export function enableDismissClicks(el, isDirty = null) {
  const requestClose = async () => {
    if (isDirty?.() && !await showConfirm('Discard changes?', { confirmText: 'Discard' })) return;
    el.close();
  };
  el.addEventListener('click', e => {
    if (e.target.closest('.dialog-cancel-btn')) el.close();
    else if (e.target.closest('.dialog-close-btn') || e.target === el) requestClose();
  });
  el.addEventListener('cancel', e => {
    if (isDirty?.()) { e.preventDefault(); requestClose(); }
  });
}

export function showDialog(el, onClose = null) {
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

export function createDialog(id, { labelledby, label, isDirty = null } = {}) {
  const el = document.createElement('dialog');
  el.id = id;
  if (labelledby) el.setAttribute('aria-labelledby', labelledby);
  if (label)      el.setAttribute('aria-label', label);
  enableDismissClicks(el, isDirty);
  const body = document.createElement('div');
  body.className = 'dialog-body';
  el.appendChild(body);
  document.body.appendChild(el);
  return { el, body };
}
