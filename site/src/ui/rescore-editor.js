'use strict';

// ─── Rescore editor ─────────────────────────────────────────────────────────
// The editor edits a *draft* copy of the scope's rules; Apply runs the single
// heavy commit. Deferred so authoring a rule doesn't re-rescore the whole
// source per keystroke — see docs/design.md § Rescore and scoring.

import { MERGED_ID, DEFAULT_SCORING } from '../core/constants.js';
import { esc } from '../core/util.js';
import { parseRange } from '../engine/range.js';
import { state } from '../data/state.js';
import { applyRescoreRulesChange, persistScoring } from '../data/persist.js';
import {
  getRuleMaxScore, parseRuleOutput, makeRescoreRuleStub,
  rescoreRulesEqual, scoringRulesEqual, compareRescoreRulesForPriority, compileRule,
} from '../engine/rescore.js';
import { getWordlistDefaultRules } from '../data/rescoring.js';
import {
  updateScoringDirty, propagateDefaults, makeScoringRowStub,
} from '../model/scoring.js';
import { showConfirm } from './dialogs/confirm.js';
import { buildEditHintHTML, buildTrashIconHTML } from './components.js';
import { WordlistSelector } from './scope-selector.js';
import { getEntriesScroller } from './rendering.js';

// Injected so this view imports nothing above ui (bake lives in the app layer).
let _bakeMenuOpts = () => ({});
let _bake         = () => {};

export function configureRescoreEditor({ bakeMenuOpts, bake }) {
  if (bakeMenuOpts) _bakeMenuOpts = bakeMenuOpts;
  if (bake)         _bake         = bake;
}

// ─── Draft buffer ──────────────────────────────────────────────────────────

let _draft = null;       // working copy: rescore rules (source) or tier labels (All Wordlists)
let _draftScope = null;  // the scope the draft belongs to; null while the editor is closed

function isScoringScope(scope) { return scope === MERGED_ID; }

export function beginEdit(scope) {
  _draftScope = scope;
  const src = isScoringScope(scope) ? state.scoring : (scope.rescoreRules || []);
  _draft = src.map(r => ({ ...r }));
  recompileDraft();
}

// Sort+compile so the preview matches what Apply writes — rescoreEntry is
// first-match-wins, so order changes the result.
function recompileDraft() {
  if (!_draft) return;
  if (isScoringScope(_draftScope)) {
    _draft.sort((a, b) => getRuleMaxScore(b) - getRuleMaxScore(a));
  } else {
    _draft.sort(compareRescoreRulesForPriority);
    _draft.forEach(compileRule);
  }
}

export function discardDraft() { _draft = null; _draftScope = null; }
export function draftScope() { return _draftScope; }

export function getDraftRescoreRules() {
  return (_draft && !isScoringScope(_draftScope)) ? _draft : null;
}

export function isDraftDirty() {
  if (!_draft) return false;
  return isScoringScope(_draftScope)
    ? !scoringRulesEqual(_draft, state.scoring)
    : !rescoreRulesEqual(_draft, _draftScope.rescoreRules || []);
}

export function commitDraft() {
  if (!_draft) return;
  if (isScoringScope(_draftScope)) {
    state.scoring = _draft.map(r => ({ ...r }));
    discardDraft();
    applyScoringChange();
  } else {
    const wl = _draftScope;
    wl.rescoreRules = _draft.map(r => ({ ...r }));
    discardDraft();
    applyRescoreRulesChange(wl);
  }
}

export function applyRescoreDraft() {
  WordlistSelector.collapseEditor();
  commitDraft();
}
export function cancelRescoreDraft() {
  WordlistSelector.collapseEditor();
  discardDraft();
}

// Bake reads committed rules, so apply the draft first or it bakes stale rules.
export function makeRescorePermanent() {
  applyRescoreDraft();
  _bake();
}

// Local re-preview only — no worker round-trip, since only the preview rules
// changed, not the corpus.
function afterDraftChange() {
  recompileDraft();
  WordlistSelector.refreshEditor();
  if (getDraftRescoreRules()) getEntriesScroller()?.previewRescore?.();
}

