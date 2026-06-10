'use strict';

// ─── Migrations ─────────────────────────────────────────────────────────────

import { Storage } from './storage.js';
import { URL_REMAPS } from '../core/constants.js';

// Bump when the shape of stored data (localStorage `meta` or IDB entries)
// changes, and register a MIGRATIONS[N] step in the same commit: a bump without
// one routes every existing user to the reset floor. See docs/migration.md.
//
// Schema version history:
//   ≤9: pre-migration-policy baseline; a store this old hits the reset floor.
//   v10 (2026-06-06): dropped the 'ignore' rescore output; rules that output
//                     'ignore' rewrite to '0'.
export const SCHEMA_VERSION = 10;

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

export function canMigrate(from) {
  if (!Number.isFinite(from) || from > SCHEMA_VERSION) return false;
  for (let v = from; v < SCHEMA_VERSION; v++) if (!MIGRATIONS[v]) return false;
  return true;
}

export function migrateSettings(blob, from) {
  for (let v = from; v < SCHEMA_VERSION; v++) MIGRATIONS[v](blob); // canMigrate(from) must hold
  return blob;
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
  Storage.setSchemaVersion(SCHEMA_VERSION);
  return true;
}
