'use strict';

// ─── Publisher lookup ─────────────────────────────────────────────────────────

import { WORDLIST_PUBLISHERS } from '../core/constants.js';

export function getPublisher(wordlist) {
  return wordlist.publisherId ? WORDLIST_PUBLISHERS.find(p => p.id === wordlist.publisherId) ?? null : null;
}
