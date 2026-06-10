'use strict';

import {
  ROW_HEIGHT, VS_BUFFER, LS_PREFIX, MERGED_ID, MERGED_NAME, EDITS_ICON,
  EMOJI_LIST, WORDLIST_PUBLISHERS, DEFAULT_SCORING,
} from './core/constants.js';
import { esc, pluralize, plural, timeAgo, nameFromPath, buildHelpHTML } from './core/util.js';
import { getBrowser, isMobile } from './core/platform.js';
import { signal, effect, runBatched } from './core/signals.js';
import {
  stripAccents, toNorm, displayOf, projectRangesToDisplay, parseWordlist,
  buildUserWlEntry, synthWlEntry, validateWordlistChunk,
} from './engine/norm.js';
import { parseRange, matchesRange, rangeSpan } from './engine/range.js';
import {
  isLiteralQuery, buildSearchPattern,
  groupSpansToRanges, renderHighlightedText,
} from './engine/search.js';
import {
  analyzeRegexPattern, wrapRuns, parseReplacement,
  regexExecAll, runRegexReplace, runSearchReplace,
} from './engine/regex.js';
import {
  SPACE_OUT_WINDOWS, UNIGRAM_CORPUS_URL, UNIGRAM_CORPUS_IDB_KEY,
  configureIO as configureSegmenterIO, loadUnigramCorpus, rankedSplits,
  hasUnigramCorpus, setUnigramCorpus as segmenterSetCorpus,
  invalidateUnigramCorpus, getUnigramFetchedSize,
} from './engine/segmenter.js';
import { computeStatsRaw, invalidateStatsCache } from './engine/stats.js';
import {
  bucketCounts, slotIntersectsRange,
  invalidateHistogramLayout,
} from './engine/histogram.js';
import {
  FEATURED_TOOLS, TOOLS, PARAM_HELP, makeToolRow,
} from './engine/tools.js';
import {
  isFilterOnlyChain, isGroupChain, buildInitialChains,
  invalidatePreSearchCache, applyScoreRangeToRows,
  bottomLineAtoms, rowSetAtoms, rowLastEntry,
} from './engine/executor.js';
import {
  sources$, cacheVersion$, bumpCacheVersion, syncStatus$,
  state, wrapWordlist, newDbKey, syncKey, getEditsWordlist,
} from './data/state.js';
import {
  lsSave, lsLoad, lsDel,
  getDb, openDB, idbPut, idbGet, idbDel,
  Storage, resetAllDataAndReload,
} from './data/storage.js';
import {
  SCHEMA_VERSION, canMigrate, migrateSettings, migrateLocalStorage,
} from './data/migrations.js';
import {
  serializeEntries, sortedEntries, getOutputFormat, setOutputFormat,
} from './data/serialize.js';
import { getPublisher } from './data/publishers.js';
import {
  getRuleMaxScore, rescoreRulesEqual, scoringRulesEqual,
  compileRescoreRules, parseRuleOutput, applyRescoring, rescoreEntry,
  editsLegend, getWordlistDefaultRules, updateWordlistDirty,
  maybeAutoSeedRescoreRules, reconcileEditsRulesAfterImport, makeRescoreRuleStub,
  getRescoredEntries, getRescoredByNorm, invalidateRescoredCache,
} from './data/rescoring.js';
import {
  buildMergedWordlist, getActiveCorpus, mergeKey, mergedRowsForNorm,
  invalidateSourceCounts, getSourceCounts, peekMergedCache, dropScopedCorpus,
  snapshotMergedBuckets, patchMergedForNorms, _mergedStatsKey,
} from './data/merge.js';
import {
  scopedHistogramLayout, allSourcesHistogramLayout,
} from './data/derived.js';
import { invalidateWordlistCaches } from './data/invalidate.js';
import {
  persistMeta, persistScoring, batchUpdate, repaintAfterCacheChange,
  setWordlistName, setWordlistIcon, setWordlistUrl, setWordlistPublisher,
  setWordlistEnabled, setWordlistRescoreRules, applyRescoreRulesChange, reorderSources,
} from './data/persist.js';
import {
  configureSyncDialogs, syncTargets, persistSyncTarget,
  isMirrorList, editsSyncKey, listForSyncKey, syncFilename,
  SyncStatus, loadSyncTargets, Disk, MirrorSync, EditsSync,
  threeWayMergeEdits, attachMirrorSync, attachEditsSync, detachSync,
  rescoredFilename, sanitizeFilenameStem, partitionSyncPermissions, activateSyncTarget,
} from './data/disk-sync.js';
import {
  makeTierLookup, updateScoringDirty, propagateDefaults, makeScoringRowStub,
} from './model/scoring.js';
import {
  scoreColor, buildScoreBadgeHTML, buildScoreCellHTML,
} from './model/score-display.js';
import {
  hashStringMod, buildInitialsIconHTML, buildIconHTML,
  colorSeed, getWordlistIcon, getMergedIcon,
} from './ui/icons.js';
import { showToast, showActionToast, showUndoToast } from './ui/toasts.js';
import {
  buildSegCtrlHTML, buildOutputFormatControlsHTML, readOutputFormatControls,
  wireOutputFormatControls, buildBadgeHTML, buildClearableInputHTML,
  syncClearButton, mountClearableInputs, buildTextInputHTML, buildParamHTML,
  PopupHelp, buildSplitBtn, buildMoreMenuHTML, toggleSplitMenu, buildUrlInputHTML,
  buildEditHintHTML, buildTrashIconHTML, buildDragHandleHTML, makeReorderable,
} from './ui/components.js';
import {
  syncSignHTML, wordlistSeverity, sourcesSeverity, severityTitle,
} from './ui/sync-indicators.js';
import { createDialog, showDialog, enableDismissClicks } from './ui/dialogs/dialog.js';
import {
  showConfirm, showAlert, showMergeConflict, showEditsConflict,
} from './ui/dialogs/confirm.js';
import { openUpdateSummaryDialog } from './ui/dialogs/update-summary.js';
import { AppView, configureAppView, scopeKey, normalizeScoreRange } from './ui/app-view.js';
import {
  configureEntriesTable, EntriesScroller, AtomPopover, GroupMorePopover, ErrorPopover,
  chainSortTier, activeGroupColumns, DEFAULT_SORT_BY_TIER, isValidSortAxis, reconcileSort,
  buildEntriesTablePanelHTML, buildEntryHeadersHTML, onSortHeaderActivate, rebuildEntryHeaders,
} from './ui/entries-table.js';
import {
  ToolStack, ToolPicker, configureToolStack, mountGroupColumnStyle,
  runPipeline, pipelineIdle, buildToolCardHTML, buildToolLabelHTML,
  buildToolRowPartsHTML, buildSearchBarHTML, buildFindReplaceCaretHTML, allModeTooltip,
} from './ui/tool-stack.js';
import {
  mountHistogramPointer, onHistogramPointerDown, positionHistogramRect,
  repositionAllHistogramRects, rangeStrFromBounds,
} from './ui/histogram-view.js';
import {
  configureRescoreEditor, buildRulesListHTML, buildRescoreSectionHTML, buildScoringSectionHTML,
  renderScoringRules, startNoteEdit, onRuleInput,
  saveRuleField, deleteRule, addRule, resetRescoreRules, neutralizeRescoreRules,
  saveScoringField, deleteScoringRow, addScoringRow, resetScoringRules,
} from './ui/rescore-editor.js';
import {
  configureScopeSelector, WordlistSelector, renderSyncIndicators,
  buildWordlistNameHTML,
} from './ui/scope-selector.js';
import { configureManagePanel, ManagePanel } from './ui/manage-panel.js';
import { configureDiscoveryBanner, DiscoveryBanner } from './ui/discovery-banner.js';

// ─── Components ──────────────────────────────────────────────────────────────

// Scoped-source-only: on All Wordlists the open editor edits tier labels, which don't
// remap scores, so a raw → rescored arrow would be meaningless there.
function rescorePreviewActive() {
  return state.selected !== MERGED_ID && WordlistSelector.isEditorOpen();
}

const OUTPUT_FORMAT_REGEN_DELAY = 1000;

function buildStatItemHTML(label, value, title, extraClass) {
  const cls = 'stat' + (extraClass ? ' ' + extraClass : '');
  return `<div class="${cls}"${title ? ` title="${title}"` : ''}>
    <span class="stat-label">${label}</span>
    <span class="stat-value">${value}</span>
  </div>`;
}

// The × button carries no per-call wiring: clicking it empties the field and
// dispatches an `input` event, so the field's own handler reacts as if the
// user erased the text by hand.
function buildScoreRangeInputHTML(inputId, value, viewName) {
  const input = `<input type="text" id="${inputId}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(value)}" oninput="${viewName}.onScoreRange(this.value)">`;
  return `<label class="score-range-label" title="50, 50-59, or 50+ (Alt-C)">Score ${buildClearableInputHTML(input, !!value)}</label>`;
}

