'use strict';
import { bestRowForNorm } from '../corpus.js';
import { toNorm, isUnspaced } from '../norm.js';
import { buildSpacingTable, spacingReader, loadSpacingCorpus } from '../space-out.js';

export function wordSplits(display) {
  const stripped = display.split(/[ ]+/).filter(Boolean);
  const splits = [stripped];
  if (stripped.some(w => w.includes('-'))) {
    splits.push(stripped.flatMap(w => w.split(/-+/).filter(Boolean)));
  }
  return splits;
}

const spells = (words, target) =>
  words.length === target.length && words.every((w, i) => w[0].toLowerCase() === target[i]);

// Initials come off each part's norm: a guessed part can carry an override's leading
// apostrophe or capital, which no target types.
const initialsOf = parts => parts.map(p => toNorm(p)[0]).join('');

// Marks only a guessed reading, where nothing else on the row says where the words
// are. Norm coordinates, because the parts are slices of the norm: the renderer maps
// them onto a display that may carry punctuation between the letters.
function initialRanges(parts) {
  let at = 0;
  return parts.map(p => {
    const range = { start: at, end: at + 1, kind: 'search:0', coord: 'norm' };
    at += toNorm(p).length;
    return range;
  });
}

const prepareFilter = (params, ctx) =>
  ({ target: (params['word'] || '').trim().toLowerCase(), spacing: spacingReader(ctx) });

export default {
  name: 'Initialisms', icon: '🔠', category: 'phrase',
  desc: 'Starting letters spell a word',
  example: 'hot → Helen of Troy',
  assets: ['unigrams'],
  params: [{ placeholder: 'word' }],
  kind: 'filter', input: 'highlight', output: 'plain',
  matchOn: 'display',
  isInert: params => !((params && params['word'] || '').trim()),
  async prepare(params, ctx) {
    await loadSpacingCorpus();
    return prepareFilter(params, ctx);
  },
  replay: prepareFilter,
  run(displayText, { target, spacing }) {
    if (!target) return true;
    if (wordSplits(displayText).some(words => spells(words, target))) return true;
    if (target.length < 2 || !isUnspaced(displayText)) return false;
    // Reading an entry costs a segmenter pass, so rule it out on its letters first.
    const norm = toNorm(displayText);
    if (norm.length < target.length || norm[0] !== target[0]) return false;
    const parts = spacing.best(norm);
    return !!parts && initialsOf(parts) === target && initialRanges(parts);
  },
  group: {
    async prepare(params, ctx) {
      await loadSpacingCorpus();
      return { spacing: await buildSpacingTable(ctx) };
    },
    key: (displayText, { spacing }) => {
      const words = displayText.split(/[ ]+/).filter(Boolean);
      if (words.length >= 2) return words.map(w => w[0].toLowerCase()).join('');
      const parts = isUnspaced(displayText) && spacing.best(toNorm(displayText));
      return parts ? initialsOf(parts) : null;
    },
    // The reading is re-derived here against today's vocab, so it is checked against
    // the key: an edit since the run can change it, and stale marks would mislead.
    memberHighlights: (displayText, key, ctx) => {
      if (!isUnspaced(displayText)) return [];
      const parts = spacingReader(ctx).best(toNorm(displayText));
      return parts && initialsOf(parts) === key ? initialRanges(parts) : [];
    },
    // A phrase listed both spaced and unspaced is one member, not a pair.
    keepGroup: members => new Set(members.map(toNorm)).size >= 2,
    anchor: (key, wordlist) => bestRowForNorm(wordlist, key),
    anchorLabel: 'Initialism',
  },
};
