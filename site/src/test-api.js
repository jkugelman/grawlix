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
import { setUnigramCorpus as segmenterSetCorpus } from './engine/segmenter.js';
import { TOOLS, makeToolRow } from './engine/tools.js';
import { state, newDbKey, syncKey, getEditsWordlist } from './data/state.js';
import { getDb, Storage } from './data/storage.js';
import { migrateSettings } from './data/migrations.js';
import {
  buildMergedWordlist, getActiveCorpus, mergeKey, invalidateSourceCounts, peekMergedCache,
} from './data/merge.js';
import { setWordlistRescoreRules, reorderSources } from './data/persist.js';
import {
  syncTargets, syncFilename, threeWayMergeEdits,
  attachMirrorSync, attachEditsSync, EditsSync, MirrorSync,
} from './data/disk-sync.js';
import { WordlistSelector } from './ui/scope-selector.js';
import { ToolStack, pipelineIdle } from './ui/tool-stack.js';
import { pingWorker } from './ui/pipeline-worker.js';
import {
  getEntriesScroller, setScope, renderSources, renderMergedDetail, refreshMergedScroller,
} from './ui/rendering.js';
import {
  addNewWordlist, applyWordlistText, bakeRescoring, saveEdit, deleteFromEdits,
  buildCopyText, buildWordlistText, buildCSVText, buildExportJSONObject, exportFilename, _ready,
} from './app/actions.js';

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

  pingWorker,

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

window.__grawlixTest = __grawlixTest;

// `_db` is reassigned after openDB() resolves; a static copy would freeze at its
// boot-time null, so the suite (which polls `_db !== null`) needs a live read.
Object.defineProperty(window, '_db', { get: () => getDb(), configurable: true });
