import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packRecordJoin, materializeRecordRow, recordView, recordComparator, recordPasses, PackedRecordJoin, tryPackGroupJoin, buildGroupFlyweights, materializeGroupRow } from '../../site/src/engine/packed-join.js';
import { sortGroups, groupRowComparator } from '../../site/src/engine/sort.js';
import { cacheGroupStats, applyViewFilterToRows, entryPredicate } from '../../site/src/engine/executor.js';
import { parseRange } from '../../site/src/engine/range.js';

// A tuple stack: no group tool, so groupSortAxes falls to the plain GROUP_SORT_AXES —
// exactly what recordSortAxes packs.
const TUPLE_STACK = [{ kind: () => 'tuple', isInert: () => false, def: {} }];

// Build a corpus (entries with `_i` stamped) and the eager tuple groups that
// tupleToGroup would produce over it — the shape packRecordJoin consumes and the
// oracle recordComparator/recordView must match against.
function scenario(rows) {
  const byNorm = new Map();
  const entries = [];
  const entryFor = (norm, display, score) => {
    let e = byNorm.get(norm + '\0' + display);
    if (!e) { e = { norm, display, score, _i: entries.length }; entries.push(e); byNorm.set(norm + '\0' + display, e); }
    return e;
  };
  const corpus = { entries };
  const groups = rows.map(lanes => {
    const chains = lanes.map(([norm, display, score, hl]) =>
      ({ atoms: [{ wlEntry: entryFor(norm, display, score), highlights: hl ?? null, glyph: null }] }));
    const g = { key: lanes.map(l => l[0]).join(' '), chains, anchor: null };
    cacheGroupStats(g);
    return g;
  });
  return { corpus, groups };
}

const HL = [{ start: 0, end: 2, kind: 'umiaq-var-0' }];

test('materializeRecordRow round-trips key, lane entries, highlights, aggregates', () => {
  const { corpus, groups } = scenario([
    [['abcd', 'abcd', 30, HL], ['cdab', 'cdab', 70]],
    [['wxyz', 'w xyz', 15], ['yzwx', 'yzwx', 50, HL]],
  ]);
  const join = packRecordJoin(groups);
  assert.equal(join.arity, 2);
  assert.equal(join.count, 2);

  for (let ord = 0; ord < groups.length; ord++) {
    const eager = groups[ord];
    const packed = materializeRecordRow(join, corpus, ord);
    assert.equal(packed.key, eager.key);
    assert.equal(packed._count, eager._count);
    assert.equal(packed._minScore, eager._minScore);
    assert.equal(packed._maxScore, eager._maxScore);
    assert.equal(packed._minLength, eager._minLength);
    assert.equal(packed._maxLength, eager._maxLength);
    assert.equal(packed.anchor, null);
    for (let k = 0; k < join.arity; k++) {
      const pe = packed.chains[k].atoms[0], ee = eager.chains[k].atoms[0];
      assert.equal(pe.wlEntry, ee.wlEntry);            // the SAME live corpus entry
      assert.deepEqual(pe.highlights, ee.highlights);  // null stays null; ranges rebuilt exactly
      assert.equal(pe.glyph, null);
    }
  }
});

test('an empty lane highlight rebuilds as null, not []', () => {
  const { corpus, groups } = scenario([[['ab', 'ab', 10], ['ba', 'ba', 20]]]);
  const join = packRecordJoin(groups);
  const row = materializeRecordRow(join, corpus, 0);
  assert.equal(row.chains[0].atoms[0].highlights, null);
});

// The load-bearing invariant: the packed sort must equal the eager groupRowComparator
// order for every axis, or the streaming incremental merge diverges from a full sort.
for (const key of ['entry', 'count', 'min-score', 'max-score', 'min-length', 'max-length']) {
  for (const dir of ['asc', 'desc']) {
    test(`recordView order equals sortGroups for ${key}/${dir}`, () => {
      const { corpus, groups } = scenario([
        [['abcd', 'abcd', 30], ['dcba', 'dcba', 70]],
        [['abcd', 'abcd', 30], ['abdc', 'abdc', 70]],   // ties abcd on first lane → tiebreaks matter
        [['wxyz', 'w xyz', 15], ['zyxw', 'zyxw', 50]],
        [['pqr', 'pqr', 40], ['rqp', 'rqp', 40]],
        [['pqr', 'pqr', 40], ['rqp', 'rqp', 55]],       // same first lane as prior, differs downstream
      ]);
      const sort = [{ key, dir }];
      const join = packRecordJoin(groups);
      const eager = sortGroups(groups.map(g => ({ ...g })), sort, TUPLE_STACK).map(g => g.key);
      const packed = [...recordView(join, { sort, scoreRange: null }, corpus)].map(ord => join.keyOf(corpus, ord));
      assert.deepEqual(packed, eager);
    });
  }
}

