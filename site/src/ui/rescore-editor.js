'use strict';

// ─── Rescore editor ─────────────────────────────────────────────────────────

import { MERGED_ID, DEFAULT_SCORING } from '../core/constants.js';
import { esc } from '../core/util.js';
import { parseRange } from '../engine/range.js';
import { state } from '../data/state.js';
import { applyRescoreRulesChange, persistScoring } from '../data/persist.js';
import {
  getRuleMaxScore, parseRuleOutput, makeRescoreRuleStub,
} from '../engine/rescore.js';
import { getWordlistDefaultRules } from '../data/rescoring.js';
import {
  updateScoringDirty, propagateDefaults, makeScoringRowStub,
} from '../model/scoring.js';
import { showUndoToast } from './toasts.js';
import { showConfirm } from './dialogs/confirm.js';
import { buildEditHintHTML, buildTrashIconHTML } from './components.js';
import { WordlistSelector } from './scope-selector.js';
import { getEntriesScroller } from './rendering.js';

// The bake-availability check lives upward (main.js); injected so this view
// imports nothing above ui.
let _bakeMenuOpts       = () => ({});

export function configureRescoreEditor({ bakeMenuOpts }) {
  if (bakeMenuOpts)       _bakeMenuOpts = bakeMenuOpts;
}

// ─── Domain builders ──────────────────────────────────────────────────────────

export function buildRuleRowHTML(i, fieldsHTML, note, onDeleteFn, readOnly = false) {
  const noteWrap = readOnly
    ? `<span class="rule-note-wrap${note ? ' has-note' : ''}"><span class="rule-note-text">${esc(note||'')}</span></span>`
    : `<span class="rule-note-wrap${note ? ' has-note' : ''}" onclick="startNoteEdit(this)" title="Click to edit">
        <span class="rule-note-text">${esc(note||'')}</span>
        ${buildEditHintHTML('rule-note-pencil', 'startNoteEdit(this.parentElement)')}
      </span>`;
  const delBtn = readOnly ? '' : `<button class="icon rule-del" onclick="${onDeleteFn}(${i})" title="Delete row">${buildTrashIconHTML()}</button>`;
  return `<div class="rule-row" data-i="${i}">
      ${fieldsHTML}
      ${noteWrap}
      ${delBtn}
    </div>`;
}

export function buildRulesListHTML(rules, { rulesId, saveFn, deleteFn, addFn = '', resetFn = '', neutralizeFn = '', bakeFn = '', bakeOpts = {}, dirty = false, rescore = false, readOnly = false }) {
  let rulesHTML;
  if (!rules.length && rescore) {
    rulesHTML = '<div class="no-rules">No rules — entries kept as-is</div>';
  } else {
    rulesHTML = rules.map((r, i) => {
      const inputInvalid = !readOnly && parseRange((r.input || '').trim()) === null;
      const disabled = readOnly ? ' disabled' : '';
      const inputHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'input',this.value)"`;
      let fieldsHTML = `<input class="rule-in${inputInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.input)}"
            title="Score range: 50, 50-59, or 50+"${disabled}${inputHandlers}>`;
      if (rescore) {
        const lenVal = (r.length || '').trim();
        const lenInvalid = !readOnly && lenVal !== '' && parseRange(lenVal) === null;
        const outInvalid = !readOnly && isRuleOutputInvalid(r.input, r.output);
        const lenHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'length',this.value)"`;
        const outHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'output',this.value)"`;
        fieldsHTML += `
          <span class="rule-field-lbl">length</span><input class="rule-len${lenInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.length||'')}" placeholder="any"
            title="Entry length filter: 7, 7-10, or 7+ (blank = any length)"${disabled}${lenHandlers}>
          <span class="rule-arrow">→</span>
          <input class="rule-out${outInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.output)}" placeholder="unchanged"
            title="Output score, or blank for unchanged"${disabled}${outHandlers}>`;
      }
      return buildRuleRowHTML(i, fieldsHTML, r.note, deleteFn, readOnly);
    }).join('');
  }
  const addBtn = (!readOnly && addFn) ? `<button class="rule-add-btn" onclick="${addFn}()">+ Add rule</button>` : '';
  const neutralizeBtn = (!readOnly && neutralizeFn && rescoringIsNeutralizable(rules)) ? `<button class="rule-neutralize-btn" title="Keep this list's raw scores and notes — drop only Grawlix's rescoring" onclick="${neutralizeFn}()">Disable rescoring</button>` : '';
  const resetBtn = (!readOnly && resetFn && dirty) ? `<button class="rule-reset-btn" onclick="${resetFn}()">Reset to defaults</button>` : '';
  const bakeBtn = (!readOnly && bakeFn)
    ? `<button class="rule-bake-btn" onclick="${bakeFn}"${bakeOpts.disabled ? ' disabled' : ''}${bakeOpts.title ? ` title="${esc(bakeOpts.title)}"` : ''}>Apply rescoring permanently</button>`
    : '';
  const rightCluster = (neutralizeBtn || resetBtn || bakeBtn) ? `<div class="rule-actions-right">${neutralizeBtn}${resetBtn}${bakeBtn}</div>` : '';
  const actionsRow = (addBtn || rightCluster) ? `<div class="rule-actions">${addBtn}${rightCluster}</div>` : '';
  return `<div id="${rulesId}">${rulesHTML}</div>${actionsRow}`;
}

