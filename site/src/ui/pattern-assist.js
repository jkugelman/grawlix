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
import { analyzePhone, PHONE_CHEAT } from '../engine/assist-phone.js';
import { fetchWorkerPhoneQuery } from './pipeline-worker.js';
import { fitPopover, visibleRect } from './components.js';
import { ToolStack } from './tool-stack.js';
import { showToast } from './toasts.js';

const DIALECTS = {
  umiaq: { analyze: text => analyzeUmiaq(text), cheat: UMIAQ_CHEAT, reading: true },
  regex: { analyze: (text, mode) => analyzeRegex(text, { mode }), cheat: REGEX_CHEAT, link: REGEX_CHEAT_LINK, reading: true },
  search: { analyze: (text, mode) => analyzeSearch(text, { mode }), cheat: SEARCH_CHEAT, reading: false },
  'regex-replace': { analyze: analyzeReplacement, context: rowPattern, panel: false },
  phone: { analyze: text => analyzePhone(text), cheat: PHONE_CHEAT, denseHead: 'Sounds, in ARPABET', lines: 'Searching for' },
  'phone-replace': { analyze: text => analyzePhone(text, { replacement: true }), cheat: PHONE_CHEAT, denseHead: 'Sounds, in ARPABET', lines: 'Replacing with', replacement: true },
};
const PATTERN_KEY = { umiaq: 'query', regex: 'pattern', search: 'pattern' };
const KIND_CLASS = {
  sound: 'q-value', wild: 'q-field', anchor: 'q-field', class: 'q-value', esc: 'q-value', num: 'q-value',
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
  const translated = d.lines ? translationOf(input, d) : null;
  const key = `${input.value}\0${context}\0${!!translated}`;
  if (input._assist?.key !== key) {
    const result = d.analyze(input.value, context);
    input._assist = { key, result: translated ? withTranslation(result, translated) : result };
  }
  return input._assist.result;
}

// ─── Phone search translations ────────────────────────────────────────────────

const translations = new Map();
const MAX_TRANSLATIONS = 200;

function translationOf(input, d) {
  const text = input.value.trim();
  if (!text) return null;
  const key = `${d.replacement ? 'r' : 'q'}\0${text}`;
  const known = translations.get(key);
  if (known) return known === 'pending' ? null : known;
  if (translations.size > MAX_TRANSLATIONS) translations.clear();
  translations.set(key, 'pending');
  fetchWorkerPhoneQuery(text, d.replacement).then(reply => {
    if (reply.ready) translations.set(key, reply);
    else translations.delete(key);
    if (reply.ready && input.isConnected && input.value.trim() === text) refresh(input);
  });
  return null;
}

function withTranslation(A, { lines, error }) {
  if (A.error) return A;
  if (error) return { ...A, error };
  return { ...A, lines };
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
  let el = null, owner = null, fixes = [], dismissed = false, hasLead = false, shape = null, copyText = '';

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'assist-panel';
    el.setAttribute('popover', 'manual');
    // Keep focus in the box, so a click on a fix or a symbol doesn't blur it first.
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('click', onClick);
    document.body.append(el);
    const reflow = () => { if (owner && !dismissed) place(); };
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    window.visualViewport?.addEventListener('resize', reflow);
    window.visualViewport?.addEventListener('scroll', reflow);
    return el;
  }

  // Never capped to scroll; why in docs/design.md § Pattern assist.
  function place() {
    const anchor = owner.closest('.clearable-input') ?? owner;
    const view = visibleRect();
    el.style.width = `${Math.min(Math.max(anchor.offsetWidth, 520), view.right - view.left - 16)}px`;
    if (!el.matches(':popover-open')) { el.showPopover(); shape = null; }
    for (const compact of hasLead ? [false, true] : [false]) {
      el.classList.toggle('compact', compact);
      const side = fitPopover(el, anchor, { placement: 'above', offset: 4 });
      if (side) {
        el.classList.toggle('above', side === 'above');
        const next = `${side} ${compact}`;
        if (shape && shape !== next) {
          el.animate({ opacity: [0, 1] }, { duration: parseFloat(getComputedStyle(el).transitionDuration) * 1000, easing: 'ease' });
        }
        shape = next;
        return;
      }
    }
    el.hidePopover();
  }

  function fixButtons(list) {
    if (!list?.length) return '';
    return `<div class="assist-fixes">${list.map(f => `<button type="button" class="assist-fix" tabindex="-1" data-fix="${fixes.push(f) - 1}">${esc(f.label)}</button>`).join('')}</div>`;
  }

  function cheatHTML(d) {
    const row = (r, i) => (r.insert != null
      ? `<button type="button" class="assist-cheat-row" tabindex="-1" data-cheat="${i}"><kbd>${esc(r.code)}</kbd> ${esc(r.desc)}</button>`
      : `<span class="assist-cheat-row"><kbd>${esc(r.code)}</kbd> ${esc(r.desc)}</span>`);
    const rows = dense => d.cheat.map((r, i) => (!!r.dense === dense ? row(r, i) : '')).join('');
    const denseRows = rows(true);
    const link = d.link ? `<a href="${esc(d.link.url)}" target="_blank" rel="noopener">${esc(d.link.text)}</a>` : '';
    return `<div class="assist-cheat"><div class="assist-cheat-head">Cheat sheet</div>`
      + `<div class="assist-cheat-grid">${rows(false)}</div>`
      + (denseRows ? `<div class="assist-cheat-dense"><div class="assist-cheat-head">${esc(d.denseHead)}</div><div class="assist-cheat-dense-grid">${denseRows}</div></div>` : '')
      + `${link ? `<div class="assist-cheat-link">${link}</div>` : ''}</div>`;
  }

  function linesHTML(d, lines) {
    copyText = lines.join(', ');
    const items = lines.map((line, i) => `<code>${mirrorHTML(line, analyzePhone(line), -1)}${i < lines.length - 1 ? '<span class="q-op">,</span>' : ''}</code>`).join('');
    return `<div class="assist-lines"><button type="button" class="assist-lines-copy" tabindex="-1" data-copy-lines>`
      + `<span class="assist-cheat-head">${esc(d.lines)}</span>${items}</button></div>`;
  }

  async function copyLines() {
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      showToast('Copy failed — clipboard permission denied');
      return;
    }
    showToast('Sounds copied');
  }

  function render() {
    const input = owner, d = DIALECTS[input.dataset.assist], A = analysisOf(input);
    const text = input.value, caret = input.selectionStart ?? text.length;
    const parts = [];
    fixes = [];
    if (errorVisible(A.error, text, caret)) parts.push(`<div class="assist-error">${A.error.msg}${fixButtons(A.error.fixes)}</div>`);
    if (d.reading && A.reading) parts.push(`<div class="assist-reading">${A.reading}</div>`);
    if (A.lines?.length) parts.push(linesHTML(d, A.lines));
    for (const h of A.hints) parts.push(`<div class="assist-hint${h.tip ? ' tip' : ''}">${h.msg}${fixButtons(h.fixes)}</div>`);
    hasLead = parts.length > 0;
    parts.push(cheatHTML(d));
    el.innerHTML = parts.join('');
    place();
  }

  function onClick(e) {
    const input = owner;
    if (!input) return;
    if (e.target.closest('[data-copy-lines]')) { copyLines(); return; }
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
  if (typeof ins === 'string') {
    // Sounds run together greedily, so S then H would read as SH.
    const lead = row.spaced && a > 0 && !/[\s[(]/.test(v[a - 1]) ? ' ' : '';
    splice(a, b, lead + ins, a + lead.length + (row.caret ?? ins.length));
    return;
  }
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
