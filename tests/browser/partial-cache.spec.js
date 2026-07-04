import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The partial-run cache: a superseded streaming run stashes its incomplete join; re-entering
// the same (stack, scope) resumes it. See docs/design.md § Streaming results.
//
// Every test ISOLATES the three caches so only the partial path is exercised: the finished and
// prefix caches are floored off (1e9) so a re-entry can ONLY hit the partial cache, and the
// partial floor is dropped to 0 so any streamed-then-superseded run stashes.

// A streaming run is caught mid-stream deterministically: stopRunAfterTotalForTest arms it to
// self-supersede once its total crosses a chosen depth, so a partial always stashes with no
// abort-vs-completion race. Serial pins the file to one worker (matching CI's workers:1), which
// keeps the two remaining externally-timed aborts (the catch-up re-abort and the gen-guard delete)
// off a contended CPU.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  // Every mid-stream poll waits on this: it resolves the instant the predicate is truthy, up to
  // a generous deadline — never a fixed iteration count that CPU starvation could exhaust. So the
  // tests wait for observable worker STATE, and their assertions read state, not wall-clock.
  await page.addInitScript(() => {
    window.__waitFor = async (pred, ms = 20000) => {
      const end = Date.now() + ms; let v;
      while (!(v = await pred()) && Date.now() < end) await new Promise(r => setTimeout(r, 0));
      return v;
    };
  });
});

// Big enough that the scan crosses many 1ms yield boundaries (so it streams partials at all) and
// that the deep-stash threshold (15000) sits well below the full count, so the armed self-abort
// fires before completion. A 1ms interval (not 0) keeps the yield count bounded — 0 starves
// setTimeout on firefox/webkit.
const COUNT = 40000;
const STREAM_MS = 1;
const SHIPPED_MS = 30;

