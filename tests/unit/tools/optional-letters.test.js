import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, rowByFirst, atomWord, highlightTexts } from './harness.js';
import { toNorm } from '../../../site/src/engine/norm.js';

const stack = [{ tool: 'optional_letters' }];
const marked = rows => rows.map(r => atomWord(r.atoms.at(-1))).sort();

test('marks a letter whose removal leaves another entry', async () => {
  const { rows } = await run(['hart', 'hat'], stack);
  assert.deepEqual(marked(rows), ['haⓡt']);
});

test('the first and last letters are droppable too', async () => {
  const { rows } = await run(['hart', 'art', 'har'], stack);
  assert.deepEqual(marked(rows), ['harⓣ', 'ⓗart']);
});

test('an entry with no droppable letter emits nothing', async () => {
  const { rows } = await run(['hart', 'cat'], stack);
  assert.equal(rows.length, 0);
});

test('a one-letter entry emits nothing -- there is nothing left to reduce to', async () => {
  const { rows } = await run(['a', 'b'], stack);
  assert.equal(rows.length, 0);
});

test('several droppable letters emit one row each', async () => {
  const { rows } = await run(['beast', 'best', 'bast'], stack);
  assert.deepEqual(marked(rows), ['beⓐst', 'bⓔast']);
});

test('a run of identical letters emits once, marking the first', async () => {
  const { rows } = await run(['holly', 'holy'], stack);
  assert.deepEqual(marked(rows), ['hoⓛly']);
});

test('the circle is always lowercase; the rest keeps the entry case', async () => {
  const { rows } = await run(['HART', 'HAT'], stack);
  assert.deepEqual(marked(rows), ['HAⓡT']);
});

test('a mixed-case display keeps its own casing around the circle', async () => {
  const { rows } = await run([{ entry: 'Hart' }, { entry: 'Hat' }], stack);
  assert.deepEqual(marked(rows), ['Haⓡt']);
});

test('digits use the circled-digit glyphs', async () => {
  const { rows } = await run(['a1b', 'ab'], stack);
  assert.deepEqual(marked(rows), ['a①b']);
});

test('the circle lands on the right display character when the entry has a space', async () => {
  // norm 'hotdog' drops the g -> 'hotdo', so the circle must skip past the space.
  const { rows } = await run([{ entry: 'hot dog' }, { entry: 'hotdo' }], stack);
  assert.deepEqual(marked(rows), ['hot doⓖ']);
});

test('a display character backing two norm characters is skipped', async () => {
  // 'æ' norms to 'ae', so neither half can carry a circle on its own.
  const { rows } = await run([{ entry: 'cæsar' }, { entry: 'casar' }, { entry: 'cesar' }], stack);
  assert.equal(rows.length, 0);
});

test('the marked form norms back to the source entry, not the short one', async () => {
  const { rows } = await run(['hart', 'hat'], stack);
  const out = rowByFirst(rows, 'hart').atoms.at(-1).wlEntry;
  assert.equal(out.norm, 'hart');
  assert.equal(toNorm(atomWord({ wlEntry: out })), 'hart');
});

test('the output is synthetic and its input marks the removed letter', async () => {
  const { rows } = await run(['hart', 'hat'], stack);
  const row = rowByFirst(rows, 'hart');
  assert.equal(row.atoms.at(-1).wlEntry.wordlist, null);
  assert.deepEqual(highlightTexts(row.atoms[0]), ['r']);
});

// ─── Scoring ─────────────────────────────────────────────────────────────────

test('the score is the min of the two entries when the long one is weaker', async () => {
  const { rows } = await run([{ entry: 'hart', score: 20 }, { entry: 'hat', score: 90 }], stack);
  assert.equal(rowByFirst(rows, 'hart').atoms.at(-1).wlEntry.score, 20);
});

test('the score is the min of the two entries when the short one is weaker', async () => {
  const { rows } = await run([{ entry: 'hart', score: 90 }, { entry: 'hat', score: 20 }], stack);
  assert.equal(rowByFirst(rows, 'hart').atoms.at(-1).wlEntry.score, 20);
});

test('the short entry contributes its BEST spelling, not the canonical one', async () => {
  // 'HAT' is the code-unit-minimum display and deliberately the worse score: a
  // canonical-row lookup reports 5 here and the marked entry looks like junk.
  const { rows } = await run([
    { entry: 'hart', score: 80 },
    { entry: 'HAT', score: 5 },
    { entry: 'hat', score: 60 },
  ], stack);
  assert.equal(rowByFirst(rows, 'hart').atoms.at(-1).wlEntry.score, 60);
});

test('a norm with several spellings emits one row, from its best-scored spelling', async () => {
  const { rows } = await run([
    { entry: 'HART', score: 30 },
    { entry: 'Hart', score: 80 },
    { entry: 'hat', score: 90 },
  ], stack);
  assert.deepEqual(marked(rows), ['Haⓡt']);
  assert.equal(rows[0].atoms.at(-1).wlEntry.score, 80);
});