// ─── Router ───────────────────────────────────────────────────────────────────
// Keeps the URL in sync with the tool stack via history.replaceState. URL shape:
//   bare URL    → no query state
//   ?<query>    → the pipeline encoded in the query string
// The bare-URL form is used when there's no query, so the most-shared case stays
// short.
//
// Query encoding: each pipeline row in order — its tool name carries the
// first param's value (`tool=value`), and each successive param is its own
// adjacent key (a bare key for a true checkbox, `key=value` for a non-empty
// text param, omitted at default). The permanent Search bar is the final
// row. See docs/design.md § URL state. The score filter is intentionally
// *not* in the URL — it's per-user (scores aren't portable across wordlist
// setups) and lives in localStorage.
const Router = (() => {
  // One tool row → its URL key(s). The first param rides on the tool-name
  // key so the row always has an anchor (kept even when empty, so an
  // unfilled row survives reload); a param-less tool is a bare tool key.
  function encodeRow(row) {
    if (row.grouped) return [encodeURIComponent(row.tool), 'all'];
    const { params: schema } = row.def;
    const slug = encodeURIComponent(row.tool);
    if (!schema.length) return [slug];
    const parts = [slug + '=' + encodeURIComponent(row.params[schema[0].key] || '')];
    for (const p of schema.slice(1)) {
      const v = row.params[p.key];
      if (p.type === 'checkbox') { if (v) parts.push(encodeURIComponent(p.key)); }
      else if (v)                parts.push(encodeURIComponent(p.key) + '=' + encodeURIComponent(v));
    }
    return parts;
  }

  function rowIsDefault(row) {
    return row.def.params.every(p => !row.params[p.key]);
  }

  function buildQuery() {
    // The full pipeline — user tools plus the permanent Search bar as its
    // last row. Each row serializes via encodeRow; empty values are kept
    // (`anagram=`) so an added-but-unfilled row survives reload. The lone
    // exception is the Search bar: its keys are elided when it's at default
    // state *and* not preceded by another Search row, so an untouched app
    // stays at a bare URL while an added Search tool still round-trips.
    const stack = ToolStack.getStack();
    const parts = [];
    stack.forEach((row, i) => {
      const isBar = i === stack.length - 1;
      if (isBar && rowIsDefault(row) && stack[i - 1]?.tool !== 'search') return;
      parts.push(...encodeRow(row));
    });
    const tier = chainSortTier(stack);
    const defaultAxis = DEFAULT_SORT_BY_TIER[tier];
    if (AppView.sortKey !== defaultAxis)                  parts.push('sort=' + AppView.sortKey);
    if (AppView.sortDir !== 'asc') parts.push('sort-dir=' + AppView.sortDir);
    return parts.join('&');
  }

  function buildSearch() {
    const query = buildQuery();
    return query ? '?' + query : '';
  }

  function navigate() {
    const target = location.pathname + buildSearch();
    if (location.pathname + location.search !== target) {
      history.replaceState(null, '', target);
    }
  }

  // Applies URL state (tool stack, search) as a side effect. The score filter
  // is loaded from localStorage in init() and doesn't participate in URL routing.
  function applyURL() {
    const params = new URLSearchParams(location.search);
    const rows = [];
    let sortKey = null;
    let sortDir = null;
    let droppedUnknown = false;
    // All param names across the catalog — lets the decoder tell a genuinely
    // unknown key (likely a removed tool) from a merely misplaced param.
    const knownParam = new Set(Object.values(TOOLS).flatMap(t => t.params.map(p => p.key)));
    // Each key is one of three things: a tool name (starts a new row, its
    // value is the first param), a reserved view-config key, or a successive
    // param of the most recent row (a bare key sets a checkbox true).
    for (const [key, value] of params) {
      if (key === 'sort')     { if (isValidSortAxis(value)) sortKey = value; continue; }
      if (key === 'sort-dir') { if (value === 'asc' || value === 'desc') sortDir = value; continue; }
      if (key === 'all') {
        const cur = rows[rows.length - 1];
        if (cur && cur.def.group) {
          if (rows.some(r => r.grouped)) {
            rows.pop();
          } else {
            cur.grouped = true;
            cur.params = {};
          }
        }
        continue;
      }
      const tool = TOOLS[key];
      if (tool) {
        const row = makeToolRow(key);
        if (tool.params.length) row.params[tool.params[0].key] = value || '';
        rows.push(row);
        continue;
      }
      const cur = rows[rows.length - 1];
      const pdef = cur && cur.def.params.find(p => p.key === key);
      if (pdef) { cur.params[key] = pdef.type === 'checkbox' ? true : (value || ''); continue; }
      // A key that's not a tool, not reserved, and not any tool's param name
      // is a genuinely unknown key — most likely a tool that's been removed.
      if (!knownParam.has(key)) droppedUnknown = true;
    }
    // The decoded rows are the full pipeline; ToolStack keeps the trailing
    // Search row as the permanent bar (appending an empty one if absent).
    // Stack is set first so applyURLState can derive the current atom count
    // when picking the sort default (a stacked-output URL with no explicit
    // sort= should pick min-score, not the 1-atom default entry).
    ToolStack.setStack(rows);
    AppView.applyURLState({ sortKey, sortDir });
    if (droppedUnknown) {
      // Defer: showToast appends to the toast container which may not be in
      // the DOM yet during initial load.
      setTimeout(() => showToast("That link references a tool that's no longer available."), 0);
    }
  }

  return { navigate, applyURL };
})();

// ─── Dark mode ────────────────────────────────────────────────────────────────

const DARK_MODE_CYCLE = ['auto', 'light', 'dark'];
const DARK_MODE_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

function applyDarkMode(val) {
  const dark = val === 'dark' || (val !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark-mode', dark);
  document.documentElement.classList.toggle('light-mode', !dark);
}

function cycleDarkMode() {
  const current = lsLoad('darkMode') || 'auto';
  const next = DARK_MODE_CYCLE[(DARK_MODE_CYCLE.indexOf(current) + 1) % DARK_MODE_CYCLE.length];
  lsSave('darkMode', next);
  applyDarkMode(next);
  const seg = document.getElementById('dark-mode-seg');
  if (seg) seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === next));
  showToast(`Dark mode: ${DARK_MODE_LABELS[next]}`);
}

// ─── Settings dialog ──────────────────────────────────────────────────────────

const SettingsDialog = (() => {
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
        <button id="btn-reset" class="danger" title="Reset browser data"><svg class="icon-trash"><use href="#icon-trash"/></svg> Reset</button>
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
    ], getAutoUpdate() ? 'on' : 'off');
    autoSeg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = () => {
        autoSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        lsSave('autoUpdate', btn.dataset.val);
        if (btn.dataset.val === 'on') checkForUpdates();
      };
    });

    ofCtrls  = el.querySelector('#output-format-ctrls');
    resetSub = el.querySelector('#reset-row-sub');

    el.querySelector('#btn-reset').onclick = async () => {
      if (!await showConfirm('Reset all wordlists and settings? This cannot be undone.', { confirmText: 'Reset' })) return;
      await resetAllDataAndReload();
    };
  }

  let ofRegenTimer = null;
  function flushRegen() {
    if (!ofRegenTimer) return;
    clearTimeout(ofRegenTimer);
    ofRegenTimer = null;
    regenerateFillOutputs();
  }

  function open() {
    resetSub.textContent = 'Reset all wordlists and settings';
    ofCtrls.innerHTML = buildOutputFormatControlsHTML(getOutputFormat());
    wireOutputFormatControls(ofCtrls, () => {
      setOutputFormat(readOutputFormatControls(ofCtrls));
      if (ofRegenTimer) clearTimeout(ofRegenTimer);
      ofRegenTimer = setTimeout(() => { ofRegenTimer = null; regenerateFillOutputs(); }, OUTPUT_FORMAT_REGEN_DELAY);
    });
    showDialog(el, flushRegen);
  }

  return { mount, open };
})();

// ─── Welcome dialog ───────────────────────────────────────────────────────────

const WelcomeDialog = (() => {
  let el, body;

  function mount() {
    ({ el, body } = createDialog('welcome-dialog', { labelledby: 'welcome-title' }));
    // Without this the All Wordlists count freezes at its open-time snapshot (~0 on a cold boot, before fetches populate the wordlists).
    effect(() => {
      sources$.get();
      cacheVersion$.get();
      if (!el.open) return;
      const count = el.querySelector('.welcome-merge-count');
      if (count) count.textContent = pluralize(buildMergedWordlist().entries.length, 'entry', 'entries');
    });
  }

  function render() {
    const toolsShot = FEATURED_TOOLS
      .map(k => TOOLS[k] ? buildToolCardHTML(k, TOOLS[k], { allButton: false }) : '')
      .join('');

    const featuredToolNames = FEATURED_TOOLS
      .filter(k => TOOLS[k])
      .map(k => TOOLS[k].name)
      .join(', ');

    const byPop = [...WORDLIST_PUBLISHERS].sort((a, b) => a.popularity - b.popularity);
    const names = byPop.map(p => p.name);
    const nameList = `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;

    const sourceIcons = byPop
      .map(p => buildIconHTML(p.icon, p.name, colorSeed(p)))
      .join('');

    const wordlistShot = `
      <div class="welcome-merge-sources">${sourceIcons}</div>
      <svg class="welcome-merge-arrow" width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M2 2l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="welcome-merge-all">
        <div class="welcome-merge-all-head">
          ${getMergedIcon()}
          <span class="welcome-merge-all-name">${MERGED_NAME}</span>
        </div>
        <span class="welcome-merge-count">${pluralize(buildMergedWordlist().entries.length, 'entry', 'entries')}</span>
      </div>`;

    const storageShot = `
      <ul class="welcome-sync-files">
        <li>📄 <strong>My Edits.txt</strong> <span class="welcome-sync-dir">⇄</span> Grawlix</li>
        <li>Grawlix <span class="welcome-sync-dir">→</span> 📄 <strong>${MERGED_NAME} rescored.txt</strong></li>
        <li>Grawlix <span class="welcome-sync-dir">→</span> 📄 Spread the Word(list).txt</li>
      </ul>`;

    const diskCaveat = Disk.isSupported() ? ''
      : isMobile() ? ' (Desktop only)'
      : ' (Chrome only)';

    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="welcome-title">Welcome to Grawlix</h2>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Hunt for puzzle ideas</h3>
          <p>Comb the beach with ${featuredToolNames}, and a few dozen more tools. Combine them to unlock new wordplay possibilities.</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-tools">${toolsShot}</div></div>
      </section>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Search multiple popular wordlists</h3>
          <p>${nameList} are at your fingertips. Grawlix rescores each onto a common scale.</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-merge">${wordlistShot}</div></div>
      </section>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Sync with your construction software</h3>
          <p>Point Grawlix at a file you already feed to Ingrid, Crossfire, or Crossword Compiler. Your edits flow both ways, automatically.${diskCaveat}</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-storage">${storageShot}</div></div>
      </section>

      <div class="dialog-footer">
        <button type="button" class="primary dialog-cancel-btn" autofocus>Get started</button>
      </div>`;
  }

  function open() {
    render();
    showDialog(el, () => lsSave('welcomeSeen', '1'));
  }

  return { mount, open };
})();

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

