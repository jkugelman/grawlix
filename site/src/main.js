'use strict';

import { MERGED_ID, MERGED_NAME, EMOJI_LIST, WORDLIST_PUBLISHERS } from './core/constants.js';
import { esc, nameFromPath } from './core/util.js';
import { getBrowser } from './core/platform.js';
import { effect } from './core/signals.js';
import { toNorm, displayOf, parseWordlist, buildUserWlEntry, validateWordlistChunk } from './engine/norm.js';
import {
  configureIO as configureSegmenterIO, loadUnigramCorpus, setUnigramCorpus as segmenterSetCorpus,
} from './engine/segmenter.js';
import { TOOLS, makeToolRow } from './engine/tools.js';
import { syncStatus$, state, newDbKey, syncKey, getEditsWordlist } from './data/state.js';
import { lsSave, lsLoad, getDb, openDB, idbPut, idbGet, Storage } from './data/storage.js';
import { migrateSettings } from './data/migrations.js';
import { serializeEntries, getOutputFormat, setOutputFormat } from './data/serialize.js';
import { getPublisher } from './data/publishers.js';
import { buildMergedWordlist, getActiveCorpus, mergeKey, invalidateSourceCounts, peekMergedCache } from './data/merge.js';
import {
  persistMeta, batchUpdate, setWordlistName, setWordlistIcon, setWordlistUrl, setWordlistPublisher, setWordlistEnabled, setWordlistRescoreRules, reorderSources,
} from './data/persist.js';
import {
  configureSyncDialogs, syncTargets, persistSyncTarget, isMirrorList, editsSyncKey, listForSyncKey, syncFilename, SyncStatus, Disk, MirrorSync, EditsSync, threeWayMergeEdits, attachMirrorSync, attachEditsSync, rescoredFilename, activateSyncTarget,
} from './data/disk-sync.js';
import { buildInitialsIconHTML, buildIconHTML, colorSeed } from './ui/icons.js';
import { buildClearableInputHTML, mountClearableInputs, toggleSplitMenu, buildUrlInputHTML } from './ui/components.js';
import { createDialog, showDialog } from './ui/dialogs/dialog.js';
import { showConfirm, showAlert, showMergeConflict, showEditsConflict } from './ui/dialogs/confirm.js';
import { openUpdateSummaryDialog } from './ui/dialogs/update-summary.js';
import { SettingsDialog, configureSettings } from './ui/dialogs/settings.js';
import { WelcomeDialog } from './ui/dialogs/welcome.js';
import { AppView } from './ui/app-view.js';
import { configureEntriesTable, GroupMorePopover, ErrorPopover } from './ui/entries-table.js';
import { ToolStack, ToolPicker, configureToolStack, mountGroupColumnStyle, pipelineIdle } from './ui/tool-stack.js';
import { mountHistogramPointer, onHistogramPointerDown } from './ui/histogram-view.js';
import {
  configureRescoreEditor, buildRulesListHTML, startNoteEdit, onRuleInput, saveRuleField, deleteRule, addRule, resetRescoreRules, neutralizeRescoreRules, saveScoringField, deleteScoringRow, addScoringRow, resetScoringRules,
} from './ui/rescore-editor.js';
import { WordlistSelector, renderSyncIndicators, buildWordlistNameHTML } from './ui/scope-selector.js';
import { configureManagePanel, ManagePanel } from './ui/manage-panel.js';
import { configureDiscoveryBanner, DiscoveryBanner } from './ui/discovery-banner.js';
import {
  configureRendering, getEntriesScroller, setScope, renderAll, renderSources, refreshMergedScroller, renderMergedDetail, mountStatsBarOverflowObservers, mountHeaderHeightObserver, attachHelpPopups,
} from './ui/rendering.js';
import { Router } from './app/router.js';
import {
  WordlistActions, configureActions, init, _ready, regenerateFillOutputs, persistEdits, bakeRescoring, bakeMenuOpts, applyWordlistText, fetchWordlist, checkForUpdates, ingestFile, getAutoUpdate, addNewWordlist, deleteFromEdits, saveEdit, attachExternalEditHandlers, refreshDerivedDisplays, downloadSourceWordlist, downloadOriginalWordlist, buildExportMenuHTML, exportFilename, buildWordlistText, buildCopyText, buildCSVText, buildExportJSONObject, exportCopy, exportWordlist, exportCSV, exportJSON,
} from './app/actions.js';

