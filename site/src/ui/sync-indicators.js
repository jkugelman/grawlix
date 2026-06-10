'use strict';

// ─── Sync indicators ──────────────────────────────────────────────────────────

import { SEVERITY_PRIORITY } from '../core/constants.js';
import { esc } from '../core/util.js';
import { isMobile } from '../core/platform.js';
import { state, syncKey } from '../data/state.js';
import { syncTargets, SyncStatus, syncFilename } from '../data/disk-sync.js';

export function syncSignHTML(list) {
  if (isMobile()) return '';
  const key = syncKey(list);
  const synced = syncTargets.has(key);
  const status = synced ? SyncStatus.get(key) : null;
  const file = synced ? esc(syncFilename(key)) : '';

  let dot, text;
  if (!synced)                       { dot = 'off';     text = 'Disk sync off'; }
  else if (status === 'unavailable') { dot = 'warn';    text = `Can’t find ${file}`; }
  else if (status === 'conflict')    { dot = 'warn';    text = 'Sync conflict'; }
  else if (status === 'writing')     { dot = 'working'; text = 'Saving…'; }
  else                               { dot = 'ok';      text = `Syncing to ${file}`; }

  return `<div class="sync-hang">
      <button type="button" id="sync-sign" class="sync-sign${dot === 'warn' ? ' attention' : ''}" onclick="WordlistActions.action('openSync')" title="${synced ? 'Manage disk sync' : 'Disk sync'}">
        <span class="sync-dot sync-dot--${dot}"></span>
        <span class="sync-line-text">${text}</span>
      </button>
    </div>`;
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
