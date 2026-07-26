// A panel opened from the URL has no clicked row, so the table would sit at the
// top with the linked entry hundreds of rows below the fold. The reveal scrolls
// it into view behind the panel.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const ENTRIES = Array.from({ length: 800 }, (_, i) => 'row' + String(i).padStart(3, '0'));
const TARGET = 'row600';

const row = (page, entry) => page.locator(`.entry-row[data-entry="${entry}"]`);
const scrollY = page => page.evaluate(() => window.scrollY);

async function seedList(page) {
  await gotoApp(page);
  await page.evaluate(list => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: list, scores: list.map(() => 50),
  }), ENTRIES);
}

test('a deep link scrolls the table to the linked entry and picks it', async ({ page }) => {
  await seedList(page);
  await gotoApp(page, `/?entry=${TARGET}`);
  await expect(page.locator('#entry-panel')).toBeVisible();

  await expect(row(page, TARGET)).toBeInViewport();
  expect(await scrollY(page)).toBeGreaterThan(0);
  await expect(row(page, TARGET)).toHaveClass(/selected/);   // so Esc→Enter reopens it
});

test('the revealed row is still there when the panel closes', async ({ page }) => {
  await seedList(page);
  await gotoApp(page, `/?entry=${TARGET}`);
  await expect(page.locator('#entry-panel')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.locator('#entry-panel')).not.toBeVisible();
  await expect(row(page, TARGET)).toBeInViewport();
});

// Mirrored 5-letter pairs: each entry's partner is both its reverse (a semordnilap
// chain) and its anagram (an anagram group), so one fixture drives both tiers.
async function seedMirrorPairs(page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const entries = [];
    const letter = n => String.fromCharCode(65 + n);
    for (let i = 0; i < 150; i++) {
      const mid = letter(i % 26) + letter((i / 26 | 0) % 26) + letter((i / 676 | 0) % 26);
      entries.push('A' + mid + 'Z', 'Z' + [...mid].reverse().join('') + 'A');
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Mirror', entries, scores: entries.map(() => 50) });
  });
}

// Taking the LAST row's entry is what guarantees the link lands below the fold.
async function lastRowTarget(page, fetch) {
  return page.evaluate(async fetchName => {
    const T = window.__grawlixTest;
    const reply = await T[fetchName](T.lastCompletedRunId());
    const rows = reply.rows ?? reply.groups;
    const last = rows[rows.length - 1];
    const chain = last.atoms ? last : last.chains[last.chains.length - 1];
    const atom = chain.atoms[chain.atoms.length - 1].wlEntry;
    return { target: atom.display ?? atom.norm, query: location.search };
  }, fetch);
}

// A separate worker scan from the flat one: the entry is an atom inside a chain
// row here, not a row of its own.
test('a deep link into a transform result scrolls to the chain row holding the entry', async ({ page }) => {
  await seedMirrorPairs(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap', params: {} }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const { target, query } = await lastRowTarget(page, 'fetchWorkerAllTransformRows');

  await gotoApp(page, `/?entry=${encodeURIComponent(target)}&${query.replace(/^\?/, '')}`);
  await expect(page.locator('#entry-panel')).toBeVisible();

  await expect(row(page, target.toLowerCase())).toBeInViewport();
  expect(await scrollY(page)).toBeGreaterThan(0);
});

// The third scan: here the entry sits inside a group's members.
test('a deep link into a grouped result scrolls to the group holding the entry', async ({ page }) => {
  await seedMirrorPairs(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', grouped: true }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const { target, query } = await lastRowTarget(page, 'fetchWorkerAllGroups');

  await gotoApp(page, `/?entry=${encodeURIComponent(target)}&${query.replace(/^\?/, '')}`);
  await expect(page.locator('#entry-panel')).toBeVisible();

  expect(await scrollY(page)).toBeGreaterThan(0);
});

test('an entry the pipeline filters out leaves the table where it was', async ({ page }) => {
  await seedList(page);
  await gotoApp(page, `/?entry=${TARGET}&search=row00*`);

  // The panel opens regardless — it resolves against the corpus, not the result.
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page.locator('#entry-panel-entry')).toHaveValue(TARGET);
  await expect(row(page, TARGET)).toHaveCount(0);
  expect(await scrollY(page)).toBe(0);
});
