// The edit panel's seed across scopes. A foreign single-list scope is a read-only
// inspector: it shows the scoped list's own value and fires NO worker seed query. The
// merged view is editable but stays fully local (the clicked row IS the winner), so it
// also fires no fetchEditSeed. (My Edits — the one editable non-merged scope — still
// refines off the worker; covered by the seed tests elsewhere.)

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

async function openPanelOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
}

function captureSeed(page) {
  return page.evaluate(() => ({
    entry: document.querySelector('#entry-panel-entry').value,
    score: document.querySelector('#entry-panel-score').value,
    comment: document.querySelector('#entry-panel-comment').value,
  }));
}

async function closePanel(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#entry-panel')).toBeHidden();
}

const seedDebug = page => page.evaluate(() => window.__grawlixTest.entryPanelSeedDebug());

async function enterScopedRichMode(page, scopeName) {
  await page.evaluate(n => window.__grawlixTest.setScope(n), scopeName);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

test('a foreign scope shows the scoped list value and fires no worker seed query', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const ENTRY = 'WORD000';   // Hi: score 200, comment hi0 ; Lo: score 10, comment lo0

  await enterScopedRichMode(page, 'Lo');
  const before = await seedDebug(page);

  await openPanelOnEntry(page, ENTRY);
  // Read-only: shows Lo's own 10/lo0, not the merge winner (Hi 200/hi0).
  await expect(page.locator('#entry-panel-score')).toHaveValue('10');
  await expect(page.locator('#entry-panel-score')).not.toBeEditable();
  expect(await captureSeed(page)).toEqual({ entry: 'WORD000', score: '10', comment: 'lo0' });

  // A read-only scope resolves its seed locally — no worker query, no winner applied.
  const after = await seedDebug(page);
  expect(after.seedQueriesFired).toBe(before.seedQueriesFired);
  expect(after.seedWinnersApplied).toBe(before.seedWinnersApplied);
  await closePanel(page);
});

test('a foreign scope score-cell click opens the read-only panel with the score field locked', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await enterScopedRichMode(page, 'Lo');

  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: /^WORD000$/ }),
  }).first();
  await row.locator('.atom-score').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page.locator('#entry-panel-score')).not.toBeEditable();
  await expect(page.locator('#entry-panel-score')).not.toBeFocused();
});

test('the merged view opens the panel with no worker query (local path)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // Merged All Wordlists view: the clicked row IS the merge winner, so resolveSeed
  // stays local and fires no fetchEditSeed.
  await scopeTo(page, null);   // All Wordlists
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  const before = await seedDebug(page);
  await openPanelOnEntry(page, 'WORD000');
  await expect(page.locator('#entry-panel-score')).toHaveValue('200');   // Hi wins the merge
  const after = await seedDebug(page);
  // No worker query: the merged path is fully local + synchronous.
  expect(after.seedQueriesFired).toBe(before.seedQueriesFired);
  await closePanel(page);
});
