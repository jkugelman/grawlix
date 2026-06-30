'use strict';

// ─── Test API ─────────────────────────────────────────────────────────────────
// Exposed on `window.__grawlixTest` for the Playwright smoke suite. Routes
// through real internal codepaths (applyWordlistText, setWordlistRescoreRules)
// so tests exercise the same plumbing the UI does. The surface is small and
// stable — adding to it is fine; renaming or repurposing existing helpers
// breaks the tests that depend on them.
//
// This is the one module that imports from every layer (core/engine/data/model/
// ui/app); main.js imports it last so every binding it references is already
// initialized. The `window.__grawlixTest` and `window._db` assignments are its
// one permitted import-time side effect — both are test-only.

import { MERGED_ID, MERGED_NAME } from './core/constants.js';
import { toNorm, displayOf, parseWordlist, buildUserWlEntry } from './engine/norm.js';
import { getTrashScore } from './data/serialize.js';
import { setUnigramCorpus as segmenterSetCorpus } from './engine/segmenter.js';
import { TOOLS, makeToolRow } from './engine/tools.js';
import { state, newDbKey, syncKey, getEditsWordlist } from './data/state.js';
import { getDb, Storage } from './data/storage.js';
import { migrateLs } from './data/migrations.js';
import {
  invalidateSourceCounts, getSourceCounts, mergedEntryCount, shippedConfigCountsVersion,
} from './data/merge.js';
import { setWordlistRescoreRules, setWordlistEnabled, reorderSources } from './data/persist.js';
import {
  syncTargets, syncFilename,
  attachMirrorSync, attachEditsSync, EditsSync, MirrorSync, loadSyncTargets,
  configureSyncDialogs,
} from './data/disk-sync.js';
import { threeWayMergeEdits } from './engine/edits-merge.js';
import { migrateIdbRecords } from './data/migrations.js';
import { WordlistSelector } from './ui/scope-selector.js';
import { HelpDialog } from './ui/dialogs/help.js';
import { openUpdateSummaryDialog } from './ui/dialogs/update-summary.js';
import { ToolStack, pipelineIdle } from './ui/tool-stack.js';
import {
  pingWorker, runOnWorker, patchWorkerToolForTest, workerAssetStateForTest,
  pipelineWorkerState, crashWorkerForTest, forceWorkerCrashForTest, failNextWorkerBuildForTest,
  setWorkerYieldIntervalForTest, captureWorkerPartialsForTest, captureWorkerGroupPartialsForTest, captureWorkerChainPartialsForTest,
  syncWorkerConfig, dumpWorkerCorpus, queryWorkerEntry, fetchWorkerRows, fetchWorkerGroups, fetchWorkerGroupChains, fetchWorkerAllGroups, fetchWorkerAllRows, fetchWorkerAllTransformRows, lastCompletedRunId,
  workerOwnsCorpus, sendEditEntry, sendDeleteEntry,
  fetchWorkerProvenance, fetchWorkerEditPlan, syncConfigsSent, allRowsFetchesSent, allGroupsFetchesSent, serializeFetchesSent,
  lastFetchAppliedMode$, diffFetchesSent, fetchWorkerDiffRows,
} from './ui/pipeline-worker.js';
import { allSourcesHistogramLayout, shippedAllSourcesAxisVersion, shippedScopedLayoutScopeKey, scopedHistogramLayout } from './data/derived.js';
import { bucketCounts } from './engine/histogram.js';
import { computeStatsRaw } from './engine/stats.js';
import {
  getEntriesScroller, setScope, renderSources, renderMergedDetail, refreshMergedScroller,
} from './ui/rendering.js';
import { streamFlatBatchToScroller, windowedFlatDebug, workerSummariesDebug, workerGroupsDebug, workerGroupListDebug, existsInScopeDebug, entryPanelSeedDebug, entryPanelProvenanceDebug, rebindAnswersConsumedDebug, resetRebindAnswersConsumedForTest, groupWindowUnderfillDebug, resetGroupWindowUnderfillForTest } from './ui/entries-table.js';
import { applyScoringChange } from './ui/rescore-editor.js';
import { propagateDefaults as _propagateDefaults } from './model/scoring.js';
import {
  addNewWordlist, applyWordlistText, bakeRescoring, saveEdit, saveEntry, deleteFromEdits, persistEdits,
  buildCopyText, buildWordlistText, buildCSVText, buildExportJSONObject, exportFilename, _ready, loadIdle,
  setFetchRevealDelayForTest,
} from './app/actions.js';
import { serializeEntries, sortedEntries } from './engine/serialize.js';
import { isMultiLaneTier } from './engine/sort.js';

