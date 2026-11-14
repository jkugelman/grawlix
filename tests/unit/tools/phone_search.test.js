import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCmuDict } from '../../../site/src/engine/phonetics.js';
import { setUnigramCorpus, invalidateUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { rowAtoms } from '../../../site/src/engine/executor.js';
import { makeToolRow } from '../../../site/src/engine/tools.js';
import { translatePhoneQuery, queryWordReader } from '../../../site/src/engine/phone-query.js';
import { run, sameVisible, visible, highlightTexts, atomWord } from './harness.js';

const CMU = {
  ARE: ['AA1 R', 'ER0'], ARBITER: ['AA1 R B IH0 T ER0'], ARTY: ['AA1 R T IY0'],
  BITTER: ['B IH1 T ER0'], TEE: ['T IY1'], TEA: ['T IY1'], BUTCHER: ['B UH1 CH ER0'],
  KNEE: ['N IY1'], HONEY: ['HH AH1 N IY0'], NOT: ['N AA1 T'], EVEN: ['IY1 V IH0 N'],
  READ: ['R EH1 D', 'R IY1 D'], RED: ['R EH1 D'], REED: ['R IY1 D'],
  BOB: ['B AA1 B'], KNIGHT: ['N AY1 T'], NIGHT: ['N AY1 T'], PHONE: ['F OW1 N'],
  CO: ['K OW1', 'K AH1 M P AH0 N IY0'], AND: ['AH0 N D', 'AE1 N D'], R: ['AA1 R'],
  SAXOPHONE: ['S AE1 K S AH0 F OW2 N'], NEON: ['N IY1 AA0 N'],
  TABBY: ['T AE1 B IY0'], STABBING: ['S T AE1 B IH0 NG'], HORSEY: ['HH AO1 R S IY0'],
  HORSES: ['HH AO1 R S IH0 Z'], LACKEY: ['L AE1 K IY0'], BLACK: ['B L AE1 K'], INK: ['IH1 NG K'],
  TOUGHIE: ['T AH1 F IY0'], LIFT: ['L IH1 F T'], FINGER: ['F IH1 NG G ER0'], STUFFING: ['S T AH1 F IH0 NG'],
  GOOD: ['G UH1 D'],
  BIER: ['B IY1 R'], BEER: ['B IH1 R'], ERASE: ['IY0 R EY1 S'], THE: ['DH IY0'], RACE: ['R EY1 S'],
  ROOT: ['R UW1 T'], WIN: ['W IH1 N'],
  SHARE: ['SH EH1 R'], PLOWSHARE: ['P L AW1 SH EY2 R'], PAIR: ['P EH1 R'], PAYROLL: ['P EY1 R OW2 L'],
  PUTTING: ['P UH1 T IH0 NG'], PUDDING: ['P UH1 D IH0 NG'], TOFU: ['T OW1 F UW0'],
  BURDEN: ['B ER1 D AH0 N'], BURTON: ['B ER1 T AH0 N'],
  GIT: ['G IH1 T'], GETTING: ['G EH1 T IH0 NG', 'G IH1 T IH0 NG'], ATTA: ['AE1 T AH0', 'AA1 T AH0'],
  ROCKET: ['R AA1 K AH0 T'], CROCKETT: ['K R AA1 K IH0 T'], DAVY: ['D EY1 V IY0'],
  BIT: ['B IH1 T'], BUT: ['B AH1 T'], BELLOW: ['B EH1 L OW0'], BELLA: ['B EH1 L AH0'],
  PYRE: ['P AY1 ER0'], PIRATE: ['P AY1 R AH0 T'], SPY: ['S P AY1'], RING: ['R IH1 NG'],
  DIME: ['D AY1 M'], DIM: ['D IH1 M'], IM: ['AY1 M'],
  ENVY: ['EH1 N V IY0'], PEAS: ['P IY1 Z'],
  ACHOO: ['AA2 CH UW1'], MASSACHUSETTS: ['M AE2 S AH0 CH UW1 S AH0 T S'], STATUETTE: ['S T AE2 CH UW0 EH1 T'],
  RITUAL: ['R IH1 CH UW0 AH0 L'], TUBA: ['T UW1 B AH0'], TOO: ['T UW1'], BAD: ['B AE1 D'],
  INSULT: ['IH2 N S AH1 L T'], CONSULT: ['K AH0 N S AH1 L T'],
  CATCH: ['K AE1 CH'], YOU: ['Y UW1'], GOT: ['G AA1 T'], LATER: ['L EY1 T ER0'], CHOO: ['CH UW1'],
  ISSUE: ['IH1 SH UW0'], KISS: ['K IH1 S'], YET: ['Y EH1 T'], CHET: ['CH EH1 T'],
  SCOTLAND: ['S K AA1 T L AH0 N D'], YARD: ['Y AA1 R D'], JAW: ['JH AO1'],
};

// Corpus state is module-global and these run in one process, so a corpus seeded
// by one test would silently start splitting another's unspaced entries.
const seed = (freqs = null) => {
  invalidateUnigramCorpus();
  if (freqs) setUnigramCorpus(freqs);
  setCmuDict(CMU);
};

async function hits(specs, entry, mode) {
  const { rows } = await run(specs, [{ tool: 'phone_search', params: mode ? { entry, mode } : { entry } }]);
  return Object.fromEntries(rows.map(row => {
    const atom = rowAtoms(row).at(-1);
    return [atom.wlEntry.display ?? atom.wlEntry.norm, highlightTexts(atom)];
  }));
}

test('finds the input’s sounds inside other entries, marking the letters that spell them', async () => {
  seed();
  assert.deepEqual(await hits(['arbiter', 'arty', 'tee', 'bitter'], 'are'),
    { arbiter: ['ar'], arty: ['ar'] });
});

test('ignores stress: unstressed -biter in arbiter is bitter', async () => {
  seed();
  assert.deepEqual(await hits(['arbiter', 'arty'], 'bitter'), { arbiter: ['biter'] });
  assert.deepEqual(await hits(['arty'], 'tee'), { arty: ['ty'] });
});

test('matches by sound, not spelling', async () => {
  seed();
  assert.deepEqual(await hits(['honey', 'tee'], 'knee'), { honey: ['ney'] });
  assert.deepEqual(await hits([{ entry: 'Bob Knight' }], 'night'), { 'Bob Knight': ['Knight'] });
});

test('a final unstressed IY also meets an IH before NG, and no other IH', async () => {
  seed();
  assert.deepEqual(await hits(['stabbing', 'horses'], 'tabby'), { stabbing: ['tabbi'] });
  assert.deepEqual(await hits([{ entry: 'black ink' }], 'lackey'), { 'black ink': ['lack', 'i'] });
  assert.deepEqual(await hits(['horses'], 'horsey'), {});
});

test('the IH before NG stays short when a G follows in the same word', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'lift a finger' }, { entry: 'stuffing good' }], 'toughie'),
    { 'stuffing good': ['tuffi'] });
});

