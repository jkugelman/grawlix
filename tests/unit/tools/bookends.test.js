import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, sameVisible, run, rowByFirst } from './harness.js';
import bookends from '../../../site/src/engine/tools/bookends.js';
import { makeToolRow } from '../../../site/src/engine/tools.js';
import { sortAxes, chainSortTier, isValidSortAxis } from '../../../site/src/engine/sort.js';

const LIB = [
  'pursuit of justice',   // purs · e
  'purple prose',         // pur · se
  'plot a course',        // p · urse
  'pure bred horse',      // pu · rse and pur · se
  'purses galore',        // contains the word whole
  'purse',                // the word itself
  'pursuit',              // starts right, wrong end
];

const marks = (row) => {
  const atom = row.atoms[row.atoms.length - 1];
  return atom.highlights.map(r => [atom.wlEntry.norm.slice(r.start, r.end), r.kind]);
};

test('keeps entries that start with one piece of the word and end with the rest', async () => {
  sameVisible(await visible(LIB, [{ tool: 'bookends', params: { entry: 'purse' } }]),
    ['pursuit of justice', 'purple prose', 'plot a course', 'pure bred horse', 'purses galore']);
});

test('the middle must be non-empty: the word itself is no bookend', async () => {
  const out = (await visible(['purse', 'pure'], [{ tool: 'bookends', params: { entry: 'purse' } }])).flat();
  assert.deepEqual(out, []);
});

test('normalizes the input', async () => {
  sameVisible(await visible(['x ray y'], [{ tool: 'bookends', params: { entry: 'X-Y' } }]), ['x ray y']);
});

test('inert below two letters: every entry passes', async () => {
  sameVisible(await visible(['ab', 'abc'], [{ tool: 'bookends', params: { entry: 'a' } }]), ['ab', 'abc']);
});

test('marks both ends', async () => {
  const { rows } = await run(LIB, [{ tool: 'bookends', params: { entry: 'purse' } }]);
  assert.deepEqual(marks(rowByFirst(rows, 'pursuit of justice')),
    [['purs', 'search:0'], ['e', 'search:0']]);
});

test('an ambiguous split marks the letters that could sit at either end', async () => {
  const { rows } = await run(LIB, [{ tool: 'bookends', params: { entry: 'purse' } }]);
  assert.deepEqual(marks(rowByFirst(rows, 'pure bred horse')),
    [['pu', 'search:0'], ['se', 'search:0'], ['r', 'ambiguous'], ['r', 'ambiguous']]);
});

test('the word whole at either end makes the letters past the split ambiguous', async () => {
  const { rows } = await run(['chance of a lifetime', 'come by chance'], [{ tool: 'bookends', params: { entry: 'chance' } }]);
  assert.deepEqual(marks(rowByFirst(rows, 'chance of a lifetime')),
    [['chanc', 'search:0'], ['e', 'ambiguous'], ['e', 'ambiguous']]);
  assert.deepEqual(marks(rowByFirst(rows, 'come by chance')),
    [['hance', 'search:0'], ['c', 'ambiguous'], ['c', 'ambiguous']]);
});

test('the Split column shows and orders by the longest start piece', () => {
  const { value, order } = bookends.column;
  assert.equal(value('pursuitofjustice', 'purse'), 'purs…e');
  assert.equal(value('purebredhorse', 'purse'), 'pur…se');
  assert.equal(order('plotacourse', 'purse'), 1);
  assert.equal(order('purebredhorse', 'purse'), 3);
});

test('ambiguous marks that would overlap merge into one', async () => {
  const { rows } = await run(['abbba'], [{ tool: 'bookends', params: { entry: 'abba' } }]);
  assert.deepEqual(marks(rows[0]), [['a', 'search:0'], ['a', 'search:0'], ['bbb', 'ambiguous']]);
});

test('the Split sort axis exists only while an active, uninverted Bookends row sits in a flat stack', () => {
  const axesFor = rows => Object.keys(sortAxes(chainSortTier(rows), rows));
  const bookendRow = (entry, invert = false) => makeToolRow('bookends', { entry }, false, invert, false);
  assert.ok(axesFor([bookendRow('purse')]).includes('split'));
  assert.ok(!axesFor([bookendRow('p')]).includes('split'));
  assert.ok(!axesFor([bookendRow('purse', true)]).includes('split'));
  assert.ok(!axesFor([bookendRow('purse'), makeToolRow('semordnilap', {}, false, false, false)]).includes('split'));
  assert.ok(isValidSortAxis('split'));
});
