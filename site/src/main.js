'use strict';

import { MERGED_ID, MERGED_NAME } from './core/constants.js';
import { esc } from './core/util.js';
import { effect } from './core/signals.js';
import { toNorm, displayOf, parseWordlist, buildUserWlEntry } from './engine/norm.js';
import {
  configureIO as configureSegmenterIO, loadUnigramCorpus, setUnigramCorpus as segmenterSetCorpus,
} from './engine/segmenter.js';
import { TOOLS, makeToolRow } from './engine/tools.js';
import { syncStatus$, state, newDbKey, syncKey, getEditsWordlist } from './data/state.js';
import { lsSave, lsLoad, getDb, openDB, idbPut, idbGet, Storage } from './data/storage.js';
import { migrateSettings } from './data/migrations.js';
import { serializeEntries, getOutputFormat, setOutputFormat } from './data/serialize.js';
import { buildMergedWordlist, getActiveCorpus, mergeKey, invalidateSourceCounts, peekMergedCache } from './data/merge.js';
import {
  persistMeta, setWordlistEnabled, setWordlistRescoreRules, reorderSources,
} from './data/persist.js';
import {
  configureSyncDialogs, syncTargets, persistSyncTarget, editsSyncKey, listForSyncKey, syncFilename, SyncStatus, Disk, MirrorSync, EditsSync, threeWayMergeEdits, attachMirrorSync, attachEditsSync, rescoredFilename, activateSyncTarget,
} from './data/disk-sync.js';
import { buildClearableInputHTML, mountClearableInputs, toggleSplitMenu } from './ui/components.js';
import { createDialog, showDialog } from './ui/dialogs/dialog.js';
import { showConfirm, showAlert, showMergeConflict, showEditsConflict } from './ui/dialogs/confirm.js';
import { openUpdateSummaryDialog } from './ui/dialogs/update-summary.js';
import { SettingsDialog, configureSettings } from './ui/dialogs/settings.js';
import { WelcomeDialog } from './ui/dialogs/welcome.js';
import { SyncDialog, configureSyncDialog } from './ui/dialogs/sync.js';
import { ConfigureWordlistDialog, configureConfigureWordlist } from './ui/dialogs/configure-wordlist.js';
import { ImportGuideDialog, configureImportGuide } from './ui/dialogs/import-guide.js';
import { AppView } from './ui/app-view.js';
import { configureEntriesTable, GroupMorePopover, ErrorPopover } from './ui/entries-table.js';
import { ToolStack, ToolPicker, configureToolStack, mountGroupColumnStyle, pipelineIdle } from './ui/tool-stack.js';
import { mountHistogramPointer, onHistogramPointerDown } from './ui/histogram-view.js';
import {
  configureRescoreEditor, startNoteEdit, onRuleInput, saveRuleField, deleteRule, addRule, resetRescoreRules, neutralizeRescoreRules, saveScoringField, deleteScoringRow, addScoringRow, resetScoringRules,
} from './ui/rescore-editor.js';
import { WordlistSelector, renderSyncIndicators } from './ui/scope-selector.js';
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

  // ReconnectSplash still lives in main.js; importing it into actions.js would
  // recreate the cycle that breaks actions.js's standalone load under node:test.
  configureActions({ ReconnectSplash });

  configureSyncDialog({ WordlistActions });
  configureConfigureWordlist({ addNewWordlist, fetchWordlist, ingestFile });
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
