'use strict';

import { TOOLS, makeToolRow } from '../engine/tools.js';

// ─── URL ⇄ tool-stack codec ──────────────────────────────────────────────────
// Must stay UI-free: node unit tests import this directly, so folding it back
// into the Router (UI layer) would break them. URL shape: docs/design.md § URL state.

// `entry` is the open entry-panel target (parsed by the Router, not a tool row).
// It's safe to reserve even though several tools have an `entry`-keyed first
// param: a first param always rides its tool-slug key, so `entry=` is never
// emitted as a standalone key by tool encoding — only the panel emits it.
const RESERVED = new Set(['sort', 'sort-dir', 'entry']);

function encodeTailParams(row, schema) {
  const parts = [];
  for (const p of schema.slice(1)) {
    if (p.repeat) continue;
    const v = row.params[p.key];
    if (v === p.default) continue;   // a value at its default decodes from absence; don't serialize it
    if (p.type === 'checkbox') { if (v) parts.push(p.value ? encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value) : encodeURIComponent(p.key)); }
    else if (v)                parts.push(encodeURIComponent(p.key) + '=' + encodeURIComponent(v));
  }
  return parts;
}

function encodeRepeatRow(row, schema, slug) {
  const reps = schema.filter(p => p.repeat);
  const n = Math.max(1, ...reps.map(p => (row.params[p.key] || []).length));
  const first = schema[0];
  const firstVal = first.repeat ? ((row.params[first.key] || [])[0] || '') : (row.params[first.key] || '');
  const parts = [slug + '=' + encodeURIComponent(firstVal)];
  for (let i = 0; i < n; i++) {
    for (const p of reps) {
      if (i === 0 && p === first) continue;
      const v = (row.params[p.key] || [])[i] || '';
      parts.push(encodeURIComponent(p.key) + '=' + encodeURIComponent(v));
    }
  }
  return parts.concat(encodeTailParams(row, schema));
}

// One tool row → its URL key(s). The first param rides on the tool-name key so
// the row always has an anchor (kept even when empty, so an unfilled row
// survives reload); a param-less tool is a bare tool key. Grouped rows keep their
// secondary params (the `all` toggle drops only the irrelevant first/entry param).
// An inverted row carries a bare `not`; a grouped one never does, since inverted()
// gates on filter kind.
export function encodeRow(row) {
  const { params: schema } = row.def;
  if (row.grouped) return [encodeURIComponent(row.tool), 'all', ...encodeTailParams(row, schema)];
  const slug = encodeURIComponent(row.tool);
  const parts = !schema.length ? [slug]
    : schema.some(p => p.repeat) ? encodeRepeatRow(row, schema, slug)
    : [slug + '=' + encodeURIComponent(row.params[schema[0].key] || ''), ...encodeTailParams(row, schema)];
  if (row.inverted()) parts.splice(1, 0, 'not');   // directly behind the slug: decode binds it to this row
  return parts;
}

// Decode the pipeline rows from a URLSearchParams. Returns the rows plus a flag
// for a genuinely unknown key (a likely-removed tool). Reserved view-config keys
// (sort, sort-dir) are skipped — the Router parses those itself. Each key is one
// of three things: a tool name (starts a new row, its value is the first param),
// the `all` grouping toggle, or a successive param of the most recent row (a bare
// key sets a checkbox true; a repeatable param appends).
export function decodeRows(params) {
  const rows = [];
  let droppedUnknown = false;
  const knownParam = new Set(Object.values(TOOLS).flatMap(t => t.params.map(p => p.key)));
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === 'all') {
      const cur = rows[rows.length - 1];
      if (cur && cur.def.group) {
        if (rows.some(r => r.grouped)) rows.pop();
        else { cur.grouped = true; cur.params = {}; }
      }
      continue;
    }
    if (key === 'not') {
      const cur = rows[rows.length - 1];
      if (cur) cur.invert = true;
      continue;
    }
    const tool = TOOLS[key];
    if (tool) {
      const row = makeToolRow(key);
      // Decode builds the repeatable arrays purely from URL values, so clear the
      // single-empty seed makeToolRow stamps for fresh UI rows before appending.
      for (const p of tool.params) if (p.repeat) row.params[p.key] = [];
      const first = tool.params[0];
      if (first) row.params[first.key] = first.repeat ? [value || ''] : (value || '');
      rows.push(row);
      continue;
    }
    const cur = rows[rows.length - 1];
    const pdef = cur && cur.def.params.find(p => p.key === key);
    if (pdef) {
      if (pdef.repeat) (cur.params[pdef.key] ||= []).push(value || '');
      else if (pdef.type === 'checkbox') cur.params[key] = pdef.value ? (value === pdef.value ? value : '') : true;
      else cur.params[key] = value || '';
      continue;
    }
    // Legacy alias: `whole-word` predates the `mode` key and anchored the
    // whole entry, so it decodes as mode=full — links in the wild carry it.
    if (key === 'whole-word') {
      if (cur && cur.def.params.some(p => p.key === 'mode')) cur.params.mode = 'full';
      continue;
    }
    if (!knownParam.has(key)) droppedUnknown = true;
  }
  // Not at the `not` key itself: `?search=a&not&replace=b` only becomes a transform
  // once a later key lands, so the kind test is only conclusive with every key in.
  for (const row of rows) if (row.invert && !row.inverted()) row.invert = false;
  return { rows, droppedUnknown };
}
