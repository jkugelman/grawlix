'use strict';

// ─── Derived layouts ──────────────────────────────────────────────────────────

import { MERGED_ID } from '../core/constants.js';
import { state, bumpConfigSummary } from './state.js';
import { EMPTY_HISTOGRAM_LAYOUT } from '../engine/histogram.js';

// The worker ships this axis on selfReady; it's the badge-gradient axis
// scoreColor reads, over the same all-sources score union the worker builds.
let _shippedAxis = null, _shippedAxisVersion = -1;
export function setShippedAllSourcesAxis(axis, version) {
  if (version === _shippedAxisVersion) return;
  _shippedAxis = axis;
  _shippedAxisVersion = version;
  bumpConfigSummary();   // the badge axis ships async; repaint score badges
}
export function shippedAllSourcesAxisVersion() { return _shippedAxisVersion; }

// The scope-key guard is load-bearing: after a scope switch but before the new
// result lands, the holder still names the previous scope's layout — using it
// would mis-bin the new scope.
let _shippedScopedLayout = null, _shippedScopedScopeKey = null;
export function setShippedScopedLayout(layout, scopeKey) {
  _shippedScopedLayout = layout;
  _shippedScopedScopeKey = scopeKey;
}
export function shippedScopedLayoutScopeKey() { return _shippedScopedScopeKey; }

export function scopedHistogramLayout() {
  // MERGED uses the shipped all-sources axis; a scoped view uses the worker's
  // scope-keyed layout. Until the worker's layout lands (cold boot, a scope-switch
  // transient) main has no scoped corpus to bucket, so it shows the empty layout;
  // the value is replaced the instant the run's layout arrives.
  if (state.selected === MERGED_ID) {
    if (_shippedAxis) return _shippedAxis;
  } else if (_shippedScopedLayout && _shippedScopedScopeKey === state.selected?.dbKey) {
    return _shippedScopedLayout;
  }
  return EMPTY_HISTOGRAM_LAYOUT;
}

// A fixed all-sources axis, used by scoreColor's badge gradient: pointing it at
// the scoped axis would shift badge colors on every scope change, a
// regression no error would surface.
export function allSourcesHistogramLayout() {
  return _shippedAxis ?? EMPTY_HISTOGRAM_LAYOUT;
}
