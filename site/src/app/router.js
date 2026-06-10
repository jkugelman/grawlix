'use strict';

import { TOOLS, makeToolRow } from '../engine/tools.js';
import { showToast } from '../ui/toasts.js';
import { AppView } from '../ui/app-view.js';
import { chainSortTier, DEFAULT_SORT_BY_TIER, isValidSortAxis } from '../ui/entries-table.js';
import { ToolStack } from '../ui/tool-stack.js';

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
  // One tool row → its URL key(s). The first param rides on the tool-name
  // key so the row always has an anchor (kept even when empty, so an
  // unfilled row survives reload); a param-less tool is a bare tool key.
  function encodeRow(row) {
    if (row.grouped) return [encodeURIComponent(row.tool), 'all'];
    const { params: schema } = row.def;
    const slug = encodeURIComponent(row.tool);
    if (!schema.length) return [slug];
    const parts = [slug + '=' + encodeURIComponent(row.params[schema[0].key] || '')];
    for (const p of schema.slice(1)) {
      const v = row.params[p.key];
      if (p.type === 'checkbox') { if (v) parts.push(encodeURIComponent(p.key)); }
      else if (v)                parts.push(encodeURIComponent(p.key) + '=' + encodeURIComponent(v));
    }
    return parts;
  }

  function rowIsDefault(row) {
    return row.def.params.every(p => !row.params[p.key]);
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
    stack.forEach((row, i) => {
      const isBar = i === stack.length - 1;
      if (isBar && rowIsDefault(row) && stack[i - 1]?.tool !== 'search') return;
      parts.push(...encodeRow(row));
    });
    const tier = chainSortTier(stack);
    const defaultAxis = DEFAULT_SORT_BY_TIER[tier];
    if (AppView.sortKey !== defaultAxis)                  parts.push('sort=' + AppView.sortKey);
    if (AppView.sortDir !== 'asc') parts.push('sort-dir=' + AppView.sortDir);
    return parts.join('&');
  }

  function buildSearch() {
    const query = buildQuery();
    return query ? '?' + query : '';
  }

  function navigate() {
    const target = location.pathname + buildSearch();
    if (location.pathname + location.search !== target) {
      history.replaceState(null, '', target);
    }
  }

  // Applies URL state (tool stack, search) as a side effect. The score filter
  // is loaded from localStorage in init() and doesn't participate in URL routing.
  function applyURL() {
    const params = new URLSearchParams(location.search);
    const rows = [];
    let sortKey = null;
    let sortDir = null;
    let droppedUnknown = false;
    // All param names across the catalog — lets the decoder tell a genuinely
    // unknown key (likely a removed tool) from a merely misplaced param.
    const knownParam = new Set(Object.values(TOOLS).flatMap(t => t.params.map(p => p.key)));
    // Each key is one of three things: a tool name (starts a new row, its
    // value is the first param), a reserved view-config key, or a successive
    // param of the most recent row (a bare key sets a checkbox true).
    for (const [key, value] of params) {
      if (key === 'sort')     { if (isValidSortAxis(value)) sortKey = value; continue; }
      if (key === 'sort-dir') { if (value === 'asc' || value === 'desc') sortDir = value; continue; }
      if (key === 'all') {
        const cur = rows[rows.length - 1];
        if (cur && cur.def.group) {
          if (rows.some(r => r.grouped)) {
            rows.pop();
          } else {
            cur.grouped = true;
            cur.params = {};
          }
        }
        continue;
      }
      const tool = TOOLS[key];
      if (tool) {
        const row = makeToolRow(key);
        if (tool.params.length) row.params[tool.params[0].key] = value || '';
        rows.push(row);
        continue;
      }
      const cur = rows[rows.length - 1];
      const pdef = cur && cur.def.params.find(p => p.key === key);
      if (pdef) { cur.params[key] = pdef.type === 'checkbox' ? true : (value || ''); continue; }
      // A key that's not a tool, not reserved, and not any tool's param name
      // is a genuinely unknown key — most likely a tool that's been removed.
      if (!knownParam.has(key)) droppedUnknown = true;
    }
    // The decoded rows are the full pipeline; ToolStack keeps the trailing
    // Search row as the permanent bar (appending an empty one if absent).
    // Stack is set first so applyURLState can derive the current atom count
    // when picking the sort default (a stacked-output URL with no explicit
    // sort= should pick min-score, not the 1-atom default entry).
    ToolStack.setStack(rows);
    AppView.applyURLState({ sortKey, sortDir });
    if (droppedUnknown) {
      // Defer: showToast appends to the toast container which may not be in
      // the DOM yet during initial load.
      setTimeout(() => showToast("That link references a tool that's no longer available."), 0);
    }
  }

  return { navigate, applyURL };
})();