function focusNewRow(containerSelector) {
  const inp = [...document.querySelectorAll(`${containerSelector} .rule-row .rule-in`)].find(i => !i.value);
  inp?.focus();
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

export function buildRulesListHTML(rules, { rulesId, saveFn, deleteFn, addFn = '', rescore = false, readOnly = false }) {
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
  const addBtn = (!readOnly && addFn) ? `<button type="button" class="rule-add-btn" onclick="${addFn}()">+ Add rule</button>` : '';
  return `<div id="${rulesId}">${rulesHTML}${addBtn}</div>`;
}

function buildRareLinkHTML(cls, label, handler, { disabled = false, title = '' } = {}) {
  return `<button type="button" class="rescore-link ${cls}"${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''} onclick="${handler}">${label}</button>`;
}

function buildEditorFooterHTML(rareLinks) {
  return `<div class="rescore-footer">
      <div class="rescore-footer-rare">${rareLinks.join('')}</div>
      <div class="rescore-footer-commit">
        <button type="button" class="rescore-cancel" onclick="cancelRescoreDraft()">Cancel</button>
        <button type="button" class="primary rescore-apply" onclick="applyRescoreDraft()">Apply</button>
      </div>
    </div>`;
}

export function buildRescoreSectionHTML() {
  const wl = _draftScope;
  if (!wl || isScoringScope(wl)) return '';
  const rules = _draft;
  const list = buildRulesListHTML(rules, {
    rulesId: 'rescore-rules', saveFn: 'saveRuleField', deleteFn: 'deleteRule', addFn: 'addRule', rescore: true,
  });
  const defaults = getWordlistDefaultRules(wl);
  const draftDirty = defaults !== null && !rescoreRulesEqual(rules, defaults);
  const bakeOpts = _bakeMenuOpts(wl);
  const rare = [];
  if (draftDirty) rare.push(buildRareLinkHTML('rule-reset-btn', 'Reset to defaults', 'resetRescoreRules()'));
  if (rescoringIsNeutralizable(rules)) {
    rare.push(buildRareLinkHTML('rule-neutralize-btn', 'Disable rescoring', 'neutralizeRescoreRules()',
      { title: "Keep this list's raw scores and notes — drop only Grawlix's rescoring" }));
  }
  rare.push(buildRareLinkHTML('rule-bake-btn', 'Make permanent', 'makeRescorePermanent()', bakeOpts));
  return `<div class="rescore-top"><span class="rescore-lbl">Rescoring</span></div>${list}${buildEditorFooterHTML(rare)}`;
}

export function buildScoringSectionHTML() {
  const rules = _draft || [];
  const list = buildRulesListHTML(rules, {
    rulesId: 'scoring-rules', saveFn: 'saveScoringField', deleteFn: 'deleteScoringRow', addFn: 'addScoringRow', rescore: false,
  });
  const rare = [];
  if (!scoringRulesEqual(rules, DEFAULT_SCORING)) {
    rare.push(buildRareLinkHTML('rule-reset-btn', 'Reset to defaults', 'resetScoringRules()'));
  }
  return `<div class="rescore-top"><span class="rescore-lbl">Scoring</span></div>${list}${buildEditorFooterHTML(rare)}`;
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

export function applyScoringChange() {
  updateScoringDirty();
  persistScoring();
  propagateDefaults();
  renderScoringRules();
}

export function deleteScoringRow(i) {
  if (!_draft || !isScoringScope(_draftScope)) return;
  _draft.splice(i, 1);
  afterDraftChange();
}

export function saveScoringField(i, field, val) {
  if (!_draft || !isScoringScope(_draftScope) || !_draft[i]) return;
  _draft[i][field] = val;
  afterDraftChange();
}

export function addScoringRow() {
  if (!_draft || !isScoringScope(_draftScope)) return;
  _draft.push(makeScoringRowStub());
  afterDraftChange();
  focusNewRow('#scoring-rules');
}

export async function resetScoringRules() {
  if (!_draft || !isScoringScope(_draftScope)) return;
  if (!await showConfirm('Replace your tier labels with the defaults? Your customizations will be lost.', { confirmText: 'Reset' })) return;
  _draft = DEFAULT_SCORING.map(r => ({ ...r }));
  afterDraftChange();
}

// ─── Rescore rule management ──────────────────────────────────────────────────

export function deleteRule(idx) {
  if (!_draft || isScoringScope(_draftScope)) return;
  _draft.splice(idx, 1);
  afterDraftChange();
}

export function saveRuleField(idx, field, value) {
  if (!_draft || isScoringScope(_draftScope) || !_draft[idx]) return;
  if (field === 'length' && value.trim().toLowerCase() === 'any') value = '';
  if (field === 'output' && value.trim().toLowerCase() === 'unchanged') value = '';
  _draft[idx][field] = value;
  afterDraftChange();
}

export function addRule() {
  if (!_draft || isScoringScope(_draftScope)) return;
  _draft.push(makeRescoreRuleStub());
  afterDraftChange();
  // afterDraftChange re-sorts and re-renders, so find the new row by its empty input rather than by index.
  focusNewRow('#rescore-rules');
}

export async function resetRescoreRules() {
  if (!_draft || isScoringScope(_draftScope)) return;
  const defaults = getWordlistDefaultRules(_draftScope);
  if (defaults === null) return;
  if (!await showConfirm('Replace your rescore rules with the defaults? Your customizations will be lost.', { confirmText: 'Reset' })) return;
  _draft = defaults.map(r => ({ ...r }));
  afterDraftChange();
}

function rescoringIsNeutralizable(rules) {
  return (rules || []).some(r => r.scoring === false || (r.output ?? '').trim() !== '');
}

export async function neutralizeRescoreRules() {
  if (!_draft || isScoringScope(_draftScope) || !_draft.length) return;
  if (!await showConfirm('Disable rescoring? The input ranges and notes are kept as a legend — only the score remapping is removed.', { confirmText: 'Disable rescoring' })) return;
  _draft = _draft.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' }));
  afterDraftChange();
}

function noteDisplayHTML(note) {
  return `<span class="rule-note-text">${esc(note)}</span><span class="edit-hint rule-note-pencil" aria-hidden="true">✏️</span>`;
}

export function startNoteEdit(wrapEl) {
  if (wrapEl.querySelector('.rule-note-input')) return;
  if (!_draft) return;
  const i = parseInt(wrapEl.closest('.rule-row').dataset.i, 10);
  if (!_draft[i]) return;

  const currentNote = _draft[i].note || '';
  const isScoring = isScoringScope(_draftScope);
  const onSave = note => (isScoring ? saveScoringField : saveRuleField)(i, 'note', note);

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
