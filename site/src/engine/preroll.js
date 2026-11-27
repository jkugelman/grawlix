'use strict';

// Main and the worker must key a pre-roll identically, or main offers an
// entry rolled for a stack that's no longer on screen.
export function prerollContext(serialized, row, param, scope, scoreRange, lengthRange) {
  const stack = serialized.map((r, i) => (i === row ? { ...r, params: { ...r.params, [param]: '' } } : r));
  return JSON.stringify([scope, scoreRange || null, lengthRange || null, row, stack]);
}

// Keeps the params' key order: the result cache keys on the stack's JSON, so a
// reordered copy silently misses the result the pre-roll cached for the click.
export function withRolledEntry(serialized, row, param, display) {
  return serialized.map((r, i) => (i === row ? { ...r, params: { ...r.params, [param]: display } } : r));
}
