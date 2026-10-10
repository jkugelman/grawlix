'use strict';

// ─── Wordlist form ──────────────────────────────────────────────────────────
// A wordlist's setup fields: publisher, rules option, icon, name, auto-update
// URL, and (adding only) a file to import. Add wordlist opens over Manage's
// General tab, so two coexist and nothing inside may carry an id.

import { EMOJI_LIST, WORDLIST_PUBLISHERS } from '../core/constants.js';
import { esc, nameFromPath, revalidatesOnGet } from '../core/util.js';
import { validateWordlistChunk } from '../engine/norm.js';
import { rescoreRulesEqual } from '../engine/rescore.js';
import { buildInitialsIconHTML, buildIconHTML, colorSeed } from './icons.js';
import { buildUrlInputHTML } from './components.js';
import { buildRulesListHTML } from './rescore-editor.js';
import { bindDropZone } from './dialogs/import-guide.js';

const HTTP_REASON = { 400:'Bad Request', 401:'Unauthorized', 403:'Forbidden', 404:'Not Found',
  405:'Method Not Allowed', 410:'Gone', 429:'Too Many Requests', 500:'Internal Server Error',
  502:'Bad Gateway', 503:'Service Unavailable', 504:'Gateway Timeout' };

export function publisherRules(publisher, option) {
  if (!publisher || option === 'none') return null;
  if (option === 'levels') return publisher.defaultRules.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' }));
  return publisher.defaultRules.map(r => ({ ...r }));
}

