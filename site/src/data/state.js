'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

import { signal } from '../core/signals.js';
import { MERGED_ID } from '../core/constants.js';

// Top-level state. `sources$` is the array of wordlists, signal-backed so
// the cosmetic effect can subscribe; reorder/add/remove call `sources$.bump()`
// after splicing (signal equality is by reference, so plain mutation needs a
// bump).
export const sources$ = signal([]);

// `cacheVersion$` is bumped whenever the imperative caches change (full
// invalidation or in-place patch). The render effect subscribes to it so
// cache-impacting changes trigger a repaint without manual dispatch.
export const cacheVersion$ = signal(0);
export function bumpCacheVersion() { cacheVersion$.set(cacheVersion$.peek() + 1); }

// `pipelineVersion$` is for changes that re-run the pipeline but leave the
// sources untouched (a search keystroke, a tool edit). Routing these through
// `cacheVersion$` instead — the tempting choice, since both just repaint — drags
// in the cache branch's merge rebuild, silently turning every keystroke into a
// full re-merge of the corpus (a ~1s freeze on large lists). Keep them separate.
export const pipelineVersion$ = signal(0);
export function bumpPipelineVersion() { pipelineVersion$.set(pipelineVersion$.peek() + 1); }

// Disk-sync bumps this instead of calling the ui repaint directly; routing
// through the signal is what keeps data/ from importing ui/ (the data⇄ui cycle).
export const syncStatus$ = signal(0);
export function bumpSyncStatus() { syncStatus$.set(syncStatus$.peek() + 1); }

// The worker ships the per-config summaries (merged count, source counts, axis)
// asynchronously, AFTER the cacheVersion$ bump that triggered the re-sync. Count
// displays subscribe to this so they repaint when the shipped values land —
// bumping cacheVersion$ here instead would re-fire the render effect's re-sync and
// loop. Bumped by the selfReady/editAck consumption, version-guarded upstream.
export const configSummary$ = signal(0);
export function bumpConfigSummary() { configSummary$.set(configSummary$.peek() + 1); }

// Reads through `state.sources` are non-subscribing (peek). Effects that
// need to re-run on changes read the underlying signal explicitly with
// `.get()`. This keeps the imperative call sites unchanged while preventing
// accidental over-subscription from incidental reads inside effects.
export const state = {
  get sources()  { return sources$.peek(); },
  set sources(v) { sources$.set(v); },
  // Tier labels for the unified score scale. Single source of truth for what
  // each score range means to the user; edited from All Wordlists' pane and used
  // everywhere scores get a tooltip. No signal — mutators call
  // `persistScoring()` and `renderScoringRules()` explicitly.
  scoring: [],
  // True when state.scoring has been customized away from DEFAULT_SCORING.
  // Drives `propagateDefaults` at boot (pristine users silently pick up dev
  // updates) and the "Reset to defaults" button visibility.
  scoringDirty: false,
  selected: MERGED_ID,
};

// Per-wordlist cosmetic fields are signal-backed: each wordlist exposes both
// `wl.name`/`wl.icon`/etc. (peek getter, set setter) and `wl.name$`/`wl.icon$`
// for explicit subscriptions. The cosmetic effect subscribes to all four
// across every wordlist.
//
// Cache-affecting fields (`enabled`, `rescoreRules`, `rawEntries`) and
// transient fields (`_loading`, `_updateAvailable`, `lastUpdated`, etc.) are
// plain properties: their mutation goes through a helper that handles the
// invalidation/persistence/dispatch explicitly. See "Mutation helpers" below.
export const REACTIVE_WORDLIST_FIELDS = ['name', 'icon', 'url', 'publisherId'];

export function wrapWordlist(wl) {
  if (wl.name$) return wl;  // already wrapped
  for (const field of REACTIVE_WORDLIST_FIELDS) {
    const sig = signal(wl[field]);
    delete wl[field];
    Object.defineProperty(wl, field + '$', { value: sig });
    Object.defineProperty(wl, field, {
      get() { return sig.peek(); },
      set(v) { sig.set(v); },
      enumerable: true,
      configurable: false,
    });
  }
  return wl;
}

export function syncKey(list) { return list === MERGED_ID ? MERGED_ID : list.dbKey; }

export function getEditsWordlist() {
  return state.sources.find(l => l.type === 'edits');
}

// Opaque IDB key. Avoids crypto.randomUUID because WebKit gates it on
// secure contexts, which breaks local-network mobile testing over HTTP.
export function newDbKey() {
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}
