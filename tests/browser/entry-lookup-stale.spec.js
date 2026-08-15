// The panel's lookup card answers for the entry it was queried with, and nothing it
// renders names that entry — so once the box holds different text the old results have
// to go rather than sit under a word they don't describe.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

const addList = (page, opts) => page.evaluate(o => window.__grawlixTest.addCustomWordlist(o), opts);

async function openPanelOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
}

// Synonyms for `cat` alone; every other entry draws a blank everywhere, so a card still
// on screen after the entry changes can only be the stale one. Registered after gotoApp
// on purpose — gotoApp installs its own empty-Datamuse route, and the later route wins.
async function stubSynonyms(page) {
  await page.route(/api\.datamuse\.com/, route => {
    const words = /rel_syn=cat(?:&|$)/.test(route.request().url()) ? [{ word: 'feline' }] : [];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(words) });
  });
}

// The Search links row is a .lookup-sec too, and carries a "Thesaurus ↗" link, so match
// on the heading rather than on section text.
const thesaurusCard = page => page.locator('.entry-panel-lookup .lookup-sec')
  .filter({ has: page.locator('.lookup-sec-head', { hasText: /^Thesaurus$/ }) });

async function openOnCat(page) {
  await gotoApp(page);
  await stubSynonyms(page);
  await addList(page, { name: 'W', entries: ['cat', 'dog'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'cat');
  await expect(thesaurusCard(page)).toContainText('feline');
}

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('editing the entry drops the previous entry’s lookup results', async ({ page }) => {
  await openOnCat(page);

  const input = page.locator('#entry-panel .entry-input');
  await expect(input).toBeEnabled();
  await input.fill('dog');

  // Inside LOOKUP_DEBOUNCE_MS, so no request for `dog` has been sent yet and no reply
  // can be what cleared this — only the grace-window drop.
  await expect(thesaurusCard(page)).toBeHidden({ timeout: 700 });
});

test('the Search links survive the drop, so the section shrinks instead of collapsing', async ({ page }) => {
  await openOnCat(page);

  const input = page.locator('#entry-panel .entry-input');
  await expect(input).toBeEnabled();
  await input.fill('dog');

  const links = page.locator('.entry-panel-lookup .lookup-links');
  await expect(links).toBeVisible();
  await expect(links.locator('a', { hasText: 'Wiktionary' })).toHaveAttribute('href', /dog$/);
});