test('IY meets IH before R in the same word, and IY before an R across a word break', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'root beer' }], 'bier'), { 'root beer': ['beer'] });
  assert.deepEqual(await hits([{ entry: 'win the race' }], 'erase'), { 'win the race': ['e', 'race'] });
});

test('EY meets EH before an R that closes the syllable, and not before a vowel', async () => {
  seed();
  assert.deepEqual(await hits(['plowshare'], 'share'), { plowshare: ['share'] });
  assert.deepEqual(await hits(['payroll'], 'pair'), {});
  assert.deepEqual(await hits(['pair'], 'payroll'), {});
});

test('a query ending in AA or AO meets the other only where no R follows', async () => {
  invalidateUnigramCorpus();
  setCmuDict({ MA: ['M AA1'], MOORE: ['M AO1 R'], MAW: ['M AO1'], MAR: ['M AA1 R'] });
  assert.deepEqual(await hits(['moore', 'maw', 'mar'], 'ma', 'start'), { maw: ['maw'], mar: ['ma'] });
});

test('after AY, an unstressed ER meets an R', async () => {
  seed();
  assert.deepEqual(await hits(['pirate', { entry: 'spy ring' }], 'pyre'), { pirate: ['pir'], 'spy ring': ['py', 'r'] });
});

test('a T between vowels meets a D, but not before a syllabic N', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'tofu pudding' }], 'putting'), { 'tofu pudding': ['pudding'] });
  assert.deepEqual(await hits(['burton'], 'burden'), {});
});

test('folded readings never crowd out a plain one', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'getting atta atta' }], 'git'), { 'getting atta atta': ['gett'] });
});

test('unstressed weak vowels meet each other, stressed ones and OW don’t', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'Davy Crockett' }], 'rocket'), { 'Davy Crockett': ['rockett'] });
  assert.deepEqual(await hits(['but'], 'bit'), {});
  assert.deepEqual(await hits(['bella'], 'bellow'), {});
});

