import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeToolRow } from '../../site/src/engine/tools.js';
import { executePipeline, invalidatePreSearchCache } from '../../site/src/engine/executor.js';
import { compileFlatHighlighters, materializeFlatRow } from '../../site/src/engine/flat-highlight.js';

// Oracle for the relocated materializeFlatRow: it must reproduce the executor's
// flat-chain output exactly. The equivalence is non-obvious — a highlighting
// filter makes chainProducesMultiAtom true, so the executor's flat rows pass
// through collapseRepeatAtoms inside unify, which is the same fold
// materializeFlatRow applies; without that the two would drift.

const wlEntry = (norm, { display = null, score = 0 } = {}) => ({ norm, display, score, comment: '' });

// A fresh corpus per executePipeline call: executePipeline caches _initialChains
// on the wordlist object, so reusing one would mask a seed bug.
function makeCorpus(entries) {
  const byNorm = new Map();
  for (const e of entries) byNorm.set(e.norm, e);
  return { entries, byNorm };
}

const CORPUS_ENTRIES = [
  wlEntry('united'),
  wlEntry('untied'),
  wlEntry('cat'),
  wlEntry('untether'),
  wlEntry('reunited'),
];

const projectRow = row => row.atoms.map(a => ({
  norm: a.wlEntry.norm,
  highlights: a.highlights,
  glyph: a.glyph,
}));

async function executorFlatRows(corpus, stack) {
  invalidatePreSearchCache();
  const result = await executePipeline(corpus, stack, null);
  assert.equal(result.laneKind, 'single', 'fixture stack must be a flat (ungrouped) chain');
  return result.rows;
}

function materializedFlatRows(corpus, stack) {
  const highlighters = compileFlatHighlighters(stack);
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
};

for (const [name, build] of Object.entries(fixtures)) {
  test(`oracle: materializeFlatRow matches the executor — ${name}`, async () => {
    const stack = build();

    const execRows = await executorFlatRows(makeCorpus(CORPUS_ENTRIES.map(e => ({ ...e }))), stack);
    const matRows = materializedFlatRows(makeCorpus(CORPUS_ENTRIES.map(e => ({ ...e }))), stack);

    const highlighters = compileFlatHighlighters(stack);
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
