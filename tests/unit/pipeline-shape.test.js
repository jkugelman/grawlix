import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentAtomCount, isFilterOnlyChain, isGroupChain, chainProducesMultiAtom,
  bucketize, cacheGroupStats, unify, collapseRepeatAtoms,
  flattenAtoms, bottomLineAtoms, applyViewFilterToRows, rowLastEntry,
} from '../../site/src/engine/executor.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

// A minimal stack-row factory — only the members currentAtomCount and the chain
// predicates read: kind(), isInert(), inverted(), reversed(), inputHi(), outputHi().
// No `state`, no catalog: shipped makeToolRow reads TOOLS, so it can't be fenced.
function makeToolRow({ kind = 'filter', inert = false, input = 'plain', output = 'plain', invert = false, reverse = false } = {}) {
  const def = { input, output, reversible: reverse };
  const reversed = () => reverse;
  return {
    kind: () => kind,
    isInert: () => inert,
    inverted: () => invert && kind === 'filter',
    reversed,
    inputHi: () => (reversed() ? def.output : def.input) === 'highlight',
    outputHi: () => (reversed() ? def.input : def.output) === 'highlight',
    inputShown: () => (reversed() ? def.output : def.input) !== 'hidden',
    outputShown: () => (reversed() ? def.input : def.output) !== 'hidden',
    def,
  };
}
const search        = () => makeToolRow({ kind: 'filter', input: 'highlight' });
const notSearch     = () => makeToolRow({ kind: 'filter', input: 'highlight', invert: true });
const notPlain      = () => makeToolRow({ kind: 'filter', invert: true });
const plainFilter   = () => makeToolRow({ kind: 'filter', input: 'plain' });
const plainXform    = () => makeToolRow({ kind: 'transform', input: 'plain', output: 'plain' });
const markedXform   = () => makeToolRow({ kind: 'transform', input: 'highlight', output: 'highlight' });
const inputXform    = () => makeToolRow({ kind: 'transform', input: 'highlight', output: 'plain' });
const groupRow      = () => makeToolRow({ kind: 'group' });
const inertSearch   = () => makeToolRow({ kind: 'filter', inert: true, input: 'highlight' });

const wl = (norm, score = 0) => ({ norm, display: null, score, comment: '' });
// `slot` true => the atom holds a highlight slot (highlights an array); false =>
// highlights null. collapseRepeatAtoms folds on slot-ness, not array contents,
// so an empty-array slot must stay distinct from a null non-slot.
const atom = (norm, { score = 0, slot = false, glyph = null } = {}) =>
  ({ wlEntry: wl(norm, score), highlights: slot ? [] : null, glyph });
const chain = (...atoms) => ({ atoms });

// A standalone yielder for the async helpers — never due, so they never await.
const noYield = { due: () => false, yield: async () => {} };

// Emit the atom array a real executor (runToolStage) would build for a stack,
// so the collapse/count agreement is pinned against the actual production shape.
// The glyph assignment is load-bearing: runToolStage gives a filter's slot atom
// and a transform's input-mark glyph null (so they fold into a same-word
// predecessor), but a transform's OUTPUT atom a non-null relation glyph (so it
// never folds). Get those wrong and collapse/count drift here without drifting
// in the app — the test would lie.
function emitAtoms(stack) {
  let atoms = [atom('w0')];   // originator: highlights null, glyph null
  let wordSeq = 0;
  for (const row of stack) {
    if (row.isInert()) continue;
    const tail = atoms[atoms.length - 1];
    if (row.kind() === 'transform') {
      if (row.def.input === 'highlight') atoms.push(atom(tail.wlEntry.norm, { slot: true }));
      atoms.push(atom('w' + (++wordSeq), { slot: row.def.output === 'highlight', glyph: '→' }));
    } else if (row.def.input === 'highlight' && !row.inverted()) {   // highlighting filter
      atoms.push(atom(tail.wlEntry.norm, { slot: true }));
    }
  }
  return atoms;
}

// ─── currentAtomCount ↔ collapseRepeatAtoms agreement (the top pin) ──────────

