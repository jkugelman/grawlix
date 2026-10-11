'use strict';

// ─── Query editor ─────────────────────────────────────────────────────────────
// The rescore rule fields: a condition box that highlights the query and offers
// suggestions from the first click, and an output box that offers the tiers.
// Both float one shared suggestion list. See docs/wordlists.md § Rescore rules.

import { esc } from '../core/util.js';
import { analyzeQuery, formatQuery } from '../engine/rule-query.js';
import { visibleErrors, describeAt } from '../engine/rule-suggest.js';
import { positionPopover } from './components.js';

// ─── Suggestion list ──────────────────────────────────────────────────────────

const SuggestList = (() => {
  let el = null;
  let owner = null;
  let items = [];
  let active = -1;

  function ensure() {
    if (el) return el;
    el = document.createElement('ul');
    el.id = 'rule-suggest';
    el.className = 'score-listbox rule-suggest';
    el.setAttribute('role', 'listbox');
    el.setAttribute('popover', 'manual');
    // Keep focus in the field, so picking an item doesn't blur it first.
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('click', e => {
      const li = e.target.closest('.score-picker-opt');
      if (li) owner?.accept(items[+li.dataset.i]);
    });
    el.addEventListener('mousemove', e => {
      const li = e.target.closest('.score-picker-opt');
      if (li && +li.dataset.i !== active) setActive(+li.dataset.i, false);
    });
    const reflow = () => { if (owner) place(); };
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return el;
  }

  function place() {
    const anchor = owner.anchor;
    el.style.width = Math.min(Math.max(anchor.offsetWidth, 300), window.innerWidth - 16) + 'px';
    positionPopover(el, anchor, { placement: 'below', offset: 4 });
  }

  function labelHTML(it) {
    if (it.labelHTML) return it.labelHTML;
    const m = (it.match || '').trim().toLowerCase();
    const label = it.label;
    const text = m && label.toLowerCase().startsWith(m)
      ? `<b>${esc(label.slice(0, m.length))}</b>${esc(label.slice(m.length))}` : esc(label);
    return `<span class="rule-suggest-label rule-suggest-${it.kind}">${text}</span>`;
  }

  function statusHTML(field) {
    const st = field.statusLine;
    return `<li class="rule-suggest-status${st?.err ? ' err' : ''}" role="presentation"${st ? '' : ' hidden'}>${st?.html ?? ''}</li>`;
  }

  function show(field, { groups, hint, active: start = -1 }) {
    ensure();
    items = [];
    let html = statusHTML(field);
    for (const g of groups) {
      if (!g.items.length) continue;
      html += `<li class="rule-suggest-group" role="presentation"><span>${esc(g.label)}</span>${g.counts ? '<span>Matches</span>' : ''}</li>`;
      for (const it of g.items) {
        const i = items.push(it) - 1;
        html += `<li class="score-picker-opt" role="option" id="rule-suggest-${i}" data-i="${i}" aria-selected="false">`
          + labelHTML(it)
          + `<span class="score-picker-label">${esc(it.desc || '')}</span>`
          + `<span class="score-picker-hint">${it.count != null ? it.count.toLocaleString() : ''}</span></li>`;
      }
    }
    if (hint) html += `<li class="rule-suggest-hint" role="presentation">${hint}</li>`;
    const foot = field.footer();
    html += `<li class="rule-suggest-foot" role="presentation"${foot ? '' : ' hidden'}>${foot ?? ''}</li>`;
    if (!items.length && !hint && !foot && !field.statusLine) { hide(field); return; }
    if (owner && owner !== field) owner.listClosed();
    owner = field;
    el.innerHTML = html;
    // A modal dialog makes everything outside it inert, so the list lives inside it.
    const host = field.anchor.closest('dialog') ?? document.body;
    if (el.parentNode !== host) host.append(el);
    if (!el.matches(':popover-open')) el.showPopover();
    place();
    active = -1;
    if (start >= 0 && start < items.length) setActive(start, true);
    field.listOpened(el.id);
  }

  function hide(field) {
    if (!el || (field && owner !== field)) return;
    if (el.matches(':popover-open')) el.hidePopover();
    owner?.listClosed();
    owner = null;
    items = [];
    active = -1;
  }

  function setActive(i, scroll) {
    el.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    el.querySelector('.score-picker-opt.active')?.classList.remove('active');
    active = i;
    const li = el.querySelector(`[data-i="${i}"]`);
    if (li) {
      li.setAttribute('aria-selected', 'true');
      li.classList.add('active');
      if (scroll) li.scrollIntoView({ block: 'nearest' });
    }
    owner?.activeChanged(li ? li.id : '');
  }

  function move(d) {
    const n = items.length;
    if (!n) return;
    setActive(active < 0 ? (d > 0 ? 0 : n - 1) : (active + d + n) % n, true);
  }

  function fillCounts(field, counts) {
    if (owner !== field) return;
    items.forEach((it, i) => {
      if (!it.probe || !counts.has(it.probe)) return;
      it.count = counts.get(it.probe);
      const hint = el.querySelector(`[data-i="${i}"] .score-picker-hint`);
      if (hint) hint.textContent = it.count != null ? it.count.toLocaleString() : '';
    });
  }

  function refreshStatus(field) {
    const li = owner === field && el.querySelector('.rule-suggest-status');
    if (li) li.outerHTML = statusHTML(field);
  }

  function refreshFooter() {
    const li = owner && el.querySelector('.rule-suggest-foot');
    if (!li) return;
    const foot = owner.footer();
    li.innerHTML = foot ?? '';
    li.hidden = !foot;
  }

  return {
    show, hide, move, fillCounts, refreshFooter, refreshStatus,
    isOpenFor: field => owner === field,
    current: () => items[active],
    items: () => items,
  };
})();

