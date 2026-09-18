import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEntries, formatEntryText } from '../../site/src/engine/serialize.js';

const RICH       = { spaces: true,  punctuation: true,  digits: true, diacritics: true,  symbols: true, comments: true };
const STRIPPED   = { spaces: false, punctuation: false, digits: true, diacritics: false, symbols: true, comments: true };
const NO_ACCENTS = { spaces: true,  punctuation: true,  digits: true, diacritics: false, symbols: true, comments: true };

const only = axis => ({ spaces: true, punctuation: true, digits: true, diacritics: true, symbols: true, comments: true, [axis]: false });

test('serializeEntries (as-is): preserves display, spaces, accents, case, and comments verbatim', () => {
  const out = serializeEntries([
    { norm: 'theirs', display: 'the IRS', score: 60, comment: 'tax' },
    { norm: 'cafe',   display: 'café',    score: 50, comment: '' },
    { norm: 'cat',    display: null,      score: 40, comment: '' },
  ], RICH);
  assert.equal(out, 'café;50\ncat;40\nthe IRS;60;tax\n');
});

test('serializeEntries: output sorts by norm ascending regardless of input order', () => {
  const out = serializeEntries([
    { norm: 'zebra', display: null, score: 1, comment: '' },
    { norm: 'apple', display: null, score: 2, comment: '' },
    { norm: 'mango', display: null, score: 3, comment: '' },
  ], RICH);
  assert.equal(out, 'apple;2\nmango;3\nzebra;1\n');
});

test('serializeEntries: within a norm the highest score leads — the consumer keeps the first', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'cafe', score: 30, comment: '' },
    { norm: 'cafe', display: 'café', score: 70, comment: '' },
    { norm: 'cafe', display: 'CAFE', score: 50, comment: '' },
  ], RICH);
  assert.equal(out, 'café;70\nCAFE;50\ncafe;30\n');
});

test('serializeEntries (as-is): on an equal-score tie the written text sorts, comment or not', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
    { norm: 'cafe', display: 'cafe', score: 60, comment: '' },
  ], RICH);
  assert.equal(out, 'cafe;60\ncafé;60;drink\n');
});

test('serializeEntries (as-is): a punctuated variant follows the bare spelling of its norm', () => {
  const out = serializeEntries([
    { norm: 'any', display: 'any%', score: 50, comment: 'Speedrunning category' },
    { norm: 'any', display: null,   score: 50, comment: '' },
  ], RICH);
  assert.equal(out, 'any;50\nany%;50;Speedrunning category\n');
});

test('serializeEntries: variants stripped onto one text tie, so the commented one leads', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'cafe', score: 60, comment: '' },
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
  ], NO_ACCENTS);
  assert.equal(out, 'cafe;60;drink\ncafe;60\n');
});

test('serializeEntries (as-is): same-norm distinct displays write verbatim — no collapse', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: '' },
    { norm: 'cafe', display: 'cafe', score: 50, comment: '' },
  ], RICH);
  assert.equal(out, 'café;60\ncafe;50\n');
});

test('serializeEntries (spaces, punctuation, diacritics off): case untouched', () => {
  const out = serializeEntries([
    { norm: 'theirs', display: 'the IRS', score: 60, comment: '' },
    { norm: 'cafe',   display: 'café',    score: 50, comment: '' },
    { norm: 'coop',   display: 'co-op',   score: 45, comment: '' },
  ], STRIPPED);
  assert.equal(out, 'cafe;50\ncoop;45\ntheIRS;60\n');
});

test('serializeEntries: stripping a single axis leaves the others intact', () => {
  const out = serializeEntries([
    { norm: 'cafeaulait', display: 'café au lait', score: 50, comment: '' },
    { norm: 'coop',       display: 'co-op',        score: 45, comment: '' },
  ], NO_ACCENTS);
  assert.equal(out, 'cafe au lait;50\nco-op;45\n');
});

test('serializeEntries: entries stripped onto the same text stay separate lines, best first', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'cafe', score: 50, comment: 'the band' },
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
  ], NO_ACCENTS);
  assert.equal(out, 'cafe;60;drink\ncafe;50;the band\n');
});

test('serializeEntries: a byte-identical repeat produced by stripping collapses to one line', () => {
  const out = serializeEntries([
    { norm: 'naive', display: 'naïve', score: 50, comment: '' },
    { norm: 'naive', display: 'naive', score: 50, comment: '' },
  ], NO_ACCENTS);
  assert.equal(out, 'naive;50\n');
});

