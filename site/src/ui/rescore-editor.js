'use strict';

// ─── Rescore editor ─────────────────────────────────────────────────────────
// Edits one draft — a list's rescore rules or the tier labels — that the
// Manage wordlists dialog owns and commits on Save. See docs/wordlists.md
// § Rescore and scoring.

import { MERGED_ID, DEFAULT_SCORING } from '../core/constants.js';
import { esc } from '../core/util.js';
import { parseRange } from '../engine/range.js';
import {
  parseRuleOutput, makeRescoreRuleStub, rescoreRulesEqual, scoringRulesEqual, compileRule,
} from '../engine/rescore.js';
import { makeScoringRowStub } from '../model/scoring.js';
import { showConfirm } from './dialogs/confirm.js';
import { buildEditHintHTML, buildTrashIconHTML, buildDragHandleHTML, makeReorderable, buildMoreMenuHTML } from './components.js';
import { attachHelpPopups } from './rendering.js';

// Injected so this view imports nothing above ui (bake lives in the app layer).
let _bakeMenuOpts = () => ({});
let _bake         = async () => {};

export function configureRescoreEditor({ bakeMenuOpts, bake }) {
  if (bakeMenuOpts) _bakeMenuOpts = bakeMenuOpts;
  if (bake)         _bake         = bake;
}

// ─── Draft binding ─────────────────────────────────────────────────────────

// Every edit mutates _draft in place: Manage holds the same array, so a
// reassignment would silently drop the edit from what Save commits.
let _draft = null;
let _scope = null;            // a source, or MERGED_ID for the tier labels
let _host = null;
let _menuHost = null;         // where the lifecycle actions' ⋮ menu goes
let _onChange = () => {};
let _defaults = () => null;   // what Reset restores, under the staged publisher
let _resetLabel = () => 'Reset to defaults';
let _bakeBlocked = () => false;

function isScoringScope(scope) { return scope === MERGED_ID; }

export function bindDraft({ scope, rules, host, menuHost = null, onChange, defaults = () => null, resetLabel = () => 'Reset to defaults', bakeBlocked = () => false }) {
  _scope = scope;
  _draft = rules;
  _host = host;
  _menuHost = menuHost;
  _onChange = onChange;
  _defaults = defaults;
  _resetLabel = resetLabel;
  _bakeBlocked = bakeBlocked;
  recompileDraft();
  renderDraft();
}

export function unbindDraft() {
  _draft = null; _scope = null; _host = null; _menuHost = null;
  _onChange = () => {}; _defaults = () => null; _resetLabel = () => 'Reset to defaults'; _bakeBlocked = () => false;
}

function recompileDraft() {
  if (_draft && !isScoringScope(_scope)) _draft.forEach(compileRule);
}

function replaceDraft(rules) {
  _draft.splice(0, _draft.length, ...rules.map(r => ({ ...r })));
}

function renderDraft() {
  if (!_host?.isConnected) return;
  _host.innerHTML = isScoringScope(_scope) ? buildScoringSectionHTML() : buildRescoreSectionHTML();
  refreshEditorMenu();
  makeReorderable(_host.querySelector('.rules-list'), {
    handleSelector: '.drag-handle',
    itemSelector: '.rule-row',
    onReorder: onDraftReorder,
  });
  attachHelpPopups();
}

function afterDraftChange() {
  recompileDraft();
  renderDraft();
  _onChange({ edited: true });
}

// No re-render: the field already shows its value (onRuleInput normalized it and
// flagged it live), and rebuilding the list on a field's change would replace
// the field the user is clicking into, dropping their focus.
function afterFieldCommit() {
  recompileDraft();
  refreshEditorMenu();
  _onChange({ edited: true });
}

// Bake reads committed rules; Manage blocks it while anything is staged, so
// the draft equals them here.
export async function makeRescorePermanent() {
  if (!_draft || isScoringScope(_scope) || _bakeBlocked()) return;
  await _bake(_scope);
  _onChange({ reseed: true });
}

function focusNewRow() {
  const inp = [...(_host?.querySelectorAll('.rule-row .rule-in') ?? [])].find(i => !i.value);
  inp?.focus();
}