async function seedBig(page, { aerie = false } = {}) {
  await page.evaluate(count => {
    const entries = [], scores = [];
    for (let i = 0; i < count; i++) {
      entries.push('W' + String(i).padStart(5, '0'));
      scores.push(10 + (i % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
  }, COUNT);
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  // AERIE lives only in My Edits, so it is the merge winner and sorts first (Entry sort) —
  // landing INSIDE the stashed prefix, where an invalidation test can prove the resume reads
  // its post-edit score from the stash rather than a fresh scan.
  if (aerie) {
    await page.evaluate(() => window.__grawlixTest.saveMyEdit('AERIE', 'AERIE', 50));
    await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  }
}

const isolate = page => page.evaluate(() => {
  window.__grawlixTest.configureResultCacheForTest({ minMs: 1e9 });   // finished cache off
  window.__grawlixTest.configurePrefixCacheForTest({ minMs: 1e9 });   // prefix cache off
  window.__grawlixTest.configurePartialCacheForTest({ minMs: 0 });    // partial cache ON
});

const partialState = page => page.evaluate(() => window.__grawlixTest.partialCacheState());

const flat = pattern => [{ tool: 'search', params: { pattern } }];

async function coldFlatRows(page, stack) {
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const w = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 1e9));
  return w.rows.map(r => [r.norm, r.score]);
}

// Run `stack` until its total crosses `minTotal`, where it self-supersedes and stashes its partial.
// The `detour` setStack does not cause the abort (the arm did) — it only settles the self-aborted
// run's pending promise, which never resolves on its own (a superseded run posts nothing terminal).
async function abandonFlat(page, stack, detour, minTotal = 1) {
  return page.evaluate(async ({ stack, detour, minTotal, STREAM_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    T.stopRunAfterTotalForTest(minTotal);
    const capture = T.captureWorkerPartialsForTest();
    const runA = (async () => { await T.setStack(stack); await T.pipelineIdle(); })();
    const hit = await window.__waitFor(() => capture.peek().find(p => p.total >= minTotal));
    await T.setStack(detour);
    await T.pipelineIdle();
    await runA;
    const aRunId = hit ? hit.runId : null;
    const aParts = capture.stop().filter(p => p.runId === aRunId);
    return { aRunId, aLastTotal: aParts.length ? aParts[aParts.length - 1].total : 0 };
  }, { stack, detour, minTotal, STREAM_MS });
}

async function reenterFlat(page, stack) {
  const out = await page.evaluate(async ({ stack, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.stopRunAfterTotalForTest(0);   // a re-entry must run to completion — never inherit a leftover backstop
    const capture = T.captureWorkerPartialsForTest();
    await T.setStack(stack);
    await T.pipelineIdle();
    const parts = capture.stop().map(p => p.total);
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const st = await T.partialCacheState();
    const full = await T.fetchWorkerRows(0, 1e9);
    return { parts, st, rows: full.rows.map(r => [r.norm, r.score]) };
  }, { stack, SHIPPED_MS });
  return out;
}

test('workflow: abandon a slow flat run, detour, re-enter — resumes the stash and catches up byte-identically', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page);
  const expected = await coldFlatRows(page, flat('W*'));   // true result, caches off
  await isolate(page);

  const { aLastTotal } = await abandonFlat(page, flat('W*'), flat('X*'));
  expect(aLastTotal).toBeGreaterThan(0);                   // the run really did stream a partial

  const { parts, st, rows } = await reenterFlat(page, flat('W*'));
  expect(st.stashes).toBeGreaterThanOrEqual(1);            // the abandoned run stashed
  expect(st.hits).toBeGreaterThanOrEqual(1);               // ... and the re-entry resumed it
  expect(st.resumedFrom).toBe(aLastTotal);                 // resumed from exactly the stash length
  expect(rows).toEqual(expected);                          // caught up to a byte-identical result
});

test('the resumed run paints the stash instantly and never rewinds the count', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page);
  await isolate(page);

  const { aLastTotal } = await abandonFlat(page, flat('W*'), flat('X*'));
  const { parts } = await reenterFlat(page, flat('W*'));

  expect(parts[0]).toBe(aLastTotal);                       // first snapshot IS the stash — instant paint
  expect(Math.min(...parts)).toBe(aLastTotal);             // count never dips below it (frozen during catch-up)
  expect([...parts]).toEqual([...parts].sort((a, b) => a - b));   // monotonic — no count-rewind to 0
});

test('scrolling during catch-up serves real rows, never skeletons', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page);
  await isolate(page);

  await abandonFlat(page, flat('W*'), flat('X*'));

  // Re-enter and, the moment the paint lands, fetch a window: the rehydrated slot holds the
  // whole stashed join, so a scroll during the frozen catch-up gets real rows, not skeletons.
  const mid = await page.evaluate(async ({ SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    const capture = T.captureWorkerPartialsForTest();
    const run = (async () => { await T.setStack([{ tool: 'search', params: { pattern: 'W*' } }]); await T.pipelineIdle(); })();
    let rows = null;
    await window.__waitFor(async () => {
      const ps = capture.peek();
      if (!ps.length) return false;
      const reply = await T.fetchWorkerRows(0, 20, ps[0].runId);
      if (reply && reply.rows.length) { rows = reply.rows.map(r => r.norm); return true; }
      return false;
    });
    await run;
    capture.stop();
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    return rows;
  }, { SHIPPED_MS });

  expect(mid).not.toBeNull();
  expect(mid.length).toBe(20);
  for (const norm of mid) expect(norm).toMatch(/^w\d{5}$/);   // real entries, no skeletons
});

