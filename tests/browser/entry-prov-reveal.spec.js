// The Appears-in block's REVEAL, as distinct from its content. `.entry-panel-async`
// ships collapsed (grid-template-rows: 0fr; opacity: 0) and only the `revealed`
// class opens it, so provenance rows can sit in the DOM fully rendered and still be
// invisible — a blank Appears-in table with a populated `.entry-panel-prov` inside
// it. Every other provenance spec reads the rows' text, which passes either way;
// these assert the block is actually on screen.
//
// The regression this pins: a new pipeline result landing while the panel is open
// re-renders it (rebindEntry → refresh({resetInputs: true})) with the provenance
// rows ALREADY shipped, so the table is painted inline into a fresh, unrevealed
// wrapper. The re-fired provenance query then answers with identical rows, and a
// render memo keyed on the markup alone skipped the repaint — and with it the
// reveal — leaving the block collapsed until the panel was reopened.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// CRANE is carried by both lists, so its provenance table has rows to show.
async function seedCorpus(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha',
    entries: ['CRANE', 'EAGLE', 'GRAPE'],
    scores: [90, 50, 20],
    comments: ['big bird', 'raptor', 'fruit'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo',
    entries: ['CRANE', 'BIRD'],
    scores: [40, 30],
  }));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Click the entry cell — the gesture that opens the panel with NO field focused,
// which is what routes a later re-bind through the `resetInputs: true` re-render.
async function openPanelOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await expect(row).toBeVisible();
  await page.mouse.click(5, 5);
  await row.locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
}

// What the user sees: the async block's own box and opacity. A collapsed wrapper
// clips its content, so the rows' own bounding boxes say nothing — measure the
// wrapper against the table it should be showing. Height alone is too weak (the
// child's padding survives the collapse, so a shut block still measures ~13px);
// `tableHeight` is the bar it has to clear. `rows` keeps the whole thing from
// passing vacuously on an empty table.
function readProvBlock(page) {
  return page.evaluate(() => {
    const inner = document.querySelector('#entry-panel .entry-panel-prov-wrap');
    const wrap = inner?.closest('.entry-panel-async');
    if (!wrap) return { present: false };
    return {
      present: true,
      height: wrap.getBoundingClientRect().height,
      tableHeight: inner.querySelector('.entry-panel-prov')?.getBoundingClientRect().height ?? 0,
      opacity: Number(getComputedStyle(wrap).opacity),
      rows: inner.querySelectorAll('.entry-panel-prov tbody tr').length,
    };
  });
}

// Poll: the rows arrive from the worker and the reveal rides a 0.18s transition,
// so settle on the end state rather than sampling mid-animation.
async function expectProvRevealed(page, why) {
  await expect.poll(() => readProvBlock(page), { message: why })
    .toMatchObject({ present: true, rows: 2 });
  await expect.poll(() => readProvBlock(page).then(b => b.opacity), { message: `${why}: block opacity` })
    .toBe(1);
  const block = await readProvBlock(page);
  expect(block.height, `${why}: block shows the whole table`)
    .toBeGreaterThanOrEqual(block.tableHeight);
  expect(block.tableHeight, `${why}: table has height`).toBeGreaterThan(0);
}

// Drive the real search input: it re-runs the pipeline, and the result landing
// while the panel is open is what triggers the re-bind re-render.
async function setSearch(page, pattern) {
  await page.locator('.search-bar input[data-key="pattern"]').fill(pattern);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('the Appears-in block stays revealed when a re-run re-renders the open panel', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await openPanelOnEntry(page, 'CRANE');
  await expectProvRevealed(page, 'on open');

  // 'R' still matches CRANE, so the panel re-binds and re-renders rather than
  // holding (the !found path) — provenance is unchanged by the search, so the
  // re-fired query answers with the same two rows.
  await setSearch(page, 'R');
  await expectProvRevealed(page, 'after the re-run re-rendered the panel');
});
