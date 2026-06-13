'use strict';

// ─── Migrations ─────────────────────────────────────────────────────────────

import { Storage, idbGet, idbPut, idbDel, idbGetAllKeys } from './storage.js';
import { URL_REMAPS } from '../core/constants.js';

// Bump when the shape of stored data (localStorage `meta` or IDB records)
// changes, and register a step in the same commit — a MIGRATIONS[N] (settings
// blob) and/or an IDB_MIGRATIONS[N] (IDB records). A bump with neither for some
// version routes every existing user to the reset floor. See docs/migration.md.
//
// Schema version history:
//   ≤9: pre-migration-policy baseline; a store this old hits the reset floor.
//   v10 (2026-06-06): dropped the 'ignore' rescore output; rules that output
//                     'ignore' rewrite to '0'.
//   v11 (2026-06-12): split the per-list disk-sync IDB record
//                     sync_<key> {handle, baseline} into
//                     sync_main_<key> {handle} + sync_worker_<key> {baseline}.
export const SCHEMA_VERSION = 11;

// MIGRATIONS[v] upgrades a settings blob from schema v to v+1, mutating it in
// place (a returned value is ignored). The blob is the
// { sources, scoring, scoringDirty, mergedSettings } shape that migrateLocalStorage
// assembles from the separate localStorage keys; migrations target that, never raw storage.
export const MIGRATIONS = {
  9: blob => {
    for (const w of blob.sources || []) {
      for (const r of w.rescoreRules || []) {
        if ((r.output || '').trim().toLowerCase() === 'ignore') r.output = '0';
      }
    }
  },
};

// Separate from MIGRATIONS because IDB steps must run post-openDB; the
// settings-blob phase runs before the DB is open. Fold an IDB step into
// MIGRATIONS and it executes against a null `_db`.
export const IDB_MIGRATIONS = {
  10: async () => {
    const keys = await idbGetAllKeys();
    // 'sync_' is a strict prefix of both new prefixes — without this guard the
    // sweep re-splits its own output (sync_main_/sync_worker_) and corrupts it.
    const oldKeys = keys.filter(k =>
      typeof k === 'string'
      && k.startsWith('sync_')
      && !k.startsWith('sync_main_')
      && !k.startsWith('sync_worker_'));
    for (const oldKey of oldKeys) {
      const rec = await idbGet(oldKey);
      if (!rec) { await idbDel(oldKey); continue; }
      const suffix = oldKey.slice('sync_'.length);
      // These literals must match disk-sync.js's SYNC_MAIN_PREFIX / SYNC_WORKER_PREFIX —
      // kept as literals here to avoid pulling disk-sync's dependency graph into migrations.
      const { main, worker } = splitSyncRecord(rec);
      await idbPut('sync_main_' + suffix, main);
      if (worker) await idbPut('sync_worker_' + suffix, worker);
      // Delete-old-last: a crash before this leaves the old record intact to
      // re-split next boot, never a half-migrated list with no source of truth.
      await idbDel(oldKey);
    }
  },
};

// IDB-free so the frozen fixture can target it. A null worker value means write no
// sync_worker_ record — mirror lists carry no baseline; My Edits' '' is real, so
// the test is `=== undefined`, not falsiness.
export function splitSyncRecord(rec) {
  return {
    main: { handle: rec.handle },
    worker: rec.baseline === undefined ? null : { baseline: rec.baseline },
  };
}

export function canMigrate(from) {
  if (!Number.isFinite(from) || from > SCHEMA_VERSION) return false;
  for (let v = from; v < SCHEMA_VERSION; v++) if (!MIGRATIONS[v] && !IDB_MIGRATIONS[v]) return false;
  return true;
}

export function migrateSettings(blob, from) {
  for (let v = from; v < SCHEMA_VERSION; v++) MIGRATIONS[v]?.(blob); // canMigrate(from) must hold; a version may have only an IDB step
  return blob;
}

export async function migrateIdbRecords(from) {
  for (let v = from; v < SCHEMA_VERSION; v++) await IDB_MIGRATIONS[v]?.();
}

// ─── URL remaps ─────────────────────────────────────────────────────────────
//
// Rewrites a source meta's `url` when a hosted wordlist relocates. Runs every
// boot rather than through MIGRATIONS: a relocated file leaves the stored shape
// unchanged, so the version check never fires and a version-gated fixup would
// silently never reach users already on the current schema.
export function remapStoredUrls(sourceMetas, remaps = URL_REMAPS) {
  let changed = false;
  for (const m of sourceMetas || []) {
    if (!m.url) continue;
    // Re-test, don't break: chains forward (A→B then B→C) for a far-behind user.
    for (const { from, to } of remaps) {
      if (m.url === from) { m.url = to; changed = true; }
    }
  }
  return changed;
}

export function migrateLocalStorage(from) {
  const scoring = Storage.readScoring();
  const blob = {
    sources:        Storage.readMeta(),
    scoring:        scoring?.scoring ?? null,
    scoringDirty:   scoring?.dirty ?? false,
    mergedSettings: Storage.readMergedSettings(),
  };
  try { migrateSettings(blob, from); }
  catch (err) { console.error('migration failed', err); return false; }
  Storage.writeMeta(blob.sources);
  if (blob.scoring) Storage.writeScoring(blob.scoring, blob.scoringDirty);
  Storage.writeMergedSettings(blob.mergedSettings);
  return true;
}
