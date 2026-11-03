'use strict';

// ─── Pattern assist ───────────────────────────────────────────────────────────
// Syntax coloring and a helper panel for the Umiaq, Regex and Search boxes
// (inputs marked `data-assist`, built by buildTextInputHTML). The input's own
// text is transparent; a mirror behind it shows the colored copy, so the mirror
// must match the input's font, padding and scroll exactly or the caret drifts
// off the letters. See docs/design.md § Pattern assist.

import { esc } from '../core/util.js';
import { tokenAt, errorVisible } from '../engine/assist.js';
import { analyzeUmiaq, UMIAQ_CHEAT } from '../engine/assist-umiaq.js';
import { analyzeRegex, analyzeReplacement, REGEX_CHEAT, REGEX_CHEAT_LINK } from '../engine/assist-regex.js';
import { analyzeSearch, SEARCH_CHEAT } from '../engine/assist-search.js';
import { positionPopover } from './components.js';
import { ToolStack } from './tool-stack.js';

const DIALECTS = {
  umiaq: { analyze: text => analyzeUmiaq(text), cheat: UMIAQ_CHEAT, reading: true, placement: 'below' },
  regex: { analyze: (text, mode) => analyzeRegex(text, { mode }), cheat: REGEX_CHEAT, link: REGEX_CHEAT_LINK, reading: true, placement: 'below' },
  // Above, so it never covers the entries table's sort headers just under the bar.
  search: { analyze: (text, mode) => analyzeSearch(text, { mode }), cheat: SEARCH_CHEAT, reading: false, placement: 'above' },
  'regex-replace': { analyze: analyzeReplacement, context: rowPattern, panel: false },
};
const PATTERN_KEY = { umiaq: 'query', regex: 'pattern', search: 'pattern' };
const KIND_CLASS = {
  wild: 'q-field', anchor: 'q-field', class: 'q-value', esc: 'q-value', num: 'q-value',
  op: 'q-op', quant: 'q-op', group: 'q-op', bad: 'assist-bad',
};

function matchModeOf(input) {
  const wrap = input.closest('.tool-row, .search-bar')?.querySelector('.tool-row-match');
  return wrap?.querySelector('input[type="checkbox"]')?.checked ? wrap.dataset.mode : '';
}

function rowPattern(input) {
  return input.closest('.tool-row')?.querySelector('input[data-assist="regex"]')?.value ?? '';
}

function analysisOf(input) {
  const d = DIALECTS[input.dataset.assist];
  const context = (d.context ?? matchModeOf)(input);
  const key = `${input.value}\0${context}`;
  if (input._assist?.key !== key) input._assist = { key, result: d.analyze(input.value, context) };
  return input._assist.result;
}

// ─── Mirror ───────────────────────────────────────────────────────────────────

function mirrorHTML(text, A, caret) {
  const n = text.length, cls = new Array(n).fill('');
  const add = (s, e, c) => { for (let k = Math.max(0, s); k < Math.min(n, e); k++) cls[k] += ' ' + c; };
  for (const t of A.tokens) {
    if (t.color != null) add(t.s, t.e, `hl-umiaq-var-${t.color}`);
    else if (KIND_CLASS[t.kind]) add(t.s, t.e, KIND_CLASS[t.kind]);
  }
  const regions = [...(A.regions || [])].sort((a, b) => (b.e - b.s) - (a.e - a.s));
  for (const r of regions) {
    for (let k = r.s; k < Math.min(n, r.e); k++) cls[k] = ` search-match-${r.color}`;
  }
  if (caret >= 0) {
    const t = tokenAt(A.tokens, caret);
    if (t?.pair) { add(t.s, t.e, 'assist-pair'); add(t.pair[0], t.pair[1], 'assist-pair'); }
    if (t?.target) add(t.target[0], t.target[1], 'assist-target');
  }
  if (errorVisible(A.error, text, caret)) add(A.error.s, Math.max(A.error.e, A.error.s + 1), 'q-err');
  let html = '', run = '', cur = '';
  const flush = () => { if (run) html += cur ? `<span class="${cur.trim()}">${esc(run)}</span>` : esc(run); run = ''; };
  for (let k = 0; k < n; k++) {
    if (cls[k] !== cur) { flush(); cur = cls[k]; }
    run += text[k];
  }
  flush();
  return html;
}

