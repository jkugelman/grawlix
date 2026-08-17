'use strict';

import { toNorm } from '../engine/norm.js';
import { showToast } from '../ui/toasts.js';
import { AppView } from '../ui/app-view.js';
import { chainSortTier, DEFAULT_SORT_BY_TIER, isValidSortAxis, EntryPanel, entryPanelRouteValue } from '../ui/entries-table.js';
import { ToolStack } from '../ui/tool-stack.js';
import { encodeRow, decodeRows } from './url-codec.js';

// ─── Router ───────────────────────────────────────────────────────────────────
// Keeps the URL in sync with the tool stack via history.replaceState. URL shape:
//   bare URL    → no query state
//   ?<query>    → the pipeline encoded in the query string
// The bare-URL form is used when there's no query, so the most-shared case stays
// short.
//
// Query encoding: each pipeline row in order — its tool name carries the
// first param's value (`tool=value`), and each successive param is its own
// adjacent key (a bare key for a true checkbox, `key=value` for a non-empty
// text param, omitted at default). The permanent Search bar is the final
// row. See docs/design.md § URL state. The score filter is intentionally
// *not* in the URL — it's per-user (scores aren't portable across wordlist
// setups) and lives in localStorage.
export const Router = (() => {
  // A deep-linked entry param, held from applyURL until openPendingEntry opens the
  // panel. buildQuery must read it so boot's navigate() doesn't strip the param off
  // the URL before the panel claims it.
  let pendingEntry = null;

  // `invert` is a row flag, not a param, so it needs its own clause here or an
  // inverted-but-empty bar elides to a bare URL and loses the mode on reload.
  function rowIsDefault(row) {
    return !row.invert && row.def.params.every(p => !row.params[p.key]);
  }

  function buildQuery() {
    // The full pipeline — user tools plus the permanent Search bar as its
    // last row. Each row serializes via encodeRow; empty values are kept
    // (`anagram=`) so an added-but-unfilled row survives reload. The lone
    // exception is the Search bar: its keys are elided when it's at default
    // state *and* not preceded by another Search row, so an untouched app
    // stays at a bare URL while an added Search tool still round-trips.
    const stack = ToolStack.getStack();
    const parts = [];
    const entry = entryPanelRouteValue() ?? pendingEntry;
    if (entry) parts.push('entry=' + encodeURIComponent(entry));   // leads, for shareable `?entry=BAGEL&…`
    stack.forEach((row, i) => {
      const isBar = i === stack.length - 1;
      if (isBar && rowIsDefault(row) && stack[i - 1]?.tool !== 'search') return;
      parts.push(...encodeRow(row));
    });
    const defaultAxis = DEFAULT_SORT_BY_TIER[chainSortTier(stack)];
    const list = AppView.sortList;
    const isDefault = list.length === 1 && list[0].key === defaultAxis && list[0].dir === 'asc';
    if (!isDefault) {
      const enc = list.map(s => s.dir === 'asc' ? s.key : `${s.key}:${s.dir}`).join(',');
      parts.push('sort=' + enc);
    }
    return parts.join('&');
  }

  function buildSearch() {
    const query = buildQuery();
    return query ? '?' + query : '';
  }

  function navigate({ push = false } = {}) {
    const target = location.pathname + buildSearch();
    // Replace preserves history.state: the entry panel tags its pushed entry there
    // (EntryPanel.open) to drive close-time history, and a stray replace while it's
    // open must not silently wipe that tag.
    if (push) history.pushState(null, '', target);
    else if (location.pathname + location.search !== target) history.replaceState(history.state, '', target);
  }

  // Old links carried one axis in `sort=` and its direction in a separate
  // `sort-dir=`; that legacy direction rides out as `legacyDir` so a pre-multi-sort
  // shared link still decodes to the same order instead of silently dropping it.
  function parseSortParam(sortRaw, legacyDir) {
    if (!sortRaw) return null;
    const list = [];
    for (const tok of sortRaw.split(',')) {
      const [key, dir] = tok.split(':');
      if (!isValidSortAxis(key)) continue;
      list.push({ key, dir: dir === 'desc' ? 'desc' : 'asc' });
    }
    if (!list.length) return null;
    if (legacyDir && !sortRaw.includes(':')) list[0].dir = legacyDir;
    return list;
  }

  // Applies URL state (tool stack, search) as a side effect. The score filter
  // is loaded from localStorage in init() and doesn't participate in URL routing.
  function applyURL() {
    const params = new URLSearchParams(location.search);
    pendingEntry = params.get('entry') || null;
    let sortRaw = null;
    let legacyDir = null;
    for (const [key, value] of params) {
      if (key === 'sort')          sortRaw = value;
      else if (key === 'sort-dir') { if (value === 'asc' || value === 'desc') legacyDir = value; }
    }
    const sortList = parseSortParam(sortRaw, legacyDir);
    const { rows, droppedUnknown } = decodeRows(params);
    // The decoded rows are the full pipeline; ToolStack keeps the trailing
    // Search row as the permanent bar (appending an empty one if absent).
    // Stack is set first so applyURLState can derive the current atom count
    // when picking the sort default (a stacked-output URL with no explicit
    // sort= should pick min-score, not the 1-atom default entry).
    ToolStack.setStack(rows);
    AppView.applyURLState({ sortList, legacyDir });
    if (droppedUnknown) {
      // Defer: showToast appends to the toast container which may not be in
      // the DOM yet during initial load.
      setTimeout(() => showToast("That link references a tool that's no longer available."), 0);
    }
  }

  // Safe to call before the worker's corpus is built: the panel renders from this
  // param alone, and each worker-fed block (edit seed, provenance, Related) holds
  // its un-ready reply and refills on the build. Returns whether a panel opened.
  function openPendingEntry() {
    if (!pendingEntry) return false;
    const display = pendingEntry;
    pendingEntry = null;
    EntryPanel.openFromRoute({ norm: toNorm(display), display });
    return true;
  }

  return { navigate, applyURL, openPendingEntry };
})();
