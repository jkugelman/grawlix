'use strict';

// ─── Rescore editor ─────────────────────────────────────────────────────────
// Edits one draft — a list's rescore rules or the tier labels — that the
// Manage wordlists dialog owns and commits on Save. See docs/wordlists.md
// § Rescore and scoring.

import { MERGED_ID, DEFAULT_SCORING } from '../core/constants.js';
import { esc, pluralize } from '../core/util.js';
import { parseRange } from '../engine/range.js';
import {
  makeRescoreRuleStub, rescoreRulesEqual, scoringRulesEqual, compileRule, formatRuleOutput,
} from '../engine/rescore.js';
import { suggest, readsDisplay, QUERY_REFERENCE } from '../engine/rule-suggest.js';
import { makeScoringRowStub } from '../model/scoring.js';
import { buildScoreBadgeHTML } from '../model/score-display.js';
import { showConfirm } from './dialogs/confirm.js';
import { buildEditHintHTML, buildTrashIconHTML, buildDragHandleHTML, makeReorderable, buildMoreMenuHTML } from './components.js';
import { attachHelpPopups } from './rendering.js';
import { buildScoreOptions } from './entries-table.js';
import { fetchRuleCounts } from './pipeline-worker.js';
import { SuggestField, QueryField, queryHTML, hideSuggestions, refreshSuggestionFooter } from './query-editor.js';

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
  _counts = null;
  _probeCounts = new Map();
  recompileDraft();
  renderDraft();
}

export function unbindDraft() {
  _draft = null; _scope = null; _host = null; _menuHost = null;
  _onChange = () => {}; _defaults = () => null; _resetLabel = () => 'Reset to defaults'; _bakeBlocked = () => false;
  clearTimeout(_countsTimer);
  _counts = null;
  hideSuggestions();
}

function recompileDraft() {
  if (_draft && !isScoringScope(_scope)) _draft.forEach(compileRule);
}

function replaceDraft(rules) {
  _draft.splice(0, _draft.length, ...rules.map(r => ({ ...r })));
}

function renderDraft() {
  hideSuggestions();
  if (!_host?.isConnected) return;
  _host.innerHTML = isScoringScope(_scope) ? buildScoringSectionHTML() : buildRescoreSectionHTML();
  refreshEditorMenu();
  makeReorderable(_host.querySelector('.rules-list'), {
    handleSelector: '.drag-handle',
    itemSelector: '.rule-row',
    onReorder: onDraftReorder,
  });
  attachHelpPopups();
  if (!isScoringScope(_scope)) {
    mountRuleFields();
    renderCounts();
    scheduleCounts(0);
  }
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
  scheduleCounts();
}

// ─── Rule fields ──────────────────────────────────────────────────────────────

function mountRuleFields() {
  for (const row of _host.querySelectorAll('#rescore-rules .rule-row')) {
    const i = +row.dataset.i;
    new QueryField(row.querySelector('.rule-query'), {
      status: row.querySelector('.rule-status'),
      suggest: (text, a, b) => suggest(text, a, b, { tiers: buildScoreOptions() }),
      countProbes,
      onInput: text => {
        if (!_draft?.[i]) return;
        _draft[i].query = text;
        compileRule(_draft[i]);
        refreshEditorMenu();
        _onChange({ edited: true, live: true });
        scheduleCounts();
      },
      onCommit: () => afterFieldCommit(),
      footer: () => ruleFooterHTML(i),
    });
    const out = row.querySelector('.rule-out');
    new SuggestField(out, { suggest: (text, a, b) => outputSuggestions(text, a, b, _draft?.[i]), format: formatRuleOutput });
  }
}

function outputSuggestions(text, a, b, rule) {
  const item = (value, labelHTML, desc) => ({
    kind: 'value', label: value, labelHTML, desc, rs: 0, re: text.length, insert: value, caret: value.length,
  });
  const items = [item('', '<span class="rule-suggest-label">unchanged</span>', 'Keep the score')];
  for (const o of buildScoreOptions()) {
    items.push(item(String(o.score), `<span class="rule-suggest-label">${buildScoreBadgeHTML(o.score)}</span>`, o.note));
  }
  const ranged = rule?._scoreInterval && rule._scoreInterval.max !== rule._scoreInterval.min;
  return {
    groups: [{ label: 'New score', items }],
    hint: ranged ? 'A range like <code>60+</code> or <code>20-39</code> moves the whole score range.' : null,
    active: -1,
  };
}

