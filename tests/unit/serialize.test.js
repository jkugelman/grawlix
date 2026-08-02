import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEntries, formatEntryText } from '../../site/src/engine/serialize.js';

const RICH       = { spaces: true,  punctuation: true,  diacritics: true,  ascii: true, comments: true };
const STRIPPED   = { spaces: false, punctuation: false, diacritics: false, ascii: true, comments: true };
const NO_ACCENTS = { spaces: true,  punctuation: true,  diacritics: false, ascii: true, comments: true };

const only = axis => ({ spaces: true, punctuation: true, diacritics: true, ascii: true, comments: true, [axis]: false });

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
  ], { spaces: true, punctuation: true, diacritics: false, ascii: true, comments: false });
  assert.equal(out, 'cafe;60\n');
});

test('serializeEntries: comments off drops the third field even when stripping', () => {
  const out = serializeEntries([
    { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
  ], { spaces: true, punctuation: true, diacritics: false, ascii: true, comments: false });
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

test('punctuation axis strips punctuation and nothing else', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('punctuation'));
  assert.equal(f('don’t'), 'dont');
  assert.equal(f('e-mail'), 'email');
  assert.equal(f('R&B'), 'RB');
  assert.equal(f('a—b'), 'ab');
  assert.equal(f('D.N.A.'), 'DNA');
  assert.equal(f('hoⓤse'), 'hoⓤse');
  assert.equal(f('route ①'), 'route ①');
  assert.equal(f('poop 💩'), 'poop 💩');
  assert.equal(f('a→b'), 'a→b');
  assert.equal(f('café'), 'café');
});

test('ascii axis compatibility-folds first, then drops what is left', () => {
  const f = s => formatEntryText({ norm: 'x', display: s }, only('ascii'));
  assert.equal(f('hoⓤse'), 'house');
  assert.equal(f('ﬁnest'), 'finest');
  assert.equal(f('route ①'), 'route 1');
  assert.equal(f('Xerox™'), 'XeroxTM');
  assert.equal(f('café'), 'cafe');
  assert.equal(f('Việt'), 'Viet');
  assert.equal(f('€100'), '100');
  assert.equal(f('漢字'), '');
});

test('ascii runs before punctuation, so punctuation NFKD creates is still stripped', () => {
  const fmt = { spaces: true, punctuation: false, diacritics: true, ascii: false, comments: true };
  assert.equal(formatEntryText({ norm: 'x', display: '℅' }, fmt), 'co');
  assert.equal(formatEntryText({ norm: 'x', display: '⒈' }, fmt), '1');
});

test('spaces run last, so a space NFKD conjures out of a lone diacritic is still removed', () => {
  const fmt = { spaces: false, punctuation: true, diacritics: true, ascii: false, comments: true };
  assert.equal(formatEntryText({ norm: 'ab', display: 'a´b' }, fmt), 'ab');
});

test('serializeEntries drops an entry that strips to nothing rather than writing ";50"', () => {
  const fmt = { spaces: true, punctuation: true, diacritics: true, ascii: false, comments: true };
  const out = serializeEntries([
    { norm: 'cat',   display: null,   score: 40, comment: '' },
    { norm: 'hanzi', display: '漢字', score: 50, comment: '' },
  ], fmt);
  assert.equal(out, 'cat;40\n');
});

test('serializeEntries drops an all-punctuation entry under the punctuation axis', () => {
  assert.equal(serializeEntries([{ norm: 'x', display: '!!!', score: 10, comment: '' }], only('punctuation')), '');
});

test('diacritics runs before ascii, so an accented letter survives as its base', () => {
  const fmt = { spaces: true, punctuation: true, diacritics: false, ascii: false, comments: true };
  assert.equal(formatEntryText({ norm: 'x', display: 'café' }, fmt), 'cafe');
});

test('a circled mark survives diacritics and punctuation, and reduces only under ascii', () => {
  // The whole reason the axes were reworked: Optional letters emits ⓤ, which the
  // old accents axis folded to u and the old punctuation axis deleted outright.
  const e = { norm: 'house', display: 'hoⓤse' };
  assert.equal(formatEntryText(e, RICH), 'hoⓤse');
  assert.equal(formatEntryText(e, only('diacritics')), 'hoⓤse');
  assert.equal(formatEntryText(e, only('punctuation')), 'hoⓤse');
  assert.equal(formatEntryText(e, only('ascii')), 'house');
});
