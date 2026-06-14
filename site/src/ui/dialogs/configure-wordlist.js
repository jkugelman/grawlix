'use strict';

import { EMOJI_LIST, WORDLIST_PUBLISHERS } from '../../core/constants.js';
import { esc, nameFromPath } from '../../core/util.js';
import { validateWordlistChunk } from '../../engine/norm.js';
import { newDbKey } from '../../data/state.js';
import { getPublisher } from '../../data/publishers.js';
import {
  batchUpdate, setWordlistName, setWordlistIcon, setWordlistUrl, setWordlistPublisher, setWordlistRescoreRules,
} from '../../data/persist.js';
import { buildInitialsIconHTML, buildIconHTML, colorSeed } from '../icons.js';
import { buildUrlInputHTML } from '../components.js';
import { buildRulesListHTML } from '../rescore-editor.js';
import { createDialog, showDialog } from './dialog.js';
import { bindDropZone } from './import-guide.js';

let _addNewWordlist = () => {};
let _fetchWordlist = () => {};
let _ingestFile = () => {};
let _deleteWordlist = async () => false;
export function configureConfigureWordlist({ addNewWordlist, fetchWordlist, ingestFile, deleteWordlist }) {
  if (addNewWordlist) _addNewWordlist = addNewWordlist;
  if (fetchWordlist)  _fetchWordlist = fetchWordlist;
  if (ingestFile)     _ingestFile = ingestFile;
  if (deleteWordlist) _deleteWordlist = deleteWordlist;
}

