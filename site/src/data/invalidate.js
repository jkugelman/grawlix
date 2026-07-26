'use strict';

// ─── Cache invalidation ─────────────────────────────────────────────────────

import { invalidateRescoredCache } from './rescoring.js';
import { invalidateSourceCounts } from './merge.js';

export function invalidateWordlistCaches(wordlist) {
  invalidateRescoredCache(wordlist);
  invalidateSourceCounts();
}