// ─── Components ──────────────────────────────────────────────────────────────

// The × button carries no per-call wiring: clicking it empties the field and
// dispatches an `input` event, so the field's own handler reacts as if the
// user erased the text by hand.
function buildScoreRangeInputHTML(inputId, value, viewName) {
  const input = `<input type="text" id="${inputId}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(value)}" oninput="${viewName}.onScoreRange(this.value)">`;
  return `<label class="score-range-label" title="50, 50-59, or 50+ (Alt-C)">Score ${buildClearableInputHTML(input, !!value)}</label>`;
}

// ─── Boot reconnect splash ────────────────────────────────────────────────────

// Must run inside a click — FSA gates requestPermission/pickers on a user gesture,
// so calling this off a gesture silently fails.
async function regrantSyncTarget(key) {
  const t = syncTargets.get(key);
  if (!t) return false;
  if (await Disk.requestPermission(t.handle, 'readwrite') && await Disk.lastModified(t.handle) !== null) {
    await activateSyncTarget(key);
    SyncStatus.set(key, 'synced');
    return true;
  }
  return repickSyncTarget(key);
}

async function repickSyncTarget(key) {
  const isEdits = key === editsSyncKey();
  let handle;
  if (isEdits) {
    handle = await Disk.pickExisting();
    if (handle && !await Disk.requestPermission(handle, 'readwrite')) return false;
  } else {
    handle = await Disk.pickNew(syncFilename(key) || rescoredFilename(listForSyncKey(key)));
  }
  if (!handle) return false;
  syncTargets.set(key, isEdits ? { handle, baseline: '' } : { handle });
  await persistSyncTarget(key);
  await activateSyncTarget(key);
  SyncStatus.set(key, 'synced');
  return true;
}

