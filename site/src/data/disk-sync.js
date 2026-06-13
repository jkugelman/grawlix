'use strict';

// ─── Disk sync (per-list file sync) ───────────────────────────────────────────

import { MERGED_ID, MERGED_NAME } from '../core/constants.js';
import { state, syncKey, getEditsWordlist, bumpSyncStatus } from './state.js';
import { idbGet, idbPut, idbDel, Storage } from './storage.js';
import { parseWordlist } from '../engine/norm.js';
import { serializeEntries, sortedEntries } from '../engine/serialize.js';
import { getOutputFormat } from './serialize.js';
import { applyRescoring, compileRescoreRules } from '../engine/rescore.js';
import { threeWayMergeEdits, sameEditsEntries } from '../engine/edits-merge.js';
import { invalidateWordlistCaches } from './invalidate.js';
import { batchUpdate, persistMeta, repaintAfterCacheChange } from './persist.js';

const SYNC_MAIN_PREFIX       = 'sync_main_';
const SYNC_WORKER_PREFIX     = 'sync_worker_';
const EDITS_DEFAULT_FILENAME = 'My Edits.txt';
const DISK_SYNC_POLL_INTERVAL = 2000;
const MIRROR_WRITE_DELAY      = 500;

// Dialog callbacks injected by the app layer (configureSyncDialogs). Keeping the
// references here instead of importing the ui dialogs is what lets data/ avoid an
// upward edge to ui/ — disk-sync raises permission/conflict UI through these hooks.
let _alert = async () => {};
let _resolveConflict = async () => 'device';

export function configureSyncDialogs({ alert, resolveConflict }) {
  if (alert) _alert = alert;
  if (resolveConflict) _resolveConflict = resolveConflict;
}

// Injected by the app layer (configureMirrorSerializer), like the dialog hooks
// above: the SORTED worker-serialize attempt (text-or-null) for a scope (MERGED_ID
// or a source dbKey), kept here so data/ avoids an upward edge to ui/.
let _mirrorSerializer = null;
export function configureMirrorSerializer(fn) { _mirrorSerializer = fn; }

// key → { handle, baseline? }. `baseline` (serialized as-is My Edits text) is the
// common ancestor for My Edits' 3-way merge; without it, a two-way union can't
// tell "added here" from "deleted there" and silently resurrects deletions.
const syncTargets = new Map();
const syncStatus  = new Map();

function isMirrorList(list)  { return list === MERGED_ID || list.type !== 'edits'; }
function editsSyncKey()      { const e = getEditsWordlist(); return e ? e.dbKey : null; }
function listForSyncKey(key) { return key === MERGED_ID ? MERGED_ID : state.sources.find(s => s.dbKey === key) || null; }
function syncFilename(key)   { return syncTargets.get(key)?.handle?.name || ''; }

const SyncStatus = {
  get(key) { return syncTargets.has(key) ? (syncStatus.get(key) || 'synced') : null; },
  set(key, status) { syncStatus.set(key, status); bumpSyncStatus(); },
  clear(key) { syncStatus.delete(key); bumpSyncStatus(); },
};

async function loadSyncTargets() {
  for (const key of [MERGED_ID, ...state.sources.map(s => s.dbKey)]) {
    const hrec = await idbGet(SYNC_MAIN_PREFIX + key);
    // The handle record gates: a baseline left without a handle is dead, ignore it.
    if (!hrec || !hrec.handle) continue;
    const brec = await idbGet(SYNC_WORKER_PREFIX + key);
    syncTargets.set(key, { handle: hrec.handle, baseline: brec?.baseline });
  }
}

async function persistSyncTarget(key) {
  const t = syncTargets.get(key);
  if (!t) {
    await idbDel(SYNC_MAIN_PREFIX + key);
    await idbDel(SYNC_WORKER_PREFIX + key);
    return;
  }
  await idbPut(SYNC_MAIN_PREFIX + key, { handle: t.handle });
  // '' is a real baseline (My Edits' empty ancestor); only `undefined` means none.
  if (t.baseline !== undefined) await idbPut(SYNC_WORKER_PREFIX + key, { baseline: t.baseline });
  else                         await idbDel(SYNC_WORKER_PREFIX + key);
}