export function buildRescoreSectionHTML(wordlist, rulesId = 'rescore-rules') {
  if (!wordlist) return '';
  const hasDefaults = getWordlistDefaultRules(wordlist) !== null;
  return `<div class="rescore-top"><span class="rescore-lbl">Rescoring</span></div>` +
    buildRulesListHTML(wordlist.rescoreRules || [], {
      rulesId,
      saveFn:    'saveRuleField',
      deleteFn:  'deleteRule',
      addFn:     'addRule',
      resetFn:   hasDefaults ? 'resetRescoreRules' : '',
      neutralizeFn: 'neutralizeRescoreRules',
      bakeFn:    `WordlistActions.action('bakeRescoring')`,
      bakeOpts:  _bakeMenuOpts(wordlist),
      dirty:     !!wordlist.dirty,
      rescore:   true,
    });
}

export function buildScoringSectionHTML(rulesId = 'scoring-rules') {
  sortScoringRules();
  return `<div class="rescore-top"><span class="rescore-lbl">Scoring</span></div>` +
    buildRulesListHTML(state.scoring, {
      rulesId,
      saveFn:    'saveScoringField',
      deleteFn:  'deleteScoringRow',
      addFn:     'addScoringRow',
      resetFn:   'resetScoringRules',
      dirty:     state.scoringDirty,
    });
}

// ─── Rescore section render ─────────────────────────────────────────────────

export function renderRescoreSection() {
  WordlistSelector.refreshEditor();
}

// ─── Scoring (tier labels) ────────────────────────────────────────────────────

// Sort tier labels into canonical priority order (highest max score first) so
// makeTierLookup's first-match-wins resolves overlapping ranges consistently.
export function sortScoringRules() {
  state.scoring.sort((a, b) => getRuleMaxScore(b) - getRuleMaxScore(a));
}

// Tier-label changes don't touch data, so a cheap re-render of the visible
// rows (they carry the label as a `title=`) is enough — no full rebuild.
export function renderScoringRules() {
  sortScoringRules();
  WordlistSelector.refreshEditor();
  getEntriesScroller()?._render?.();
}

export function deleteScoringRow(i) {
  const [deleted] = state.scoring.splice(i, 1);
  applyScoringChange();
  showUndoToast('Deleted scoring row', () => {
    state.scoring.push(deleted);
    applyScoringChange();
  });
}

export function saveScoringField(i, field, val) {
  if (!state.scoring[i]) return;
  state.scoring[i][field] = val;
  applyScoringChange();
}

export function addScoringRow() {
  state.scoring.push(makeScoringRowStub());
  applyScoringChange();
  const inp = [...document.querySelectorAll(`${activeRescoreContainerSelector('scoring')} .rule-row .rule-in`)].find(i => !i.value);
  inp?.focus();
}

export function applyScoringChange() {
  updateScoringDirty();
  persistScoring();
  propagateDefaults();
  renderScoringRules();
}

export async function resetScoringRules() {
  if (!await showConfirm('Replace your tier labels with the defaults? Your customizations will be lost.', { confirmText: 'Reset' })) return;
  state.scoring = DEFAULT_SCORING.map(r => ({ ...r }));
  applyScoringChange();
}

// ─── Rescore rule management ──────────────────────────────────────────────────

function afterRuleChange(wordlist) {
  applyRescoreRulesChange(wordlist);
  renderRescoreSection();
}

function getRescoreContextWordlist() {
  return (state.selected && state.selected !== MERGED_ID) ? state.selected : null;
}

export function deleteRule(idx) {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist) return;
  const [deleted] = wordlist.rescoreRules.splice(idx, 1);
  afterRuleChange(wordlist);
  showUndoToast('Deleted rescore rule', () => {
    wordlist.rescoreRules.push(deleted);
    afterRuleChange(wordlist);
  });
}

export function saveRuleField(idx, field, value) {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist || !wordlist.rescoreRules[idx]) return;
  if (field === 'length' && value.trim().toLowerCase() === 'any') value = '';
  if (field === 'output' && value.trim().toLowerCase() === 'unchanged') value = '';
  wordlist.rescoreRules[idx][field] = value;
  afterRuleChange(wordlist);
}

