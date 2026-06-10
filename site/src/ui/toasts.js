'use strict';

// ─── Toasts ───────────────────────────────────────────────────────────────────

import { esc } from '../core/util.js';
import { hoverCapable } from '../core/platform.js';

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
export function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = msg;
  _mountToast(el, 5000);
}
export function showActionToast(msg, actionLabel, onAction) {
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
export function showUndoToast(msg, onUndo) {
  showActionToast(msg, 'Undo', onUndo);
}
function _dismissToast(el) {
  clearTimeout(el._timer);
  el.classList.add('dismissing');
  el.classList.remove('show');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}
