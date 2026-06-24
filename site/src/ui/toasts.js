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
let _suppressed = false;
let _suppressedQueue = [];
export function setToastsSuppressed(on) {
  _suppressed = on;
  if (!on) { const q = _suppressedQueue; _suppressedQueue = []; q.forEach(fn => fn()); }
}

function _mountToast(el, duration, onExpire = null) {
  if (_suppressed) { _suppressedQueue.push(() => _mountToast(el, duration, onExpire)); return; }
  let hovered = false;
  const arm = () => { clearTimeout(el._timer); el._timer = setTimeout(() => { onExpire?.(); _dismissToast(el); }, duration); };
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
// onExpire fires only on a timer/non-action dismissal, never when the action is
// taken — so "Details" hands the diff to the dialog without also freeing it (a
// double-free that would yank the diff out from under the dialog about to show it).
export function showActionToast(msg, actionLabel, onAction, onExpire = null) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = msg + `<span class="toast-action">${esc(actionLabel)}</span>`;
  el.querySelector('.toast-action').onclick = e => {
    e.stopPropagation();
    _dismissToast(el);
    onAction();
  };
  _mountToast(el, 10000, onExpire);
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
