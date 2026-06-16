'use strict';

import {
  UNIGRAM_CORPUS_URL, UNIGRAM_CORPUS_IDB_KEY, UNIGRAM_CORPUS_SIZE_KEY,
  loadUnigramCorpus, invalidateUnigramCorpus, hasUnigramCorpus,
} from './segmenter.js';

export const DATA_ASSETS = [
  {
    key: 'unigrams',
    url: UNIGRAM_CORPUS_URL,
    dataIdbKey: UNIGRAM_CORPUS_IDB_KEY,
    sizeIdbKey: UNIGRAM_CORPUS_SIZE_KEY,
    load: loadUnigramCorpus,
    invalidate: invalidateUnigramCorpus,
    has: hasUnigramCorpus,
  },
];

export function getDataAsset(key) {
  return DATA_ASSETS.find(a => a.key === key) || null;
}
