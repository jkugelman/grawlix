'use strict';

import { esc } from './core/util.js';
import { effect } from './core/signals.js';
import { TOOLS } from './engine/tools.js';
import { syncStatus$, state, getEditsWordlist } from './data/state.js';
import { fetchStatus$ } from './data/fetch-status.js';
import { Storage } from './data/storage.js';
import { serializeEntries } from './engine/serialize.js';
import { getOutputFormat, setOutputFormat } from './data/serialize.js';
import { persistMeta } from './data/persist.js';
import { configureSyncDialogs, configureMirrorSerializer, configureEditsMerger } from './data/disk-sync.js';
import { mountClearableInputs, toggleSplitMenu } from './ui/components.js';
import { showConfirm, showAlert, showMergeConflict, showEditsConflict } from './ui/dialogs/confirm.js';
import { openUpdateSummaryDialog } from './ui/dialogs/update-summary.js';
import { SettingsDialog, configureSettings } from './ui/dialogs/settings.js';
import { HelpDialog } from './ui/dialogs/help.js';
import { NewToolsReveal } from './ui/new-tools-reveal.js';
import { SyncDialog, configureSyncDialog } from './ui/dialogs/sync.js';
import { ConfigureWordlistDialog, configureConfigureWordlist } from './ui/dialogs/configure-wordlist.js';
import { ImportGuideDialog, configureImportGuide } from './ui/dialogs/import-guide.js';
import { AppView, buildScoreRangeButtonHTML, mountScoreRangeControl } from './ui/app-view.js';
import { configureEntriesTable, GroupMorePopover, ErrorPopover } from './ui/entries-table.js';
import { ToolStack, ToolPicker, configureToolStack, mountGroupColumnStyle } from './ui/tool-stack.js';
import { mountHistogramPointer, onHistogramPointerDown } from './ui/histogram-view.js';
import {
  configureRescoreEditor, startNoteEdit, onRuleInput, saveRuleField, deleteRule, addRule, resetRescoreRules, neutralizeRescoreRules, saveScoringField, deleteScoringRow, addScoringRow, resetScoringRules,
  applyRescoreDraft, cancelRescoreDraft, makeRescorePermanent,
} from './ui/rescore-editor.js';
import { WordlistSelector, renderSyncIndicators } from './ui/scope-selector.js';
import { renderFetchStatus } from './ui/fetch-status.js';
import { configurePipelineWorker, fetchWorkerSerialize, fetchWorkerMergeDisk, fetchWorkerFlushEdits } from './ui/pipeline-worker.js';
import { configureManagePanel, ManagePanel } from './ui/manage-panel.js';
import { configureDiscoveryBanner, DiscoveryBanner } from './ui/discovery-banner.js';
import {
  configureRendering, renderAll, renderMergedDetail, mountStatsBarOverflowObservers, mountHeaderHeightObserver, attachHelpPopups,
} from './ui/rendering.js';
import { Router } from './app/router.js';
import {
  WordlistActions, init, regenerateFillOutputs, persistEdits, bakeMenuOpts, applyWordlistText, fetchWordlist, checkForUpdates, ingestFile, getAutoUpdate, addNewWordlist, deleteWordlist, deleteFromEdits, saveEdit, attachExternalEditHandlers, refreshDerivedDisplays, downloadSourceWordlist, downloadOriginalWordlist, downloadMergedWordlistFromPanel, buildExportMenuHTML, buildWordlistText, exportCopy, exportWordlist, exportCSV, exportJSON,
} from './app/actions.js';

// ─── Components ──────────────────────────────────────────────────────────────