test('recordView with a score range keeps a tuple only when every lane is in range', () => {
  const { corpus, groups } = scenario([
    [['aaaa', 'aaaa', 10], ['bbbb', 'bbbb', 90]],   // one lane out of a 20-80 range → dropped
    [['cccc', 'cccc', 40], ['dddd', 'dddd', 60]],   // both in range → kept
    [['eeee', 'eeee', 25], ['ffff', 'ffff', 75]],   // both in range → kept
  ]);
  const sort = [{ key: 'entry', dir: 'asc' }];
  const range = '20-80';
  const join = packRecordJoin(groups);
  const filter = { score: parseRange(range), length: null };
  const eager = sortGroups(applyViewFilterToRows(groups.map(g => ({ ...g })), filter, 'record'), sort, TUPLE_STACK).map(g => g.key);
  const packed = [...recordView(join, { sort, scoreRange: range }, corpus)].map(ord => join.keyOf(corpus, ord));
  assert.deepEqual(packed, eager);
  assert.deepEqual(packed, ['cccc dddd', 'eeee ffff']);
});

test('appendGroups streams in batches identically to one bulk pack', () => {
  const { corpus, groups } = scenario([
    [['ab', 'ab', 10], ['ba', 'ba', 20]],
    [['cd', 'cd', 30], ['dc', 'dc', 40]],
    [['ef', 'ef', 50], ['fe', 'fe', 60]],
  ]);
  const bulk = packRecordJoin(groups);
  const streamed = new PackedRecordJoin();
  streamed.appendGroups(groups.slice(0, 1));
  streamed.appendGroups(groups.slice(1));
  assert.equal(streamed.count, bulk.count);
  for (let ord = 0; ord < bulk.count; ord++) {
    assert.deepEqual(materializeRecordRow(streamed, corpus, ord), materializeRecordRow(bulk, corpus, ord));
  }
});

test('appendGroups throws on a lane that is not a single corpus entry (mis-gate guard)', () => {
  const join = new PackedRecordJoin();
  assert.throws(() => join.appendGroups([{ chains: [{ atoms: [{ wlEntry: { norm: 'x', score: 1 } }] }] }]));  // no `_i`
  const two = new PackedRecordJoin();
  assert.throws(() => two.appendGroups([{ chains: [{ atoms: [{ wlEntry: { norm: 'x', score: 1, _i: 0 } }, { wlEntry: { norm: 'x', score: 1, _i: 0 } }] }] }]));  // multi-atom lane
});

test('recordPasses matches applyViewFilterToRows record semantics', () => {
  const { corpus, groups } = scenario([[['a', 'a', 10], ['b', 'b', 50]]]);
  const join = packRecordJoin(groups);
  const ok = r => recordPasses(join, corpus, 0, entryPredicate({ score: parseRange(r), length: null }));
  assert.equal(ok('0-100'), true);
  assert.equal(ok('20-100'), false);   // lane 'a'@10 out
});

// ─── Group (set) packing ─────────────────────────────────────────────────────

// A group stack with no columns/anchor label (plain GROUP_SORT_AXES).
const SET_STACK = [{ kind: () => 'group', isInert: () => false, def: { group: { columns: [], anchorLabel: null } } }];

function setScenario(specs) {
  const byKey = new Map();
  const entries = [];
  const ent = (norm, display, score) => {
    const k = norm + '\0' + display;
    let e = byKey.get(k);
    if (!e) { e = { norm, display, score, _i: entries.length }; entries.push(e); byKey.set(k, e); }
    return e;
  };
  const corpus = { entries };
  const groups = specs.map(s => {
    const chains = s.members.map(([n, d, sc]) => ({ atoms: [{ wlEntry: ent(n, d, sc), highlights: null, glyph: null }] }));
    const g = { key: s.key, anchor: s.anchor ? ent(...s.anchor) : null, chains };
    cacheGroupStats(g);
    return g;
  });
  return { corpus, groups };
}

test('tryPackGroupJoin round-trips key, anchor, members and aggregates', () => {
  const { corpus, groups } = setScenario([
    { key: 'aest', anchor: ['east', 'east', 80], members: [['east', 'east', 80], ['eats', 'eats', 40], ['seat', 'seat', 60]] },
    { key: 'anp', anchor: null, members: [['nap', 'nap', 30], ['pan', 'pan', 50]] },
  ]);
  const join = tryPackGroupJoin(groups);
  assert.ok(join);
  assert.equal(join.count, 2);
  for (let ord = 0; ord < groups.length; ord++) {
    const eager = groups[ord];
    const record = { ord, members: Int32Array.from(eager.chains, c => c.atoms[0].wlEntry._i) };
    const packed = materializeGroupRow(join, corpus, record, SET_STACK[0].def);
    assert.equal(packed.key, eager.key);
    assert.equal(packed._minScore, eager._minScore);
    assert.equal(packed._maxScore, eager._maxScore);
    assert.equal(packed._count, eager._count);
    if (eager.anchor) assert.equal(packed.anchor, eager.anchor); else assert.equal(packed.anchor, null);
    assert.deepEqual(packed.chains.map(c => c.atoms[0].wlEntry), eager.chains.map(c => c.atoms[0].wlEntry));
  }
});

