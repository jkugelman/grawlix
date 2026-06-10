'use strict';

// ─── Dialog helpers ───────────────────────────────────────────────────────────

export function enableDismissClicks(el, dismissOnBackdrop = true) {
  el.addEventListener('click', e => {
    const onDismissBtn = e.target.closest('.dialog-close-btn, .dialog-cancel-btn');
    const onBackdrop = e.target === el && dismissOnBackdrop;
    if (onDismissBtn || onBackdrop) el.close();
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

export function createDialog(id, { labelledby, label, dismissOnBackdrop = true } = {}) {
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
