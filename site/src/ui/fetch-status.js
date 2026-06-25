'use strict';

// ─── Fetch status (download manager) ──────────────────────────────────────────

import { esc, formatBytes } from '../core/util.js';
import { fetchHandles } from '../data/fetch-status.js';
import { buildWordlistNameIconHTML } from './scope-selector.js';
import { notifyStack } from './notify-stack.js';

// The segment is swept by the bytes actually arriving (not a constant
// animation), so a stall freezes it mid-sweep. Speed is compressive, not linear
// in the rate: it saturates toward FULL_SWEEP_HZ once the rate clears RATE_KNEE,
// so any real download reads as "moving" and only a near-stall crawls — the goal
// is stalled-vs-moving, not exact bytes/s (linear made slow-but-fine 3G crawl).
// The rate feeding it is EMA-smoothed (RATE_TAU = time constant, seconds).
const RATE_TAU = 0.4;
const FULL_SWEEP_HZ = 0.9;        // sweeps/sec at full speed (≈ the old animation)
const RATE_KNEE = 16 * 1024;      // bytes/sec at which the sweep is ~63% of full

let _containerEl = null;
const _rowEls = new Map();   // handle.key -> row element
let _rafId = 0;
let _lastFrame = 0;

function container() {
  if (_containerEl) return _containerEl;
  _containerEl = document.createElement('div');
  _containerEl.id = 'fetch-status';
  _containerEl.hidden = true;
  notifyStack().appendChild(_containerEl);
  return _containerEl;
}

function rowHTML(h) {
  return `<div class="fetch-row-name">${buildWordlistNameIconHTML(h.wordlist)}</div>
    <div class="fetch-row-meta">Downloaded ${esc(formatBytes(h.bytesLoaded))}</div>
    <div class="fetch-bar" aria-hidden="true"><span></span></div>`;
}

export function renderFetchStatus() {
  const el = container();
  const rows = fetchHandles().filter(h => h.revealed);
  const seen = new Set();
  for (const h of rows) {
    seen.add(h.key);
    let rowEl = _rowEls.get(h.key);
    if (!rowEl) {
      rowEl = document.createElement('div');
      rowEl.className = 'fetch-row';
      rowEl.innerHTML = rowHTML(h);
      rowEl._rate = 0;
      rowEl._lastBytes = h.bytesLoaded;
      rowEl._phase = 0;
      _rowEls.set(h.key, rowEl);
      el.appendChild(rowEl);
    } else {
      rowEl.querySelector('.fetch-row-meta').textContent = `Downloaded ${formatBytes(h.bytesLoaded)}`;
    }
    rowEl._handle = h;
  }
  for (const [key, rowEl] of _rowEls) {
    if (!seen.has(key)) { rowEl.remove(); _rowEls.delete(key); }
  }
  el.hidden = rows.length === 0;
  syncSweep();
}

function syncSweep() {
  if (_rowEls.size && !_rafId) { _lastFrame = 0; _rafId = requestAnimationFrame(sweepFrame); }
  else if (!_rowEls.size && _rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
}

function sweepFrame(now) {
  const dt = _lastFrame ? (now - _lastFrame) / 1000 : 0;
  _lastFrame = now;
  if (dt > 0) {
    // Frame-rate-independent EMA: a fixed per-frame weight would smooth more on
    // slow frames, reintroducing the jitter the smoothing is there to remove.
    const alpha = 1 - Math.exp(-dt / RATE_TAU);
    for (const rowEl of _rowEls.values()) {
      const bytes = rowEl._handle.bytesLoaded;
      const instant = (bytes - rowEl._lastBytes) / dt;
      rowEl._lastBytes = bytes;
      rowEl._rate += alpha * (instant - rowEl._rate);
      const speed = FULL_SWEEP_HZ * (1 - Math.exp(-rowEl._rate / RATE_KNEE));
      rowEl._phase = (rowEl._phase + speed * dt) % 1;
      // -40%..100% keeps the 40%-wide segment fully off-screen at both ends, so
      // the phase wrap is invisible — no seam.
      rowEl.querySelector('.fetch-bar span').style.left = `${-40 + rowEl._phase * 140}%`;
    }
  }
  _rafId = requestAnimationFrame(sweepFrame);
}