test('reads an inflection CMU lacks through its stem', async () => {
  seed();
  assert.deepEqual(await hits(['dimed'], 'I’m'), { dimed: ['im'] });
});

test('an initialism CMU lacks is read letter by letter, a plural s as its ending', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'NV' }, 'nv', { entry: 'MVPs' }], 'envy'), { NV: ['NV'] });
  assert.deepEqual(await hits([{ entry: 'MVPs' }, { entry: 'MVPS' }], 'peas'), { MVPs: ['Ps'] });
  assert.deepEqual(await hits([{ entry: 'NVNVNV' }], 'envy'), {});
});

test('a supplement entry is read as listed, with no inflection or letter-by-letter guess', async () => {
  seed();
  setCmuDict(CMU, { DIMED: ['D IH1 M D'], GIF: ['G IH1 F'], IF: ['IH1 F'] });
  assert.deepEqual(await hits(['dimed'], 'I’m'), {});
  assert.deepEqual(await hits([{ entry: 'GIF' }], 'if'), { GIF: ['IF'] });
});

test('an initialism\'s letter reading in the supplement drops its abbreviation expansion', async () => {
  seed();
  setCmuDict(CMU, { CHR: ['K R AA1 N IH0 K AH0 L Z', 'S IY1 EY1 CH AA1 R'], CRON: ['K R AA1 N'] });
  assert.deepEqual(await hits([{ entry: 'CHR' }], 'R'), { CHR: ['R'] });
  assert.deepEqual(await hits([{ entry: 'CHR' }], 'cron'), {});
});

test('a secondary "ah" in the query meets any "ah" or "uh"; an unstressed one and a secondary I don’t', async () => {
  seed();
  assert.deepEqual(await hits(['massachusetts', 'statuette', 'ritual'], 'achoo'),
    { massachusetts: ['achu'], statuette: ['atu'] });
  assert.deepEqual(await hits([{ entry: 'too bad' }], 'tuba'), {});
  assert.deepEqual(await hits(['consult'], 'insult'), {});
});

test('YOU runs into the consonant before it, and no other Y word does', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'catch you later' }, { entry: 'I got you' }], 'achoo'),
    { 'catch you later': ['atch', 'you'], 'I got you': ['ot', 'you'] });
  assert.deepEqual(await hits([{ entry: 'kiss you' }], 'issue'), { 'kiss you': ['iss', 'you'] });
  assert.deepEqual(await hits([{ entry: 'got yet' }], 'chet'), {});
  assert.deepEqual(await hits([{ entry: 'Scotland Yard' }], 'jaw'), {});
});

test('silent letters at a word’s edge ride along with the sounds beside them', async () => {
  seed();
  assert.deepEqual(await hits(['saxophone'], 'phone'), { saxophone: ['phone'] });
});

test('a sound run may cross a word break, marked on both sides', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'not even' }], 'tea'), { 'not even': ['t', 'e'] });
});

test('searches every pronunciation of the input', async () => {
  seed();
  sameVisible(await visible(['red', 'reed', 'tee'], [{ tool: 'phone_search', params: { entry: 'read' } }]),
    ['red', 'reed']);
});

// CMU's weak ARE is ER, which would find BUTCHER; its CO. expands to "company",
// which would hear KNEE at the end of AND CO.
test('skips weak forms and pronunciations the spelling doesn’t spell', async () => {
  seed();
  sameVisible(await visible(['butcher', 'arbiter'], [{ tool: 'phone_search', params: { entry: 'are' } }]),
    ['arbiter']);
  sameVisible(await visible([{ entry: 'and co' }, 'honey'], [{ tool: 'phone_search', params: { entry: 'knee' } }]),
    ['honey']);
});

test('finds nothing when the input has no pronunciation', async () => {
  seed();
  sameVisible(await visible(['arbiter'], [{ tool: 'phone_search', params: { entry: 'xyzzy' } }]), []);
});

test('reads an unspaced entry through its spaced-out words', async () => {
  seed({ bob: -3, knight: -3, not: -3, even: -3 });
  assert.deepEqual(await hits(['bobknight', 'noteven', 'bob', 'knight', 'not', 'even'], 'night'),
    { bobknight: ['knight'], knight: ['knight'] });
});

