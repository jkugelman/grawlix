'use strict';

import {
  syncTargets, Disk, SyncStatus, editsSyncKey, syncFilename, listForSyncKey,
  rescoredFilename, persistSyncTarget, activateSyncTarget,
} from '../data/disk-sync.js';
import { afterTransition } from './components.js';

// ─── Boot reconnect splash ────────────────────────────────────────────────────

// Must run inside a click — FSA gates requestPermission/pickers on a user gesture,
// so calling this off a gesture silently fails.
async function regrantSyncTarget(key) {
  const t = syncTargets.get(key);
  if (!t) return false;
  if (await Disk.requestPermission(t.handle, 'readwrite') && await Disk.lastModified(t.handle) !== null) {
    await activateSyncTarget(key);
    SyncStatus.set(key, 'synced');
    return true;
  }
  return repickSyncTarget(key);
}

async function repickSyncTarget(key) {
  const isEdits = key === editsSyncKey();
  let handle;
  if (isEdits) {
    handle = await Disk.pickExisting();
    if (handle && !await Disk.requestPermission(handle, 'readwrite')) return false;
  } else {
    handle = await Disk.pickNew(syncFilename(key) || rescoredFilename(listForSyncKey(key)));
  }
  if (!handle) return false;
  syncTargets.set(key, isEdits ? { handle, baseline: '' } : { handle });
  await persistSyncTarget(key);
  await activateSyncTarget(key);
  SyncStatus.set(key, 'synced');
  return true;
}

export const ReconnectSplash = (() => {
  let _hasAnimatedIn = false;

  function ensureOverlay() {
    let overlay = document.getElementById('splash-screen');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'splash-screen';
    overlay.innerHTML = `<div class="splash-logo">Grawlix <span class="bubble">!@#$</span></div><div class="splash-spinner worm-spinner"><span></span><span></span><span></span></div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function show(keys) {
    return new Promise(resolve => {
      const overlay = ensureOverlay();
      const spinner = overlay.querySelector('.splash-spinner');
      if (spinner) spinner.hidden = true;
      const pending = new Set(keys);

      const finish = () => {
        overlay.classList.add('done');
        afterTransition(overlay, () => overlay.remove(), { property: 'opacity', timeout: 600 });
        resolve();
      };

      function render() {
        overlay.querySelectorAll('.splash-reconnect').forEach(e => e.remove());
        const wrap = document.createElement('div');
        wrap.className = _hasAnimatedIn ? 'splash-reconnect' : 'splash-reconnect animated';
        _hasAnimatedIn = true;

        const intro = document.createElement('p');
        intro.className = 'splash-reconnect-intro';
        intro.textContent = pending.size === 1
          ? 'Reopen your synced file to resume syncing.'
          : 'Reopen your synced files to resume syncing.';
        wrap.appendChild(intro);

        for (const key of pending) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'primary splash-reconnect-open';
          btn.textContent = `Open ${syncFilename(key)}`;
          btn.onclick = async () => {
            btn.disabled = true;
            const ok = await regrantSyncTarget(key);
            btn.disabled = false;
            if (!ok) return;
            pending.delete(key);
            pending.size ? render() : finish();
          };
          wrap.appendChild(btn);
        }

        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'splash-reconnect-skip';
        skip.textContent = 'Skip for now';
        skip.onclick = finish;
        wrap.appendChild(skip);

        overlay.appendChild(wrap);
        wrap.querySelector('.splash-reconnect-open')?.focus();
      }

      render();
    });
  }

  return { show };
})();