function activeRescoreContainerSelector(kind) {
  return kind === 'scoring' ? '#scoring-rules' : '#rescore-rules';
}

export function addRule() {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist) return;
  wordlist.rescoreRules.push(makeRescoreRuleStub());
  afterRuleChange(wordlist);
  // afterRuleChange re-sorts and re-renders, so find the new row by its empty input rather than by index.
  const inp = [...document.querySelectorAll(`${activeRescoreContainerSelector('rescore')} .rule-row .rule-in`)].find(i => !i.value);
  inp?.focus();
}

export async function resetRescoreRules() {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist) return;
  const defaults = getWordlistDefaultRules(wordlist);
  if (defaults === null) return;
  if (!await showConfirm('Replace your rescore rules with the defaults? Your customizations will be lost.', { confirmText: 'Reset' })) return;
  wordlist.rescoreRules = defaults.map(r => ({ ...r }));
  afterRuleChange(wordlist);
}

function rescoringIsNeutralizable(rules) {
  return (rules || []).some(r => r.scoring === false || (r.output ?? '').trim() !== '');
}

export async function neutralizeRescoreRules() {
  const wordlist = getRescoreContextWordlist();
  if (!wordlist || !wordlist.rescoreRules?.length) return;
  if (!await showConfirm('Disable rescoring? The input ranges and notes are kept as a legend — only the score remapping is removed.', { confirmText: 'Disable rescoring' })) return;
  wordlist.rescoreRules = wordlist.rescoreRules.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' }));
  afterRuleChange(wordlist);
}

function noteDisplayHTML(note) {
  return `<span class="rule-note-text">${esc(note)}</span><span class="edit-hint rule-note-pencil" aria-hidden="true">✏️</span>`;
}

export function startNoteEdit(wrapEl) {
  if (wrapEl.querySelector('.rule-note-input')) return;
  const i = parseInt(wrapEl.closest('.rule-row').dataset.i, 10);
  const isScoring = !!wrapEl.closest('#scoring-rules');

  let currentNote, onSave;
  if (isScoring) {
    if (!state.scoring[i]) return;
    currentNote = state.scoring[i].note || '';
    onSave = note => saveScoringField(i, 'note', note);
  } else {
    const wordlist = getRescoreContextWordlist();
    if (!wordlist?.rescoreRules[i]) return;
    currentNote = wordlist.rescoreRules[i].note || '';
    onSave = note => saveRuleField(i, 'note', note);
  }

  wrapEl.innerHTML = `<input class="rule-note-input" value="${esc(currentNote)}" placeholder="note…">`;
  const input = wrapEl.querySelector('input');
  input.focus();
  input.select();

  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newNote = input.value;
    onSave(newNote);
    if (wrapEl.isConnected) {
      wrapEl.innerHTML = noteDisplayHTML(newNote);
      wrapEl.classList.toggle('has-note', !!newNote.trim());
    }
  }
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') {
      committed = true;
      if (wrapEl.isConnected) {
        wrapEl.innerHTML = noteDisplayHTML(currentNote);
        wrapEl.classList.toggle('has-note', !!currentNote.trim());
      }
    }
  });
}

export function isRuleOutputInvalid(inputVal, outputVal) {
  const v = (outputVal || '').trim();
  if (!v) return false;
  const parsed = parseRuleOutput(v);
  if (parsed === null) return true;
  if (parsed && typeof parsed === 'object') {
    const iv = parseRange((inputVal || '').trim())?.[0];
    if (parsed.max === null) {
      // N+ output requires N+ input
      if (!iv || iv.max !== null) return true;
    } else {
      // Bounded range output requires bounded non-degenerate input range
      if (!iv || iv.min === null || iv.max === null || iv.min === iv.max) return true;
    }
  }
  return false;
}

function validateRulesContainer(container) {
  if (!container) return;
  container.querySelectorAll('.rule-in').forEach(inp => {
    inp.classList.toggle('invalid', parseRange(inp.value.trim()) === null);
  });
  container.querySelectorAll('.rule-len').forEach(inp => {
    const v = inp.value.trim();
    inp.classList.toggle('invalid', v !== '' && parseRange(v) === null);
  });
  container.querySelectorAll('.rule-out').forEach(inp => {
    const inEl = inp.closest('.rule-row')?.querySelector('.rule-in');
    inp.classList.toggle('invalid', isRuleOutputInvalid(inEl?.value, inp.value));
  });
}

export function onRuleInput(el) {
  if (el.classList.contains('rule-len') && el.value.trim().toLowerCase() === 'any') el.value = '';
  if (el.classList.contains('rule-out') && el.value.trim().toLowerCase() === 'unchanged') el.value = '';
  const container = el.closest('#rescore-rules, #scoring-rules');
  if (!container) return;
  validateRulesContainer(container);
}