export const ConfigureWordlistDialog = (() => {
  let el, pickerPopup;

  // State
  let _mode           = 'configure';
  let _wordlist           = null;
  let _pickerOpen     = false;
  let _selectedPublisher = null;
  let _originalPublisher = null;
  let _pendingIcon    = null;
  let _pendingName    = '';
  let _rulesOption    = 'none';
  let _pendingFile    = null;
  let _onAdded        = null;

  // Elements
  let titleEl, publisherChipsEl, rulesOptionRow, rulesSelect, rulesPreviewWrap,
      iconPreview, pickerTrigger, imgUrlInput, nameInput, urlInput, urlCheckIcon,
      urlMetaEl, importSection, btnSave, btnDelete, importZoneLabel;

  // ── Icon picker ──────────────────────────────────────────────────────────────

  function colorSeedObj() {
    return _wordlist || { url: urlInput.value.trim(), name: _pendingName };
  }

  function setBufferedIcon(icon) {
    _pendingIcon = icon;
    iconPreview.innerHTML = buildIconHTML(icon, _pendingName, colorSeed(colorSeedObj()));
  }

  function syncEmojiGrid() {
    const cur = _pendingIcon?.type === 'emoji' ? _pendingIcon.value : null;
    pickerPopup.querySelectorAll('.icon-emoji-btn').forEach(btn => {
      if (btn.hasAttribute('data-auto')) {
        btn.classList.toggle('selected', !_pendingIcon);
      } else {
        btn.classList.toggle('selected', btn.dataset.emoji === cur);
      }
    });
  }

  function showPickerMode(mode) {
    pickerPopup.querySelectorAll('.icon-picker-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    pickerPopup.querySelectorAll('.icon-picker-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === mode));
    if (mode === 'emoji') syncEmojiGrid();
    if (mode === 'url')   setTimeout(() => imgUrlInput.focus(), 30);
  }

  function openPicker() {
    _pickerOpen = true;
    pickerPopup.querySelector('[data-auto]').innerHTML = buildInitialsIconHTML(_pendingName, colorSeed(colorSeedObj()));
    const tr = pickerTrigger.getBoundingClientRect();
    const dr = el.getBoundingClientRect();
    pickerPopup.style.top  = (tr.bottom - dr.top + 4) + 'px';
    pickerPopup.style.left = (tr.left - dr.left) + 'px';
    pickerPopup.hidden = false;
    if (_pendingIcon?.type === 'img') { imgUrlInput.value = _pendingIcon.url; showPickerMode('url'); }
    else                              { imgUrlInput.value = '';                showPickerMode('emoji'); }
  }

  function closePicker() {
    _pickerOpen = false;
    pickerPopup.hidden = true;
  }

  function wireIconPicker() {
    pickerTrigger.addEventListener('click',   () => { _pickerOpen ? closePicker() : openPicker(); });
    pickerTrigger.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _pickerOpen ? closePicker() : openPicker(); } });

    el.addEventListener('mousedown', e => {
      if (!_pickerOpen) return;
      if (pickerPopup.contains(e.target) || pickerTrigger.contains(e.target)) return;
      closePicker();
    });

    pickerPopup.querySelectorAll('.icon-picker-tab').forEach(tab => {
      tab.addEventListener('click', () => showPickerMode(tab.dataset.mode));
    });

    pickerPopup.querySelector('#icon-emoji-grid').addEventListener('click', e => {
      const btn = e.target.closest('.icon-emoji-btn');
      if (!btn) return;
      if (btn.hasAttribute('data-auto')) {
        setBufferedIcon(null);
      } else {
        const emoji = btn.dataset.emoji;
        const same = _pendingIcon?.type === 'emoji' && _pendingIcon.value === emoji;
        setBufferedIcon(same ? null : { type: 'emoji', value: emoji });
      }
      syncEmojiGrid();
      closePicker();
    });

    imgUrlInput.addEventListener('input', () => {
      const url = imgUrlInput.value.trim();
      setBufferedIcon(url ? { type: 'img', url } : null);
    });
  }

  // ── Publisher chips ──────────────────────────────────────────────────────────

  function renderPublisherChips() {
    const chips = [...WORDLIST_PUBLISHERS].sort((a, b) => a.popularity - b.popularity).map(p => {
      const icon = buildIconHTML(p.icon, p.name, colorSeed(p));
      return `<button class="publisher-chip${_selectedPublisher === p ? ' active' : ''}" data-publisher-id="${p.id}">${icon}${esc(p.name)}</button>`;
    });
    chips.push(`<button class="publisher-chip${!_selectedPublisher ? ' active' : ''}" data-publisher-id="">Custom</button>`);
    publisherChipsEl.innerHTML = chips.join('');
  }

  function selectPublisher(publisher) {
    _selectedPublisher = publisher;
    renderPublisherChips();
    if (publisher) {
      if (_mode === 'add') {
        _pendingName = publisher.name;
        nameInput.value = publisher.name;
        setBufferedIcon(publisher.icon ? { ...publisher.icon } : null);
        urlInput.value = publisher.url || '';
      }
      _rulesOption = _mode === 'add' ? 'recommended' : 'none';
    }
    updateRulesOptionRow();
    updateRulesPreview();
  }

  function wirePublisherChips() {
    publisherChipsEl.addEventListener('click', e => {
      const chip = e.target.closest('.publisher-chip');
      if (!chip) return;
      const publisher = chip.dataset.publisherId ? WORDLIST_PUBLISHERS.find(p => p.id === chip.dataset.publisherId) : null;
      selectPublisher(publisher);
    });
  }

  // ── Rules option ─────────────────────────────────────────────────────────────

  function updateRulesOptionRow() {
    if (!_selectedPublisher) { rulesOptionRow.hidden = true; return; }
    const isAdd = _mode === 'add';
    const publisherUnchanged = !isAdd && _selectedPublisher?.id === _originalPublisher?.id;
    const recommendedIsNoop  = publisherUnchanged && rulesMatchDefaultRules(_wordlist, _selectedPublisher);
    const applyVerb = isAdd ? 'Use' : publisherUnchanged ? 'Reapply' : 'Apply';
    const opts = [
      { value: 'recommended', label: `${applyVerb} recommended rules`, disabled: recommendedIsNoop },
      { value: 'levels',      label: `${applyVerb} scoring levels only` },
      { value: 'none',        label: isAdd ? 'None' : 'Do not change rules' },
    ];
    rulesSelect.innerHTML = opts.map(o =>
      `<option value="${o.value}"${_rulesOption === o.value ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${o.label}</option>`
    ).join('');
    rulesOptionRow.hidden = false;
  }

  function rulesMatchDefaultRules(wordlist, publisher) {
    const publisherRules = publisher?.defaultRules || [];
    const wordlistRules  = wordlist?.rescoreRules || [];
    if (wordlistRules.length !== publisherRules.length) return false;
    return wordlistRules.every((r, i) => {
      const p = publisherRules[i];
      return r.input === p.input && r.length === p.length && r.output === p.output && (r.note ?? '') === (p.note ?? '');
    });
  }

  function updateRulesPreview() {
    if (!_selectedPublisher || _rulesOption === 'none') { rulesPreviewWrap.hidden = true; return; }
    const rules = _rulesOption === 'levels'
      ? _selectedPublisher.defaultRules.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' }))
      : _selectedPublisher.defaultRules;
    rulesPreviewWrap.hidden = false;
    rulesPreviewWrap.innerHTML = buildRulesListHTML(rules || [], {
      rulesId: 'preview-rules',
      saveFn: '', deleteFn: '',
      rescore: true,
      readOnly: true,
    });
  }

  function wireRulesSelect() {
    rulesSelect.addEventListener('change', () => {
      _rulesOption = rulesSelect.value;
      updateRulesPreview();
    });
  }

  // ── Name input ────────────────────────────────────────────────────────────────

  function wireNameInput() {
    nameInput.addEventListener('input', () => {
      _pendingName = nameInput.value;
      if (!_pendingIcon) {
        iconPreview.innerHTML = buildInitialsIconHTML(_pendingName, colorSeed(colorSeedObj()));
        if (_pickerOpen) pickerPopup.querySelector('[data-auto]').innerHTML = buildInitialsIconHTML(_pendingName, colorSeed(colorSeedObj()));
      }
    });

    nameInput.addEventListener('focus', () => nameInput.classList.remove('invalid'));
  }

  // ── URL guardrail check ───────────────────────────────────────────────────────

  let _urlCheckTimer = null;
  let _urlCheckAbort = null;

  const HTTP_REASON = { 400:'Bad Request', 401:'Unauthorized', 403:'Forbidden', 404:'Not Found',
    405:'Method Not Allowed', 410:'Gone', 429:'Too Many Requests', 500:'Internal Server Error',
    502:'Bad Gateway', 503:'Service Unavailable', 504:'Gateway Timeout' };

  function setUrlCheckError(msg) {
    urlCheckIcon.innerHTML = '<span class="url-check-err-icon">✗</span>';
    urlCheckIcon.hidden = false;
    urlMetaEl.innerHTML = `<span class="url-check-error">${msg}</span>`;
    urlMetaEl.classList.add('visible');
  }
  function setUrlCheckWarn(msg) {
    urlCheckIcon.textContent = '⚠️';
    urlCheckIcon.hidden = false;
    urlMetaEl.innerHTML = `<span class="url-check-warn">${msg}</span>`;
    urlMetaEl.classList.add('visible');
  }
  function setUrlCheckOk() {
    urlCheckIcon.innerHTML = '<span class="url-check-ok-icon">✓</span>';
    urlCheckIcon.hidden = false;
    urlMetaEl.classList.remove('visible');
  }

  async function checkUrl(url, signal) {
    // Step 1: HEAD — reachability + content-length (needed for update checking)
    let hasContentLength = false;
    try {
      const headResp = await fetch(url, { method: 'HEAD', signal });
      if (!headResp.ok) {
        const reason = headResp.statusText || HTTP_REASON[headResp.status] || '';
        setUrlCheckError(`Server returned ${headResp.status}${reason ? ' ' + esc(reason) : ''}`);
        return;
      }
      hasContentLength = !!headResp.headers.get('content-length');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setUrlCheckError('Unreachable — possible CORS restriction');
      return;
    }

    // Step 2: Range GET — fetch first 1 KB and validate content
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
    } catch (err) {
      if (err.name === 'AbortError') return;
      setUrlCheckWarn("Can't verify content");
      return;
    }

    if (!validateWordlistChunk(chunkText)) {
      setUrlCheckError('Not a wordlist file');
      return;
    }

    if (hasContentLength) {
      setUrlCheckOk();
    } else {
      setUrlCheckWarn('Update checking unavailable (no content-length)');
    }
  }

  function wireUrlAndFile() {
    urlInput.addEventListener('input', () => {
      clearTimeout(_urlCheckTimer);
      if (_urlCheckAbort) { _urlCheckAbort.abort(); _urlCheckAbort = null; }
      const url = urlInput.value.trim();
      if (!url) { urlCheckIcon.hidden = true; urlMetaEl.classList.remove('visible'); return; }
      urlCheckIcon.innerHTML = '<div class="url-check-spinner"></div>';
      urlCheckIcon.hidden = false;
      urlMetaEl.classList.remove('visible');
      _urlCheckTimer = setTimeout(() => {
        _urlCheckAbort = new AbortController();
        checkUrl(url, _urlCheckAbort.signal);
      }, 600);
    });

    bindDropZone(el.querySelector('#cfg-drop-zone'), el.querySelector('#cfg-file-input'), file => {
      _pendingFile = file;
      importZoneLabel.textContent = file.name;
      if (!nameInput.value.trim()) {
        _pendingName = nameFromPath(file.name);
        nameInput.value = _pendingName;
        if (!_pendingIcon) iconPreview.innerHTML = buildInitialsIconHTML(_pendingName, colorSeed(colorSeedObj()));
      }
    });
  }

  // ── Save / Add ────────────────────────────────────────────────────────────────

  function computeRulesToApply() {
    if (!_selectedPublisher) return _mode === 'add' ? [] : null;
    if (_rulesOption === 'recommended') return JSON.parse(JSON.stringify(_selectedPublisher.defaultRules || []));
    if (_rulesOption === 'levels')      return _selectedPublisher.defaultRules.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' }));
    return _mode === 'add' ? [] : null;
  }

  function wireSaveAndClose() {
    btnSave.onclick = () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); nameInput.classList.add('invalid'); return; }
      const rules = computeRulesToApply();
      const url   = urlInput.value.trim() || null;

      if (_mode === 'add') {
        const wordlist = _addNewWordlist({
          dbKey: newDbKey(), icon: _pendingIcon, name,
          url, enabled: false, populated: false,
          ...(_selectedPublisher ? { publisherId: _selectedPublisher.id } : {}),
          rescoreRules: rules || [],
        });
        _onAdded?.(wordlist);
        el.close();
        if (url) {
          _fetchWordlist(wordlist);
        } else if (_pendingFile) {
          _ingestFile(_pendingFile, wordlist, name);
        }
      } else {
        batchUpdate(() => {
          setWordlistName(_wordlist, name);
          setWordlistIcon(_wordlist, _pendingIcon);
          setWordlistUrl(_wordlist, url);
          setWordlistPublisher(_wordlist, _selectedPublisher?.id ?? null);
          if (rules !== null) setWordlistRescoreRules(_wordlist, rules);
        });
        el.close();
      }
    };

    btnDelete.onclick = async () => {
      if (await _deleteWordlist(_wordlist)) el.close();
    };

    el.addEventListener('cancel', e => { if (_pickerOpen) { e.preventDefault(); closePicker(); } });
    el.addEventListener('close',  () => {
      closePicker();
      clearTimeout(_urlCheckTimer);
      if (_urlCheckAbort) { _urlCheckAbort.abort(); _urlCheckAbort = null; }
    });
  }

  // ── open (configure mode) ─────────────────────────────────────────────────────

  function open(wordlist) {
    _mode           = 'configure';
    _wordlist           = wordlist;
    _pickerOpen     = false;
    _selectedPublisher = getPublisher(wordlist);
    _originalPublisher = _selectedPublisher;
    _pendingIcon    = wordlist.icon || null;
    _pendingName    = wordlist.name || '';
    _pendingFile    = null;
    _rulesOption    = 'none';
    _onAdded        = null;

    titleEl.textContent = 'Configure Wordlist';
    btnSave.textContent = 'Save';
    btnDelete.hidden = false;
    pickerPopup.hidden = true;
    nameInput.classList.remove('invalid');
    iconPreview.innerHTML = buildIconHTML(wordlist.icon, wordlist.name, colorSeed(wordlist));
    nameInput.value = wordlist.name || '';
    urlInput.value  = wordlist.url  || '';

    renderPublisherChips();
    updateRulesOptionRow();
    updateRulesPreview();
    if (wordlist.url) {
      urlCheckIcon.innerHTML = '<div class="url-check-spinner"></div>';
      urlCheckIcon.hidden = false;
      urlMetaEl.classList.remove('visible');
      _urlCheckAbort = new AbortController();
      checkUrl(wordlist.url, _urlCheckAbort.signal);
    } else {
      urlCheckIcon.hidden = true;
      urlMetaEl.classList.remove('visible');
    }
    importSection.hidden = true;

    showDialog(el);
  }

  // ── openAdd (add mode) ────────────────────────────────────────────────────────

  function openAdd(onAdded = null) {
    _mode           = 'add';
    _wordlist           = null;
    _pickerOpen     = false;
    _selectedPublisher = null;
    _originalPublisher = null;
    _pendingIcon    = null;
    _pendingName    = '';
    _pendingFile    = null;
    _rulesOption    = 'none';
    _onAdded        = onAdded;

    titleEl.textContent = 'Add Wordlist';
    btnSave.textContent = 'Add';
    btnDelete.hidden = true;
    pickerPopup.hidden = true;
    nameInput.classList.remove('invalid');
    iconPreview.innerHTML = buildInitialsIconHTML('', colorSeed({ name: '' }));
    nameInput.value = '';
    urlInput.value  = '';
    urlCheckIcon.hidden = true;
    urlMetaEl.classList.remove('visible');
    importZoneLabel.textContent = 'Drop file here or click to browse';

    renderPublisherChips();
    updateRulesOptionRow();
    updateRulesPreview();

    importSection.hidden = false;

    showDialog(el);
  }

  function mount() {
    let body;
    ({ el, body } = createDialog('configure-wordlist-dialog', { labelledby: 'configure-wordlist-title', dismissOnBackdrop: false }));
    body.innerHTML = `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="configure-wordlist-title"></h2>
      <div class="configure-section">
        <div class="configure-section-label">Publisher</div>
        <div class="publisher-chips" id="publisher-chips"></div>
        <div class="rules-option-row" id="rules-option-row" hidden>
          <span class="rules-option-lbl">Scoring</span>
          <select id="rules-select"></select>
        </div>
        <div class="rules-preview-wrap" id="rules-preview-wrap" hidden></div>
      </div>
      <div class="configure-section">
        <div class="configure-icon-name-row">
          <div class="configure-section-label">Icon</div>
          <div class="configure-section-label">Name</div>
          <div class="icon-picker-trigger" id="icon-picker-trigger" tabindex="0" role="button" aria-label="Change icon">
            <div class="icon-preview-box" id="config-icon-preview"></div>
          </div>
          <input type="text" id="config-name-input" class="config-name-input" placeholder="Wordlist name" spellcheck="false" autocomplete="off">
        </div>
      </div>
      <div class="configure-section">
        <div class="configure-section-label">Auto-update URL</div>
        <div class="url-input-wrap">
          <svg class="url-input-icon" width="14" height="14" aria-hidden="true"><use href="#icon-globe"/></svg>
          <input class="url-input" id="config-url-input" type="url" placeholder="Auto-update disabled" spellcheck="false" autocomplete="off">
          <span id="url-check-icon" hidden></span>
        </div>
        <div id="source-url-meta" class="source-meta"></div>
      </div>
      <div class="configure-section" id="source-import-section" hidden>
        <div class="configure-section-label">Import</div>
        <div id="source-file-add-zone">
          <div class="import-zone" id="cfg-drop-zone">
            <span id="cfg-import-zone-label">Drop file here or click to browse</span>
            <input type="file" id="cfg-file-input" accept=".txt,.dict">
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button id="btn-cfg-delete" class="delete-link" title="Delete this wordlist">Delete</button>
        <button id="btn-cfg-cancel" class="dialog-cancel-btn">Cancel</button>
        <button class="primary" id="btn-cfg-save"></button>
      </div>`;

    // Popup lives inside the dialog so it's in the top layer with it
    pickerPopup = document.createElement('div');
    pickerPopup.id = 'icon-picker-popup';
    pickerPopup.hidden = true;
    pickerPopup.innerHTML = `
      <div class="icon-picker-tabs">
        <button class="icon-picker-tab active" data-mode="emoji">Emoji</button>
        <button class="icon-picker-tab" data-mode="url">URL</button>
      </div>
      <div class="icon-picker-pane active" data-pane="emoji">
        <div class="icon-emoji-grid" id="icon-emoji-grid">
          <button class="icon-emoji-btn" data-auto></button>
          ${EMOJI_LIST.map(e => `<button class="icon-emoji-btn" data-emoji="${esc(e)}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="icon-picker-pane" data-pane="url">
        ${buildUrlInputHTML('icon-img-url-input', 'https://example.com/icon.png')}
      </div>`;
    el.appendChild(pickerPopup);

    titleEl          = el.querySelector('#configure-wordlist-title');
    publisherChipsEl = el.querySelector('#publisher-chips');
    rulesOptionRow   = el.querySelector('#rules-option-row');
    rulesSelect      = el.querySelector('#rules-select');
    rulesPreviewWrap = el.querySelector('#rules-preview-wrap');
    iconPreview      = el.querySelector('#config-icon-preview');
    pickerTrigger    = el.querySelector('#icon-picker-trigger');
    imgUrlInput      = el.querySelector('#icon-img-url-input');
    nameInput        = el.querySelector('#config-name-input');
    urlInput         = el.querySelector('#config-url-input');
    urlCheckIcon     = el.querySelector('#url-check-icon');
    urlMetaEl        = el.querySelector('#source-url-meta');
    importSection    = el.querySelector('#source-import-section');
    btnSave          = el.querySelector('#btn-cfg-save');
    btnDelete        = el.querySelector('#btn-cfg-delete');
    importZoneLabel  = el.querySelector('#cfg-import-zone-label');

    wireIconPicker();
    wirePublisherChips();
    wireRulesSelect();
    wireNameInput();
    wireUrlAndFile();
    wireSaveAndClose();
  }

  return { mount, open, openAdd };
})();
