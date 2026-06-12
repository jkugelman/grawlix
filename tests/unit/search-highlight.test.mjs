import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchPattern, isLiteralQuery, searchRangesFor,
  groupSpansToRanges, renderHighlightedText, HL_COLORS,
} from '../../site/src/engine/search.js';

const wl = (norm, display = null) => ({ norm, display });
const matches = (pat, s) => { pat.globalRe.lastIndex = 0; return pat.globalRe.test(s); };

test('buildSearchPattern: an empty or blank query compiles to null', () => {
  assert.equal(buildSearchPattern(''), null);
  assert.equal(buildSearchPattern('   '), null);
  assert.equal(buildSearchPattern('\t\n'), null);
});

test('buildSearchPattern: `*` matches any run including empty', () => {
  const pat = buildSearchPattern('c*t');
  assert.equal(matches(pat, 'ct'), true);
  assert.equal(matches(pat, 'cat'), true);
  assert.equal(matches(pat, 'caaat'), true);
  assert.equal(matches(pat, 'cb'), false);
});

test('buildSearchPattern: `?` matches exactly one character', () => {
  const pat = buildSearchPattern('c?t');
  assert.equal(matches(pat, 'cat'), true);
  assert.equal(matches(pat, 'ct'), false);
  assert.equal(matches(pat, 'caat'), false);
});

test('buildSearchPattern: `#` matches a single consonant (y included, vowels excluded)', () => {
  const pat = buildSearchPattern('a#a');
  assert.equal(matches(pat, 'aba'), true);
  assert.equal(matches(pat, 'aya'), true);
  assert.equal(matches(pat, 'aea'), false);
});

test('buildSearchPattern: `@` matches a single vowel (y excluded)', () => {
  const pat = buildSearchPattern('b@d');
  assert.equal(matches(pat, 'bad'), true);
  assert.equal(matches(pat, 'bed'), true);
  assert.equal(matches(pat, 'byd'), false);
  assert.equal(matches(pat, 'bzd'), false);
});

test('buildSearchPattern: `[…]` is a literal character class', () => {
  const pat = buildSearchPattern('b[aeiou]d');
  assert.equal(matches(pat, 'bad'), true);
  assert.equal(matches(pat, 'bod'), true);
  assert.equal(matches(pat, 'bxd'), false);
});

test('buildSearchPattern: a `^`-led class negates', () => {
  const pat = buildSearchPattern('b[^aeiou]d');
  assert.equal(matches(pat, 'bxd'), true);
  assert.equal(matches(pat, 'bad'), false);
});

test('buildSearchPattern: `#`/`@` expand inside a `[…]` class body', () => {
  const pat = buildSearchPattern('a[#]a');
  assert.equal(matches(pat, 'aba'), true);
  assert.equal(matches(pat, 'aya'), true);
  assert.equal(matches(pat, 'aea'), false);
});

test('buildSearchPattern: an unclosed `[` is treated as a literal bracket', () => {
  const pat = buildSearchPattern('a[b');
  assert.equal(matches(pat, 'a[b'), true);
  assert.equal(matches(pat, 'ab'), false);
});

test('buildSearchPattern: plain text is matched case-insensitively as a substring', () => {
  const pat = buildSearchPattern('cat');
  assert.equal(matches(pat, 'CAT'), true);
  assert.equal(matches(pat, 'scatter'), true);
  assert.equal(matches(pat, 'dog'), false);
});

test('buildSearchPattern: wholeWord anchors the pattern with ^…$', () => {
  const anchored = buildSearchPattern('cat', true);
  assert.equal(matches(anchored, 'cat'), true);
  assert.equal(matches(anchored, 'scatter'), false);
  const unanchored = buildSearchPattern('cat', false);
  assert.equal(matches(unanchored, 'scatter'), true);
});

test('buildSearchPattern: test() matches when either norm or display matches', () => {
  const pat = buildSearchPattern('irs');
  assert.equal(pat.test(wl('theirs', 'the IRS')), true);
  assert.equal(pat.test(wl('xyz', 'the IRS')), true);
  assert.equal(pat.test(wl('xyz', null)), false);
});

test('buildSearchPattern: query separators and accents force display-coordinate matching', () => {
  const theirs = wl('theirs', 'the IRS'), bareTheirs = wl('theirs', null);
  assert.equal(buildSearchPattern('theirs').test(theirs), true);
  assert.equal(buildSearchPattern('theirs').test(bareTheirs), true);

  assert.equal(buildSearchPattern('the IRS').test(theirs), true);
  assert.equal(buildSearchPattern('the IRS').test(bareTheirs), false);

  assert.equal(buildSearchPattern('co-op').test(wl('coop', 'co-op')), true);
  assert.equal(buildSearchPattern('co-op').test(wl('coop', null)), false);

  assert.equal(buildSearchPattern('resume').test(wl('resume', 'Resume')), true);
  assert.equal(buildSearchPattern('resume').test(wl('resume', 'résumé')), true);

  assert.equal(buildSearchPattern('résumé').test(wl('resume', 'résumé')), true);
  assert.equal(buildSearchPattern('résumé').test(wl('resume', 'Resume')), false);
});

test('buildSearchPattern: searchRanges highlights the literal runs, skipping the wildcard gap', () => {
  const pat = buildSearchPattern('c*t');
  assert.deepEqual(pat.searchRanges(wl('cat', 'cat')), [
    { start: 0, end: 1, kind: 'search:0', coord: 'display' },
    { start: 2, end: 3, kind: 'search:1', coord: 'display' },
  ]);
});

