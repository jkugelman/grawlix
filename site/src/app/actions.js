'use strict';

import {
  MERGED_ID, MERGED_NAME, EDITS_ICON, WORDLIST_PUBLISHERS, DEFAULT_SCORING,
} from '../core/constants.js';
import { esc, pluralize, nameFromPath } from '../core/util.js';
import {
  toNorm, displayOf, parseWordlist, buildUserWlEntry,
} from '../engine/norm.js';
import { parseRange } from '../engine/range.js';
import { isLiteralQuery } from '../engine/search.js';
import {
  UNIGRAM_CORPUS_URL, UNIGRAM_CORPUS_IDB_KEY,
  loadUnigramCorpus, invalidateUnigramCorpus, getUnigramFetchedSize,
} from '../engine/segmenter.js';
import { invalidateStatsCache } from '../engine/stats.js';
import { invalidatePreSearchCache } from '../engine/executor.js';
import { TOOLS } from '../engine/tools.js';
import {
  sources$, state, wrapWordlist, newDbKey, getEditsWordlist,
} from '../data/state.js';
import {
  lsLoad, idbGet, idbPut, Storage, openDB, resetAllDataAndReload,
} from '../data/storage.js';
import {
  SCHEMA_VERSION, canMigrate, migrateLocalStorage, migrateIdbRecords, remapStoredUrls,
} from '../data/migrations.js';
import {
  serializeEntries, sortedEntries,
} from '../engine/serialize.js';
import {
  getOutputFormat,
} from '../data/serialize.js';
import {
  compileRescoreRules, maybeAutoSeedRescoreRules, getRescoredEntries,
} from '../engine/rescore.js';
import {
  editsLegend, reconcileEditsRulesAfterImport, invalidateRescoredCache,
} from '../data/rescoring.js';
import {
  mergedEntryCount, invalidateSourceCounts, _mergedStatsKey,
  setShippedConfigCounts,
} from '../data/merge.js';
import { setShippedAllSourcesAxis } from '../data/derived.js';
import { mergeKey } from '../engine/corpus.js';
import { invalidateWordlistCaches } from '../data/invalidate.js';
import {
  persistMeta, persistScoring, batchUpdate, repaintAfterCacheChange,
} from '../data/persist.js';
import {
  syncTargets, MirrorSync, EditsSync,
  isMirrorList, attachMirrorSync, attachEditsSync, detachSync,
  rescoredFilename, sanitizeFilenameStem, partitionSyncPermissions, activateSyncTarget,
  loadSyncTargets,
} from '../data/disk-sync.js';
import { propagateDefaults } from '../model/scoring.js';
import { showToast, showActionToast, showUndoToast } from '../ui/toasts.js';
import { buildMoreMenuHTML } from '../ui/components.js';
import { showConfirm, showAlert, showMergeConflict } from '../ui/dialogs/confirm.js';
import { openUpdateSummaryDialog } from '../ui/dialogs/update-summary.js';
import { SettingsDialog, cycleDarkMode } from '../ui/dialogs/settings.js';
import { WelcomeDialog } from '../ui/dialogs/welcome.js';
import { AppView } from '../ui/app-view.js';
import {
  activeGroupColumns, AtomPopover,
} from '../ui/entries-table.js';
import { ToolStack } from '../ui/tool-stack.js';
import { buildRulesListHTML, renderScoringRules } from '../ui/rescore-editor.js';
import { WordlistSelector, buildWordlistNameHTML } from '../ui/scope-selector.js';
import {
  getEntriesScroller, setScope, renderAll, renderSources, renderMergedDetail,
  refreshMergedScroller, firstPaint,
} from '../ui/rendering.js';
import {
  syncWorkerConfig, resyncWorkerConfig,
  sendEditEntry, sendDeleteEntry, fetchWorkerSerialize,
} from '../ui/pipeline-worker.js';
import { SyncDialog } from '../ui/dialogs/sync.js';
import { ConfigureWordlistDialog } from '../ui/dialogs/configure-wordlist.js';
import { ImportGuideDialog } from '../ui/dialogs/import-guide.js';
import { ReconnectSplash } from '../ui/reconnect-splash.js';
import { Router } from './router.js';

// ─── Wordlist actions dispatcher ──────────────────────────────────────────────

export function getActionTargetWordlist() {
  return state.selected;
}