test('serializeEntries: with comments off, lines differing only by comment collapse', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
    { norm: 'cafe', display: 'cafe', score: 60, comment: 'the band' },
  ], { spaces: true, punctuation: true, digits: true, diacritics: false, symbols: true, comments: false });
  assert.equal(out, 'cafe;60\n');
});

test('serializeEntries: comments off drops the third field even when stripping', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
  ], { spaces: true, punctuation: true, digits: true, diacritics: false, symbols: true, comments: false });
  assert.equal(out, 'cafe;60\n');
});

test('serializeEntries: an empty list yields an empty string', () => {
  assert.equal(serializeEntries([], RICH), '');
  assert.equal(serializeEntries([], STRIPPED), '');
});

test('serializeEntries: sorts a copy — callers pass live rawEntries, which must not be reordered', () => {
  const input = [
    { norm: 'zebra', display: null, score: 1, comment: '' },
    { norm: 'apple', display: null, score: 2, comment: '' },
  ];
  const out = serializeEntries(input, RICH);
  assert.equal(out, 'apple;2\nzebra;1\n');                                  // output sorted
  assert.deepStrictEqual(input.map(e => e.norm), ['zebra', 'apple']);       // input not
});

test('serializeEntries: digits off drops every entry with a digit instead of stripping it', () => {
  const entries = [
    { norm: 'r2d2', display: 'R2D2', score: 50, comment: '' },
    { norm: '4h', display: '4-H', score: 50, comment: '' },
    { norm: 'x2', display: 'x²', score: 50, comment: '' },
    { norm: 'cat', display: null, score: 50, comment: '' },
  ];
  assert.equal(serializeEntries(entries, only('digits')), 'cat;50\n');
  assert.equal(serializeEntries(entries, RICH), '4-H;50\ncat;50\nR2D2;50\nx²;50\n');
});

test('formatEntryText: each strip axis acts independently on the display', () => {
  const e = { norm: 'cafeaulait', display: 'café au lait' };
  assert.equal(formatEntryText(e, RICH), 'café au lait');
  assert.equal(formatEntryText(e, only('diacritics')), 'cafe au lait');
  assert.equal(formatEntryText(e, only('spaces')), 'caféaulait');
  assert.equal(formatEntryText({ norm: 'coop', display: 'co-op' }, only('punctuation')), 'coop');
  assert.equal(formatEntryText({ norm: 'cat', display: null }, RICH), 'cat');
});

test('diacritics axis folds real diacritics and leaves compatibility forms alone', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('diacritics'));
  assert.equal(f('café'), 'cafe');
  assert.equal(f('Việt'), 'Viet');
  assert.equal(f('Ørsted'), 'Orsted');
  assert.equal(f('Αθήνα'), 'Αθηνα');
  assert.equal(f('hoⓤse'), 'hoⓤse');
  assert.equal(f('ﬁnest'), 'ﬁnest');
  assert.equal(f('E=MC²'), 'E=MC²');
  assert.equal(f('Xerox™'), 'Xerox™');
});

test('punctuation axis strips silent marks and leaves the spoken ones to symbols', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('punctuation'));
  assert.equal(f('don’t'), 'dont');
  assert.equal(f('e-mail'), 'email');
  assert.equal(f('a—b'), 'ab');
  assert.equal(f('D.N.A.'), 'DNA');
  assert.equal(f('AC/DC'), 'ACDC');
  assert.equal(f('M*A*S*H'), 'MASH');
  assert.equal(f('¡No pasarán!'), 'No pasarán');
  assert.equal(f('R&B'), 'R&B');
  assert.equal(f('100%'), '100%');
  assert.equal(f('C#'), 'C#');
  assert.equal(f('don\'t @ me'), 'dont @ me');
  assert.equal(f('99‰'), '99‰');
  assert.equal(f('A+'), 'A+');
  assert.equal(f('hoⓤse'), 'hoⓤse');
  assert.equal(f('route ①'), 'route ①');
  assert.equal(f('poop 💩'), 'poop 💩');
  assert.equal(f('a→b'), 'a→b');
  assert.equal(f('café'), 'café');
});

test('symbols axis leaves out an entry that carries a symbol, ASCII or not', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('symbols'));
  for (const s of ['A+', 'AT&T', '100%', 'C#', 'don\'t @ me', '$100', 'P=NP', 'a<b', 'a|b', 'a~b', 'a^b', 'a`b',
    '€100', '99‰', '54°40\' or Fight', 'Musa × paradisiaca', 'omega−3 fatty acid', 'poop 💩', 'a→b', 'a´b', '½']) {
    assert.equal(f(s), null, s);
  }
});