test('buildSearchPattern: searchRanges falls back to the norm arm when display has no hit', () => {
  const pat = buildSearchPattern('cat');
  assert.deepEqual(pat.searchRanges(wl('cat', 'DOG')), [
    { start: 0, end: 3, kind: 'search:0', coord: 'norm' },
  ]);
});

test('isLiteralQuery: a plain query with no metacharacters is literal', () => {
  assert.equal(isLiteralQuery('cat'), true);
  assert.equal(isLiteralQuery('hello world'), true);
});

test('isLiteralQuery: any wildcard metacharacter makes a query non-literal', () => {
  assert.equal(isLiteralQuery('c*t'), false);
  assert.equal(isLiteralQuery('c?t'), false);
  assert.equal(isLiteralQuery('a#'), false);
  assert.equal(isLiteralQuery('a@'), false);
  assert.equal(isLiteralQuery('a[bc]'), false);
});

test('isLiteralQuery: an empty query is not literal', () => {
  assert.equal(isLiteralQuery(''), false);
});

test('searchRangesFor: highlights only the captured literal runs, not the wildcard gap', () => {
  const hlRe = new RegExp('(c).*(t)', 'giud');
  assert.deepEqual(searchRangesFor('cat', hlRe), [
    { start: 0, end: 1, kind: 'search:0' },
    { start: 2, end: 3, kind: 'search:1' },
  ]);
});

test('searchRangesFor: a zero-width-capable pattern terminates (advance guard)', () => {
  // `(a*)` can match the empty string; without the lastIndex++ guard exec would
  // re-match the same index forever. Reaching the assertions proves it advances.
  const hlRe = new RegExp('(a*)', 'giud');
  assert.deepEqual(searchRangesFor('baab', hlRe), [
    { start: 0, end: 0, kind: 'search:0' },
    { start: 1, end: 3, kind: 'search:0' },
    { start: 3, end: 3, kind: 'search:0' },
    { start: 4, end: 4, kind: 'search:0' },
  ]);
});

test('searchRangesFor: no match yields no ranges', () => {
  const hlRe = new RegExp('(z)', 'giud');
  assert.deepEqual(searchRangesFor('cat', hlRe), []);
});

const matchWith = (n, text) => new RegExp('(.)'.repeat(n), 'd').exec(text);

test('groupSpansToRanges: assigns kinds cycling search:0..N-1', () => {
  const m = matchWith(3, 'abc');
  assert.deepEqual(groupSpansToRanges(m), [
    { start: 0, end: 1, kind: 'search:0' },
    { start: 1, end: 2, kind: 'search:1' },
    { start: 2, end: 3, kind: 'search:2' },
  ]);
});

test('groupSpansToRanges: the color index wraps modulo HL_COLORS', () => {
  const m = matchWith(HL_COLORS + 1, 'a'.repeat(HL_COLORS + 1));
  const out = groupSpansToRanges(m);
  assert.equal(out.length, HL_COLORS + 1);
  assert.equal(out[HL_COLORS - 1].kind, `search:${HL_COLORS - 1}`);
  assert.equal(out[HL_COLORS].kind, 'search:0');
});

test('groupSpansToRanges: skips groups that did not participate', () => {
  const m = /(a)|(b)/d.exec('b');
  assert.deepEqual(groupSpansToRanges(m), [
    { start: 0, end: 1, kind: 'search:0' },
  ]);
});

test('groupSpansToRanges: a match with no indices (no `d` flag) yields []', () => {
  assert.deepEqual(groupSpansToRanges(/(a)/.exec('a')), []);
});

test('groupSpansToRanges: a falsy match yields []', () => {
  assert.deepEqual(groupSpansToRanges(null), []);
});

test('renderHighlightedText: no ranges returns the HTML-escaped input', () => {
  assert.equal(renderHighlightedText('cat', []), 'cat');
  assert.equal(renderHighlightedText('cat', null), 'cat');
  assert.equal(renderHighlightedText('a<img>&"', []), 'a&lt;img&gt;&amp;&quot;');
});

test('renderHighlightedText: a search:N kind wraps in <mark class="search-match search-match-N">', () => {
  const out = renderHighlightedText('cat', [{ start: 0, end: 1, kind: 'search:2' }]);
  assert.equal(out, '<mark class="search-match search-match-2">c</mark>at');
});

test('renderHighlightedText: a non-search kind wraps in <span class="hl-KIND">', () => {
  const out = renderHighlightedText('cat', [{ start: 0, end: 1, kind: 'anagram' }]);
  assert.equal(out, '<span class="hl-anagram">c</span>at');
});

test('renderHighlightedText: interleaves un-highlighted text between ranges verbatim', () => {
  const out = renderHighlightedText('cat', [
    { start: 0, end: 1, kind: 'search:0' },
    { start: 2, end: 3, kind: 'search:1' },
  ]);
  assert.equal(out, '<mark class="search-match search-match-0">c</mark>a<mark class="search-match search-match-1">t</mark>');
});

test('renderHighlightedText: entry text is HTML-escaped (entries can come from untrusted wordlists)', () => {
  const out = renderHighlightedText('a<b&c', [{ start: 0, end: 3, kind: 'search:0' }]);
  assert.equal(out, '<mark class="search-match search-match-0">a&lt;b</mark>&amp;c');
});

test('renderHighlightedText: overlapping later ranges are skipped entirely', () => {
  const out = renderHighlightedText('cat', [
    { start: 0, end: 2, kind: 'search:0' },
    { start: 1, end: 3, kind: 'search:1' },
  ]);
  assert.equal(out, '<mark class="search-match search-match-0">ca</mark>t');
});

test('renderHighlightedText: a zero-or-negative-width range is skipped', () => {
  const out = renderHighlightedText('cat', [{ start: 1, end: 1, kind: 'search:0' }]);
  assert.equal(out, 'cat');
});
