'use strict';

import { displayOf } from '../norm.js';
import { SPACE_OUT_WINDOWS, loadUnigramCorpus, hasUnigramCorpus } from '../segmenter.js';
import { spaceOutSplits } from '../space-out.js';

async function ensureCorpus() {
  try {
    await loadUnigramCorpus();
  } catch {
    throw new Error('Couldn’t load the word-frequency corpus — check your connection.');
  }
}

export default {
  name: 'Space out', icon: '🌌', category: 'phrase',
  desc: 'Guess at where spaces go in multi-word entries',
  example: 'spaceout → space out',
  assets: ['unigrams'],
  params: [
    { key: 'splits', label: 'Splits', type: 'range', default: 'few',
      choices: [
        { value: 'one',  label: 'One'  },
        { value: 'few',  label: 'Few'  },
        { value: 'many', label: 'Many' },
      ] },
  ],
  kind: 'transform', matchOn: 'both', input: 'plain', output: 'plain',
  glyph: () => '→',
  async prepare(params, ctx) {
    await ensureCorpus();
    const choice = params.splits || 'few';
    return {
      // The full merge even under a scoped view: a scope carries only its own
      // entries, and segmenting against those thins every split with no error.
      vocab: ctx.vocab,
      window: choice === 'many' ? SPACE_OUT_WINDOWS.many : SPACE_OUT_WINDOWS.few,
      limit: choice === 'one' ? 1 : Infinity,
    };
  },
  run(wlEntry, prepared) {
    if (!hasUnigramCorpus()) return [];
    const entry = wlEntry.norm;
    // This row's own spelling, not the norm's canonical one: asking the corpus
    // which spelling represents the norm answers about a sibling row, so a spaced
    // entry sitting beside an unspaced one re-splits into a synthetic duplicate.
    if (displayOf(wlEntry).includes(' ')) return [{ entry }];
    const { vocab, window, limit } = prepared;
    // A split re-spaces the entry without changing its letters, so every output
    // shares the input's norm — the wordlist's own spelling of it is the passthrough
    // above, and anything this produces is a spacing the list does not carry.
    return spaceOutSplits(entry, vocab, { window, limit })
      .map(parts => parts.length === 1 ? { entry } : { entry: [parts.join(' ')] });
  },
};
