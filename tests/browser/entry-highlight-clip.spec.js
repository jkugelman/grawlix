import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// A search <mark> at the entry's trailing edge (a suffix or whole-string match
// like "blin") can overflow the shrink-wrapped cell by 1px and trip
// text-overflow:ellipsis, lopping off the last character ("blin" as "bli…").
//
// Measured float-precise on purpose: the overflow is sub-pixel, so the obvious
// scrollWidth>clientWidth check (integer, both sides round equal) silently misses
// it in Firefox — the only engine the bug manifests in. Compare the text's
// rendered right edge (a Range rect) against the cell's content-box right edge.

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
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const contentRight = box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      const rng = document.createRange();
      rng.selectNodeContents(el);
      const textRight = rng.getBoundingClientRect().right;
      return { text: (el?.textContent || '').trim(), clipped: textRight - contentRight > 0.5 };
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