test('symbols axis leaves out an entry with a letter diacritics cannot reduce to A–Z', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('symbols'));
  assert.equal(f('漢字'), null);
  assert.equal(f('Tokyo 東京'), null);
  assert.equal(f('Москва'), null);
  assert.equal(f('Αθήνα'), null);
  assert.equal(f('ħ'), null);
});

test('symbols axis leaves out an entry with a letter or digit in disguise', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('symbols'));
  for (const s of ['hoⓤse', 'ﬁnest', 'route ①', 'Xerox™', 'x²', '℅', '⒈', 'ǆ', 'Ｆｕｌｌ', '№ 5']) {
    assert.equal(f(s), null, s);
  }
});

test('symbols axis deletes a modifier letter and plains a non-breaking space', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('symbols'));
  assert.equal(f('Hawaiʻi'), 'Hawaii');
  assert.equal(f('a\u00a0b'), 'a b');
});

test('symbols axis leaves accents to diacritics and marks to punctuation', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('symbols'));
  assert.equal(f('café'), 'café');
  assert.equal(f('Việt'), 'Việt');
  assert.equal(f('Jo Nesbø'), 'Jo Nesbø');
  assert.equal(f('Straße'), 'Straße');
  assert.equal(f('¡No pasarán!'), '¡No pasarán!');
  assert.equal(f('Soviet–Afghan War'), 'Soviet–Afghan War');
  assert.equal(f('don’t'), 'don’t');
  assert.equal(f('don\'t'), 'don\'t');
  assert.equal(f('AC/DC'), 'AC/DC');
  assert.equal(formatEntryText({ norm: 'cat', display: null }, only('symbols')), 'cat');
});

test('diacritics, punctuation, and symbols all off writes plain ASCII', () => {
  const fmt = { spaces: true, punctuation: false, digits: true, diacritics: false, symbols: false, comments: true };
  const f = s => formatEntryText({ norm: 'x', display: s }, fmt);
  assert.equal(f('¡No pasarán!'), 'No pasaran');
  assert.equal(f('Soviet–Afghan War'), 'SovietAfghan War');
  assert.equal(f('Jo Nesbø'), 'Jo Nesbo');
  assert.equal(f('Thích Nhất Hạnh'), 'Thich Nhat Hanh');
  assert.equal(f('hoⓤse'), null);
  for (const s of ['¡No pasarán!', 'Soviet–Afghan War', 'Ea-nāṣir', 'Pacuła', 'Ænema', 'a\u00a0b', 'ǆ', '㈱', '№ 5', 'ⓐⓑ', 'Ｆｕｌｌ']) {
    const out = f(s);
    assert.ok(out === null || /^[\x00-\x7f]*$/.test(out), `${s} → ${out}`);
  }
});

test('formatEntryText returns null, not text, for an entry digits-off leaves out', () => {
  assert.equal(formatEntryText({ norm: 'r2d2', display: 'R2D2' }, only('digits')), null);
  assert.equal(formatEntryText({ norm: 'x2', display: 'x²' }, only('digits')), null);
});

test('serializeEntries leaves out what the symbols axis leaves out', () => {
  const out = serializeEntries([
    { norm: 'cat',   display: null,   score: 40, comment: '' },
    { norm: 'hanzi', display: '漢字', score: 50, comment: '' },
    { norm: 'a',     display: 'A+',   score: 40, comment: 'Grade' },
    { norm: 'att',   display: 'AT&T', score: 40, comment: '' },
    { norm: 'hart',  display: 'HAⓡT', score: 30, comment: '' },
  ], only('symbols'));
  assert.equal(out, 'cat;40\n');
});

test('serializeEntries drops an all-punctuation entry under the punctuation axis', () => {
  assert.equal(serializeEntries([{ norm: 'x', display: '!!!', score: 10, comment: '' }], only('punctuation')), '');
});

test('a circled mark survives diacritics and punctuation, and leaves the entry out only under symbols', () => {
  // The whole reason the axes were reworked: Optional letters emits ⓤ, which the
  // old accents axis folded to u and the old punctuation axis deleted outright.
  const e = { norm: 'house', display: 'hoⓤse' };
  assert.equal(formatEntryText(e, RICH), 'hoⓤse');
  assert.equal(formatEntryText(e, only('diacritics')), 'hoⓤse');
  assert.equal(formatEntryText(e, only('punctuation')), 'hoⓤse');
  assert.equal(formatEntryText(e, only('symbols')), null);
});