// ─── Live counts ──────────────────────────────────────────────────────────────

let _counts = null;           // the worker's countRules result for the draft
let _probeCounts = new Map(); // suggestion probe → count, for this list
let _countsTimer = 0;
let _countsSeq = 0;

function scheduleCounts(delay = 150) {
  clearTimeout(_countsTimer);
  _countsTimer = setTimeout(runCounts, delay);
}

async function runCounts() {
  if (!_draft || !_scope?.dbKey || isScoringScope(_scope)) return;
  const seq = ++_countsSeq;
  const result = await fetchRuleCounts({ sourceId: _scope.dbKey, rules: _draft });
  if (seq !== _countsSeq || !_draft) return;
  _counts = result;
  renderCounts();
}

async function countProbes(probes) {
  const missing = probes.filter(p => !_probeCounts.has(p));
  if (missing.length && _scope?.dbKey) {
    const result = await fetchRuleCounts({ sourceId: _scope.dbKey, rules: [], probes: missing });
    if (!result) return null;
    missing.forEach((p, k) => _probeCounts.set(p, result.probes[k]));
  }
  return _probeCounts;
}

function renderCounts() {
  if (!_host?.isConnected) return;
  for (const row of _host.querySelectorAll('#rescore-rules .rule-row')) {
    const i = +row.dataset.i;
    if (!_draft[i]) continue;
    row.querySelector('.rule-meta').innerHTML = ruleMetaHTML(_draft[i], i);
  }
  refreshSuggestionFooter();
  const rest = _host.querySelector('.rules-rest');
  if (rest) {
    rest.textContent = _counts?.unmatched && _draft.length
      ? `${_counts.unmatched.toLocaleString()} of ${pluralize(_counts.total, 'entry', 'entries')} match no rule and keep their score.`
      : '';
  }
}

function ruleMetaHTML(rule, i) {
  if (!(rule.query || '').trim()) return 'Type a condition to see which entries it catches.';
  if (!_counts) return '';
  const c = _counts.rules[i];
  if (!c) return '<span class="rule-meta-off">This rule does nothing until it’s fixed.</span>';
  if (!c.wins) {
    const bare = _counts.bare && readsDisplay(rule.query)
      ? `<span class="rule-meta-note">${esc(_scope.name)} has no capitalization or spaces, so this can’t tell its entries apart.</span>` : '';
    return `<span>No entries match.</span>${bare}`;
  }
  return `<span class="rule-count">${pluralize(c.wins, 'entry', 'entries')}</span>`;
}

function ruleFooterHTML(i) {
  const c = _counts?.rules[i];
  if (!c?.wins || !(_draft[i]?.query || '').trim()) return null;
  return esc(ruleSamplesText(i));
}

function ruleSamplesText(i) {
  const c = _counts?.rules[i];
  if (!c?.wins || !(_draft[i].query || '').trim()) return '';
  return c.samples.map(e => e.display ?? e.norm).join(', ') + (c.wins > c.samples.length ? ', …' : '');
}

// Bake reads committed rules; Manage blocks it while anything is staged, so
// the draft equals them here.
export async function makeRescorePermanent() {
  if (!_draft || isScoringScope(_scope) || _bakeBlocked()) return;
  await _bake(_scope);
  _onChange({ reseed: true });
}