// The whole point: the static count and the actual collapse must never drift.
// For each stack, the number of atoms collapseRepeatAtoms leaves on the emitted
// row must equal currentAtomCount's prediction.
const agreementStacks = {
  'empty stack (originator only)': [],
  'single search': [search()],
  'two searches stack distinct slots': [search(), search()],
  'three searches': [search(), search(), search()],
  'plain filter alone (no atom)': [plainFilter()],
  'search then plain filter': [search(), plainFilter()],
  'plain transform': [plainXform()],
  'plain transform then search': [plainXform(), search()],
  'marked transform': [markedXform()],
  'marked transform then search': [markedXform(), search()],
  'search then marked transform': [search(), markedXform()],
  'input-marked transform': [inputXform()],
  'search then input-marked transform': [search(), inputXform()],
  'inert search is transparent': [inertSearch(), search()],
  'mixed pipeline': [search(), plainFilter(), plainXform(), search(), markedXform()],
  'inverted search claims no slot': [notSearch()],
  'inverted search after a plain one': [search(), notSearch()],
  'inverted search before a plain one': [notSearch(), search()],
  'inverted plain filter': [notPlain()],
  'inverted search around a transform': [notSearch(), markedXform(), notSearch()],
};
for (const [name, stack] of Object.entries(agreementStacks)) {
  test(`agreement: currentAtomCount equals collapseRepeatAtoms length — ${name}`, () => {
    const collapsed = collapseRepeatAtoms(emitAtoms(stack)).length;
    assert.equal(currentAtomCount(stack), collapsed,
      `predicted ${currentAtomCount(stack)} but collapse left ${collapsed}`);
  });
}

test('currentAtomCount: bare stack is the lone originator atom', () => {
  assert.equal(currentAtomCount([]), 1);
});

test('currentAtomCount: the first search folds into the originator; later searches add a line', () => {
  // The first highlight slot fills the originator's own slot (tailSlot starts
  // false), so one search is still a single atom. Each subsequent search is a
  // new line. This is the non-obvious off-by-one the renderer depends on.
  assert.equal(currentAtomCount([search()]), 1);
  assert.equal(currentAtomCount([search(), search()]), 2);
  assert.equal(currentAtomCount([search(), search(), search()]), 3);
});

test('currentAtomCount: a plain (non-highlighting) filter adds no atom', () => {
  assert.equal(currentAtomCount([plainFilter()]), 1);
  assert.equal(currentAtomCount([search(), plainFilter()]), 1);
});

test('currentAtomCount: a marked transform after a search adds input-mark + output', () => {
  // search leaves a slot tail (count 1). Marked transform: input highlight &&
  // tailSlot => +1 (the input mark can't fold into a slot tail), then +1 output.
  assert.equal(currentAtomCount([search(), markedXform()]), 3);
});

test('currentAtomCount: a marked transform with no slot tail folds its input mark', () => {
  // originator tail is NOT a slot, so the input mark folds: just +1 for output.
  assert.equal(currentAtomCount([markedXform()]), 2);
});

test('currentAtomCount: an inert row is skipped entirely', () => {
  assert.equal(currentAtomCount([inertSearch()]), 1);
  // The lone live search still folds into the originator, so the count is 1.
  assert.equal(currentAtomCount([inertSearch(), search()]), 1);
});

test('currentAtomCount: a tuple stage leaves a slot tail, so a downstream search adds a line', () => {
  const tupleRow = makeToolRow({ kind: 'tuple' });
  assert.equal(currentAtomCount([tupleRow]), 1);             // lanes are one (colored) atom
  assert.equal(currentAtomCount([tupleRow, search()]), 2);   // the search can't fold into the slot
  assert.equal(currentAtomCount([tupleRow, search(), search()]), 3);
  assert.equal(currentAtomCount([search(), search(), tupleRow]), 1);  // the tuple stage re-seeds, dropping upstream lines
});

// ─── collapseRepeatAtoms (standalone) ────────────────────────────────────────

test('collapseRepeatAtoms: a single atom passes through', () => {
  const a = atom('cat');
  assert.deepEqual(collapseRepeatAtoms([a]), [a]);
});