// ─── Wordlist actions dispatcher ──────────────────────────────────────────────

function getActionTargetWordlist() {
  return state.selected;
}

const WordlistActions = (() => {
  const ACTIONS = {
    fetch:     () => fetchWordlist(getActionTargetWordlist()),
    import:    () => importToWordlist(getActionTargetWordlist()),
    delete:    async () => { await deleteWordlist(getActionTargetWordlist()); },
    configure: () => ConfigureWordlistDialog.open(getActionTargetWordlist()),
    clear:     () => clearEdits(),
    bakeRescoring: () => bakeRescoring(getActionTargetWordlist()),
    download:  () => {
      const target = getActionTargetWordlist();
      if (target === MERGED_ID) return downloadMergedWordlistFromPanel();
      return downloadSourceWordlist(target);
    },
    downloadOriginal: () => downloadOriginalWordlist(getActionTargetWordlist()),
    openSync:      () => SyncDialog.open(getActionTargetWordlist()),
    syncExisting:  () => { const t = getActionTargetWordlist(); return syncThen(isMirrorList(t) ? attachMirrorSync(t, { existing: true })  : attachEditsSync({ existing: true })); },
    syncNew:       () => { const t = getActionTargetWordlist(); return syncThen(isMirrorList(t) ? attachMirrorSync(t, { existing: false }) : attachEditsSync({ existing: false })); },
    stopSync:      () => syncThen(detachSync(getActionTargetWordlist())),
  };

  async function syncThen(promise) {
    try { return await promise; }
    catch (err) { console.error('sync action failed', err); return false; }
  }

  function action(name) {
    const fn = ACTIONS[name];
    return fn ? fn() : undefined;
  }

  return { action };
})();

function wordlistFromMeta(m, text) {
  const wordlist = wrapWordlist({
    ...(m.type     ? { type: m.type }         : {}),
    dbKey:         m.dbKey || newDbKey(),
    icon:            m.icon || null,
    publisherId:     m.publisherId || null,
    name: m.name, url: m.url || null,
    enabled: !!m.enabled,
    populated: !!(m.populated || text || m.lastUpdated),
    lastUpdated: m.lastUpdated || null,
    fetchedSize: m.fetchedSize || null,
    rescoreRules: (m.rescoreRules || []).map(r => ({ length: '', ...r })),
    dirty: !!m.dirty,
    originalFilename: m.originalFilename || null,
    rawEntries: text ? parseWordlist(text) : [],
    _loading: false,
  });
  compileRescoreRules(wordlist);
  return wordlist;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Resolves when init() fully completes. The test bridge awaits this before
// driving the UI: `_db` (set early in openDB) goes non-null long before
// applyURL/renderAll, so a test gated on it alone races init's tail, which
// resets the tool stack and re-runs the first render over the test's own.
let _signalReady;
const _ready = new Promise(r => { _signalReady = r; });

async function init() {
  const storedSchema = Storage.schemaVersion();
  const hasOldData   = Storage.hasData();
  if (hasOldData && storedSchema !== SCHEMA_VERSION) {
    if (!(canMigrate(storedSchema) && migrateLocalStorage(storedSchema))) {
      const reset = await showConfirm(
        `Grawlix's data format has changed since your last visit. The site may not work correctly until reset.`,
        { confirmText: 'Reset', cancelText: 'I\'ll take my chances' }
      );
      if (reset) {
        await resetAllDataAndReload();
      }
    }
  } else if (!hasOldData) {
    Storage.setSchemaVersion(SCHEMA_VERSION);
  }

  await openDB();

  // Commit the splash fade to the compositor before the synchronous parse
  // below blocks the main thread, else the logo reveal stalls mid-fade.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const meta = Storage.readMeta();
  if (meta) {
    try {
      state.sources = await Promise.all(meta.map(async m => {
        const m2 = { ...m, dbKey: m.dbKey || newDbKey() };
        const text = await Storage.readWordlist(m2) ?? await idbGet('data_' + m.id);
        return wordlistFromMeta(m2, text);
      }));
    } catch { state.sources = defaultSources(); }
  } else {
    state.sources = defaultSources();
    persistMeta();
  }

  // Scope must land before the score ranges (the active range is keyed off the
  // restored scope) and before the first render (the selector + panel read
  // state.selected). Scope is localStorage-only, never the URL, so it's
  // independent of Router.applyURL below.
  restoreSelectedScope();
  AppView.restoreScoreRanges(restoreScoreRanges());

  Router.applyURL();

  ensureScoring();
  ensureEdits();
  propagateDefaults();
  AppView.show();
  Router.navigate();
  renderAll();
  await _firstPaint;

  await loadSyncTargets();
  const { granted, prompt } = await partitionSyncPermissions();
  const _overlay = document.getElementById('splash-screen');
  if (prompt.length) {
    ReconnectSplash.show(prompt);
  } else if (_overlay) {
    _overlay.classList.add('done');
    _overlay.addEventListener('transitionend', () => _overlay.remove(), { once: true });
  }
  Promise.all(granted.map(activateSyncTarget)).catch(err => console.error('sync resume failed', err));

  bindEvents();
  if (!lsLoad('welcomeSeen')) WelcomeDialog.open();
  checkForUpdates();
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);

  state.sources
    .filter(l => l.url && !l.populated)
    .forEach(l => fetchWordlist(l, null, { silent: true }));

  loadUnigramCorpus().catch(() => { /* surfaced when the tool is used */ });
  _signalReady();
}

function defaultSources() {
  return WORDLIST_PUBLISHERS.map(t => {
    const wordlist = wrapWordlist({
      dbKey: newDbKey(),
      icon: t.icon ? { ...t.icon } : null,
      publisherId: t.id,
      name: t.name,
      url: t.url || null,
      enabled: false,
      populated: false,
      rawEntries: [],
      lastUpdated: null,
      _loading: false,
      rescoreRules: t.defaultRules ? JSON.parse(JSON.stringify(t.defaultRules)) : [],
    });
    compileRescoreRules(wordlist);
    return wordlist;
  });
}

// A stored dbKey scopes to that source even when disabled — disabled sources
// stay viewable when scoped to, so don't add an enabled guard here.
function restoreSelectedScope() {
  const stored = lsLoad('selectedScope');
  if (!stored || stored === MERGED_ID) return;
  const source = state.sources.find(w => w.dbKey === stored);
  if (source) state.selected = source;
}

function restoreScoreRanges() {
  let parsed;
  try { parsed = JSON.parse(lsLoad('scoreRanges') || '{}'); }
  catch { return {}; }
  if (!parsed || typeof parsed !== 'object') return {};
  const out = {};
  for (const [key, range] of Object.entries(parsed)) {
    if (typeof range === 'string' && parseRange(range.trim()) !== null) out[key] = range.trim();
  }
  return out;
}

// ─── My Edits helpers ─────────────────────────────────────────────────────────

function ensureEdits() {
  const edits = getEditsWordlist();
  if (edits) {
    if (!edits.icon) edits.icon = EDITS_ICON;
  } else {
    const newEdits = wrapWordlist({
      type: 'edits',
      dbKey: newDbKey(),
      icon: EDITS_ICON,
      name: 'My Edits',
      url: null,
      enabled: true,
      populated: true,
      rawEntries: [],
      lastUpdated: null,
      _loading: false,
      rescoreRules: editsLegend(),
    });
    compileRescoreRules(newEdits);
    state.sources.unshift(newEdits);
    sources$.bump();
    persistMeta();
  }
}

// Load tier labels from storage, or seed defaults on first boot.
function ensureScoring() {
  const stored = Storage.readScoring();
  if (stored && Array.isArray(stored.scoring)) {
    state.scoring = stored.scoring;
    state.scoringDirty = stored.dirty;
    return;
  }
  state.scoring = DEFAULT_SCORING.map(r => ({ ...r }));
  state.scoringDirty = false;
  persistScoring();
}

let _regenInFlight = false, _regenAgain = false;
// My Edits is excluded — its file is always written as-is, never output-format-
// stripped; including it here would silently destroy the user's rich entries.
async function regenerateFillOutputs() {
  // A format change landing mid-rewrite re-runs once at the end; without it the
  // files would sit stale at the pre-change format until the next edit.
  if (_regenInFlight) { _regenAgain = true; return; }
  _regenInFlight = true;
  try {
    do {
      _regenAgain = false;
      for (const wl of state.sources) {
        if (wl.type !== 'edits' && syncTargets.has(wl.dbKey)) await MirrorSync._flush(wl.dbKey);
      }
      if (syncTargets.has(MERGED_ID)) await MirrorSync._flush(MERGED_ID);
    } while (_regenAgain);
  } finally { _regenInFlight = false; }
}