function focusNewRow() {
  const inp = [...(_host?.querySelectorAll('.rule-row :is(.rule-in, .rule-query)') ?? [])].find(i => !i.value);
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

export function buildRuleRowHTML(i, fieldsHTML, note, onDeleteFn, readOnly = false, details = false) {
  const noteWrap = readOnly
    ? `<span class="rule-note-wrap${note ? ' has-note' : ''}"><span class="rule-note-text">${esc(note||'')}</span></span>`
    : `<span class="rule-note-wrap${note ? ' has-note' : ''}" onclick="startNoteEdit(this)" title="Click to edit">
        <span class="rule-note-text">${esc(note||'')}</span>
        ${buildEditHintHTML('rule-note-pencil', 'startNoteEdit(this.parentElement)')}
      </span>`;
  const delBtn = readOnly ? '' : `<button class="icon rule-del" onclick="${onDeleteFn}(${i})" title="Delete row">${buildTrashIconHTML()}</button>`;
  const handle = readOnly ? '' : buildDragHandleHTML();
  if (details) {
    return `<div class="rule-row rule-row-wrap" data-i="${i}">
      ${handle}
      ${fieldsHTML}
      ${delBtn}
      <div class="rule-status" aria-live="polite"></div>
      <div class="rule-foot"><div class="rule-meta"></div>${noteWrap}</div>
    </div>`;
  }
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
      const disabled = readOnly ? ' disabled' : '';
      const handlers = field => (readOnly ? '' : ` oninput="onRuleInput(this)" onchange="${saveFn}(${i},'${field}',this.value)"`);
      let fieldsHTML;
      if (rescore) {
        const v = readOnly ? null : ruleValidity(r);
        const queryField = readOnly
          ? `<span class="rule-query rule-query-static">${queryHTML(r.query || '')}</span>`
          : `<div class="rule-query-box"><div class="rule-query-hl" aria-hidden="true"></div><textarea class="rule-query" rows="1"
              autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Condition" placeholder="Click to pick a condition">${esc(r.query)}</textarea></div>`;
        fieldsHTML = `${queryField}
          <span class="rule-arrow">→</span>
          <input class="rule-out${v?.output ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.output)}" placeholder="unchanged"
            aria-label="New score" title="${esc(v?.output || 'New score')}"${disabled}${handlers('output')}>`;
      } else {
        const inputInvalid = !readOnly && parseRange((r.input || '').trim()) === null;
        fieldsHTML = `<input class="rule-in${inputInvalid ? ' invalid' : ''}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(r.input)}"
            data-help="rule/score" title="Score range"${disabled}${handlers('input')}>`;
      }
      return buildRuleRowHTML(i, fieldsHTML, r.note, deleteFn, readOnly, rescore && !readOnly);
    }).join('');
  }
  const addBtn = (!readOnly && addFn) ? `<button type="button" class="rule-add-btn" onclick="${addFn}()">+ Add rule</button>` : '';
  return `<div class="rules-list"${rulesId ? ` id="${rulesId}"` : ''}>${rulesHTML}${addBtn}</div>`;
}

function buildRescoreSectionHTML() {
  return buildRulesListHTML(_draft, {
    rulesId: 'rescore-rules', saveFn: 'saveRuleField', deleteFn: 'deleteRule', addFn: 'addRule', rescore: true,
  }) + '<div class="rules-rest"></div>' + buildQueryReferenceHTML();
}

function buildQueryReferenceHTML() {
  const code = v => `<code>${queryHTML(v)}</code>`;
  const fields = QUERY_REFERENCE.fields.map(f =>
    `<tr><td>${code(f.name + ':')}</td><td>${esc(f.desc)}</td><td>${f.examples.map(v => `<code>${esc(v)}</code>`).join(', ')}</td></tr>`).join('');
  const ops = QUERY_REFERENCE.operators.map(([op, desc, ex]) =>
    `<tr><td><code class="q-op">${esc(op)}</code></td><td>${esc(desc)}</td><td>${code(ex)}</td></tr>`).join('');
  return `<details class="faq-item rules-ref"><summary>Query language reference</summary>
    <div class="rules-ref-body"><table><thead><tr><th>Field</th><th>Checks</th><th>Values</th></tr></thead>
    <tbody>${fields}${ops}</tbody></table></div></details>`;
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
  const bakeOpts = _bakeBlocked() ? { disabled: true, title: 'Save first' } : _bakeMenuOpts(_scope);
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

function ruleValidity(rule) {
  const r = { query: rule.query, output: rule.output };
  compileRule(r);
  return { output: r._outputError };
}

function flagField(inp, msg, fallbackTitle) {
  if (!inp) return;
  inp.classList.toggle('invalid', !!msg);
  inp.title = msg || fallbackTitle;
}

function validateRulesContainer(container) {
  container.querySelectorAll('.rule-in').forEach(inp => {
    inp.classList.toggle('invalid', parseRange(inp.value.trim()) === null);
  });
  container.querySelectorAll('.rule-out').forEach(out => {
    const row = out.closest('.rule-row');
    const v = ruleValidity({ query: row.querySelector('.rule-query')?.value, output: out.value });
    flagField(out, v.output, 'New score');
  });
}

export function onRuleInput(el) {
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
    : el.classList.contains('rule-out') ? 'output' : null;
  if (!row || field === null) return;
  const i = parseInt(row.dataset.i, 10);
  if (!_draft[i]) return;
  _draft[i][field] = el.value;
  if (!isScoringScope(_scope)) {
    compileRule(_draft[i]);
    scheduleCounts();
  }
  refreshEditorMenu();
  _onChange({ edited: true, live: true });
}
