// P5b — the edit popover's seed resolves off the worker in a scoped view.
// resolveSeed must find the All Wordlists merge winner without main reading the
// corpus, so a scoped click queries the worker (fetchEditSeed) for the winner —
// including a scoped-lower-priority overlap, where the winner is a different,
// higher-priority list than the scoped one. The merged view stays fully local (the
// clicked row IS the winner), so it fires no worker query.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const COUNT = 300;   // past VS_BUFFER so windowing engages and rows re-fetch

// Hi (added first) = higher merge priority. Both lists carry the same norms, but
// Hi's score/comment differ from Lo's, so a scoped view of Lo shows Lo's values
// while the merge winner is Hi — the seed must reflect Hi.
async function seedCorpus(page) {
  await page.evaluate(({ count }) => {
    const mk = (scoreBase, tag) => {
      const entries = [], scores = [], comments = [];
      for (let i = 0; i < count; i++) {
        entries.push('WORD' + String(i).padStart(3, '0'));
        scores.push(scoreBase + (i % 40));
        comments.push(tag + i);
      }
      return { entries, scores, comments };
    };
    window.__grawlixTest.addCustomWordlist({ name: 'Hi', ...mk(200, 'hi') });
    return window.__grawlixTest.addCustomWordlist({ name: 'Lo', ...mk(10, 'lo') });
  }, { count: COUNT });
}

async function openPopoverOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
}

function captureSeed(page) {
  return page.evaluate(() => ({
    entry: document.querySelector('#atom-pop-entry').value,
    score: document.querySelector('#atom-pop-score').value,
    comment: document.querySelector('#atom-pop-comment').value,
  }));
}

async function closePopover(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#atom-popover')).toBeHidden();
}

const seedDebug = page => page.evaluate(() => window.__grawlixTest.popoverSeedDebug());

async function enterScopedRichMode(page, scopeName) {
  await page.evaluate(n => window.__grawlixTest.setScope(n), scopeName);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

test('scoped seed comes from the worker; winner is the higher-priority list', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const ENTRY = 'WORD000';   // Hi: score 200, comment hi0 ; Lo: score 10, comment lo0

  // Scoped to Lo: the seed comes from the worker (fetchEditSeed → ownedMerged winner).
  await enterScopedRichMode(page, 'Lo');
  const before = await seedDebug(page);

  await openPopoverOnEntry(page, ENTRY);
  // Playwright polls toHaveValue, so it waits through the brief disabled refine window.
  await expect(page.locator('#atom-pop-score')).toHaveValue('200');
  // The winner is Hi (higher priority), not the scoped Lo — proves resolveSeed seeds the merge.
  expect(await captureSeed(page)).toEqual({ entry: 'WORD000', score: '200', comment: 'hi0' });

  // Non-vacuous: the worker actually answered this seed (query fired AND a winner applied).
  const after = await seedDebug(page);
  expect(after.seedQueriesFired).toBeGreaterThan(before.seedQueriesFired);
  expect(after.seedWinnersApplied).toBeGreaterThan(before.seedWinnersApplied);
  await closePopover(page);
});

test('a scoped score-cell click focuses the score field after the worker refine', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await enterScopedRichMode(page, 'Lo');

  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: /^WORD000$/ }),
  }).first();
  await row.locator('.atom-score').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  await expect(page.locator('#atom-pop-score')).toBeFocused();
});

test('the merged view opens the popover with no worker query (local path)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // Merged All Wordlists view: the clicked row IS the merge winner, so resolveSeed
  // stays local and fires no fetchEditSeed.
  await scopeTo(page, null);   // All Wordlists
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  const before = await seedDebug(page);
  await openPopoverOnEntry(page, 'WORD000');
  await expect(page.locator('#atom-pop-score')).toHaveValue('200');   // Hi wins the merge
  const after = await seedDebug(page);
  // No worker query: the merged path is fully local + synchronous.
  expect(after.seedQueriesFired).toBe(before.seedQueriesFired);
  await closePopover(page);
});
