'use strict';

// ─── Manage wordlists panel ─────────────────────────────────────────────────
// A list of the wordlists; clicking a row slides over to its page (its
// details and rescore rules, or for All Wordlists the scoring tiers).
// Everything but adding and deleting a list is staged in `shadow` and
// committed by one Save. See docs/wordlists.md § The manage panel.

import { MERGED_ID, MERGED_NAME } from '../core/constants.js';
import { pluralize } from '../core/util.js';
import { effect } from '../core/signals.js';
import { rescoreRulesEqual, scoringRulesEqual } from '../engine/rescore.js';
import { state, cacheVersion$, configSummary$ } from '../data/state.js';
import {
  persistMeta, batchUpdate, repaintAfterCacheChange, applyRescoreRulesChange,
  setWordlistName, setWordlistIcon, setWordlistUrl, setWordlistPublisher,
} from '../data/persist.js';
import { sourceTotal, mergedEntryCount } from '../data/merge.js';
import { getPublisher } from '../data/publishers.js';
import { getWordlistDefaultRules } from '../data/rescoring.js';
import { getMergeMode, setMergeMode, getTrashScore, setTrashScore } from '../data/serialize.js';
import { applyScoringChange } from '../model/scoring.js';
import { getWordlistIcon, getMergedIcon } from './icons.js';
import { makeReorderable, closeMenus, buildChoiceArrowHTML, toggleChoiceMenu } from './components.js';
import { createDialog, showDialog } from './dialogs/dialog.js';
import { AddWordlistDialog } from './dialogs/add-wordlist.js';
import { WordlistForm } from './wordlist-form.js';
import { bindDraft, unbindDraft, refreshEditorMenu } from './rescore-editor.js';
import { buildWordlistCardHTML, buildWordlistNameIconHTML } from './scope-selector.js';
import { getEntriesScroller } from './rendering.js';
import { refreshScoreRangeButtons } from './app-view.js';

// deleteWordlist lives upward (app/actions.js); injected so this view imports
// nothing above ui.
let _deleteWordlist = async () => false;

export function configureManagePanel({ deleteWordlist }) {
  if (deleteWordlist) _deleteWordlist = deleteWordlist;
}

const MERGE_MODES = [
  { value: 'first',   label: 'First wins' },
  { value: 'highest', label: 'Highest score wins' },
  { value: 'lowest',  label: 'Lowest score wins' },
];

const TITLE = 'Manage wordlists';
const CARD_CARET = '<svg class="card-caret" width="11" height="11" aria-hidden="true"><use href="#icon-chevron-right"/></svg>';

const copyRules = rules => rules.map(r => ({ ...r }));

