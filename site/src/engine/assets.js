'use strict';

import {
  UNIGRAM_CORPUS_URL, UNIGRAM_CORPUS_IDB_KEY, UNIGRAM_CORPUS_SIZE_KEY,
  loadUnigramCorpus, invalidateUnigramCorpus, hasUnigramCorpus,
} from './segmenter.js';
import {
  CMU_DICT_URL, CMU_DICT_IDB_KEY, CMU_DICT_SIZE_KEY,
  loadCmuDict, invalidateCmuDict, hasCmuDict,
} from './phonetics.js';

// `autoUpdate` opts an asset into the hourly remote-freshness check. Both are static
// reference datasets, so they're off it — ship a newer copy by bumping the `dataIdbKey`
// (orphans the old record, re-fetches on next load), not by polling.
export const DATA_ASSETS = [
  {
    key: 'unigrams',
    url: UNIGRAM_CORPUS_URL,
    dataIdbKey: UNIGRAM_CORPUS_IDB_KEY,
    sizeIdbKey: UNIGRAM_CORPUS_SIZE_KEY,
    autoUpdate: false,
    load: loadUnigramCorpus,
    invalidate: invalidateUnigramCorpus,
    has: hasUnigramCorpus,
  },
  {
    key: 'cmudict',
    url: CMU_DICT_URL,
    dataIdbKey: CMU_DICT_IDB_KEY,
    sizeIdbKey: CMU_DICT_SIZE_KEY,
    autoUpdate: false,
    load: loadCmuDict,
    invalidate: invalidateCmuDict,
    has: hasCmuDict,
  },
];

export function getDataAsset(key) {
  return DATA_ASSETS.find(a => a.key === key) || null;
}

export function anyAssetAutoUpdates() {
  return DATA_ASSETS.some(a => a.autoUpdate);
}
