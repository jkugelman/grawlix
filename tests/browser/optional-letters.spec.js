// Optional letters — a no-param transform emitting synthetic marked entries.
// Scoring and the per-position rules are unit-tested (tests/unit/tools/
// optional-letters.test.js); this tier covers the gallery wiring and that a run
// reaches the table. See docs/tools.md.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, addTool, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OptionalTest',
    entries: ['hart', 'hat', 'house', 'hose', 'cat'],
    scores: [70, 60, 80, 50, 40],
  }));
}

test('the gallery lists it under an Optional category', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.gallery-cat-chip', { hasText: 'Optional' })).toBeVisible();
});

test('a run marks each droppable letter and drops entries that have none', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await addTool(page, 'optional_letters');
  // One atom per row, not a hart → haⓡt pair: input: 'hidden' drops the source
  // entry, whose only difference from the output is the mark itself. cat has no
  // droppable letter, so its absence is part of the assertion too.
  await expectVisible(page, ['haⓡt', 'hoⓤse']);
});
