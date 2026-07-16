import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// A search <mark> carries a 1px background bleed (padding + compensating negative
// margin). When the match lands at the entry's trailing edge — a suffix match, or
// a whole-string match like "blin" — that bleed used to overflow the shrink-wrapped
// entry cell by 1px and falsely trip text-overflow:ellipsis, lopping off the last
// character ("blin" rendered as "bli…"). text-overflow leaves textContent intact,
// so the only observable signal is scrollWidth exceeding clientWidth.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => {
    window.__grawlixTest.addCustomWordlist({
      name: 'Clip',
      // "blin" is a whole-string match; "goblin" a trailing (suffix) match; the
      // others carry the match away from the end as controls.
      entries: ['blin', 'goblin', 'blind', 'blini'],
      scores: [50, 50, 50, 50],
    });
  });
}

function setSearch(page, pattern) {
  return page.evaluate(p => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: p } }]), pattern);
}

function rowClips(page) {
  return page.evaluate(async () => {
    await window.__grawlixTest.pipelineIdle?.();
    return [...document.querySelectorAll('#vs-host .entry-row')].map(r => {
      const el = r.querySelector('.atom-entry');
      return { text: (el?.textContent || '').trim(), clipped: el.scrollWidth > el.clientWidth };
    });
  });
}

test('a search match at the entry\'s trailing edge does not clip the cell', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'blin');

  await expect.poll(async () => (await rowClips(page)).length).toBeGreaterThan(0);
  const rows = await rowClips(page);

  expect(rows.map(r => r.text).sort()).toEqual(['blin', 'blind', 'blini', 'goblin']);
  for (const r of rows) expect(r.clipped, `"${r.text}" should not be clipped`).toBe(false);
});
