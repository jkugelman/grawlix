'use strict';

import { buildHelpHTML } from '../../core/util.js';
import { TUPLE_CAP_MOBILE } from '../../core/constants.js';
import { parseUmiaqQuery, matchPattern, findTuples, variableColors, variableHighlights, varsForcedNonEmpty } from '../umiaq.js';

// Memory ceiling, not a UX cap: the worker retains every streamed tuple for
// scrollback, so an unbounded broad query would blow memory. Defaults to the
// conservative mobile cap, raised on desktop at boot. The default must be the SAFE
// one: the worker can't detect mobile itself (no window.matchMedia), so a missed
// boot message has to under-retain, not over-retain into an iOS reload.
let tupleMaxResults = TUPLE_CAP_MOBILE;

export function configureUmiaq({ maxResults } = {}) {
  if (Number.isFinite(maxResults) && maxResults > 0) tupleMaxResults = maxResults;
}

export const UMIAQ_HELP = buildHelpHTML([
  ['a–z', 'a literal letter'],
  ['A–Z', 'a variable'],
  ['?', 'any character'],
  ['*', 'any string'],
  ['#', 'any consonant'],
  ['@', 'any vowel'],
  ['[abc]', 'any of a, b, c'],
  [';', 'separates clauses'],
  ['~A', 'the reverse of A'],
  ['A=#@#', 'A fits a sub-pattern'],
  ['A!=#@#', "A doesn't fit a sub-pattern"],
  ['|AB|=n', 'length check (also < <= > >=)'],
  ['|A|>=0', 'A may be empty'],
  ['7-9:…', 'only 7-to-9-letter matches'],
  ['/word', 'an anagram of word'],
]);

export default {
  name: 'Umiaq', icon: '🛶', category: 'search',
  desc: 'Advanced search with variables and constraints',
  example: 'ABBA · AB;BA',
  params: [
    { key: 'query', placeholder: 'AB;BA', help: UMIAQ_HELP, raw: true },
  ],
  // Arity is read off the query, not a toggle: one binding filters (arity 1),
  // several bindings find tuples (arity = binding count).
  kind(params) {
    const parsed = parseUmiaqQuery(params?.query || '');
    return parsed.ok && parsed.arity > 1 ? 'tuple' : 'filter';
  },
  // Filter-mode only: lights a single binding's matched variables. Drop it and that
  // silently stops; the tuple path (other kind) colors its own lanes, ignoring this.
  input: 'highlight', output: 'plain',
  isInert: params => !parseUmiaqQuery(params?.query || '').ok,
  error(params) {
    const parsed = parseUmiaqQuery(params?.query || '');
    return parsed.ok || parsed.empty ? null : parsed.error;
  },
  // Variables are non-empty chunks by default, which quietly costs you the edge cases:
  // `AtenB;AB` misses TENOR and MITTEN until A and B may be empty. Nothing in a correct-
  // looking result set says so, so the tool offers the fix instead of waiting to be asked.
  quickFix(params) {
    const parsed = parseUmiaqQuery(params?.query || '');
    if (!parsed.ok) return null;
    const vars = varsForcedNonEmpty(parsed);
    if (!vars.length) return null;
    const clauses = vars.map(v => `|${v}|>=0`).join(';');
    return {
      label: 'Allow empty variables',
      title: `By default, variables can't be empty. Adds ${clauses}.`,
      params: { query: `${params.query};${clauses}` },
    };
  },
  prepare(params) {
    const parsed = parseUmiaqQuery(params.query || '');
    if (!parsed.ok) return null;
    parsed.varColor = variableColors(parsed.variables);
    return parsed;
  },
  run(entry, parsed) {
    if (!parsed) return true;
    const matches = matchPattern(entry, parsed.bindings[0], parsed.constraints);
    if (!matches.length) return false;
    return variableHighlights(entry, parsed.bindings[0], matches[0], parsed.varColor);
  },
  findTuples(pool, parsed, ctx) {
    return findTuples(parsed, pool, { numResults: tupleMaxResults, onBatch: ctx.onBatch, y: ctx.y, signal: ctx.signal });
  },
};
