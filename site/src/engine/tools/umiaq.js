'use strict';

import { buildHelpHTML } from '../../core/util.js';
import { parseUmiaqQuery, matchPattern, findTuples, variableColors, variableHighlights } from '../umiaq.js';

// Memory ceiling, not a UX cap: Umiaq streams every tuple it finds, but the
// worker retains the full list for scrollback, so a fully unbounded broad query
// would blow memory. Sized past any realistic result set; a long run is bounded
// by streaming + cancel-on-edit, not by this.
const UMIAQ_MAX_RESULTS = 99_999;

export const UMIAQ_HELP = buildHelpHTML([
  ['a–z', 'a literal letter'],
  ['?', 'any character'],
  ['*', 'any string'],
  ['#', 'any consonant'],
  ['@', 'any vowel'],
  ['[abc]', 'any of a, b, c'],
  ['A–Z', 'a variable'],
  ['~A', 'the reverse of A'],
  ['|A|=n', 'A is exactly n long (also < <= > >=)'],
  ['|A|>=0', 'A may be empty'],
  ['A!=B', 'A and B differ'],
  [';', 'separates patterns'],
]);

export default {
  name: 'Umiaq', icon: '🛶', category: 'search',
  desc: 'Advanced search with variables and constraints',
  example: 'ABBA · AB;BA',
  params: [
    { key: 'patterns', placeholder: 'AB;BA', help: UMIAQ_HELP, raw: true },
  ],
  // Arity is read off the query, not a toggle: one pattern filters (arity 1),
  // several patterns find tuples (arity = pattern count).
  kind(params) {
    const parsed = parseUmiaqQuery(params?.patterns || '');
    return parsed.ok && parsed.arity > 1 ? 'tuple' : 'filter';
  },
  // Filter-mode only: lights a single pattern's matched variables. Drop it and that
  // silently stops; the tuple path (other kind) colors its own lanes, ignoring this.
  inputHighlights: true, outputHighlights: false,
  isInert: params => !parseUmiaqQuery(params?.patterns || '').ok,
  error(params) {
    const parsed = parseUmiaqQuery(params?.patterns || '');
    return parsed.ok || parsed.empty ? null : parsed.error;
  },
  prepare(params) {
    const parsed = parseUmiaqQuery(params.patterns || '');
    if (!parsed.ok) return null;
    parsed.varColor = variableColors(parsed.variables);
    return parsed;
  },
  run(entry, parsed) {
    if (!parsed) return true;
    const matches = matchPattern(entry, parsed.patterns[0], parsed.constraints);
    if (!matches.length) return false;
    return variableHighlights(entry, parsed.patterns[0], matches[0], parsed.varColor);
  },
  findTuples(pool, parsed, ctx) {
    return findTuples(parsed, pool, { numResults: UMIAQ_MAX_RESULTS, onBatch: ctx.onBatch, y: ctx.y, signal: ctx.signal });
  },
};