test('collapseRepeatAtoms: originator + same-word non-slot repeat folds to one', () => {
  const out = collapseRepeatAtoms([atom('cat'), atom('cat')]);
  assert.equal(out.length, 1);
});

test('collapseRepeatAtoms: two same-word slot atoms stay distinct (three searches => three lines)', () => {
  const out = collapseRepeatAtoms([atom('cat', { slot: true }), atom('cat', { slot: true })]);
  assert.equal(out.length, 2);
});

test('collapseRepeatAtoms: a non-slot atom folding into the slot survivor keeps the slot', () => {
  const out = collapseRepeatAtoms([atom('cat'), atom('cat', { slot: true })]);
  assert.equal(out.length, 1);
  assert.notEqual(out[0].highlights, null);
});

test('collapseRepeatAtoms: different words never fold', () => {
  const out = collapseRepeatAtoms([atom('cat'), atom('dog'), atom('cat')]);
  assert.equal(out.length, 3);
});

test('collapseRepeatAtoms: a glyph on the candidate blocks the fold', () => {
  const out = collapseRepeatAtoms([atom('cat'), atom('cat', { glyph: '→' })]);
  assert.equal(out.length, 2);
});

// ─── unify: symmetric mirror collapse ────────────────────────────────────────

// A directed transform emits both halves of a pair. Each row's atoms carry a
// glyph so the ↔ promotion is observable.
const mirrorRow = (a, sa, b, sb) =>
  chain(atom(a, { score: sa, glyph: '→' }), atom(b, { score: sb, glyph: '→' }));

test('unify: a mirror pair (STRESSED ↔ DESSERTS) collapses to one row with ↔ glyphs', async () => {
  const rows = [
    mirrorRow('stressed', 10, 'desserts', 20),
    mirrorRow('desserts', 20, 'stressed', 10),
  ];
  const out = await unify(rows, noYield);
  assert.equal(out.length, 1);
  // Survivor is the lexicographically-smaller forward chain: "desserts\0stressed".
  assert.deepEqual(out[0].atoms.map(a => a.wlEntry.norm), ['desserts', 'stressed']);
  assert.deepEqual(out[0].atoms.map(a => a.glyph), ['↔', '↔']);
});

test('unify: mirror with non-mirrored scores does NOT collapse', () => {
  // Reverse chain but the scores don't mirror, so the pair stays two rows.
  return unify([
    mirrorRow('stressed', 10, 'desserts', 20),
    mirrorRow('desserts', 99, 'stressed', 10),
  ], noYield).then(out => {
    assert.equal(out.length, 2);
  });
});

test('unify: two unrelated (non-reverse) rows both survive', async () => {
  const out = await unify([
    chain(atom('cat', { glyph: '→' }), atom('dog', { glyph: '→' })),
    chain(atom('fish', { glyph: '→' }), atom('bird', { glyph: '→' })),
  ], noYield);
  assert.equal(out.length, 2);
});

test('unify: a palindrome chain (fwd === rev) is never treated as a mirror', async () => {
  // Each row's two same-word atoms collapse to a single 'a', so fwd === rev and
  // the mirror branch is skipped — without that guard a self-reverse would fold
  // a row against itself and silently halve the result.
  const out = await unify([
    chain(atom('a', { glyph: '→' }), atom('a', { glyph: '→' })),
    chain(atom('a', { glyph: '→' }), atom('a', { glyph: '→' })),
  ], noYield);
  assert.equal(out.length, 2);
});

test('unify: collapses each row internally via collapseRepeatAtoms first', async () => {
  const out = await unify([chain(atom('cat'), atom('cat'))], noYield);
  assert.equal(out.length, 1);
  assert.equal(out[0].atoms.length, 1);
});

// ─── bucketize ────────────────────────────────────────────────────────────────

// ctx stub: forEach mirrors makeCtx's (synchronous fn, async signature), plus a
// wordlist passthrough. def.group.key buckets by the chosen field.
const ctxStub = () => ({
  wordlist: { name: 'w' },
  async forEach(iterable, fn) { let i = 0; for (const x of iterable) fn(x, i++); },
});
const bucketDef = (extra = {}) => ({ matchOn: 'norm', group: { key: s => s.slice(0, 1) }, ...extra });
const single = (norm, score) => chain(atom(norm, { score }));

