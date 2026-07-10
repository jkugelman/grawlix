'use strict';

// ─── Storage ──────────────────────────────────────────────────────────────────

import { LS_PREFIX } from '../core/constants.js';

export function lsSave(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, value); return true; }
  catch { return false; }
}
export function lsLoad(key) { return localStorage.getItem(LS_PREFIX + key); }
export function lsDel(key)  { localStorage.removeItem(LS_PREFIX + key); }

// IndexedDB for large wordlist data (localStorage has ~5MB limit)
export const IDB_NAME  = 'grawlix';
export const IDB_STORE = 'data';
let _db = null;

// `_db` is reassigned after openDB() resolves; expose a live accessor so the
// `window._db` test bridge reads the current value instead of a frozen null.
export function getDb() { return _db; }

export async function resetAllDataAndReload() {
  await Storage.reset();
  location.reload();
  // location.reload() is asynchronous — JS keeps running until the navigation
  // actually fires. Block the caller so it can't re-persist the state we just
  // wiped (init() in particular would write a fresh `meta` back to localStorage
  // and leave the SCHEMA_VERSION warning re-armed for the next load).
  await new Promise(() => {});
}

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => { _db = e.target.result; resolve(); };
    req.onerror   = () => reject(req.error);
  });
}

// Ask for durable storage so a best-effort eviction can't silently drop the IDB
// wordlist text while the localStorage metadata lingers — the exact desync that
// strands a user on "No data". Idempotent; re-request each boot so a grant that
// the browser's engagement heuristics only warrant later still lands.
export async function requestPersistentStorage() {
  try {
    if (await navigator.storage?.persisted?.()) return;
    await navigator.storage?.persist?.();
  } catch { /* Storage API blocked/unavailable — best-effort remains the fallback */ }
}

export function idbPut(key, val) {
  return new Promise(resolve => {
    const tx = _db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
  });
}

export function idbGet(key) {
  return new Promise(resolve => {
    const tx  = _db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => resolve(null);
  });
}

export function idbDel(key) {
  return new Promise(resolve => {
    const tx = _db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
  });
}

export function idbGetAllKeys() {
  return new Promise(resolve => {
    const tx  = _db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => resolve([]);
  });
}

export const Storage = {
  schemaVersion() { const v = parseInt(lsLoad('schemaVersion'), 10); return Number.isFinite(v) ? v : null; },
  setSchemaVersion(v) { lsSave('schemaVersion', String(v)); },
  hasData() { return lsLoad('meta') !== null; },

  readMeta() {
    const raw = lsLoad('meta');
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch { return null; }
  },
  writeMeta(sources) { lsSave('meta', JSON.stringify(sources)); },

  readScoring() {
    const raw = lsLoad('scoring');
    if (!raw) return null;
    try { return { scoring: JSON.parse(raw), dirty: lsLoad('scoringDirty') === '1' }; }
    catch { return null; }
  },
  writeScoring(scoring, dirty) {
    lsSave('scoring', JSON.stringify(scoring));
    lsSave('scoringDirty', dirty ? '1' : '0');
  },

  readMergedSettings() {
    try { return JSON.parse(lsLoad('mergedSettings')) || {}; }
    catch { return {}; }
  },
  writeMergedSettings(s) { lsSave('mergedSettings', JSON.stringify(s)); },

  async readWordlist(wordlist) { return idbGet('data_' + wordlist.dbKey); },
  async writeWordlist(wordlist, text) { await idbPut('data_' + wordlist.dbKey, text); },
  async deleteWordlist(wordlist) { await idbDel('data_' + wordlist.dbKey); },

  async reset() {
    Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX)).forEach(k => localStorage.removeItem(k));
    if (_db) { _db.close(); _db = null; }
    await new Promise(resolve => {
      const req = indexedDB.deleteDatabase(IDB_NAME);
      req.onsuccess = resolve;
      req.onerror   = resolve;
      req.onblocked = resolve;
    });
  },
};