async function persistEdits(edits) {
  await Storage.writeWordlist(edits, serializeEntries(sortedEntries(edits.rawEntries)));
  persistMeta();
  EditsSync.scheduleWrite();
}

// Gated to user-owned, non-fetched lists: a fetch URL would re-pull the
// original-scale data and clobber the bake, and a publisher's defaultRules are a
// live transform, so resetting a baked publisher list to them would re-rescore
// the already-baked scores.
function canBakeRescoring(wordlist) {
  return !wordlist.publisherId && !wordlist.url && bakingWouldChangeScores(wordlist);
}

function bakingWouldChangeScores(wordlist) {
  return getRescoredEntries(wordlist).some((e, i) => e.score !== wordlist.rawEntries[i].score);
}

function bakeMenuOpts(wordlist) {
  if (canBakeRescoring(wordlist)) return {};
  const reason = (wordlist.publisherId || wordlist.url)
    ? 'Only available for My Edits and imported lists'
    : 'No rescoring to apply';
  return { disabled: true, title: reason };
}

// Reset like a fresh import. The dirty = false is load-bearing: reconcile
// early-returns on a dirty list, so without it a prior translation setup would
// survive the bake and silently re-impose the dual scale baking just resolved.
function resetRescoreRulesAfterBake(wordlist) {
  if (wordlist.type === 'edits') {
    wordlist.rescoreRules = editsLegend();
    wordlist.dirty = false;
    reconcileEditsRulesAfterImport(wordlist);
  } else {
    wordlist.rescoreRules = [];
    maybeAutoSeedRescoreRules(wordlist);
  }
}

async function bakeRescoring(wordlist) {
  if (!canBakeRescoring(wordlist)) return;
  const html = `Permanently rescore ${buildWordlistNameHTML(wordlist)}? This will rewrite every entry's score using the current rules, then reset the rules. The original scores will be lost — use <strong>Download original</strong> first if you want a backup.`;
  if (!await showConfirm('', { confirmText: 'Rescore', html })) return;

  const baked = getRescoredEntries(wordlist).map(e => ({ ...e }));
  batchUpdate(() => {
    invalidateWordlistCaches(wordlist);
    wordlist.rawEntries = baked;
    resetRescoreRulesAfterBake(wordlist);
    compileRescoreRules(wordlist);
    repaintAfterCacheChange();
  });

  if (wordlist.type === 'edits') {
    await persistEdits(wordlist);
  } else {
    await Storage.writeWordlist(wordlist, serializeEntries(wordlist.rawEntries));
    persistMeta();
    MirrorSync.schedule(wordlist);
  }
}

