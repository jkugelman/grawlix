'use strict';

import {
  analyzeRegexPattern, wrapRuns, parseReplacement,
  regexExecAll, runReplace,
} from '../regex.js';
import { buildHelpHTML } from '../../core/util.js';
import { matchModeOk } from '../search.js';
import { MATCH_PARAM, matchModeOf, ALLOW_UNLISTED_PARAM } from './shared.js';

// The SyntaxError prefix is engine-specific: V8 echoes the pattern ("Invalid
// regular expression: /<src>/<flags>: "), JSC bares it ("Invalid regular
// expression: "), SpiderMonkey omits it. Strip the prefix and its optional
// echo so the ⚠ shows just the reason, whatever the engine.
function regexError(pattern) {
  const src = pattern || '';
  if (!src) return null;
  try { new RegExp(src); return null; }
  catch (e) { return String(e.message).replace(/^Invalid regular expression:\s*(?:\/.*\/[a-z]*:\s*)?/, ''); }
}

export default {
  name: 'Regex', icon: '🪄', category: 'search',
  desc: 'Search (and replace) with regular expressions',
  example: 'un.+ed · c.{2,4}t',
  findReplace: true,
  params: [
    { key: 'pattern', raw: true, placeholder: 'pattern', help: buildHelpHTML([
      ['.*', 'any string'],
      ['.', 'any character'],
      ['[abc]', 'any of a, b, c'],
      ['[^abc]', 'none of a, b, c'],
      ['a*', 'zero or more'],
      ['a+', 'one or more'],
      ['a?', 'optional'],
      ['a{2,4}', '2 to 4 times'],
      ['a|b', 'either a or b'],
      ['(…)', 'capture group'],
    ], { link: { url: 'https://regexone.com/', text: 'Learn regex at regexone.com →' } }) },
    { key: 'replace', placeholder: 'replace', raw: true, help: buildHelpHTML([
      ['$1', 'first capture group'],
      ['$2', 'second group, etc.'],
      ['$&', 'the whole match'],
      ['$$', 'a literal $'],
    ], { cols: 1, link: { url: 'https://regexone.com/', text: 'Learn regex at regexone.com →' } }) },
    MATCH_PARAM,
    ALLOW_UNLISTED_PARAM,
  ],
  // Blank replacement reads as filter mode, not "delete the match" — a blank
  // field is indistinguishable from one that was never touched.
  kind: params => (params.replace ? 'transform' : 'filter'),
  inputHighlights: true, outputHighlights: true,
  glyph: params => (params.replace ? '→' : null),
  // A half-typed, invalid pattern is inert like an empty one, so the view
  // neither blanks nor churns mid-keystroke.
  isInert(params) {
    const pattern = params && params.pattern || '';
    return !pattern || !!regexError(pattern);
  },
  error: params => regexError(params && params.pattern),
  matchOn: 'both',
  prepare(params) {
    const replacement = params.replace || '';
    // Don't trim: in a regex a leading/trailing space is a literal that must
    // match. Re-adding `.trim()` reads as cleanup but silently drops it.
    const body = params.pattern;
    // Flags `gid`: `i` lets a raw (un-lowercased, so `\D \S \B` survive)
    // pattern match case-insensitively; `d` exposes match indices for
    // highlighting. The pattern runs against both norm and display (see run),
    // so `\s`, `-`, or an accent can match the punctuation display carries but
    // norm strips. The whole-entry wrap is non-capturing so `$N` backrefs keep
    // their group numbers.
    const matchMode = matchModeOf(params);
    const wrap = src => matchMode === 'full' ? '^(?:' + src + ')$' : src;
    const { capturing, runs } = analyzeRegexPattern(body);
    if (replacement) {
      // The functional `re` can't be wrapped for highlighting — synthetic
      // groups would renumber the user's `$N`; `hlRe` is the wrapped copy.
      const hlRe = capturing ? null : new RegExp(wrap(wrapRuns(body, runs)), 'gid');
      return { mode: 'replace', re: new RegExp(wrap(body), 'gid'), hlRe, tokens: parseReplacement(replacement), allowUnlisted: !!params['unlisted'], matchMode };
    }
    return { mode: 'filter', re: new RegExp(wrap(capturing ? body : wrapRuns(body, runs)), 'gid'), matchMode };
  },
  run(wlEntry, prepared, wordlist) {
    if (prepared.mode === 'filter') {
      const { re, matchMode } = prepared;
      const d = wlEntry.display;
      if (matchMode === 'span' && d == null) return null;
      const normRes = regexExecAll(re, wlEntry.norm, matchModeOk(matchMode, wlEntry, 'norm'));
      const dispRes = d != null ? regexExecAll(re, d, matchModeOk(matchMode, wlEntry, 'display')) : null;
      if (!normRes.hit && !dispRes?.hit) return null;
      if (dispRes?.ranges.length) return dispRes.ranges.map(r => ({ ...r, coord: 'display' }));
      if (normRes.ranges.length) return normRes.ranges.map(r => ({ ...r, coord: 'norm' }));
      return true;
    }
    return runReplace(wlEntry, prepared, wordlist);
  },
};