export const WordlistActions = (() => {
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

export function wordlistFromMeta(m, text) {
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
export const _ready = new Promise(r => { _signalReady = r; });

export async function init() {
  const storedSchema = Storage.schemaVersion();
  const hasOldData   = Storage.hasData();
  let schemaOk = true;   // false only if a needed migration couldn't run and the user declined reset
  if (hasOldData && storedSchema !== SCHEMA_VERSION) {
    schemaOk = canMigrate(storedSchema) && migrateLocalStorage(storedSchema);
    if (!schemaOk) {
      const reset = await showConfirm(
        `Grawlix's data format has changed since your last visit. The site may not work correctly until reset.`,
        { confirmText: 'Reset', cancelText: 'I\'ll take my chances' }
      );
      if (reset) {
        await resetAllDataAndReload();
      }
    }
  }

  await openDB();

  // Stamp only after BOTH phases (settings-blob pre-open, IDB-records here): a
  // stamp between them would let a crash strand half-migrated IDB records on the
  // new version, so neither idempotent phase re-runs to finish them next boot.
  if (schemaOk) {
    if (Number.isFinite(storedSchema) && storedSchema < SCHEMA_VERSION) await migrateIdbRecords(storedSchema);
    if (storedSchema !== SCHEMA_VERSION) Storage.setSchemaVersion(SCHEMA_VERSION);
  }

  // Commit the splash fade to the compositor before the synchronous parse
  // below blocks the main thread, else the logo reveal stalls mid-fade.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const meta = Storage.readMeta();
  if (meta) {
    if (remapStoredUrls(meta)) Storage.writeMeta(meta);
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

  // Must live here, not in boot(): state.sources is only fully built after
  // propagateDefaults above, and the worker's self-build needs the final sources.
  // The boot run defers until this syncConfig's selfReady drains it, so await both:
  // firstPaint resolves only once that drained run lands.
  await Promise.all([firstPaint, syncWorkerConfig(state.sources)]);

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

export function ensureEdits() {
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
export async function regenerateFillOutputs() {
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

// The per-entry edit paths persist meta only: the worker owns the IDB write and
// its editAck keeps ownedCorpus fresh, so main must do NEITHER — a resync here
// would read IDB before the worker's write lands (a read-before-write race).
export function persistEditsMetaOnly(edits) {
  persistMeta();
  EditsSync.scheduleWrite();
}

export async function persistEdits(edits) {
  await Storage.writeWordlist(edits, serializeEntries(sortedEntries(edits.rawEntries)));
  persistEditsMetaOnly(edits);
  // My Edits mutations ship a `patch`, never a cacheVersion$ bump, so the
  // completeness hook never fires for them — this post-write re-sync, reading the
  // now-fresh IDB text, is their only path back to a fresh ownedCorpus.
  resyncWorkerConfig();
}

// The per-entry edit's stand-in for a resync: the command already recomputed the
// axis + config counts, so main adopts the shipped values instead of rebuilding.
// Mirrors syncWorkerConfig's selfReady consumption.
function applyEditAck(ack) {
  if (!ack) return;
  setShippedAllSourcesAxis(ack.axis, ack.counts?.version);
  if (ack.counts) setShippedConfigCounts(ack.counts.sourceCounts, ack.counts.mergedCount, ack.counts.version);
  refreshDerivedDisplays();
}

// Gated to user-owned, non-fetched lists: a fetch URL would re-pull the
// original-scale data and clobber the bake, and a publisher's defaultRules are a
// live transform, so resetting a baked publisher list to them would re-rescore
// the already-baked scores.
export function canBakeRescoring(wordlist) {
  return !wordlist.publisherId && !wordlist.url && bakingWouldChangeScores(wordlist);
}

export function bakingWouldChangeScores(wordlist) {
  return getRescoredEntries(wordlist).some((e, i) => e.score !== wordlist.rawEntries[i].score);
}

export function bakeMenuOpts(wordlist) {
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

export async function bakeRescoring(wordlist) {
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
    resyncWorkerConfig();
  }
}

export async function clearEdits() {
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

// ─── Actions ──────────────────────────────────────────────────────────────────

export function attachExternalEditHandlers(s, refreshFn) {
  s._onSave = (originalWlEntry, newValues) => {
    saveEdit(originalWlEntry, newValues);
    refreshFn?.();
  };
}

export function saveEdit(originalWlEntry, { raw, score, comment }) {
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

  applyEditsChange(edits, () => {
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

  const origForCmd = origNorm ? { norm: origNorm, display: origDisplay } : null;
  const nextForCmd = { norm: newNorm, display: newDisplay, score, comment };
  sendEditEntry(origForCmd, nextForCmd).then(applyEditAck);
  persistEditsMetaOnly(edits);
}

// ─── Fetch, import & update ───────────────────────────────────────────────────

export async function applyWordlistText(wordlist, text, { fetchedSize = null, originalFilename = null, nameOverride = null, source = null, clearUrl = false, silent = false, viaToast = false } = {}) {
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
  // After the write: the worker rebuilds ownedCorpus from IDB text, so a re-sync
  // before this point would read the pre-write text (see worker-protocol.md).
  resyncWorkerConfig();
  // Not redundant with the scroller run the cacheVersion$ effect already fired
  // inside batchUpdate: that run's re-sync read pre-write IDB, so it can render
  // the corpus WITHOUT this wordlist's new text. Only the post-write re-sync
  // above sees the new text, and a run must be paired with it or — depending on
  // which build wins the worker's supersession (a cross-engine timing toss-up) —
  // the stale pre-write render can be the last one and never gets corrected.
  refreshMergedScroller();

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

export async function fetchWordlist(wordlist, event, { silent = false, viaToast = false } = {}) {
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

export function getAutoUpdate() { return lsLoad('autoUpdate') !== 'off'; }

export async function checkForUpdates() {
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

export function importToWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  ImportGuideDialog.open(wordlist);
}

export function ingestFile(file, wordlist, nameOverride) {
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
      // This My Edits combine path bumps no cacheVersion$ (it repaints directly),
      // so the completeness hook never fires — this post-write re-sync is its only
      // trigger, and reads the fresh IDB text the worker rebuilds from.
      resyncWorkerConfig();

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

export function deleteFromEdits(target, refreshFn) {
  const edits = getEditsWordlist();
  const norm = target.norm;
  const display = target.display;
  const idx = edits.rawEntries.findIndex(e => e.norm === norm && displayOf(e) === display);
  if (idx === -1) return;

  const refresh = refreshFn ?? (() => {
    const scroller = getEntriesScroller();
    scroller._invalidateSortCache();
    scroller._sortAndRender();
  });

  let deleted;
  applyEditsChange(edits, () => { [deleted] = edits.rawEntries.splice(idx, 1); });
  sendDeleteEntry({ norm, display }).then(applyEditAck);
  persistEditsMetaOnly(edits);
  refresh();

  showUndoToast(`Deleted ${esc(displayOf(deleted))} from ${buildWordlistNameHTML(edits)}`, () => {
    applyEditsChange(edits, () => { edits.rawEntries.splice(idx, 0, deleted); });
    sendEditEntry(null, { norm, display: displayOf(deleted), score: deleted.score, comment: deleted.comment }).then(applyEditAck);
    persistEditsMetaOnly(edits);
    refresh();
  });
}

export async function deleteWordlist(wordlist, event) {
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

export function addNewWordlist(wordlistDef) {
  const wordlist = wrapWordlist({ rescoreRules: [], ...wordlistDef, rawEntries: [], lastUpdated: null, _loading: false });
  compileRescoreRules(wordlist);
  state.sources.push(wordlist);
  invalidateSourceCounts();
  invalidateStatsCache(_mergedStatsKey);
  persistMeta();
  sources$.bump();              // notify cosmetic effect with fresh caches
  return wordlist;
}

function newEntrySeedQuery() {
  const q = AppView.searchQuery.trim();
  if (!isLiteralQuery(q)) return '';
  // The add-FAB seed checks the run's SCOPE (existsInScope), the worker's answer
  // for the active scope; a null answer (no run / blank query) defaults to seeding
  // the query — main holds no corpus to check it against.
  const exists = !!getEntriesScroller()?._existsInScope;
  return exists ? '' : q;
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

export function bindEvents() {
  // Header chrome
  document.querySelector('.header-logo-link').href = location.pathname;
  document.getElementById('btn-settings').onclick = () => SettingsDialog.open();
  document.getElementById('btn-help').onclick     = () => WelcomeDialog.open();
  document.getElementById('add-fab').onclick = () =>
    AtomPopover.openForCreate(newEntrySeedQuery(), getEntriesScroller(), null);

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

// ─── Rename ───────────────────────────────────────────────────────────────────

export function startInlineRename(inputEl, originalName, { onCommit, onCancel, onInput }) {
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

// Main keeps only My Edits rawEntries; the merged-corpus splice is the worker's,
// via the sendEditEntry/sendDeleteEntry command the caller fires alongside.
export function applyEditsChange(edits, mutate) {
  mutate();
  invalidateRescoredCache(edits);
  invalidateStatsCache(edits);
  invalidateStatsCache(_mergedStatsKey);
  invalidatePreSearchCache();
  refreshDerivedDisplays();
}

// The detail panel's stats bar is deliberately not repainted here — every
// caller also runs a scroller filter pass, and its onFilterChange callback
// repaints the bar.
export function refreshDerivedDisplays() {
  WordlistSelector.refreshMeta();
  renderScoringRules();
}

export async function downloadMergedWordlistFromPanel() {
  // Unsorted (sort:false): the merged download ships entries in merge order, only
  // the disk mirror sorts. The worker is the only corpus source post-flip; a null
  // reply (timeout/not-fresh) downloads empty rather than throwing.
  const text = (await fetchWorkerSerialize(MERGED_ID, getOutputFormat(), false)) ?? '';
  triggerDownload(text, rescoredFilename(MERGED_ID));
  showToast(`Downloaded ${pluralize(mergedEntryCount(), 'entry', 'entries')}`);
}

export function triggerDownload(text, filename) {
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

export async function downloadSourceWordlist(wordlist) {
  if (!wordlist || !wordlist.rawEntries.length) return;
  // Unsorted (sort:false): the individual download ships entries in rawEntries
  // order, only the disk mirror sorts. Null reply (not-fresh) → local fallback.
  const text = (await fetchWorkerSerialize(wordlist.dbKey, getOutputFormat(), false))
    ?? serializeEntries(getRescoredEntries(wordlist), getOutputFormat());
  triggerDownload(text, rescoredFilename(wordlist));
  showToast(`Downloaded ${pluralize(wordlist.rawEntries.length, 'entry', 'entries')}`);
}

export async function downloadOriginalWordlist(wordlist) {
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

export function buildExportMenuHTML() {
  return buildMoreMenuHTML([
    ['Copy to clipboard',            'exportCopy()'],
    ['Download results as wordlist', 'exportWordlist()'],
    ['Download as CSV',              'exportCSV()'],
    ['Download as JSON',             'exportJSON()'],
  ], { header: 'Export these results' });
}

export function chainContentEntries(chain) {
  const out = [];
  let prevEntry = null;
  for (const atom of chain.atoms) {
    if (atom.wlEntry.norm === prevEntry) continue;
    out.push(atom.wlEntry);
    prevEntry = atom.wlEntry.norm;
  }
  return out;
}

function currentContentAtomCount(stack) {
  let count = 1;
  for (const row of stack) {
    if (row.isInert()) continue;
    if (row.kind() === 'transform') count++;
  }
  return count;
}

export function* iterDisplayChains(rows, grouped) {
  if (grouped) {
    for (const g of rows) for (const chain of g.chains) yield { group: g, chain };
  } else {
    for (const chain of rows) yield { group: null, chain };
  }
}

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

export function exportFilenameSegment(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[*?#@\[\]/\\:|"<>]/g, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function exportFilename(stack, ext) {
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

export function buildCopyText(rows, grouped, stack) {
  const header = exportCopyHeader(stack);
  const body = [];
  if (grouped) {
    for (const g of rows) body.push(g.chains.map(chainCopyText).join(', '));
  } else {
    body.push(...flatCopyLines(rows));
  }
  return header + (body.length ? '\n' + body.join('\n') : '');
}

export function flatCopyLines(chains) {
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

export async function exportCopy() {
  const scroller = getEntriesScroller();
  if (!scroller) return;
  const grouped = scroller.sortTier === 'group';
  const rows = await scroller.exportRows();
  const text = buildCopyText(rows, grouped, ToolStack.getStack());
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    showToast('Copy failed — clipboard permission denied');
    return;
  }
  const count = countExportEntries(rows, grouped);
  showToast(`Copied ${pluralize(count, 'entry', 'entries')}`);
}

// ── Wordlist ──

export function buildWordlistText(rows, grouped) {
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

export async function exportWordlist() {
  const scroller = getEntriesScroller();
  if (!scroller) return;
  const grouped = scroller.sortTier === 'group';
  const { text, count, skipped } = buildWordlistText(await scroller.exportRows(), grouped);
  triggerDownload(text, exportFilename(ToolStack.getStack(), 'txt'));
  let msg = `Downloaded ${pluralize(count, 'entry', 'entries')}`;
  if (skipped) msg += ` (${pluralize(skipped, 'entry', 'entries')} skipped due to semicolons)`;
  showToast(msg);
}

// ── CSV ──

export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(cells) { return cells.map(csvCell).join(','); }

export function buildCSVText(rows, grouped, stack) {
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

export async function exportCSV() {
  const scroller = getEntriesScroller();
  if (!scroller) return;
  const grouped = scroller.sortTier === 'group';
  const rows = await scroller.exportRows();
  const text = buildCSVText(rows, grouped, ToolStack.getStack());
  triggerDownload(text, exportFilename(ToolStack.getStack(), 'csv'));
  const count = countExportEntries(rows, grouped);
  showToast(`Downloaded ${pluralize(count, 'entry', 'entries')}`);
}

// ── JSON ──

export function buildExportJSONObject(rows, grouped, stack) {
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

export async function exportJSON() {
  const scroller = getEntriesScroller();
  if (!scroller) return;
  const grouped = scroller.sortTier === 'group';
  const rows = await scroller.exportRows();
  const obj = buildExportJSONObject(rows, grouped, ToolStack.getStack());
  triggerDownload(JSON.stringify(obj, null, 2) + '\n', exportFilename(ToolStack.getStack(), 'json'));
  const count = countExportEntries(rows, grouped);
  showToast(`Downloaded ${pluralize(count, 'entry', 'entries')}`);
}
