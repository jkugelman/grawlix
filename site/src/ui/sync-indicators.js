'use strict';

// ─── Sync indicators ──────────────────────────────────────────────────────────

import { SEVERITY_PRIORITY } from '../core/constants.js';
import { esc } from '../core/util.js';
import { isMobile } from '../core/platform.js';
import { state, syncKey } from '../data/state.js';
import { syncTargets, SyncStatus, syncFilename } from '../data/disk-sync.js';

// Must match the `sync-ring-drain` animation-duration in app.css — the dwell
// below rounds up to whole periods, and drift releases the ring mid-drain.
export const SYNC_BUSY_PERIOD_MS = 900;

export function syncSignHTML(list) {
  if (isMobile()) return '';
  const key = syncKey(list);

  if (!syncTargets.has(key)) {
    return `<button type="button" id="sync-sign" class="primary" onclick="WordlistActions.action('openSync')">Sync to disk</button>`;
  }

  // No "Saving…" case on purpose: the pill is right-aligned, so a label that
  // shrank mid-write dragged the whole control ~100px sideways and back.
  const status = SyncStatus.get(key);
  const file = esc(syncFilename(key));
  let tone, text, title;
  if      (status === 'unavailable') { tone = 'warn'; text = `Can’t find ${file}`; title = 'Manage disk sync'; }
  else if (status === 'conflict')    { tone = 'warn'; text = 'Sync conflict';      title = 'Manage disk sync'; }
  else                               { tone = 'ok';   text = file;                 title = `Synced to ${file} — manage disk sync`; }

  return `<button type="button" id="sync-sign" class="sync-sign sync-sign--${tone}${tone === 'warn' ? ' attention' : ''}" onclick="WordlistActions.action('openSync')" title="${title}">
      <svg class="sync-ring" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" pathLength="1"/></svg>
      <span class="sync-line-text">${text}</span>
    </button>`;
}

// ─── The saving ring ──────────────────────────────────────────────────────────
// Busy rides a class, deliberately outside syncSignHTML: folding it into the
// rendered label would re-render the node on every flip, restarting the stroke.

let _busyKey   = null;
let _busyStart = 0;
let _busyTimer = null;

export function syncBusyKey() {
  if (isMobile()) return null;
  const key = syncKey(state.selected);
  return syncTargets.has(key) && SyncStatus.get(key) === 'writing' ? key : null;
}

export function applySyncBusy() {
  document.getElementById('sync-sign')?.classList.toggle('sync-sign--saving', _busyKey !== null);
}

export function clearSyncBusy() {
  clearTimeout(_busyTimer);
  _busyTimer = null; _busyKey = null; _busyStart = 0;
  applySyncBusy();
}

export function setSyncBusy(key) {
  if (key) {
    clearTimeout(_busyTimer);
    _busyTimer = null;
    if (_busyKey !== key) { _busyKey = key; _busyStart = performance.now(); }
  } else if (_busyKey && !_busyTimer) {
    // Scope changed mid-write: dwelling would ring a pill that isn't saving.
    if (_busyKey !== syncKey(state.selected)) { clearSyncBusy(); return; }
    // Round up to a whole period — the keyframes open and close on a full stroke,
    // so releasing off-cycle snaps a half-drained ring back to full.
    // Clamp before the ceil: a write fast enough to elapse 0ms would otherwise
    // round to zero periods and release instantly — the very case this exists for.
    const elapsed = performance.now() - _busyStart;
    const periods = Math.ceil(Math.max(elapsed, 1) / SYNC_BUSY_PERIOD_MS);
    const hold = periods * SYNC_BUSY_PERIOD_MS - elapsed;
    _busyTimer = setTimeout(clearSyncBusy, hold);
  }
  applySyncBusy();
}

export function maxSeverity(...severities) {
  let max = null;
  let maxPri = 0;
  for (const s of severities) {
    const p = SEVERITY_PRIORITY[s] ?? 0;
    if (p > maxPri) { max = s; maxPri = p; }
  }
  return max;
}

export function wordlistSeverity(wordlist) {
  return wordlist._updateAvailable ? 'info' : null;
}

export function sourcesSeverity() {
  return maxSeverity(...state.sources.map(wordlistSeverity));
}

export function severityTitle(severity) {
  return severity === 'info' ? 'Update available' : '';
}
