'use strict';

// ─── Components ───────────────────────────────────────────────────────────────
// Generic, layer-agnostic UI builders. Domain-specific builders (rules, cards,
// tools, entries) live with their owners.

import { esc } from '../core/util.js';

// options: array of { value, label }
export function buildSegCtrlHTML(id, options, activeValue) {
  // type="button" so a seg control placed inside a <form method="dialog"> (the
  // download dialog) doesn't submit and close the dialog on selection.
  const buttons = options.map(({ value, label }) => {
    const on = value === activeValue;
    return `<button type="button" class="seg-btn${on ? ' active' : ''}" data-val="${value}" aria-pressed="${on}">${label}</button>`;
  }).join('');
  return `<div class="seg-ctrl"${id ? ` id="${id}"` : ''}>${buttons}</div>`;
}

// Toggling `.active` inline instead of calling this leaves aria-pressed stale —
// drift that is invisible on screen and to any test not asserting on it.
export function setSegCtrlActive(container, target) {
  for (const b of container.querySelectorAll('.seg-btn')) {
    const on = typeof target === 'string' ? b.dataset.val === target : b === target;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

const OUTPUT_FLAGS = ['spaces', 'punctuation', 'accents', 'comments'];

export function buildOutputFormatControlsHTML(fmt) {
  const flags = OUTPUT_FLAGS.map(k =>
    `<label class="of-flag"><input type="checkbox" data-flag="${k}"${fmt[k] ? ' checked' : ''}> ${k[0].toUpperCase() + k.slice(1)}</label>`
  ).join('');
  return `<div class="of-flags">${flags}</div>`;
}

export function readOutputFormatControls(container) {
  const fmt = {};
  for (const k of OUTPUT_FLAGS) fmt[k] = container.querySelector(`input[data-flag="${k}"]`).checked;
  return fmt;
}

export function wireOutputFormatControls(container, onChange) {
  container.querySelectorAll('input[data-flag]').forEach(cb => { cb.onchange = () => onChange && onChange(); });
}

export function buildBadgeHTML(severity, opts = {}) {
  if (!severity) return '';
  const { title = '' } = opts;
  const titleAttr = title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : '';
  return `<span class="badge" data-severity="${severity}"${titleAttr}></span>`;
}

export function buildClearableInputHTML(inputHTML, hasValue) {
  return `<span class="clearable-input">${inputHTML}` +
    `<button type="button" class="clear-btn" tabindex="-1" title="Clear" aria-label="Clear"${hasValue ? '' : ' hidden'}>` +
    `<svg width="10" height="10" aria-hidden="true"><use href="#icon-x"/></svg></button></span>`;
}
export function syncClearButton(input) {
  const btn = input.closest('.clearable-input')?.querySelector('.clear-btn');
  if (btn) btn.hidden = !input.value;
}
export function mountClearableInputs() {
  document.addEventListener('input', e => {
    if (e.target.closest('.clearable-input')) syncClearButton(e.target);
  });
  document.addEventListener('click', e => {
    const btn = e.target.closest('.clearable-input .clear-btn');
    if (!btn) return;
    const input = btn.closest('.clearable-input').querySelector('input');
    input.value = '';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function buildTextInputHTML(param, value, toolKey, wiring) {
  const helpAttr = param.help ? ` data-help="${toolKey}/${param.key}"` : '';
  const input = `<input class="entry-input" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${esc(param.placeholder || '')}" value="${esc(value || '')}"${helpAttr}${wiring}>`;
  return buildClearableInputHTML(input, !!value);
}

export function buildParamHTML(param, value, toolKey, wiring) {
  const titleAttr = param.title ? ` title="${esc(param.title)}"` : '';
  if (param.type === 'checkbox') {
    const valueAttr = param.value ? ` data-value="${esc(param.value)}"` : '';
    return `<span class="tool-row-param"><label${titleAttr}><input type="checkbox"${value ? ' checked' : ''}${valueAttr}${wiring}> ${esc(param.label)}</label></span>`;
  }
  if (param.type === 'match') {
    const mode = value || param.menuDefault;
    const current = param.choices.find(c => c.value === mode) || param.choices[0];
    return `<span class="tool-row-param tool-row-match" data-mode="${esc(current.value)}">`
      + `<label class="match-mode-toggle"${titleAttr}>`
      + `<input type="checkbox"${value ? ' checked' : ''}${wiring} aria-label="${esc(param.label)}">`
      + `<span class="match-mode-label">${esc(current.label)}</span></label>`
      + `<button type="button" class="match-mode-arrow" title="Change match mode"`
      + ` aria-haspopup="menu" aria-expanded="false" aria-label="Change match mode">`
      + `<svg class="more-menu-caret" aria-hidden="true" viewBox="0 0 8 5"><use href="#icon-arrow"/></svg></button></span>`;
  }
  const labelHTML = param.label ? `<label>${esc(param.label)}</label>` : '';
  if (param.type === 'number') {
    return `<span class="tool-row-param">${labelHTML}<input type="number" min="1" class="tool-row-num"`
      + ` placeholder="${esc(param.placeholder || '')}" value="${esc(value || '')}"${wiring}></span>`;
  }
  if (param.type === 'range') {
    const choices = (param.choices || []).map(c => typeof c === 'string' ? { value: c, label: c } : c);
    const max = Math.max(0, choices.length - 1);
    const cur = String(value ?? param.default ?? choices[0]?.value ?? '').toLowerCase();
    const idx = Math.max(0, choices.findIndex(c => c.value.toLowerCase() === cur));
    const ticks = choices.map(c => `<span>${esc(c.label)}</span>`).join('');
    const valuesAttr = ` data-range-values="${esc(choices.map(c => c.value).join(','))}"`;
    return `<span class="tool-row-param tool-row-range">${labelHTML}<span class="tool-row-range-wrap">`
      + `<input type="range" min="0" max="${max}" step="1" value="${idx}"${valuesAttr}${wiring}>`
      + `<span class="tool-row-range-ticks">${ticks}</span>`
      + `</span></span>`;
  }
  return `<span class="tool-row-param tool-row-param-text">${labelHTML}${buildTextInputHTML(param, value, toolKey, wiring)}</span>`;
}

export function positionPopover(el, anchor, { placement = 'above', offset = 6, align = 'left' } = {}) {
  const aRect = anchor.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  let above = placement === 'above';
  if (above && aRect.top - eRect.height - offset < 8) above = false;
  else if (!above && aRect.bottom + offset + eRect.height > window.innerHeight - 8) above = true;
  const top = above ? aRect.top - eRect.height - offset : aRect.bottom + offset;
  const maxLeft = window.innerWidth - eRect.width - 8;
  const rawLeft = align === 'right' ? aRect.right - eRect.width : aRect.left;
  const left = Math.max(8, Math.min(rawLeft, maxLeft));
  el.style.top  = top  + 'px';
  el.style.left = left + 'px';
}

export class PopupHelp {
  constructor(anchor, contentHTML, opts = {}) {
    this.anchor = anchor;
    this.placement = opts.placement || 'above';
    this.offset = opts.offset ?? 6;

    this.el = document.createElement('div');
    this.el.className = 'popup-help';
    this.el.innerHTML = contentHTML;
    // Keep the anchor focused when the popover is clicked — otherwise blur
    // hides the popover before a click on a link inside it can land.
    this.el.addEventListener('mousedown', e => e.preventDefault());
    document.body.appendChild(this.el);

    this._onFocus = () => this.show();
    this._onBlur  = () => this.hide();
    this._reflow  = () => { if (this._open) this._position(); };
    this._onKeyDown = (e) => {
      if (e.key === 'Escape' && this._open) {
        this.hide();
        e.stopPropagation();
      }
    };
    anchor.addEventListener('focus', this._onFocus);
    anchor.addEventListener('blur',  this._onBlur);
    anchor.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('resize', this._reflow);
    window.addEventListener('scroll', this._reflow, true);

    if (anchor === document.activeElement) this.show();
  }

  show() {
    if (window.matchMedia('(max-width: 759px)').matches) return;
    this._open = true;
    this._position();
    this.el.classList.add('open');
  }

  hide() {
    this._open = false;
    this.el.classList.remove('open');
  }

  _position() {
    positionPopover(this.el, this.anchor, { placement: this.placement, offset: this.offset });
  }

  destroy() {
    this.anchor.removeEventListener('focus', this._onFocus);
    this.anchor.removeEventListener('blur',  this._onBlur);
    this.anchor.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('resize', this._reflow);
    window.removeEventListener('scroll', this._reflow, true);
    this.el.remove();
  }
}

export function buildSplitBtn(mainLabel, mainOnclick, menuItems, { primary = false, disabled = false, title = '', id = '' } = {}) {
  const dis = disabled ? ' disabled' : '';
  const titleAttr = title ? ` title="${title}"` : '';
  const idAttr = id ? ` id="${id}"` : '';
  const arrow = `<svg width="8" height="5"><use href="#icon-arrow"/></svg>`;
  const items = menuItems.map(([lbl, fn]) => `<button onclick="${fn}">${lbl}</button>`).join('');
  return `<div class="split-btn${primary ? ' primary' : ''}"${idAttr}>` +
    `<button class="split-btn-main"${titleAttr} onclick="${mainOnclick}"${dis}>${mainLabel}</button>` +
    `<button class="split-btn-arrow" onclick="toggleSplitMenu(event)" title="More options"${dis}>${arrow}</button>` +
    `<div class="split-btn-menu">${items}</div>` +
    `</div>`;
}

export function buildMoreMenuHTML(menuItems, { className = '', header = '', icon = '', label = '', title = 'More options' } = {}) {
  const items = menuItems.map(([lbl, fn, opts = {}]) => {
    const dis   = opts.disabled ? ' disabled' : '';
    const itemTitle = opts.title ? ` title="${esc(opts.title)}"` : '';
    return `<button onclick="${fn}"${dis}${itemTitle}>${lbl}</button>`;
  }).join('');
  const headerHTML = header ? `<div class="split-btn-menu-header">${esc(header)}</div>` : '';
  const caret = `<svg class="more-menu-caret" aria-hidden="true" viewBox="0 0 8 5"><use href="#icon-arrow"/></svg>`;
  const trigger = label ? `${esc(label)}${caret}` : (icon ? `<svg aria-hidden="true"><use href="#icon-${icon}"/></svg>` : '⋮');
  const btnClass = label ? 'more-menu-btn more-menu-labeled' : 'more-menu-btn';
  return `<div class="split-btn${className ? ' ' + className : ''}">` +
    `<button class="${btnClass}" onclick="toggleSplitMenu(event)" title="${esc(title)}">${trigger}</button>` +
    `<div class="split-btn-menu">${headerHTML}${items}</div>` +
    `</div>`;
}

export function toggleSplitMenu(event) {
  event.stopPropagation();
  const btn = event.currentTarget.closest('.split-btn');
  const isOpen = btn.classList.contains('open');
  document.querySelectorAll('.split-btn.open').forEach(b => b.classList.remove('open'));
  if (!isOpen) btn.classList.add('open');
}

export function buildUrlInputHTML(id, placeholder) {
  return `<div class="url-input-wrap">` +
    `<svg class="url-input-icon" width="14" height="14" aria-hidden="true"><use href="#icon-globe"/></svg>` +
    `<input class="url-input" id="${id}" type="url" placeholder="${placeholder}" spellcheck="false" autocomplete="off">` +
    `</div>`;
}

export function buildEditHintHTML(extraClass, onclick) {
  return `<span class="edit-hint${extraClass ? ' ' + extraClass : ''}" onclick="${onclick}" aria-hidden="true" title="Click to edit">✏️</span>`;
}

export function buildTrashIconHTML() {
  return `<svg class="icon-trash"><use href="#icon-trash"/></svg>`;
}

export function buildDragHandleHTML() {
  return `<span class="drag-handle" title="Drag to reorder" aria-label="Drag to reorder">≡</span>`;
}

let _dragGhostLayer = null;
function dragGhostLayer() {
  if (!_dragGhostLayer) {
    _dragGhostLayer = document.createElement('div');
    _dragGhostLayer.className = 'drag-ghost-layer';
  }
  return _dragGhostLayer;
}

// A body-parented fixed layer is occluded by a modal's top layer, so the ghost
// vanishes behind the dialog; re-parent the singleton into the dragged
// container's own top-layer host (open dialog, else body). One drag at a time.
function hostDragGhostLayer(container) {
  const host = container.closest('dialog[open]') || document.body;
  const layer = dragGhostLayer();
  if (layer.parentElement !== host) host.appendChild(layer);
  return layer;
}

// Native HTML5 drag never fires from touch, so the reorder handles that used it
// were dead on mobile; pointer events fix that. Needs `touch-action: none` on the
// handle (CSS) or a touch-drag scrolls the page instead of dragging.
export function makeReorderable(container, { handleSelector, itemSelector, onReorder, canDrop }) {
  if (!container) return;
  const THRESHOLD = 4, EDGE = 48, SPEED = 10;
  let fromEl = null, pointerId = null, dragging = false;
  let startX = 0, startY = 0, lastX = 0, lastY = 0, rafId = 0;
  let ghost = null, grabX = 0, grabY = 0;
  let dropLine = null, dropBeforeEl = null, hasDrop = false;

  // A transform-centered modal dialog is the fixed ghost-layer's containing block, so
  // ghost/drop-line positions are layer-relative, not viewport (body layer origin = 0,0).
  const layerOrigin = () => dragGhostLayer().getBoundingClientRect();

  const moveGhost = () => {
    if (!ghost) return;
    const o = layerOrigin();
    ghost.style.left = `${lastX - grabX - o.left}px`;
    ghost.style.top  = `${lastY - grabY - o.top}px`;
  };

  // iOS WebKit honors neither overscroll-behavior nor touch-action for the history
  // swipe; only preventing the (non-passive) touchmove keeps the page from sliding.
  const blockTouch = e => e.preventDefault();

  function refreshDrop() {
    const items = [...container.querySelectorAll(itemSelector)];
    const fromIdx = items.indexOf(fromEl);
    let gap = items.findIndex(it => {
      const r = it.getBoundingClientRect();
      return lastY < r.top + r.height / 2;
    });
    if (gap < 0) gap = items.length;
    const before = gap < items.length ? items[gap] : null;
    hasDrop = gap !== fromIdx && gap !== fromIdx + 1 && (!canDrop || canDrop(fromEl, before));
    if (!hasDrop) { if (dropLine) dropLine.hidden = true; return; }
    dropBeforeEl = before;
    const r = (dropBeforeEl || items[items.length - 1]).getBoundingClientRect();
    if (!dropLine) {
      dropLine = document.createElement('div');
      dropLine.className = 'drop-line';
      dragGhostLayer().appendChild(dropLine);
    }
    const o = layerOrigin();
    dropLine.style.left  = `${r.left - o.left}px`;
    dropLine.style.width = `${r.width}px`;
    dropLine.style.top   = `${(dropBeforeEl ? r.top : r.bottom) - 1 - o.top}px`;
    dropLine.hidden = false;
  }

  // The nearest scrollable ancestor, else the page (null) — the surface to
  // auto-scroll when a drag nears its edge.
  function scrollHost() {
    for (let n = fromEl?.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  }

  // A touch held at the edge stops firing pointermove, so edge-scroll runs on
  // its own frame loop off the last pointer position.
  function tick() {
    rafId = dragging ? requestAnimationFrame(tick) : 0;
    if (!dragging) return;
    const host = scrollHost();
    if (host) {
      const r = host.getBoundingClientRect();
      if (lastY < r.top + EDGE && host.scrollTop > 0) host.scrollTop -= SPEED;
      else if (lastY > r.bottom - EDGE)               host.scrollTop += SPEED;
    } else if (lastY < EDGE)                           scrollBy(0, -SPEED);
    else if (lastY > innerHeight - EDGE)              scrollBy(0,  SPEED);
    refreshDrop();
  }

  function stop(commit) {
    if (!fromEl) return;
    const doDrop = commit && dragging && hasDrop;
    const before = dropBeforeEl;
    if (dropLine) dropLine.hidden = true;
    fromEl.classList.remove('dragging');
    ghost?.remove(); ghost = null;
    if (doDrop) onReorder(fromEl, before);
    fromEl = null; pointerId = null; dragging = false; hasDrop = false;
    document.documentElement.classList.remove('reorder-dragging');
    document.removeEventListener('touchmove', blockTouch, { passive: false });
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  container.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const handle = e.target.closest(handleSelector);
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest(itemSelector);
    if (!item) return;
    fromEl = item; pointerId = e.pointerId;
    startX = lastX = e.clientX; startY = lastY = e.clientY;
    handle.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('reorder-dragging');
    document.addEventListener('touchmove', blockTouch, { passive: false });
    e.preventDefault();
  });
  container.addEventListener('pointermove', e => {
    if (!fromEl || e.pointerId !== pointerId) return;
    lastX = e.clientX; lastY = e.clientY;
    if (!dragging) {
      if (Math.hypot(lastX - startX, lastY - startY) < THRESHOLD) return;
      dragging = true;
      const r = fromEl.getBoundingClientRect();
      grabX = lastX - r.left; grabY = lastY - r.top;
      ghost = fromEl.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.style.width = `${r.width}px`;
      hostDragGhostLayer(container).appendChild(ghost);
      fromEl.classList.add('dragging');
      rafId = requestAnimationFrame(tick);
    }
    e.preventDefault();
    refreshDrop();
    moveGhost();
  });
  container.addEventListener('pointerup',     e => { if (e.pointerId === pointerId) stop(true);  });
  container.addEventListener('pointercancel', e => { if (e.pointerId === pointerId) stop(false); });
}