export const ManagePanel = (() => {
  let el, titleEl, backBtn, homeEl, detailEl, allEl, listEl, statusEl, deleteBtn, applyBtn, modeEl;
  let shadow = null;
  let sel = null;   // the list whose page is open; null while the list shows
  let form = null;

  // ─── Staged state ───────────────────────────────────────────────────────

  // A draft remembers the committed rules it was copied from (`base`), so a
  // clean draft can follow a commit made under the open dialog — an added
  // list's auto-seeded rules — instead of Save writing the stale copy back.
  function makeDraft(rules) { return { base: copyRules(rules), draft: copyRules(rules) }; }

  function stage(wl) {
    if (shadow.rules.has(wl)) return;
    shadow.rules.set(wl, makeDraft(wl.rescoreRules || []));
    shadow.general.set(wl, { name: wl.name, icon: wl.icon || null, url: wl.url || null, publisherId: wl.publisherId || null });
  }

  function reseedClean() {
    let selectedChanged = false;
    const follow = (d, committed, equal) => {
      if (!equal(d.draft, d.base) || equal(d.base, committed)) return false;
      d.base = copyRules(committed);
      d.draft.splice(0, d.draft.length, ...copyRules(committed));
      return true;
    };
    for (const [wl, d] of shadow.rules) {
      if (follow(d, wl.rescoreRules || [], rescoreRulesEqual) && wl === sel) selectedChanged = true;
    }
    if (follow(shadow.scoring, state.scoring, scoringRulesEqual) && sel === MERGED_ID) selectedChanged = true;
    return selectedChanged;
  }

  const stagedName = wl => shadow.general.get(wl)?.name.trim() || wl.name;
  const enabledOf = wl => shadow.enabled.get(wl) ?? wl.enabled;

  function rulesDirty(wl) {
    const d = shadow.rules.get(wl);
    return !!d && !rescoreRulesEqual(d.draft, wl.rescoreRules || []);
  }

  function generalDirty(wl) {
    const g = shadow.general.get(wl);
    return !!g && (g.name.trim() !== wl.name
      || (g.url || null) !== (wl.url || null)
      || (g.publisherId || null) !== (wl.publisherId || null)
      || JSON.stringify(g.icon) !== JSON.stringify(wl.icon || null));
  }

  function listDirty(wl) {
    return enabledOf(wl) !== wl.enabled || rulesDirty(wl) || generalDirty(wl);
  }

  function allDirty() {
    return shadow.mergeMode !== getMergeMode()
      || shadow.trashScore !== getTrashScore()
      || !scoringRulesEqual(shadow.scoring.draft, state.scoring);
  }

  function orderDirty() {
    return shadow.order.length !== state.sources.length
      || shadow.order.some((wl, i) => wl !== state.sources[i]);
  }

  function pendingNames() {
    const names = [];
    if (allDirty()) names.push(MERGED_NAME);
    if (orderDirty()) names.push('list order');
    for (const wl of shadow.order) if (listDirty(wl)) names.push(stagedName(wl));
    return names;
  }

  function isDirty() { return pendingNames().length > 0; }

  // ─── The list ───────────────────────────────────────────────────────────

  const pendingBadge = dirty => dirty ? { severity: 'pending', severityTitle: 'Unsaved changes' } : {};

  function allCardHTML() {
    return buildWordlistCardHTML(getMergedIcon(), MERGED_NAME, pluralize(mergedEntryCount(), 'entry', 'entries'),
      { pinned: true, extraActions: CARD_CARET, ...pendingBadge(allDirty()) });
  }

  function cardHTML(wl) {
    const total = sourceTotal(wl);
    return buildWordlistCardHTML(
      getWordlistIcon(wl),
      stagedName(wl),
      total == null ? '…' : pluralize(total, 'entry', 'entries'),
      { enabled: enabledOf(wl), populated: wl.populated, pinned: wl.type === 'edits',
        extraActions: CARD_CARET, ...pendingBadge(listDirty(wl)) },
    );
  }

  function renderMode() {
    modeEl.querySelector('.choice-label').textContent = MERGE_MODES.find(m => m.value === shadow.mergeMode).label;
    modeEl.querySelector('.manage-merge-note').classList.toggle('off', shadow.mergeMode === 'first');
  }

  function renderList() {
    allEl.innerHTML = allCardHTML();
    allEl.firstElementChild._wordlist = MERGED_ID;
    listEl.innerHTML = shadow.order.map(cardHTML).join('');
    listEl.querySelectorAll('.wordlist-card').forEach((cardEl, i) => { cardEl._wordlist = shadow.order[i]; });
    renderFooter();
  }

  function renderFooter() {
    const names = pendingNames();
    statusEl.textContent = names.length ? `Unsaved changes: ${names.join(', ')}` : '';
    applyBtn.disabled = !names.length;
    deleteBtn.hidden = !sel || sel === MERGED_ID || sel.type === 'edits';
  }

  function changed() {
    renderList();
    refreshEditorMenu();
  }

  // ─── Pages ──────────────────────────────────────────────────────────────

  function teardownPage() {
    unbindDraft();
    form?.destroy();
    form = null;
  }

  function renderTitle() {
    backBtn.hidden = !sel;
    if (!sel) { titleEl.textContent = TITLE; return; }
    const g = sel === MERGED_ID ? null : shadow.general.get(sel);
    titleEl.innerHTML = buildWordlistNameIconHTML(g ? { ...sel, name: stagedName(sel), icon: g.icon } : sel, { bold: false });
  }

  const sectionHTML = (label, body, headExtra = '') => {
    const labelHTML = `<div class="configure-section-label">${label}</div>`;
    const head = headExtra ? `<div class="manage-section-head">${labelHTML}${headExtra}</div>` : labelHTML;
    return `<div class="configure-section">${head}${body}</div>`;
  };

  function renderPage() {
    teardownPage();
    renderTitle();
    if (sel === MERGED_ID) return renderAllPage();
    const wl = sel;
    detailEl.innerHTML = '';
    if (wl.type !== 'edits') renderGeneral(wl);
    detailEl.insertAdjacentHTML('beforeend', sectionHTML('Rescoring rules', '<div class="manage-rules"></div>', '<span class="rescore-menu"></span>'));
    renderRescoring(wl);
  }

  function renderAllPage() {
    detailEl.innerHTML = sectionHTML('Scoring tiers', '<div class="manage-rules"></div>', '<span class="rescore-menu"></span>')
      + sectionHTML('Trash score', `<div class="dialog-row">
          <span class="dialog-row-sub">Score given to deleted and unlisted entries</span>
          <input class="trash-score-input" type="number" min="0" aria-label="Trash score" value="${shadow.trashScore}">
        </div>`);
    bindDraft({
      scope: MERGED_ID, rules: shadow.scoring.draft, onChange: changed,
      host: detailEl.querySelector('.manage-rules'), menuHost: detailEl.querySelector('.rescore-menu'),
    });
    const trashInp = detailEl.querySelector('.trash-score-input');
    trashInp.addEventListener('change', () => {
      const n = parseInt(trashInp.value, 10);
      shadow.trashScore = Number.isFinite(n) && n >= 0 ? n : 0;
      trashInp.value = shadow.trashScore;
      changed();
    });
  }

  function renderGeneral(wl) {
    const g = shadow.general.get(wl);
    form = new WordlistForm({
      mode: 'configure',
      rulesOption: false,
      onChange: () => {
        const v = form.values();
        Object.assign(g, { name: v.name, icon: v.icon, url: v.url, publisherId: v.publisherId });
        renderTitle();
        changed();
      },
    });
    form.load({ wordlist: wl, ...g });
    detailEl.append(form.el);
  }

  // The editor's Reset restores the staged publisher's rules, which is how a
  // newly picked publisher's rules get applied; its label says so then.
  function renderRescoring(wl) {
    const g = shadow.general.get(wl);
    bindDraft({
      scope: wl,
      rules: shadow.rules.get(wl).draft,
      host: detailEl.querySelector('.manage-rules'),
      menuHost: detailEl.querySelector('.rescore-menu'),
      defaults: () => getWordlistDefaultRules(wl, g.publisherId),
      resetLabel: () => {
        const pub = (g.publisherId || null) !== (wl.publisherId || null) && getPublisher({ publisherId: g.publisherId });
        return pub ? `Use ${pub.name}'s rules` : 'Reset to defaults';
      },
      bakeBlocked: isDirty,
      onChange: ({ reseed } = {}) => {
        if (reseed) {
          shadow.rules.set(wl, makeDraft(wl.rescoreRules || []));
          renderPage();
        }
        changed();
      },
    });
  }

  // The off-screen view is inert, so Tab can't reach controls slid out of view.
  function slideTo(detail) {
    el.classList.toggle('detail', detail);
    homeEl.inert = detail;
    detailEl.inert = !detail;
  }

  function openPage(scope) {
    sel = scope;
    renderPage();
    renderFooter();
    slideTo(true);
  }

  function showList() {
    teardownPage();
    sel = null;
    renderTitle();
    renderList();
    slideTo(false);
  }

  // ─── Save ───────────────────────────────────────────────────────────────

  function blankName() {
    return shadow.order.find(wl => !shadow.general.get(wl)?.name.trim());
  }

  function apply() {
    if (!isDirty()) { el.close(); return; }
    const unnamed = blankName();
    if (unnamed) {
      openPage(unnamed);
      form.validate();
      return;
    }
    const tiersChanged = !scoringRulesEqual(shadow.scoring.draft, state.scoring);
    const trashChanged = shadow.trashScore !== getTrashScore();
    batchUpdate(() => {
      state.sources.splice(0, state.sources.length, ...shadow.order);
      for (const wl of state.sources) {
        wl.enabled = enabledOf(wl);
        const g = shadow.general.get(wl);
        if (generalDirty(wl)) {
          setWordlistName(wl, g.name.trim());
          setWordlistIcon(wl, g.icon);
          setWordlistUrl(wl, g.url);
          setWordlistPublisher(wl, g.publisherId);
        }
        if (rulesDirty(wl)) {
          wl.rescoreRules = copyRules(shadow.rules.get(wl).draft);
          applyRescoreRulesChange(wl);
        }
      }
      setMergeMode(shadow.mergeMode);
      if (trashChanged) setTrashScore(shadow.trashScore);
      persistMeta();
      repaintAfterCacheChange();
      // Tiers commit last: propagateDefaults pushes them onto a clean My Edits,
      // and run before My Edits' rules it would leave them marked dirty.
      if (tiersChanged) {
        state.scoring = copyRules(shadow.scoring.draft);
        applyScoringChange();
      }
    });
    // The score filter defaults to trash score + 1, so its reset target moved.
    if (trashChanged) refreshScoreRangeButtons();
    if (tiersChanged) getEntriesScroller()?._render?.();
    el.close();
  }

  // ─── Mount ──────────────────────────────────────────────────────────────

  function absorb() {
    for (const wl of state.sources) {
      if (shadow.order.includes(wl)) continue;
      // Stays out of shadow.enabled: an added list's async force-enable must
      // not read as a staged disable.
      shadow.order.push(wl);
      stage(wl);
    }
  }

  async function deleteSelected() {
    const wl = sel;
    if (!await _deleteWordlist(wl) || !shadow) return;
    shadow.order = shadow.order.filter(w => w !== wl);
    shadow.enabled.delete(wl);
    shadow.rules.delete(wl);
    shadow.general.delete(wl);
    showList();
  }

  function mount() {
    let body;
    ({ el, body } = createDialog('manage-dialog', { labelledby: 'manage-dialog-title', isDirty: () => !!shadow && isDirty() }));
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="manage-dialog-title"><button type="button" class="dialog-back-btn" aria-label="Back to the lists" hidden><svg width="11" height="11" aria-hidden="true"><use href="#icon-chevron-right"/></svg></button><span class="manage-title"></span></h2>
      <div class="manage-views">
        <div class="manage-track">
          <div class="manage-home">
            <div class="manage-all"></div>
            <div class="manage-merge">
              <div class="dialog-row">
                <span class="dialog-row-label">When lists share an entry</span>
                <span class="tool-row-param tool-row-match manage-merge-choice"><span class="match-mode-toggle choice-label"></span>${buildChoiceArrowHTML('Change merge mode')}</span>
              </div>
              <div class="dialog-row-sub manage-merge-note">(My Edits always wins)</div>
            </div>
            <div class="manage-list"></div>
            <button type="button" class="manage-add-row"><span class="add-wordlist-icon">＋</span>Add wordlist</button>
          </div>
          <div class="manage-detail"></div>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="delete-link manage-delete-btn" title="Delete this wordlist" hidden>Delete</button>
        <span class="manage-status" aria-live="polite"></span>
        <button type="button" class="manage-cancel-btn dialog-cancel-btn">Cancel</button>
        <button type="button" class="manage-apply-btn primary">Save</button>
      </div>`;

    titleEl   = el.querySelector('.manage-title');
    backBtn   = el.querySelector('.dialog-back-btn');
    homeEl    = el.querySelector('.manage-home');
    detailEl  = el.querySelector('.manage-detail');
    allEl     = el.querySelector('.manage-all');
    listEl    = el.querySelector('.manage-list');
    statusEl  = el.querySelector('.manage-status');
    deleteBtn = el.querySelector('.manage-delete-btn');
    applyBtn  = el.querySelector('.manage-apply-btn');
    modeEl    = el.querySelector('.manage-merge');

    modeEl.querySelector('.manage-merge-choice').addEventListener('click', e => {
      e.stopPropagation();
      toggleChoiceMenu(modeEl.querySelector('.choice-arrow'), {
        choices: MERGE_MODES, current: shadow.mergeMode, anchor: e.currentTarget,
        onPick: mode => { shadow.mergeMode = mode; renderMode(); changed(); },
      });
    });

    listEl.addEventListener('change', e => {
      const input = e.target.closest('.toggle input[type="checkbox"]');
      if (!input) return;
      // Must write the shadow map, never wl.enabled: touching wl.enabled here would
      // silently mutate canonical state and rebuild the merge mid-staging, defeating
      // the Save gate while looking identical on screen.
      shadow.enabled.set(input.closest('.wordlist-card')._wordlist, input.checked);
      changed();
    });

    const pickCard = e => {
      if (e.target.closest('.toggle, .drag-handle')) return;
      const card = e.target.closest('.wordlist-card');
      if (card) openPage(card._wordlist);
    };
    homeEl.addEventListener('click', pickCard);
    homeEl.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.wordlist-card')) { e.preventDefault(); pickCard(e); }
    });

    // Stage into shadow.order, never reorderSources: that canonical path would
    // rebuild the merge mid-staging and defeat the Save gate, looking identical
    // on screen — the same trap as the enable toggle above.
    makeReorderable(listEl, {
      handleSelector: '.drag-handle:not([aria-hidden])',
      itemSelector:   '.wordlist-card',
      canDrop: (fromEl, beforeEl) => beforeEl?._wordlist.type !== 'edits',
      onReorder: (fromEl, beforeEl) => {
        const from = shadow.order.indexOf(fromEl._wordlist);
        let to = beforeEl ? shadow.order.indexOf(beforeEl._wordlist) : shadow.order.length;
        if (to > from) to--;
        const [item] = shadow.order.splice(from, 1);
        shadow.order.splice(to, 0, item);
        changed();
      },
    });

    backBtn.addEventListener('click', showList);
    deleteBtn.addEventListener('click', deleteSelected);
    applyBtn.addEventListener('click', apply);
    el.querySelector('.manage-add-row').addEventListener('click', () => AddWordlistDialog.open(() => {
      if (shadow) { absorb(); renderList(); }
    }));

    // Capture: bubbling would reach createDialog's guard first, so Escape on an
    // open icon picker would ask "Discard changes?" instead of closing the picker.
    el.addEventListener('cancel', e => {
      if (form?.consumeEscape()) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    el.addEventListener('close', closeMenus);

    // Self-gates on shadow rather than subscribing only while open: the signals
    // lib has no teardown, so this lifelong effect must no-op when closed.
    effect(() => {
      cacheVersion$.get();
      configSummary$.get();   // a fetch content-diff bumps this, not cacheVersion$, but still changes the per-row entry count
      if (!shadow) return;
      absorb();
      const reseeded = reseedClean();
      renderList();
      if (reseeded && sel) renderPage();
    });
  }

  // Opening straight onto a page (the bar's ⋮ › Rescoring rules…) doesn't
  // animate the slide: the dialog is still closed, so no transition runs.
  function open(scope = null) {
    shadow = {
      order: [...state.sources],
      enabled: new Map(state.sources.map(wl => [wl, wl.enabled])),
      rules: new Map(),
      general: new Map(),
      mergeMode: getMergeMode(),
      trashScore: getTrashScore(),
      scoring: makeDraft(state.scoring),
    };
    for (const wl of state.sources) stage(wl);
    renderMode();
    showList();
    if (scope) openPage(scope);
    showDialog(el, () => { teardownPage(); shadow = null; });
  }

  return { mount, open };
})();