function paintMirror(input, A, caret) {
  const hl = input.parentElement.querySelector('.assist-hl');
  if (!hl) return;
  const cs = getComputedStyle(input);
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing']) hl.style[prop] = cs[prop];
  hl.style.left = `${parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)}px`;
  hl.style.right = `${parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight)}px`;
  hl.innerHTML = `<span class="assist-hl-text">${mirrorHTML(input.value, A, caret)}</span>`;
  syncScroll(input);
}

function syncScroll(input) {
  const text = input.parentElement.querySelector('.assist-hl-text');
  if (text) text.style.transform = `translateX(${-input.scrollLeft}px)`;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

const Panel = (() => {
  let el = null, owner = null, fixes = [], dismissed = false;

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'assist-panel';
    el.setAttribute('popover', 'manual');
    // Keep focus in the box, so a click on a fix or a symbol doesn't blur it first.
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('click', onClick);
    document.body.append(el);
    const reflow = () => { if (owner) place(); };
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return el;
  }

  function place() {
    const anchor = owner.closest('.clearable-input') ?? owner;
    el.style.width = `${Math.min(Math.max(anchor.offsetWidth, 520), window.innerWidth - 16)}px`;
    positionPopover(el, anchor, { placement: DIALECTS[owner.dataset.assist].placement, offset: 4 });
  }

  function fixButtons(list) {
    if (!list?.length) return '';
    return `<div class="assist-fixes">${list.map(f => `<button type="button" class="assist-fix" tabindex="-1" data-fix="${fixes.push(f) - 1}">${esc(f.label)}</button>`).join('')}</div>`;
  }

  function cheatHTML(d) {
    const items = d.cheat.map((r, i) => (r.insert != null
      ? `<button type="button" class="assist-cheat-row" tabindex="-1" data-cheat="${i}"><kbd>${esc(r.code)}</kbd> ${esc(r.desc)}</button>`
      : `<span class="assist-cheat-row"><kbd>${esc(r.code)}</kbd> ${esc(r.desc)}</span>`)).join('');
    const link = d.link ? `<a href="${esc(d.link.url)}" target="_blank" rel="noopener">${esc(d.link.text)}</a>` : '';
    return `<div class="assist-cheat"><div class="assist-cheat-head">Cheat sheet</div>`
      + `<div class="assist-cheat-grid">${items}</div>${link ? `<div class="assist-cheat-link">${link}</div>` : ''}</div>`;
  }

  function render() {
    const input = owner, d = DIALECTS[input.dataset.assist], A = analysisOf(input);
    const text = input.value, caret = input.selectionStart ?? text.length;
    const parts = [];
    fixes = [];
    if (errorVisible(A.error, text, caret)) parts.push(`<div class="assist-error">${A.error.msg}${fixButtons(A.error.fixes)}</div>`);
    if (d.reading && A.reading) parts.push(`<div class="assist-reading">${A.reading}</div>`);
    for (const h of A.hints) parts.push(`<div class="assist-hint${h.tip ? ' tip' : ''}">${h.msg}${fixButtons(h.fixes)}</div>`);
    parts.push(cheatHTML(d));
    el.innerHTML = parts.join('');
    if (!el.matches(':popover-open')) el.showPopover();
    place();
  }

  function onClick(e) {
    const input = owner;
    if (!input) return;
    const fb = e.target.closest('[data-fix]');
    if (fb) { applyFix(input, fixes[+fb.dataset.fix]); return; }
    const cb = e.target.closest('[data-cheat]');
    if (cb) insertCheat(input, DIALECTS[input.dataset.assist].cheat[+cb.dataset.cheat]);
  }

  return {
    show(input) {
      if (owner !== input) dismissed = false;
      owner = input;
      if (dismissed) return;
      ensure();
      render();
    },
    hide(input) {
      if (input && owner !== input) return;
      if (el?.matches(':popover-open')) el.hidePopover();
      owner = null;
    },
    dismiss() { dismissed = true; if (el?.matches(':popover-open')) el.hidePopover(); },
    undismiss() { dismissed = false; },
    isOpenFor: input => owner === input && !!el?.matches(':popover-open'),
  };
})();