function onDraftReorder(fromEl, beforeEl) {
  if (!_draft) return;
  const fromIdx = parseInt(fromEl.dataset.i, 10);
  if (!_draft[fromIdx]) return;
  let toIdx = beforeEl ? parseInt(beforeEl.dataset.i, 10) : _draft.length;
  const [moved] = _draft.splice(fromIdx, 1);
  if (toIdx > fromIdx) toIdx--;
  _draft.splice(toIdx, 0, moved);
  afterDraftChange();
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
  const handle = readOnly ? '' : buildDragHandleHTML();
  return `<div class="rule-row" data-i="${i}">
      ${handle}
      ${fieldsHTML}
      ${noteWrap}
      ${delBtn}
    </div>`;
}

export function buildRulesListHTML(rules, { rulesId = '', saveFn, deleteFn, addFn = '', rescore = false, readOnly = false }) {
  let rulesHTML;
  if (!rules.length && rescore) {
    rulesHTML = '<div class="no-rules">No rules — entries kept as-is</div>';
  } else {
    rulesHTML = rules.map((r, i) => {
      const inputInvalid = !readOnly && parseRange((r.input || '').trim()) === null;
      const disabled = readOnly ? ' disabled' : '';
      const inputHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'input',this.value)"`;
      let fieldsHTML = `<input class="rule-in${inputInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.input)}"
            data-help="rule/score" title="Score range"${disabled}${inputHandlers}>`;
      if (rescore) {
        const lenVal = (r.length || '').trim();
        const lenInvalid = !readOnly && lenVal !== '' && parseRange(lenVal) === null;
        const outInvalid = !readOnly && isRuleOutputInvalid(r.input, r.output);
        const lenHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'length',this.value)"`;
        const outHandlers = readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'output',this.value)"`;
        fieldsHTML += `
          <span class="rule-field-lbl">length</span><input class="rule-len${lenInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.length||'')}" placeholder="any"
            data-help="rule/length" title="Entry length filter"${disabled}${lenHandlers}>
          <span class="rule-arrow">→</span>
          <input class="rule-out${outInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.output)}" placeholder="unchanged"
            data-help="rule/output" title="Output score"${disabled}${outHandlers}>`;
      }
      return buildRuleRowHTML(i, fieldsHTML, r.note, deleteFn, readOnly);
    }).join('');
  }
  const addBtn = (!readOnly && addFn) ? `<button type="button" class="rule-add-btn" onclick="${addFn}()">+ Add rule</button>` : '';
  return `<div class="rules-list"${rulesId ? ` id="${rulesId}"` : ''}>${rulesHTML}${addBtn}</div>`;
}

function buildRescoreSectionHTML() {
  return buildRulesListHTML(_draft, {
    rulesId: 'rescore-rules', saveFn: 'saveRuleField', deleteFn: 'deleteRule', addFn: 'addRule', rescore: true,
  });
}

function buildScoringSectionHTML() {
  return buildRulesListHTML(_draft, {
    rulesId: 'scoring-rules', saveFn: 'saveScoringField', deleteFn: 'deleteScoringRow', addFn: 'addScoringRow', rescore: false,
  });
}

function menuItems() {
  if (isScoringScope(_scope)) {
    return scoringRulesEqual(_draft, DEFAULT_SCORING) ? []
      : [['Reset to defaults', 'resetScoringRules()', { className: 'rule-reset-btn' }]];
  }
  const items = [];
  const defaults = _defaults();
  if (defaults !== null && !rescoreRulesEqual(_draft, defaults)) {
    items.push([esc(_resetLabel()), 'resetRescoreRules()', { className: 'rule-reset-btn' }]);
  }
  if (rescoringIsNeutralizable(_draft)) {
    items.push(['Disable rescoring', 'neutralizeRescoreRules()',
      { className: 'rule-neutralize-btn', title: "Keep this list's raw scores and notes — drop only Grawlix's rescoring" }]);
  }
  const bakeOpts = _bakeBlocked() ? { disabled: true, title: 'Save first' } : _bakeMenuOpts(_scope, _draft);
  items.push(['Make permanent', 'makeRescorePermanent()', { className: 'rule-bake-btn', ...bakeOpts }]);
  return items;
}

