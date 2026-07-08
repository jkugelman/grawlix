import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus } from '../../site/src/engine/corpus.js';
import { parseWordlist } from '../../site/src/engine/norm.js';
import { compileRescoreRules } from '../../site/src/engine/rescore.js';
import { sourceAccessor, parseWordlistColumns, columnsFromEntries } from '../../site/src/engine/sources.js';

// Build the same source two ways from one text: object-backed (parseWordlist) and
// columnar (parseWordlistColumns). The columnar store must be a drop-in — every
// merge, lookup, and serialize path has to read it identically.
function pair(name, text, { enabled = true, rescoreRules = [], dbKey = name } = {}) {
  const obj = { name, dbKey, enabled, rescoreRules: rescoreRules.map(r => ({ ...r })), rawEntries: parseWordlist(text) };
  compileRescoreRules(obj);
  const col = { name, dbKey, enabled, rescoreRules: rescoreRules.map(r => ({ ...r })) };
  compileRescoreRules(col);
  col.cols = parseWordlistColumns(text, col.rescoreRules);
  return { obj, col };
}

const project = entries => entries.map(e => ({
  norm: e.norm, display: e.display, score: e.score,
  rawScore: e.rawScore, comment: e.comment, source: e.wordlist.name,
}));
const counts = sc => sc.map(s => [s.wordlist.name, s.count]);

// A mixed fixture: bare (case-convention) entries, a spelled sibling, an accent, an
// off-case entry, comments, and a same-norm variant pair in deliberate file order.
const FIXTURE = [
  'ABLE;30',
  'BIRD;40',
  'CRANE;10;a-crane',
  'THE IRS;60;tax',          // space ⇒ rich display
  'THEIRS;55',               // bare sibling of the same norm, AFTER the spelled one
  'CAFÉ;25;accent',          // accent ⇒ rich display
  'ebay;20',                 // off-case in an upper file ⇒ rich display
].join('\n') + '\n';

test('columnar buildCorpus matches object buildCorpus (single source, mixed shapes)', () => {
  const { obj, col } = pair('A', FIXTURE);
  assert.deepStrictEqual(project(buildCorpus([col]).entries), project(buildCorpus([obj]).entries));
  assert.deepStrictEqual(counts(buildCorpus([col]).sourceCounts), counts(buildCorpus([obj]).sourceCounts));
});

test('columnar buildCorpus matches object across a multi-source priority merge', () => {
  const A = pair('A', 'ABLE;30\nBIRD;40\nCRANE;10;a-crane\n');
  const B = pair('B', 'BIRD;99;b-bird\nDELTA;20\nCRANE;88\n');
  assert.deepStrictEqual(
    project(buildCorpus([A.col, B.col]).entries),
    project(buildCorpus([A.obj, B.obj]).entries),
  );
  assert.deepStrictEqual(
    counts(buildCorpus([A.col, B.col]).sourceCounts),
    counts(buildCorpus([A.obj, B.obj]).sourceCounts),
  );
});

test('columnar merge matches object merge with a rescore rule (rawScore carried)', () => {
  const E = pair('E', 'DELTA;5\nECHO;5;note\nFOXTROT;77\n', { rescoreRules: [{ input: '0-9', output: '80' }] });
  const F = pair('F', 'DELTA;50\n');
  assert.deepStrictEqual(
    project(buildCorpus([E.col, F.col]).entries),
    project(buildCorpus([E.obj, F.obj]).entries),
  );
});

test('columnar scoped (single-source, disabled) build matches object', () => {
  const G = pair('G', 'ZEBRA;12\nAPPLE;7;fruit\n', { enabled: false });
  assert.deepStrictEqual(project(buildCorpus([G.col]).entries), project(buildCorpus([G.obj]).entries));
});

test('rawScore reads undefined exactly when a rule left the score unchanged', () => {
  const { col } = pair('G', 'CRANE;90;corvid\nDELTA;50\nEAGLE;50;raptor\n', {
    rescoreRules: [{ input: '50', length: '', output: '75', note: '' }],
  });
  const acc = sourceAccessor(col);
  const byNorm = new Map();
  acc.forEachGroup((norm, views) => byNorm.set(norm, views));
  assert.equal(byNorm.get('crane')[0].rawScore, undefined);   // 90, no rule → undefined
  assert.equal(byNorm.get('delta')[0].score, 75);
  assert.equal(byNorm.get('delta')[0].rawScore, 50);          // rescored → original
  assert.equal(byNorm.get('eagle')[0].rawScore, 50);
});