// A re-render or a closing dialog can remove the focused field without a blur,
// which would strand the list in the top layer.
export function hideSuggestions() {
  SuggestList.hide();
}

export function refreshSuggestionFooter() {
  SuggestList.refreshFooter();
}

// ─── Fields ───────────────────────────────────────────────────────────────────

export class SuggestField {
  constructor(input, { suggest, countProbes = null, onCommit = null, footer = () => null, format = null }) {
    this.input = input;
    this.format = format;
    this.anchor = input.closest('.rule-query-box') ?? input;
    this.suggestFn = suggest;
    this.countProbes = countProbes;
    this.onCommit = onCommit;
    this.footer = footer;
    this.statusLine = null;
    this.focused = false;
    this.dismissed = false;
    this.lastKey = null;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.addEventListener('focus', () => {
      this.focused = true; this.dismissed = false; this.lastKey = null; this.committed = this.text;
      this.refresh();
    });
    input.addEventListener('blur', () => { this.focused = false; SuggestList.hide(this); this.blurred(); });
    for (const ev of ['click', 'keyup']) input.addEventListener(ev, () => this.refresh());
    input.addEventListener('input', () => { this.dismissed = false; this.lastKey = null; this.changed(); this.refresh(); });
    input.addEventListener('keydown', e => this.onKeydown(e));
  }

  get text() { return this.input.value; }
  sel() { return [this.input.selectionStart, this.input.selectionEnd]; }