test('tryPackGroupJoin refuses a multi-key set (a member shared across groups)', () => {
  const { groups } = setScenario([
    { key: 'k1', anchor: null, members: [['ab', 'ab', 10], ['ba', 'ba', 20]] },
    { key: 'k2', anchor: null, members: [['ab', 'ab', 10], ['cd', 'cd', 30]] },   // 'ab' in two groups → multi-key
  ]);
  assert.equal(tryPackGroupJoin(groups), null);
});

test('tryPackGroupJoin refuses a matched-tagged, multi-atom, or synthetic member', () => {
  const base = ([n, s], _i) => ({ atoms: [{ wlEntry: { norm: n, display: n, score: s, _i }, highlights: null, glyph: null }] });
  const matched = { key: 'k', anchor: null, chains: [{ ...base(['a', 1], 0), matched: true }, base(['b', 2], 1)] };
  assert.equal(tryPackGroupJoin([matched]), null);
  const multiAtom = { key: 'k', anchor: null, chains: [{ atoms: [base(['a', 1], 0).atoms[0], base(['a', 1], 0).atoms[0]] }, base(['b', 2], 1)] };
  assert.equal(tryPackGroupJoin([multiAtom]), null);
  const synthetic = { key: 'k', anchor: null, chains: [{ atoms: [{ wlEntry: { norm: 'a', display: 'a', score: 1 }, highlights: null, glyph: null }] }, base(['b', 2], 1)] };
  assert.equal(tryPackGroupJoin([synthetic]), null);   // no `_i`
});

test('materializeGroupRow re-derives member highlights via the tool memberHighlights', () => {
  const { corpus, groups } = setScenario([
    { key: 'ea', anchor: null, members: [['eat', 'eat', 10], ['tea', 'tea', 20]] },
  ]);
  const def = { matchOn: 'norm', group: { memberHighlights: (text, key) => text.includes(key) ? [{ start: text.indexOf(key), end: text.indexOf(key) + key.length, kind: 'grp' }] : [] } };
  const join = tryPackGroupJoin(groups);
  const record = { ord: 0, members: Int32Array.from(groups[0].chains, c => c.atoms[0].wlEntry._i) };
  const row = materializeGroupRow(join, corpus, record, def);
  // 'eat' contains 'ea' at 0; 'tea' contains 'ea' at 1 — each colored, coord-tagged to the norm axis.
  assert.deepEqual(row.chains[0].atoms[0].highlights, [{ start: 0, end: 2, kind: 'grp', coord: 'norm' }]);
  assert.deepEqual(row.chains[1].atoms[0].highlights, [{ start: 1, end: 3, kind: 'grp', coord: 'norm' }]);
});

// The flyweight view path must reproduce the eager sortGroups/applyViewFilterToRows
// exactly — same group order, same within-group member order, same score-range trimming.
for (const key of ['entry', 'count', 'min-score', 'max-score']) {
  for (const range of [null, '20-100']) {
    test(`packed-set flyweight view equals eager sortGroups for ${key}${range ? ' @' + range : ''}`, () => {
      const { corpus, groups } = setScenario([
        { key: 'aest', anchor: null, members: [['east', 'east', 80], ['eats', 'eats', 10], ['seat', 'seat', 60]] },
        { key: 'anp', anchor: null, members: [['nap', 'nap', 30], ['pan', 'pan', 90]] },
        { key: 'aer', anchor: null, members: [['are', 'are', 40], ['ear', 'ear', 50], ['era', 'era', 40]] },
      ]);
      const sort = [{ key, dir: 'asc' }];
      const filter = range ? { score: parseRange(range), length: null } : null;

      const eagerGroups = groups.map(g => ({ ...g, chains: g.chains.slice() }));
      const eagerFiltered = applyViewFilterToRows(eagerGroups, filter, 'set');
      const eagerSorted = sortGroups(eagerFiltered, sort, SET_STACK);
      const eager = eagerSorted.map(g => [g.key, g.chains.map(c => c.atoms[0].wlEntry.norm)]);

      const join = tryPackGroupJoin(groups);
      const flyweights = buildGroupFlyweights(join, corpus);
      const filtered = applyViewFilterToRows(flyweights, filter, 'set');
      const sorted = sortGroups(filtered, sort, SET_STACK);
      const packed = sorted.map(g => [join.keys[g._ord], g.chains.map(c => c.atoms[0].wlEntry.norm)]);

      assert.deepEqual(packed, eager);
    });
  }
}