async function clearEdits() {
  const edits = getEditsWordlist();
  if (!edits.rawEntries.length) return;
  if (!await showConfirm(`Clear all ${pluralize(edits.rawEntries.length, 'entry', 'entries')} from "${esc(edits.name)}"?`, { confirmText: 'Clear' })) return;
  batchUpdate(() => {
    edits.rawEntries = [];
    invalidateWordlistCaches(edits);
    compileRescoreRules(edits);
    repaintAfterCacheChange();
  });
  await persistEdits(edits);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

let entriesScroller = null;

// The render dispatcher is two effects:
//   - render effect — reads `cacheVersion$`, dispatches the panel render
//     (full render on first run, in-place scroller update on subsequent
//     cache bumps). The panel always shows the merged view, so there's no
//     selection to dispatch on.
//   - cosmetic effect — subscribes to per-wordlist `name$`/`icon$`/`url$`/
//     `publisherId$` signals across all sources; cosmetic field changes
//     re-render the list/dropdown/dialog and visible scroller rows without
//     touching the merged cache
// Helpers that want to repaint after a cache change bump `cacheVersion$` via
// `repaintAfterCacheChange`. Cosmetic field setters just write the signal —
// the cosmetic effect notices and repaints.
//
// `renderAll()` is the entry point: first call wires up the effects (the
// render effect's first run does the initial paint); subsequent calls bump
// `cacheVersion$` and let the effect dispatch.
let _renderEffectActive = false;
let _firstRenderDone = false;
let _cosmeticEffectFirstRun = true;

let _signalFirstPaint;
const _firstPaint = new Promise(r => { _signalFirstPaint = r; });

function setupRenderEffect() {
  if (_renderEffectActive) return;
  _renderEffectActive = true;
  effect(() => {
    cacheVersion$.get();             // subscribe to cache-change bumps

    if (!_firstRenderDone) {
      _firstRenderDone = true;
      renderSources();
      WordlistSelector.refresh();
      DiscoveryBanner.refresh();
      renderMergedDetail();
      return;
    }

    // Cache change — refresh derived state in place rather than rebuilding
    // the panel and the scroller.
    refreshSourceCounts();        // rebuild caches before any UI reads them
    renderSources();              // list/dialog with fresh meta
    WordlistSelector.refresh();   // add/remove/reorder/enable changes the list
    DiscoveryBanner.refresh();    // import can populate the scoped XWI source
    refreshDerivedDisplays();     // scoring legend + main-panel stats bar
    if (entriesScroller) refreshMergedScroller();
  });

  // Cosmetic effect: re-renders the wordlist list and the merged scroller's
  // per-row source column when any wordlist's name/icon/url/publisher
  // changes. Cache-affecting fields (enabled, rescoreRules) route through
  // `cacheVersion$` instead since changing them invalidates derived state.
  effect(() => {
    const sources = sources$.get();
    for (const wl of sources) {
      wl.name$.get();
      wl.icon$.get();
      wl.url$.get();
      wl.publisherId$.get();
    }
    if (_cosmeticEffectFirstRun) {
      _cosmeticEffectFirstRun = false;
      return;            // render effect's first run already painted everything
    }
    renderSources();
    WordlistSelector.refresh();   // a renamed/re-iconed source restyles the rows
    if (entriesScroller) entriesScroller._render();
  });
}

function renderAll() {
  if (!_renderEffectActive) setupRenderEffect();
  else bumpCacheVersion();
}

// Warms the source-count cache for "X used" meta so cosmetic-effect callers
// don't crash if a cache-affecting helper invalidated the merged cache earlier
// in the same drain. The render effect's cache branch has already rebuilt by the
// time it calls renderSources, so the lazy path is only hit when no cache
// rebuild is in flight.
function renderSources() {
  getSourceCounts();
}


// Pure cache rebuild — invalidate merged/override/stats caches and re-warm the
// source counts so the next renderSources sees fresh meta. Does no rendering
// itself; the render effect's cache branch calls this and then `renderSources`
// to paint with the rebuilt counts.
function refreshSourceCounts() {
  invalidateSourceCounts();
  invalidateStatsCache(_mergedStatsKey);
  getSourceCounts();
}

function createScroller() {
  AtomPopover.close();
  GroupMorePopover.close();
  entriesScroller?.destroy();
  entriesScroller = new EntriesScroller(document.getElementById('vs-host'));
  return entriesScroller;
}

async function refreshMergedScroller() {
  reconcileSort(ToolStack.getStack());
  if (!entriesScroller) return;
  const result = await runPipeline(getActiveCorpus(), ToolStack.getStack());
  if (result.aborted || !entriesScroller) return;
  entriesScroller.updateEntries(result.rows, result.atomCount, chainSortTier(ToolStack.getStack()));
  ToolStack.refreshErrorMarks();
}

// The pre-search and histogram caches assume one corpus, so a scope change
// must drop both before the pipeline re-runs — otherwise the prior scope's
// memoized seed rows leak into the new view with no error.
async function setScope(target) {
  if (state.selected === target) return;
  state.selected = target;
  lsSave('selectedScope', scopeKey(target));
  invalidatePreSearchCache();
  invalidateHistogramLayout();
  WordlistSelector.refresh();
  DiscoveryBanner.refresh();
  await renderMergedDetail();
}

function mountPanel(panel) {
  panel.innerHTML = `
    <div class="sticky-stack">
      ${ToolStack.buildHTML()}
      <div id="stats">${buildStatsBarHTML()}</div>
      ${buildEntryHeadersHTML()}
    </div>
    ${buildEntriesTablePanelHTML()}
  `;
  ToolStack.refreshGalleryActive();
  repositionAllHistogramRects();
  createScroller();
  entriesScroller.onFilterChange = refreshStatsBarFromScroller;
  attachHelpPopups();
  publishBarHeights();
  const stickyStack = panel.querySelector('.sticky-stack');
  _stickyObserver.disconnect();
  _stickyObserver.observe(stickyStack);
  const wordlistBar = document.getElementById('wordlist-bar');
  if (wordlistBar) _stickyObserver.observe(wordlistBar);
  // Delegate rather than bind the header cells directly: rebuildEntryHeaders
  // replaces them via outerHTML on every sort change, which would orphan a
  // direct listener after the first sort.
  stickyStack.addEventListener('click', onSortHeaderActivate);
  stickyStack.addEventListener('keydown', onSortHeaderActivate);
  document.getElementById('entries-table-panel').addEventListener('animationstart', e => {
    if (e.animationName === 'pipeline-room') _signalFirstPaint();
  });
}

// histEntries stays the pre-score-range set (not the filtered statsEntries) so the
// histogram keeps out-of-range bars — clickable to widen the filter — while the readouts shrink.
function buildStatsBarHTML() {
  const scroller = entriesScroller;
  const statsEntries = scroller ? scroller._statsViewEntries() : [];
  const histEntries = scroller ? scroller._histogramEntries() : getActiveCorpus().entries;
  const grouped = scroller ? scroller.sortTier === 'group' : false;
  const groupCount = grouped ? scroller.entries.length : null;
  const countValue = grouped
    ? (scroller ? scroller._visibleGroupChainCount() : 0)
    : (scroller ? scroller.entries.length : statsEntries.length);
  const stats = computeStatsRaw(statsEntries);
  const layout = scopedHistogramLayout();

  const isEmpty = !countValue;
  const dash = '—';
  const fmt = v => isEmpty ? dash : v;
  const counts = bucketCounts(histEntries || [], layout);
  const scale = Math.max(...counts, 1);
  const barH = c => c === 0 ? 0 : Math.max(2, Math.round((c / scale) * 34));

  const bars = layout.slots.map((s, i) => {
    const c = counts[i];
    const title = `${pluralize(c, 'entry', 'entries')} scored ${s.label} • Click to filter`;
    const { bg } = scoreColor((s.lo + s.hi) / 2);
    return `<div class="histogram-col" title="${title}"><div class="histogram-bar" data-lo="${s.lo}" data-hi="${s.hi}" style="--score-bg:${bg}; height:${barH(c)}px"></div></div>`;
  }).join('');

  const countsHTML = groupCount != null
    ? buildStatItemHTML('Entries', countValue.toLocaleString()) +
      buildStatItemHTML('Groups', groupCount.toLocaleString())
    : buildStatItemHTML('Entries', countValue.toLocaleString());

  const rangeHTML = buildScoreRangeInputHTML('score-range-input', AppView.scoreRange, 'AppView');
  const sortSlotHTML = `<span class="stats-bar-sort" id="stats-bar-sort"></span>`;
  const exportHTML = buildExportMenuHTML();
  const exportSlotHTML = exportHTML ? `<span class="stats-bar-export">${exportHTML}</span>` : '';

  return `<div class="stats-bar${isEmpty ? ' stats-empty' : ''}">
      <div class="stats-bar-counts">${countsHTML}</div>
      <div class="stats-bar-distribution">
        <div class="stats-bar-numbers">
          ${buildStatItemHTML('Min', fmt(stats.min), null, 'stat-far')}
          ${buildStatItemHTML('Max', fmt(stats.max), null, 'stat-far')}
        </div>
        <div class="histogram" title="Histogram • Click to filter" onpointerdown="onHistogramPointerDown(event)">${bars}<div class="histogram-rect" hidden></div></div>
      </div>
      <div class="stats-bar-controls">${rangeHTML}${sortSlotHTML}${exportSlotHTML}</div>
    </div>`;
}

function refreshStatsBarFromScroller() {
  if (!entriesScroller) return;
  const bar = document.querySelector('#stats .stats-bar');
  if (!bar) return;
  swapStatsBarReadouts(bar, buildStatsBarHTML());
  repositionAllHistogramRects();
}

function swapStatsBarReadouts(bar, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const next = tmp.querySelector('.stats-bar');
  if (!next) return;
  bar.querySelector('.stats-bar-counts')?.replaceWith(next.querySelector('.stats-bar-counts'));
  bar.querySelector('.stats-bar-distribution')?.replaceWith(next.querySelector('.stats-bar-distribution'));
  bar.className = next.className;
}

function publishBarHeights() {
  const stack = document.getElementById('tool-stack');
  if (stack) document.documentElement.style.setProperty('--tool-stack-h', stack.offsetHeight + 'px');
  const stats = document.getElementById('stats');
  if (stats) document.documentElement.style.setProperty('--stats-bar-h', stats.offsetHeight + 'px');
  const stickyStack = document.querySelector('#app .sticky-stack');
  if (stickyStack) document.documentElement.style.setProperty('--sticky-stack-h', stickyStack.offsetHeight + 'px');
  const bar = document.getElementById('wordlist-bar');
  if (bar) document.documentElement.style.setProperty('--wordlist-bar-h', bar.offsetHeight + 'px');
}
const _stickyObserver = new ResizeObserver(publishBarHeights);

function refreshStatsBarOverflow() {
  for (const bar of document.querySelectorAll('.stats-bar')) {
    bar.classList.remove('stats-narrow', 'stats-no-hist');
    const overlapsControls = () => {
      const ctrls = bar.querySelector('.stats-bar-controls');
      if (!ctrls) return false;
      const ctrlsLeft = ctrls.getBoundingClientRect().left;
      for (const el of bar.querySelectorAll('.stats-bar-counts, .stat-far, .histogram')) {
        if (!el.offsetWidth) continue;
        if (el.getBoundingClientRect().right > ctrlsLeft + 0.5) return true;
      }
      return false;
    };
    if (overlapsControls()) {
      bar.classList.add('stats-narrow');
      if (overlapsControls()) bar.classList.add('stats-no-hist');
    }
  }
}
function mountStatsBarOverflowObservers() {
  const parent = document.getElementById('detail-panel');
  if (!parent) return;
  new ResizeObserver(refreshStatsBarOverflow).observe(parent);
  new MutationObserver(refreshStatsBarOverflow).observe(parent, { childList: true, subtree: true });
}

function mountHeaderHeightObserver() {
  const headerEl = document.querySelector('header');
  const publish = () => document.documentElement.style.setProperty(
    '--header-h', headerEl.offsetHeight + 'px'
  );
  publish();
  new ResizeObserver(publish).observe(headerEl);
}

// Help anchors are rebuilt whenever the panel re-renders (mountPanel,
// rerenderRows), so destroy the prior popups and rebind from a fresh
// document-wide scan for `data-help`.
let _helpPopups = [];
function attachHelpPopups() {
  _helpPopups.forEach(p => p.destroy());
  _helpPopups = [];
  for (const input of document.querySelectorAll('[data-help]')) {
    const content = PARAM_HELP[input.dataset.help];
    if (!content) continue;
    const placement = input.closest('.tool-row-replace') ? 'below' : 'above';
    _helpPopups.push(new PopupHelp(input, content, { placement }));
  }
}

async function renderMergedDetail() {
  try {
    const panel = document.getElementById('detail-panel');
    reconcileSort(ToolStack.getStack());
    mountPanel(panel);
    const showSource = state.selected === MERGED_ID;
    entriesScroller.showSource = showSource;
    panel.classList.toggle('no-source-col', !showSource);
    entriesScroller.editsWordlist = getEditsWordlist() ?? null;
    entriesScroller.showEditDeleteCol = true;
    entriesScroller._onDeleteRow = entry => deleteFromEdits(entry, refreshMergedScroller);
    attachExternalEditHandlers(entriesScroller, refreshMergedScroller);

    const result = await runPipeline(getActiveCorpus(), ToolStack.getStack());
    if (result.aborted) return;
    const { rows, atomCount } = result;
    entriesScroller.setEntries(rows, atomCount, chainSortTier(ToolStack.getStack()));
    ToolStack.refreshErrorMarks();
  } finally {
    // In `finally` so a thrown/aborted pipeline still dismisses the splash
    // screen — otherwise a broken tool in the boot URL strands the user on
    // a forever-spinning overlay with no error in sight.
    _signalFirstPaint();
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function attachExternalEditHandlers(s, refreshFn) {
  s._onSave = (originalWlEntry, newValues) => {
    saveEdit(originalWlEntry, newValues);
    refreshFn?.();
  };
}

function saveEdit(originalWlEntry, { raw, score, comment }) {
  const edits = getEditsWordlist();
  const newNorm = toNorm(raw);
  const newDisplay = raw;
  const origNorm = originalWlEntry.norm;
  const origDisplay = originalWlEntry.display ?? origNorm;
  const origScore = originalWlEntry.score;
  const origComment = originalWlEntry.comment ?? '';

  if (origNorm === newNorm && origDisplay === newDisplay
      && origScore === score && origComment === comment) {
    return;
  }

  const entryChanged = newNorm !== origNorm || newDisplay !== origDisplay;
  const norms = entryChanged && origNorm ? [origNorm, newNorm] : [newNorm];

  applyEditsChange(edits, norms, () => {
    if (entryChanged && origNorm) {
      const idx = edits.rawEntries.findIndex(e => e.norm === origNorm && displayOf(e) === origDisplay);
      if (idx >= 0) edits.rawEntries.splice(idx, 1);
    }
    const existing = edits.rawEntries.find(e => e.norm === newNorm && displayOf(e) === newDisplay);
    if (existing) {
      existing.score = score;
      existing.comment = comment;
    } else {
      edits.rawEntries.push({ norm: newNorm, display: newDisplay, score, comment });
    }
  });
  persistEdits(edits);
}

// ─── Fetch, import & update ───────────────────────────────────────────────────

async function applyWordlistText(wordlist, text, { fetchedSize = null, originalFilename = null, nameOverride = null, source = null, clearUrl = false, silent = false, viaToast = false } = {}) {
  const wasEmpty = !wordlist.rawEntries.length;
  const oldEntries = wasEmpty ? null : wordlist.rawEntries;

  // Invalidate first, then mutate — so signal writes (name/url) don't fire
  // the cosmetic effect against still-stale caches mid-flight. Wrap in
  // batchUpdate to coalesce all writes + the cache bump into one render
  // effect run after the batch.
  batchUpdate(() => {
    invalidateWordlistCaches(wordlist);
    wordlist.rawEntries = parseWordlist(text);
    wordlist.lastUpdated = Date.now();
    if (fetchedSize !== null) { wordlist.fetchedSize = fetchedSize; wordlist._updateAvailable = false; }
    if (originalFilename !== null) wordlist.originalFilename = originalFilename;
    if (!wordlist.populated) { wordlist.populated = true; wordlist.enabled = true; }
    maybeAutoSeedRescoreRules(wordlist);
    if (wordlist.type === 'edits') reconcileEditsRulesAfterImport(wordlist);
    compileRescoreRules(wordlist);
    if (nameOverride) wordlist.name = nameOverride;
    if (clearUrl) { wordlist.url = null; wordlist.fetchedSize = null; wordlist._updateAvailable = false; }
    persistMeta();
    repaintAfterCacheChange();
  });

  await Storage.writeWordlist(wordlist, text);
  if (wordlist.type === 'edits') EditsSync.scheduleWrite();
  else                           MirrorSync.schedule(wordlist);
  // The render effect drained inside batchUpdate already updated the wordlist
  // list, dropdown, scoring legend, stats bar, and active scroller for the
  // current selection. Nothing else to repaint here.

  if (wasEmpty) {
    if (!silent) showToast(`Loaded ${pluralize(wordlist.rawEntries.length, 'entry', 'entries')} from ${esc(source)}`);
  } else {
    const oldMap = new Map(oldEntries.map(e => [e.norm, e.score]));
    const newMap = new Map(wordlist.rawEntries.map(e => [e.norm, e.score]));
    const added   = wordlist.rawEntries.filter(e => !oldMap.has(e.norm)).sort((a, b) => a.norm.localeCompare(b.norm));
    const deleted = oldEntries.filter(e => !newMap.has(e.norm)).sort((a, b) => a.norm.localeCompare(b.norm));
    const rescored = oldEntries
      .filter(e => newMap.has(e.norm) && newMap.get(e.norm) !== e.score)
      .map(e => ({ entry: e, oldScore: e.score, score: newMap.get(e.norm) }))
      .sort((a, b) => a.entry.norm.localeCompare(b.entry.norm));
    if (!added.length && !deleted.length && !rescored.length) {
      if (!viaToast) showAlert(`${buildWordlistNameHTML(wordlist)} is already up to date — no changes.`);
    } else if (viaToast) {
      const parts = [];
      if (added.length)    parts.push(`${added.length.toLocaleString()} added`);
      if (deleted.length)  parts.push(`${deleted.length.toLocaleString()} deleted`);
      if (rescored.length) parts.push(`${rescored.length.toLocaleString()} rescored`);
      showActionToast(
        `${esc(wordlist.name)} auto-updated: ${parts.join(', ')}`,
        'Details',
        () => openUpdateSummaryDialog(wordlist, oldEntries.length, added, deleted, rescored),
      );
    } else {
      openUpdateSummaryDialog(wordlist, oldEntries.length, added, deleted, rescored);
    }
  }
}

async function fetchWordlist(wordlist, event, { silent = false, viaToast = false } = {}) {
  if (event) event.stopPropagation();
  if (!wordlist || !wordlist.url || wordlist._loading) return;

  wordlist._loading = true;
  renderSources();

  try {
    const resp = await fetch(wordlist.url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const text = await resp.text();
    const fetchedSize = resp.headers.get('content-length') || null;
    const originalFilename = new URL(wordlist.url).pathname.split('/').pop() || null;
    wordlist._loading = false;
    await applyWordlistText(wordlist, text, { fetchedSize, originalFilename, source: wordlist.url, silent, viaToast });
  } catch (err) {
    wordlist._loading = false;
    renderSources();
    const detail = err.message === 'Failed to fetch' ? '' : `: ${err.message}`;
    showToast(`Failed to fetch ${esc(wordlist.url)}${esc(detail)}`);
  }
}

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

function getAutoUpdate() { return lsLoad('autoUpdate') !== 'off'; }

async function checkForUpdates() {
  const candidates = state.sources.filter(l => l.url && l.rawEntries.length > 0 && l.fetchedSize);
  if (!candidates.length) return;

  const autoUpdate = getAutoUpdate();
  let anyChanged = false;
  await Promise.all(candidates.map(async wordlist => {
    try {
      const resp = await fetch(wordlist.url, { method: 'HEAD' });
      if (!resp.ok) return;
      const size = resp.headers.get('content-length');
      if (!size || size === wordlist.fetchedSize) return;
      if (autoUpdate) {
        await fetchWordlist(wordlist, null, { silent: true, viaToast: true });
      } else if (!wordlist._updateAvailable) {
        wordlist._updateAvailable = true;
        anyChanged = true;
      }
    } catch { /* offline or network error — silently ignore */ }
  }));

  if (anyChanged) {
    renderSources();
    WordlistSelector.refresh();
  }

  const fetchedSize = getUnigramFetchedSize();
  if (fetchedSize) {
    try {
      const resp = await fetch(UNIGRAM_CORPUS_URL, { method: 'HEAD' });
      const size = resp.ok ? resp.headers.get('content-length') : null;
      if (size && size !== fetchedSize) {
        invalidateUnigramCorpus();
        await idbPut(UNIGRAM_CORPUS_IDB_KEY, '');
        await loadUnigramCorpus();
      }
    } catch { /* offline or network error — silently ignore */ }
  }
}

function triggerImportForWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  if (!wordlist) return;
  if (wordlist.url) fetchWordlist(wordlist, event);
  else importToWordlist(wordlist);
}

function importToWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  ImportGuideDialog.open(wordlist);
}

function ingestFile(file, wordlist, nameOverride) {
  const reader = new FileReader();
  reader.onerror = () => showToast('Error reading file');
  reader.onabort = () => showToast('File read cancelled');
  reader.onload = async e => {
    const text = e.target.result;
    if (!wordlist) return;

    const entries = parseWordlist(text);
    if (!entries.length && text.trim()) {
      showToast('No valid wordlist entries found — check the file format');
      return;
    }

    // My Edits: always combine instead of replace
    if (wordlist.type === 'edits' && wordlist.rawEntries.length > 0) {
      const existingMap = new Map(wordlist.rawEntries.map(e => [mergeKey(e.norm, e.display), e]));
      const newEntries = [], conflicts = [];
      let unchanged = 0;

      for (const wlEntry of entries) {
        const existing = existingMap.get(mergeKey(wlEntry.norm, wlEntry.display));
        if (!existing) {
          newEntries.push(wlEntry);
        } else if (existing.score !== wlEntry.score || existing.comment !== wlEntry.comment) {
          conflicts.push({ existing, incoming: wlEntry });
        } else {
          unchanged++;
        }
      }

      let conflictResolution = null;
      if (conflicts.length > 0) {
        conflictResolution = await showMergeConflict(conflicts.length);
        if (conflictResolution === null) return; // cancelled

        if (conflictResolution === 'file') {
          for (const { existing, incoming } of conflicts) {
            existing.score   = incoming.score;
            existing.comment = incoming.comment;
          }
        }
      }

      wordlist.rawEntries.push(...newEntries);
      wordlist.lastUpdated = Date.now();
      reconcileEditsRulesAfterImport(wordlist);
      invalidateWordlistCaches(wordlist);
      compileRescoreRules(wordlist);

      await Storage.writeWordlist(wordlist, serializeEntries(wordlist.rawEntries));
      persistMeta();

      renderSources();
      renderMergedDetail();

      const parts = [];
      if (newEntries.length) parts.push(`${newEntries.length.toLocaleString()} new`);
      if (conflicts.length) parts.push(`${conflicts.length.toLocaleString()} ${conflictResolution === 'file' ? 'updated from file' : 'conflicts kept'}`);
      if (unchanged)        parts.push(`${unchanged.toLocaleString()} unchanged`);
      showToast(parts.length ? `Merged — ${parts.join(', ')}` : 'File already merged — no changes');
      return;
    }

    await applyWordlistText(wordlist, text, { originalFilename: file.name, nameOverride, source: file.name });
  };
  reader.readAsText(file);
}


// ─── My Edits: add entry & delete ────────────────────────────────────────────

function newEntrySeedQuery() {
  const q = AppView.searchQuery.trim();
  if (!isLiteralQuery(q) || getActiveCorpus().byNorm.has(toNorm(q))) return '';
  return q;
}

const NO_MATCH_QUIPS = [
  q => `"The ${q} is in another castle."`,
  q => `"This is not the ${q} you are looking for."`,
  q => `"${q} has left the chat."`,
  q => `"${q}? We're gonna need a bigger wordlist."`,
  q => `"We don't talk about ${q}."`,
  q => `"${q} has left the building."`,
  q => `"Nobody puts ${q} in the corner."`,
  q => `"${q}? Where we're going, we don't need ${q}."`,
  q => `"${q}? Inconceivable!"`,
  q => `"Hasta la vista, ${q}."`,
  q => `"Sorry, ${q} can't come to the phone right now."`,
  q => `"Show me the ${q}!"`,
  q => `"${q}? You can't handle the ${q}!"`,
];

function buildNoMatchQuipHTML(term) {
  const span = `<span class="entries-empty-term">${esc(term)}</span>`;
  return NO_MATCH_QUIPS[hashStringMod(term.toLowerCase(), NO_MATCH_QUIPS.length)](span);
}

function deleteFromEdits(target, refreshFn) {
  const edits = getEditsWordlist();
  const norm = target.norm;
  const display = target.display;
  const idx = edits.rawEntries.findIndex(e => e.norm === norm && displayOf(e) === display);
  if (idx === -1) return;

  const refresh = refreshFn ?? (() => {
    entriesScroller._invalidateSortCache();
    entriesScroller._sortAndRender();
  });

  let deleted;
  applyEditsChange(edits, [norm], () => { [deleted] = edits.rawEntries.splice(idx, 1); });
  persistEdits(edits);
  refresh();

  showUndoToast(`Deleted ${esc(displayOf(deleted))} from ${buildWordlistNameHTML(edits)}`, () => {
    applyEditsChange(edits, [norm], () => { edits.rawEntries.splice(idx, 0, deleted); });
    persistEdits(edits);
    refresh();
  });
}

async function deleteWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  if (!wordlist) return;
  if (!await showConfirm('', { confirmText: 'Delete', html: `Delete ${buildWordlistNameHTML(wordlist)}?` })) return;
  // Invalidate first so any reactive subscribers re-rendering on the
  // `state.sources` change below don't read a stale merged cache.
  invalidateWordlistCaches(wordlist);
  state.sources = state.sources.filter(l => l !== wordlist);
  await detachSync(wordlist);
  await Storage.deleteWordlist(wordlist);
  persistMeta();
  renderAll();
}

function toggleWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  if (!wordlist || !wordlist.populated) return;
  setWordlistEnabled(wordlist, !wordlist.enabled);
}

