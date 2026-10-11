'use strict';

// ─── Migrations ─────────────────────────────────────────────────────────────

import { Storage, lsLoad, lsSave, lsDel, idbGet, idbPut, idbDel, idbGetAllKeys } from './storage.js';
import { URL_REMAPS } from '../core/constants.js';
import { scoreQuery } from '../core/util.js';

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
//   v14 (2026-08-02): the output format's accents axis became diacritics (NFD
//                     rather than NFKD) and gained an ascii axis, so the stored
//                     outputFormat renames one key and adds another.
//   v15 (2026-08-02): the output format's ascii axis became unicode, so the
//                     stored outputFormat renames the key, value verbatim.
//   v16 (2026-09-13): the output format gained a digits axis, stored kept.
//   v17 (2026-09-18): the output format's unicode axis became symbols, so the
//                     stored outputFormat renames the key, value verbatim.
//   v18 (2026-10-11): a rescore rule's score range and length filter became
//                     one query string, {input, length} → {query}; rules that
//                     never matched are dropped, and so are the compiled
//                     fields v17 persisted alongside.
export const SCHEMA_VERSION = 18;

// MIGRATIONS[v] upgrades stored data from schema v to v+1 via an optional `ls`
// step and/or `idb` step. The two run in separate boot phases (the array is
// iterated twice): `ls` synchronously before openDB (migrateLs), `idb` async
// after openDB (migrateIdbRecords) — an idb step needs the open `_db`, and the
// ls step runs early enough to gate the reset prompt. The `ls` step gets the
// settings blob ({ sources, scoring, scoringDirty, mergedSettings } that
// migrateLocalStorage assembles): it reshapes the blob, touches other standalone
// keys via lsLoad/lsSave/lsDel, or both.
export const MIGRATIONS = {
  17: {
    ls: blob => {                               // rule {input, length} → {query}
      for (const w of blob.sources || []) {
        w.rescoreRules = (w.rescoreRules || []).filter(isLiveV17Rule).map(r => ({
          query: scoreQuery(r.input, r.length),
          output: r.output ?? '',
          note: r.note ?? '',
          ...(r.scoring === false ? { scoring: false } : {}),
        }));
      }
    },
  },
  16: {
    ls: blob => {                               // outputFormat.unicode → outputFormat.symbols
      const fmt = blob.mergedSettings?.outputFormat;
      if (!fmt) return;
      fmt.symbols = fmt.unicode ?? true;
      delete fmt.unicode;
    },
  },
  15: {
    ls: blob => {                               // outputFormat gains digits
      const fmt = blob.mergedSettings?.outputFormat;
      if (fmt) fmt.digits = true;
    },
  },
  14: {
    ls: blob => {                               // outputFormat.ascii → outputFormat.unicode
      const fmt = blob.mergedSettings?.outputFormat;
      if (!fmt) return;
      fmt.unicode = fmt.ascii ?? true;
      delete fmt.ascii;
    },
  },
  13: {
    ls: blob => {
      const fmt = blob.mergedSettings?.outputFormat;
      if (!fmt) return;
      // Keep, not strip: the new axis is stricter than anything the old two
      // could express, so defaulting it off would gut existing files.
      fmt.diacritics = fmt.accents ?? true;
      fmt.ascii = true;
      delete fmt.accents;
    },
  },
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

// v17's own parsers, frozen here: a rule they rejected never matched, and
// carrying it over could revive it (a dead `50,60` would read as "50 or 60").
function v17Range(str) {
  str = (str || '').trim();
  if (!str) return null;
  let m = str.match(/^(\d+)\+$/);        if (m) return { min: +m[1], max: null };
  m = str.match(/^(\d+)[-–](\d+)$/);    if (m) return { min: +m[1], max: +m[2] };
  m = str.match(/^(\d+)$/);              if (m) return { min: +m[1], max: +m[1] };
  return null;
}

function v17Output(str) {
  str = (str || '').trim().toLowerCase();
  if (!str) return 'unchanged';
  let m = str.match(/^(\d+)[-–](\d+)$/); if (m) return { min: +m[1], max: +m[2] };
  m = str.match(/^(\d+)\+$/);            if (m) return { min: +m[1], max: null };
  m = str.match(/^(\d+)$/);
  return m ? +m[1] : null;
}

const v17Matchable = iv => iv && (iv.max === null || iv.min <= iv.max);

function isLiveV17Rule(r) {
  const iv = v17Range(r.input);
  if (!v17Matchable(iv)) return false;
  if ((r.length || '').trim() && !v17Matchable(v17Range(r.length))) return false;
  const out = v17Output(r.output);
  if (out === null) return false;
  if (typeof out !== 'object') return true;
  if (iv.max === null && out.max === null) return true;
  return iv.max !== null && out.max !== null && iv.min !== iv.max;
}

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
// Rewrites a source meta's `url`, and its image icon's url, when a hosted file
// relocates. Runs every boot rather than through MIGRATIONS: a relocated file
// leaves the stored shape unchanged, so the version check never fires and a
// version-gated fixup would silently never reach users already on the current schema.
export function remapStoredUrls(sourceMetas, remaps = URL_REMAPS) {
  let changed = false;
  const remap = url => url && remaps.find(r => r.from.includes(url))?.to;
  for (const m of sourceMetas || []) {
    const url = remap(m.url);
    if (url) { m.url = url; changed = true; }
    const iconUrl = m.icon?.type === 'img' && remap(m.icon.url);
    if (iconUrl) { m.icon = { ...m.icon, url: iconUrl }; changed = true; }
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