export class WordlistForm {
  // rulesOption: false hides the publisher-rules picker, for a host (Manage)
  // whose rule editor offers the same choices through Reset and Disable rescoring.
  constructor({ mode, onChange = () => {}, preview = false, rulesOption = true, currentRules = () => [] }) {
    this.mode = mode;
    this.showRulesOption = rulesOption;
    this.onChange = onChange;
    this.preview = preview;
    this.currentRules = currentRules;
    this.wordlist = null;
    this.originalPublisher = null;
    this.publisher = null;
    this.icon = null;
    this.name = '';
    this.rulesOption = 'none';
    this.file = null;
    this.pickerOpen = false;
    this.urlTimer = null;
    this.urlAbort = null;

    this.el = document.createElement('div');
    this.el.className = 'wordlist-form';
    this.el.innerHTML = `
      <div class="configure-section">
        <div class="configure-section-label">Publisher</div>
        <div class="publisher-chips"></div>
        <div class="rules-option-row" hidden>
          <span class="rules-option-lbl">Scoring</span>
          <select class="rules-select"></select>
        </div>
        <div class="rules-preview-wrap" hidden></div>
      </div>
      <div class="configure-section">
        <div class="configure-icon-name-row">
          <div class="configure-section-label">Icon</div>
          <div class="configure-section-label">Name</div>
          <div class="icon-picker-trigger" tabindex="0" role="button" aria-label="Change icon">
            <div class="icon-preview-box"></div>
          </div>
          <input type="text" class="config-name-input" placeholder="Wordlist name" spellcheck="false" autocomplete="off" aria-label="Name">
        </div>
      </div>
      <div class="configure-section">
        <div class="configure-section-label">Auto-update URL</div>
        <div class="url-input-wrap">
          <svg class="url-input-icon" width="14" height="14" aria-hidden="true"><use href="#icon-globe"/></svg>
          <input class="url-input config-url-input" type="url" placeholder="Auto-update disabled" spellcheck="false" autocomplete="off" aria-label="Auto-update URL">
          <span class="url-check-icon" hidden></span>
        </div>
        <div class="source-meta source-url-meta"></div>
      </div>
      <div class="configure-section source-import-section" hidden>
        <div class="configure-section-label">Import</div>
        <div class="import-zone cfg-drop-zone">
          <span class="cfg-import-zone-label">Drop file here or click to browse</span>
          <input type="file" class="cfg-file-input" accept=".txt,.dict">
        </div>
      </div>`;

    // A native popover so it paints in the top layer, outside the dialog's
    // overflow-y:auto scroll box. An in-dialog child would force
    // overflow:visible, which hides the footer off-screen on short viewports.
    this.popup = document.createElement('div');
    this.popup.className = 'icon-picker-popup';
    this.popup.setAttribute('popover', 'manual');
    this.popup.innerHTML = `
      <div class="icon-picker-tabs">
        <button type="button" class="icon-picker-tab active" data-mode="emoji">Emoji</button>
        <button type="button" class="icon-picker-tab" data-mode="url">URL</button>
      </div>
      <div class="icon-picker-pane active" data-pane="emoji">
        <div class="icon-emoji-grid">
          <button type="button" class="icon-emoji-btn" data-auto></button>
          ${EMOJI_LIST.map(e => `<button type="button" class="icon-emoji-btn" data-emoji="${esc(e)}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="icon-picker-pane" data-pane="url">
        ${buildUrlInputHTML(null, 'https://example.com/icon.png')}
      </div>`;
    this.el.appendChild(this.popup);

    const q = sel => this.el.querySelector(sel);
    this.chipsEl       = q('.publisher-chips');
    this.rulesRow      = q('.rules-option-row');
    this.rulesSelect   = q('.rules-select');
    this.previewWrap   = q('.rules-preview-wrap');
    this.iconPreview   = q('.icon-preview-box');
    this.pickerTrigger = q('.icon-picker-trigger');
    this.nameInput     = q('.config-name-input');
    this.urlInput      = q('.config-url-input');
    this.urlCheckIcon  = q('.url-check-icon');
    this.urlMeta       = q('.source-url-meta');
    this.importSection = q('.source-import-section');
    this.zoneLabel     = q('.cfg-import-zone-label');
    this.imgUrlInput   = this.popup.querySelector('.url-input');

    this.wire();
  }

  load({ wordlist = null, name = '', icon = null, url = '', publisherId = null, rulesOption = 'none' } = {}) {
    this.wordlist = wordlist;
    this.originalPublisher = wordlist ? WORDLIST_PUBLISHERS.find(p => p.id === wordlist.publisherId) ?? null : null;
    this.publisher = WORDLIST_PUBLISHERS.find(p => p.id === publisherId) ?? null;
    this.icon = icon;
    this.name = name;
    this.rulesOption = rulesOption;
    this.file = null;
    this.closePicker();
    this.nameInput.classList.remove('invalid');
    this.nameInput.value = name;
    this.urlInput.value = url || '';
    this.iconPreview.innerHTML = buildIconHTML(icon, name, colorSeed(this.seedObj()));
    this.zoneLabel.textContent = 'Drop file here or click to browse';
    this.importSection.hidden = this.mode !== 'add';
    this.renderChips();
    this.renderRulesOption();
    this.renderPreview();
    this.resetUrlCheck();
    if (url && this.mode !== 'add') this.startUrlCheck(url);
  }

  values() {
    return {
      name: this.nameInput.value.trim(),
      icon: this.icon,
      url: this.urlInput.value.trim() || null,
      publisherId: this.publisher?.id ?? null,
      rulesOption: this.rulesOption,
      file: this.file,
    };
  }

  rulesToApply() {
    return publisherRules(this.publisher, this.rulesOption);
  }

  validate() {
    if (this.nameInput.value.trim()) return true;
    this.nameInput.focus();
    this.nameInput.classList.add('invalid');
    return false;
  }

  // For the owning dialog's capture-phase `cancel`: Escape closes only the picker.
  consumeEscape() {
    if (!this.pickerOpen) return false;
    this.closePicker();
    return true;
  }

  destroy() {
    this.closePicker();
    this.resetUrlCheck();
  }

  seedObj() {
    return this.wordlist || { url: this.urlInput.value.trim(), name: this.name };
  }

  wire() {
    this.wirePicker();
    this.chipsEl.addEventListener('click', e => {
      const chip = e.target.closest('.publisher-chip');
      if (!chip) return;
      this.selectPublisher(chip.dataset.publisherId ? WORDLIST_PUBLISHERS.find(p => p.id === chip.dataset.publisherId) : null);
    });
    this.rulesSelect.addEventListener('change', () => {
      this.rulesOption = this.rulesSelect.value;
      this.renderPreview();
      this.onChange();
    });
    this.nameInput.addEventListener('input', () => {
      this.name = this.nameInput.value;
      if (!this.icon) this.refreshInitials();
      this.onChange();
    });
    this.nameInput.addEventListener('focus', () => this.nameInput.classList.remove('invalid'));
    this.urlInput.addEventListener('input', () => {
      this.resetUrlCheck();
      const url = this.urlInput.value.trim();
      if (url) {
        this.urlCheckIcon.innerHTML = '<div class="url-check-spinner"></div>';
        this.urlCheckIcon.hidden = false;
        this.urlTimer = setTimeout(() => this.startUrlCheck(url), 600);
      }
      this.onChange();
    });
    bindDropZone(this.el.querySelector('.cfg-drop-zone'), this.el.querySelector('.cfg-file-input'), file => {
      this.file = file;
      this.zoneLabel.textContent = file.name;
      if (!this.nameInput.value.trim()) {
        this.name = nameFromPath(file.name);
        this.nameInput.value = this.name;
        if (!this.icon) this.refreshInitials();
      }
      this.onChange();
    });
  }

  // ── Icon picker ──────────────────────────────────────────────────────────

  refreshInitials() {
    const html = buildInitialsIconHTML(this.name, colorSeed(this.seedObj()));
    this.iconPreview.innerHTML = html;
    if (this.pickerOpen) this.popup.querySelector('[data-auto]').innerHTML = html;
  }

  setIcon(icon) {
    this.icon = icon;
    this.iconPreview.innerHTML = buildIconHTML(icon, this.name, colorSeed(this.seedObj()));
    this.onChange();
  }

  syncEmojiGrid() {
    const cur = this.icon?.type === 'emoji' ? this.icon.value : null;
    this.popup.querySelectorAll('.icon-emoji-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.hasAttribute('data-auto') ? !this.icon : btn.dataset.emoji === cur);
    });
  }

  showPickerMode(mode) {
    this.popup.querySelectorAll('.icon-picker-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    this.popup.querySelectorAll('.icon-picker-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === mode));
    if (mode === 'emoji') this.syncEmojiGrid();
    if (mode === 'url')   setTimeout(() => this.imgUrlInput.focus(), 30);
  }

  openPicker() {
    if (this.pickerOpen) return;
    this.popup.querySelector('[data-auto]').innerHTML = buildInitialsIconHTML(this.name, colorSeed(this.seedObj()));
    const tr = this.pickerTrigger.getBoundingClientRect();
    this.popup.style.top  = (tr.bottom + 4) + 'px';
    this.popup.style.left = tr.left + 'px';
    this.popup.showPopover();
    this.pickerOpen = true;
    document.addEventListener('mousedown', this.onOutsideDown);
    if (this.icon?.type === 'img') { this.imgUrlInput.value = this.icon.url; this.showPickerMode('url'); }
    else                           { this.imgUrlInput.value = '';            this.showPickerMode('emoji'); }
  }

  closePicker() {
    this.pickerOpen = false;
    document.removeEventListener('mousedown', this.onOutsideDown);
    if (this.popup.matches(':popover-open')) this.popup.hidePopover();
  }

  onOutsideDown = e => {
    if (this.popup.contains(e.target) || this.pickerTrigger.contains(e.target)) return;
    this.closePicker();
  };

  wirePicker() {
    const toggle = () => { this.pickerOpen ? this.closePicker() : this.openPicker(); };
    this.pickerTrigger.addEventListener('click', toggle);
    this.pickerTrigger.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    this.popup.querySelectorAll('.icon-picker-tab').forEach(tab => {
      tab.addEventListener('click', () => this.showPickerMode(tab.dataset.mode));
    });
    this.popup.querySelector('.icon-emoji-grid').addEventListener('click', e => {
      const btn = e.target.closest('.icon-emoji-btn');
      if (!btn) return;
      if (btn.hasAttribute('data-auto')) {
        this.setIcon(null);
      } else {
        const emoji = btn.dataset.emoji;
        const same = this.icon?.type === 'emoji' && this.icon.value === emoji;
        this.setIcon(same ? null : { type: 'emoji', value: emoji });
      }
      this.syncEmojiGrid();
      this.closePicker();
    });
    this.imgUrlInput.addEventListener('input', () => {
      const url = this.imgUrlInput.value.trim();
      this.setIcon(url ? { type: 'img', url } : null);
    });
  }

  // ── Publisher and rules option ───────────────────────────────────────────

  renderChips() {
    const chips = [...WORDLIST_PUBLISHERS].sort((a, b) => a.popularity - b.popularity).map(p => {
      const icon = buildIconHTML(p.icon, p.name, colorSeed(p));
      return `<button type="button" class="publisher-chip${this.publisher === p ? ' active' : ''}" data-publisher-id="${p.id}">${icon}${esc(p.name)}</button>`;
    });
    chips.push(`<button type="button" class="publisher-chip${!this.publisher ? ' active' : ''}" data-publisher-id="">Custom</button>`);
    this.chipsEl.innerHTML = chips.join('');
  }

  selectPublisher(publisher) {
    this.publisher = publisher;
    this.renderChips();
    if (publisher) {
      if (this.mode === 'add') {
        this.name = publisher.name;
        this.nameInput.value = publisher.name;
        this.urlInput.value = publisher.url || '';
        this.setIcon(publisher.icon ? { ...publisher.icon } : null);
      }
      this.rulesOption = this.mode === 'add' ? 'recommended' : 'none';
    } else {
      this.rulesOption = 'none';
    }
    this.renderRulesOption();
    this.renderPreview();
    this.onChange();
  }

  renderRulesOption() {
    if (!this.publisher || !this.showRulesOption) { this.rulesRow.hidden = true; return; }
    const isAdd = this.mode === 'add';
    const unchanged = !isAdd && this.publisher === this.originalPublisher;
    const recommendedIsNoop = unchanged && rescoreRulesEqual(this.currentRules(), this.publisher.defaultRules);
    const verb = isAdd ? 'Use' : unchanged ? 'Reapply' : 'Apply';
    const opts = [
      { value: 'recommended', label: `${verb} recommended rules`, disabled: recommendedIsNoop && this.rulesOption !== 'recommended' },
      { value: 'levels',      label: `${verb} scoring levels only` },
      { value: 'none',        label: isAdd ? 'None' : 'Do not change rules' },
    ];
    this.rulesSelect.innerHTML = opts.map(o =>
      `<option value="${o.value}"${this.rulesOption === o.value ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${o.label}</option>`
    ).join('');
    this.rulesRow.hidden = false;
  }

  // Manage resets the option once the rules are edited by hand, so the select
  // never claims a publisher's rules that the draft no longer holds.
  setRulesOption(option) {
    this.rulesOption = option;
    this.renderRulesOption();
    this.renderPreview();
  }

  renderPreview() {
    const rules = this.preview ? this.rulesToApply() : null;
    this.previewWrap.hidden = !rules;
    if (!rules) return;
    this.previewWrap.innerHTML = buildRulesListHTML(rules, {
      rulesId: '', saveFn: '', deleteFn: '', rescore: true, readOnly: true,
    });
  }

  // ── URL check ────────────────────────────────────────────────────────────

  resetUrlCheck() {
    clearTimeout(this.urlTimer);
    if (this.urlAbort) { this.urlAbort.abort(); this.urlAbort = null; }
    this.urlCheckIcon.hidden = true;
    this.urlMeta.classList.remove('visible');
  }

  startUrlCheck(url) {
    this.urlCheckIcon.innerHTML = '<div class="url-check-spinner"></div>';
    this.urlCheckIcon.hidden = false;
    this.urlAbort = new AbortController();
    this.checkUrl(url, this.urlAbort.signal);
  }

  setUrlCheck(icon, cls, msg) {
    this.urlCheckIcon.innerHTML = icon;
    this.urlCheckIcon.hidden = false;
    if (!msg) { this.urlMeta.classList.remove('visible'); return; }
    this.urlMeta.innerHTML = `<span class="${cls}">${msg}</span>`;
    this.urlMeta.classList.add('visible');
  }

  async checkUrl(url, signal) {
    const err  = msg => this.setUrlCheck('<span class="url-check-err-icon">✗</span>', 'url-check-error', msg);
    const warn = msg => this.setUrlCheck('⚠️', 'url-check-warn', msg);

    let hasContentLength = false;
    try {
      const headResp = await fetch(url, { method: 'HEAD', signal });
      if (!headResp.ok) {
        const reason = headResp.statusText || HTTP_REASON[headResp.status] || '';
        err(`Server returned ${headResp.status}${reason ? ' ' + esc(reason) : ''}`);
        return;
      }
      hasContentLength = !!headResp.headers.get('content-length');
    } catch (e) {
      if (e.name !== 'AbortError') err('Unreachable — possible CORS restriction');
      return;
    }

    let chunkText = '';
    try {
      const rangeResp = await fetch(url, { method: 'GET', headers: { 'Range': 'bytes=0-1023' }, signal });
      if (rangeResp.body) {
        const reader = rangeResp.body.getReader();
        try {
          const { value } = await reader.read();
          if (value) chunkText = new TextDecoder().decode(value);
        } finally {
          reader.cancel();
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') warn("Can't verify content");
      return;
    }

    if (!validateWordlistChunk(chunkText)) { err('Not a wordlist file'); return; }
    if (hasContentLength || revalidatesOnGet(url)) this.setUrlCheck('<span class="url-check-ok-icon">✓</span>');
    else warn('Update checking unavailable (no content-length)');
  }
}