function addNewWordlist(wordlistDef) {
  const wordlist = wrapWordlist({ rescoreRules: [], ...wordlistDef, rawEntries: [], lastUpdated: null, _loading: false });
  compileRescoreRules(wordlist);
  state.sources.push(wordlist);
  invalidateSourceCounts();
  invalidateStatsCache(_mergedStatsKey);
  persistMeta();
  sources$.bump();              // notify cosmetic effect with fresh caches
  return wordlist;
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

// ─── Event wiring ─────────────────────────────────────────────────────────────

function bindEvents() {
  // Header chrome
  document.querySelector('.header-logo-link').href = location.pathname;
  document.getElementById('btn-settings').onclick = () => SettingsDialog.open();
  document.getElementById('btn-help').onclick     = () => WelcomeDialog.open();
  document.getElementById('add-fab').onclick = () =>
    AtomPopover.openForCreate(newEntrySeedQuery(), entriesScroller, null);

  ToolStack.init();

  document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    let handled = true;
    switch (e.code) {
      case 'KeyM': cycleDarkMode();          break;
      case 'KeyS': focusPermanentSearch();   break;
      case 'KeyW': toggleWholeWord();        break;
      case 'KeyC': focusScoreRange();        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });
}

function focusPermanentSearch() {
  const input = document.querySelector('#app input[data-row="bar"][data-key="pattern"]');
  if (input) { input.focus(); input.select(); }
}

