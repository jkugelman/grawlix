import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeToolRow } from '../../site/src/engine/tools.js';
import { executePipeline } from '../../site/src/engine/executor.js';
import { compileFlatHighlighters, materializeFlatRow } from '../../site/src/engine/flat-highlight.js';
import { setUnigramCorpus } from '../../site/src/engine/segmenter.js';

// Oracle for the relocated materializeFlatRow: it must reproduce the executor's
// flat-chain output exactly. The equivalence is non-obvious — a highlighting
// filter makes chainProducesMultiAtom true, so the executor's flat rows pass
// through collapseRepeatAtoms inside unify, which is the same fold
// materializeFlatRow applies; without that the two would drift.

const wlEntry = (norm, { display = null, score = 0 } = {}) => ({ norm, display, score, comment: '' });

// A fresh corpus per executePipeline call: executePipeline caches _initialChains
// on the wordlist object, so reusing one would mask a seed bug.
function makeCorpus(entries) {
  return { entries, norms: new Set(entries.map(e => e.norm)) };
}

const CORPUS_ENTRIES = [
  wlEntry('united'),
  wlEntry('untied'),
  wlEntry('cat'),
  wlEntry('untether'),
  wlEntry('reunited'),
  wlEntry('teacup'),
  wlEntry('tea'),
  wlEntry('cup'),
];

// The worker's renderCtx shape: an empty artifact peek, so a replay reads spacing on the spot.
const renderCtx = corpus => ({ vocab: corpus, cache: { get: () => null, put() {} } });

const projectRow = row => row.atoms.map(a => ({
  norm: a.wlEntry.norm,
  highlights: a.highlights,
  glyph: a.glyph,
}));

async function executorFlatRows(corpus, stack) {
  const result = await executePipeline(corpus, stack, null);
  assert.equal(result.laneKind, 'single', 'fixture stack must be a flat (ungrouped) chain');
  return result.rows;
}

function materializedFlatRows(corpus, stack) {
  const highlighters = compileFlatHighlighters(stack, renderCtx(corpus));
  return corpus.entries.map(e => materializeFlatRow(e, highlighters));
}

const fixtures = {
  'single search filter with wildcard highlights': () => [
    makeToolRow('search', { pattern: 'UN*ED' }),
  ],
  'two stacked search filters (distinct highlight slots)': () => [
    makeToolRow('search', { pattern: 'UN*' }),
    makeToolRow('search', { pattern: '*ED' }),
  ],
  'regex filter highlights': () => [
    makeToolRow('regex', { pattern: 'UN.+ED' }),
  ],
  'search then regex': () => [
    makeToolRow('search', { pattern: 'UN*' }),
    makeToolRow('regex', { pattern: '.*ED$' }),
  ],
  'span mode reading a run-together entry through the segmenter': () => {
    setUnigramCorpus({ tea: -3, cup: -3, united: -3, untied: -3, cat: -2, untether: -4, reunited: -4 });
    return [makeToolRow('search', { pattern: 'ACU', mode: 'span' })];
  },
};

for (const [name, build] of Object.entries(fixtures)) {
  test(`oracle: materializeFlatRow matches the executor — ${name}`, async () => {
    const stack = build();

    const execRows = await executorFlatRows(makeCorpus(CORPUS_ENTRIES.map(e => ({ ...e }))), stack);
    const matCorpus = makeCorpus(CORPUS_ENTRIES.map(e => ({ ...e })));
    const matRows = materializedFlatRows(matCorpus, stack);

    const highlighters = compileFlatHighlighters(stack, renderCtx(matCorpus));
    const survivingMat = matRows.filter((_, i) => {
      const e = CORPUS_ENTRIES[i];
      return highlighters.every(({ def, prepared }) => {
        const input = def.matchOn === 'both' ? e : def.matchOn === 'display' ? e.display : e.norm;
        return def.run(input, prepared, null) !== null;
      });
    });

    assert.equal(survivingMat.length, execRows.length,
      `survivor count differs: materialize ${survivingMat.length} vs executor ${execRows.length}`);
    assert.deepStrictEqual(
      survivingMat.map(projectRow),
      execRows.map(projectRow),
    );
  });
}

test('oracle fixtures actually exercise highlighted atoms (guard against vacuous pass)', async () => {
  const stack = [makeToolRow('search', { pattern: 'UN*ED' })];
  const rows = await executorFlatRows(makeCorpus(CORPUS_ENTRIES.map(e => ({ ...e }))), stack);
  assert.ok(rows.length > 0, 'fixture matched no rows');
  const hasHighlight = rows.some(r => r.atoms.some(a => Array.isArray(a.highlights) && a.highlights.length > 0));
  assert.ok(hasHighlight, 'fixture produced no highlight ranges, so the oracle would be vacuous');
});
