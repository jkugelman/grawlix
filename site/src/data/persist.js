'use strict';

// ─── Persistence ──────────────────────────────────────────────────────────────

import { runBatched } from '../core/signals.js';
import { Storage } from './storage.js';
import { state, bumpCacheVersion } from './state.js';
import { invalidateWordlistCaches } from './invalidate.js';
import { compileRescoreRules, updateWordlistDirty } from './rescoring.js';
import { MirrorSync } from './disk-sync.js';

function persistMeta() {
  if (_batchDepth > 0) { _persistPending = true; return; }
  _persistMetaNow();
}

function serializeMetaEntry(l) {
  return {
    ...(l.type ? { type: l.type } : {}),
    dbKey: l.dbKey,
    ...(l.icon ? { icon: l.icon } : {}),
    ...(l.publisherId ? { publisherId: l.publisherId } : {}),
    name: l.name, url: l.url || null,
    enabled: l.enabled, populated: l.populated, lastUpdated: l.lastUpdated || null,
    fetchedSize: l.fetchedSize || null,
    rescoreRules: l.rescoreRules || [],
    ...(l.dirty ? { dirty: true } : {}),
    originalFilename: l.originalFilename || null,
  };
}

function _persistMetaNow() {
  Storage.writeMeta(state.sources.map(serializeMetaEntry));
  MirrorSync.scheduleMerged();
}

function persistScoring() {
  Storage.writeScoring(state.scoring, state.scoringDirty);
}

// ─── Mutation helpers ─────────────────────────────────────────────────────────
//
// State mutations bundled with the right invalidation/persistence/cache bump,
// so call sites don't have to remember the sequence. Cosmetic changes write
// the signal and persist; the cosmetic effect handles repaint. Cache-affecting
// changes also call `repaintAfterCacheChange()` to bump `cacheVersion$` and
// let the render effect dispatch the right scroller update.
// `batchUpdate(fn)` coalesces multiple mutations: signal writes queue their
// subscribers, a single deferred `cacheVersion$` bump fires once at the end
// of the batch, and `persistMeta()` is deferred to one call at the end too.

let _batchDepth = 0;
let _cacheBumpPending = false;
let _persistPending = false;

function batchUpdate(fn) {
  // The persist/cache flush must run inside runBatched's fn, not after it, so it
  // lands before the signal queue drains — effects see the persisted/bumped state.
  runBatched(() => {
    _batchDepth++;
    try { fn(); }
    finally {
      _batchDepth--;
      if (_batchDepth === 0) {
        if (_persistPending) { _persistPending = false; _persistMetaNow(); }
        if (_cacheBumpPending) { _cacheBumpPending = false; bumpCacheVersion(); }
      }
    }
  });
}

function repaintAfterCacheChange() {
  if (_batchDepth > 0) { _cacheBumpPending = true; return; }
  bumpCacheVersion();
}

// Cosmetic setters: write the signal and persist. The cosmetic effect
// re-renders the list/dropdown/dialog and visible scroller rows; no explicit
// repaint call needed.
function setWordlistName(wordlist, name) {
  if (wordlist.name === name) return;
  wordlist.name = name;
  persistMeta();
}

function setWordlistIcon(wordlist, icon) {
  wordlist.icon = icon;
  persistMeta();
}

function setWordlistUrl(wordlist, url) {
  if ((wordlist.url ?? null) === (url ?? null)) return;
  wordlist.url = url;
  persistMeta();
}

function setWordlistPublisher(wordlist, publisherId) {
  const newVal = publisherId || null;
  if ((wordlist.publisherId ?? null) === newVal) return;
  wordlist.publisherId = newVal;
  // Defaults changed with the publisher — recompute dirty against the new
  // publisher's defaultRules (whether or not the caller is also updating
  // the rules in the same batchUpdate).
  updateWordlistDirty(wordlist);
  persistMeta();
}

// Cache-affecting setters: bump cacheVersion$ so the render effect refreshes
// derived state (merged cache, scroller).
function setWordlistEnabled(wordlist, enabled) {
  if (wordlist.enabled === enabled) return;
  wordlist.enabled = enabled;
  persistMeta();
  repaintAfterCacheChange();
}

function setWordlistRescoreRules(wordlist, rules) {
  wordlist.rescoreRules = rules;
  applyRescoreRulesChange(wordlist);
}

// For rescore-rule mutations done in place (splice/push). Caller has already
// mutated wordlist.rescoreRules; this clears derived caches and repaints. Stats
// and merged caches must clear too, since histograms now show rescored entries
// and the histogram layout depends on the union of every source's rescored set.
function applyRescoreRulesChange(wordlist) {
  compileRescoreRules(wordlist);
  updateWordlistDirty(wordlist);
  invalidateWordlistCaches(wordlist);
  persistMeta();
  MirrorSync.schedule(wordlist);
  repaintAfterCacheChange();
}

function reorderSources(fromIdx, toIdx) {
  if (fromIdx === toIdx ||
      fromIdx < 0 || toIdx < 0 ||
      fromIdx >= state.sources.length || toIdx >= state.sources.length) return;
  const [item] = state.sources.splice(fromIdx, 1);
  state.sources.splice(toIdx, 0, item);
  persistMeta();
  // The cache effect already covers the order change (refreshSourceCounts
  // rebuilds derived caches from state.sources). No separate sources$ bump
  // is needed — repaintAfterCacheChange routes through the render effect.
  repaintAfterCacheChange();
}

export {
  persistMeta, _persistMetaNow, persistScoring, serializeMetaEntry,
  batchUpdate, repaintAfterCacheChange,
  setWordlistName, setWordlistIcon, setWordlistUrl, setWordlistPublisher,
  setWordlistEnabled, setWordlistRescoreRules, applyRescoreRulesChange, reorderSources,
};