// The active scope's wire label — MERGED_ID for the merged view, else the scoped
// source's dbKey — matching what `run`/`queryEntry` send to the worker.
function activeScopeLabel() {
  return state.selected === MERGED_ID ? MERGED_ID : state.selected?.dbKey ?? MERGED_ID;
}

// A saveEdit seed from My Edits' own rawEntries (main keeps raw post-flip), in the
// {norm, display, score, comment} shape saveEdit expects. Null when absent.
function editsRawSeed(norm, display) {
  const edits = getEditsWordlist();
  const e = edits?.rawEntries.find(r =>
    r.norm === norm && (display === undefined || displayOf(r) === display));
  return e ? { norm: e.norm, display: e.display ?? null, score: e.score, comment: e.comment || '' } : null;
}

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
  async setRescoreRules(name, rules) {
    const wl = this._lookup(name);
    setWordlistRescoreRules(wl, rules);
    await this.syncWorkerConfig();
  },

  setScoring(rules) {
    state.scoring = rules;
    applyScoringChange();
  },

  propagateDefaults() { _propagateDefaults(); },

  async bakeRescoring(name) {
    const r = await bakeRescoring(this._lookup(name));
    await this.syncWorkerConfig();   // settle the worker resync (see setEnabled)
    return r;
  },

  // Real setter, not a bare wl.enabled write, so the cacheVersion$ bump fires.
  // The bump's worker resync is fire-and-forget; the seemingly-redundant await
  // settles it (latest config wins via supersession) so a following getMergedEntry
  // can't read the pre-toggle corpus. Dropping it reintroduces an intermittent flake.
  async setEnabled(name, enabled) {
    setWordlistEnabled(this._lookup(name), enabled);
    await this.syncWorkerConfig();
  },

  setUpdateAvailable(name, value) {
    const wl = this._lookup(name);
    wl._updateAvailable = !!value;
    renderSources();
    WordlistSelector.refresh();
  },

  // Reorder state.sources so `name` lands at `beforeName`'s position (and
  // `beforeName` shifts down). Routes through `reorderSources` so caches
  // invalidate the same way a drag does. Awaits the worker resync (see setEnabled)
  // so a following getMergedEntry can't read the pre-reorder corpus.
  async moveBefore(name, beforeName) {
    const fromIdx = state.sources.findIndex(w => w.name === name);
    const toIdx   = state.sources.findIndex(w => w.name === beforeName);
    if (fromIdx < 0) throw new Error(`No wordlist named "${name}"`);
    if (toIdx   < 0) throw new Error(`No wordlist named "${beforeName}"`);
    reorderSources(fromIdx, toIdx);
    await this.syncWorkerConfig();
  },

  // Read-only worker query for a single entry in the active scope (All Wordlists
  // by default, the scoped source after setScope). The sourcing wordlist is
  // user-observable via the row's entry panel and the `.atom-source` column (hidden
  // below 960px); exposing it here lets merge-correctness tests assert regardless
  // of viewport without driving the entry panel. Async — the worker owns the corpus.
  async getMergedEntry(entry, display) {
    const e = await queryWorkerEntry(activeScopeLabel(), toNorm(entry), display);
    if (!e) return null;
    const [norm, disp, score, , comment, sourceId] = e;
    const wl = state.sources.find(s => s.dbKey === sourceId);
    return { entry: norm, display: disp, score, comment: comment || '', wordlist: wl?.name ?? null };
  },

  // Pass a source name to scope, or 'All Wordlists'/nothing for the merged view.
  // Returns whether the scope changed — the scopeTo helper refreshes on a no-op.
  async setScope(name) {
    const target = !name || name === MERGED_NAME ? MERGED_ID : this._lookup(name);
    const changed = state.selected !== target;
    await setScope(target);
    return changed;
  },

  // Stable, comparable dump of the worker's merged corpus: entries as ordered
  // tuples plus per-source counts (sorted by name). Post-flip the worker owns the
  // merge, so an edit and a forced rebuild produce the same dump — the patch-
  // faithfulness the old main-cache version proved is now intrinsic to the worker.
  async dumpMergedCache() {
    await pipelineIdle();
    const { entries } = await dumpWorkerCorpus(MERGED_ID);
    const byKey = new Map(state.sources.map(s => [s.dbKey, s.name]));
    const counts = new Map();
    for (const [, , , , , sourceId] of entries) {
      counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
    }
    return {
      entries: entries.map(([norm, disp, score, , comment, sourceId]) =>
        [norm, disp, score, comment || '', byKey.get(sourceId)]),
      counts: [...counts].map(([sourceId, n]) => [byKey.get(sourceId), n]).sort((a, b) => a[0].localeCompare(b[0])),
    };
  },
  async rebuildMergedCache() {
    invalidateSourceCounts();
    await this.syncWorkerConfig();
    return this.dumpMergedCache();
  },

  // Drive a My Edits upsert/rename through the real saveEdit path without the
  // entry-panel DOM. origRaw === raw upserts; differing raw renames (a two-norm move).
  // Seeds orig from My Edits' own rawEntries (main keeps raw post-flip); a
  // not-yet-present entry gets a blank-score orig so saveEdit treats it as an add.
  async saveMyEdit(origRaw, raw, score, comment = '') {
    const orig = editsRawSeed(toNorm(origRaw)) ?? buildUserWlEntry(origRaw, '', '');
    await saveEdit(orig, { raw, score, comment });
    return refreshMergedScroller();
  },
  deleteMyEdit(raw) {
    const m = getEditsWordlist().rawEntries.find(e => e.norm === toNorm(raw));
    if (m) deleteFromEdits({ norm: m.norm, display: displayOf(m) }, refreshMergedScroller);
  },

  // Explicit-variant delete — targets one display of a multi-variant norm, like
  // the worker's deleteEntry.
  deleteMyEditFrom(target) {
    deleteFromEdits(target, refreshMergedScroller);
  },

  // saveEdit with an EXPLICIT orig (norm, display) — what the entry panel does for a
  // clicked row. orig === null is an add. Seeds from My Edits' rawEntries.
  async saveMyEditFrom(orig, raw, score, comment = '') {
    const origWlEntry = orig
      ? (editsRawSeed(orig.norm, orig.display) ?? { norm: orig.norm, display: orig.display, score: 0, comment: '' })
      : buildUserWlEntry(raw, '', '');
    await saveEdit(origWlEntry, { raw, score, comment });
    return refreshMergedScroller();
  },

  // The + button's create path — distinct from saveMyEditFrom's edit/rename.
  async createMyEntry(raw, score, comment = '') {
    await saveEntry('create', null, { raw, score, comment });
    return refreshMergedScroller();
  },

  pingWorker,
  patchWorkerToolForTest,
  pipelineWorkerState,
  crashWorkerForTest,
  forceWorkerCrashForTest,
  failNextWorkerBuildForTest,
  setWorkerYieldIntervalForTest,
  captureWorkerPartialsForTest,
  captureWorkerGroupPartialsForTest,
  captureWorkerChainPartialsForTest,
  fetchWorkerAllTransformRows,
  // Drive the streaming render with synthetic snapshot batches. No worker backs the
  // synthetic runId, so a row past `firstRows` can't be fetched and shows a skeleton
  // — each snapshot's firstRows must cover the visible window. `version` climbs per
  // snapshot. `scores`, when given, is the snapshot's CUMULATIVE survivor scores
  // (not a delta): the worker ships cumulative stats/histogram per snapshot, so this
  // stand-in computes them the same way against the live layout. Omit it for specs
  // that don't assert the stats bar.
  streamSyntheticBatch: (spec) => {
    const scores = spec.scores ? new Int32Array(spec.scores) : null;
    const layout = scopedHistogramLayout();
    streamFlatBatchToScroller({
      runId: spec.runId,
      version: spec.version ?? 1,
      windowStart: spec.windowStart ?? 0,
      total: spec.total,
      firstRows: spec.firstRows ?? null,
      widthHints: spec.widthHints,
      stats: scores ? computeStatsRaw(scores) : null,
      histogramCounts: scores ? bucketCounts(scores, layout) : null,
      histogramLayout: layout,
      filtered: spec.filtered ?? false,
    });
  },
  syncWorkerConfig: (sources = state.sources) => syncWorkerConfig(sources),
  dumpWorkerCorpus: (scope) => dumpWorkerCorpus(scope),
  fetchWorkerRows: (start, end, runId, timeout) =>
    fetchWorkerRows(runId ?? lastCompletedRunId(), start, end, timeout),
  fetchWorkerGroupChains: (groupKey, start, end, runId, timeout) =>
    fetchWorkerGroupChains(runId ?? lastCompletedRunId(), groupKey, start, end, timeout),
  fetchWorkerGroups: (start, end, runId, timeout) =>
    fetchWorkerGroups(runId ?? lastCompletedRunId(), start, end, timeout),
  fetchWorkerAllGroups: (runId, timeout) =>
    fetchWorkerAllGroups(runId ?? lastCompletedRunId(), timeout),
  // Mirror saveMyEditFrom's planner path (not a passthrough) so the worker
  // self-build and a main rebuild converge in the oracle specs.
  sendWorkerEditEntry: async (orig, next, timeout) => {
    const clicked = orig
      ? (editsRawSeed(orig.norm, orig.display) ?? { norm: orig.norm, display: orig.display, score: 0, comment: '' })
      : buildUserWlEntry(next.display, '', '');
    const plan = await fetchWorkerEditPlan({
      mode: 'edit', clicked,
      typed: { raw: next.display, score: next.score, comment: next.comment ?? '' },
      trashScore: getTrashScore(),
    });
    if (!plan) return null;
    return sendEditEntry({ deletes: plan.deletes, upserts: plan.upserts, primary: plan.primary }, timeout);
  },
  sendWorkerDeleteEntry: (target, timeout) => sendDeleteEntry(target, timeout),
  syncConfigsSent,
  lastCompletedRunId,
  // 'splice' | 'rebuild' | null — how the last applyFetched resolved (threshold path).
  lastFetchMode: () => lastFetchAppliedMode$(),
  allRowsFetchesSent,
  allGroupsFetchesSent,
  serializeFetchesSent,
  diffFetchesSent,
  fetchWorkerDiffRows: (diffId, section, start, end, timeout) => fetchWorkerDiffRows(diffId, section, start, end, timeout),
  updateDialogDiffId: () => openUpdateSummaryDialog.ownedDiffId(),
  openHelp: () => HelpDialog.open(),
  fetchWorkerProvenance: (typedRaw, previewRaw, clickedNorm, clickedDisplay, timeout) =>
    fetchWorkerProvenance(typedRaw, previewRaw, clickedNorm, clickedDisplay, timeout),

  // Post-flip there's no main corpus, so the oracle dumps the worker's corpus for
  // the requested scope. Kept as `dumpMainCorpus` so the specs comparing two dumps
  // (worker self-build vs this) read unchanged; both now come from the worker.
  async dumpMainCorpus(scope) {
    await pipelineIdle();
    const { entries } = await dumpWorkerCorpus(scope);
    return entries;
  },

  // saveEdit fires persistEdits un-awaited, so the worker (which reads
  // data_<dbKey> from IDB) can race a still-pending write; awaiting persistEdits
  // here flushes the same path deterministically before a dumpWorkerCorpus.
  async flushEditsToIdb() {
    const edits = getEditsWordlist();
    await persistEdits(edits);
    return edits.dbKey;
  },

  // The exact data_<dbKey> text persistEdits / the worker's write produces for My
  // Edits, for the byte-identical-write oracle.
  expectedEditsIdbText() {
    const edits = getEditsWordlist();
    return { dbKey: edits.dbKey, text: serializeEntries(sortedEntries(edits.rawEntries)) };
  },

  // Awaited like flushEditsToIdb: applyWordlistText's worker command (the
  // applyFetched diff, or a resync when the config changed) and IDB write have
  // settled by the time this resolves.
  async reimport(name, text) {
    const wl = this._lookup(name);
    await applyWordlistText(wl, text, { source: name, silent: true });
    await pipelineIdle();
    return wl.dbKey;
  },

  // Runs a stack on the worker and returns its survivor norms. Post-flip there's
  // no main corpus to compare against, so the caller asserts the worker norms
  // against an expected set. A flat result holds only positions, so its norms come
  // from the worker's own fetchAllRows.
  async workerMirrorsMain(stack) {
    await this.pipelineIdle();
    const rows = stack.map(r => makeToolRow(r.tool, r.params || {}, !!r.grouped));
    const result = await runOnWorker(rows);
    let workerNorms;
    if (result.flat) {
      const reply = await fetchWorkerAllRows(lastCompletedRunId());
      workerNorms = reply ? reply.rows.map(r => r.norm) : [];
    } else {
      workerNorms = result.rows.map(r => r.atoms[0].wlEntry.norm);
    }
    return { workerNorms };
  },

  setUnigramCorpus: segmenterSetCorpus,

  // Set the tool stack directly, bypassing gallery clicks. Routes
  // through the same path the URL parser uses (`ToolStack.setStack` +
  // `renderMergedDetail`), so tests exercise the executor with the
  // same plumbing the user does. Pass an array of `{tool, params}`.
  // Returns the render promise — tests `await` it before reading the DOM.
  workerAssetState: () => workerAssetStateForTest(),

  async setStack(stack) {
    ToolStack.setStack(stack.filter(r => TOOLS[r.tool]).map(r => makeToolRow(r.tool, r.params || {}, !!r.grouped)));
    const p = renderMergedDetail();
    ToolStack.refreshGalleryActive();
    await p;
  },

  // Drive a sort axis/direction change through the real scroller path — the
  // behavior specs that used the removed Sort-by control go through here so
  // they assert ordering, not the control. Awaits the resulting re-sort.
  async applySort(key, dir = 'asc') {
    getEntriesScroller()?.applySort(key, dir);
    await pipelineIdle();
  },

  // Resolves when no pipeline run is in flight. Tests use this after keystroke
  // interactions (which fire-and-forget the refresh) before reading the DOM.
  pipelineIdle() { return pipelineIdle(); },

  // Lets the scopeTo helper re-pull a no-op scope change off the settled worker.
  refreshScroller() { return refreshMergedScroller(); },

  // Resolves when no fetch/import is in flight. Tests await this for load
  // completion instead of polling the `populated` content-flag's transition.
  loadIdle() { return loadIdle(); },

  windowedFlatDebug,
  workerSummariesDebug,
  workerGroupsDebug,
  workerGroupListDebug,
  existsInScopeDebug,
  entryPanelSeedDebug,
  entryPanelProvenanceDebug,
  rebindAnswersConsumedDebug,
  resetRebindAnswersConsumedForTest,
  groupWindowUnderfillDebug,
  resetGroupWindowUnderfillForTest,

  workerOwnsCorpus,
  allSourcesHistogramLayout: () => allSourcesHistogramLayout(),
  shippedAllSourcesAxisVersion,
  shippedScopedLayoutScopeKey,

  // Flattened because getSourceCounts's wordlist refs don't survive the page boundary.
  sourceCounts: () => getSourceCounts().map(s => ({ dbKey: s.wordlist.dbKey, name: s.wordlist.name, count: s.count })),
  mergedEntryCount: () => mergedEntryCount(),
  shippedConfigCountsVersion,

  // Resolves when the windowed-flat scroller has no fetchRows in flight. A
  // fetchRows isn't a pipeline run, so pipelineIdle can't see it.
  windowIdle() { return getEntriesScroller()?.windowIdle() ?? Promise.resolve(); },

  // The scroller's live laid-out row count. Read mid-stream (NOT after
  // pipelineIdle, which would only ever see the settled count) to observe the climb.
  scrollerRowCount() { return getEntriesScroller()?._renderRowCount() ?? 0; },

  groupWindowIdle() { return getEntriesScroller()?.groupWindowIdle() ?? Promise.resolve(); },

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

  // Per visible entry-row: `{ text, marks }` where marks are the `<mark>`ed
  // (search-highlighted) substrings.
  async getVisibleRowMarks() {
    await pipelineIdle();
    return [...document.querySelectorAll('#vs-host .entry-row')].map(r => {
      const entryEl = r.querySelector('.atom-entry');
      return {
        text: (entryEl?.textContent || '').trim(),
        marks: [...r.querySelectorAll('.atom-entry .search-match')].map(m => m.textContent),
      };
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
      // Resident only for My Edits; a non-Edits source's rawEntries aren't held on
      // main — read its entries via the async dumpSourceEntries instead.
      entries: wl.rawEntries.map(e => ({ entry: e.norm, display: e.display, score: e.score, comment: e.comment || '' })),
      rescoreRules: wl.rescoreRules.map(r => ({ input: r.input, length: r.length || '', output: r.output })),
      dirty: !!wl.dirty,
      updateAvailable: !!wl._updateAvailable,
    };
  },

  // A source's entries as stored (raw scores), read from IDB — a non-Edits source's
  // rawEntries aren't resident on main. My Edits is resident, so read it directly.
  async dumpSourceEntries(name) {
    const wl = state.sources.find(w => w.name === name);
    if (!wl) return null;
    const entries = wl.type === 'edits' ? wl.rawEntries : parseWordlist(await Storage.readWordlist(wl) ?? '');
    return entries.map(e => ({ entry: e.norm, display: e.display, score: e.score, comment: e.comment || '' }));
  },

  async exportText(format) {
    await pipelineIdle();
    const scroller = getEntriesScroller();
    const rows = await scroller.exportRows();
    const grouped = isMultiLaneTier(scroller.sortTier);
    const tuple = scroller.sortTier === 'tuple';
    const stack = ToolStack.getStack();
    if (format === 'copy')     return buildCopyText(rows, grouped, stack);
    if (format === 'wordlist') return buildWordlistText(rows, grouped);
    if (format === 'csv')      return buildCSVText(rows, grouped, stack, tuple);
    if (format === 'json')     return buildExportJSONObject(rows, grouped, stack, tuple);
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
    setConflictResolver(choice) { configureSyncDialogs({ resolveConflict: async () => choice }); },
    trackConflict() {
      window.__conflictRaised = false;
      configureSyncDialogs({ resolveConflict: async () => { window.__conflictRaised = true; return 'device'; } });
    },
    scheduleEditsWrite() { return EditsSync.scheduleWrite(); },
    isSynced(name) { return syncTargets.has(syncKey(this._list(name))); },
    filename(name) { return syncFilename(syncKey(this._list(name))); },
    async flushWrites() {
      for (const [key, id] of [...MirrorSync._timers]) { clearTimeout(id); MirrorSync._timers.delete(key); await MirrorSync._flush(key); }
      if (EditsSync._writeTimer) { clearTimeout(EditsSync._writeTimer); EditsSync._writeTimer = null; await EditsSync._flushWrite(); }
    },
    flushMerged() { return MirrorSync._flush(MERGED_ID); },
    flushSource(name) { return MirrorSync._flush(syncKey(this._list(name))); },
    migrateIdbRecords(from) { return migrateIdbRecords(from); },
    loadTargets() { syncTargets.clear(); return loadSyncTargets(); },
    keyOf(name) { return syncKey(this._list(name)); },
    targetFor(name) { const t = syncTargets.get(syncKey(this._list(name))); return t ? { name: t.handle?.name } : null; },
  },

  _lookup(name) {
    const wl = state.sources.find(w => w.name === name);
    if (!wl) throw new Error(`No wordlist named "${name}"`);
    return wl;
  },

  setFetchRevealDelay(ms) { setFetchRevealDelayForTest(ms); },

  migrateLs,
};

window.__grawlixTest = __grawlixTest;

// `_db` is reassigned after openDB() resolves; a static copy would freeze at its
// boot-time null, so the suite (which polls `_db !== null`) needs a live read.
Object.defineProperty(window, '_db', { get: () => getDb(), configurable: true });