test('bucketize: a singleton bucket is dropped (needs >= 2 members)', async () => {
  const groups = await bucketize([single('apple', 1), single('banana', 2)], bucketDef(), ctxStub());
  assert.equal(groups.length, 0);
});

test('bucketize: buckets with 2+ members survive, keyed by the group key', async () => {
  const groups = await bucketize(
    [single('apple', 1), single('apricot', 2), single('banana', 3)],
    bucketDef(), ctxStub(),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'a');
  assert.equal(groups[0].chains.length, 2);
});

test('bucketize: members within a group sort by score desc, then norm asc', async () => {
  const groups = await bucketize(
    [single('ant', 5), single('ape', 5), single('axe', 9)],
    bucketDef(), ctxStub(),
  );
  assert.equal(groups.length, 1);
  // axe(9) first; then ant & ape tie at 5, broken by norm asc: ant before ape.
  assert.deepEqual(groups[0].chains.map(c => rowLastEntry(c).norm), ['axe', 'ant', 'ape']);
});

test('bucketize: a falsy key skips the chain entirely', async () => {
  const groups = await bucketize(
    [single('apple', 1), single('apricot', 2)],
    bucketDef({ group: { key: s => (s.startsWith('apr') ? '' : 'keep') } }),
    ctxStub(),
  );
  // apricot keys to '' (dropped); apple alone is a singleton => dropped.
  assert.equal(groups.length, 0);
});

test('bucketize: an anchorFn with no anchor drops the whole group', async () => {
  const groups = await bucketize(
    [single('apple', 1), single('apricot', 2)],
    bucketDef({ group: { key: s => s.slice(0, 1), anchor: () => null } }),
    ctxStub(),
  );
  assert.equal(groups.length, 0);
});

test('bucketize: one member set under two keys emits a single group', async () => {
  const groups = await bucketize(
    [single('ant', 1), single('ape', 2)],
    bucketDef({ group: { key: () => ['k1', 'k2'] } }),
    ctxStub(),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'k1');
  assert.deepEqual(groups[0].chains.map(c => rowLastEntry(c).norm), ['ape', 'ant']);
});

test('bucketize: a group whose members all sit in a larger one is dropped', async () => {
  const groups = await bucketize(
    [single('ant', 1), single('ape', 2), single('axe', 3)],
    bucketDef({ group: { key: s => (s === 'axe' ? ['big'] : ['big', 'small']) } }),
    ctxStub(),
  );
  assert.deepEqual(groups.map(g => g.key), ['big']);
  assert.equal(groups[0].chains.length, 3);
});

test('bucketize: overlapping groups both survive — neither holds the other', async () => {
  const keys = { ant: ['x'], ape: ['x', 'y'], axe: ['y'] };
  const groups = await bucketize(
    [single('ant', 1), single('ape', 2), single('axe', 3)],
    bucketDef({ group: { key: s => keys[s] } }),
    ctxStub(),
  );
  assert.deepEqual(groups.map(g => g.key), ['x', 'y']);
});

// The key rides on the row as the anchor, so these are two answers about one pair.
test('bucketize: one member set under two anchors keeps both groups', async () => {
  const groups = await bucketize(
    [single('ant', 1), single('ape', 2)],
    bucketDef({ group: { key: () => ['a', 'b'], anchor: key => ({ norm: key, score: 0 }) } }),
    ctxStub(),
  );
  assert.deepEqual(groups.map(g => g.key), ['a', 'b']);
});

test('bucketize: an anchorFn returning a value attaches it to the group', async () => {
  const anchorVal = { norm: 'a', score: 1 };
  const groups = await bucketize(
    [single('apple', 1), single('apricot', 2)],
    bucketDef({ group: { key: s => s.slice(0, 1), anchor: () => anchorVal } }),
    ctxStub(),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].anchor, anchorVal);
});

// ─── cacheGroupStats ───────────────────────────────────────────────────────────

