'use strict';

// ─── Fetch status registry ────────────────────────────────────────────────────

import { signal } from '../core/signals.js';

// The signal hop (vs. the app calling the panel directly) keeps data/ off ui/,
// same as syncStatus$. Each handle's stop/retry/dismiss are thunks the app
// installs, so the panel drives a fetch without importing upward into app/.
export const fetchStatus$ = signal(0);

const _handles = new Map();   // key (wordlist.dbKey) -> handle

export function fetchHandles() { return [..._handles.values()]; }

export function putFetchHandle(handle) { _handles.set(handle.key, handle); fetchStatus$.bump(); }
export function dropFetchHandle(key) { _handles.delete(key); fetchStatus$.bump(); }

export function bumpFetchStatus() { fetchStatus$.bump(); }