function focusScoreRange() {
  const input = document.getElementById('score-range-input');
  if (input) { input.focus(); input.select(); }
}

function toggleWholeWord() {
  const row = document.activeElement?.closest('.tool-row, .search-bar');
  let cb = row?.querySelector('input[type="checkbox"][data-key="whole-word"]');
  if (!cb) cb = document.querySelector('#app input[data-row="bar"][data-key="whole-word"]');
  if (!cb) return;
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('input', { bubbles: true }));
  cb.dispatchEvent(new Event('change', { bubbles: true }));
}

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


// ─── Rename ───────────────────────────────────────────────────────────────────

function startInlineRename(inputEl, originalName, { onCommit, onCancel, onInput }) {
  let done = false;
  function commit() {
    if (done) return;
    done = true;
    onCommit(inputEl.value.trim() || originalName);
  }
  function cancel() {
    if (done) return;
    done = true;
    onCancel();
  }
  if (onInput) inputEl.oninput = () => onInput(inputEl.value || originalName);
  inputEl.onblur = commit;
  inputEl.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { inputEl.onblur = null; cancel(); }
  };
}

// ─── Merge & Download ─────────────────────────────────────────────────────────


// `norms` must list every norm the mutation touches — an entry-text edit moves
// an entry between two norms, and any omitted norm keeps a stale merged bucket
// with no error.
function applyEditsChange(edits, norms, mutate) {
  const snap = snapshotMergedBuckets(norms);
  mutate();
  invalidateRescoredCache(edits);
  invalidateStatsCache(edits);
  invalidateStatsCache(_mergedStatsKey);
  invalidatePreSearchCache();
  patchMergedForNorms(snap);
  // When scoped to My Edits itself, its own view must rebuild to reflect the edit
  // (other scoped sources show only their own data, so they're unaffected).
  if (state.selected !== MERGED_ID) dropScopedCorpus(state.selected);
  refreshDerivedDisplays();
}

// The detail panel's stats bar is deliberately not repainted here — every
// caller also runs a scroller filter pass, and its onFilterChange callback
// repaints the bar.
function refreshDerivedDisplays() {
  WordlistSelector.refreshMeta();
  renderScoringRules();
}

function downloadMergedWordlistFromPanel() {
  const { entries } = buildMergedWordlist();
  triggerDownload(serializeEntries(entries, getOutputFormat()), rescoredFilename(MERGED_ID));
  showToast(`Downloaded ${pluralize(entries.length, 'entry', 'entries')}`);
}

function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadSourceWordlist(wordlist) {
  if (!wordlist || !wordlist.rawEntries.length) return;
  triggerDownload(serializeEntries(getRescoredEntries(wordlist), getOutputFormat()), rescoredFilename(wordlist));
  showToast(`Downloaded ${pluralize(wordlist.rawEntries.length, 'entry', 'entries')}`);
}

async function downloadOriginalWordlist(wordlist) {
  if (!wordlist || !wordlist.rawEntries.length) return;
  // Serve the imported file verbatim from IndexedDB — reconstructing from parsed
  // wlEntries would lose the comment formatting, line endings, and ordering the
  // user's file had, none of which round-trip through serializeEntries.
  const text = await Storage.readWordlist(wordlist);
  if (!text) { showToast('Original file not available'); return; }
  triggerDownload(text, `${sanitizeFilenameStem(wordlist.name)}.txt`);
  showToast(`Downloaded ${pluralize(wordlist.rawEntries.length, 'entry', 'entries')}`);
}

// ─── Export ──────────────────────────────────────────────────────────
// See docs/design.md § Entries-table export.

function buildExportMenuHTML() {
  return buildMoreMenuHTML([
    ['Copy to clipboard',            'exportCopy()'],
    ['Download results as wordlist', 'exportWordlist()'],
    ['Download as CSV',              'exportCSV()'],
    ['Download as JSON',             'exportJSON()'],
  ], { header: 'Export these results' });
}

// #region nodetest:export
function chainContentEntries(chain) {
  const out = [];
  let prevEntry = null;
  for (const atom of chain.atoms) {
    if (atom.wlEntry.norm === prevEntry) continue;
    out.push(atom.wlEntry);
    prevEntry = atom.wlEntry.norm;
  }
  return out;
}
// #endregion nodetest:export

function currentContentAtomCount(stack) {
  let count = 1;
  for (const row of stack) {
    if (row.isInert()) continue;
    if (row.kind() === 'transform') count++;
  }
  return count;
}

// #region nodetest:export
function* iterDisplayChains(rows, grouped) {
  if (grouped) {
    for (const g of rows) for (const chain of g.chains) yield { group: g, chain };
  } else {
    for (const chain of rows) yield { group: null, chain };
  }
}
// #endregion nodetest:export

function countExportEntries(rows, grouped) {
  if (grouped) { let n = 0; for (const g of rows) n += g.chains.length; return n; }
  return rows.length;
}

function exportToolsMetadata(stack) {
  const out = [];
  stack.forEach((row, i) => {
    const isBar = i === stack.length - 1 && row.tool === 'search';
    if (isBar && row.isInert()) return;
    const entry = { name: row.tool };
    const params = {};
    for (const p of row.def.params) {
      const v = row.params[p.key];
      if (p.type === 'checkbox') { if (v) params[p.key] = true; }
      else if (v !== undefined && v !== '') params[p.key] = v;
    }
    if (Object.keys(params).length) entry.params = params;
    if (row.grouped) entry.grouped = true;
    out.push(entry);
  });
  return out;
}

function exportScoreRangeMetadata() {
  const intervals = parseRange(AppView.scoreRange);
  if (!intervals) return null;
  const { min, max } = intervals[0];
  const out = {};
  if (min !== null) out.min = min;
  if (max !== null) out.max = max;
  return Object.keys(out).length ? out : null;
}

function exportSortMetadata() {
  return { by: AppView.sortKey, dir: AppView.sortDir };
}