test('a lone letter from a split is not read as its letter name', async () => {
  seed({ tee: -3, r: -6 });
  sameVisible(await visible(['teertee', 'tee', 'r'], [{ tool: 'phone_search', params: { entry: 'are' } }]), ['r']);
});

const FIGURE_CMU = {
  FIGURE: ['F IH1 G Y ER0'], FIGURES: ['F IH1 G Y ER0 Z'], FIGURED: ['F IH1 G Y ER0 D'],
  CONFIGURE: ['K AH0 N F IH1 G Y ER0'], FIGURINE: ['F IH2 G Y ER0 IY1 N'], SKATING: ['S K EY1 T IH0 NG'],
  OUT: ['AW1 T'],
};

test('skips matches of the query word and its inflections, not words containing it', async () => {
  invalidateUnigramCorpus();
  setUnigramCorpus({ figure: -3, skating: -3 });
  setCmuDict(FIGURE_CMU);
  const specs = ['figure', 'figures', { entry: 'figured out' }, { entry: 'figure skating' }, 'figureskating',
    'configure', 'figurine', 'skating'];
  sameVisible(await visible(specs, [{ tool: 'phone_search', params: { entry: 'figure' } }]),
    ['configure', 'figurine']);
});

test('the same sounds typed as sounds have no word to hide', async () => {
  invalidateUnigramCorpus();
  setCmuDict(FIGURE_CMU);
  sameVisible(await visible(['figure', 'figures', 'configure'], [{ tool: 'phone_search', params: { entry: 'F IH G Y ER' } }]),
    ['configure', 'figure', 'figures']);
});

// ─── Match modes and wildcards ───────────────────────────────────────────────

test('whole entry finds homophones', async () => {
  seed();
  assert.deepEqual(await hits(['knight', 'night', { entry: 'Bob Knight' }], 'knight', 'full'), { night: ['night'] });
});

test('at start and at end anchor only that end of the sounds', async () => {
  seed();
  const specs = ['neon', 'honey', 'tee'];
  assert.deepEqual(await hits(specs, 'knee', 'start'), { neon: ['ne'] });
  assert.deepEqual(await hits(specs, 'knee', 'end'), { honey: ['ney'] });
});

test('whole word needs the sounds to start and end on word breaks', async () => {
  seed();
  assert.deepEqual(await hits(['tee', 'arty', { entry: 'not even' }], 'tea', 'word'), { tee: ['tee'] });
});

test('spans words needs the sounds to cross a word break', async () => {
  seed();
  assert.deepEqual(await hits(['tee', 'arty', { entry: 'not even' }], 'tea', 'span'), { 'not even': ['t', 'e'] });
});

test('the word modes break words where Search does, not at every punctuation mark', async () => {
  seed();
  const specs = [{ entry: 'R&R' }, { entry: 'R/R' }, { entry: 'R\u2013R' }];
  assert.deepEqual(await hits(specs, 'are', 'word'), { 'R/R': ['R', 'R'], 'R\u2013R': ['R', 'R'] });
  assert.deepEqual(await hits(specs, 'are are', 'span'), { 'R/R': ['R', 'R'], 'R\u2013R': ['R', 'R'] });
});

test('the sounds can’t run across a word that can’t be read', async () => {
  seed();
  assert.deepEqual(await hits(['night', { entry: 'night 52' }], 'knight', 'full'), { night: ['night'] });
  assert.deepEqual(await hits([{ entry: 'night 52' }], 'knight', 'start'), { 'night 52': ['night'] });
  assert.deepEqual(await hits([{ entry: 'honey 52 tee' }], 'knee tea'), {});
});

// ─── Replace ─────────────────────────────────────────────────────────────────

const replace = (entry, rep, mode) => [{ tool: 'phone_search', params: mode ? { entry, replace: rep, mode } : { entry, replace: rep } }];

test('a blank replacement deletes the sounds and finds entries that sound like what’s left', async () => {
  seed();
  sameVisible(await visible(['arbiter', 'arty', 'bitter', 'tee'], replace('are', '')),
    [['arbiter', 'bitter'], ['arty', 'tee']]);
  const { rows } = await run(['arbiter', 'bitter'], replace('are', ''));
  assert.deepEqual(rows[0].atoms.map(highlightTexts), [['ar'], []]);
});

test('a filled replacement swaps in its sounds, marked on the output', async () => {
  seed();
  const { rows } = await run(['tee', 'knee'], replace('tea', 'knee'));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].atoms.map(atomWord), ['tee', 'knee']);
  assert.deepEqual(rows[0].atoms.map(highlightTexts), [['tee'], ['knee']]);
});