const ReconnectSplash = (() => {
  let _hasAnimatedIn = false;

  function ensureOverlay() {
    let overlay = document.getElementById('splash-screen');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'splash-screen';
    overlay.innerHTML = `<div class="splash-logo">Grawlix <span class="bubble">!@#$</span></div><div class="splash-spinner"><span></span><span></span><span></span></div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function show(keys) {
    return new Promise(resolve => {
      const overlay = ensureOverlay();
      const spinner = overlay.querySelector('.splash-spinner');
      if (spinner) spinner.hidden = true;
      const pending = new Set(keys);

      const finish = () => {
        overlay.classList.add('done');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        resolve();
      };

      function render() {
        overlay.querySelectorAll('.splash-reconnect').forEach(e => e.remove());
        const wrap = document.createElement('div');
        wrap.className = _hasAnimatedIn ? 'splash-reconnect' : 'splash-reconnect animated';
        _hasAnimatedIn = true;

        const intro = document.createElement('p');
        intro.className = 'splash-reconnect-intro';
        intro.textContent = pending.size === 1
          ? 'Reopen your synced file to resume syncing.'
          : 'Reopen your synced files to resume syncing.';
        wrap.appendChild(intro);

        for (const key of pending) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'primary splash-reconnect-open';
          btn.textContent = `Open ${syncFilename(key)}`;
          btn.onclick = async () => {
            btn.disabled = true;
            const ok = await regrantSyncTarget(key);
            btn.disabled = false;
            if (!ok) return;
            pending.delete(key);
            pending.size ? render() : finish();
          };
          wrap.appendChild(btn);
        }

        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'splash-reconnect-skip';
        skip.textContent = 'Skip for now';
        skip.onclick = finish;
        wrap.appendChild(skip);

        overlay.appendChild(wrap);
        wrap.querySelector('.splash-reconnect-open')?.focus();
      }

      render();
    });
  }

  return { show };
})();

function toggleWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  if (!wordlist || !wordlist.populated) return;
  setWordlistEnabled(wordlist, !wordlist.enabled);
}

// ─── Disk sync dialog ─────────────────────────────────────────────────────────

const SyncDialog = (() => {
  let el, body;

  function mount() {
    ({ el, body } = createDialog('sync-dialog', { labelledby: 'sync-dialog-title' }));
  }

  function diagram(arrow) {
    return `<div class="sync-diagram">
        <svg class="sync-diagram-icon" aria-hidden="true"><use href="#${getBrowser().icon}"/></svg>
        <span class="sync-diagram-arrow">${arrow}</span>
        <span class="sync-diagram-emoji">📄</span>
        <span class="sync-diagram-arrow">${arrow}</span>
        <svg class="sync-diagram-icon" aria-hidden="true"><use href="#icon-crossword"/></svg>
      </div>`;
  }

  function render(target) {
    const key = syncKey(target);
    const synced = syncTargets.has(key);
    const mirror = isMirrorList(target);
    const name = esc(syncFilename(key));
    const listLabel = buildWordlistNameHTML(target, { bold: false });

    let title, inner;
    if (!Disk.isSupported()) {
      title = 'Saved in your browser';
      inner = `<p class="sync-dialog-lead">Grawlix keeps your wordlists in ${esc(getBrowser().name)}'s storage on this device. Disk sync — keeping a list in sync with a file your construction software reads — needs a Chromium browser like Chrome or Edge. Use <strong>Download</strong> to save a file out anytime.</p>
        <div class="sync-dialog-actions"><button type="button" class="dialog-cancel-btn primary">Got it</button></div>`;
    } else if (synced) {
      const unavailable = SyncStatus.get(key) === 'unavailable';
      title = `Syncing ${listLabel} to disk`;
      inner = `${diagram(mirror ? '→' : '⇄')}
        <p class="sync-dialog-lead">${mirror
          ? `<strong>${name}</strong> is shared by Grawlix and your construction software. It will stay up to date as you make changes.`
          : `<strong>${name}</strong> is shared between Grawlix and your construction software. Edit in either place — changes flow both ways.`}</p>
        ${unavailable ? `<p class="sync-dialog-note attention"><span class="sync-dialog-note-icon" aria-hidden="true">⚠️</span><span>Grawlix can't find <strong>${name}</strong> — it may have been moved or deleted, so syncing is paused.</span></p>` : ''}
        <div class="sync-dialog-actions"><button type="button" class="danger" onclick="SyncDialog.act('stopSync')">Turn off</button></div>`;
    } else {
      title = `Sync ${listLabel} to disk`;
      inner = `${diagram(mirror ? '→' : '⇄')}
        <p class="sync-dialog-lead">Share a single file between Grawlix and your construction software.${mirror ? ' It will stay up to date as you make changes.' : ' Edit in either place — changes will flow both ways.'}</p>
        <div class="sync-choices">
          <button type="button" class="sync-choice" onclick="SyncDialog.act('syncExisting')">
            <span class="sync-choice-title">${mirror ? 'Overwrite an existing file' : 'Use an existing file'}</span>
            <span class="sync-choice-sub">Point at the wordlist your construction software already reads.</span>
          </button>
          <button type="button" class="sync-choice" onclick="SyncDialog.act('syncNew')">
            <span class="sync-choice-title">Create a new file</span>
            <span class="sync-choice-sub">Save changes to a fresh file.</span>
          </button>
        </div>`;
    }

    body.innerHTML = `<button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="sync-dialog-title">${title}</h2>
      ${inner}`;
  }

  // Don't await before dispatching: the action's FSA picker must fire inside this
  // click's transient activation, or it silently fails.
  function act(name) {
    Promise.resolve(WordlistActions.action(name)).then(done => { if (done) el.close(); });
  }

  return {
    mount,
    open(target) { render(target); showDialog(el); },
    act,
  };
})();

// ─── Configure / Add wordlist dialog ─────────────────────────────────────────────

const ConfigureWordlistDialog = (() => {
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
      urlMetaEl, importSection, btnSave, importZoneLabel;

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

  // ── Auto-update URL / file areas ─────────────────────────────────────────────

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
        const wordlist = addNewWordlist({
          dbKey: newDbKey(), icon: _pendingIcon, name,
          url, enabled: false, populated: false,
          ...(_selectedPublisher ? { publisherId: _selectedPublisher.id } : {}),
          rescoreRules: rules || [],
        });
        _onAdded?.(wordlist);
        el.close();
        if (url) {
          fetchWordlist(wordlist);
        } else if (_pendingFile) {
          ingestFile(_pendingFile, wordlist, name);
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

// ─── Import Guide ─────────────────────────────────────────────────────────────

function bindDropZone(zone, fileInput, onFile) {
  zone.onclick     = () => fileInput.click();
  zone.ondragover  = e => { e.preventDefault(); zone.classList.add('drag-over'); };
  zone.ondragleave = () => zone.classList.remove('drag-over');
  zone.ondrop      = e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };
  fileInput.onchange = () => { if (fileInput.files[0]) onFile(fileInput.files[0]); };
}

const ImportGuideDialog = (() => {
  let el, body;

  let _wordlist = null;
  let _pendingFile = null;

  function mount() {
    ({ el, body } = createDialog('import-guide-dialog', { labelledby: 'guide-title' }));
  }

  function open(wordlist) {
    _wordlist = wordlist;
    _pendingFile = null;
    body.innerHTML = buildContentHTML(wordlist);

    const zoneLabel = el.querySelector('.guide-zone-label');
    const importBtn = el.querySelector('.guide-import-btn');
    importBtn.disabled = true;

    importBtn.onclick = () => {
      if (!_pendingFile) return;
      el.close();
      ingestFile(_pendingFile, _wordlist);
    };

    bindDropZone(el.querySelector('.guide-drop-zone'), el.querySelector('.guide-file-input'), file => {
      _pendingFile = file;
      zoneLabel.textContent = file.name;
      importBtn.disabled = false;
    });

    showDialog(el);
  }

  function buildContentHTML(wordlist) {
    const publisher = getPublisher(wordlist);
    const dropZone = `
      <div class="import-zone compact guide-drop-zone">
        <span class="guide-zone-label">Drop file here or click to browse</span>
        <input type="file" class="guide-file-input" accept=".txt,.dict">
      </div>`;
    const footer = `
      <div class="dialog-footer">
        <button class="dialog-cancel-btn">Cancel</button>
        <button class="primary guide-import-btn">Import</button>
      </div>`;

    if (!publisher?.sourcePage) {
      return `
        <button class="dialog-close-btn" aria-label="Close">✕</button>
        <h2 id="guide-title">Import ${esc(wordlist.name)}</h2>
        <p class="guide-intro">Import a wordlist file from your computer. Grawlix will load its words and scores into this wordlist.</p>
        ${dropZone}
        ${footer}`;
    }

    const subNote = publisher.subscriptionNote
      ? `<div class="subscription-note"><strong>Note:</strong> ${esc(publisher.subscriptionNote)}</div>`
      : '';
    // sourceNote is trusted HTML hardcoded in WORDLIST_PUBLISHERS, never user input.
    return `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="guide-title">Import ${esc(publisher.name)}</h2>
      <p class="guide-intro">This wordlist isn't auto-fetched — you'll need to download it yourself, then drop the file back here.</p>
      ${subNote}
      <ol class="guide-steps">
        <li class="guide-step"><div class="guide-step-body">
          Open the wordlist page: <a href="${esc(publisher.sourcePage)}" target="_blank" rel="noopener">${esc(publisher.sourcePage)} 🔗</a>
        </div></li>
        <li class="guide-step"><div class="guide-step-body">${publisher.sourceNote || 'Download the wordlist file.'}</div></li>
        <li class="guide-step"><div class="guide-step-body">
          Drop the downloaded file below, or click to browse:
          ${dropZone}
        </div></li>
      </ol>
      ${footer}`;
  }

  return { mount, open };
})();

// ─── Test API ─────────────────────────────────────────────────────────────────
// Exposed on `window.__grawlixTest` for the Playwright smoke suite. Routes
// through real internal codepaths (applyWordlistText, setWordlistRescoreRules)
// so tests exercise the same plumbing the UI does. The surface is small and
// stable — adding to it is fine; renaming or repurposing existing helpers
// breaks the tests that depend on them.

const __grawlixTest = {
  // Add a populated custom wordlist (no publisherId). Entries are auto-named
  // WORD001, WORD002, … one per score. Goes through applyWordlistText so the
  // auto-seed path is exercised on import.
  async addCustomWordlist({ name, scores, entries, comments = [], enabled = true } = {}) {
    const text = scores.map((s, i) => {
      const entry = entries?.[i] ?? `WORD${String(i + 1).padStart(3, '0')}`;
      const comment = comments[i];
      return comment ? `${entry};${s};${comment}` : `${entry};${s}`;
    }).join('\n');
    const wordlist = addNewWordlist({
      dbKey: newDbKey(),
      icon: null,
      publisherId: null,
      name,
      url: null,
      enabled,
      populated: false,
    });
    await applyWordlistText(wordlist, text, {
      originalFilename: `${name}.txt`,
      source: name,
      silent: true,
    });
    // Drain the fire-and-forget refresh applyWordlistText's cache bump started,
    // else a following setStack aborts it mid-run and strands the scroller on
    // pre-filter rows — the webkit flake the single-read tool specs lose.
    await pipelineIdle();
    return wordlist.dbKey;
  },

  // Replace a wordlist's rescore rules via the proper helper. Rules are the
  // editor's shape: { input, length, output, note? }.
  setRescoreRules(name, rules) {
    const wl = this._lookup(name);
    setWordlistRescoreRules(wl, rules);
  },

  bakeRescoring(name) { return bakeRescoring(this._lookup(name)); },

  setUpdateAvailable(name, value) {
    const wl = this._lookup(name);
    wl._updateAvailable = !!value;
    renderSources();
    WordlistSelector.refresh();
  },

  // Reorder state.sources so `name` lands at `beforeName`'s position (and
  // `beforeName` shifts down). Routes through `reorderSources` so caches
  // invalidate the same way a drag does.
  moveBefore(name, beforeName) {
    const fromIdx = state.sources.findIndex(w => w.name === name);
    const toIdx   = state.sources.findIndex(w => w.name === beforeName);
    if (fromIdx < 0) throw new Error(`No wordlist named "${name}"`);
    if (toIdx   < 0) throw new Error(`No wordlist named "${beforeName}"`);
    reorderSources(fromIdx, toIdx);
  },

  // Read-only snapshot of the active corpus (All Wordlists by default, the scoped source
  // after setScope) for a single entry. The sourcing wordlist is user-
  // observable via the row's popover and via the `.atom-source` column, but
  // that column is hidden below a 960px viewport. Exposing it here lets merge-
  // correctness tests assert regardless of viewport width and without driving
  // the popover.
  getMergedEntry(entry, display) {
    const cache = getActiveCorpus();
    const m = display !== undefined ? cache.byKey.get(mergeKey(toNorm(entry), display)) : cache.byNorm.get(toNorm(entry));
    if (!m) return null;
    return { entry: m.norm, display: m.display, score: m.score, comment: m.comment, wordlist: m.wordlist.name };
  },

  // Pass a source name to scope, or 'All Wordlists'/nothing for the merged view.
  async setScope(name) {
    await setScope(!name || name === MERGED_NAME ? MERGED_ID : this._lookup(name));
  },

  // Stable, comparable dump of the merged cache: entries as ordered tuples
  // plus per-source counts (sorted by name so map-order noise can't fail a
  // comparison). Tests diff the live surgically-patched cache against a forced
  // full rebuild to prove the My Edits patch stays faithful.
  dumpMergedCache() {
    const c = buildMergedWordlist();
    return {
      entries: c.entries.map(e => [e.norm, e.display, e.score, e.comment, e.wordlist.name]),
      counts: c.sourceCounts.map(s => [s.wordlist.name, s.count]).sort((a, b) => a[0].localeCompare(b[0])),
    };
  },
  rebuildMergedCache() {
    invalidateSourceCounts();
    return this.dumpMergedCache();
  },

  // Stamp the live cache object; a My Edits edit must preserve the stamp
  // (in-place patch). A full rebuild — the regression we guard against —
  // discards the object and the stamp with it.
  markMergedCache(tag) { buildMergedWordlist()._testTag = tag; },
  mergedCacheTag() { const c = peekMergedCache(); return c ? (c._testTag ?? null) : null; },

  // Drive a My Edits upsert/rename through the real saveEdit path — the patch
  // under test — without the popover DOM, so the cache-consistency test can
  // apply many mutations without choreographing popovers across search changes.
  // origRaw === raw upserts; differing raw renames (a two-norm move).
  saveMyEdit(origRaw, raw, score, comment = '') {
    // Mirror openForCreate: a not-yet-present entry seeds a blank-score orig so
    // saveEdit treats it as a genuine add, not a no-op against an equal score.
    const orig = getActiveCorpus().byNorm.get(toNorm(origRaw)) || buildUserWlEntry(origRaw, '', '');
    saveEdit(orig, { raw, score, comment });
    return refreshMergedScroller();
  },
  deleteMyEdit(raw) {
    const m = getEditsWordlist().rawEntries.find(e => e.norm === toNorm(raw));
    if (m) deleteFromEdits({ norm: m.norm, display: displayOf(m) }, refreshMergedScroller);
  },

  setUnigramCorpus: segmenterSetCorpus,

  // Set the tool stack directly, bypassing gallery clicks. Routes
  // through the same path the URL parser uses (`ToolStack.setStack` +
  // `renderMergedDetail`), so tests exercise the executor with the
  // same plumbing the user does. Pass an array of `{tool, params}`.
  // Returns the render promise — tests `await` it before reading the DOM.
  async setStack(stack) {
    ToolStack.setStack(stack.filter(r => TOOLS[r.tool]).map(r => makeToolRow(r.tool, r.params || {}, !!r.grouped)));
    const p = renderMergedDetail();
    ToolStack.refreshGalleryActive();
    await p;
  },

  // Resolves when no pipeline run is in flight. Tests use this after keystroke
  // interactions (which fire-and-forget the refresh) before reading the DOM.
  pipelineIdle() { return pipelineIdle(); },

  // Resolves once init() has fully completed. gotoApp awaits this before the
  // test touches the UI, so init's boot tail can't reset the stack mid-test.
  whenReady() { return _ready; },

  // Visible scroller rows as user-meaningful strings. A single-word
  // row returns its entry string; a chain row returns the array of its
  // distinct atom entry strings (relation glyph stripped). Adjacent repeat
  // atoms — the same word stacked under several search highlights — collapse
  // to one, so the result describes the chain's distinct words. Reads from the
  // live DOM so assertions describe what's actually rendered. Awaits
  // pipelineIdle so an in-flight async refresh finishes first.
  async getVisibleEntries() {
    await pipelineIdle();
    const rows = document.querySelectorAll('#vs-host .entry-row');
    return [...rows].map(r => {
      const words = [];
      for (const atomEl of r.querySelectorAll('.atom')) {
        const entryEl = atomEl.querySelector('.atom-entry');
        const glyph = entryEl.querySelector('.atom-glyph');
        const full = entryEl.textContent || '';
        const word = glyph ? full.slice(glyph.textContent.length) : full;
        if (word !== words[words.length - 1]) words.push(word);
      }
      return words.length === 1 ? words[0] : words;
    });
  },

  async getVisibleGroups() {
    await pipelineIdle();
    const stripGlyph = el => {
      if (!el) return '';
      const glyph = el.querySelector('.atom-glyph');
      const full = el.textContent || '';
      return glyph ? full.slice(glyph.textContent.length) : full;
    };
    return [...document.querySelectorAll('#vs-host .group-row')].map(row => {
      const anchorAtom = row.querySelector('.group-anchor .atom[data-atom-role="anchor"]');
      const anchor = anchorAtom ? {
        entry: stripGlyph(anchorAtom.querySelector('.atom-entry')),
        score: parseInt(anchorAtom.querySelector('.score-badge')?.textContent || '', 10),
      } : null;
      return {
        count: parseInt(row.querySelector('.group-count')?.textContent || '', 10),
        anchor,
        chains: [...row.querySelectorAll('.group-chain')].map(chainEl =>
          [...chainEl.querySelectorAll('.atom .atom-entry')].map(stripGlyph)
        ),
      };
    });
  },

  // Read-only snapshot for assertions. Returns the fields the smoke suite
  // looks at; not a full wordlist dump.
  getWordlist(name) {
    const wl = state.sources.find(w => w.name === name);
    if (!wl) return null;
    return {
      name: wl.name,
      publisherId: wl.publisherId,
      enabled: wl.enabled,
      populated: wl.populated,
      entries: wl.rawEntries.map(e => ({ entry: e.norm, display: e.display, score: e.score, comment: e.comment || '' })),
      rescoreRules: wl.rescoreRules.map(r => ({ input: r.input, length: r.length || '', output: r.output })),
      dirty: !!wl.dirty,
      updateAvailable: !!wl._updateAvailable,
    };
  },

  async exportText(format) {
    await pipelineIdle();
    const scroller = getEntriesScroller();
    const rows = scroller.entries;
    const grouped = scroller.sortTier === 'group';
    const stack = ToolStack.getStack();
    if (format === 'copy')     return buildCopyText(rows, grouped, stack);
    if (format === 'wordlist') return buildWordlistText(rows, grouped);
    if (format === 'csv')      return buildCSVText(rows, grouped, stack);
    if (format === 'json')     return buildExportJSONObject(rows, grouped, stack);
    throw new Error(`Unknown export format: ${format}`);
  },

  exportFilename(ext) {
    return exportFilename(ToolStack.getStack(), ext);
  },

  sync: {
    merge3(base, file, idb) {
      const { resolved, conflicts } = threeWayMergeEdits(parseWordlist(base), parseWordlist(file), parseWordlist(idb));
      const dump = e => ({ entry: e.norm, display: e.display, score: e.score, comment: e.comment || '' });
      return {
        resolved: [...resolved.values()].map(dump).sort((a, b) => a.entry.localeCompare(b.entry)),
        conflicts: conflicts.map(c => ({ norm: c.norm, device: c.device ? dump(c.device) : null, file: c.file ? dump(c.file) : null })),
      };
    },
    _list(name) { return name === MERGED_NAME ? MERGED_ID : state.sources.find(w => w.name === name); },
    attachMirror(name, opts) { return attachMirrorSync(this._list(name), opts); },
    attachEditsExisting() { return attachEditsSync({ existing: true }); },
    attachEditsNew() { return attachEditsSync({ existing: false }); },
    reconcileEdits() { return EditsSync.reconcile(); },
    tickEdits() { return EditsSync._tick(); },
    isSynced(name) { return syncTargets.has(syncKey(this._list(name))); },
    filename(name) { return syncFilename(syncKey(this._list(name))); },
    async flushWrites() {
      for (const [key, id] of [...MirrorSync._timers]) { clearTimeout(id); MirrorSync._timers.delete(key); await MirrorSync._flush(key); }
      if (EditsSync._writeTimer) { clearTimeout(EditsSync._writeTimer); EditsSync._writeTimer = null; await EditsSync._flushWrite(); }
    },
  },

  _lookup(name) {
    const wl = state.sources.find(w => w.name === name);
    if (!wl) throw new Error(`No wordlist named "${name}"`);
    return wl;
  },

  migrateSettings,
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Two callers reach module-scoped names through `window`, which can't see this
// module's private scope: inline on*= handlers in generated HTML, and the
// Playwright suite's page.evaluate bodies. Expose the names both depend on.
function exposeWindowGlobals() {
  Object.assign(window, {
    WordlistActions, SyncDialog, AppView,
    toggleSplitMenu, startNoteEdit, onRuleInput, onHistogramPointerDown,
    saveRuleField, deleteRule, addRule, resetRescoreRules, neutralizeRescoreRules,
    saveScoringField, deleteScoringRow, addScoringRow, resetScoringRules,
    exportCopy, exportWordlist, exportCSV, exportJSON,
    state, Router, ToolStack, SettingsDialog, Storage, TOOLS,
    getOutputFormat, setOutputFormat, persistMeta, persistEdits, buildMergedWordlist,
    downloadSourceWordlist, downloadOriginalWordlist, checkForUpdates, saveEdit,
    serializeEntries, buildWordlistText, applyWordlistText, renderMergedDetail,
    getEditsWordlist,
  });
  window.__grawlixTest = __grawlixTest;
  // `_db` is reassigned after openDB() resolves; a static copy would freeze at its
  // boot-time null, so the suite (which polls `_db !== null`) needs a live read.
  Object.defineProperty(window, '_db', { get: () => getDb(), configurable: true });
}

function mountSplitMenuDismiss() {
  document.addEventListener('click', () => document.querySelectorAll('.split-btn.open').forEach(b => b.classList.remove('open')));
}

// Hide the splash screen immediately if no wordlists have data. (When data
// exists, init's reconnect/fade path retires it instead.)
function maybeRemoveSplashEarly() {
  const meta = Storage.readMeta() || [];
  if (!meta.some(l => l.lastUpdated)) document.getElementById('splash-screen')?.remove();
}

// Module evaluation only *defines*; the side effects run here. The order is a
// load-bearing contract — a wrong order surfaces as a runtime error, not the
// hoisting non-issue it was when these ran as stray top-level statements.
const UNIGRAM_CORPUS_SIZE_KEY = 'corpus_unigrams_size';

function boot() {
  // Window exposure first: components below render HTML with inline on*= handlers
  // that resolve through `window`, and the Playwright bridge polls `window._db`.
  exposeWindowGlobals();

  // Inject the segmenter's I/O before init() runs loadUnigramCorpus / checkForUpdates.
  // onSize() with no arg reads the persisted corpus-size note; onSize(bytes) writes it.
  configureSegmenterIO({
    idbGet, idbPut,
    onSize: bytes => bytes === undefined
      ? lsLoad(UNIGRAM_CORPUS_SIZE_KEY)
      : lsSave(UNIGRAM_CORPUS_SIZE_KEY, bytes),
  });

  // Hand actions.js the dialog singletons it dispatches into. They live here
  // (a later carve) and can't be imported upward without recreating the cycle
  // that breaks actions.js's standalone load under node:test.
  configureActions({ SyncDialog, ConfigureWordlistDialog, ImportGuideDialog, ReconnectSplash });

  // Inject the app-layer callees the extracted ui views can't import upward.
  configureRendering({
    refreshDerivedDisplays,
    deleteFromEdits,
    attachExternalEditHandlers,
    buildScoreRangeInputHTML,
    buildExportMenuHTML,
  });
  configureEntriesTable({
    navigate: () => Router.navigate(),
  });
  configureToolStack({
    navigate: () => Router.navigate(),
    showRowError: (btn, msg) => ErrorPopover.toggle(btn, msg),
    attachHelpPopups,
  });
  configureRescoreEditor({
    bakeMenuOpts,
  });
  configureManagePanel({
    openAddWordlist: onAdded => ConfigureWordlistDialog.openAdd(onAdded),
  });
  configureDiscoveryBanner({
    runImport: () => WordlistActions.action('import'),
  });
  configureSettings({
    checkForUpdates,
    regenerateFillOutputs,
    getAutoUpdate,
  });

  // Document-level / pure wiring — no dependency on the app-shell DOM existing.
  mountGroupColumnStyle();
  mountClearableInputs();
  mountHistogramPointer();
  mountSplitMenuDismiss();

  // Dialog/overlay singletons append to <body>. showConfirm must exist before
  // init() (init's migration path calls it); the rest before any UI opens them.
  SettingsDialog.mount();
  WelcomeDialog.mount();
  showEditsConflict.mount();
  showConfirm.mount();
  showAlert.mount();
  showMergeConflict.mount();
  openUpdateSummaryDialog.mount();
  SyncDialog.mount();
  ConfigureWordlistDialog.mount();
  ImportGuideDialog.mount();
  GroupMorePopover.mount();

  // Must precede init()'s sync reconnect work, or it raises the no-op default
  // dialogs and permission/conflict prompts silently vanish. showAlert renders
  // its message as HTML, so escape the data-built string here.
  configureSyncDialogs({
    alert: msg => showAlert(esc(msg)),
    resolveConflict: (filename, conflicts) => showEditsConflict(filename, conflicts),
  });

  // App-shell components must exist before init()'s renderAll: the render
  // effect's first run calls WordlistSelector.refresh() + DiscoveryBanner.refresh()
  // and renders the panel (whose sticky observer watches #wordlist-bar).
  WordlistSelector.mount();
  ManagePanel.mount();
  DiscoveryBanner.mount();
  ToolPicker.mount();

  // The signal hop (vs. disk-sync calling renderSyncIndicators directly) is what
  // keeps data/ off ui/; without this effect, sync-status changes never repaint.
  effect(() => { syncStatus$.get(); renderSyncIndicators(); });

  mountStatsBarOverflowObservers();
  mountHeaderHeightObserver();

  maybeRemoveSplashEarly();
  init();
}

boot();
