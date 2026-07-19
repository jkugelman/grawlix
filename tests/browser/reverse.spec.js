import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, readVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function fixture(page, entries) {
  await gotoApp(page);
  await page.evaluate(e => window.__grawlixTest.addCustomWordlist({ name: 'RevTest', entries: e, scores: e.map(() => 50) }), entries);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const asSet = rows => new Set(rows.map(r => (Array.isArray(r) ? r.join('>') : r)));

test('head off reversed grows the front through the worker', async ({ page }) => {
  await fixture(page, ['wing', 'swing', 'read', 'bread', 'dog']);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'head_off', params: { pattern: '?' }, reverse: true }]));
  expect(asSet(await readVisible(page))).toEqual(new Set(['wing>swing', 'read>bread']));
});

test('clicking the ⇄ button flips Head off to Head on and reverses the result', async ({ page }) => {
  await fixture(page, ['wing', 'swing', 'read', 'bread']);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'head_off', params: { pattern: '?' } }]));
  expect(asSet(await readVisible(page))).toEqual(new Set(['swing>wing', 'bread>read']));

  const label = page.locator('.tool-row .tool-label').first();
  const reverseBtn = page.locator('.tool-row .tool-row-reverse').first();
  await expect(label).toContainText('Head off');
  await reverseBtn.click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(label).toContainText('Head on');
  expect(asSet(await readVisible(page))).toEqual(new Set(['wing>swing', 'read>bread']));
  expect(page.url()).toContain('head_on');
});
