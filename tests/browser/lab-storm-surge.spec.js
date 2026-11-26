import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

const LAB = '/lab/storm-surge/';
const THESAURUS = ['@moby', 'surge:boost,boom,swell', 'hole:cup,cut', '@wordnet', '@roget', '@quality', 'surge:boost+,boom+'].join('\n');
const LIST = { name: 'Lab', entries: ['porthole', 'storm surge', 'storm', 'surge'], scores: [50, 50, 50, 50] };

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await page.route('**/lab/storm-surge/data/thesaurus.txt', route => route.fulfill({ body: THESAURUS, contentType: 'text/plain' }));
});

const meters = page => page.locator('#vs-host .entry-row .atom-tool.tool-meter');

test('the lab page runs its own tool in its own worker, best clues first', async ({ page }) => {
  await gotoApp(page, LAB, { labTools: ['storm_surge'] });
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), LIST);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'storm_surge' }]));
  await expectVisible(page, [['storm surge', 'boost / boom = surge'], ['porthole', 'cup / cut = hole']], { ordered: true });
  await expect(page.locator('.entry-headers .col-tool')).toHaveText('Quality ↓');
  await expect(meters(page)).toHaveCount(2);
  expect(await meters(page).evaluateAll(els => els.map(el => el.dataset.level))).toEqual(['3', '1']);
  await expect(page).not.toHaveURL(/sort=/);
});

test('a picked sort replaces Quality and lands in the URL', async ({ page }) => {
  await gotoApp(page, LAB, { labTools: ['storm_surge'] });
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), LIST);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'storm_surge' }]));
  await expectVisible(page, [['storm surge', 'boost / boom = surge'], ['porthole', 'cup / cut = hole']], { ordered: true });
  await page.locator('.col-tool .col-sort').click();
  await expect(page).toHaveURL(/sort=quality/);
  await expectVisible(page, [['porthole', 'cup / cut = hole'], ['storm surge', 'boost / boom = surge']], { ordered: true });
});

test('Help images load from the site root on a lab page', async ({ page }) => {
  await gotoApp(page, LAB + '#/help', { labTools: ['storm_surge'] });
  const src = await page.locator('.faq-shot img').first().evaluate(img => img.src);
  expect(new URL(src).pathname).toMatch(/^\/img\//);
});

test('the main page leaves lab tools out', async ({ page }) => {
  await gotoApp(page);
  expect(await page.evaluate(() => 'storm_surge' in window.TOOLS)).toBe(false);
});
