'use strict';

// ─── Histogram pointer interaction ───────────────────────────────────────────

import { parseRange, matchesRange } from '../engine/range.js';
import { slotIntersectsRange } from '../engine/histogram.js';
import { scopedHistogramLayout } from '../data/derived.js';
import { AppView, syncScoreRangeButton } from './app-view.js';

let _histDrag = null;

export function rangeStrFromBounds(lo, hi, layout) {
  if (lo === hi) return String(lo);
  const max = layout.slots.length ? layout.slots[layout.slots.length - 1].hi : null;
  if (max != null && hi >= max) return `${lo}+`;
  return `${lo}-${hi}`;
}

function _slotAt(histEl, clientX) {
  const cols = histEl.querySelectorAll('.histogram-col');
  if (!cols.length) return null;
  const x = clientX - histEl.getBoundingClientRect().left;
  const first = cols[0];
  const stride = cols.length >= 2 ? (cols[1].offsetLeft - first.offsetLeft) : (first.offsetWidth + 3);
  if (x < first.offsetLeft) return null;
  let idx = Math.floor((x - first.offsetLeft) / stride);
  if (idx >= cols.length) idx = cols.length - 1;
  const bar = cols[idx].querySelector('.histogram-bar');
  return { idx, lo: +bar.dataset.lo, hi: +bar.dataset.hi };
}

export function onHistogramPointerDown(event) {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  const hist = event.currentTarget;
  const slot = _slotAt(hist, event.clientX);
  if (!slot) return;
  event.preventDefault();
  hist.setPointerCapture?.(event.pointerId);
  _histDrag = {
    pointerId: event.pointerId,
    histEl: hist,
    startLo: slot.lo, startHi: slot.hi,
    curLo: slot.lo, curHi: slot.hi,
    moved: false,
  };
  // No rect update here — wait for first pointermove so a click-to-clear doesn't flash a one-bar preview.
}

function _onHistogramPointerMove(event) {
  if (!_histDrag || event.pointerId !== _histDrag.pointerId) return;
  const slot = _slotAt(_histDrag.histEl, event.clientX);
  if (!slot) return;
  if (slot.lo === _histDrag.curLo && slot.hi === _histDrag.curHi) return;
  _histDrag.curLo = slot.lo;
  _histDrag.curHi = slot.hi;
  if (slot.lo !== _histDrag.startLo || slot.hi !== _histDrag.startHi) _histDrag.moved = true;
  const rangeLo = Math.min(_histDrag.startLo, slot.lo);
  const rangeHi = Math.max(_histDrag.startHi, slot.hi);
  positionHistogramRect(_histDrag.histEl, [{ min: rangeLo, max: rangeHi }]);
}

function _onHistogramPointerUp(event) {
  if (!_histDrag || event.pointerId !== _histDrag.pointerId) return;
  const ds = _histDrag;
  _histDrag = null;
  const layout = scopedHistogramLayout();
  let next;
  if (!ds.moved && AppView.scoreRange) {
    const intervals = parseRange(AppView.scoreRange);
    const insideSelection = intervals && matchesRange(ds.startLo, intervals) && matchesRange(ds.startHi, intervals);
    next = insideSelection ? '' : rangeStrFromBounds(ds.startLo, ds.startHi, layout);
  } else {
    next = rangeStrFromBounds(Math.min(ds.startLo, ds.curLo), Math.max(ds.startHi, ds.curHi), layout);
  }
  document.querySelectorAll('#score-range-input').forEach(inp => { inp.value = next; syncScoreRangeButton(inp); });
  AppView.onScoreRange(next);
}

export function mountHistogramPointer() {
  document.addEventListener('pointermove', _onHistogramPointerMove);
  document.addEventListener('pointerup', _onHistogramPointerUp);
  document.addEventListener('pointercancel', () => { _histDrag = null; repositionAllHistogramRects(); });
}

// Pass `intervals` to override the live filter (used during drag preview).
export function positionHistogramRect(histEl, intervals = undefined) {
  const rect = histEl.querySelector('.histogram-rect');
  if (!rect) return;
  if (intervals === undefined) {
    const range = AppView.scoreRange;
    intervals = range ? parseRange(range) : null;
  }
  if (!intervals) { rect.hidden = true; return; }
  const cols = [...histEl.querySelectorAll('.histogram-col')];
  const matching = cols.filter(c => {
    const bar = c.querySelector('.histogram-bar');
    return slotIntersectsRange(+bar.dataset.lo, +bar.dataset.hi, intervals);
  });
  if (!matching.length) { rect.hidden = true; return; }
  const first = matching[0], last = matching[matching.length - 1];
  const left = first.offsetLeft - 2;
  const right = last.offsetLeft + last.offsetWidth + 2;
  rect.hidden = false;
  rect.style.left = `${left}px`;
  rect.style.width = `${right - left}px`;
}

export function repositionAllHistogramRects() {
  document.querySelectorAll('#app .histogram').forEach(h => positionHistogramRect(h));
}