test('cacheGroupStats: caches min/max score across all atoms and the chain count', () => {
  const g = {
    chains: [
      chain(atom('a', { score: 5 }), atom('b', { score: 20 })),
      chain(atom('c', { score: -3 }), atom('d', { score: 12 })),
    ],
  };
  cacheGroupStats(g);
  assert.equal(g._minScore, -3);
  assert.equal(g._maxScore, 20);
  assert.equal(g._count, 2);
});

// ─── flattenAtoms ────────────────────────────────────────────────────────────

test('flattenAtoms: emits each atom wlEntry in row order', () => {
  const e1 = wl('cat', 1), e2 = wl('dog', 2);
  const rows = [{ atoms: [{ wlEntry: e1, highlights: null }, { wlEntry: e2, highlights: null }] }];
  assert.deepEqual(flattenAtoms(rows), [e1, e2]);
});

test('flattenAtoms: a repeated same-word atom (multi-search row) is counted once', () => {
  const e1 = wl('cat', 1);
  const rows = [{ atoms: [{ wlEntry: e1 }, { wlEntry: e1 }, { wlEntry: wl('dog', 2) }] }];
  assert.deepEqual(flattenAtoms(rows).map(e => e.norm), ['cat', 'dog']);
});

test('flattenAtoms: group rows fan out across their chains', () => {
  const rows = [{ chains: [chain(atom('a')), chain(atom('b'))] }];
  assert.deepEqual(flattenAtoms(rows).map(e => e.norm), ['a', 'b']);
});

// ─── bottomLineAtoms ───────────────────────────────────────────────────────────

test('bottomLineAtoms: extracts the last atom wlEntry of each row', () => {
  const tail = wl('dog', 2);
  const rows = [{ atoms: [{ wlEntry: wl('cat', 1) }, { wlEntry: tail }] }];
  assert.deepEqual(bottomLineAtoms(rows), [tail]);
});

test('bottomLineAtoms: for group rows, the last atom of each chain', () => {
  const rows = [{ chains: [
    chain(atom('a'), atom('b')),
    chain(atom('c'), atom('d')),
  ] }];
  assert.deepEqual(bottomLineAtoms(rows).map(e => e.norm), ['b', 'd']);
});

// ─── applyViewFilterToRows ─────────────────────────────────────────────────────

const range = (min, max) => [{ min, max }];
const scoreFilter = (min, max) => ({ score: range(min, max), length: null });
const lengthFilter = (min, max) => ({ score: null, length: range(min, max) });

test('applyViewFilterToRows: a null filter returns the input rows by reference', () => {
  const rows = [single('cat', 5)];
  assert.equal(applyViewFilterToRows(rows, null, 'single'), rows);
});

test('applyViewFilterToRows (ungrouped): keeps only rows whose every atom is in range', () => {
  const inRange = chain(atom('a', { score: 10 }), atom('b', { score: 20 }));
  const outOfRange = chain(atom('c', { score: 10 }), atom('d', { score: 99 }));
  const out = applyViewFilterToRows([inRange, outOfRange], scoreFilter(0, 50), 'single');
  assert.deepEqual(out, [inRange]);
});

test('applyViewFilterToRows (grouped): drops groups left with fewer than 2 chains', () => {
  const g = { key: 'a', anchor: null, chains: [
    chain(atom('ant', { score: 5 })),
    chain(atom('ape', { score: 99 })),   // filtered out by range, leaving 1
  ] };
  const out = applyViewFilterToRows([g], scoreFilter(0, 50), 'set');
  assert.equal(out.length, 0);
});

test('applyViewFilterToRows (grouped): a surviving group recaches its stats', () => {
  const g = { key: 'a', anchor: null, chains: [
    chain(atom('ant', { score: 5 })),
    chain(atom('axe', { score: 9 })),
    chain(atom('ape', { score: 99 })),   // dropped
  ] };
  const out = applyViewFilterToRows([g], scoreFilter(0, 50), 'set');
  assert.equal(out.length, 1);
  assert.equal(out[0].chains.length, 2);
  assert.equal(out[0]._minScore, 5);
  assert.equal(out[0]._maxScore, 9);
  assert.equal(out[0]._count, 2);
  // A fresh object, not the input group mutated in place.
  assert.notEqual(out[0], g);
});

