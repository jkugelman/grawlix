'use strict';

import { buildSearchPattern } from '../search.js';
import { runReplace, replacementMarksOutput } from '../regex.js';
import {
  MATCH_PARAM, matchModeOf, ALLOW_UNLISTED_PARAM, SEARCH_HELP, isReplacing,
  matchModeAssets, matchModeSpacing, matchModeSpacingLazy,
} from './shared.js';

// Not parseReplacement: `$` is plain text in search syntax, and parsing
// would silently swallow `$N` (search patterns have no groups to echo).
const replaceTokens = params => (params.replace ? [{ lit: params.replace }] : []);

function build(params, spacing) {
  const matchMode = matchModeOf(params);
  const matcher = buildSearchPattern(params.pattern || '', matchMode, { reader: spacing });
  if (!matcher) return null;
  if (isReplacing(params)) {
    return { mode: 'replace', re: matcher.globalRe, hlRe: matcher.hlRe, tokens: replaceTokens(params), allowUnlisted: !!params['unlisted'], matchMode, spacing };
  }
  return { mode: 'filter', matcher };
}

export default {
  name: 'Search', icon: '<svg width="16" height="16" aria-hidden="true"><use href="#icon-search"/></svg>', category: 'search',
  desc: 'Search (and replace) with wildcards',
  example: 'un*ed · c?t',
  findReplace: true, replaceName: 'Replace',
  params: [
    { placeholder: 'pattern', help: SEARCH_HELP },
    { key: 'replace', placeholder: 'replace', raw: true, encodeEmpty: true },
    MATCH_PARAM,
    ALLOW_UNLISTED_PARAM,
  ],
  kind: params => (isReplacing(params) ? 'transform' : 'filter'),
  input: 'highlight',
  output: params => (replacementMarksOutput(replaceTokens(params), false) ? 'highlight' : 'plain'),
  glyph: params => (isReplacing(params) ? '→' : null),
  // An empty (or invalid, e.g. a reversed range) query is a no-op: the row is
  // transparent — no filtering, no lens — so an empty permanent search bar
  // costs nothing and a half-typed pattern doesn't blank the view.
  isInert: params => !buildSearchPattern(params && params.pattern || ''),
  matchOn: 'both',
  assets: matchModeAssets,
  async prepare(params, ctx) {
    return build(params, await matchModeSpacing(params, ctx));
  },
  replay: (params, ctx) => build(params, matchModeSpacingLazy(params, ctx)),
  run(wlEntry, prepared, wordlist) {
    if (!prepared) return true;
    if (prepared.mode === 'replace') return runReplace(wlEntry, prepared, wordlist);
    const { matcher } = prepared;
    if (!matcher.test(wlEntry)) return null;
    const ranges = matcher.searchRanges(wlEntry);
    return ranges.length ? ranges : true;
  },
};
