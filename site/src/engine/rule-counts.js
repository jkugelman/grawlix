'use strict';

// ─── Rule counts ──────────────────────────────────────────────────────────────
// What a list's draft rescore rules do to its own raw entries, for the rule
// editor's live preview. See docs/wordlists.md § Rescore rules.

import { compileQuery } from './rule-query.js';
import { compileRule, ruleIsActive } from './rescore.js';
import { sourceAccessor } from './sources.js';

// Enough to fill the one-line, ellipsized examples at the foot of the editor's
// suggestion list, at any width.
const SAMPLES = 24;

export function countRules(wl, rules, { probes = [] } = {}) {
  const acc = sourceAccessor(wl);
  const compiled = rules.map(r => {
    const c = { query: r.query, output: r.output };
    compileRule(c);
    return c;
  });
  const active = compiled.map(ruleIsActive);
  const wins = compiled.map(() => []);
  const probeFns = probes.map(q => compileQuery(q).match);
  const probeCounts = probeFns.map(fn => fn ? 0 : null);
  let total = 0, unmatched = 0;

  acc.forEachRawSubject((s, i) => {
    total++;
    let r = 0;
    while (r < compiled.length && !(active[r] && compiled[r]._match(s))) r++;
    if (r < compiled.length) wins[r].push(i);
    else unmatched++;
    for (let p = 0; p < probeFns.length; p++) if (probeFns[p]?.(s)) probeCounts[p]++;
  });

  const out = wins.map((w, r) => {
    if (!active[r]) return null;
    const step = Math.max(1, Math.floor(w.length / SAMPLES));
    const samples = [];
    for (let k = 0; k < SAMPLES && k * step < w.length; k++) {
      const e = acc.rawEntryAt(w[k * step]);
      samples.push({ norm: e.norm, display: e.display ?? null });
    }
    return { wins: w.length, samples };
  });
  return { total, unmatched, bare: !acc.hasDisplays(), rules: out, probes: probeCounts };
}
