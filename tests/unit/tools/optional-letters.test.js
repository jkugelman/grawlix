import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, rowByFirst, atomWord } from './harness.js';
import { toNorm } from '../../../site/src/engine/norm.js';

const stack = [{ tool: 'optional_letters' }];
const withPlurals = [{ tool: 'optional_letters', params: { plurals: true } }];
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

test('a run of identical letters marks each one, not just the first', async () => {
  const { rows } = await run(['holly', 'holy'], stack);
  assert.deepEqual(marked(rows), ['holⓛy', 'hoⓛly']);
});

test('a doubled letter split across two words marks each side', async () => {
  const { rows } = await run([{ entry: 'so old' }, { entry: 'sold' }], stack);
  assert.deepEqual(marked(rows), ['so ⓞld', 'sⓞ old']);
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
  const out = rowByFirst(rows, 'haⓡt').atoms.at(-1).wlEntry;
  assert.equal(out.norm, 'hart');
  assert.equal(toNorm(atomWord({ wlEntry: out })), 'hart');
});

test('the row is one synthetic atom -- the source entry is not shown', async () => {
  const { rows } = await run(['hart', 'hat'], stack);
  const row = rowByFirst(rows, 'haⓡt');
  assert.equal(row.atoms.length, 1);
  assert.equal(row.atoms[0].wlEntry.wordlist, null);
  assert.equal(row.atoms[0].glyph, null);
});

// ─── Scoring ─────────────────────────────────────────────────────────────────

test('the score is the min of the two entries when the long one is weaker', async () => {
  const { rows } = await run([{ entry: 'hart', score: 20 }, { entry: 'hat', score: 90 }], stack);
  assert.equal(rowByFirst(rows, 'haⓡt').atoms.at(-1).wlEntry.score, 20);
});

test('the score is the min of the two entries when the short one is weaker', async () => {
  const { rows } = await run([{ entry: 'hart', score: 90 }, { entry: 'hat', score: 20 }], stack);
  assert.equal(rowByFirst(rows, 'haⓡt').atoms.at(-1).wlEntry.score, 20);
});

test('the short entry contributes its BEST spelling, not the canonical one', async () => {
  // 'HAT' is the code-unit-minimum display and deliberately the worse score: a
  // canonical-row lookup reports 5 here and the marked entry looks like junk.
  const { rows } = await run([
    { entry: 'hart', score: 80 },
    { entry: 'HAT', score: 5 },
    { entry: 'hat', score: 60 },
  ], stack);
  assert.equal(rowByFirst(rows, 'haⓡt').atoms.at(-1).wlEntry.score, 60);
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

// ─── Plurals ─────────────────────────────────────────────────────────────────

test('a trailing S that leaves the singular is skipped by default', async () => {
  const { rows } = await run(['cats', 'cat'], stack);
  assert.equal(rows.length, 0);
});

test('Include plurals offers it', async () => {
  const { rows } = await run(['cats', 'cat'], withPlurals);
  assert.deepEqual(marked(rows), ['catⓢ']);
});

test('skipping the plural S still offers the entry\'s other letters', async () => {
  // The rule suppresses one position, not the whole entry: dropping the R of
  // CARTS leaves CATS, which has nothing to do with the trailing S.
  const { rows } = await run(['carts', 'cats', 'cart'], stack);
  assert.deepEqual(marked(rows), ['caⓡts']);
});

test('a double S is not treated as a plural', async () => {
  // GLASS is not the plural of GLAS, so each S is offered like any other letter.
  const { rows } = await run(['glass', 'glas'], stack);
  assert.deepEqual(marked(rows), ['glasⓢ', 'glaⓢs']);
});

test('a non-plural entry is unaffected by the default', async () => {
  const { rows } = await run(['hart', 'hat'], stack);
  assert.deepEqual(marked(rows), ['haⓡt']);
});

test('a plural word anywhere in a multi-word entry is skipped, not just at the end', async () => {
  const { rows } = await run([{ entry: 'lands a blow' }, { entry: 'land a blow' }], stack);
  assert.equal(rows.length, 0);
});

test('Include plurals offers a mid-entry plural word too', async () => {
  const { rows } = await run([{ entry: 'lands a blow' }, { entry: 'land a blow' }], withPlurals);
  assert.deepEqual(marked(rows), ['landⓢ a blow']);
});

test('a word-final S is judged per word, so other words still offer their letters', async () => {
  // 'sends a wire' -> 'send a wire' is the plural-shaped skip; the W of 'wire'
  // is untouched by it and still reduces to 'sends a ire'.
  const { rows } = await run([
    { entry: 'sends a wire' }, { entry: 'send a wire' }, { entry: 'sends a ire' },
  ], stack);
  assert.deepEqual(marked(rows), ['sends a ⓦire']);
});

test('an override word keeps its S offered', async () => {
  for (const [long, short] of [['his', 'hi'], ['as', 'a'], ['has', 'ha'],
                               ['yes', 'ye'], ['does', 'doe'], ['news', 'new']]) {
    const { rows } = await run([long, short], stack);
    assert.deepEqual(marked(rows), [short + 'ⓢ'], long);
  }
});

test('an override word inside a phrase keeps its S too', async () => {
  const { rows } = await run([{ entry: 'news to me' }, { entry: 'new to me' }], stack);
  assert.deepEqual(marked(rows), ['newⓢ to me']);
});

test('a non-plural S that is merely dull stays skipped', async () => {
  // theirs/their and its/it are not plurals, but a hidden possessive S is as
  // uninteresting as a hidden plural one, so they are deliberately not overridden.
  for (const [long, short] of [['theirs', 'their'], ['its', 'it'], ['yours', 'your']]) {
    const { rows } = await run([long, short], stack);
    assert.equal(rows.length, 0, long);
  }
});
