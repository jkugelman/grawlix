'use strict';

import { buildSearchPattern } from '../search.js';
import { runReplace } from '../regex.js';
import { WHOLE_WORD_PARAM, ALLOW_UNLISTED_PARAM, SEARCH_HELP } from './shared.js';

export default {
  name: 'Search', icon: '<svg width="16" height="16" aria-hidden="true"><use href="#icon-search"/></svg>', category: 'search',
  desc: 'Search (and replace) with wildcards',
  example: 'un*ed · c?t',
  findReplace: true,
  params: [
    { placeholder: 'pattern', help: SEARCH_HELP },
    { key: 'replace', placeholder: 'replace', raw: true },
    WHOLE_WORD_PARAM,
    ALLOW_UNLISTED_PARAM,
  ],
  kind: params => (params.replace ? 'transform' : 'filter'),
  inputHighlights: true, outputHighlights: true,
  glyph: params => (params.replace ? '→' : null),
  // An empty (or invalid, e.g. a reversed range) query is a no-op: the row is
  // transparent — no filtering, no lens — so an empty permanent search bar
  // costs nothing and a half-typed pattern doesn't blank the view.
  isInert: params => !buildSearchPattern(params && params.pattern || ''),
  matchOn: 'both',
  prepare(params) {
    const matcher = buildSearchPattern(params.pattern || '', !!params['whole-word']);
    if (!matcher) return null;
    const replacement = params.replace || '';
    if (replacement) {
      // Not parseReplacement: `$` is plain text in search syntax, and parsing
      // would silently swallow `$N` (search patterns have no groups to echo).
      return { mode: 'replace', re: matcher.globalRe, hlRe: matcher.hlRe, tokens: [{ lit: replacement }], allowUnlisted: !!params['unlisted'] };
    }
    return { mode: 'filter', matcher };
  },
  run(wlEntry, prepared, wordlist) {
    if (!prepared) return true;
    if (prepared.mode === 'replace') return runReplace(wlEntry, prepared, wordlist);
    const { matcher } = prepared;
    if (!matcher.test(wlEntry)) return null;
    const ranges = matcher.searchRanges(wlEntry);
    return ranges.length ? ranges : true;
  },
};
