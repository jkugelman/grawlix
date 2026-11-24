import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCmuDict, parseCmuDict } from '../../../site/src/engine/phonetics.js';
import { invalidateUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { makeScorer, prep, prepServices, normOf, configureRunModel, configureSwapTable } from '../../../site/src/engine/twins.js';
import { makeWordTable, contentOf } from '../../../site/src/engine/twins-swap.js';
import { sharedRun, letterModel } from '../../../site/src/engine/twins-run.js';
import { rhymeKeys, readEntry, prepReading } from '../../../site/src/engine/twins-sound.js';
import { tableSplits } from '../../../site/src/engine/phone-reading.js';
import { candidates, letterFilter } from '../../../site/src/engine/twins-filter.js';
import { parseRelations, makeRelations } from '../../../site/src/engine/twins-wordnet.js';
import { TOOLS } from '../../../site/src/engine/tools.js';
import { rowLastEntry } from '../../../site/src/engine/executor.js';
import { displayOf } from '../../../site/src/engine/norm.js';
import { visible, sameVisible, run } from './harness.js';

const svc = { segment: null, vocab: null, isWord: () => false, sound: () => null };
const entry = (display) => prep({ display }, svc);
const loose = (a, b) => makeScorer().score(entry(a), entry(b), 1)?.loose ?? null;

test('a near spelling scores close and a stranger does not', () => {
  assert.ok(loose('bull market', 'bullet mark') < 0.2);
  assert.ok(loose('scranton', 'scantron') < 0.2);
  assert.equal(loose('bull market', 'zebra'), null);
});

test('a pair scores the same whichever side is typed', () => {
  const both = (a, b) => [makeScorer().score(entry(a), entry(b), 1), makeScorer().score(entry(b), entry(a), 1)].map((h) => h?.loose ?? null);
  for (const [a, b] of [['french press', 'fresh prince'], ['hall of famer', 'hammer to fall'], ['spritsails', 'splits hairs'],
    ['paternal cousin', 'lateran council'], ['spindly', 'spindle'], ['jamaica', 'jicama']]) {
    const [x, y] = both(a, b);
    assert.equal(x, y, `${a} / ${b}`);
  }
  assert.equal(both('french press', 'fresh prince')[0] < 0.21, true, 'the cheaper block swap wins');
});

test('inflections and spelling variants are boring, not twins', () => {
  assert.equal(loose('cat', 'cats'), null);
  assert.equal(loose('color', 'colour'), null);
});

test('the same words reordered score high, never boring', () => {
  assert.equal(loose('time travel', 'travel time'), 0.22);
  assert.equal(loose('travel time', 'time travel'), 0.22);
  assert.equal(loose('so it is', 'is it so'), 0.22);
  assert.equal(makeScorer({ reorder: Infinity }).score(entry('time travel'), entry('travel time'), 1), null);
});

test('the tool keeps a reorder', async () => {
  invalidateUnigramCorpus();
  setCmuDict({});
  const out = await visible(['smoking pot', 'zebra crossing'], [{ tool: 'twins', params: { entry: 'pot smoking' } }]);
  sameVisible(out, ['smoking pot']);
});

const SWAP_DICT = {
  FRESH: 'F R EH1 SH', MEAT: 'M IY1 T', MEET: 'M IY1 T', IN: 'IH0 N', THE: 'DH AH0', FLESH: 'F L EH1 SH',
  PRIME: 'P R AY1 M', OF: 'AH1 V', LIFE: 'L AY1 F', CRIME: 'K R AY1 M', ZEBRA: 'Z IY1 B R AH0', CROSSING: 'K R AO1 S IH0 NG',
  BALL: 'B AO1 L', DROP: 'D R AA1 P', DROPPED: 'D R AA1 P T', MATE: 'M EY1 T',
};

test('content words skip function words and need a written break', () => {
  assert.deepEqual(contentOf('meet in the flesh'), ['meet', 'flesh']);
  assert.deepEqual(contentOf("Abraham's bosom"), ['abraham', 'bosom']);
  assert.equal(contentOf('freshmeat'), null);
  assert.equal(contentOf('back out'), null, 'one content word');
});

test('a word swap scores mid-list from either side, one word may stay', () => {
  setCmuDict(SWAP_DICT);
  const svcS = prepServices({ norms: new Set(), vocab: null });
  const table = makeWordTable((w) => svcS.readWord(w));
  const prepS = (display) => ({ ...prep({ display }, svcS), swap: svcS.swap(display, table) });
  const score = (a, b, knobs) => makeScorer(knobs).score(prepS(a), prepS(b), 0.45)?.loose ?? null;
  const there = score('fresh meat', 'meet in the flesh'), back = score('meet in the flesh', 'fresh meat');
  assert.ok(there > 0.12 && there < 0.25, `fresh meat / meet in the flesh ${there}`);
  assert.equal(there, back);
  assert.equal(score('fresh meat', 'meet in the flesh', { wordSwap: Infinity }), null);
  assert.ok(score('prime of life', 'life of crime') < 0.4, 'one word kept');
  assert.equal(score('ball drop', 'dropped the ball'), null, 'both words kept, one inflected');
  assert.ok(there < score('fresh meat', 'mate in the flesh'), 'a changed vowel costs more');
});

test('a swap partner missing from the word table is found and filed', () => {
  setCmuDict(SWAP_DICT);
  const svcS = prepServices({ norms: new Set(), vocab: null });
  const table = makeWordTable((w) => svcS.readWord(w));
  svcS.swap('zebra crossing', table);
  configureSwapTable(table);
  const scorer = makeScorer();
  const q = { ...prep({ display: 'fresh meat' }, svcS), swap: svcS.swap('fresh meat', table) };
  assert.equal(scorer.swapFinder(q)('meet in the flesh'), true);
  assert.equal(scorer.swapFinder(q)('zebra crossing'), false);
  assert.ok(table.has('flesh'));
  configureSwapTable(null);
});

test('the tool keeps a word swap the letter filter rejects', async () => {
  invalidateUnigramCorpus();
  setCmuDict(SWAP_DICT);
  const out = await visible(['meet in the flesh', 'zebra crossing'], [{ tool: 'twins', params: { entry: 'fresh meat' } }]);
  sameVisible(out, ['meet in the flesh']);
  configureSwapTable(null);
});

test('a spoonerism scores near the top, shared words and all', () => {
  setCmuDict({
    BLOW: 'B L OW1', YOUR: 'Y AO1 R', NOSE: 'N OW1 Z', KNOW: 'N OW1', BLOWS: 'B L OW1 Z',
    NEW: 'N UW1', YOU: 'Y UW1', KNEW: 'N UW1', NO: 'N OW1', FEE: 'F IY1', PHONY: 'F OW1 N IY0',
    DAY: 'D EY1', ONE: 'W AH1 N', WADE: 'W EY1 D', IN: 'IH0 N',
    TOO: 'T UW1', TRUE: 'T R UW1', TO: 'T UW1',
  });
  const prepS = (display) => {
    const e = prep({ display }, svc);
    e.sound = prepReading(readEntry(display, tableSplits()));
    e.rhymes = rhymeKeys(display);
    return e;
  };
  const score = (a, b, knobs) => makeScorer(knobs).score(prepS(a), prepS(b), 0.4);
  assert.equal(score('blow your nose', 'know your blows')?.spoon, true);
  assert.equal(score('blow your nose', 'know your blows', { spoon: Infinity }), null);
  assert.ok(score('blow your nose', 'know your blows').loose < 0.1);
  assert.equal(score('new you', 'you knew')?.loose, 0.2, 'the same words spelled anew rank lower');
  assert.equal(score('no fee', 'phony')?.loose, 0.06, 'word breaks may move');
  assert.notEqual(score('day one', 'wade in')?.spoon, true, 'a reduced IN is no ONE');
  assert.equal(score('too true', 'true to')?.spoon, true, 'though TRUE is the only content word of TRUE TO');
});

test('reorders score by kind: glued above plain, meaning-keeping below', () => {
  const route = (a, b) => makeScorer().score(entry(a), entry(b), 0.45)?.loose;
  assert.equal(route('house cat', 'cathouse'), 0.12);
  assert.equal(route('time travel', 'travel time'), 0.22);
  assert.equal(route('fork and knife', 'knife and fork'), 0.3);
  assert.equal(route('making money', 'moneymaking'), 0.3, 'whatever the letters say');
});

test('anagrams and reversals score by length, long ones near the top', () => {
  const route = (a, b) => makeScorer().score(entry(a), entry(b), 0.45);
  const long = route('marisa tomei', "it's a me mario"), short = route('slots in', 'tonsils');
  assert.equal(long?.diff, '⇆ anagram');
  assert.ok(long.loose < 0.25 && short.loose > 0.35, `${long.loose} ${short.loose}`);
  assert.equal(route('dracula', 'alucard')?.diff, '⇆ reversal');
  assert.ok(route('cosmic horror', 'horror comics').loose > route('easter island', 'trained seals').loose, 'a shared word costs more');
  assert.equal(makeScorer({ anagram: Infinity }).score(entry('marisa tomei'), entry("it's a me mario"), 0.4), null);
});

test('a whole rhyme scores mid-list however far apart the letters are', () => {
  setCmuDict({
    CHERRY: 'CH EH1 R IY0', TREE: 'T R IY1', MARRY: 'M EH1 R IY0', ME: 'M IY1',
    SPRUCE: 'S P R UW1 S', BLUE: 'B L UW1', SEA: 'S IY1', ZEBRA: 'Z IY1 B R AH0',
    CRAZING: 'K R EY1 Z IH0 NG', BLAMING: 'B L EY1 M IH0 NG',
    CAREER: 'K ER0 IH1 R', FAIR: 'F EH1 R', TAHRIR: 'T AA0 HH R IH1 R', SQUARE: 'S K W EH1 R',
  });
  const svcR = { ...svc, rhymes: rhymeKeys };
  const prepR = (display) => {
    const e = prep({ display }, svcR);
    e.sound = prepReading(readEntry(display, tableSplits()));
    e.rhymes = rhymeKeys(display);
    return e;
  };
  const score = (a, b, knobs) => makeScorer(knobs).score(prepR(a), prepR(b), 0.4);
  assert.ok(Math.abs(score('cherry tree', 'marry me')?.loose - 0.20) < 1e-9);
  assert.ok(Math.abs(score('spruce tree', 'blue sea')?.loose - 0.32) < 1e-9, 'a near rhyme costs more');
  assert.equal(score('cherry tree', 'marry me', { rhyme: Infinity }), null);
  assert.equal(score('cherry tree', 'zebra'), null);
  assert.equal(score('crazing', 'blaming')?.rhyme, undefined, 'two one-stress words are an ordinary rhyme');
  assert.ok(Math.abs(score('career fair', 'tahrir square')?.loose - 0.24) < 1e-9, 'unstressed openings may differ');
  assert.equal(score('career fair', 'tahrir square', { rhymeFromStress: false }), null);
});

test('one phone moved costs one edit while the rest matches', () => {
  setCmuDict({
    FIRE: 'F AY1 R', TRUCK: 'T R AH1 K', FRIAR: 'F R AY1 ER0', TUCK: 'T AH1 K',
    KNOW: 'N OW1', BEST: 'B EH1 S T', NO: 'N OW1', BETS: 'B EH1 T S',
    RAINBOW: 'R EY1 N B OW2', BRENNER: 'B R EH1 N ER0',
    HIRE: 'HH AY1 ER0', ON: 'AA1 N', HIGH: 'HH AY1', HONOR: 'AA1 N ER0',
  });
  const prepS = (display) => {
    const e = prep({ display }, svc);
    e.sound = prepReading(readEntry(display, tableSplits()));
    return e;
  };
  const sound = (a, b, knobs) => makeScorer({ rhyme: Infinity, ...knobs }).score(prepS(a), prepS(b), 0.4);
  const truck = sound('fire truck', 'friar tuck');
  assert.ok(truck?.loose < 0.2 && truck.diff.includes('↷R'), 'the R moves');
  const off = sound('fire truck', 'friar tuck', { soundMove: Infinity });
  assert.ok(!off?.diff.includes('↷R') && (off?.loose ?? 1) > truck.loose, 'without moves the R costs two gaps');
  assert.ok(sound('know best', 'no bets')?.diff.includes('⇄'), 'neighbors swap');
  const honor = sound('hire on', 'high honor');
  assert.ok(honor?.loose < 0.2 && honor.diff.includes('↷ER'), 'an R moves to an ER');
  const rainbow = sound('rainbow', 'brenner');
  assert.ok(!rainbow || !rainbow.diff.includes('↷'), 'no cheap move when other phones change too');
});

test('a rare run one word shares with a phrase across a word break', () => {
  const words = new Set(['egg', 'noodle', 'eggnog', 'at', 'most']);
  const services = { normOf, isWord: (w) => words.has(w), wordOf: (x) => !/\s/.test(x.display) };
  const run = (a, b) => sharedRun({ display: a }, { display: b }, services);
  assert.deepEqual(run('psilocybin', 'PS I love you'), { run: 'psilo', atStart: true, cover: 0.5 });
  assert.equal(run('eggnog', 'egg noodle'), null, 'a compound, not a coincidence');
  assert.equal(run('atmospherically', 'at most'), null, 'too little of the word');
  assert.equal(run('psilocybin', 'psilocin'), null, 'no word break to cross');
  assert.equal(run('byways', 'by way of example'), null, 'the phrase\'s words run together');
  assert.deepEqual(run('asbestos', 'as best as one can')?.run, 'asbest');

  const model = letterModel(['psilocybin', 'interact', 'internal', 'interview', 'into', 'intern', 'interim']);
  assert.ok(model('psilo', true) > model('inter', true), 'a common opening carries less surprise');

  configureRunModel(() => 9);
  const score = makeScorer().score(entry('psilocybin'), entry('PS I love you'), 0.4);
  assert.equal(score?.run?.run, 'psilo');
  configureRunModel(null);
});

test('the per-row letter filter keeps what the packed scan keeps', () => {
  const corpus = ['ball marker', 'bulwarked', 'zebra crossing', 'submarket', 'xylophone'].map(entry);
  const q = entry('bull market');
  for (const cut of [0.2, 0.3, 0.45]) {
    const kept = new Set(candidates(corpus, q, cut, { phones: false })), passes = letterFilter(q, cut);
    corpus.forEach((e, i) => assert.equal(passes(e.norm), kept.has(i), `${e.display} at ${cut}`));
  }
});

test('words are related when a lemma of each shares a key', () => {
  const related = makeRelations(parseRelations(['cook nv 1 2', 'cookery n 2', 'book nv 3', '=cooked cook'].join('\n')));
  const e = (spaced) => ({ spaced });
  assert.ok(related(e('cooked rice'), e('cookery tour')));
  assert.equal(related(e('book club'), e('cookery tour')), null);
});

test('the tool keeps twins under the cutoff and the query itself', async () => {
  invalidateUnigramCorpus();
  setCmuDict({});
  const out = await visible(['bull market', 'ball marker', 'zebra', 'bull markets'],
    [{ tool: 'twins', params: { entry: 'bull market' } }]);
  sameVisible(out, ['ball marker', 'bull market']);
});

test('the same letters with written word breaks moved score near the top', () => {
  assert.equal(loose('cat chair', 'catch air'), 0.06);
  assert.equal(loose("queen's pawn", 'queen spawn'), 0.06);
  assert.equal(loose('band camp', 'bandcamp'), null);
  assert.equal(loose('eta', 'ETA'), null);
  assert.equal(makeScorer({ rebreak: Infinity }).score(entry('cat chair'), entry('catch air'), 1), null);
});

test('the typed entry is matched as Search matches it, by display or by letters', async () => {
  invalidateUnigramCorpus();
  setCmuDict({});
  const corpus = ['cat chair', 'catch air', 'catchair', 'zebra'];
  sameVisible(await visible(corpus, [{ tool: 'twins', params: { entry: 'cat chair' } }]), ['cat chair', 'catch air']);
  sameVisible(await visible(corpus, [{ tool: 'twins', params: { entry: 'catchair' } }]), ['cat chair', 'catch air', 'catchair']);
});

test('the tool keeps a rhyme the letter filter rejects', async () => {
  invalidateUnigramCorpus();
  setCmuDict({ LIMA: 'L IY1 M AH0', BEAN: 'B IY1 N', FLEE: 'F L IY1', THE: 'DH AH0', SCENE: 'S IY1 N', ZEBRA: 'Z IY1 B R AH0' });
  const out = await visible(['flee the scene', 'zebra'], [{ tool: 'twins', params: { entry: 'lima bean' } }]);
  sameVisible(out, ['flee the scene']);
});

test('spoonerisms trade clusters inside words and parts of clusters, a tier lower', () => {
  setCmuDict({
    BUTTERFLY: 'B AH1 T ER0 F L AY2', FLUTTERBY: 'F L AH1 T ER0 B AY2',
    BRUSHLAND: 'B R AH1 SH L AE2 N D', SHRUBLAND: 'SH R AH1 B L AE2 N D',
    COTTAGE: 'K AA1 T IH0 JH', DOCKAGE: 'D AA1 K IH0 JH', KEERY: 'K IH1 R IY0', RICKEY: 'R IH1 K IY0',
    LEAPING: 'L IY1 P IH0 NG', PEALING: 'P IY1 L IH0 NG', LEAPY: 'L IY1 P IY0', PEALY: 'P IY1 L IY0',
  });
  const prepS = (display) => {
    const e = prep({ display }, svc);
    e.sound = prepReading(readEntry(display, tableSplits()));
    e.rhymes = rhymeKeys(display);
    return e;
  };
  const score = (a, b, knobs) => makeScorer(knobs).score(prepS(a), prepS(b), 0.4);
  assert.equal(score('butterfly', 'flutterby')?.diff, '⇄ inner spoonerism');
  assert.equal(score('brushland', 'shrubland', { blockSwap: Infinity })?.diff, '⇄ partial spoonerism', 'a block swap of letters scores it better still');
  assert.notEqual(score('cottage', 'dockage')?.spoon, true, 'a flapped T is no D');
  assert.notEqual(score('keery', 'rickey')?.spoon, true, 'an R leaving a vowel recolors it');
  assert.ok(score('leaping', 'pealing').loose > score('leapy', 'pealy').loose, 'a shared -ING costs more');
});

test('the tool keeps a spoonerism whose words it shares', async () => {
  invalidateUnigramCorpus();
  setCmuDict({ BLOW: 'B L OW1', YOUR: 'Y AO1 R', NOSE: 'N OW1 Z', KNOW: 'N OW1', BLOWS: 'B L OW1 Z', ZEBRA: 'Z IY1 B R AH0' });
  const out = await visible(['know your blows', 'zebra'], [{ tool: 'twins', params: { entry: 'blow your nose' } }]);
  sameVisible(out, ['know your blows']);
});

test('the tool keeps a shared run the letter filter rejects', async () => {
  invalidateUnigramCorpus();
  setCmuDict({});
  const out = await visible(['Je suis Charlie', 'zebra crossing', 'interval'], [{ tool: 'twins', params: { entry: 'Jesuit' } }]);
  sameVisible(out, ['Je suis Charlie']);
});

// A copy of the Twins list in ui/dialogs/help.js: change the two together, or
// the Help dialog can show a pair the tool no longer finds.
const HELP_PAIRS = [
  ['Jacuzzi', "j'accuse"], ["there's a way", 'Theresa May'], ['hard to take', 'take to heart'],
  ['bass tracks', 'brass tacks'], ['fire truck', 'Friar Tuck'], ['tree pose', 'Pete Rose'],
  ['Crazy Train', 'daisy chain'], ['Grace Kelly', 'grape jelly'], ['psilocybin', 'P.S. I Love You'],
];
const HELP_DICT = `jacuzzi JH AH0 K UW1 Z IY0
there's DH EH1 R Z
a AH0
a(2) EY1
way W EY1
theresa T ER0 IY1 S AH0
theresa(2) T ER0 EY1 S AH0
may M EY1
hard HH AA1 R D
to T UW1
to(2) T IH0
to(3) T AH0
take T EY1 K
heart HH AA1 R T
bass B AE1 S
bass(2) B EY1 S
tracks T R AE1 K S
brass B R AE1 S
tacks T AE1 K S
fire F AY1 ER0
fire(2) F AY1 R
truck T R AH1 K
friar F R AY1 ER0
tuck T AH1 K
tree T R IY1
pose P OW1 Z
pete P IY1 T
rose R OW1 Z
crazy K R EY1 Z IY0
train T R EY1 N
daisy D EY1 Z IY0
chain CH EY1 N
grace G R EY1 S
kelly K EH1 L IY0
grape G R EY1 P
jelly JH EH1 L IY0
psilocybin S AY2 L AH0 S AY1 B AH0 N
p P IY1
s EH1 S
i AY1
love L AH1 V
you Y UW1`;

test("the Help dialog's examples are twins with at least three bars, typed from either side", async () => {
  invalidateUnigramCorpus();
  setCmuDict(parseCmuDict(HELP_DICT), parseCmuDict('jaccuse ZH AA0 K Y UW1 Z'));
  const corpus = [...HELP_PAIRS.flat(), 'zebra crossing', 'interval'];
  const def = TOOLS.twins, prepare = def.prepare;
  let prepared;
  def.prepare = async (...args) => (prepared = await prepare.apply(def, args));
  try {
    for (const [a, b] of HELP_PAIRS) for (const [typed, twin] of [[a, b], [b, a]]) {
      const { rows } = await run(corpus, [{ tool: 'twins', params: { entry: typed } }]);
      const row = rows.map(rowLastEntry).find(e => displayOf(e) === twin);
      assert.ok(row, `${typed} finds ${twin}`);
      assert.ok(def.column.value(row, prepared) >= 3, `${typed} / ${twin}: ${def.column.value(row, prepared)} bars`);
    }
  } finally {
    def.prepare = prepare;
  }
});