test('applyViewFilterToRows (grouped): an out-of-range anchor drops the group', () => {
  const g = { key: 'a', anchor: { score: 999 }, chains: [
    chain(atom('ant', { score: 5 })),
    chain(atom('axe', { score: 9 })),
  ] };
  assert.equal(applyViewFilterToRows([g], scoreFilter(0, 50), 'set').length, 0);
});

test('applyViewFilterToRows (grouped): drops a group whose in-range survivors are all non-matchers', () => {
  const g = { key: 'a', anchor: null, chains: [
    { ...chain(atom('ccccc', { score: 40 })), matched: false },
    { ...chain(atom('uuuuu', { score: 40 })), matched: false },
    { ...chain(atom('zzzzz', { score: 10 })), matched: true },   // the match, below range
  ] };
  assert.equal(applyViewFilterToRows([g], scoreFilter(30, 99), 'set').length, 0);
});

test('applyViewFilterToRows (grouped): keeps a group with an in-range matcher', () => {
  const g = { key: 'a', anchor: null, chains: [
    { ...chain(atom('zzzemoji', { score: 60 })), matched: true },
    { ...chain(atom('bbbemoji', { score: 50 })), matched: false },
  ] };
  assert.equal(applyViewFilterToRows([g], scoreFilter(30, 99), 'set').length, 1);
});

test('applyViewFilterToRows (grouped): untagged chains (no grouped filter) are not gated', () => {
  const g = { key: 'a', anchor: null, chains: [
    chain(atom('ant', { score: 40 })),
    chain(atom('axe', { score: 50 })),
  ] };
  assert.equal(applyViewFilterToRows([g], scoreFilter(30, 99), 'set').length, 1);
});

test('applyViewFilterToRows (tuple): drops a tuple with any out-of-range lane, never trims', () => {
  const allIn = { key: 'a', anchor: null, chains: [
    chain(atom('dogcat', { score: 50 })), chain(atom('dogball', { score: 50 })), chain(atom('catchain', { score: 50 })),
  ] };
  const oneLow = { key: 'b', anchor: null, chains: [
    chain(atom('bluelight', { score: 50 })), chain(atom('blueball', { score: 20 })), chain(atom('lightchain', { score: 50 })),
  ] };
  const out = applyViewFilterToRows([allIn, oneLow], scoreFilter(30, 99), 'record');
  assert.deepEqual(out.map(g => g.key), ['a']);
  assert.equal(out[0].chains.length, 3);   // kept whole — a trim to 2 lanes is the bug
  assert.equal(out[0]._count, 3);          // stats recached over the full tuple
});

// ─── chain predicates ──────────────────────────────────────────────────────────

test('isFilterOnlyChain: true with only filters, false once a live transform appears', () => {
  assert.equal(isFilterOnlyChain([search(), plainFilter()]), true);
  assert.equal(isFilterOnlyChain([search(), plainXform()]), false);
  // an inert transform does not break filter-only.
  assert.equal(isFilterOnlyChain([makeToolRow({ kind: 'transform', inert: true })]), true);
});

test('isGroupChain: true iff a live group row is present', () => {
  assert.equal(isGroupChain([groupRow()]), true);
  assert.equal(isGroupChain([search(), groupRow()]), true);
  assert.equal(isGroupChain([search(), plainXform()]), false);
  assert.equal(isGroupChain([makeToolRow({ kind: 'group', inert: true })]), false);
});

test('chainProducesMultiAtom: true for a live transform or a highlighting filter', () => {
  assert.equal(chainProducesMultiAtom([plainXform()]), true);     // transform
  assert.equal(chainProducesMultiAtom([search()]), true);         // highlighting filter
  assert.equal(chainProducesMultiAtom([plainFilter()]), false);   // plain filter only
  assert.equal(chainProducesMultiAtom([]), false);
  // inert rows don't count.
  assert.equal(chainProducesMultiAtom([inertSearch()]), false);
});