// InvalidStateError means a cloud-sync client (Dropbox, OneDrive) touched the file
// underneath the handle mid-operation, not an app bug — retry rather than fail.
const FS_RETRY_ATTEMPTS = 5;
const FS_RETRY_BASE_MS  = 200;

async function withFsRetry(op) {
  for (let attempt = 1; ; attempt++) {
    try { return await op(); }
    catch (e) {
      if (e?.name !== 'InvalidStateError' || attempt >= FS_RETRY_ATTEMPTS) throw e;
      await new Promise(r => setTimeout(r, FS_RETRY_BASE_MS * attempt));
    }
  }
}

const Disk = {
  isSupported() {
    return typeof window.showOpenFilePicker === 'function'
        && typeof window.showSaveFilePicker === 'function';
  },

  async pickExisting() {
    if (!Disk.isSupported()) return null;
    try {
      const [handle] = await window.showOpenFilePicker({ id: 'grawlix', multiple: false });
      return handle || null;
    } catch (e) { if (e?.name === 'AbortError') return null; throw e; }
  },
  async pickNew(suggestedName) {
    if (!Disk.isSupported()) return null;
    try {
      return await window.showSaveFilePicker({ id: 'grawlix', suggestedName });
    } catch (e) { if (e?.name === 'AbortError') return null; throw e; }
  },

  async queryPermission(handle, mode = 'readwrite') {
    if (!handle) return 'denied';
    try { return (await handle.queryPermission?.({ mode })) ?? 'prompt'; }
    catch { return 'prompt'; }
  },
  async requestPermission(handle, mode = 'readwrite') {
    if (!handle) return false;
    try { return (await handle.requestPermission?.({ mode })) === 'granted'; }
    catch { return false; }
  },

  async read(handle) {
    return withFsRetry(async () => {
      try { return await (await handle.getFile()).text(); }
      catch (e) { if (e?.name === 'NotFoundError') return null; throw e; }
    });
  },
  async lastModified(handle) {
    return withFsRetry(async () => {
      try { return (await handle.getFile()).lastModified; }
      catch (e) { if (e?.name === 'NotFoundError') return null; throw e; }
    });
  },
  async write(handle, text) {
    return withFsRetry(async () => {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
    });
  },
};

const MirrorSync = {
  _timers: new Map(),

  schedule(list) {
    const key = syncKey(list);
    if (!syncTargets.has(key) || !isMirrorList(list)) return;
    this._debounce(key, () => this._flush(key));
  },
  scheduleMerged() {
    if (!syncTargets.has(MERGED_ID)) return;
    this._debounce(MERGED_ID, () => this._flush(MERGED_ID));
  },
  _debounce(key, fn) {
    clearTimeout(this._timers.get(key));
    this._timers.set(key, setTimeout(fn, MIRROR_WRITE_DELAY));
  },

  async _flush(key) {
    const t = syncTargets.get(key);
    if (!t) return;
    SyncStatus.set(key, 'writing');
    try {
      await Disk.write(t.handle, await this._serialize(key));
      SyncStatus.set(key, 'synced');
    } catch (err) {
      console.error('mirror write failed', err);
      SyncStatus.set(key, 'unavailable');
    }
  },
  async _serialize(key) {
    const worker = _mirrorSerializer ? await _mirrorSerializer(key, getOutputFormat()) : null;
    if (worker != null) return worker;
    // Local fallback (worker not fresh). The merge has no resident main corpus, so
    // it mirrors empty; a source still holds its rawEntries on main.
    if (key === MERGED_ID) return '';
    const list = listForSyncKey(key);
    return serializeEntries(sortedEntries(applyRescoring(list.rawEntries, list.rescoreRules || [])), getOutputFormat());
  },
};

