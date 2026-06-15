'use strict';

// ─── Dark mode ────────────────────────────────────────────────────────────────

import { lsSave, lsLoad, resetAllDataAndReload } from '../../data/storage.js';
import { getOutputFormat, setOutputFormat, getTrashScore, setTrashScore } from '../../data/serialize.js';
import { showToast } from '../toasts.js';
import {
  buildSegCtrlHTML, buildOutputFormatControlsHTML,
  readOutputFormatControls, wireOutputFormatControls,
} from '../components.js';
import { createDialog, showDialog } from './dialog.js';
import { showConfirm } from './confirm.js';

const OUTPUT_FORMAT_REGEN_DELAY = 1000;

// checkForUpdates / regenerateFillOutputs / getAutoUpdate live in the app layer
// (main.js); injected so this dialog imports nothing above ui. Defaults are no-ops
// (getAutoUpdate defaults to enabled) so the dialog stays inert until boot wires them.
let _checkForUpdates = () => {};
let _regenerateFillOutputs = () => {};
let _getAutoUpdate = () => true;

export function configureSettings({ checkForUpdates, regenerateFillOutputs, getAutoUpdate }) {
  if (checkForUpdates) _checkForUpdates = checkForUpdates;
  if (regenerateFillOutputs) _regenerateFillOutputs = regenerateFillOutputs;
  if (getAutoUpdate) _getAutoUpdate = getAutoUpdate;
}

export const DARK_MODE_CYCLE = ['auto', 'light', 'dark'];
export const DARK_MODE_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

export function applyDarkMode(val) {
  const dark = val === 'dark' || (val !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark-mode', dark);
  document.documentElement.classList.toggle('light-mode', !dark);
}

export function cycleDarkMode() {
  const current = lsLoad('darkMode') || 'auto';
  const next = DARK_MODE_CYCLE[(DARK_MODE_CYCLE.indexOf(current) + 1) % DARK_MODE_CYCLE.length];
  lsSave('darkMode', next);
  applyDarkMode(next);
  const seg = document.getElementById('dark-mode-seg');
  if (seg) seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === next));
  showToast(`Dark mode: ${DARK_MODE_LABELS[next]}`);
}

// ─── Settings dialog ──────────────────────────────────────────────────────────

export const SettingsDialog = (() => {
  let el, body, ofCtrls, resetSub;

  function mount() {
    ({ el, body } = createDialog('settings-dialog', { labelledby: 'settings-dialog-title' }));
    body.innerHTML = `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="settings-dialog-title">Settings</h2>
      <div class="dialog-row">
        <span class="dialog-row-label">Dark mode</span>
        <div id="dark-mode-seg"></div>
      </div>
      <div class="dialog-row">
        <div>
          <div class="dialog-row-label">Auto-update wordlists</div>
          <div class="dialog-row-sub">Update wordlists without asking</div>
        </div>
        <div id="auto-update-seg"></div>
      </div>
      <div class="dialog-row">
        <div>
          <div class="dialog-row-label">Trash score</div>
          <div class="dialog-row-sub">Score given to deleted entries</div>
        </div>
        <input id="trash-score-input" class="trash-score-input" type="number" min="0">
      </div>
      <div class="of-section">
        <div class="dialog-row-label">Output format</div>
        <div class="dialog-row-sub">How entries are written to files and downloads.</div>
        <div id="output-format-ctrls" class="of-ctrls"></div>
      </div>
      <div class="dialog-row">
        <div>
          <div class="dialog-row-label">Reset browser data</div>
          <div class="dialog-row-sub" id="reset-row-sub"></div>
        </div>
        <button id="btn-reset" class="danger" title="Reset browser data">Reset</button>
      </div>`;

    const seg  = el.querySelector('#dark-mode-seg');

    const darkSaved = lsLoad('darkMode') || 'auto';
    applyDarkMode(darkSaved);
    seg.innerHTML = buildSegCtrlHTML(null, [
      { value: 'auto',  label: 'Auto' },
      { value: 'light', label: '☀ Light' },
      { value: 'dark',  label: '☽ Dark' },
    ], darkSaved);
    seg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = () => {
        const val = btn.dataset.val;
        lsSave('darkMode', val);
        applyDarkMode(val);
        seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      };
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((lsLoad('darkMode') || 'auto') === 'auto') applyDarkMode('auto');
    });

    const autoSeg = el.querySelector('#auto-update-seg');
    autoSeg.innerHTML = buildSegCtrlHTML(null, [
      { value: 'off', label: 'Off' },
      { value: 'on',  label: 'On' },
    ], _getAutoUpdate() ? 'on' : 'off');
    autoSeg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = () => {
        autoSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        lsSave('autoUpdate', btn.dataset.val);
        if (btn.dataset.val === 'on') _checkForUpdates();
      };
    });

    ofCtrls  = el.querySelector('#output-format-ctrls');
    resetSub = el.querySelector('#reset-row-sub');

    el.querySelector('#btn-reset').onclick = async () => {
      if (!await showConfirm('Reset all wordlists and settings? This cannot be undone.', { confirmText: 'Reset' })) return;
      await resetAllDataAndReload();
    };

    const trashInp = el.querySelector('#trash-score-input');
    trashInp.onchange = () => {
      const n = parseInt(trashInp.value, 10);
      const v = Number.isFinite(n) && n >= 0 ? n : 0;
      setTrashScore(v);
      trashInp.value = v;
    };
  }

  let ofRegenTimer = null;
  function flushRegen() {
    if (!ofRegenTimer) return;
    clearTimeout(ofRegenTimer);
    ofRegenTimer = null;
    _regenerateFillOutputs();
  }

  function open() {
    resetSub.textContent = 'Reset all wordlists and settings';
    el.querySelector('#trash-score-input').value = getTrashScore();
    ofCtrls.innerHTML = buildOutputFormatControlsHTML(getOutputFormat());
    wireOutputFormatControls(ofCtrls, () => {
      setOutputFormat(readOutputFormatControls(ofCtrls));
      if (ofRegenTimer) clearTimeout(ofRegenTimer);
      ofRegenTimer = setTimeout(() => { ofRegenTimer = null; _regenerateFillOutputs(); }, OUTPUT_FORMAT_REGEN_DELAY);
    });
    showDialog(el, flushRegen);
  }

  return { mount, open };
})();
