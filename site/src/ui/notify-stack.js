'use strict';

// ─── Notification stack ───────────────────────────────────────────────────────

// Toasts and the fetch-status panel share one bottom-center column so they
// stack instead of overlapping — CSS `order` keeps the panel pinned at the
// bottom with toasts above it.
let _stackEl = null;
export function notifyStack() {
  if (_stackEl) return _stackEl;
  _stackEl = document.createElement('div');
  _stackEl.id = 'notify-stack';
  document.body.appendChild(_stackEl);
  return _stackEl;
}