test('replacing rewrites the typed word itself', async () => {
  invalidateUnigramCorpus();
  setCmuDict({ ...CMU, DAY: ['D EY1'], SHIFT: ['SH IH1 F T'] });
  const { rows } = await run([{ entry: 'Knight Shift' }, { entry: 'Day Shift' }], replace('knight', 'day'));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].atoms.map(highlightTexts), [['Knight'], ['day']]);
});

test('the match mode constrains which sounds are replaced', async () => {
  seed();
  sameVisible(await visible(['arty', 'tee', 'knee'], replace('tea', 'knee', 'full')), [['tee', 'knee']]);
  sameVisible(await visible(['arbiter', 'bitter'], replace('are', '', 'full')), []);
});

test('a word translates to the same sounds in the search box and the replace box', () => {
  seed();
  for (const word of ['tabby', 'pair', 'caught', 'rocket', 'got you', 'read']) {
    assert.deepEqual(translatePhoneQuery(word, queryWordReader(null), { replacement: true }).lines,
      translatePhoneQuery(word, queryWordReader(null)).lines, word);
  }
});

test('a replacement’s AA stays apart from AO before an R the entry puts after it', async () => {
  invalidateUnigramCorpus();
  setCmuDict({ MARSHA: ['M AA1 R SH AH0'], PORSCHE: ['P AO1 R SH AH0'], PARSHA: ['P AA1 R SH AH0'], MA: ['M AA1'], PA: ['P AA1'] });
  const specs = ['marsha', 'porsche', 'parsha'];
  sameVisible(await visible(specs, replace('ma', 'pa', 'start')), [['marsha', 'parsha']]);
  sameVisible(await visible(specs, replace('ma', 'P AA, P AO (^ R)', 'start')), [['marsha', 'parsha']]);
  sameVisible(await visible(specs, replace('ma', 'P [AA AO]', 'start')), [['marsha', 'parsha'], ['marsha', 'porsche']]);
});

test('an entry word’s last AA stays apart from AO before a replacement’s R', async () => {
  invalidateUnigramCorpus();
  setCmuDict({ PA: ['P AA1'], TEA: ['T IY1'], PAR: ['P AA1 R'], PORE: ['P AO1 R'] });
  sameVisible(await visible([{ entry: 'pa tea' }, 'par', 'pore'], replace('tea', 'R')), [['pa tea', 'par']]);
});

test('a replacing row is a transform named Phone replace', () => {
  const row = makeToolRow('phone_search', { entry: 'are', replace: '' });
  assert.equal(row.kind(), 'transform');
  assert.equal(row.name(), 'Phone replace');
  assert.equal(row.outputSide(), 'plain');
  assert.equal(makeToolRow('phone_search', { entry: 'are', replace: 'tea' }).outputSide(), 'highlight');
  assert.equal(makeToolRow('phone_search', { entry: 'are' }).name(), 'Phone search');
});

// ─── The sound dialect ───────────────────────────────────────────────────────

const SNOW_CMU = {
  ...CMU, SNOW: ['S N OW1'], NO: ['N OW1'], KNOW: ['N OW1'], SCAR: ['S K AA1 R'], CAR: ['K AA1 R'],
  NOSE: ['N OW1 Z'], CAT: ['K AE1 T'], KIT: ['K IH1 T'], COAT: ['K OW1 T'], COT: ['K AA1 T'], CAUGHT: ['K AO1 T'],
};

const seedSnow = () => {
  invalidateUnigramCorpus();
  setCmuDict(SNOW_CMU);
};

test('capitals are sounds: S finds entries that start with an S sound', async () => {
  seedSnow();
  assert.deepEqual(await hits(['snow', 'scar', 'no', 'nose'], 'S', 'start'), { snow: ['s'], scar: ['s'] });
  assert.deepEqual(await hits(['snow', 'nose'], 's', 'start'), {});
});

test('deleting a leading S finds the entries that take an S in front', async () => {
  seedSnow();
  sameVisible(await visible(['snow', 'scar', 'no', 'know', 'car', 'nose'], replace('S', '', 'start')),
    [['scar', 'car'], ['snow', 'know'], ['snow', 'no']]);
});

