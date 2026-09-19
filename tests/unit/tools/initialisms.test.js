import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUnigramCorpus, invalidateUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { executePipeline } from '../../../site/src/engine/executor.js';
import { makeToolRow } from '../../../site/src/engine/tools.js';
import { visible, sameVisible, groups, merged, run, rowByFirst, highlightTexts } from './harness.js';

const LIB = ['what the fuck', 'world tour finals', 'cat', 'co-op', "don't", 'big easy'];

test('matches displays whose word-initial letters spell the initialism', async () => {
  sameVisible(await visible(LIB, [{ tool: 'initialisms', params: { word: 'WTF' } }]),
    ['what the fuck', 'world tour finals']);
});

test('hyphens are optional word boundaries', async () => {
  sameVisible(await visible(LIB, [{ tool: 'initialisms', params: { word: 'CO' } }]),
    ['co-op']);
});

test('single-letter pattern matches every entry whose first word starts with it', async () => {
  sameVisible(await visible(LIB, [{ tool: 'initialisms', params: { word: 'C' } }]),
    ['cat', 'co-op']);
});

test("apostrophes aren't word boundaries — DT doesn't match \"don't\"", async () => {
  sameVisible(await visible(LIB, [{ tool: 'initialisms', params: { word: 'DT' } }]), []);
});

test('grouped: clusters multi-word entries by their initialism when the initialism is an entry', async () => {
  const gs = await groups(
    [{ entry: 'WTF', score: 60 }, 'what the fuck', 'where the front', 'who the fudge'],
    [{ tool: 'initialisms', grouped: true }]);
  assert.deepEqual(gs.map(g => ({ anchor: g.anchor, count: g.count, chains: g.chains.flat().sort() })),
    [{ anchor: { entry: 'WTF', score: 60 }, count: 3,
       chains: ['what the fuck', 'where the front', 'who the fudge'] }]);
});

test('grouped: drops clusters whose initialism is not an entry in the wordlist', async () => {
  assert.deepEqual(await groups(['cool cat', 'cow case'], [{ tool: 'initialisms', grouped: true }]), []);
});

test('grouped: skips single-word entries (one-letter initialisms are just prefix buckets)', async () => {
  assert.deepEqual(await groups(['C', 'cat', 'cow'], [{ tool: 'initialisms', grouped: true }]), []);
});

test('grouped: hyphens are not word boundaries in grouped mode', async () => {
  const gs = await groups(
    [{ entry: 'CO', score: 60 }, 'Cycle Op', 'Camera Op', 'co-op'],
    [{ tool: 'initialisms', grouped: true }]);
  assert.deepEqual(gs.map(g => ({ anchor: g.anchor, chains: g.chains.flat().sort() })),
    [{ anchor: { entry: 'CO', score: 60 }, chains: ['Camera Op', 'Cycle Op'] }]);
});

// ─── Unspaced entries ────────────────────────────────────────────────────────

const FREQS = {
  helen: -5, of: -2, troy: -5, hot: -4, time: -3, is: -2, short: -4,
  tis: -6, notable: -4, no: -3, table: -4, not: -3, able: -4,
};
const spaced = () => setUnigramCorpus(FREQS);

test('an unspaced entry matches on its guessed spacing', async () => {
  spaced();
  sameVisible(await visible(['helenoftroy', 'helen', 'of', 'troy', 'hotel'],
    [{ tool: 'initialisms', params: { word: 'HOT' } }]), ['helenoftroy']);
});

test('an entry the segmenter reads as one word stays one word', async () => {
  spaced();
  sameVisible(await visible(['notable', 'no', 'table', 'not', 'able'],
    [{ tool: 'initialisms', params: { word: 'NT' } }]), []);
});

test('without the word-frequency corpus an unspaced entry is one word', async () => {
  invalidateUnigramCorpus();
  sameVisible(await visible(['helenoftroy', 'helen', 'of', 'troy'],
    [{ tool: 'initialisms', params: { word: 'HOT' } }]), []);
});

test('grouped: unspaced entries cluster beside spaced ones', async () => {
  spaced();
  const gs = await groups(
    [{ entry: 'TIS', score: 60 }, 'the irate senator', 'timeisshort', 'time', 'is', 'short'],
    [{ tool: 'initialisms', grouped: true }]);
  assert.deepEqual(gs.map(g => ({ anchor: g.anchor, chains: g.chains.flat().sort() })),
    [{ anchor: { entry: 'TIS', score: 60 }, chains: ['the irate senator', 'timeisshort'] }]);
});

test('grouped: one phrase listed spaced and unspaced is not a cluster', async () => {
  spaced();
  assert.deepEqual(await groups(
    [{ entry: 'HOT', score: 60 }, 'Helen of Troy', 'helenoftroy', 'helen', 'of', 'troy'],
    [{ tool: 'initialisms', grouped: true }]), []);
});

test('all-mode builds the spacing table; the filter reads through it without building', async () => {
  spaced();
  const wl = merged([{ entry: 'TIS', score: 60 }, 'the irate senator', 'timeisshort', 'time', 'is', 'short']);
  const store = new Map();
  const cache = { get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v) };
  const run = (params, grouped) =>
    executePipeline(wl, [makeToolRow('initialisms', params, grouped)], null, { prepareCache: cache });

  await run({ word: 'tis' }, false);
  assert.equal(store.size, 0);
  await run({}, true);
  assert.equal(store.size, 1);
  const [table] = store.values();
  const before = table.best.size;
  await run({ word: 'tis' }, false);
  assert.equal(table.best.size, before);
});

// ─── Highlights ──────────────────────────────────────────────────────────────

const tailMarks = row => highlightTexts(row.atoms[row.atoms.length - 1]);

test('marks the initials of an unspaced match, and leaves a spaced one bare', async () => {
  spaced();
  const { rows } = await run(['helenoftroy', 'Helen of Troy', 'helen', 'of', 'troy'],
    [{ tool: 'initialisms', params: { word: 'HOT' } }]);
  assert.deepEqual(tailMarks(rowByFirst(rows, 'helenoftroy')), ['h', 'o', 't']);
  assert.deepEqual(tailMarks(rowByFirst(rows, 'Helen of Troy')), []);
});

test('marks sit in norm coordinates, so punctuation in the display cannot shift them', async () => {
  spaced();
  const { rows } = await run([{ entry: "helen'oftroy" }, 'helen', 'of', 'troy'],
    [{ tool: 'initialisms', params: { word: 'HOT' } }]);
  const [atom] = rowByFirst(rows, "helen'oftroy").atoms.slice(-1);
  assert.deepEqual(atom.highlights.map(r => [r.start, r.coord]), [[0, 'norm'], [5, 'norm'], [7, 'norm']]);
});

test('grouped: marks the initials of unspaced members only', async () => {
  spaced();
  const { rows } = await run(
    [{ entry: 'TIS', score: 60 }, 'the irate senator', 'timeisshort', 'time', 'is', 'short'],
    [{ tool: 'initialisms', grouped: true }]);
  const g = rows.find(r => r.key === 'tis');
  const marks = Object.fromEntries(g.chains.map(c => [c.atoms[0].wlEntry.norm, tailMarks(c)]));
  assert.deepEqual(marks, { timeisshort: ['t', 'i', 's'], theiratesenator: [] });
});