// ─── Editing ──────────────────────────────────────────────────────────────────

function setValue(input, value, caret) {
  input.value = value;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyFix(input, fix) {
  if (!fix) return;
  if (fix.tool) {
    const params = { [PATTERN_KEY[fix.tool]]: fix.text };
    const mode = fix.mode ?? matchModeOf(input);
    if (fix.tool !== 'umiaq' && mode) params.mode = mode;
    Panel.hide(input);
    ToolStack.moveQueryTo(input.dataset.row, fix.tool, params);
    return;
  }
  const v = input.value;
  if (fix.s != null) setValue(input, v.slice(0, fix.s) + fix.text + v.slice(fix.e), fix.s + fix.text.length);
  else setValue(input, fix.text, fix.text.length);
}

function insertCheat(input, row) {
  const ins = row.insert;
  const v = input.value, a = input.selectionStart ?? v.length, b = input.selectionEnd ?? a;
  const splice = (s, e, text, caret) => setValue(input, v.slice(0, s) + text + v.slice(e), caret);
  if (typeof ins === 'string') { splice(a, b, ins, a + (row.caret ?? ins.length)); return; }
  const vars = analysisOf(input).variables || [];
  if (ins.variable) {
    const free = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(c => !vars.includes(c)) ?? 'Z';
    splice(a, b, free, a + 1);
  } else if (ins.clause) {
    const body = ins.clause.replace('V', vars[0] || 'A');
    const base = v.trimEnd();
    const next = base + (base && !base.endsWith(';') ? ';' : '') + body;
    setValue(input, next, next.length);
  } else if (ins.prefix) {
    let cs = v.lastIndexOf(';', a - 1) + 1;
    while (v[cs] === ' ') cs++;
    splice(cs, cs, ins.prefix, cs + ins.prefix.length);
  }
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

let active = null;

function refresh(input) {
  const A = analysisOf(input);
  const focused = input === document.activeElement;
  paintMirror(input, A, focused ? input.selectionStart ?? -1 : -1);
  if (focused && DIALECTS[input.dataset.assist].panel !== false) Panel.show(input);
}

export function paintPatternFields(root = document) {
  for (const input of root.querySelectorAll('input[data-assist]')) refresh(input);
}

export function mountPatternAssist() {
  const assisted = e => e.target?.closest?.('input[data-assist]');
  document.addEventListener('focusin', e => {
    const input = assisted(e);
    if (!input) return;
    active = input;
    refresh(input);
  });
  document.addEventListener('focusout', e => {
    const input = assisted(e);
    if (!input) return;
    if (active === input) active = null;
    Panel.hide(input);
    refresh(input);
  });
  document.addEventListener('input', e => {
    if (assisted(e)) Panel.undismiss();
    // Repaint the whole row: the replace box's colors go stale when only the pattern repaints.
    const row = e.target?.closest?.('.tool-row, .search-bar');
    for (const field of row?.querySelectorAll('input[data-assist]') ?? []) refresh(field);
  });
  for (const type of ['keyup', 'click', 'select']) {
    document.addEventListener(type, e => { const input = assisted(e); if (input) refresh(input); });
  }
  document.addEventListener('selectionchange', () => { if (active && active === document.activeElement) refresh(active); });
  document.addEventListener('scroll', e => { if (e.target?.matches?.('input[data-assist]')) syncScroll(e.target); }, true);
  document.addEventListener('keydown', e => {
    const input = assisted(e);
    if (e.key === 'Escape' && input && Panel.isOpenFor(input)) {
      Panel.dismiss();
      e.stopPropagation();
    }
  }, true);
}
