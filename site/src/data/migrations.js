'use strict';

// ─── Migrations ─────────────────────────────────────────────────────────────

import { Storage, lsLoad, lsSave, lsDel, idbGet, idbPut, idbDel, idbGetAllKeys } from './storage.js';
import { URL_REMAPS } from '../core/constants.js';

// Bump when the shape of stored data (anything in localStorage, or an IDB
// record) changes, and register a step in the same commit — a MIGRATIONS[N]
// entry with an `ls` and/or `idb` function. A bump with neither for some
// version routes every existing user to the reset floor. See docs/migration.md.
//
// Schema version history:
//   ≤9: pre-migration-policy baseline; a store this old hits the reset floor.
//   v10 (2026-06-06): dropped the 'ignore' rescore output; rules that output
//                     'ignore' rewrite to '0'.
//   v11 (2026-06-12): split the per-list disk-sync IDB record
//                     sync_<key> {handle, baseline} into
//                     sync_main_<key> {handle} + sync_worker_<key> {baseline}.
//   v12 (2026-06-19): renamed the standalone returning-visitor flag
//                     welcomeSeen → returningVisitor.
//   v13 (2026-07-22): the affix merge renamed tool slugs; the seenTools reveal
//                     list maps behead/add_prefix/remove_prefix → head_off and
//                     curtail/add_suffix/remove_suffix → back_off, so renamed
//                     tools don't re-reveal.
export const SCHEMA_VERSION = 13;

// MIGRATIONS[v] upgrades stored data from schema v to v+1 via an optional `ls`
// step and/or `idb` step. The two run in separate boot phases (the array is
// iterated twice): `ls` synchronously before openDB (migrateLs), `idb` async
// after openDB (migrateIdbRecords) — an idb step needs the open `_db`, and the
// ls step runs early enough to gate the reset prompt. The `ls` step gets the
// settings blob ({ sources, scoring, scoringDirty, mergedSettings } that
// migrateLocalStorage assembles): it reshapes the blob, touches other standalone
// keys via lsLoad/lsSave/lsDel, or both.
export const MIGRATIONS = {
  9: {
    ls: blob => {                               // dropped the 'ignore' rescore output
      for (const w of blob.sources || []) {
        for (const r of w.rescoreRules || []) {
          if ((r.output || '').trim().toLowerCase() === 'ignore') r.output = '0';
        }
      }
    },
  },
  10: {
    idb: async () => {                          // split the per-list disk-sync record
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
  },
  11: {
    ls: () => {                                 // welcomeSeen → returningVisitor
      const v = lsLoad('welcomeSeen');
      if (v !== null) lsSave('returningVisitor', v);
      lsDel('welcomeSeen');
    },
  },
  12: {
    ls: () => {                                 // affix merge renamed tool slugs
      const raw = lsLoad('seenTools');
      if (raw === null) return;
      let seen; try { seen = JSON.parse(raw); } catch { return; }
      if (!Array.isArray(seen)) return;
      const rename = {
        behead: 'head_off', add_prefix: 'head_off', remove_prefix: 'head_off',
        curtail: 'back_off', add_suffix: 'back_off', remove_suffix: 'back_off',
      };
      lsSave('seenTools', JSON.stringify([...new Set(seen.map(s => rename[s] || s))]));
    },
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
  for (let v = from; v < SCHEMA_VERSION; v++) if (!MIGRATIONS[v]?.ls && !MIGRATIONS[v]?.idb) return false;
  return true;
}

export function migrateLs(blob, from) {
  for (let v = from; v < SCHEMA_VERSION; v++) MIGRATIONS[v]?.ls?.(blob); // canMigrate(from) must hold; a version may have only an idb step
  return blob;
}

export async function migrateIdbRecords(from) {
  for (let v = from; v < SCHEMA_VERSION; v++) await MIGRATIONS[v]?.idb?.();
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
    const home = remaps.find(r => r.from.includes(m.url));
    if (home) { m.url = home.to; changed = true; }
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
  try { migrateLs(blob, from); }
  catch (err) { console.error('migration failed', err); return false; }
  Storage.writeMeta(blob.sources);
  if (blob.scoring) Storage.writeScoring(blob.scoring, blob.scoringDirty);
  Storage.writeMergedSettings(blob.mergedSettings);
  return true;
}
