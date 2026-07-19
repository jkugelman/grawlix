'use strict';

import {
  MERGED_ID, MERGED_NAME, EDITS_ICON, WORDLIST_PUBLISHERS, DEFAULT_SCORING,
} from '../core/constants.js';
import { esc, pluralize, nameFromPath } from '../core/util.js';
import { putFetchHandle, dropFetchHandle, bumpFetchStatus } from '../data/fetch-status.js';
import {
  toNorm, displayOf, parseWordlist, buildUserWlEntry,
} from '../engine/norm.js';
import { applyEditsWriteSet } from '../engine/edit-plan.js';
import { parseRange } from '../engine/range.js';
import { isLiteralQuery } from '../engine/search.js';
import { invalidateStatsCache } from '../engine/stats.js';
import { TOOLS } from '../engine/tools.js';
import { pendingNewTools, markToolsSeen } from '../data/new-tools.js';
import { NewToolsReveal } from '../ui/new-tools-reveal.js';
import {
  sources$, state, wrapWordlist, newDbKey, getEditsWordlist, setResultsStale,
} from '../data/state.js';
import {
  lsLoad, lsSave, idbGet, idbGetAllKeys, Storage, openDB, requestPersistentStorage, resetAllDataAndReload,
} from '../data/storage.js';
import {
  SCHEMA_VERSION, canMigrate, migrateLocalStorage, migrateIdbRecords, remapStoredUrls,
} from '../data/migrations.js';
import {
  serializeEntries, formatEntryText, AS_IS_FORMAT,
} from '../engine/serialize.js';
import {
  getOutputFormat, getTrashScore, defaultScoreRange,
} from '../data/serialize.js';
import {
  compileRescoreRules, maybeAutoSeedRescoreRules, getRescoredEntries, rescoreEntry, applyRescoring,
} from '../engine/rescore.js';
import {
  editsLegend, reconcileEditsRulesAfterImport, invalidateRescoredCache,
} from '../data/rescoring.js';
import {
  mergedEntryCount, invalidateSourceCounts, _mergedStatsKey,
  setShippedConfigCounts, setShippedRescoreInputs, sourceTotal, sourceRescoreInputs,
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
import { buildMoreMenuHTML, positionPopover } from '../ui/components.js';
import { showConfirm, showAlert, showMergeConflict } from '../ui/dialogs/confirm.js';
import { openUpdateSummaryDialog } from '../ui/dialogs/update-summary.js';
import { SettingsDialog, cycleDarkMode } from '../ui/dialogs/settings.js';
import { HelpDialog } from '../ui/dialogs/help.js';
import { AppView } from '../ui/app-view.js';
import { isMultiLaneTier } from '../engine/sort.js';
import {
  activeGroupColumns, EntryPanel, handleScoreDigitShortcut,
} from '../ui/entries-table.js';
import { ToolStack } from '../ui/tool-stack.js';
import { buildRulesListHTML, renderScoringRules } from '../ui/rescore-editor.js';
import { WordlistSelector, buildWordlistNameHTML } from '../ui/scope-selector.js';
import {
  getEntriesScroller, setScope, renderAll, renderSources, renderMergedDetail,
  refreshMergedScroller, reprojectMergedScroller, repatchMergedScroller, repaintAfterConfigChange, firstPaint,
} from '../ui/rendering.js';
import {
  syncWorkerConfig, resyncWorkerConfig,
  sendEditEntry, sendDeleteEntry, sendApplyFetched, fetchWorkerSerialize,
  fetchWorkerEditPlan, whenWorkerCommitted, beginPendingEdit, endPendingEdit,
  checkWorkerAssets, sendFreeDiff,
} from '../ui/pipeline-worker.js';
import { SyncDialog } from '../ui/dialogs/sync.js';
import { ConfigureWordlistDialog } from '../ui/dialogs/configure-wordlist.js';
import { ImportGuideDialog } from '../ui/dialogs/import-guide.js';
import { DiscoveryBanner } from '../ui/discovery-banner.js';
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
    rescore:   () => WordlistSelector.toggleEditor(),
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

export function wordlistFromMeta(m) {
  const wordlist = wrapWordlist({
    ...(m.type     ? { type: m.type }         : {}),
    dbKey:         m.dbKey || newDbKey(),
    icon:            m.icon || null,
    publisherId:     m.publisherId || null,
    name: m.name, url: m.url || null,
    enabled: !!m.enabled,
    populated: false,
    lastUpdated: m.lastUpdated || null,
    fetchedSize: m.fetchedSize || null,
    rescoreRules: (m.rescoreRules || []).map(r => ({ length: '', ...r })),
    dirty: !!m.dirty,
    originalFilename: m.originalFilename || null,
    rawEntries: [],
    _loading: false,
  });
  compileRescoreRules(wordlist);
  return wordlist;
}

export function parseInto(wordlist, text, m) {
  wordlist.rawEntries = text ? parseWordlist(text) : [];
  // Set populated AFTER rawEntries (and here, not at wrapper-build): consumers
  // read it as "entries loaded," so a populated-but-empty window would race them.
  wordlist.populated = !!(m.populated || text || m.lastUpdated);
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

  const meta = Storage.readMeta();
  let toParse = [];   // { wordlist, m } per source still owed a read + parse
  if (meta) {
    if (remapStoredUrls(meta)) Storage.writeMeta(meta);
    try {
      state.sources = meta.map(m => {
        const m2 = { ...m, dbKey: m.dbKey || newDbKey() };
        const wordlist = wordlistFromMeta(m2);
        toParse.push({ wordlist, m: m2 });
        return wordlist;
      });
    } catch { state.sources = defaultSources(); toParse = []; }
  } else {
    state.sources = defaultSources();
    persistMeta();
  }

  // Scope must land before the score ranges (the active range is keyed off the
  // restored scope) and before the first render (the selector + panel read
  // state.selected). Scope is localStorage-only, never the URL, so it's
  // independent of Router.applyURL below.
  restoreSelectedScope();
  ensureScoring();
  AppView.restoreScoreRange(restoreScoreRange());

  Router.applyURL();

  ensureEdits();
  propagateDefaults();

  // Post syncConfig before the wordlist text is read: the payload is final (rules
  // from propagateDefaults, scope from restoreSelectedScope) and the worker reads
  // its own text from IDB, so its build runs concurrently with the reads + parse
  // below. selfReady may now land before the first paint's run is registered; both
  // orderings settle via the ownedFreshScope mirror — see docs/worker-protocol.md.
  const workerReady = syncWorkerConfig(state.sources);

  // Commit the splash fade to the compositor before the synchronous parse below
  // blocks the main thread, else the logo reveal stalls mid-fade.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Only My Edits parses on main (it seeds edits + the legend); the worker reads every
  // other source's text from its own IDB. Derive `populated` from actual IDB presence, not a
  // surviving `lastUpdated`: localStorage (meta) and IndexedDB (text) evict independently, so a
  // list whose data the browser dropped must read as unpopulated, or the re-fetch gate below
  // trusts the stale flag and strands it on "No data" forever with no recovery.
  const dataKeys = new Set(await idbGetAllKeys());
  await Promise.all(toParse.map(async ({ wordlist, m }) => {
    if (wordlist.type !== 'edits') { wordlist.populated = dataKeys.has('data_' + wordlist.dbKey); return; }
    const text = await Storage.readWordlist(m) ?? await idbGet('data_' + m.id);
    parseInto(wordlist, text, m);
  }));

  AppView.show();
  Router.navigate();
  renderAll();

  await Promise.all([firstPaint, workerReady]);

  Router.openPendingEntry();   // deep-linked entry panel — needs the worker ready (above)

  await loadSyncTargets();
  const { granted, prompt } = await partitionSyncPermissions();
  const isReturning = !!lsLoad('returningVisitor');
  lsSave('returningVisitor', '1');
  const newToolSlugs = pendingNewTools(isReturning);
  const revealNewTools = () => {
    if (!newToolSlugs.length) return;
    markToolsSeen(newToolSlugs);
    NewToolsReveal.show(newToolSlugs.map(k => [k, TOOLS[k]]));
  };

  const _overlay = document.getElementById('splash-screen');
  if (prompt.length) {
    ReconnectSplash.show(prompt);
  } else if (_overlay) {
    _overlay.classList.add('done');
    _overlay.addEventListener('transitionend', () => { _overlay.remove(); revealNewTools(); }, { once: true });
  } else {
    revealNewTools();
  }
  Promise.all(granted.map(activateSyncTarget)).catch(err => console.error('sync resume failed', err));

  bindEvents();
  syncHelp();
  requestPersistentStorage();
  checkForUpdates();
  checkWorkerAssets();
  setInterval(() => { checkForUpdates(); checkWorkerAssets(); }, UPDATE_CHECK_INTERVAL);

  state.sources
    .filter(l => l.url && !l.populated)
    .forEach(l => fetchWordlist(l, null, { silent: true }));

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

// null (never-set / pre-default user) and a stored '' (deliberately cleared) must
// stay distinct: collapse them and everyone who cleared the filter silently gets
// the default forced back on.
function restoreScoreRange() {
  const dflt = defaultScoreRange();
  const stored = lsLoad('scoreRange');
  if (stored === null) return dflt;
  const trimmed = stored.trim();
  if (trimmed === '') return '';
  return parseRange(trimmed) !== null ? trimmed : dflt;
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
  await Storage.writeWordlist(edits, serializeEntries(edits.rawEntries));
  persistEditsMetaOnly(edits);
  // My Edits mutations ship a `patch`, never a cacheVersion$ bump, so the
  // completeness hook never fires for them — this post-write re-sync, reading the
  // now-fresh IDB text, is their only path back to a fresh ownedCorpus.
  resyncWorkerConfig();
}

// An in-place worker command's stand-in for a resync: the command (editEntry,
// deleteEntry, or applyFetched) already recomputed the axis + config counts, so
// main adopts the shipped values instead of rebuilding. Mirrors syncWorkerConfig's
// selfReady consumption.
function applyConfigAck(ack) {
  if (!ack) return;
  setShippedAllSourcesAxis(ack.axis, ack.counts?.version);
  if (ack.counts) setShippedConfigCounts(ack.counts.sourceCounts, ack.counts.sourceTotals, ack.counts.mergedCount, ack.counts.mergedWidthBound, ack.counts.version);
  setShippedRescoreInputs(ack.rescoreInputs);   // present on fetchApplied, absent on editAck (kept)
  refreshDerivedDisplays();
}

// Gated to user-owned, non-fetched lists: a fetch URL would re-pull the
// original-scale data and clobber the bake, and a publisher's defaultRules are a
// live transform, so resetting a baked publisher list to them would re-rescore
// the already-baked scores.
export function canBakeRescoring(wordlist, rules = wordlist.rescoreRules) {
  return !wordlist.publisherId && !wordlist.url && rescoringChangesScores(wordlist, rules);
}

export function rescoringChangesScores(wordlist, rules = wordlist.rescoreRules) {
  // My Edits is main-resident; every other source applies `rules` to the worker-shipped
  // distinct (score, length) pairs — the only inputs rescoreEntry reads — so this stays
  // synchronous against the live editor draft. Null pairs (pre-selfReady) close the gate.
  if (wordlist.type === 'edits') return wordlist.rawEntries.some(e => rescoreEntry(e, rules) !== e.score);
  const pairs = sourceRescoreInputs(wordlist);
  return !!pairs && pairs.some(([score, len]) => rescoreEntry({ score, norm: { length: len } }, rules) !== score);
}

export function bakeMenuOpts(wordlist, rules = wordlist.rescoreRules) {
  if (canBakeRescoring(wordlist, rules)) return {};
  const reason = (wordlist.publisherId || wordlist.url)
    ? 'Only available for My Edits and imported lists'
    : 'No rescoring to apply';
  return { disabled: true, title: reason };
}

// Reset like a fresh import. The dirty = false is load-bearing: reconcile
// early-returns on a dirty list, so without it a prior translation setup would
// survive the bake and silently re-impose the dual scale baking just resolved.
function resetRescoreRulesAfterBake(wordlist, baked) {
  if (wordlist.type === 'edits') {
    wordlist.rescoreRules = editsLegend();
    wordlist.dirty = false;
    reconcileEditsRulesAfterImport(wordlist);
  } else {
    wordlist.rescoreRules = [];
    maybeAutoSeedRescoreRules(wordlist, baked);
  }
}

export async function bakeRescoring(wordlist) {
  if (!canBakeRescoring(wordlist)) return;
  const html = `Permanently rescore ${buildWordlistNameHTML(wordlist)}? This will rewrite every entry's score using the current rules, then reset the rules. The original scores will be lost — use <strong>Download original</strong> first if you want a backup.`;
  if (!await showConfirm('', { confirmText: 'Rescore', html })) return;

  // My Edits is resident; a non-Edits source's rawEntries aren't, so re-read its text
  // from IDB and rescore the transient parse (bake is a rare, deliberate action).
  const source = wordlist.type === 'edits'
    ? getRescoredEntries(wordlist)
    : applyRescoring(parseWordlist(await Storage.readWordlist(wordlist) ?? ''), wordlist.rescoreRules);
  const baked = source.map(e => ({ ...e }));
  batchUpdate(() => {
    invalidateWordlistCaches(wordlist);
    if (wordlist.type === 'edits') wordlist.rawEntries = baked;   // only My Edits retains entries
    resetRescoreRulesAfterBake(wordlist, baked);
    compileRescoreRules(wordlist);
    repaintAfterCacheChange();
  });

  if (wordlist.type === 'edits') {
    await persistEdits(wordlist);
  } else {
    await Storage.writeWordlist(wordlist, serializeEntries(baked));
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
  s._onSave = (mode, baseline, newValues) =>
    saveEntry(mode, mode === 'create' ? null : baseline, newValues, refreshFn);
  s._onBatchRescore = (targets, score) => batchRescore(targets, score, refreshFn);
  s._onBatchDelete = (targets) => batchDelete(targets, refreshFn);
}

export function saveEdit(orig, newValues) {
  return saveEntry('edit', orig, newValues);
}

// The worker owns the foreign rescore indexes, so it plans the edit. A null reply
// is only the pre-first-sync window (ownedBuilt===null): wait for a committed build
// and retry ONCE rather than silently dropping the edit; bail if still unavailable.
async function planForSave(args) {
  const plan = await fetchWorkerEditPlan(args);
  if (plan) return plan;
  await whenWorkerCommitted();
  return fetchWorkerEditPlan(args);
}

// A set-preserving edit (replaced === false) keeps the retained join valid — the corpus
// was spliced in place — so a reproject re-derives the view with the new scores, no
// re-join, any tier, mid-stream. A structural edit (replaced) shifts the join → re-run.
// Riding the ack (not pre-edit state) reprojects even a run that settled in the FIFO gap.
function refreshAfterEdit(refreshFn, ackPromise) {
  if (!refreshFn) return;
  ackPromise.then(ack => {
    if (ack?.replaced === false) { reprojectMergedScroller(true); return; }
    refreshFn();
  });
}

export async function saveEntry(mode, clicked, { raw, score, comment }, refreshFn) {
  const edits = getEditsWordlist();
  if ((mode === 'edit' || mode === 'rescore') && clicked && noEditChange(clicked, raw, score, comment)) { refreshFn?.(); return; }

  // Hold the barrier from here — a walk/related-click opens the next panel while this
  // save is still awaiting its plan, and that panel's corpus reads must land behind
  // our editEntry (see pipeline-worker.js § Pending-edit barrier).
  beginPendingEdit();
  try {
    // Adopt deliberately writes values equal to the winner, so it must stay out of
    // the no-op guard above; it plans through the edit branch.
    const planMode = mode === 'adopt' || mode === 'rescore' ? 'edit' : mode;
    const plan = await planForSave({ mode: planMode, clicked, typed: { raw, score, comment }, trashScore: getTrashScore() });
    if (!plan || plan.blockedReason || (!plan.deletes.length && !plan.upserts.length)) { refreshFn?.(); return; }

    const writes = { deletes: plan.deletes, upserts: plan.upserts, primary: plan.primary };
    let inverse;
    applyEditsChange(edits, () => { inverse = applyEditsWriteSet(edits.rawEntries, writes); });
    if (clicked) getEntriesScroller()?.renameInSelection({ norm: clicked.norm, display: clicked.display ?? null }, plan.primary);
    const ack = sendEditEntry(writes).then(a => { applyConfigAck(a); return a; });
    persistEditsMetaOnly(edits);
    refreshAfterEdit(refreshFn, ack);

    const msg = mode === 'rescore' ? `Rescored ${esc(raw)} to ${score}` : undoToastMessage(mode, plan, clicked);
    if (msg) {
      const undoWrites = { deletes: inverse.deletes, upserts: inverse.upserts, primary: plan.primary };
      showUndoToast(msg, () => {
        applyEditsChange(edits, () => applyEditsWriteSet(edits.rawEntries, undoWrites));
        if (clicked) getEntriesScroller()?.renameInSelection(plan.primary, { norm: clicked.norm, display: clicked.display ?? null });
        const undoAck = sendEditEntry(undoWrites).then(a => { applyConfigAck(a); return a; });
        persistEditsMetaOnly(edits);
        refreshAfterEdit(refreshFn, undoAck);
      });
    }
  } finally {
    endPendingEdit();
  }
}

function noEditChange(clicked, raw, score, comment) {
  return clicked.norm === toNorm(raw)
    && (clicked.display ?? clicked.norm) === raw
    && clicked.score === score
    && (clicked.comment ?? '') === comment;
}

function undoToastMessage(mode, plan, clicked) {
  if (mode === 'edit' && plan.deletes.length) return `Renamed ${esc(clicked.display ?? clicked.norm)} → ${esc(displayOf(plan.primary))}`;
  if (mode === 'create' && plan.notes.length) return `Added ${esc(displayOf(plan.primary))}`;
  if (mode === 'adopt') return plan.deletes.length
    ? `Updated ${esc(displayOf(plan.primary))} in My Edits`
    : `Added ${esc(displayOf(plan.primary))} to My Edits`;
  return null;
}

// Plain concatenation is safe only because a pure rescore renames nothing, so it adds
// no keep-copy/downscore siblings and distinct atoms never collide on (norm, display).
// `primary` is null (no single batch focus); the worker ignores it — see editEntry.
function mergeWriteSets(plans) {
  const deletes = [], upserts = [];
  for (const p of plans) { deletes.push(...p.deletes); upserts.push(...p.upserts); }
  return { deletes, upserts, primary: null };
}

async function batchRescore(targets, score, refreshFn) {
  const edits = getEditsWordlist();
  if (!edits || !targets.length) { refreshFn?.(); return; }
  beginPendingEdit();
  try {
    const plans = (await Promise.all(targets.map(t =>
      planForSave({ mode: 'edit', clicked: t.clicked, typed: { raw: t.raw, score, comment: t.comment }, trashScore: getTrashScore() })
    ))).filter(p => p && !p.blockedReason && (p.deletes.length || p.upserts.length));
    if (!plans.length) { refreshFn?.(); return; }

    const writes = mergeWriteSets(plans);
    let inverse;
    applyEditsChange(edits, () => { inverse = applyEditsWriteSet(edits.rawEntries, writes); });
    const ack = sendEditEntry(writes).then(a => { applyConfigAck(a); return a; });
    persistEditsMetaOnly(edits);
    refreshAfterEdit(refreshFn, ack);

    const first = esc(displayOf(plans[0].primary));
    const msg = plans.length === 1
      ? `Rescored ${first} to ${score}`
      : `Rescored ${first} and ${pluralize(plans.length - 1, 'other')} to ${score}`;
    showUndoToast(msg, () => {
      const undoWrites = { deletes: inverse.deletes, upserts: inverse.upserts, primary: null };
      applyEditsChange(edits, () => applyEditsWriteSet(edits.rawEntries, undoWrites));
      const undoAck = sendEditEntry(undoWrites).then(a => { applyConfigAck(a); return a; });
      persistEditsMetaOnly(edits);
      refreshAfterEdit(refreshFn, undoAck);
    });
  } finally {
    endPendingEdit();
  }
}

// Refreshes directly, not via refreshAfterEdit: a delete is always structural, and
// refreshAfterEdit's reproject branch would leave the deleted rows on screen.
async function batchDelete(targets, refreshFn) {
  const edits = getEditsWordlist();
  if (!edits || !targets.length) { refreshFn?.(); return; }
  const deletes = targets
    .filter(t => edits.rawEntries.some(e => e.norm === t.norm && displayOf(e) === t.display))
    .map(t => ({ norm: t.norm, display: t.display }));
  if (!deletes.length) { refreshFn?.(); return; }

  const writes = { deletes, upserts: [], primary: null };
  let inverse;
  applyEditsChange(edits, () => { inverse = applyEditsWriteSet(edits.rawEntries, writes); });
  sendEditEntry(writes).then(applyConfigAck);
  persistEditsMetaOnly(edits);
  refreshFn?.();

  showUndoToast(`Deleted ${pluralize(deletes.length, 'entry', 'entries')} from ${buildWordlistNameHTML(edits)}`, () => {
    const undoWrites = { deletes: inverse.deletes, upserts: inverse.upserts, primary: null };
    applyEditsChange(edits, () => applyEditsWriteSet(edits.rawEntries, undoWrites));
    sendEditEntry(undoWrites).then(applyConfigAck);
    persistEditsMetaOnly(edits);
    refreshFn?.();
  });
}

// ─── Fetch, import & update ───────────────────────────────────────────────────

// loadIdle() resolves when no fetch/import is in flight — the awaitable callers
// use to wait for a load, instead of gating on a side-effect like the `populated`
// flag flipping (which couples them to when the flag is set; a boot reorder broke
// a test that way). Only the test bridge consumes it today.
let _loadsInFlight = 0;
const _loadIdleWaiters = [];
function loadStarted() { _loadsInFlight++; }
function loadSettled() {
  if (--_loadsInFlight <= 0) { _loadsInFlight = 0; _loadIdleWaiters.splice(0).forEach(resolve => resolve()); }
}
export function loadIdle() {
  return _loadsInFlight === 0 ? Promise.resolve() : new Promise(resolve => _loadIdleWaiters.push(resolve));
}

export async function applyWordlistText(wordlist, text, { fetchedSize = null, originalFilename = null, nameOverride = null, source = null, clearUrl = false, silent = false, viaToast = false } = {}) {
  const isEdits = wordlist.type === 'edits';
  const parsed = parseWordlist(text);   // transient for a non-Edits source; only My Edits retains it
  // The worker keys its merge on each source's enabled flag + rescore rules. A change
  // to either (a first population flips enabled; an auto-seed adds rules) makes the
  // worker's resident copy stale, so the content-diff can't apply — fall back to the
  // full resync below. wasEmpty is no longer a main-side signal: the worker holds the
  // old entries, handles empty→full via its rebuild path, and reports it on the ack.
  const wasEnabled = wordlist.enabled;
  const beforeRules = JSON.stringify(wordlist.rescoreRules ?? []);

  // Invalidate first, then mutate — so signal writes (name/url) don't fire the
  // cosmetic effect against still-stale caches mid-flight. batchUpdate coalesces
  // the writes + deferred persistMeta; no cacheVersion$ bump — the applyFetched
  // diff + repaint below stand in for the render effect's full resync.
  batchUpdate(() => {
    invalidateWordlistCaches(wordlist);
    if (isEdits) wordlist.rawEntries = parsed;   // only My Edits retains its entries on main
    wordlist.lastUpdated = Date.now();
    if (fetchedSize !== null) { wordlist.fetchedSize = fetchedSize; wordlist._updateAvailable = false; }
    if (originalFilename !== null) wordlist.originalFilename = originalFilename;
    if (!wordlist.populated) { wordlist.populated = true; wordlist.enabled = true; }
    maybeAutoSeedRescoreRules(wordlist, parsed);
    if (isEdits) reconcileEditsRulesAfterImport(wordlist);
    compileRescoreRules(wordlist);
    if (nameOverride) wordlist.name = nameOverride;
    if (clearUrl) { wordlist.url = null; wordlist.fetchedSize = null; wordlist._updateAvailable = false; }
    persistMeta();
  });

  await Storage.writeWordlist(wordlist, text);
  if (isEdits) EditsSync.scheduleWrite();
  else         MirrorSync.schedule(wordlist);

  const configChanged = wordlist.enabled !== wasEnabled
    || JSON.stringify(wordlist.rescoreRules ?? []) !== beforeRules;
  // applyFetched splices the changed norms in place AND ships wasEmpty + the
  // entry-level diff (the worker holds the old entries; main no longer does). A
  // config change, or a worker with no build for this source yet (applied:false),
  // falls back to the resync — which must run AFTER the IDB write so it reads new text.
  const ack = configChanged ? null : await sendApplyFetched(wordlist.dbKey, text, viaToast);
  if (ack?.applied) applyConfigAck(ack);
  else              resyncWorkerConfig();
  repaintAfterConfigChange();

  // refresh-on-consent: a background auto-update never yanks the result. A flat structural
  // change repatches in place (worker re-derives the join, no chip); a combination-tier
  // structural change is held behind the refresh chip (pinned); score-only changes
  // reproject live. A user-initiated fetch/import re-runs.
  if (!ack?.applied || !viaToast) {
    refreshMergedScroller();
  } else if (ack.repatch) {
    repatchMergedScroller();
  } else {
    if (ack.stale) setResultsStale(true);
    if (ack.mode === 'splice' && (ack.addedCount || ack.deletedCount || ack.rescoredCount)) reprojectMergedScroller(true);
  }

  // The applyFetched path reads wasEmpty/counts off the ack — the worker is the only
  // holder of the old entries now; the resync path counts the transient parse.
  if (!ack?.applied) {
    if (!silent) showToast(`Loaded ${pluralize(parsed.length, 'entry', 'entries')} from ${esc(source)}`);
  } else if (ack.wasEmpty) {
    if (!silent) showToast(`Loaded ${pluralize(ack.newCount, 'entry', 'entries')} from ${esc(source)}`);
  } else {
    const { addedCount, deletedCount, rescoredCount } = ack;
    if (!addedCount && !deletedCount && !rescoredCount) {
      if (!silent && !viaToast) showAlert(`${buildWordlistNameHTML(wordlist)} is already up to date — no changes.`);
    } else if (viaToast) {
      const parts = [];
      if (addedCount)    parts.push(`${addedCount.toLocaleString()} added`);
      if (deletedCount)  parts.push(`${deletedCount.toLocaleString()} deleted`);
      if (rescoredCount) parts.push(`${rescoredCount.toLocaleString()} rescored`);
      showActionToast(
        `${esc(wordlist.name)} auto-updated: ${parts.join(', ')}`,
        'Details',
        () => openUpdateSummaryDialog(wordlist, ack),
        () => sendFreeDiff(ack.diffId),
      );
    } else {
      openUpdateSummaryDialog(wordlist, ack);
    }
  }
}

// Reveal is timer-driven, not progress-driven: a fully stalled fetch produces
// zero chunks to bump on, so only a wall-clock timer surfaces it — and that
// stall is the case this whole indicator exists to show.
let _fetchRevealDelay = 5000;
export function setFetchRevealDelayForTest(ms) { _fetchRevealDelay = ms; }
const FETCH_PROGRESS_THROTTLE = 150;  // ms between progress repaints

export async function fetchWordlist(wordlist, event, { silent = false, viaToast = false, immediate = !silent } = {}) {
  if (event) event.stopPropagation();
  if (!wordlist || !wordlist.url || wordlist._loading) return;

  wordlist._loading = true;
  renderSources();
  loadStarted();

  // A user-initiated fetch reveals at once; only the silent background fetches
  // (boot, auto-update) wait out the threshold, so quick ones stay invisible.
  const handle = { key: wordlist.dbKey, wordlist, bytesLoaded: 0, revealed: immediate };
  putFetchHandle(handle);
  const revealTimer = immediate ? null : setTimeout(() => {
    handle.revealed = true; bumpFetchStatus();
  }, _fetchRevealDelay);

  try {
    const resp = await fetch(wordlist.url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const text = await readBodyWithProgress(resp, handle);
    const fetchedSize = resp.headers.get('content-length') || null;
    const originalFilename = new URL(wordlist.url).pathname.split('/').pop() || null;
    clearTimeout(revealTimer);
    dropFetchHandle(handle.key);
    wordlist._loading = false;
    await applyWordlistText(wordlist, text, { fetchedSize, originalFilename, source: wordlist.url, silent, viaToast });
  } catch (err) {
    clearTimeout(revealTimer);
    dropFetchHandle(handle.key);
    wordlist._loading = false;
    renderSources();
    const detail = err.message === 'Failed to fetch' ? '' : `: ${err.message}`;
    showActionToast(`Couldn't load ${esc(wordlist.name)}${esc(detail)}`, 'Retry', () => fetchWordlist(wordlist));
  } finally {
    loadSettled();
  }
}

async function readBodyWithProgress(resp, handle) {
  if (!resp.body) return resp.text();   // no readable stream: no progress, but still load
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  let lastPaint = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    handle.bytesLoaded = received;
    const now = Date.now();
    if (now - lastPaint > FETCH_PROGRESS_THROTTLE) { lastPaint = now; bumpFetchStatus(); }
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return new TextDecoder().decode(buf);
}

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

export function getAutoUpdate() { return lsLoad('autoUpdate') !== 'off'; }

export async function checkForUpdates() {
  // A null shipped total means "not yet known" (selfReady pending, or a build that
  // failed), NOT "empty" — requiring total > 0 there would silently exclude a
  // populated source from update checks indefinitely, so fall back to `populated`.
  const candidates = state.sources.filter(l => {
    if (!l.url || !l.fetchedSize) return false;
    const total = sourceTotal(l);
    return total == null ? l.populated : total > 0;
  });
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
}

export function importToWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  ImportGuideDialog.open(wordlist);
}

export function ingestFile(file, wordlist, nameOverride) {
  loadStarted();
  const reader = new FileReader();
  reader.onerror = () => { showToast('Error reading file'); loadSettled(); };
  reader.onabort = () => { showToast('File read cancelled'); loadSettled(); };
  reader.onload = e => ingestText(e.target.result, file, wordlist, nameOverride).finally(loadSettled);
  reader.readAsText(file);
}

async function ingestText(text, file, wordlist, nameOverride) {
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
    DiscoveryBanner.dismissMyEdits();
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

  if (wordlist.type === 'edits') DiscoveryBanner.dismissMyEdits();
  await applyWordlistText(wordlist, text, { originalFilename: file.name, nameOverride, source: file.name });
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
  sendDeleteEntry({ norm, display }).then(applyConfigAck);
  persistEditsMetaOnly(edits);
  refresh();

  showUndoToast(`Deleted ${esc(displayOf(deleted))} from ${buildWordlistNameHTML(edits)}`, () => {
    applyEditsChange(edits, () => { edits.rawEntries.splice(idx, 0, deleted); });
    sendEditEntry({
      deletes: [],
      upserts: [{ norm, display: deleted.display ?? null, score: deleted.score, comment: deleted.comment ?? '' }],
      primary: { norm, display: displayOf(deleted) },
    }).then(applyConfigAck);
    persistEditsMetaOnly(edits);
    refresh();
  });
}

export async function deleteWordlist(wordlist, event) {
  if (event) event.stopPropagation();
  if (!wordlist) return false;
  if (!await showConfirm('', { confirmText: 'Delete', html: `Delete ${buildWordlistNameHTML(wordlist)}?` })) return false;
  // Invalidate first so any reactive subscribers re-rendering on the
  // `state.sources` change below don't read a stale merged cache.
  invalidateWordlistCaches(wordlist);
  state.sources = state.sources.filter(l => l !== wordlist);
  await detachSync(wordlist);
  await Storage.deleteWordlist(wordlist);
  persistMeta();
  if (state.selected === wordlist) await setScope(MERGED_ID);
  renderAll();
  return true;
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

function syncHelp() {
  if (location.hash === '#/help') HelpDialog.open();
  else if (HelpDialog.isOpen()) HelpDialog.close();
}

export function bindEvents() {
  // Header chrome
  document.querySelector('.header-logo-link').href = location.pathname;
  document.getElementById('btn-settings').onclick = () => SettingsDialog.open();
  document.getElementById('btn-help').onclick = () => { location.hash = '/help'; };
  window.addEventListener('hashchange', syncHelp);
  document.getElementById('add-fab').onclick = openCreateEntry;

  ToolStack.init();

  document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    let handled = true;
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (digit) {
      handled = handleScoreDigitShortcut(parseInt(digit[1], 10));
    } else switch (e.code) {
      case 'KeyM': cycleDarkMode();          break;
      case 'KeyS': focusPermanentSearch();   break;
      case 'KeyW': toggleMatchMode();        break;
      case 'KeyC': focusScoreRange();        break;
      case 'KeyA': openCreateEntry();        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });
}

function openCreateEntry() {
  // Already up: don't re-open, which would discard what's being typed.
  if (EntryPanel.isOpen()) return;
  EntryPanel.openForCreate(newEntrySeedQuery(), getEntriesScroller());
}

function focusPermanentSearch() {
  const input = document.querySelector('#app input[data-row="bar"][data-key="pattern"]');
  if (input) { input.focus(); input.select(); }
}

function focusScoreRange() {
  const input = document.getElementById('score-range-input');
  if (input) { input.focus(); input.select(); }
}

function toggleMatchMode() {
  const row = document.activeElement?.closest('.tool-row, .search-bar');
  let cb = row?.querySelector('.tool-row-match input[type="checkbox"]');
  if (!cb) cb = document.querySelector('#app .search-bar .tool-row-match input[type="checkbox"]');
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
  refreshDerivedDisplays();
}

// The detail panel's stats bar is deliberately not repainted here — every
// caller also runs a scroller filter pass, and its onFilterChange callback
// repaints the bar.
export function refreshDerivedDisplays() {
  WordlistSelector.refreshMeta();
  renderScoringRules();
}

// The merged download has no main-side fallback, so never save empty: a retry reply
// (merge mid-rebuild) waits and re-asks a bounded number of times; a null reply (dead
// worker) gives up at once. Returns text, or null for the caller to toast on.
const MERGED_DOWNLOAD_RETRIES = 6;
const MERGED_DOWNLOAD_RETRY_MS = 300;
async function fetchMergedSerialize() {
  for (let attempt = 0; attempt < MERGED_DOWNLOAD_RETRIES; attempt++) {
    const res = await fetchWorkerSerialize(MERGED_ID, getOutputFormat());
    if (res == null) return null;
    if (res.text != null) return res.text;
    await new Promise(r => setTimeout(r, MERGED_DOWNLOAD_RETRY_MS));
  }
  return null;
}

export async function downloadMergedWordlistFromPanel() {
  const text = await fetchMergedSerialize();
  if (text == null) { showToast('The merged list is still preparing. Try again in a moment.'); return; }
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
  if (!wordlist || !sourceTotal(wordlist)) return;
  // The worker serialize is primary; on a miss (retry/timeout) the fallback re-reads the
  // IDB text for a non-Edits source (no resident rawEntries) — else a miss downloads empty.
  let text = (await fetchWorkerSerialize(wordlist.dbKey, getOutputFormat()))?.text;
  if (text == null) {
    const entries = wordlist.type === 'edits'
      ? getRescoredEntries(wordlist)
      : applyRescoring(parseWordlist(await Storage.readWordlist(wordlist) ?? ''), wordlist.rescoreRules || []);
    text = serializeEntries(entries, getOutputFormat());
  }
  triggerDownload(text, rescoredFilename(wordlist));
  showToast(`Downloaded ${pluralize(sourceTotal(wordlist), 'entry', 'entries')}`);
}

export async function downloadOriginalWordlist(wordlist) {
  if (!wordlist || !sourceTotal(wordlist)) return;
  // Serve the imported file verbatim from IndexedDB — reconstructing from parsed
  // wlEntries would lose the comment formatting, line endings, and ordering the
  // user's file had, none of which round-trip through serializeEntries.
  const text = await Storage.readWordlist(wordlist);
  if (!text) { showToast('Original file not available'); return; }
  triggerDownload(text, `${sanitizeFilenameStem(wordlist.name)}.txt`);
  showToast(`Downloaded ${pluralize(sourceTotal(wordlist), 'entry', 'entries')}`);
}

// ─── Export ──────────────────────────────────────────────────────────
// See docs/design.md § Entries-table export.

export function buildExportMenuHTML() {
  const caret = `<svg class="more-menu-caret" aria-hidden="true" viewBox="0 0 8 5"><use href="#icon-arrow"/></svg>`;
  const share = `<div class="split-btn">` +
    `<button class="more-menu-btn more-menu-labeled" onclick="openCopyPopover(event)" title="Share results" aria-haspopup="dialog">Share${caret}</button>` +
    `</div>`;
  return share +
  buildMoreMenuHTML([
    ['Results as wordlist', 'exportWordlist()'],
    ['Results as CSV',      'exportCSV()'],
    ['Results as JSON',     'exportJSON()'],
  ], { label: 'Export', title: 'Export results' });
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

// A tuple row is one result; summing its lanes over-counts by the tuple arity
// (the Umiaq ×4 bug this fixes).
export function exportCountPhrase(rows, tier) {
  if (tier === 'tuple') return pluralize(rows.length, 'result', 'results');
  if (tier === 'group') {
    let n = 0;
    for (const g of rows) n += g.chains.length;
    return pluralize(n, 'entry', 'entries');
  }
  return pluralize(rows.length, 'entry', 'entries');
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
    if (row.inverted()) entry.invert = true;
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
  const list = AppView.sortList;
  const out = { by: list[0].key, dir: list[0].dir };
  if (list.length > 1) out.levels = list.map(s => ({ by: s.key, dir: s.dir }));
  return out;
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
    parts.push(exportFilenameSegment(row.reversed() ? row.def.reverseSlug : row.tool));
    if (row.grouped) parts.push('all');
    if (row.inverted()) parts.push('not');
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
    const shown = displayOf(wlE).toUpperCase();
    const piece = `${wlE.norm.length} ${shown}`;
    parts.push(atom.glyph ? `${atom.glyph} ${piece}` : piece);
    prevNorm = wlE.norm;
  }
  return parts.join(' ');
}

// Backtick the params: a wildcard like `*EARNING` would otherwise trigger
// italic-on-rest-of-line in markdown renderers that parse formatting inside
// link text — a silent breakage in Discord/GitHub, invisible in plain text.
export function buildCopyLinkMarkdown(stack) {
  const url = location.href;
  const labels = [];
  stack.forEach((row, i) => {
    const isBar = i === stack.length - 1 && row.tool === 'search';
    if (isBar && row.isInert()) return;
    let label = row.reversed() ? row.def.reverseName : row.def.name;
    const firstParam = row.def.params.find(p => row.params[p.key] && p.type !== 'checkbox');
    if (firstParam) {
      const v = row.params[firstParam.key];
      label += firstParam.type === 'number' ? ` ${v}` : ' `' + v + '`';
    }
    if (row.grouped) label = '✱ ' + label;
    if (row.inverted()) label = '🚫 ' + label;
    labels.push(label);
  });
  const desc = labels.length ? labels.join(' → ') : MERGED_NAME;
  return `[${desc}](${url})`;
}

export function buildCopyResults(rows, grouped) {
  const body = [];
  if (grouped) {
    for (const g of rows) body.push(g.chains.map(chainCopyText).join(', '));
  } else {
    body.push(...flatCopyLines(rows));
  }
  return body.join('\n');
}

export function flatCopyLines(chains) {
  const piecesPerChain = chains.map(chain => {
    const pieces = [];
    let prevNorm = null;
    for (const atom of chain.atoms) {
      const wlE = atom.wlEntry;
      if (wlE.norm === prevNorm) continue;
      const shown = displayOf(wlE).toUpperCase();
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

// ── Copy popover ──
// See docs/design.md § Copy to clipboard.

const COPY_PREVIEW_ROWS = 6;

function capLines(text, visible, total = null) {
  const lines = text ? text.split('\n') : [];
  const n = total ?? lines.length;
  if (n <= visible) return lines.slice(0, visible).join('\n');
  const shown = lines.slice(0, visible - 1);
  shown.push(`+${(n - shown.length).toLocaleString()} more`);
  return shown.join('\n');
}

function buildCopyPopoverHTML() {
  const row = (kind, labelText, fieldHTML) =>
    `<div class="copy-row">` +
      `<div class="dialog-row-label copy-row-label" data-label="${kind}">${labelText}</div>` +
      `<div class="copy-row-field">${fieldHTML}` +
        `<button type="button" class="copy-row-btn" data-copy="${kind}">Copy</button>` +
      `</div>` +
    `</div>`;
  const input = (kind, aria) => `<input class="copy-field" type="text" data-field="${kind}" readonly aria-label="${aria}">`;
  return (
    row('mdlink', 'Markdown link', input('mdlink', 'Markdown link')) +
    row('link',   'Plain link',    input('link', 'Plain link')) +
    row('results', 'Results', `<textarea class="copy-field copy-results" data-field="results" rows="6" wrap="off" readonly aria-label="Results"></textarea>`)
  );
}

export const openCopyPopover = (() => {
  let el, anchor, isOpen = false, seq = 0;

  function ensure() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'copy-popover';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Share results');
    el.tabIndex = -1;
    el.innerHTML = buildCopyPopoverHTML();
    el.addEventListener('click', onCopyClick);
    document.body.appendChild(el);
  }

  const fieldEl = kind => el.querySelector(`[data-field="${kind}"]`);

  async function onCopyClick(e) {
    const btn = e.target.closest('.copy-row-btn');
    if (!btn) return;
    const kind = btn.dataset.copy;
    let text, toast;
    if (kind === 'results') {
      const scroller = getEntriesScroller();
      const rows = scroller ? await scroller.exportRows() : [];
      text = buildCopyResults(rows, scroller ? isMultiLaneTier(scroller.sortTier) : false);
      toast = `Copied ${exportCountPhrase(rows, scroller?.sortTier)}`;
    } else if (kind === 'mdlink') { text = fieldEl(kind).value; toast = 'Markdown link copied'; }
    else                         { text = fieldEl(kind).value; toast = 'Link copied'; }
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      showToast('Copy failed — clipboard permission denied');
      return;
    }
    showToast(toast);
  }

  function reposition() { if (isOpen) positionPopover(el, anchor, { placement: 'below', align: 'right', offset: 6 }); }

  const onDocClick = e => { if (isOpen && !el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKeyDown  = e => { if (isOpen && e.key === 'Escape') { close(); anchor.focus(); } };

  function show() {
    isOpen = true;
    // Capture phase: a split menu's toggle stops the click from bubbling, so a
    // bubble-phase dismiss would silently miss it and leave this popover open.
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    el.classList.add('open');
  }

  function close() {
    isOpen = false;
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    el.classList.remove('open');
  }

  async function fill(mySeq) {
    fieldEl('mdlink').value = buildCopyLinkMarkdown(ToolStack.getStack());
    fieldEl('link').value = location.href;
    fieldEl('results').value = '…';
    const scroller = getEntriesScroller();
    if (!scroller) { fieldEl('results').value = ''; return; }
    const grouped = isMultiLaneTier(scroller.sortTier);
    const total = scroller.resultRowCount();
    const rows = await scroller.exportPreviewRows(COPY_PREVIEW_ROWS);
    if (mySeq !== seq) return;   // superseded by a reopen
    fieldEl('results').value = capLines(buildCopyResults(rows, grouped), COPY_PREVIEW_ROWS, total);
    reposition();   // preview height changed
  }

  return function openCopyPopover(event) {
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (isOpen && anchor === trigger) { close(); return; }
    document.querySelectorAll('.split-btn.open').forEach(b => b.classList.remove('open'));
    ensure();
    anchor = trigger;
    fill(++seq);
    show();
    reposition();
  };
})();

// ── Wordlist ──

export function buildWordlistText(rows, grouped, fmt = AS_IS_FORMAT) {
  const best = new Map();
  let skipped = 0;
  for (const { chain } of iterDisplayChains(rows, grouped)) {
    const content = chainContentEntries(chain);
    if (!content.length) continue;
    const tail = content[content.length - 1];
    if (formatEntryText(tail, fmt).includes(';')) { skipped++; continue; }
    let chainMin = Infinity;
    for (const wlE of content) if (wlE.score < chainMin) chainMin = wlE.score;
    const key = displayOf(tail);
    const cur = best.get(key);
    if (cur === undefined || chainMin > cur.score) best.set(key, { ...tail, score: chainMin });
  }
  const text = serializeEntries([...best.values()], fmt);
  return { text, count: text.split('\n').length - 1, skipped };
}

export async function exportWordlist() {
  const scroller = getEntriesScroller();
  if (!scroller) return;
  const grouped = isMultiLaneTier(scroller.sortTier);
  const { text, count, skipped } = buildWordlistText(await scroller.exportRows(), grouped, getOutputFormat());
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

// A solution reads across (entry_1 beside entry_2), so a tuple gets its own shape:
// one row per tuple with the lanes spread into columns, not the grouped shape's
// one-row-per-member.
export function buildTupleCSV(rows, fmt = AS_IS_FORMAT) {
  const laneCount = rows[0]?.chains.length ?? 0;
  const header = [];
  for (let i = 1; i <= laneCount; i++) header.push(`entry_${i}`, `length_${i}`, `score_${i}`, `comment_${i}`, `source_${i}`);
  const out = [csvRow(header)];
  for (const tuple of rows) {
    const cells = [];
    for (const lane of tuple.chains) {
      const wlE = chainContentEntries(lane)[0];
      if (!wlE) cells.push('', '', '', '', '');
      else cells.push(formatEntryText(wlE, fmt), wlE.norm.length, wlE.score, wlE.comment || '', wlE.wordlist?.name ?? '');
    }
    out.push(csvRow(cells));
  }
  return out.join('\r\n') + '\r\n';
}

export function buildCSVText(rows, grouped, stack, tuple = false, fmt = AS_IS_FORMAT) {
  if (tuple) return buildTupleCSV(rows, fmt);
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
        cells.push(formatEntryText(wlE, fmt), wlE.norm.length, wlE.score);
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
  const grouped = isMultiLaneTier(scroller.sortTier);
  const rows = await scroller.exportRows();
  const text = buildCSVText(rows, grouped, ToolStack.getStack(), scroller.sortTier === 'tuple', getOutputFormat());
  triggerDownload(text, exportFilename(ToolStack.getStack(), 'csv'));
  showToast(`Downloaded ${exportCountPhrase(rows, scroller.sortTier)}`);
}

// ── JSON ──

export function buildExportJSONObject(rows, grouped, stack, tuple = false) {
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

  if (tuple) {
    obj.tuples = rows.map(t => ({
      words: t.chains.map(lane => {
        const wlE = chainContentEntries(lane)[0];
        return wlE ? { entry: displayOf(wlE), score: wlE.score, comment: wlE.comment || '', source: wlE.wordlist?.name ?? null } : null;
      }),
    }));
    return obj;
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
  const grouped = isMultiLaneTier(scroller.sortTier);
  const rows = await scroller.exportRows();
  const obj = buildExportJSONObject(rows, grouped, ToolStack.getStack(), scroller.sortTier === 'tuple');
  triggerDownload(JSON.stringify(obj, null, 2) + '\n', exportFilename(ToolStack.getStack(), 'json'));
  showToast(`Downloaded ${exportCountPhrase(rows, scroller.sortTier)}`);
}