// Rebuilt only when it changes: refreshes land on every keystroke and staged
// change, and replacing an open menu would close it under the pointer.
export function refreshEditorMenu() {
  if (!_menuHost || !_draft) return;
  const items = menuItems();
  const html = items.length ? buildMoreMenuHTML(items, { className: 'rescore-kebab', title: 'More actions' }) : '';
  if (_menuHost._html === html) return;
  _menuHost._html = html;
  _menuHost.innerHTML = html;
}

// ─── Scoring (tier labels) ────────────────────────────────────────────────────

export function deleteScoringRow(i) {
  if (!_draft || !isScoringScope(_scope)) return;
  _draft.splice(i, 1);
  afterDraftChange();
}

export function saveScoringField(i, field, val) {
  if (!_draft || !isScoringScope(_scope) || !_draft[i]) return;
  _draft[i][field] = val;
  afterFieldCommit();
}

export function addScoringRow() {
  if (!_draft || !isScoringScope(_scope)) return;
  _draft.push(makeScoringRowStub());
  afterDraftChange();
  focusNewRow();
}

export async function resetScoringRules() {
  if (!_draft || !isScoringScope(_scope)) return;
  if (!await showConfirm('Replace your tier labels with the defaults? Your customizations will be lost.', { confirmText: 'Reset' })) return;
  replaceDraft(DEFAULT_SCORING);
  afterDraftChange();
}

// ─── Rescore rule management ──────────────────────────────────────────────────

export function deleteRule(idx) {
  if (!_draft || isScoringScope(_scope)) return;
  _draft.splice(idx, 1);
  afterDraftChange();
}

export function saveRuleField(idx, field, value) {
  if (!_draft || isScoringScope(_scope) || !_draft[idx]) return;
  if (field === 'length' && value.trim().toLowerCase() === 'any') value = '';
  if (field === 'output' && value.trim().toLowerCase() === 'unchanged') value = '';
  _draft[idx][field] = value;
  afterFieldCommit();
}

export function addRule() {
  if (!_draft || isScoringScope(_scope)) return;
  _draft.push(makeRescoreRuleStub());
  afterDraftChange();
  focusNewRow();
}

export async function resetRescoreRules() {
  if (!_draft || isScoringScope(_scope)) return;
  const defaults = _defaults();
  if (defaults === null) return;
  if (!await showConfirm('Replace your rescore rules with the defaults? Your customizations will be lost.', { confirmText: 'Reset' })) return;
  replaceDraft(defaults);
  afterDraftChange();
}

function rescoringIsNeutralizable(rules) {
  return (rules || []).some(r => r.scoring === false || (r.output ?? '').trim() !== '');
}

// No confirm: this only stages into the draft, which Cancel discards and Save commits.
export function neutralizeRescoreRules() {
  if (!_draft || isScoringScope(_scope) || !_draft.length) return;
  replaceDraft(_draft.filter(r => r.scoring !== false).map(r => ({ ...r, output: '' })));
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
  const isScoring = isScoringScope(_scope);
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
      // Escape cancels the note, not the Manage dialog around it.
      e.preventDefault();
      e.stopPropagation();
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
  const container = el.closest('.rules-list');
  if (!container) return;
  validateRulesContainer(container);
  liveEditDraftField(el);
}

function liveEditDraftField(el) {
  if (!_draft) return;
  const row = el.closest('.rule-row');
  const field = el.classList.contains('rule-in') ? 'input'
    : el.classList.contains('rule-len') ? 'length'
    : el.classList.contains('rule-out') ? 'output' : null;
  if (!row || field === null) return;
  const i = parseInt(row.dataset.i, 10);
  if (!_draft[i]) return;
  _draft[i][field] = el.value;
  if (!isScoringScope(_scope)) compileRule(_draft[i]);
  refreshEditorMenu();
  _onChange({ edited: true, live: true });
}