function applyReconciledEdits(edits, entries) {
  batchUpdate(() => {
    invalidateWordlistCaches(edits);
    edits.rawEntries = entries;
    edits.lastUpdated = Date.now();
    compileRescoreRules(edits);
    persistMeta();
    repaintAfterCacheChange();
  });
  Storage.writeWordlist(edits, serializeEntries(sortedEntries(entries)))
    .catch(err => console.error('My Edits IDB write failed', err));
}

const EditsSync = {
  _pollId: null,
  _snapshotMtime: null,
  _held: 0,
  _ownWritePending: false,
  _writeTimer: null,
  _reconcileInFlight: false,

  handle()   { const t = syncTargets.get(editsSyncKey()); return t?.handle || null; },
  isActive() { return !!this.handle(); },

  async connect(handle) {
    const key = editsSyncKey();
    syncTargets.set(key, { handle, baseline: '' });
    await persistSyncTarget(key);
    SyncStatus.set(key, 'synced');
    await this.reconcile();
    this.start();
    bumpSyncStatus();
  },

  start() {
    if (this._pollId || !this.isActive()) return;
    // The first tick re-establishes the mtime baseline, absorbing any write
    // connect() just did — so a leftover own-write mark must not survive into it,
    // or the next genuine external edit gets consumed as ours and skipped.
    this._snapshotMtime = null;
    this._ownWritePending = false;
    this._pollId = setInterval(() => this._tick(), DISK_SYNC_POLL_INTERVAL);
    document.addEventListener('visibilitychange', this._onVisibility);
  },
  stop() {
    if (this._pollId) { clearInterval(this._pollId); this._pollId = null; }
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._snapshotMtime = null;
  },
  _onVisibility() {
    if (document.visibilityState === 'visible') EditsSync._tick();
  },

  scheduleWrite() {
    if (!this.isActive()) return;
    clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => this._flushWrite(), MIRROR_WRITE_DELAY);
  },
  async _flushWrite() {
    const key = editsSyncKey();
    const t = syncTargets.get(key);
    if (!t) return;
    const text = serializeEntries(sortedEntries(getEditsWordlist().rawEntries));
    if (text === t.baseline) return;
    SyncStatus.set(key, 'writing');
    try {
      await this._ownWrite(text);
      t.baseline = text;
      await persistSyncTarget(key);
      SyncStatus.set(key, 'synced');
    } catch (err) {
      console.error('My Edits file write failed', err);
      SyncStatus.set(key, 'unavailable');
    }
  },
  // `_held` skips ticks for the whole write so the watcher can't read a half-written
  // file; `_ownWritePending` consumes the mtime bump the write causes so the next
  // tick doesn't mistake it for an external edit and reconcile against itself.
  async _ownWrite(text) {
    const t = syncTargets.get(editsSyncKey());
    this._held++;
    try {
      await Disk.write(t.handle, text);
      this._ownWritePending = true;
    } finally {
      this._held--;
    }
  },

  async _tick() {
    if (document.visibilityState === 'hidden' || this._held > 0 || this._reconcileInFlight) return;
    const t = syncTargets.get(editsSyncKey());
    if (!t) return;
    const mtime = await Disk.lastModified(t.handle);
    if (mtime === null) { SyncStatus.set(editsSyncKey(), 'unavailable'); return; }
    if (this._snapshotMtime === null) { this._snapshotMtime = mtime; return; }
    if (mtime === this._snapshotMtime) return;
    this._snapshotMtime = mtime;
    if (this._ownWritePending) { this._ownWritePending = false; return; }
    this._reconcileInFlight = true;
    try { await this.reconcile(); }
    finally { this._reconcileInFlight = false; }
  },

  async reconcile() {
    const key = editsSyncKey();
    const t = syncTargets.get(key);
    if (!t) return;
    const edits = getEditsWordlist();
    const fileText = await Disk.read(t.handle);
    if (fileText === null) { SyncStatus.set(key, 'unavailable'); return; }

    const { resolved, conflicts } = threeWayMergeEdits(
      parseWordlist(t.baseline || ''), parseWordlist(fileText), edits.rawEntries);

    if (conflicts.length) {
      SyncStatus.set(key, 'conflict');
      const choice = await _resolveConflict(t.handle.name, conflicts);
      if (choice === 'file') {
        for (const c of conflicts) { if (c.file) resolved.set(c.norm, c.file); else resolved.delete(c.norm); }
      }
    }

    const merged = [...resolved.values()];
    if (!sameEditsEntries(merged, edits.rawEntries)) applyReconciledEdits(edits, merged);

    const outText = serializeEntries(sortedEntries(merged));
    if (outText !== fileText) await this._ownWrite(outText);
    t.baseline = outText;
    await persistSyncTarget(key);
    SyncStatus.set(key, 'synced');
  },
};