  refresh() {
    if (!this.focused) return;
    const [a, b] = this.sel();
    const key = `${this.text}\u0000${a}\u0000${b}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.caretMoved();
    if (this.dismissed) return;
    const result = this.suggestFn(this.text, a, b);
    SuggestList.show(this, result);
    this.requestCounts(SuggestList.isOpenFor(this) ? SuggestList.items().map(it => it.probe).filter(Boolean) : []);
  }

  async requestCounts(probes) {
    if (!probes.length || !this.countProbes) return;
    const counts = await this.countProbes(probes);
    if (counts) SuggestList.fillCounts(this, counts);
  }

  accept(item) {
    if (!item) return;
    const s = this.text;
    this.dismissed = false;
    this.input.value = s.slice(0, item.rs) + item.insert + s.slice(item.re);
    this.input.setSelectionRange(item.caret, item.caret);
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.afterAccept();
  }

  onKeydown(e) {
    const open = SuggestList.isOpenFor(this);
    if (e.key === 'Escape') {
      // Escape closes the list, not the Manage dialog around it.
      if (open) { e.preventDefault(); e.stopPropagation(); SuggestList.hide(this); this.dismissed = true; }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (open) { e.preventDefault(); SuggestList.move(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); this.dismissed = false; this.lastKey = null; this.refresh(); }
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && open && SuggestList.current()) {
      e.preventDefault();
      this.accept(SuggestList.current());
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      SuggestList.hide(this);
      this.dismissed = true;
      this.commit();
      return;
    }
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      this.dismissed = false; this.lastKey = null; this.refresh();
    }
  }

  listOpened(id) { this.input.setAttribute('aria-expanded', 'true'); this.input.setAttribute('aria-controls', id); }
  listClosed() { this.input.setAttribute('aria-expanded', 'false'); this.input.removeAttribute('aria-activedescendant'); }
  activeChanged(id) {
    if (id) this.input.setAttribute('aria-activedescendant', id);
    else this.input.removeAttribute('aria-activedescendant');
  }

  commit() {
    if (this.text === this.committed) return;
    this.committed = this.text;
    this.onCommit?.(this.text);
  }
  changed() {}
  caretMoved() {}
  afterAccept() {}
  blurred() {
    const clean = this.format?.(this.text);
    if (clean != null && clean !== this.text) {
      this.input.value = clean;
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.commit();
  }
}

export class QueryField extends SuggestField {
  constructor(textarea, { status, onInput, ...opts }) {
    super(textarea, opts);
    this.hl = textarea.parentElement.querySelector('.rule-query-hl');
    this.status = status;
    this.onInput = onInput;
    this.paint();
    this.renderStatus();
  }

  changed() {
    if (this.input.value.includes('\n')) {
      const c = this.input.selectionStart;
      this.input.value = this.input.value.replace(/\n/g, ' ');
      this.input.setSelectionRange(c, c);
    }
    this.paint();
    this.onInput(this.text);
    this.renderStatus();
  }

  caretMoved() { this.paint(); this.renderStatus(); }

  blurred() {
    const clean = formatQuery(this.text);
    if (clean !== this.text) { this.input.value = clean; this.onInput(clean); }
    this.paint();
    this.renderStatus();
    this.commit();
  }

  errors() {
    return visibleErrors(this.text, this.focused ? this.input.selectionStart : -1);
  }

  paint() {
    const errs = this.errors();
    this.hl.innerHTML = queryHTML(this.text, errs) + ' ';
    this.input.classList.toggle('invalid', errs.length > 0);
    this.input.style.height = '0px';
    this.input.style.height = this.input.scrollHeight + 'px';
  }

  // While the field has focus its status rides the suggestion list, which
  // covers the rule anyway; under the rule it would shift the dialog on every
  // focus change. An error stays under the rule once the field is left.
  renderStatus() {
    const errs = this.errors();
    const err = errs[0]?.msg ?? null;
    if (this.status) {
      const shown = this.focused ? null : err;
      this.status.textContent = shown ?? '';
      this.status.classList.toggle('err', !!shown);
    }
    if (!this.focused) { this.statusLine = null; return; }
    if (err) { this.statusLine = { html: esc(err), err: true }; SuggestList.refreshStatus(this); return; }
    const d = describeAt(this.text, this.input.selectionStart);
    const head = d ? `<code>${esc(d.field ?? d.op)}</code> ${esc(d.desc)}` : null;
    this.statusLine = head ? { html: head } : null;
    SuggestList.refreshStatus(this);
  }
}

export function queryHTML(s, errors = []) {
  const cls = new Array(s.length).fill('');
  const mark = (a, b, c) => { for (let k = a; k < b; k++) cls[k] = c; };
  for (const t of analyzeQuery(s).tokens) {
    if (t.kind === 'clause') {
      mark(t.start, t.nameEnd, 'q-field');
      mark(t.colon, t.colon + 1, 'q-punct');
      for (const it of t.items) mark(it.start, it.end, 'q-value');
    } else if (t.kind === 'op') mark(t.start, t.end, 'q-op');
    else if (t.kind === 'word') mark(t.start, t.end, 'q-word');
    else mark(t.start, t.end, 'q-punct');
  }
  const err = new Array(s.length).fill(false);
  for (const e of errors) for (let k = e.start; k < Math.min(e.end, s.length); k++) err[k] = true;
  let html = '';
  for (let k = 0; k < s.length;) {
    let j = k;
    while (j < s.length && cls[j] === cls[k] && err[j] === err[k]) j++;
    const c = (cls[k] + (err[k] ? ' q-err' : '')).trim();
    const text = esc(s.slice(k, j));
    html += c ? `<span class="${c}">${text}</span>` : text;
    k = j;
  }
  return html;
}