// The × button carries no per-call wiring: clicking it empties the field and
// dispatches an `input` event, so the field's own handler reacts as if the
// user erased the text by hand.
function buildScoreRangeInputHTML(inputId, value, viewName) {
  const input = `<input type="text" id="${inputId}" data-help="filter/score" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(value)}" oninput="${viewName}.onScoreRange(this.value)">`;
  return `<label class="stat score-range-label" title="Filter by score (Alt-C)"><span class="stat-label">Scores</span><span class="clearable-input">${input}${buildScoreRangeButtonHTML(value)}</span></label>`;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Two callers reach module-scoped names through `window`, which can't see this
// module's private scope: inline on*= handlers in generated HTML, and the
// Playwright suite's page.evaluate bodies. Expose the production names the
// inline handlers depend on. (The test-only surface — `window.__grawlixTest`
// and `window._db` — is assigned by ./test-api.js, imported last below.)
function exposeWindowGlobals() {
  Object.assign(window, {
    WordlistActions, SyncDialog, AppView,
    toggleSplitMenu, startNoteEdit, onRuleInput, onHistogramPointerDown,
    saveRuleField, deleteRule, addRule, resetRescoreRules, neutralizeRescoreRules,
    saveScoringField, deleteScoringRow, addScoringRow, resetScoringRules,
    applyRescoreDraft, cancelRescoreDraft, makeRescorePermanent,
    exportCopy, exportWordlist, exportCSV, exportJSON,
    state, Router, ToolStack, SettingsDialog, Storage, TOOLS,
    getOutputFormat, setOutputFormat, persistMeta, persistEdits,
    downloadSourceWordlist, downloadOriginalWordlist, downloadMergedWordlistFromPanel, checkForUpdates, saveEdit,
    serializeEntries, buildWordlistText, applyWordlistText, renderMergedDetail,
    getEditsWordlist,
  });
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

// Module evaluation only *defines*; the side effects run here, and their order
// is a load-bearing contract — each step below assumes the prior ones already
// ran (configureX injections before the components that call them, dialogs
// before init opens them, app-shell before init's first renderAll), so a wrong
// order surfaces as a runtime error, not the hoisting non-issue it was when
// these were stray top-level statements. The per-step notes spell out each
// dependency; init() must come last.
function boot() {
  // Window exposure first: components below render HTML with inline on*= handlers
  // that resolve through `window`.
  exposeWindowGlobals();

  // import.meta.url must be main.js's specifically — the depth-stable anchor the
  // worker URL resolves against in both builds (see pipeline-worker.js).
  configurePipelineWorker({ baseURL: import.meta.url });

  configureSyncDialog({ WordlistActions });
  configureConfigureWordlist({ addNewWordlist, fetchWordlist, ingestFile, deleteWordlist });
  configureImportGuide({ ingestFile });

  // Inject the app-layer callees the extracted ui views can't import upward.
  configureRendering({
    refreshDerivedDisplays,
    deleteFromEdits,
    attachExternalEditHandlers,
    buildScoreRangeInputHTML,
    buildExportMenuHTML,
  });
  configureEntriesTable({
    navigate: (opts) => Router.navigate(opts),
  });
  configureToolStack({
    navigate: () => Router.navigate(),
    showRowError: (btn, msg) => ErrorPopover.toggle(btn, msg),
    attachHelpPopups,
  });
  configureRescoreEditor({
    bakeMenuOpts,
    bake: () => WordlistActions.action('bakeRescoring'),
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
  mountScoreRangeControl();
  mountHistogramPointer();
  mountSplitMenuDismiss();

  // Dialog/overlay singletons append to <body>. showConfirm must exist before
  // init() (init's migration path calls it); the rest before any UI opens them.
  SettingsDialog.mount();
  HelpDialog.mount();
  NewToolsReveal.mount();
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

  configureMirrorSerializer((scope, fmt) => fetchWorkerSerialize(scope, fmt));

  // Injected (not imported) so data/disk-sync stays off the ui/ worker client.
  configureEditsMerger({
    mergeDisk: (fileText, choice) => fetchWorkerMergeDisk(fileText, choice),
    flushEdits: () => fetchWorkerFlushEdits(),
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
  effect(() => { fetchStatus$.get(); renderFetchStatus(); });

  mountStatsBarOverflowObservers();
  mountHeaderHeightObserver();

  maybeRemoveSplashEarly();
  init();
}

boot();

// Last: the test surface imports from every layer, so it must load after all of
// them are initialized. Its only side effect is assigning window.__grawlixTest /
// window._db; it is otherwise inert and adds nothing to the production path.
import './test-api.js';