test('rescoredForNorm returns undefined for an absent norm, a views array otherwise', () => {
  const { col } = pair('A', 'ABLE;30\nBIRD;40\n');
  const acc = sourceAccessor(col);
  assert.equal(acc.rescoredForNorm('zzznope'), undefined);
  assert.equal(acc.hasNorm('zzznope'), false);
  assert.equal(acc.hasNorm('able'), true);
  const g = acc.rescoredForNorm('bird');
  assert.equal(g.length, 1);
  assert.equal(g[0].score, 40);
});

test('a same-norm variant pair keeps file order (stable sort)', () => {
  // Spelled "the irs" precedes the bare "theirs" in the file; the within-norm sort
  // must preserve that, since the bare wildcard's score lands on the spelled row.
  const { obj, col } = pair('W', 'the irs;60;tax\ntheirs;55\n');
  assert.deepStrictEqual(project(buildCorpus([col]).entries), project(buildCorpus([obj]).entries));
  const variants = sourceAccessor(col).rescoredForNorm('theirs');
  assert.deepStrictEqual(variants.map(v => v.display), ['the irs', null]);
});

test('sparse display/comment round-trip: null stays null, present decodes', () => {
  const { col } = pair('S', 'plain;10\nrich one;20;c1\nlone;30;c2\n');
  const byNorm = new Map(sourceAccessor(col).collectRaw().map(v => [v.norm, v]));
  assert.equal(byNorm.get('plain').display, null);
  assert.equal(byNorm.get('plain').comment, '');
  assert.equal(byNorm.get('richone').display, 'rich one');
  assert.equal(byNorm.get('richone').comment, 'c1');
  assert.equal(byNorm.get('lone').display, null);
  assert.equal(byNorm.get('lone').comment, 'c2');
});

test('collectRaw yields RAW (file) scores; scores() yields rescored', () => {
  const { col } = pair('R', 'ALPHA;5\nBETA;5\n', { rescoreRules: [{ input: '5', output: '80' }] });
  const acc = sourceAccessor(col);
  assert.deepStrictEqual(acc.collectRaw().map(v => v.score).sort(), [5, 5]);
  assert.deepStrictEqual([...acc.scores()].sort(), [80, 80]);
});

test('columnsFromEntries equals parseWordlistColumns over the same text', () => {
  const rules = [{ input: '0-9', output: '80' }];
  const compiled = rules.map(r => ({ ...r }));
  compileRescoreRules({ rescoreRules: compiled });
  const fromText = parseWordlistColumns(FIXTURE, compiled);
  const fromEntries = columnsFromEntries(parseWordlist(FIXTURE), compiled);
  for (const k of ['n', 'normBytes', 'normOffsets', 'rawScores', 'scores', 'dispBytes', 'dispOffsets', 'commentBytes', 'commentOffsets']) {
    assert.deepStrictEqual(fromEntries[k], fromText[k], `column ${k} differs`);
  }
});

test('both parse paths dedupe exact (norm, display) repeats, first wins, variants survive', () => {
  const DUP = [
    'HELLO;50;greet',
    'HELLO;20',            // exact repeat — dropped, score/comment ignored
    'eta;10',
    'ETA;20',              // case variant of eta — NOT a duplicate
    'HELLO;99;other',      // exact repeat again — dropped
  ].join('\n') + '\n';
  const { obj, col } = pair('D', DUP);
  const objRows = project(buildCorpus([obj]).entries);
  const colRows = project(buildCorpus([col]).entries);
  assert.deepStrictEqual(colRows, objRows);

  const hello = objRows.filter(r => r.norm === 'hello');
  assert.equal(hello.length, 1);
  assert.deepEqual([hello[0].score, hello[0].comment], [50, 'greet']);
  assert.equal(objRows.filter(r => r.norm === 'eta').length, 2);
});

test('an empty source builds an empty columnar store', () => {
  const cols = parseWordlistColumns('', []);
  assert.equal(cols.n, 0);
  const acc = sourceAccessor({ cols });
  assert.equal(acc.count, 0);
  assert.equal(acc.hasNorm('x'), false);
  assert.deepStrictEqual(acc.collectRescored(), []);
});