test('the 1s floor gates admission: an abandoned sub-second run never stashes', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page);
  // Finished + prefix off, but the partial cache keeps its REAL 1s floor: a ~tens-of-ms scan is
  // below it, so the abandoned run must not stash and the re-entry must run cold.
  await page.evaluate(() => {
    window.__grawlixTest.configureResultCacheForTest({ minMs: 1e9 });
    window.__grawlixTest.configurePrefixCacheForTest({ minMs: 1e9 });
    window.__grawlixTest.configurePartialCacheForTest({ minMs: 1000 });
  });

  await abandonFlat(page, flat('W*'), flat('X*'));
  const { st } = await reenterFlat(page, flat('W*'));
  expect(st.stashes).toBe(0);          // the transient never stashed
  expect(st.resumedFrom).toBe(0);      // ... so the re-entry ran cold
});

test('re-abandoning a resumed run during catch-up loses no progress', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page);
  const expected = await coldFlatRows(page, flat('W*'));
  await isolate(page);

  // Abandon DEEP so the stash is large: the resume's catch-up then re-scans a long way, so
  // aborting the instant the paint lands falls well before the crossover.
  const { aLastTotal } = await abandonFlat(page, flat('W*'), flat('X*'), 15000);
  expect(aLastTotal).toBeGreaterThanOrEqual(15000);

  const out = await page.evaluate(async ({ COUNT }) => {
    const T = window.__grawlixTest;
    // The catch-up phase is silent (no partials post), so it can't be hook-aborted deterministically —
    // the external X* races it. Backstop the resume at 3/4 of the corpus so that even if X* is delayed
    // it self-aborts before fully completing (a completed run stashes nothing, leaving the re-entry cold).
    T.stopRunAfterTotalForTest(Math.floor(COUNT * 0.75));
    const capture = T.captureWorkerPartialsForTest();
    const runB = (async () => { await T.setStack([{ tool: 'search', params: { pattern: 'W*' } }]); await T.pipelineIdle(); })();
    const paint = await window.__waitFor(() => { const ps = capture.peek(); return ps.length ? ps[0] : null; });
    await T.setStack([{ tool: 'search', params: { pattern: 'X*' } }]);   // abort the resumed run
    await T.pipelineIdle();
    await runB;
    T.stopRunAfterTotalForTest(0);   // the backstop need not have fired — disarm before the re-entry
    const parts = capture.stop().filter(p => p.runId === paint.runId).map(p => p.total);
    return { first: parts[0], count: parts.length };
  }, { COUNT });
  expect(out.first).toBe(aLastTotal);          // the paint reproduced the stash

  // `count === 1` means only the paint shipped — the re-abort landed mid-catch-up (no push), so
  // the stash is unchanged; otherwise it crossed over (or hit the backstop) and grew. Either outcome
  // is correct, so this asserts the right invariant for whichever phase happened — no race to lose.
  const { st, rows } = await reenterFlat(page, flat('W*'));
  if (out.count === 1) expect(st.resumedFrom).toBe(aLastTotal);
  else expect(st.resumedFrom).toBeGreaterThan(aLastTotal);
  expect(rows).toEqual(expected);
});

test('re-abandoning a resumed run past the crossover keeps the extra progress', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page);
  const expected = await coldFlatRows(page, flat('W*'));
  await isolate(page);

  const { aLastTotal } = await abandonFlat(page, flat('W*'), flat('X*'));   // a shallow stash

  // Resume, let it stream PAST the crossover (a partial whose total exceeds the stash = live rows
  // past the abort point), then abandon it again — the re-stash must keep the grown partial.
  const grown = await page.evaluate(async ({ aLastTotal }) => {
    const T = window.__grawlixTest;
    // The paint (total === aLastTotal) posts outside the hook path, so arming one past the stash
    // self-aborts on the first genuine post-crossover partial — deterministically grown, no race.
    T.stopRunAfterTotalForTest(aLastTotal + 1);
    const capture = T.captureWorkerPartialsForTest();
    const runB = (async () => { await T.setStack([{ tool: 'search', params: { pattern: 'W*' } }]); await T.pipelineIdle(); })();
    const past = await window.__waitFor(() => capture.peek().find(p => p.total > aLastTotal));
    await T.setStack([{ tool: 'search', params: { pattern: 'X*' } }]);
    await T.pipelineIdle();
    await runB;
    const parts = capture.stop().filter(p => p.runId === (past ? past.runId : null)).map(p => p.total);
    return parts[parts.length - 1];
  }, { aLastTotal });
  expect(grown).toBeGreaterThan(aLastTotal);   // it streamed past the crossover

  const { st, rows } = await reenterFlat(page, flat('W*'));
  expect(st.resumedFrom).toBe(grown);          // the re-stash kept the grown partial, not the original
  expect(rows).toEqual(expected);
});

