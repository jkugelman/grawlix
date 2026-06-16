'use strict';

import { toNorm, displayOf } from '../norm.js';
import {
  SPACE_OUT_WINDOWS, loadUnigramCorpus, rankedSplits, hasUnigramCorpus,
} from '../segmenter.js';

export default {
  name: 'Space out', icon: '🌌', category: 'phrase',
  desc: 'Guess at where spaces go in multi-word entries',
  example: 'SPACEOUT → SPACE OUT',
  asset: 'unigrams',
  params: [
    { key: 'splits', label: 'Splits', type: 'range', default: 'few',
      choices: [
        { value: 'one',  label: 'One'  },
        { value: 'few',  label: 'Few'  },
        { value: 'many', label: 'Many' },
      ] },
  ],
  kind: 'transform', inputHighlights: false, outputHighlights: false,
  glyph: () => '→',
  async prepare(params) {
    await loadUnigramCorpus();
    const choice = params.splits || 'few';
    return { window: SPACE_OUT_WINDOWS[choice] ?? SPACE_OUT_WINDOWS.few, onlyTop: choice === 'one' };
  },
  run(entry, prepared, wordlist) {
    if (!hasUnigramCorpus()) return [];
    const existing = wordlist.byNorm.get(entry);
    if (existing && displayOf(existing).includes(' ')) return [{ entry }];
    const splits = rankedSplits(entry, prepared.window, wordlist);
    if (splits.length === 0) return [];
    const inputScore = existing?.score ?? 0;
    const picks = prepared.onlyTop ? splits.slice(0, 1) : splits;
    return picks.map(parts => {
      const joined = parts.join(' ');
      if (joined === entry) return { entry };
      const hit = wordlist.byNorm.get(toNorm(joined));
      const hitIsJoined = hit && (hit.display || '').toLowerCase() === joined;
      return { entry: hitIsJoined ? hit.norm : [joined, inputScore] };
    });
  },
};
