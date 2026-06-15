'use strict';

import { displayOf } from '../norm.js';
import { buildSearchPattern } from '../search.js';
import { runSearchReplace } from '../regex.js';
import { WHOLE_WORD_PARAM, SEARCH_HELP } from './shared.js';

export default {
  name: 'Search', icon: '<svg width="16" height="16" aria-hidden="true"><use href="#icon-search"/></svg>', category: 'search',
  desc: 'Search (and replace) with wildcards',
  example: 'UN*ED · C?T',
  findReplace: true,
  params: [
    { placeholder: 'pattern', help: SEARCH_HELP },
    { key: 'replace', placeholder: 'replace', raw: true },
    WHOLE_WORD_PARAM,
  ],
  kind: params => (params.replace ? 'transform' : 'filter'),
  inputHighlights: true, outputHighlights: true,
  glyph: params => (params.replace ? '→' : null),
  // An empty query is a no-op: the row is transparent — no filtering, no
  // lens — so an empty permanent search bar costs nothing.
  isInert: params => !((params && params.pattern || '').trim()),
  matchOn: 'both',
  prepare(params) {
    const matcher = buildSearchPattern((params.pattern || '').trim(), !!params['whole-word']);
    if (!matcher) return null;
    const replacement = params.replace || '';
    return replacement ? { mode: 'replace', matcher, replacement } : { mode: 'filter', matcher };
  },
  run(wlEntry, prepared, wordlist) {
    if (!prepared) return true;
    if (prepared.mode === 'replace') return runSearchReplace(displayOf(wlEntry), prepared, wordlist);
    const { matcher } = prepared;
    if (!matcher.test(wlEntry)) return null;
    const ranges = matcher.searchRanges(wlEntry);
    return ranges.length ? ranges : true;
  },
};