test('a vowel without a stress digit matches any stress, with one only that stress', async () => {
  seed();
  assert.deepEqual(await hits(['arbiter', 'bitter'], 'B IH T'), { arbiter: ['bit'], bitter: ['bitt'] });
  assert.deepEqual(await hits(['arbiter', 'bitter'], 'B IH1 T'), { bitter: ['bitt'] });
  assert.deepEqual(await hits(['arbiter', 'bitter'], 'B IH0 T'), { arbiter: ['bit'] });
});

test('typed sounds are raw: AO doesn’t meet AA, and a set says when it should', async () => {
  seedSnow();
  assert.deepEqual(await hits(['cot', 'caught'], 'K AO T'), { caught: ['caught'] });
  assert.deepEqual(await hits(['cot', 'caught'], 'K [AA AO] T'), { cot: ['cot'], caught: ['caught'] });
  assert.deepEqual(await hits(['cot', 'caught'], 'caught'), { cot: ['cot'] });
});

test('wildcards and comma alternatives', async () => {
  seedSnow();
  const specs = ['cat', 'kit', 'coat', 'car', 'scar'];
  const found = async (entry, mode) => visible(specs, [{ tool: 'phone_search', params: { entry, mode } }]);
  sameVisible(await found('K @ T', 'full'), ['cat', 'coat', 'kit']);
  sameVisible(await found('K AE T, K AA R', 'full'), ['car', 'cat']);
  sameVisible(await found('# K', 'start'), ['scar']);
});

test('parenthesized sounds must be there but aren’t part of the match', async () => {
  seed();
  assert.deepEqual(await hits(['stabbing', 'tabby'], 'T AE B IH (NG)'), { stabbing: ['tabbi'] });
  assert.deepEqual(await hits(['stabbing'], 'T AE B IH (NG)', 'end'), {});
  assert.deepEqual(await hits(['stabbing', 'tabby'], '(S) T AE B'), { stabbing: ['tabb'] });
});

test('(^ …) says what mustn’t follow or come before, the edge of the entry included', async () => {
  seedSnow();
  const specs = ['snow', 'no', 'nose', 'know'];
  assert.deepEqual(await hits(specs, 'N OW (^ Z)'), { snow: ['now'], no: ['no'], know: ['know'] });
  assert.deepEqual(await hits(specs, '(^ S) N OW'), { no: ['no'], nose: ['no'], know: ['know'] });
  assert.deepEqual(await hits(specs, 'N OW (^ Z)', 'end'), { snow: ['now'], no: ['no'], know: ['know'] });
});

test('a * run still finds the shorter match a word mode needs', async () => {
  seed();
  assert.deepEqual(await hits([{ entry: 'tea knee neon' }], 'T * IY', 'word'), { 'tea knee neon': ['tea', 'knee'] });
});

test('pronunciations one sound apart share a line, and further apart don’t', () => {
  invalidateUnigramCorpus();
  setCmuDict({ READ: ['R EH1 D', 'R IY1 D'], TOMATO: ['T AH0 M EY1 T OW2', 'T AH0 M AA1 T OW2'], PECAN: ['P IH0 K AA1 N', 'P IY1 K AE2 N'] });
  const lines = q => translatePhoneQuery(q, queryWordReader(null)).lines;
  assert.deepEqual(lines('read'), ['R [EH IY] D']);
  assert.deepEqual(lines('tomato'), ['T [AH AX] M [AA AO EY] T OW']);
  assert.deepEqual(lines('pecan'), ['P [IH AX] K [AA AO] N', 'P IY K [AA AE AH AO AX] N']);
  assert.deepEqual(lines('read, R AA D'), ['R [EH IY] D', 'R AA D']);
});

test('pasting a query’s translation searches the same way, but for the hidden query words', async () => {
  seed();
  const specs = [...Object.keys(CMU).map(w => w.toLowerCase()),
    { entry: 'not even' }, { entry: 'catch you later' }, { entry: 'win the race' }, { entry: 'too bad' }, { entry: 'root beer' }];
  for (const query of ['are', 'bitter', 'tabby', 'achoo', 'putting', 'rocket', 'share', 'pyre', 'issue', 'erase', 'knee tea']) {
    const { text } = translatePhoneQuery(query, queryWordReader(null));
    const others = specs.filter(spec => !query.split(' ').includes(spec));
    for (const mode of [undefined, 'start', 'word']) {
      assert.deepEqual(await hits(others, text, mode), await hits(others, query, mode), `${query} → ${text} (${mode ?? 'anywhere'})`);
    }
  }
});
