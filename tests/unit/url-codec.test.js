import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRow, decodeRows } from '../../site/src/app/url-codec.js';
import { makeToolRow, TOOLS } from '../../site/src/engine/tools.js';

const query = row => encodeRow(row).join('&');
const decode = qs => decodeRows(new URLSearchParams(qs));
const enc = encodeURIComponent;

test('repeatable params: one pair rides the tool key + its own `symbol` key', () => {
  const row = makeToolRow('rebus', { string: ['tool'], symbol: ['Ⓣ'] });
  assert.equal(query(row), 'rebus=tool&symbol=' + enc('Ⓣ'));
});

test('repeatable params: each additional pair is a string/symbol group', () => {
  const row = makeToolRow('rebus', { string: ['tool', 'bar'], symbol: ['Ⓣ', '🅑'] });
  assert.equal(query(row),
    ['rebus=tool', 'symbol=' + enc('Ⓣ'), 'string=bar', 'symbol=' + enc('🅑')].join('&'));
});

test('repeatable params round-trip into parallel arrays', () => {
  const { rows } = decode('rebus=tool&symbol=' + enc('Ⓣ') + '&string=bar&symbol=' + enc('🅑'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool, 'rebus');
  assert.deepEqual(rows[0].params.string, ['tool', 'bar']);
  assert.deepEqual(rows[0].params.symbol, ['Ⓣ', '🅑']);
});

test('an empty pair survives the round-trip', () => {
  assert.equal(query(makeToolRow('rebus', { string: [''], symbol: [''] })), 'rebus=&symbol=');
  const { rows } = decode('rebus=&symbol=');
  assert.deepEqual(rows[0].params.string, ['']);
  assert.deepEqual(rows[0].params.symbol, ['']);
});

test('encode∘decode is idempotent for a multi-pair row', () => {
  const qs = query(makeToolRow('rebus', { string: ['a', 'b'], symbol: ['x', 'y'] }));
  assert.equal(query(decode(qs).rows[0]), qs);
});

test('scalar tools still round-trip (regression)', () => {
  const qs = query(makeToolRow('search', { pattern: 'c?t', replace: 'dog', mode: 'full' }));
  assert.equal(qs, 'search=' + enc('c?t') + '&replace=dog&mode=full');
  const { rows } = decode(qs);
  assert.equal(rows[0].params.pattern, 'c?t');
  assert.equal(rows[0].params.replace, 'dog');
  assert.equal(rows[0].params.mode, 'full');
});

test('legacy whole-word key decodes as mode=full and re-encodes as the new key', () => {
  const { rows, droppedUnknown } = decode('search=cat&whole-word');
  assert.equal(droppedUnknown, false);
  assert.equal(rows[0].params.mode, 'full');
  assert.equal(query(rows[0]), 'search=cat&mode=full');
});

test('an off match mode stays out of the URL', () => {
  assert.equal(query(makeToolRow('search', { pattern: 'cat' })), 'search=cat');
});

test("hidden anagram's spans-words checkbox rides the shared mode key", () => {
  const qs = query(makeToolRow('hidden_anagram', { entry: 'inside', mode: 'span' }));
  assert.equal(qs, 'hidden_anagram=inside&mode=span');
  assert.equal(decode(qs).rows[0].params.mode, 'span');
  // A mode the checkbox can't express decodes as off rather than sticking a
  // truthy junk value into params.
  assert.equal(decode('hidden_anagram=inside&mode=full').rows[0].params.mode, '');
});

test('a param at its default value stays out of the URL', () => {
  assert.equal(query(makeToolRow('rhymes', { entry: 'cat' })), 'rhymes=cat');   // match=loose is the default
  assert.equal(decode('rhymes=cat').rows[0].params.match, 'loose');   // absence decodes to the default
  assert.equal(query(makeToolRow('rhymes', { entry: 'cat', match: 'strict' })), 'rhymes=cat&match=strict');
  assert.equal(query(makeToolRow('rhymes', { entry: 'cat', match: 'whole' })), 'rhymes=cat&match=whole');
  assert.equal(decode('rhymes=cat&match=whole').rows[0].params.match, 'whole');
});

test("weave's numeric Runs elides at its default, which the number input types as a string", () => {
  assert.equal(query(makeToolRow('weave', { entry: 'socks' })), 'weave=socks');
  assert.equal(decode('weave=socks').rows[0].params.runs, '4');
  assert.equal(query(makeToolRow('weave', { entry: 'socks', runs: '6' })), 'weave=socks&runs=6');
  assert.equal(decode('weave=socks&runs=6').rows[0].params.runs, '6');
});

test('a grouped row keeps its secondary params through the `all` toggle', () => {
  const row = makeToolRow('rhymes', { match: 'strict' }, true);
  assert.equal(query(row), 'rhymes&all&match=strict');
  const { rows } = decode('rhymes&all&match=strict');
  assert.equal(rows[0].grouped, true);
  assert.equal(rows[0].params.match, 'strict');
});

test('an unknown key flags droppedUnknown', () => {
  assert.equal(decode('notatool=x').droppedUnknown, true);
  assert.equal(decode('rebus=tool&symbol=' + enc('Ⓣ')).droppedUnknown, false);
});

test('an inverted row carries a bare `not` at its tail', () => {
  assert.equal(query(makeToolRow('search', { pattern: 'c?t' }, false, true)), 'search=c%3Ft&not');
  assert.equal(query(makeToolRow('isograms', {}, false, true)), 'isograms&not');
  assert.equal(query(makeToolRow('search', { pattern: 'c?t' })), 'search=c%3Ft');
});

test('`not` binds to its own row, not the next one', () => {
  const { rows } = decode('search=c%3Ft&not&isograms');
  assert.equal(rows[0].inverted(), true);
  assert.equal(rows[1].inverted(), false);
});

test('`not` survives a round-trip alongside tail params', () => {
  const qs = query(makeToolRow('search', { pattern: 'c?t', mode: 'word' }, false, true));
  assert.equal(qs, 'search=c%3Ft&mode=word&not');
  const row = decode(qs).rows[0];
  assert.equal(row.inverted(), true);
  assert.equal(row.params.mode, 'word');
  assert.equal(query(row), qs);
});

// Normalizing at the `not` key itself would miss this: the row is still a filter
// when `not` is read, and only becomes a transform once `replace` lands.
test('a hand-written `not` on a row a later key turns into a transform is dropped', () => {
  const { rows } = decode('search=cat&not&replace=dog');
  assert.equal(rows[0].kind(), 'transform');
  assert.equal(rows[0].invert, false);
  assert.equal(query(rows[0]), 'search=cat&replace=dog', 're-encodes without the dead `not`');
});

test('`not` on a grouped row is dropped — a group has no verdict to negate', () => {
  const { rows } = decode('cryptogram&all&not');
  assert.equal(rows[0].grouped, true);
  assert.equal(rows[0].invert, false);
});

test('`not` is not mistaken for an unknown key', () => {
  assert.equal(decode('search=cat&not').droppedUnknown, false);
});

test('a reversed row encodes under its reverse slug', () => {
  assert.equal(query(makeToolRow('head_off', { pattern: 'can' }, false, false, true)), 'head_on=can');
  assert.equal(query(makeToolRow('back_off', { pattern: 's' }, false, false, true)), 'back_on=s');
  assert.equal(query(makeToolRow('head_off', { pattern: 'can' })), 'head_off=can');
});

test('a reverse slug decodes to the reversed tool and round-trips', () => {
  const grow = decode('head_on=can').rows[0];
  assert.equal(grow.tool, 'head_off');
  assert.equal(grow.reversed(), true);
  assert.equal(grow.params.pattern, 'can');
  assert.equal(query(grow), 'head_on=can');

  const back = decode('back_on=s').rows[0];
  assert.equal(back.tool, 'back_off');
  assert.equal(back.reversed(), true);
  assert.equal(back.params.pattern, 's');
});

test('remove carries its occurrence mode as a value, not the reserved `all` key', () => {
  assert.equal(query(makeToolRow('remove', { pattern: 'er', mode: 'one' })), 'remove=er&mode=one');
  assert.equal(query(makeToolRow('remove', { pattern: 'er', mode: 'all' }, false, false, true)),
    'add=er&mode=all');
});

test('remove serializes its occurrence mode even when it sits at the default', () => {
  assert.equal(query(makeToolRow('remove', { pattern: 'er' })), 'remove=er&mode=all');
  assert.equal(makeToolRow('remove', { pattern: 'er' }).params.mode, 'all');
});

test('remove round-trips through its slugs in both directions', () => {
  const bare = decode('remove=er').rows[0];
  assert.equal(bare.tool, 'remove');
  assert.equal(bare.reversed(), false);
  assert.equal(bare.params.mode, 'all');
  assert.equal(query(bare), 'remove=er&mode=all');

  const single = decode('add=er&mode=one').rows[0];
  assert.equal(single.tool, 'remove');
  assert.equal(single.reversed(), true);
  assert.equal(single.params.pattern, 'er');
  assert.equal(single.params.mode, 'one');
  assert.equal(query(single), 'add=er&mode=one');
});

test('joeys is its own forward tool, not a Kangaroos reverse slug', () => {
  const joey = decode('joeys=kanga').rows[0];
  assert.equal(joey.tool, 'joeys');
  assert.equal(joey.reversed(), false);
  assert.equal(joey.params.entry, 'kanga');
});

test('a reverse slug digit-migrates its value like the forward slug', () => {
  assert.equal(decode('head_on=3').rows[0].params.pattern, '???');
});

test('the retired count keys ?behead=N / ?curtail=N decode to N wildcards on the renamed tool', () => {
  const behead = decode('behead=3').rows[0];
  assert.equal(behead.tool, 'head_off');
  assert.equal(behead.reversed(), false);
  assert.equal(behead.params.pattern, '???');

  const curtail = decode('curtail=2').rows[0];
  assert.equal(curtail.tool, 'back_off');
  assert.equal(curtail.params.pattern, '??');
});

test('retired affix slugs decode to the renamed tool + direction', () => {
  const rp = decode('remove_prefix=can').rows[0];
  assert.equal(rp.tool, 'head_off');
  assert.equal(rp.reversed(), false);
  assert.equal(rp.params.pattern, 'can');

  const ap = decode('add_prefix=can').rows[0];
  assert.equal(ap.tool, 'head_off');
  assert.equal(ap.reversed(), true);

  assert.equal(decode('remove_suffix=can').rows[0].tool, 'back_off');
  assert.equal(decode('add_suffix=can').rows[0].reversed(), true);
});

test('a retired affix value stays literal — ?add_prefix=3 is the prefix "3", not a count', () => {
  assert.equal(decode('add_prefix=3').rows[0].params.pattern, '3');
});

test('retired slugs are not flagged as unknown keys', () => {
  assert.equal(decode('add_prefix=can').droppedUnknown, false);
  assert.equal(decode('behead=can').droppedUnknown, false);
});

// design.md § Tool stack encoding calls this "the one namespace rule the scheme
// rests on": decode classifies each key positionally, so a tool slug or param key
// that shadows a reserved word makes links decode as something else entirely —
// no error, just a different pipeline than the one shared.
test('no tool slug, reverse slug, or param key collides with a reserved word or each other', () => {
  const slugs = Object.keys(TOOLS);
  const reverseSlugs = Object.values(TOOLS).map(t => t.reverseSlug).filter(Boolean);
  const params = [...new Set(Object.values(TOOLS).flatMap(t => t.params.map(p => p.key)))];
  // `entry` is reserved but deliberately absent: it IS several tools' first-param
  // key, and a first param always rides its tool-slug key, so it never collides.
  for (const word of ['all', 'not', 'sort', 'sort-dir']) {
    assert.ok(!slugs.includes(word), `tool slug "${word}" shadows a reserved word`);
    assert.ok(!reverseSlugs.includes(word), `reverse slug "${word}" shadows a reserved word`);
    assert.ok(!params.includes(word), `param key "${word}" shadows a reserved word`);
  }
  for (const rs of reverseSlugs) {
    assert.ok(!slugs.includes(rs), `reverse slug "${rs}" shadows a tool slug`);
    assert.ok(!params.includes(rs), `reverse slug "${rs}" shadows a param key`);
  }
  assert.equal(new Set(reverseSlugs).size, reverseSlugs.length, 'two tools share a reverse slug');
});

test('a tool whose first param is a checkbox keeps the slug bare', () => {
  // Collapsing would write the boolean into the tool key (?optional_letters=true,
  // or a bare `=` when off), which is neither readable nor round-trippable.
  assert.equal(query(makeToolRow('optional_letters')), 'optional_letters');
  assert.equal(query(makeToolRow('optional_letters', { plurals: true })),
    'optional_letters&plurals');
});

test('a bare leading checkbox round-trips both ways', () => {
  for (const qs of ['optional_letters', 'optional_letters&plurals']) {
    const { rows } = decode(qs);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool, 'optional_letters');
    assert.equal(!!rows[0].params.plurals, qs.includes('plurals'));
    assert.equal(query(rows[0]), qs);
  }
});
