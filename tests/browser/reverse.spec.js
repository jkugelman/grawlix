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

test('remove string cuts through the worker, one occurrence or every one', async ({ page }) => {
  await fixture(page, ['derrieres', 'drieres', 'dries']);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'remove', params: { pattern: 'er', mode: 'one' } }]));
  expect(asSet(await readVisible(page))).toEqual(new Set(['derrieres>drieres', 'drieres>dries']));

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'remove', params: { pattern: 'er' } }]));
  expect(asSet(await readVisible(page))).toEqual(new Set(['derrieres>dries', 'drieres>dries']));
});

test('the All|One split button switches occurrence mode and writes it to the URL', async ({ page }) => {
  await fixture(page, ['derrieres', 'drieres', 'dries']);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'remove', params: { pattern: 'er' } }]));

  const seg = page.locator('.tool-row .seg-btn');
  await expect(seg).toHaveText(['All', 'One']);
  await expect(seg.nth(0)).toHaveClass(/\bactive\b/);
  await expect(seg.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(seg.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.tool-row [role="group"]')).toHaveAttribute('aria-label', 'Occurrences');

  await seg.nth(1).click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(seg.nth(1)).toHaveClass(/\bactive\b/);
  await expect(seg.nth(0)).not.toHaveClass(/\bactive\b/);
  await expect(seg.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(seg.nth(0)).toHaveAttribute('aria-pressed', 'false');
  expect(asSet(await readVisible(page))).toEqual(new Set(['derrieres>drieres', 'drieres>dries']));
  expect(page.url()).toContain('remove=er&mode=one');

  await seg.nth(0).click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(page.url()).toContain('remove=er&mode=all');
});

test('clicking the ⇄ button flips Remove string to Add string, keeping the occurrence mode', async ({ page }) => {
  await fixture(page, ['derrieres', 'drieres', 'dries']);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'remove', params: { pattern: 'er', mode: 'all' } }]));

  const label = page.locator('.tool-row .tool-label').first();
  const reverseBtn = page.locator('.tool-row .tool-row-reverse').first();
  await expect(label).toContainText('Remove string');
  await reverseBtn.click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(label).toContainText('Add string');
  expect(asSet(await readVisible(page))).toEqual(new Set(['dries>derrieres', 'dries>drieres']));
  expect(page.url()).toContain('add=er&mode=all');
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