async function attachMirrorSync(list, { existing = false } = {}) {
  let handle;
  if (existing) {
    handle = await Disk.pickExisting();
    if (handle && !await Disk.requestPermission(handle, 'readwrite')) {
      await _alert(`Grawlix needs permission to write ${handle.name} to sync it.`);
      return false;
    }
  } else {
    handle = await Disk.pickNew(rescoredFilename(list));
  }
  if (!handle) return false;
  const key = syncKey(list);
  syncTargets.set(key, { handle });
  await persistSyncTarget(key);
  SyncStatus.set(key, 'writing');
  await MirrorSync._flush(key);
  bumpSyncStatus();
  return true;
}

async function attachEditsSync({ existing }) {
  let handle;
  if (existing) {
    handle = await Disk.pickExisting();
    if (handle && !await Disk.requestPermission(handle, 'readwrite')) {
      await _alert(`Grawlix needs permission to write ${handle.name} to sync it.`);
      return false;
    }
  } else {
    handle = await Disk.pickNew(EDITS_DEFAULT_FILENAME);
  }
  if (!handle) return false;
  await EditsSync.connect(handle);
  return true;
}

async function detachSync(list) {
  const key = syncKey(list);
  if (!syncTargets.has(key)) return true;
  if (!isMirrorList(list)) EditsSync.stop();
  syncTargets.delete(key);
  syncStatus.delete(key);
  await persistSyncTarget(key);   // no-target branch deletes both records
  bumpSyncStatus();
  return true;
}

function rescoredFilename(list) {
  return `${sanitizeFilenameStem(list === MERGED_ID ? MERGED_NAME : list.name)} rescored.txt`;
}

const RESERVED_DEVICE_NAMES = new Set(
  ['CON', 'PRN', 'AUX', 'NUL']
    .concat(Array.from({ length: 9 }, (_, i) => `COM${i + 1}`))
    .concat(Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`))
);
function sanitizeFilenameStem(name) {
  const stem = (name || '')
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!stem || RESERVED_DEVICE_NAMES.has(stem.toUpperCase())) return `${stem || 'Wordlist'}_`;
  return stem;
}

async function partitionSyncPermissions() {
  const granted = [], prompt = [];
  for (const [key, t] of syncTargets) {
    (await Disk.queryPermission(t.handle, 'readwrite') === 'granted' ? granted : prompt).push(key);
  }
  return { granted, prompt };
}

async function activateSyncTarget(key) {
  if (key === editsSyncKey()) {
    EditsSync.start();
    await EditsSync.reconcile();
  } else if (key === MERGED_ID) {
    MirrorSync.scheduleMerged();
  } else {
    MirrorSync.schedule(listForSyncKey(key));
  }
}

export {
  SYNC_MAIN_PREFIX, SYNC_WORKER_PREFIX, EDITS_DEFAULT_FILENAME, DISK_SYNC_POLL_INTERVAL, MIRROR_WRITE_DELAY,
  FS_RETRY_ATTEMPTS, FS_RETRY_BASE_MS, RESERVED_DEVICE_NAMES,
  syncTargets, syncStatus,
  isMirrorList, editsSyncKey, listForSyncKey, syncFilename,
  SyncStatus, loadSyncTargets, persistSyncTarget, withFsRetry, Disk, MirrorSync,
  applyReconciledEdits, EditsSync,
  attachMirrorSync, attachEditsSync, detachSync, rescoredFilename, sanitizeFilenameStem,
  partitionSyncPermissions, activateSyncTarget,
};
