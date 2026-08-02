import assert from 'node:assert/strict';
import { makeToolRow } from '../../../site/src/engine/tools.js';
import { displayOf, toNorm } from '../../../site/src/engine/norm.js';
import { mergeKey } from '../../../site/src/engine/corpus.js';
import { executePipeline, rowAtoms, rowLastEntry } from '../../../site/src/engine/executor.js';

export function wlEntry(spec) {
  const o = typeof spec === 'string' ? { entry: spec } : spec;
  const norm = toNorm(o.entry);
  // null display renders as the lowercase norm; verbatim otherwise. Same rule as
  // the parser/synthWlEntry — get it wrong and assertions check the wrong casing.
  const display = o.display !== undefined ? o.display
    : (o.entry === norm ? null : o.entry);
  return { norm, display, score: o.score ?? 0, comment: o.comment ?? '' };
}

export function merged(specs) {
  const seen = new Set();
  const entries = [];
  for (const s of specs) {
    const e = wlEntry(s);
    const key = mergeKey(e.norm, e.display);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(e);
  }
  // Norm-sort to mirror the real corpus (resolveCorpus always leaves entries
  // sorted): the executor resolves a transform output to every spelling of its
  // norm by binary-searching entries, which silently misreads an unsorted mock.
  entries.sort((a, b) => a.norm < b.norm ? -1 : a.norm > b.norm ? 1
    : (a.display ?? '').localeCompare(b.display ?? ''));
  return {
    entries,
    norms: new Set(entries.map(e => e.norm)),
    byKey: new Map(entries.map(e => [mergeKey(e.norm, e.display), e])),
  };
}

// `vocab` models a scoped view: specs are the entries on screen, vocab the full
// merge tools consult for word existence. Omitted, the two coincide as they do in
// the merged scope.
export async function run(specs, stack = [], { vocab } = {}) {
  const wl = merged(specs);
  const rows = stack.map(s => makeToolRow(s.tool, { ...(s.params || {}) }, !!s.grouped, !!s.invert, !!s.reverse));
  const out = await executePipeline(wl, rows, null,   // no resume → cold; the executor holds no cross-call state
    { vocab: vocab ? merged(vocab) : wl });
  return { ...out, wordlist: wl };
}

export function rowWords(row) {
  const words = [];
  for (const atom of rowAtoms(row)) {
    const w = displayOf(atom.wlEntry);
    if (w !== words[words.length - 1]) words.push(w);
  }
  return words.length === 1 ? words[0] : words;
}

export async function visible(specs, stack = []) {
  const { rows, laneKind } = await run(specs, stack);
  assert.ok(laneKind !== 'set', 'visible(): stack produced a grouped result — use groups()');
  return rows.map(rowWords);
}

export function sameVisible(actual, expected) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

export async function groups(specs, stack) {
  const { rows, laneKind } = await run(specs, stack);
  assert.ok(laneKind === 'set', 'groups(): stack did not produce a grouped result');
  return rows.map(g => ({
    key: g.key,
    count: g.chains.length,
    anchor: g.anchor ? { entry: displayOf(g.anchor), score: g.anchor.score } : null,
    chains: g.chains.map(c => rowAtoms(c).map(a => displayOf(a.wlEntry))),
  }));
}

export const groupSeeds = g => g.chains.map(c => c[0]);

export const atomWord = atom => displayOf(atom.wlEntry);
export const rowByFirst = (rows, word) => rows.find(r => displayOf(rowAtoms(r)[0].wlEntry) === word);

export function highlightTexts(atom) {
  const e = atom.wlEntry;
  return (atom.highlights || []).map(r =>
    (r.coord === 'display' ? (e.display ?? e.norm) : e.norm).slice(r.start, r.end));
}