// ─── Tuple tier ──────────────────────────────────────────────────────────────

async function seedQuads(page) {
  await page.evaluate(() => {
    const A = 'abcdefg', entries = [], scores = [];
    for (const a of A) for (const b of A) for (const c of A) for (const d of A) {
      entries.push(a + b + c + d);
      scores.push(10 + (entries.length % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Quads', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.setScope('Quads'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const tuple = patterns => [{ tool: 'umiaq', params: { patterns } }];

async function coldTupleGroups(page, stack) {
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const runId = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  const reply = await page.evaluate(rid => window.__grawlixTest.fetchWorkerAllGroups(rid), runId);
  return reply.groups.map(g => g.key);
}

async function abandonTuple(page, stack, detour) {
  return page.evaluate(async ({ stack, detour, STREAM_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    T.stopRunAfterTotalForTest(1);
    const capture = T.captureWorkerGroupPartialsForTest();
    const runA = (async () => { await T.setStack(stack); await T.pipelineIdle(); })();
    const first = await window.__waitFor(() => { const ps = capture.peek(); return ps.length ? ps[0] : null; });
    const aRunId = first ? first.runId : null;
    await T.setStack(detour);
    await T.pipelineIdle();
    await runA;
    const aParts = capture.stop().filter(p => p.runId === aRunId);
    return { aRunId, aLastTotal: aParts.length ? aParts[aParts.length - 1].total : 0 };
  }, { stack, detour, STREAM_MS });
}

test('workflow: abandon a slow tuple run, detour, re-enter — resumes the stash byte-identically', async ({ page }) => {
  await gotoApp(page);
  await seedQuads(page);
  const expected = await coldTupleGroups(page, tuple('AB;BA'));
  await isolate(page);

  const { aLastTotal } = await abandonTuple(page, tuple('AB;BA'), flat('a'));
  expect(aLastTotal).toBeGreaterThan(0);

  const out = await page.evaluate(async ({ SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    const capture = T.captureWorkerGroupPartialsForTest();
    await T.setStack([{ tool: 'umiaq', params: { patterns: 'AB;BA' } }]);
    await T.pipelineIdle();
    const parts = capture.stop().map(p => p.total);
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const st = await T.partialCacheState();
    const runId = T.lastCompletedRunId();
    const reply = await T.fetchWorkerAllGroups(runId);
    return { parts, st, groups: reply.groups.map(g => g.key) };
  }, { SHIPPED_MS });

  expect(out.st.hits).toBeGreaterThanOrEqual(1);
  expect(out.st.resumedFrom).toBe(aLastTotal);
  expect(out.parts[0]).toBe(aLastTotal);                       // instant paint of the stashed tuples
  expect([...out.parts]).toEqual([...out.parts].sort((a, b) => a - b));   // no rewind
  expect(out.groups).toEqual(expected);                        // byte-identical group order
});

// ─── Transform tier (rebuild-and-swap) ────────────────────────────────────────

async function seedQuints(page) {
  await page.evaluate(() => {
    const A = 'abcdefg', entries = [], scores = [];
    for (const a of A) for (const b of A) for (const c of A) for (const d of A) for (const e of A) {
      entries.push(a + b + c + d + e);
      scores.push(10 + (entries.length % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Quints', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.setScope('Quints'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const SEMO = [{ tool: 'semordnilap', params: {} }];
const chainStr = c => c.atoms.map(a => (a.glyph || '') + (a.wlEntry.display ?? a.wlEntry.norm)).join(' ');

async function coldTransformRows(page, stack) {
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const runId = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  const reply = await page.evaluate(rid => window.__grawlixTest.fetchWorkerAllTransformRows(rid), runId);
  return reply.rows.map(chainStr);
}

async function abandonTransform(page, stack, detour) {
  return page.evaluate(async ({ stack, detour, STREAM_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    T.stopRunAfterTotalForTest(1);
    const capture = T.captureWorkerChainPartialsForTest();
    const runA = (async () => { await T.setStack(stack); await T.pipelineIdle(); })();
    const first = await window.__waitFor(() => { const ps = capture.peek(); return ps.length ? ps[0] : null; });
    const aRunId = first ? first.runId : null;
    await T.setStack(detour);
    await T.pipelineIdle();
    await runA;
    const aParts = capture.stop().filter(p => p.runId === aRunId);
    return { aRunId, aLastTotal: aParts.length ? aParts[aParts.length - 1].total : 0 };
  }, { stack, detour, STREAM_MS });
}

test('workflow: abandon a slow transform run, detour, re-enter — rebuild-and-swap resumes byte-identically', async ({ page }) => {
  await gotoApp(page);
  await seedQuints(page);
  const expected = await coldTransformRows(page, SEMO);
  await isolate(page);

  const { aLastTotal } = await abandonTransform(page, SEMO, flat('a'));
  expect(aLastTotal).toBeGreaterThan(0);

  const out = await page.evaluate(async ({ SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    const capture = T.captureWorkerChainPartialsForTest();
    await T.setStack([{ tool: 'semordnilap', params: {} }]);
    await T.pipelineIdle();
    const parts = capture.stop().map(p => p.total);
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const st = await T.partialCacheState();
    const runId = T.lastCompletedRunId();
    const reply = await T.fetchWorkerAllTransformRows(runId);
    return { parts, st, rows: reply.rows.map(c => c.atoms.map(a => (a.glyph || '') + (a.wlEntry.display ?? a.wlEntry.norm)).join(' ')) };
  }, { SHIPPED_MS });

  expect(out.st.hits).toBeGreaterThanOrEqual(1);
  expect(out.st.resumedFrom).toBe(aLastTotal);          // rebuilt to the exact survivor count then swapped
  expect(out.parts[0]).toBe(aLastTotal);                // instant paint of the frozen stash
  expect(Math.min(...out.parts)).toBe(aLastTotal);      // no rewind — frozen through catch-up, then climbs
  expect(out.rows).toEqual(expected);                   // byte-identical incl. ↔ glyphs (fold structure intact)
});

// ─── Invalidation matrix (all four mechanisms, asserted on the partial cache) ──

test('a rescore rebuild drops the stashed partial — the re-entry runs cold with fresh scores', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page);
  await isolate(page);

  await abandonFlat(page, flat('W*'), flat('X*'));
  expect((await partialState(page)).size).toBeGreaterThanOrEqual(1);   // stashed

  // Remap every score to 42 — a syncConfig rebuild that swaps the corpus object and calls
  // clearResultCache. The stash is dropped, so the re-entry can only reflect the new corpus.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Big', [{ input: '0-1000', length: '', output: '42' }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect((await partialState(page)).size).toBe(0);                     // cleared

  const { st, rows } = await reenterFlat(page, flat('W*'));
  expect(st.resumedFrom).toBe(0);                                     // ran cold, no stale seed
  expect(rows.every(([, score]) => score === 42)).toBe(true);
});

test('a merged partial survives a scope detour and back; a scoped partial is dropped on leaving its scope', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Other', entries: ['ZEBRA'], scores: [50] }));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await isolate(page);

  // A MERGED partial binds the stable ownedMerged, so a detour's purgeDiscardedCacheEntries KEEPS it.
  await abandonFlat(page, flat('W*'), flat('X*'));
  await page.evaluate(() => window.__grawlixTest.setScope('Big'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setScope('All Wordlists'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const merged = await reenterFlat(page, flat('W*'));
  expect(merged.st.resumedFrom).toBeGreaterThan(0);                  // merged tile survived the detour

  // A SCOPED partial binds that scope's ownedCorpus; leaving the scope rebuilds it, so the
  // purge drops the tile and returning runs cold.
  await page.evaluate(() => window.__grawlixTest.configurePartialCacheForTest({ minMs: 0 }));   // reset stashes/hits
  await page.evaluate(() => window.__grawlixTest.setScope('Big'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await abandonFlat(page, flat('W*'), flat('X*'));
  await page.evaluate(() => window.__grawlixTest.setScope('All Wordlists'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setScope('Big'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const scoped = await reenterFlat(page, flat('W*'));
  expect(scoped.st.resumedFrom).toBe(0);                             // scoped tile dropped on leaving its scope
});

test('a My Edits score edit keeps the stashed partial and the resume serves the new score', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page, { aerie: true });
  await isolate(page);

  await abandonFlat(page, flat('*'), flat('X*'));                    // AERIE@50 sits in the stash

  // AERIE is a My-Edits-only winner, so editing its score reshapes no variant set → replaced
  // === false → the corpus object is unchanged, so the stash stays valid and reads live scores.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('AERIE', 'AERIE', 90));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const { st, rows } = await reenterFlat(page, flat('*'));
  expect(st.resumedFrom).toBeGreaterThan(0);                        // kept → the re-entry resumed
  expect(rows.find(([n]) => n === 'aerie')[1]).toBe(90);            // ... and the stash serves the new score
});

test('a My Edits delete purges the stashed partial (replaced=true, past the identity check)', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page, { aerie: true });
  await isolate(page);

  await abandonFlat(page, flat('*'), flat('X*'));
  expect((await partialState(page)).size).toBeGreaterThanOrEqual(1);

  // A delete swaps row objects (replaced===true), which the corpus-object identity test can NOT
  // catch (same object, spliced in place) — so purgeCacheForCorpus must drop the stash.
  await page.evaluate(() => window.__grawlixTest.deleteMyEdit('AERIE'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const { st, rows } = await reenterFlat(page, flat('*'));
  expect(st.resumedFrom).toBe(0);                                   // purged → the re-entry ran cold
  expect(rows.some(([n]) => n === 'aerie')).toBe(false);           // AERIE is gone
});

test('a reshaping edit that supersedes a streaming run stashes nothing (generation guard)', async ({ page }) => {
  await gotoApp(page);
  await seedBig(page, { aerie: true });
  await isolate(page);

  // Delete AERIE (replaced=true) WHILE a run streams: it supersedes the run and mutates the
  // corpus in place (same object). Without the run-start generation guard the abort would stash
  // a join spanning the mutation — stale _i the corpus-identity check can't reject. The guard
  // skips that stash, so the post-delete result is a clean cold run.
  await page.evaluate(async ({ STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerPartialsForTest();
    const run = (async () => { await T.setStack([{ tool: 'search', params: { pattern: '*' } }]); await T.pipelineIdle(); })();
    await window.__waitFor(() => capture.peek().length > 0);
    T.deleteMyEdit('AERIE');
    await run.catch(() => {});
    await T.pipelineIdle();
    capture.stop();
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
  }, { STREAM_MS, SHIPPED_MS });

  expect((await partialState(page)).stashes).toBe(0);              // the poisoned join was never stashed
  const rows = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 1e9).then(r => r.rows.map(x => x.norm)));
  expect(rows.some(n => n === 'aerie')).toBe(false);
});
