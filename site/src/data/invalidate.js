'use strict';

// ─── Cache invalidation ─────────────────────────────────────────────────────

import { invalidateRescoredCache } from './rescoring.js';
import { invalidateStatsCache } from '../engine/stats.js';
import { invalidateSourceCounts, _mergedStatsKey } from './merge.js';

export function invalidateWordlistCaches(wordlist) {
  invalidateRescoredCache(wordlist);
  invalidateStatsCache(wordlist);
  invalidateSourceCounts();
  invalidateStatsCache(_mergedStatsKey);
}