// #region nodetest:export
function exportFilenameSegment(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[*?#@\[\]/\\:|"<>]/g, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function exportFilename(stack, ext) {
  const parts = ['grawlix'];
  stack.forEach((row, i) => {
    const isBar = i === stack.length - 1 && row.tool === 'search';
    if (isBar && row.isInert()) return;
    parts.push(exportFilenameSegment(row.tool));
    if (row.grouped) parts.push('all');
    const firstParam = row.def.params.find(p => row.params[p.key] && p.type !== 'checkbox');
    if (firstParam) {
      const seg = exportFilenameSegment(String(row.params[firstParam.key]));
      if (seg) parts.push(seg);
    }
  });
  if (parts.length === 1) parts.push('all');
  let name = parts.join('-');
  if (name.length > 100) name = name.slice(0, 100).replace(/-+$/, '');
  return `${name}.${ext}`;
}
// #endregion nodetest:export

// ── Copy ──

function chainCopyText(chain) {
  const parts = [];
  let prevNorm = null;
  for (const atom of chain.atoms) {
    const wlE = atom.wlEntry;
    if (wlE.norm === prevNorm) continue;
    const shown = wlE.display ?? wlE.norm.toUpperCase();
    const piece = `${wlE.norm.length} ${shown}`;
    parts.push(atom.glyph ? `${atom.glyph} ${piece}` : piece);
    prevNorm = wlE.norm;
  }
  return parts.join(' ');
}

// Backtick the params: a wildcard like `*EARNING` would otherwise trigger
// italic-on-rest-of-line in markdown renderers that parse formatting inside
// link text — a silent breakage in Discord/GitHub, invisible in plain text.
function exportCopyHeader(stack) {
  const url = location.href;
  const labels = [];
  stack.forEach((row, i) => {
    const isBar = i === stack.length - 1 && row.tool === 'search';
    if (isBar && row.isInert()) return;
    let label = row.def.name;
    const firstParam = row.def.params.find(p => row.params[p.key] && p.type !== 'checkbox');
    if (firstParam) {
      const v = row.params[firstParam.key];
      label += firstParam.type === 'number' ? ` ${v}` : ' `' + v + '`';
    }
    if (row.grouped) label += ' (all)';
    labels.push(label);
  });
  const desc = labels.length ? labels.join(' → ') : MERGED_NAME;
  return `[${desc}](${url})`;
}

function buildCopyText(rows, grouped, stack) {
  const header = exportCopyHeader(stack);
  const body = [];
  if (grouped) {
    for (const g of rows) body.push(g.chains.map(chainCopyText).join(', '));
  } else {
    body.push(...flatCopyLines(rows));
  }
  return header + (body.length ? '\n' + body.join('\n') : '');
}

// #region nodetest:export
function flatCopyLines(chains) {
  const piecesPerChain = chains.map(chain => {
    const pieces = [];
    let prevNorm = null;
    for (const atom of chain.atoms) {
      const wlE = atom.wlEntry;
      if (wlE.norm === prevNorm) continue;
      const shown = wlE.display ?? wlE.norm.toUpperCase();
      pieces.push({ glyph: atom.glyph || '', len: String(wlE.norm.length), entry: shown });
      prevNorm = wlE.norm;
    }
    return pieces;
  });

  const maxCols = Math.max(0, ...piecesPerChain.map(p => p.length));
  const lenW = new Array(maxCols).fill(0);
  const entryW = new Array(maxCols).fill(0);
  for (const pieces of piecesPerChain) {
    pieces.forEach((p, i) => {
      if (p.len.length > lenW[i]) lenW[i] = p.len.length;
      if (p.entry.length > entryW[i]) entryW[i] = p.entry.length;
    });
  }

  return piecesPerChain.map(pieces => pieces.map((p, i) => {
    const lenStr = p.len.padStart(lenW[i], ' ');
    const entry = i === maxCols - 1 ? p.entry : p.entry.padEnd(entryW[i], ' ');
    const piece = `${lenStr} ${entry}`;
    return p.glyph ? `${p.glyph} ${piece}` : piece;
  }).join(' '));
}
// #endregion nodetest:export

async function exportCopy() {
  if (!entriesScroller) return;
  const grouped = entriesScroller.sortTier === 'group';
  const text = buildCopyText(entriesScroller.entries, grouped, ToolStack.getStack());
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    showToast('Copy failed — clipboard permission denied');
    return;
  }
  const count = countExportEntries(entriesScroller.entries, grouped);
  showToast(`Copied ${pluralize(count, 'entry', 'entries')}`);
}

// ── Wordlist ──

// #region nodetest:export
function buildWordlistText(rows, grouped) {
  const acc = new Map();
  let skipped = 0;
  for (const { chain } of iterDisplayChains(rows, grouped)) {
    const content = chainContentEntries(chain);
    if (!content.length) continue;
    const tail = displayOf(content[content.length - 1]);
    if (tail.includes(';')) { skipped++; continue; }
    let chainMin = Infinity;
    for (const wlE of content) if (wlE.score < chainMin) chainMin = wlE.score;
    const cur = acc.get(tail);
    if (cur === undefined || chainMin > cur) acc.set(tail, chainMin);
  }
  const lines = [...acc.keys()].sort().map(e => `${e};${acc.get(e)}`);
  return { text: lines.length ? lines.join('\n') + '\n' : '', count: lines.length, skipped };
}
// #endregion nodetest:export

async function exportWordlist() {
  if (!entriesScroller) return;
  const grouped = entriesScroller.sortTier === 'group';
  const { text, count, skipped } = buildWordlistText(entriesScroller.entries, grouped);
  triggerDownload(text, exportFilename(ToolStack.getStack(), 'txt'));
  let msg = `Downloaded ${pluralize(count, 'entry', 'entries')}`;
  if (skipped) msg += ` (${pluralize(skipped, 'entry', 'entries')} skipped due to semicolons)`;
  showToast(msg);
}

// ── CSV ──

// #region nodetest:export
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// #endregion nodetest:export
function csvRow(cells) { return cells.map(csvCell).join(','); }

function buildCSVText(rows, grouped, stack) {
  const atomCount = currentContentAtomCount(stack);
  const isMulti = atomCount > 1;
  const groupCols = grouped ? activeGroupColumns(stack) : [];

  const header = [];
  if (grouped) header.push('group_key', 'count');
  for (const col of groupCols) header.push(col.key);
  if (isMulti) header.push('min_score', 'max_score');
  if (atomCount === 1) {
    header.push('entry', 'length', 'score');
    if (!grouped) header.push('comment', 'source');
  } else {
    for (let i = 1; i <= atomCount; i++) {
      header.push(`entry_${i}`, `length_${i}`, `score_${i}`);
      if (!grouped) header.push(`comment_${i}`, `source_${i}`);
    }
  }

  const out = [csvRow(header)];
  for (const { group, chain } of iterDisplayChains(rows, grouped)) {
    const content = chainContentEntries(chain);
    const cells = [];
    if (grouped) {
      cells.push(group.key, group.chains.length);
      for (const col of groupCols) cells.push(col.value(group));
    }
    if (isMulti) {
      let mn = Infinity, mx = -Infinity;
      for (const wlE of content) { if (wlE.score < mn) mn = wlE.score; if (wlE.score > mx) mx = wlE.score; }
      cells.push(mn, mx);
    }
    for (let i = 0; i < atomCount; i++) {
      const wlE = content[i];
      if (!wlE) {
        cells.push('', '', '');
        if (!grouped) cells.push('', '');
      } else {
        cells.push(displayOf(wlE), wlE.norm.length, wlE.score);
        if (!grouped) cells.push(wlE.comment || '', wlE.wordlist?.name ?? '');
      }
    }
    out.push(csvRow(cells));
  }
  return out.join('\r\n') + '\r\n';
}

async function exportCSV() {
  if (!entriesScroller) return;
  const grouped = entriesScroller.sortTier === 'group';
  const text = buildCSVText(entriesScroller.entries, grouped, ToolStack.getStack());
  triggerDownload(text, exportFilename(ToolStack.getStack(), 'csv'));
  const count = countExportEntries(entriesScroller.entries, grouped);
  showToast(`Downloaded ${pluralize(count, 'entry', 'entries')}`);
}

// ── JSON ──

function buildExportJSONObject(rows, grouped, stack) {
  const obj = { url: location.href, tools: exportToolsMetadata(stack) };
  const range = exportScoreRangeMetadata();
  if (range) obj.score_range = range;
  obj.sort = exportSortMetadata();
  const groupCols = grouped ? activeGroupColumns(stack) : [];

  function chainObj(chain, includeProvenance) {
    const entries = chainContentEntries(chain).map(wlE => {
      const e = { entry: displayOf(wlE), score: wlE.score };
      if (includeProvenance) {
        e.comment = wlE.comment || '';
        e.source = wlE.wordlist?.name ?? null;
      }
      return e;
    });
    return { entries };
  }

  if (grouped) {
    obj.groups = rows.map(g => {
      const out = { group_key: g.key };
      for (const col of groupCols) out[col.key] = col.value(g);
      out.chains = g.chains.map(c => chainObj(c, false));
      return out;
    });
  } else {
    obj.groups = [{ chains: rows.map(c => chainObj(c, true)) }];
  }
  return obj;
}

async function exportJSON() {
  if (!entriesScroller) return;
  const grouped = entriesScroller.sortTier === 'group';
  const obj = buildExportJSONObject(entriesScroller.entries, grouped, ToolStack.getStack());
  triggerDownload(JSON.stringify(obj, null, 2) + '\n', exportFilename(ToolStack.getStack(), 'json'));
  const count = countExportEntries(entriesScroller.entries, grouped);
  showToast(`Downloaded ${pluralize(count, 'entry', 'entries')}`);
}

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
    const rows = entriesScroller.entries;
    const grouped = entriesScroller.sortTier === 'group';
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

  // Inject the rendering-layer hooks the extracted ui views can't import upward.
  configureAppView({
    setScrollerScoreRange: range => { if (entriesScroller) entriesScroller.setScoreRange(range); },
  });
  configureEntriesTable({
    navigate: () => Router.navigate(),
    getEntriesScroller: () => entriesScroller,
    rescorePreviewActive,
    buildNoMatchQuipHTML,
  });
  configureToolStack({
    navigate: () => Router.navigate(),
    showRowError: (btn, msg) => ErrorPopover.toggle(btn, msg),
    attachHelpPopups,
  });
  configureRescoreEditor({
    getEntriesScroller: () => entriesScroller,
    bakeMenuOpts,
  });
  configureScopeSelector({
    setScope,
    refreshMergedScroller,
    getEntriesScroller: () => entriesScroller,
  });
  configureManagePanel({
    openAddWordlist: onAdded => ConfigureWordlistDialog.openAdd(onAdded),
  });
  configureDiscoveryBanner({
    runImport: () => WordlistActions.action('import'),
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
